"""Website Links in Private Documents — SSRF-safe ingest into the user's private
knowledge library, integrated with the same RAG retrieval as uploaded files.

Every read/update/refresh/delete goes through the signed-in user's token, so
Supabase RLS enforces ownership. Links are ai_documents rows (source_kind='link')
and their extracted text lives in ai_document_chunks, so retrieve_user_chunks
surfaces them automatically for that user only. Disabled links are excluded by
the match_user_chunks RPC. Extracted content is untrusted reference material.
"""

import asyncio
from collections import Counter
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from lib.ai_access import require_ai_user
from lib.auth import AuthenticatedUser
from lib import knowledge, source_processing
from lib.link_ingest import LinkIngestError, _check_host_not_internal, fetch_and_extract, validate_url
from lib.supabase_client import SupabaseAPIError, raise_http, user_rest
from models.ai import AIDocument, AILinkCreate, AILinkUpdate

router = APIRouter(prefix="/links", tags=["links"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _owned_link(user: AuthenticatedUser, link_id: str) -> dict:
    try:
        rows = await user_rest(
            "GET", "ai_documents", user.access_token,
            params={"select": "*", "id": f"eq.{link_id}", "user_id": f"eq.{user.id}",
                    "source_kind": "eq.link", "limit": "1"},
        )
    except SupabaseAPIError as error:
        raise_http(error)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Link not found")
    return rows[0]


async def _patch(user: AuthenticatedUser, link_id: str, patch: dict) -> dict:
    rows = await user_rest(
        "PATCH", "ai_documents", user.access_token,
        params={"id": f"eq.{link_id}", "user_id": f"eq.{user.id}"},
        json=patch, prefer="return=representation",
    )
    return rows[0]


async def _index_state(user: AuthenticatedUser, ids: list[str]) -> dict[str, dict]:
    """Read index evidence in bulk without downloading embedding arrays."""
    if not ids:
        return {}
    params = {"select": "document_id", "user_id": f"eq.{user.id}",
              "document_id": f"in.({','.join(ids)})", "limit": "1000", "order": "id.asc"}
    async def all_rows(extra):
        rows = []
        while True:
            page = await user_rest("GET", "ai_document_chunks", user.access_token,
                                   params={**params, **extra, "offset": str(len(rows))}) or []
            rows.extend(page)
            if len(page) < 1000:
                return rows
    try:
        rows, embedded = await asyncio.gather(
            all_rows({}), all_rows({"embedding": "not.is.null"}),
        )
    except SupabaseAPIError as error:
        raise_http(error)
    counts = Counter(str(row["document_id"]) for row in rows or [])
    vectors = Counter(str(row["document_id"]) for row in embedded or [])
    return {sid: {"chunk_count": counts[sid], "embedded_chunk_count": vectors[sid],
                  "indexing_status": ("indexed" if counts[sid] and vectors[sid] == counts[sid] else
                                      "partial" if vectors[sid] else "not_indexed")} for sid in ids}


async def _with_index_state(user: AuthenticatedUser, rows: list[dict]) -> list[AIDocument]:
    states = await _index_state(user, [str(row["id"]) for row in rows])
    return [AIDocument(**{**row, **states[str(row["id"])],
                          "last_successful_processed_at": row.get("last_processed_at") if row.get("processing_status") == "ready" and row.get("word_count", 0) > 0 and states[str(row["id"])]["chunk_count"] > 0 else None})
            for row in rows]


@router.get("", response_model=list[AIDocument])
async def list_links(user: AuthenticatedUser = Depends(require_ai_user)) -> list[AIDocument]:
    try:
        rows = await user_rest(
            "GET", "ai_documents", user.access_token,
            params={"select": "*", "user_id": f"eq.{user.id}", "source_kind": "eq.link",
                    "order": "updated_at.desc", "limit": "200"},
        )
    except SupabaseAPIError as error:
        raise_http(error)
    try:
        return await _with_index_state(user, rows)
    except SupabaseAPIError as error:
        raise_http(error)


@router.post("", response_model=AIDocument, status_code=status.HTTP_201_CREATED)
async def add_link(payload: AILinkCreate, background_tasks: BackgroundTasks, user: AuthenticatedUser = Depends(require_ai_user)) -> AIDocument:
    try:
        normalized, host = validate_url(payload.url)
    except LinkIngestError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=error.message)
    try:
        await asyncio.to_thread(_check_host_not_internal, host)
    except LinkIngestError as error:
        if error.reason == "blocked":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=error.message)
        # DNS 'unreachable' → still store the link so the user can retry later.

    try:
        existing = await user_rest(
            "GET", "ai_documents", user.access_token,
            params={"select": "id", "user_id": f"eq.{user.id}", "source_kind": "eq.link",
                    "source_url": f"eq.{normalized}", "limit": "1"},
        )
    except SupabaseAPIError as error:
        raise_http(error)
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You've already saved this link.")

    link_id = str(uuid4())
    try:
        await user_rest(
            "POST", "ai_documents", user.access_token,
            json={
                "id": link_id, "user_id": user.id, "source_kind": "link",
                "source_url": normalized, "filename": host[:255], "file_type": "text/html",
                "storage_path": None, "document_title": (payload.title or normalized)[:300],
                "document_type": "reference", "description": payload.description,
                "category": payload.category, "enabled": True,
                "processing_status": "pending", "processing_error": None, "word_count": 0,
            },
            prefer="return=minimal",
        )
    except SupabaseAPIError as error:
        raise_http(error)

    try:
        await source_processing.enqueue(user.id, link_id)
    except HTTPException:
        await _patch(user, link_id, {"processing_status": "failed", "processing_error": "Processing could not be queued. Retry from your Library."})
        raise
    background_tasks.add_task(source_processing.drain, user.id)
    return (await _with_index_state(user, [await _owned_link(user, link_id)]))[0]


