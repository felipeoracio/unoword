"""Private writing workspace. Every data call forwards the owner's verified JWT."""

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, Query
import json
from pydantic import BaseModel, ConfigDict, Field, field_validator

from lib.auth import AuthenticatedUser, require_user
from models.writing_goal import WritingProgress
from lib.ai_access import require_ai_user, get_entitlement, entitlement_is_active
from lib.request_security import trusted_origin
from lib.supabase_client import user_rest, service_rest, SupabaseAPIError
from lib.writing_document import (
    clean_document,
    plain_text,
    markdown,
    to_docx,
    to_pdf,
    import_docx,
)


async def require_workspace_user(
    user: AuthenticatedUser = Depends(require_user),
) -> AuthenticatedUser:
    # Reuse the server's active/trialing, expiry and Stripe-mode checks.
    if not entitlement_is_active(await get_entitlement(user.id)):
        raise HTTPException(403, "writing_workspace_pro_required")
    return user


async def private_response(response: Response):
    response.headers["Cache-Control"] = "private, no-store"


router = APIRouter(
    prefix="/workspace",
    tags=["writing-workspace"],
    dependencies=[Depends(private_response)],
)


def limits():
    return {
        "max_document_chars": 200000,
        "max_upload_bytes": 5 * 1024 * 1024,
        "daily_goal": max(1, int(os.getenv("WRITING_DEFAULT_DAILY_GOAL", "250"))),
        "ai_batch_size": 3,
    }


