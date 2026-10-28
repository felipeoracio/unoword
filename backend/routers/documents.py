"""Private Supabase Storage uploads with bounded server-side extraction."""

from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status

from lib.ai_access import require_ai_user
from lib.auth import AuthenticatedUser
from lib import knowledge, source_processing
from lib.document_processing import DocumentProcessingError, MAX_UPLOAD_BYTES, validate_upload
from lib.supabase_client import (
    SupabaseAPIError,
    raise_http,
    user_rest,
    user_storage_delete,
    user_storage_upload,
)
from models.ai import AIDocument, AIDocumentUpload, AISourceIndexStatus, DocumentType

router = APIRouter(prefix="/documents", tags=["documents"])


async def _owned_documents(user: AuthenticatedUser, extra: dict[str, str] | None = None) -> list[dict]:
    try:
        return await user_rest(
            "GET", "ai_documents", user.access_token,
            params={"select": "*", "user_id": f"eq.{user.id}", **(extra or {})},
        )
    except SupabaseAPIError as error:
        raise_http(error)


@router.get("", response_model=list[AIDocument])
async def list_documents(user: AuthenticatedUser = Depends(require_ai_user)) -> list[AIDocument]:
    rows = await _owned_documents(user, {"source_kind": "eq.file", "order": "updated_at.desc", "limit": "200"})
    return [AIDocument(**row) for row in rows]


@router.post("/upload", response_model=AIDocument, status_code=status.HTTP_201_CREATED)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
    document_title: Annotated[str, Form(min_length=1, max_length=300)],
    document_type: Annotated[DocumentType, Form()] = "other",
    user: AuthenticatedUser = Depends(require_ai_user),
) -> AIDocument:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Files are limited to 5 MB")
    try:
        filename, file_type = validate_upload(file.filename or "document", data)
        metadata = AIDocumentUpload(
            filename=filename,
            file_type=file_type,
            document_title=document_title,
            document_type=document_type,
        )
    except DocumentProcessingError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error

    document_id = str(uuid4())
    storage_path = f"{user.id}/{document_id}/{metadata.filename}"
    uploaded = False
    metadata_created = False
    try:
        await user_storage_upload(storage_path, user.access_token, data, metadata.file_type)
        uploaded = True
        created = await user_rest(
            "POST", "ai_documents", user.access_token,
            json={
                "id": document_id,
                "user_id": user.id,
                **metadata.model_dump(),
                "storage_path": storage_path,
                "processing_status": "pending",
                "processing_error": None,
                "word_count": 0,
            },
            prefer="return=representation",
        )
        metadata_created = bool(created)
        await source_processing.enqueue(user.id, document_id)
        background_tasks.add_task(source_processing.drain, user.id)
        return AIDocument(**{**created[0], "processing_phase": "queued"})
    except (SupabaseAPIError, HTTPException) as error:
        if uploaded:
            if metadata_created:
                try:
                    await user_rest(
                        "PATCH", "ai_documents", user.access_token,
                        params={"id": f"eq.{document_id}", "user_id": f"eq.{user.id}"},
                        json={"processing_status": "failed", "processing_error": "Document processing failed"},
                        prefer="return=minimal",
                    )
                except SupabaseAPIError:
                    pass
            else:
                try:
                    await user_storage_delete(storage_path, user.access_token)
                except SupabaseAPIError:
                    pass
        if isinstance(error, HTTPException):
            raise
        raise_http(error)


@router.get("/status/{document_id}", response_model=AIDocument)
async def document_status(document_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> AIDocument:
    rows = await _owned_documents(user, {"id": f"eq.{document_id}", "limit": "1"})
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return AIDocument(**rows[0])


@router.get("/{document_id}/index-status", response_model=AISourceIndexStatus)
async def index_status(document_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> AISourceIndexStatus:
    rows = await _owned_documents(user, {"id": f"eq.{document_id}", "limit": "1"})
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    base = {"select": "id", "user_id": f"eq.{user.id}"}
    try:
        chunks = await user_rest("GET", "ai_document_chunks", user.access_token,
                                 params={**base, "document_id": f"eq.{document_id}"})
        embedded = await user_rest("GET", "ai_document_chunks", user.access_token,
                                   params={**base, "document_id": f"eq.{document_id}", "embedding": "not.is.null"})
        memories = await user_rest("GET", "ai_memories", user.access_token,
                                   params={**base, "source_id": f"eq.{document_id}"})
    except SupabaseAPIError as error:
        raise_http(error)
    return AISourceIndexStatus(
        document_id=document_id, processing_status=rows[0]["processing_status"],
        enabled=rows[0].get("enabled", True), chunk_count=len(chunks or []),
        embedded_chunk_count=len(embedded or []), memory_ids=[str(m["id"]) for m in memories or []],
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(document_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> None:
    rows = await _owned_documents(user, {"id": f"eq.{document_id}", "limit": "1"})
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    document = rows[0]
    try:
        try:
            await user_storage_delete(document["storage_path"], user.access_token)
        except SupabaseAPIError as storage_error:
            if storage_error.response_status != 404:
                raise
        await knowledge.delete_source_memory(user.id, user.access_token, document_id)
        await user_rest(
            "DELETE", "ai_documents", user.access_token,
            params={"id": f"eq.{document_id}", "user_id": f"eq.{user.id}"},
            prefer="return=minimal",
        )
    except SupabaseAPIError as error:
        raise_http(error)
