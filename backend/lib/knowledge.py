"""Shared ingest pipeline for private sources (files, links, saved writing).

Every source goes through the same steps: chunk -> embed -> store chunks ->
build a per-source writing memory (summary) -> embed the memory. Embedding
failures never lose content: chunks are stored without vectors and healed
later by `heal_missing_embeddings`. Calls pass a user token (RLS) or None
(service role, used only by maintenance scripts with an explicit user_id).
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any
from uuid import uuid4

from lib.chunking import chunk_text
from lib.embeddings import get_embeddings_service
from lib.supabase_client import SupabaseAPIError, service_rest, user_rest

logger = logging.getLogger(__name__)

CHUNK_CHARS = int(os.environ.get("AI_CHUNK_CHARS", "1500"))
CHUNK_OVERLAP = int(os.environ.get("AI_CHUNK_OVERLAP", "200"))
SUMMARY_INPUT_CHARS = 6000
MEMORY_IMPORTANCE = 4


async def _rest(method: str, path: str, token: str | None, **kwargs: Any) -> Any:
    if token:
        return await user_rest(method, path, token, **kwargs)
    return await service_rest(method, path, **kwargs)


def split(text: str) -> list[str]:
    return chunk_text(text, max_chars=CHUNK_CHARS, overlap=CHUNK_OVERLAP)


async def _attach_embedding(row: dict, content: str) -> bool:
    embeddings = get_embeddings_service()
    if not embeddings.enabled:
        return False
    embedded = await embeddings.embed(content)
    if not embedded:
        return False
    row["embedding"] = embedded.embedding
    row["embedding_model"] = embedded.model
    row["embedding_version"] = embedded.version
    return True


async def index_source(
    user_id: str, token: str | None, document_id: str, text: str, metadata: dict
) -> tuple[int, int]:
    """Replace a document's chunks. Returns (chunk_count, embedded_count)."""
    await _rest(
        "DELETE", "ai_document_chunks", token,
        params={"document_id": f"eq.{document_id}", "user_id": f"eq.{user_id}"},
        prefer="return=minimal",
    )
    rows: list[dict] = []
    embedded = 0
    for index, content in enumerate(split(text)):
        row = {
            "id": str(uuid4()), "user_id": user_id, "document_id": document_id,
            "chunk_index": index, "content": content, "metadata": metadata,
        }
        embedded += await _attach_embedding(row, content)
        rows.append(row)
    if rows:
        await _rest(
            "POST", "ai_document_chunks", token,
            params={"on_conflict": "document_id,chunk_index"},
            json=rows, prefer="resolution=merge-duplicates,return=minimal",
        )
    return len(rows), embedded


def index_note(chunks: int, embedded: int) -> str | None:
    if chunks and embedded < chunks and get_embeddings_service().enabled:
        return "Some passages are not AI-indexed yet; they will be retried automatically."
    return None


async def summarize(title: str, text: str) -> str:
    from lib.ai_provider import extractive_summary, get_suggestion_provider

    excerpt = (text or "")[:SUMMARY_INPUT_CHARS]
    try:
        summary = await get_suggestion_provider().summarize(title, excerpt)
    except Exception as error:  # noqa: BLE001 - summary must never block ingest
        logger.warning("memory_summary_failed error=%s", error)
        summary = ""
    return (summary or extractive_summary(excerpt)).strip()[:1500]


async def delete_source_memory(user_id: str, token: str | None, source_id: str) -> None:
    await _rest(
        "DELETE", "ai_memories", token,
        params={"source_id": f"eq.{source_id}", "user_id": f"eq.{user_id}"},
        prefer="return=minimal",
    )


async def rebuild_source_memory(
    user_id: str, token: str | None, source_id: str, *,
    title: str, text: str, kind: str, memory_type: str = "theme",
) -> str | None:
    """Replace the writing memory derived from one source. Never raises."""
    try:
        summary = await summarize(title, text)
        if not summary:
            return None
        memory = f'From your {kind} "{title[:200]}": {summary}'
        row = {
            "user_id": user_id, "memory_type": memory_type, "memory": memory[:5000],
            "importance": MEMORY_IMPORTANCE, "source_id": source_id,
        }
        await _attach_embedding(row, memory)
        await delete_source_memory(user_id, token, source_id)
        await _rest("POST", "ai_memories", token, json=row, prefer="return=minimal")
        if kind != "writing session":
            await _rest(
                "PATCH", "ai_documents", token,
                params={"id": f"eq.{source_id}", "user_id": f"eq.{user_id}"},
                json={"summary": summary[:2000]}, prefer="return=minimal",
            )
        return memory
    except SupabaseAPIError as error:
        logger.warning("memory_write_failed status=%s detail=%s", error.response_status, error.detail)
        return None


async def heal_missing_embeddings(user_id: str, limit: int = 16) -> int:
    """Embed a bounded batch of this user's rows that were stored without vectors."""
    if not get_embeddings_service().enabled:
        return 0
    healed = 0
    for table, column in (("ai_document_chunks", "content"), ("ai_memories", "memory"), ("ai_writing_chunks", "content")):
        try:
            rows = await service_rest(
                "GET", table,
                params={"select": f"id,{column}", "user_id": f"eq.{user_id}",
                        "embedding": "is.null", "limit": str(limit - healed)},
            )
            for row in rows or []:
                patch: dict = {}
                if not await _attach_embedding(patch, row.get(column) or ""):
                    return healed
                await service_rest(
                    "PATCH", table,
                    params={"id": f"eq.{row['id']}", "user_id": f"eq.{user_id}"},
                    json=patch, prefer="return=minimal",
                )
                healed += 1
        except SupabaseAPIError as error:
            logger.warning("embedding_heal_failed table=%s status=%s", table, error.response_status)
        if healed >= limit:
            break
    return healed


async def disabled_source_ids(user_id: str, token: str | None) -> set[str]:
    rows = await _rest(
        "GET", "ai_documents", token,
        params={"select": "id", "user_id": f"eq.{user_id}", "enabled": "eq.false"},
    )
    return {str(row["id"]) for row in rows or []}


_STOPWORDS = set(
    "that this with from your about have will would there their what when where which "
    "been were they them then than into just like also some more most very much such "
    "para como pero porque esta este esto sobre entre cuando donde tiene tengo".split()
)


def keyword_terms(text: str, limit: int = 12) -> list[str]:
    words = [w.lower() for w in re.findall(r"[^\W\d_]{4,}", text or "")]
    return list(dict.fromkeys(w for w in words if w not in _STOPWORDS))[:limit]