class Owned(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_user_id: UUID


def owner(payload, user):
    if str(payload.expected_user_id) != user.id:
        raise HTTPException(409, "account_changed")


async def rest(method, table, user, **kwargs):
    try:
        return await user_rest(method, table, user.access_token, **kwargs)
    except SupabaseAPIError as error:
        if "revision_conflict" in error.detail:
            raise HTTPException(409, "revision_conflict") from error
        if "document_not_found" in error.detail:
            raise HTTPException(404, "document_not_found") from error
        # Do not echo stored content, constraints or database internals.
        code = error.response_status
        if code in {401, 403}:
            raise HTTPException(code, "workspace_access_denied") from error
        raise HTTPException(503, "workspace_storage_unavailable") from error


async def rows(table, user, **extra):
    return await rest("GET", table, user, params={"user_id": f"eq.{user.id}", **extra})


async def document(document_id, user):
    found = await rows(
        "writing_documents", user, id=f"eq.{document_id}", select="*", limit="1"
    )
    if not found:
        raise HTTPException(404, "document_not_found")
    if "content" in found[0]:
        found[0]["content"] = clean_document(found[0]["content"])
    return found[0]


@router.get("/config")
async def config(user: AuthenticatedUser = Depends(require_workspace_user)):
    return limits()


@router.get("/documents")
async def documents(
    q: str = Query(default="", max_length=200),
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = Depends(require_workspace_user),
):
    params = {
        "select": "id,user_id,title,folder_id,favorite,status,completion_status,completed_at,ai_allowed,revision,mutation_id,created_at,updated_at",
        "order": "updated_at.desc,id.asc",
        "limit": "200",
        "offset": str(offset),
    }
    if q.strip():
        literal = json.dumps(
            "*" + q.replace("*", "").replace("%", "").strip() + "*", ensure_ascii=False
        )
        params["or"] = f"(title.ilike.{literal},plain_text.ilike.{literal})"
    return await rows("writing_documents", user, **params)


@router.get("/documents/{document_id}")
async def get_document(
    document_id: UUID, user: AuthenticatedUser = Depends(require_workspace_user)
):
    return await document(document_id, user)


class DocumentSave(Owned):
    revision: int = Field(ge=0)
    mutation_id: UUID
    title: str = Field(min_length=1, max_length=300)
    content: dict
    folder_id: UUID | None = None
    favorite: bool = False
    status: Literal["active", "archived", "trashed"] = "active"
    completion_status: Literal["draft", "completed"] | None = None
    ai_allowed: bool = False

    @field_validator("content")
    @classmethod
    def validate_content(cls, value):
        return clean_document(value)


@router.put("/documents/{document_id}", dependencies=[Depends(trusted_origin)])
async def save_document(
    document_id: UUID,
    payload: DocumentSave,
    user: AuthenticatedUser = Depends(require_workspace_user),
):
    owner(payload, user)
    # ai_allowed is opt-in permission, not a grant of paid access. It only allows
    # eligible future assistant requests to read this document as context.
    data = payload.model_dump(
        mode="json", exclude={"expected_user_id", "revision", "mutation_id"}, exclude_none=True
    )
    data["plain_text"] = plain_text(payload.content)
    saved = await rest(
        "POST",
        "rpc/workspace_save_document",
        user,
        json={
            "p_id": str(document_id),
            "p_revision": payload.revision,
            "p_mutation": str(payload.mutation_id),
            "p_data": data,
        },
    )
    return saved


class CompletionChange(Owned):
    revision: int = Field(ge=1)
    mutation_id: UUID
    completion_status: Literal["draft", "completed"]


class TrashDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    revision: int = Field(ge=1)


class EmptyTrash(Owned):
    confirm: Literal[True]
    documents: list[TrashDocument] = Field(min_length=1, max_length=1000)


@router.post("/trash/empty", dependencies=[Depends(trusted_origin)])
async def empty_trash(
    payload: EmptyTrash,
    user: AuthenticatedUser = Depends(require_workspace_user),
):
    owner(payload, user)
    return await rest("POST", "rpc/workspace_empty_trash", user, json={
        "p_documents": [item.model_dump(mode="json") for item in payload.documents],
    })


@router.post("/documents/{document_id}/completion", dependencies=[Depends(trusted_origin)])
async def change_completion(
    document_id: UUID,
    payload: CompletionChange,
    user: AuthenticatedUser = Depends(require_workspace_user),
):
    owner(payload, user)
    current = await document(document_id, user)
    if str(current["mutation_id"]) == str(payload.mutation_id):
        return current
    if current["revision"] != payload.revision:
        raise HTTPException(409, "revision_conflict")
    # Reuse the revision-safe save, preserving the full saved document. Completion
    # time is assigned by the database trigger, never supplied by the browser.
    data = {key: current.get(key) for key in (
        "title", "content", "plain_text", "folder_id", "favorite", "status", "ai_allowed"
    )}
    data["completion_status"] = payload.completion_status
    return await rest("POST", "rpc/workspace_save_document", user, json={
        "p_id": str(document_id), "p_revision": payload.revision,
        "p_mutation": str(payload.mutation_id), "p_data": data,
    })


@router.get("/folders")
async def folders(user: AuthenticatedUser = Depends(require_workspace_user)):
    return await rows(
        "writing_folders", user, select="*", order="name.asc", limit="1000"
    )


class FolderCreate(Owned):
    name: str = Field(min_length=1, max_length=100)


@router.post("/folders", dependencies=[Depends(trusted_origin)])
async def create_folder(
    payload: FolderCreate, user: AuthenticatedUser = Depends(require_workspace_user)
):
    owner(payload, user)
    result = await rest(
        "POST",
        "writing_folders",
        user,
        json={"user_id": user.id, "name": payload.name},
        prefer="return=representation",
    )
    return result[0]


@router.put("/folders/{folder_id}", dependencies=[Depends(trusted_origin)])
async def sync_folder(
    folder_id: UUID,
    payload: FolderCreate,
    user: AuthenticatedUser = Depends(require_workspace_user),
):
    owner(payload, user)
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "folder_name_required")
    result = await rest(
        "POST",
        "writing_folders",
        user,
        params={"on_conflict": "id"},
        json={"id": str(folder_id), "user_id": user.id, "name": name},
        prefer="resolution=ignore-duplicates,return=representation",
    )
    if not result:
        result = await rows(
            "writing_folders", user, id=f"eq.{folder_id}", select="*", limit="1"
        )
    if not result:
        raise HTTPException(404, "folder_not_found")
    return result[0]


