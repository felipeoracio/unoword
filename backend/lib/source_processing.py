"""Leased, resumable source jobs. No user tokens or secrets are stored in jobs."""
import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from lib import knowledge
from lib.ai_access import entitlement_is_active, get_entitlement
from lib.document_processing import extract_document, DocumentProcessingError, MAX_UPLOAD_BYTES
from lib.embeddings import get_embeddings_service
from lib.link_ingest import fetch_and_extract, LinkIngestError
from lib.supabase_client import service_rest, source_storage_download, SupabaseAPIError

logger = logging.getLogger(__name__)
BATCH_SIZE = 16
STAGING_BATCH_SIZE = 500


class LeaseLost(Exception):
    pass


async def enqueue(user_id: str, source_id: str, *, restart=False) -> str:
    try:
        return await service_rest("POST", "rpc/ai_ingest_enqueue", json={
            "p_user": user_id, "p_source": source_id, "p_restart": restart,
        })
    except SupabaseAPIError as error:
        if "processing_queue_full" in error.detail:
            raise HTTPException(429, "processing_queue_full") from error
        raise HTTPException(503, "source_processing_unavailable") from error


async def checkpoint(job, token, *, rows=None, payload=None, phase=None, cursor=None, total=None, reset=False, release=True):
    saved = await service_rest("POST", "rpc/ai_ingest_checkpoint", json={
        "p_job": job["id"], "p_token": token, "p_rows": rows or [], "p_payload": payload,
        "p_phase": phase or job["phase"], "p_cursor": job["cursor"] if cursor is None else cursor,
        "p_total": job["total"] if total is None else total, "p_reset": reset, "p_release": release,
    })
    if saved is not True:
        raise LeaseLost()


def _embedding_fields(embedded):
    return {"embedding": embedded.embedding, "embedding_model": embedded.model,
            "embedding_version": embedded.version} if embedded else {}


