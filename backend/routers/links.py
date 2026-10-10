"""Website Links in Private Documents — SSRF-safe ingest into the user's private
knowledge library, integrated with the same RAG retrieval as uploaded files.

Every read/update/refresh/delete goes through the signed-in user's token, so
Supabase RLS enforces ownership. Links are ai_documents rows (source_kind='link')
and their extracted text lives in ai_document_chunks, so retrieve_user_chunks
surfaces them automatically for that user only. Disabled links are excluded by
the match_user_chunks RPC. Extracted content is untrusted reference material.
"""

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from lib.ai_access import require_ai_user
from lib.auth import AuthenticatedUser
from lib.chunking import chunk_text
from lib.embeddings import get_embeddings_service
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


async def _reprocess(user: AuthenticatedUser, link_id: str, url: str, *,
                     keep_title: bool, previous_hash: str | None) -> dict:
    """Fetch + extract + (re)embed. Updates the row in place — never duplicates it."""
    try:
        data = await fetch_and_extract(url)
    except LinkIngestError as error:
        return await _patch(user, link_id, {
            "processing_status": "failed",
            "processing_error": error.message,
            "last_processed_at": _now(),
        })

    # Nothing changed since last time → skip re-embedding (caching rule).
    if previous_hash and data["content_hash"] == previous_hash:
        return await _patch(user, link_id, {
            "processing_status": "ready", "processing_error": None, "last_processed_at": _now(),
        })

    try:
        await user_rest(
            "DELETE", "ai_document_chunks", user.access_token,
            params={"document_id": f"eq.{link_id}", "user_id": f"eq.{user.id}"},
            prefer="return=minimal",
        )
        embeddings = get_embeddings_service()
        chunks: list[dict] = []
        for index, content in enumerate(chunk_text(data["text"])):
            row = {
                "id": str(uuid4()), "user_id": user.id, "document_id": link_id,
                "chunk_index": index, "content": content,
                "metadata": {"source": "link", "url": url, "title": data.get("title")},
            }
            embedded = await embeddings.embed(content) if embeddings.enabled else None
            if embedded:
                row["embedding"] = embedded.embedding
                row["embedding_model"] = embedded.model
                row["embedding_version"] = embedded.version
            chunks.append(row)
        if chunks:
            await user_rest(
                "POST", "ai_document_chunks", user.access_token,
                params={"on_conflict": "document_id,chunk_index"},
                json=chunks, prefer="resolution=merge-duplicates,return=minimal",
            )
        patch = {
            "processing_status": "ready", "processing_error": None,
            "canonical_url": data.get("canonical_url"), "author": data.get("author"),
            "published_at": data.get("published_at"), "content_hash": data["content_hash"],
            "word_count": data["word_count"], "last_processed_at": _now(),
        }
        if not keep_title and data.get("title"):
            patch["document_title"] = data["title"]
        return await _patch(user, link_id, patch)
    except SupabaseAPIError as error:
        raise_http(error)


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
    return [AIDocument(**row) for row in rows]


@router.post("", response_model=AIDocument, status_code=status.HTTP_201_CREATED)
async def add_link(payload: AILinkCreate, user: AuthenticatedUser = Depends(require_ai_user)) -> AIDocument:
    try:
        normalized, host = validate_url(payload.url)
    except LinkIngestError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=error.message)
    try:
        _check_host_not_internal(host)
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
                "processing_status": "processing", "processing_error": None, "word_count": 0,
            },
            prefer="return=minimal",
        )
    except SupabaseAPIError as error:
        raise_http(error)

    processed = await _reprocess(user, link_id, normalized, keep_title=bool(payload.title), previous_hash=None)
    return AIDocument(**processed)


@router.patch("/{link_id}", response_model=AIDocument)
async def update_link(link_id: str, payload: AILinkUpdate,
                      user: AuthenticatedUser = Depends(require_ai_user)) -> AIDocument:
    await _owned_link(user, link_id)
    patch: dict = {}
    if payload.title is not None:
        patch["document_title"] = payload.title[:300] or None
    if payload.description is not None:
        patch["description"] = payload.description
    if payload.category is not None:
        patch["category"] = payload.category
    if payload.enabled is not None:
        patch["enabled"] = payload.enabled
    if not patch:
        return AIDocument(**await _owned_link(user, link_id))
    try:
        return AIDocument(**await _patch(user, link_id, patch))
    except SupabaseAPIError as error:
        raise_http(error)


@router.post("/{link_id}/refresh", response_model=AIDocument)
async def refresh_link(link_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> AIDocument:
    link = await _owned_link(user, link_id)
    await _patch(user, link_id, {"processing_status": "processing"})
    processed = await _reprocess(
        user, link_id, link["source_url"],
        keep_title=True, previous_hash=link.get("content_hash"),
    )
    return AIDocument(**processed)


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(link_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> None:
    await _owned_link(user, link_id)
    try:
        await user_rest(
            "DELETE", "ai_documents", user.access_token,
            params={"id": f"eq.{link_id}", "user_id": f"eq.{user.id}"},
            prefer="return=minimal",
        )
    except SupabaseAPIError as error:
        raise_http(error)