from lib.activity_time import ActivityTime, SessionTimer


class Activity(Owned, ActivityTime):
    id: UUID
    document_id: UUID
    started_at: datetime
    typed_words: int = Field(ge=0, le=1000000)
    pasted_words: int = Field(default=0, ge=0, le=1000000)
    duration_seconds: int = Field(ge=0, le=86400)
    sequence: int = Field(ge=1, le=2147483647)
    timer: SessionTimer | None = None


@router.put("/activity", dependencies=[Depends(trusted_origin)])
async def save_activity(
    payload: Activity, user: AuthenticatedUser = Depends(require_workspace_user)
):
    owner(payload, user)
    if (
        payload.started_at.tzinfo is None
        or payload.started_at.timestamp() > datetime.now(timezone.utc).timestamp() + 300
        or (payload.timer and payload.timer.changed_at > datetime.now(timezone.utc).timestamp() * 1000 + 300000)
    ):
        raise HTTPException(422, "invalid_activity_time")
    await document(payload.document_id, user)
    return await rest(
        "POST",
        "rpc/workspace_save_activity",
        user,
        json={"p_data": payload.model_dump(mode="json", exclude={"expected_user_id"}, exclude_none=True)},
    )


@router.get("/activity")
async def activity(
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = Depends(require_user),
):
    return await rows(
        "writing_activity",
        user,
        select="*",
        source="eq.editor",
        order="started_at.desc,id.asc",
        limit="1000",
        offset=str(offset),
    )


@router.post("/import", dependencies=[Depends(trusted_origin)])
async def import_file(
    file: UploadFile = File(), user: AuthenticatedUser = Depends(require_workspace_user)
):
    data = await file.read(limits()["max_upload_bytes"] + 1)
    await file.close()
    if len(data) > limits()["max_upload_bytes"]:
        raise HTTPException(413, "file_too_large")
    suffix = Path(file.filename or "").suffix.lower()
    title = Path(file.filename or "Imported document").stem[:300]
    try:
        if suffix == ".docx":
            return {"title": title, "content": import_docx(data), "format": "json"}
        if suffix not in {".txt", ".md", ".markdown"}:
            raise HTTPException(422, "unsupported_import_format")
        text = data.decode("utf-8-sig")
        if len(text) > limits()["max_document_chars"]:
            raise HTTPException(413, "document_too_large")
        return {
            "title": title,
            "text": text,
            "format": "markdown" if suffix in {".md", ".markdown"} else "text",
        }
    except (ValueError, UnicodeDecodeError, KeyError) as error:
        raise HTTPException(422, "invalid_import_file") from error