async def _step(job, token):
    user_id, source_id = job["user_id"], job["source_id"]
    if not entitlement_is_active(await get_entitlement(user_id)):
        raise LeaseLost()
    sources = await service_rest("GET", "ai_documents", params={
        "select": "*", "id": f"eq.{source_id}", "user_id": f"eq.{user_id}", "limit": "1",
    })
    if not sources or not sources[0].get("enabled", True):
        raise LeaseLost()
    source = sources[0]
    payload = job.get("payload") or {}
    embeddings = get_embeddings_service()
    if job["phase"] == "extracting":
        if source["source_kind"] == "link":
            data = await fetch_and_extract(source["source_url"])
        else:
            raw = await source_storage_download(user_id, source["storage_path"], MAX_UPLOAD_BYTES)
            extracted = await asyncio.to_thread(extract_document, source["filename"], raw)
            data = {"text": extracted.text, "word_count": extracted.word_count}
        text = data.pop("text")
        data.setdefault("content_hash", hashlib.sha256(text.encode()).hexdigest())
        chunks = knowledge.split(text)
        if not chunks:
            raise DocumentProcessingError("No readable passages were found.")
        payload = {**data, "excerpt": text[:knowledge.SUMMARY_INPUT_CHARS],
                   "index_note": None if embeddings.enabled else "AI indexing is not configured; keyword search remains available."}
        if data["content_hash"] == source.get("content_hash") and source.get("summary"):
            payload["summary"] = source["summary"]
        metadata = ({"source": "link", "url": source["source_url"], "title": source["document_title"]}
                    if source["source_kind"] == "link" else {"filename": source["filename"], "file_type": source["file_type"]})
        timestamp = datetime.now(timezone.utc).isoformat()
        for start in range(0, len(chunks), STAGING_BATCH_SIZE):
            rows = [{"id": str(uuid4()), "user_id": user_id, "document_id": source_id,
                     "chunk_index": index, "content": chunks[index], "metadata": metadata, "created_at": timestamp}
                    for index in range(start, min(start+STAGING_BATCH_SIZE, len(chunks)))]
            last = start+STAGING_BATCH_SIZE >= len(chunks)
            await checkpoint(job, token, rows=rows, payload=payload if last else None,
                             phase="indexing" if last else "extracting", total=len(chunks),
                             cursor=0, reset=start == 0, release=last)
        return
    if job["phase"] == "indexing":
        staged = await service_rest("GET", "ai_ingest_chunks", params={
            "select": "payload", "job_id": f"eq.{job['id']}", "chunk_index": f"gte.{job['cursor']}",
            "order": "chunk_index.asc", "limit": str(BATCH_SIZE),
        })
        rows = [item["payload"] for item in staged]
        if not rows or [r["chunk_index"] for r in rows] != list(range(job["cursor"],job["cursor"]+len(rows))):
            raise RuntimeError("incomplete_processing_stage")
        # Reuse this same source's unchanged vectors on refresh. No other user's
        # data is read, and a model/version change correctly invalidates reuse.
        old = await service_rest("GET", "ai_document_chunks", params={
            "select": "chunk_index,content,embedding,embedding_model,embedding_version",
            "user_id": f"eq.{user_id}", "document_id": f"eq.{source_id}",
            "chunk_index": "in.(" + ",".join(str(r["chunk_index"]) for r in rows) + ")",
            "limit": str(BATCH_SIZE),
        })
        cached = {r["chunk_index"]: r for r in old}
        missing = []
        for row in rows:
            previous = cached.get(row["chunk_index"], {})
            if (previous.get("content") == row["content"] and previous.get("embedding")
                    and previous.get("embedding_model") == embeddings.model
                    and previous.get("embedding_version") == embeddings.version):
                row.update({k: previous[k] for k in ("embedding", "embedding_model", "embedding_version")})
            else:
                missing.append(row)
        vectors = await embeddings.embed_many([row["content"] for row in missing])
        if embeddings.enabled and (len(vectors) != len(missing) or any(v is None for v in vectors)):
            raise RuntimeError("embedding_provider_unavailable")
        for row, vector in zip(missing, vectors):
            row.update(_embedding_fields(vector))
        cursor = job["cursor"] + len(rows)
        await checkpoint(job, token, rows=rows, cursor=cursor,
                         phase="summarizing" if cursor == job["total"] else "indexing")
        return
    if job["phase"] == "summarizing":
        summary = payload.get("summary") or await knowledge.summarize(source["document_title"], payload["excerpt"])
        payload.update(summary=summary)
        payload.pop("excerpt", None)
        await checkpoint(job, token, payload=payload, phase="publishing")
        return
    kind = "saved link" if source["source_kind"] == "link" else "document"
    title = (payload.get("title") or source["document_title"]) if source["document_title"] == source.get("source_url") else source["document_title"]
    memory_text = f'From your {kind} "{title[:200]}": {payload["summary"]}'[:5000]
    # Keep summary generation checkpointed separately from memory embedding.
    previous = await service_rest("GET", "ai_memories", params={
        "select": "id,memory,embedding,embedding_model,embedding_version", "user_id": f"eq.{user_id}",
        "source_id": f"eq.{source_id}", "limit": "1",
    })
    previous = previous[0] if previous and previous[0].get("memory") == memory_text else {}
    cached_memory = previous.get("embedding") and previous.get("embedding_model") == embeddings.model and previous.get("embedding_version") == embeddings.version
    vectors = [] if cached_memory else await embeddings.embed_many([memory_text])
    if embeddings.enabled and not cached_memory and (not vectors or vectors[0] is None):
        raise RuntimeError("embedding_provider_unavailable")
    timestamp = datetime.now(timezone.utc).isoformat()
    memory = {"id": previous.get("id") or str(uuid4()), "user_id": user_id, "source_id": source_id, "memory": memory_text,
              "memory_type": "theme", "importance": knowledge.MEMORY_IMPORTANCE,
              "created_at": timestamp, "updated_at": timestamp, **_embedding_fields(vectors[0] if vectors else None)}
    if cached_memory:
        memory.update({key: previous[key] for key in ("embedding", "embedding_model", "embedding_version")})
    published = await service_rest("POST", "rpc/ai_ingest_publish", json={
        "p_job": job["id"], "p_token": token, "p_memory": memory,
    })
    if published is not True:
        raise LeaseLost()


async def process_one(user_id: str | None = None) -> bool:
    token = str(uuid4())
    job = await service_rest("POST", "rpc/ai_ingest_claim", json={"p_user": user_id, "p_token": token})
    if not job:
        return False
    try:
        async with asyncio.timeout(40):
            await _step(job, token)
    except LeaseLost:
        # A delete, consent change, downgrade or newer generation wins.
        pass
    except Exception as error:
        permanent = isinstance(error, DocumentProcessingError) or (
            isinstance(error, LinkIngestError) and error.reason not in {"unreachable", "fetch_failed", "timeout"})
        message = (str(error) if isinstance(error, DocumentProcessingError) else error.message
                   if isinstance(error, LinkIngestError) else "Processing was interrupted. An automatic retry is scheduled.")
        if isinstance(error, SupabaseAPIError) and error.response_status in {403,404,413}:
            permanent = True
            message = "The private file could not be read. Remove it and upload it again."
        logger.warning("source_processing_failed job=%s type=%s", job["id"], type(error).__name__)
        await service_rest("POST", "rpc/ai_ingest_fail", json={
            "p_job": job["id"], "p_token": token, "p_error": message[:500], "p_permanent": permanent,
        })
    return True


async def drain(user_id: str | None = None, *, max_steps=8):
    """Bounded work per invocation; every completed batch survives a cold start."""
    steps = 0
    try:
        async with asyncio.timeout(50):
            while steps < max_steps:
                if not await process_one(user_id):
                    break
                steps += 1
    except TimeoutError:
        logger.warning("source_processing_budget_expired")
    except SupabaseAPIError:
        logger.warning("source_processing_worker_unavailable")
    return steps
