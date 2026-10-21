"""Fetch actual, user-owned text when choosing or connecting ideas."""

import asyncio

from fastapi import HTTPException

from lib.retrieval import RetrievedChunk
from lib.supabase_client import SupabaseAPIError, user_rest


async def selected_idea_text(user, source_id: str) -> str:
    common = {"user_id": f"eq.{user.id}", "id": f"eq.{source_id}", "limit": "1"}
    sources = await user_rest("GET", "ai_documents", user.access_token, params={
        **common, "select": "id,summary", "enabled": "eq.true", "processing_status": "eq.ready",
    })
    if sources:
        chunks = await user_rest("GET", "ai_document_chunks", user.access_token, params={
            "select": "content", "user_id": f"eq.{user.id}", "document_id": f"eq.{source_id}",
            "order": "chunk_index.asc", "limit": "2",
        })
        text = "\n".join(row["content"] for row in chunks or []) or sources[0].get("summary")
        if text:
            return text[:3000]
    memories = await user_rest("GET", "ai_memories", user.access_token, params={**common, "select": "memory,source_id"})
    if memories:
        parent = memories[0].get("source_id")
        if parent:
            disabled = await user_rest("GET", "ai_documents", user.access_token, params={
                "select": "id", "user_id": f"eq.{user.id}", "id": f"eq.{parent}", "enabled": "eq.false",
            })
            if disabled:
                raise HTTPException(404, "Idea not found")
        return memories[0]["memory"][:3000]
    raise HTTPException(404, "Idea not found")


async def diverse_passages(user, retrieved, sources, *, mode, selected_id=None):
    """Supplement semantic matches with passages from distinct available sources.

    For connections, put one passage per parent first so the prompt's bounded
    passage section cannot be monopolized by one document's sibling chunks.
    """
    by_id = {str(source["id"]): source for source in sources}
    candidates = list(dict.fromkeys(
        ([selected_id] if selected_id in by_id else []) +
        [str(c.parent_id) for c in retrieved if str(c.parent_id) in by_id] + list(by_id)
    ))[:3 if mode == "connect_dots" else 1]

    async def first_passage(source_id):
        if any(c.parent_id == source_id and c.source_type == "document_chunk" for c in retrieved):
            return None
        try:
            rows = await user_rest("GET", "ai_document_chunks", user.access_token, params={
                "select": "id,content", "user_id": f"eq.{user.id}", "document_id": f"eq.{source_id}",
                "order": "chunk_index.asc", "limit": "1",
            })
        except SupabaseAPIError:
            return None
        if not rows:
            return None
        row = rows[0]
        return RetrievedChunk("document_chunk", str(row["id"]), source_id, row["content"], 0.0,
                              source_title=by_id[source_id].get("document_title"), match="overview")

    extra = [c for c in await asyncio.gather(*(first_passage(sid) for sid in candidates)) if c]
    all_chunks = extra + retrieved
    if mode != "connect_dots":
        return all_chunks[:6]
    distinct, remaining, seen = [], [], set()
    for chunk in all_chunks:
        parent = chunk.parent_id or chunk.source_id
        if parent in seen:
            remaining.append(chunk)
        else:
            distinct.append(chunk)
            seen.add(parent)
    return (distinct + remaining)[:8]