@router.get("/documents/{document_id}/export/{format}")
async def export_document(
    document_id: UUID,
    format: Literal["txt", "md", "docx", "pdf"],
    user: AuthenticatedUser = Depends(require_workspace_user),
):
    item = await document(document_id, user)
    content = clean_document(item["content"])
    if format == "txt":
        data = plain_text(content).encode()
        mime = "text/plain; charset=utf-8"
    elif format == "md":
        data = markdown(content).encode()
        mime = "text/markdown; charset=utf-8"
    elif format == "docx":
        data = to_docx(content, item["title"])
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        data = to_pdf(content, item["title"])
        mime = "application/pdf"
    return Response(
        data,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="UnoWord-document.{format}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


class ExportDraft(Owned):
    title: str = Field(min_length=1, max_length=300)
    content: dict


@router.post("/export/{format}", dependencies=[Depends(trusted_origin)])
async def export_draft(
    format: Literal["docx", "pdf"],
    payload: ExportDraft,
    user: AuthenticatedUser = Depends(require_workspace_user),
):
    owner(payload, user)
    content = clean_document(payload.content)
    data = (
        to_docx(content, payload.title)
        if format == "docx"
        else to_pdf(content, payload.title)
    )
    mime = (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if format == "docx"
        else "application/pdf"
    )
    return Response(
        data,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="UnoWord-document.{format}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/sources")
async def sources(user: AuthenticatedUser = Depends(require_ai_user)):
    return await rows(
        "ai_documents",
        user,
        select="id,document_title,enabled,source_kind,processing_status,processing_phase,processing_progress",
        order="updated_at.desc",
        limit="200",
    )


class SourcePermission(Owned):
    enabled: bool


@router.patch("/sources/{source_id}", dependencies=[Depends(trusted_origin)])
async def source_permission(
    source_id: UUID,
    payload: SourcePermission,
    user: AuthenticatedUser = Depends(require_ai_user),
):
    owner(payload, user)
    result = await rest(
        "PATCH",
        "ai_documents",
        user,
        params={"id": f"eq.{source_id}", "user_id": f"eq.{user.id}"},
        json={"enabled": payload.enabled},
        prefer="return=representation",
    )
    if not result:
        raise HTTPException(404, "source_not_found")
    return {"id": str(source_id), "enabled": payload.enabled}


class Assistance(Owned):
    writing_progress: WritingProgress | None = None
    document_id: UUID
    action: Literal["next", "guidance", "continue", "block", "brainstorm"]
    request_id: UUID | None = None
    consent: bool = False
    current_text: str = Field(default="", max_length=200000)
    selected_text: str = Field(default="", max_length=12000)
    language: Literal["en", "es"] = "en"


@router.post("/assistant", dependencies=[Depends(trusted_origin)])
async def assistant(
    payload: Assistance, user: AuthenticatedUser = Depends(require_ai_user)
):
    owner(payload, user)
    if not payload.consent:
        raise HTTPException(422, "document_ai_consent_required")
    await document(payload.document_id, user)
    # Older extension/editor clients may still send continue; it now means guidance.
    if payload.action == "continue":
        payload = payload.model_copy(update={"action": "guidance"})
    from lib.workspace_ai import generate_assistance

    return await generate_assistance(payload, user)


@router.get("/recovery/index")
async def recovery_index(
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = Depends(require_user),
):
    """Downgrades lock editing, not the ability to retrieve one's existing work."""
    try:
        return await service_rest(
            "GET",
            "writing_documents",
            params={
                "user_id": f"eq.{user.id}",
                "select": "id,title,updated_at",
                "order": "updated_at.desc,id.asc",
                "limit": "100",
                "offset": str(offset),
            },
        )
    except SupabaseAPIError as error:
        raise HTTPException(503, "workspace_storage_unavailable") from error


@router.get("/recovery/{document_id}/export/{format}")
async def recovery_export(
    document_id: UUID,
    format: Literal["txt", "md", "docx", "pdf"],
    user: AuthenticatedUser = Depends(require_user),
):
    try:
        found = await service_rest(
            "GET",
            "writing_documents",
            params={
                "id": f"eq.{document_id}",
                "user_id": f"eq.{user.id}",
                "select": "title,content",
                "limit": "1",
            },
        )
    except SupabaseAPIError as error:
        raise HTTPException(503, "workspace_storage_unavailable") from error
    if not found:
        raise HTTPException(404, "document_not_found")
    # Reuse the existing sanitized exporters; this path never saves or edits.
    content = clean_document(found[0]["content"])
    title = found[0]["title"]
    if format == "docx":
        data = to_docx(content, title)
        media = (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
    elif format == "pdf":
        data = to_pdf(content, title)
        media = "application/pdf"
    elif format == "md":
        data = markdown(content).encode()
        media = "text/markdown"
    else:
        data = plain_text(content).encode()
        media = "text/plain"
    return Response(
        data,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="unoword-document.{format}"',
            "Cache-Control": "private, no-store",
        },
    )
