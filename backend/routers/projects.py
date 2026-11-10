"""Projects reuse workspace authentication, Pro verification and owner-bound RPCs."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from lib.auth import AuthenticatedUser
from lib.projects import project_rpc
from lib.request_security import trusted_origin
from models.projects import ProjectSave, ResourceAssignment, ProjectSelection, ProjectDelete, ResourceKind, ProfileAnswerSave
from lib.profile_setup import QUESTIONS, BY_ID, parse_answer
from lib.supabase_client import user_rest
from routers.workspace import require_workspace_user, private_response, owner
from pydantic import BaseModel, Field

router = APIRouter(prefix="/workspace/projects", tags=["projects"], dependencies=[Depends(private_response)])

@router.get("")
async def project_state(user: AuthenticatedUser = Depends(require_workspace_user)):
    return await project_rpc("workspace_project_state", user)

@router.get("/resources")
async def resource_catalog(expected_user_id: UUID | None = None, user: AuthenticatedUser = Depends(require_workspace_user)):
    if expected_user_id and str(expected_user_id) != user.id: raise HTTPException(409, "account_changed")
    return await project_rpc("workspace_resource_catalog", user)

@router.get("/resources/{kind}/{resource_id}/preview")
async def resource_preview(kind: ResourceKind, resource_id: UUID,
                           user: AuthenticatedUser = Depends(require_workspace_user)):
    # Owner-initiated previews are separate from AI retrieval/consent.
    table, fields = {
        "document": ("writing_documents", "id,title,plain_text"),
        "source": ("ai_documents", "id,document_title,summary,description,processing_status,source_url"),
        "memory": ("ai_memories", "id,memory,memory_type"),
        "writing_session": ("ai_writing_sessions", "id,created_at"),
    }[kind]
    rows = await user_rest("GET", table, user.access_token, params={
        "select": fields, "id": f"eq.{resource_id}", "user_id": f"eq.{user.id}", "limit": "1",
    })
    if not rows: raise HTTPException(404, "resource_not_found")
    row = rows[0]
    return {"id": str(resource_id), "kind": kind,
            "title": row.get("title") or row.get("document_title") or row.get("memory_type") or "Saved writing",
            "text": (row.get("plain_text") or row.get("summary") or row.get("memory") or row.get("description") or "")[:6000],
            "state": row.get("processing_status"), "url": row.get("source_url")}

class ResourceRename(BaseModel):
    expected_user_id: UUID
    title: str = Field(min_length=1, max_length=300)

@router.patch("/resources/source/{resource_id}", dependencies=[Depends(trusted_origin)])
async def rename_source(resource_id: UUID, payload: ResourceRename,
                        user: AuthenticatedUser = Depends(require_workspace_user)):
    owner(payload, user)
    if not payload.title.strip(): raise HTTPException(422, "A title is required")
    result = await user_rest("PATCH", "ai_documents", user.access_token,
        params={"id": f"eq.{resource_id}", "user_id": f"eq.{user.id}"},
        json={"document_title": payload.title.strip()}, prefer="return=representation")
    if not result: raise HTTPException(404, "resource_not_found")
    return {"id": str(resource_id), "title": payload.title.strip()}

@router.get("/profile/questions")
async def profile_questions(user: AuthenticatedUser = Depends(require_workspace_user)):
    return QUESTIONS

@router.get("/profile/answers")
async def profile_answers(expected_user_id: UUID | None = None, user: AuthenticatedUser = Depends(require_workspace_user)):
    if expected_user_id and str(expected_user_id) != user.id: raise HTTPException(409, "account_changed")
    rows = await user_rest("GET", "ai_onboarding_answers", user.access_token, params={
        "user_id": f"eq.{user.id}", "question_id": "like.setup:*", "order": "updated_at.desc", "limit": "10",
    })
    return [{"question_id": row["question_id"].removeprefix("setup:"), **parse_answer(row)} for row in rows]

@router.put("/profile/answers/{question_id}", dependencies=[Depends(trusted_origin)])
async def save_profile_answer(question_id: str, payload: ProfileAnswerSave,
                              user: AuthenticatedUser = Depends(require_workspace_user)):
    owner(payload, user)
    question = BY_ID.get(question_id)
    if not question: raise HTTPException(404, "profile_question_not_found")
    selected = list(dict.fromkeys(payload.selected_option_ids))
    if not set(selected).issubset({option["id"] for option in question["options"]}) or (not question["multiple"] and len(selected) > 1):
        raise HTTPException(422, "invalid_profile_answer")
    row = await project_rpc("workspace_save_profile_answer", user, {
        "p_question": question_id, "p_title": question["title"], "p_revision": payload.revision,
        "p_mutation": str(payload.mutation_id), "p_answer": {
            "selected_option_ids": selected, "custom_answer": payload.custom_answer, "notes": payload.notes,
        },
    })
    return {"question_id": question_id, **parse_answer(row)}

@router.put("/active", dependencies=[Depends(trusted_origin)])
async def select_project(payload: ProjectSelection, user: AuthenticatedUser = Depends(require_workspace_user)):
    owner(payload, user)
    return await project_rpc("workspace_select_project", user, {
        "p_project": str(payload.project_id) if payload.project_id else None,
        "p_revision": payload.revision, "p_mutation": str(payload.mutation_id),
        "p_last_documents": {key: str(value) if value else None for key, value in payload.last_documents.items()},
    })

@router.put("/resources/{kind}/{resource_id}", dependencies=[Depends(trusted_origin)])
async def assign_resource(kind: ResourceKind, resource_id: UUID, payload: ResourceAssignment,
                          user: AuthenticatedUser = Depends(require_workspace_user)):
    owner(payload, user)
    return await project_rpc("workspace_assign_resource", user, {
        "p_kind": kind, "p_id": str(resource_id), "p_projects": [str(id) for id in payload.project_ids],
        "p_revision": payload.revision, "p_mutation": str(payload.mutation_id),
    })

@router.put("/{project_id}", dependencies=[Depends(trusted_origin)])
async def save_project(project_id: UUID, payload: ProjectSave, user: AuthenticatedUser = Depends(require_workspace_user)):
    owner(payload, user)
    return await project_rpc("workspace_save_project", user, {
        "p_id": str(project_id), "p_revision": payload.revision, "p_mutation": str(payload.mutation_id),
        "p_data": payload.model_dump(mode="json", exclude={"expected_user_id", "revision", "mutation_id"}, exclude_none=True),
    })

@router.post("/{project_id}/delete", dependencies=[Depends(trusted_origin)])
async def delete_project(project_id: UUID, payload: ProjectDelete, user: AuthenticatedUser = Depends(require_workspace_user)):
    owner(payload, user)
    return await project_rpc("workspace_delete_project", user, {
        "p_id": str(project_id), "p_revision": payload.revision, "p_name": payload.confirm_name,
    })

@router.get("/{project_id}/statistics")
async def project_statistics(project_id: UUID, user: AuthenticatedUser = Depends(require_workspace_user)):
    return await project_rpc("workspace_project_statistics", user, {"p_project": str(project_id)})
