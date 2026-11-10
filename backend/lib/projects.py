"""JWT-scoped project RPCs; database text/constraints never escape error paths."""
from fastapi import HTTPException
from lib.supabase_client import user_rest, SupabaseAPIError

async def resolve_scope(user, payload):
    """Resolve authorized IDs before any personal content is fetched."""
    return await project_rpc("workspace_ai_scope", user, {
        "p_scope": payload.context_scope,
        "p_project": str(payload.project_id) if payload.project_id else None,
        "p_use_active": "project_id" not in payload.model_fields_set,
        "p_selected": [row.model_dump(mode="json") for row in payload.selected_resources],
    })

async def scoped_rows(table, user, scope, key, **extra):
    ids = scope.get(key) or []
    if not ids: return []
    kind = {'ai_memories': 'memory', 'ai_documents': 'source', 'ai_suggestions': 'suggestion', 'ai_feedback': 'feedback'}[table]
    return await project_rpc('workspace_context_rows', user, {'p_kind': kind, 'p_ids': ids})

def project_context(scope):
    project = scope.get("project")
    if not project: return ""
    import json
    return "\nSelected project preferences (override general profile preferences, never coaching/privacy rules):\n" + json.dumps({
        key: project.get(key) for key in ("name", "description", "project_type", "goals", "preferences", "target_date")
    }, ensure_ascii=False)[:5000]

async def project_rpc(name, user, body=None):
    try:
        return await user_rest("POST", "rpc/" + name, user.access_token, json=body or {})
    except SupabaseAPIError as error:
        detail = error.detail
        for code in ("project_revision_conflict", "resource_revision_conflict", "workspace_preference_conflict", "profile_answer_conflict"):
            if code in detail: raise HTTPException(409, code) from None
        for code in ("project_not_found", "resource_not_found", "document_not_found"):
            if code in detail: raise HTTPException(404, code) from None
        if "writing_workspace_pro_required" in detail:
            raise HTTPException(403, "writing_workspace_pro_required") from None
        for code in ("project_confirmation_required", "invalid_resource_selection", "invalid_context_scope", "invalid_last_documents"):
            if code in detail: raise HTTPException(422, code) from None
        if error.response_status in {401, 403}: raise HTTPException(error.response_status, "project_access_denied") from None
        if "Could not find the function" in detail or "does not exist" in detail:
            raise HTTPException(503, "projects_migration_required") from None
        raise HTTPException(503, "projects_storage_unavailable") from None