@router.patch("/{link_id}", response_model=AIDocument)
async def update_link(link_id: str, payload: AILinkUpdate,
                      user: AuthenticatedUser = Depends(require_ai_user)) -> AIDocument:
    await _owned_link(user, link_id)
    patch: dict = {}
    if payload.title is not None:
        if not payload.title.strip():
            raise HTTPException(422, "A website title cannot be empty.")
        patch["document_title"] = payload.title.strip()[:300]
    if payload.description is not None:
        patch["description"] = payload.description
    if payload.category is not None:
        patch["category"] = payload.category
    if payload.enabled is not None:
        patch["enabled"] = payload.enabled
    if not patch:
        return (await _with_index_state(user, [await _owned_link(user, link_id)]))[0]
    try:
        return (await _with_index_state(user, [await _patch(user, link_id, patch)]))[0]
    except SupabaseAPIError as error:
        raise_http(error)


@router.post("/{link_id}/refresh", response_model=AIDocument)
async def refresh_link(link_id: str, background_tasks: BackgroundTasks, user: AuthenticatedUser = Depends(require_ai_user)) -> AIDocument:
    await _owned_link(user, link_id)
    await source_processing.enqueue(user.id, link_id, restart=True)
    background_tasks.add_task(source_processing.drain, user.id)
    return (await _with_index_state(user, [await _owned_link(user, link_id)]))[0]


@router.get("/{link_id}/content")
async def extracted_content(link_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> dict:
    """A bounded plain-text preview of the stored passages, never raw HTML."""
    link = await _owned_link(user, link_id)
    try:
        rows = await user_rest("GET", "ai_document_chunks", user.access_token, params={
            "select": "content", "user_id": f"eq.{user.id}", "document_id": f"eq.{link_id}",
            "order": "chunk_index.asc", "limit": "100",
        })
    except SupabaseAPIError as error:
        raise_http(error)
    text = ""
    truncated = False
    for row in rows or []:
        content = row.get("content") or ""
        overlap = next((size for size in range(min(len(text), len(content), knowledge.CHUNK_CHARS), 0, -1)
                        if text.endswith(content[:size])), 0)
        text += content[overlap:] if overlap else ("\n\n" if text else "") + content
        if len(text) > 40000:
            text, truncated = text[:40000], True
            break
    if not text.strip():
        raise HTTPException(409, "No extracted content is stored yet. Refresh this website to try again.")
    return {"id": link_id, "title": link["document_title"], "url": link["source_url"],
            "content": text, "word_count": link.get("word_count") or 0, "truncated": truncated or len(rows) == 100}


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(link_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> None:
    await _owned_link(user, link_id)
    try:
        await knowledge.delete_source_memory(user.id, user.access_token, link_id)
        await user_rest(
            "DELETE", "ai_documents", user.access_token,
            params={"id": f"eq.{link_id}", "user_id": f"eq.{user.id}"},
            prefer="return=minimal",
        )
    except SupabaseAPIError as error:
        raise_http(error)
