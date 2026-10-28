"""Authenticated user kicks plus a separately authenticated scheduled worker."""
import hmac
import os
from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from lib.ai_access import require_ai_user
from lib.auth import AuthenticatedUser
from lib import source_processing
from lib.request_security import limit_sensitive
from lib.supabase_client import user_rest, SupabaseAPIError

router = APIRouter(tags=["source-processing"])


@router.post("/processing/run", status_code=202)
async def run_for_user(background_tasks: BackgroundTasks, user: AuthenticatedUser = Depends(require_ai_user)):
    limit_sensitive("processing-run:"+user.id, maximum=24, seconds=60)
    background_tasks.add_task(source_processing.drain, user.id)
    return {"accepted": True}


@router.post("/processing/{source_id}/retry", status_code=202)
async def retry_source(source_id: UUID, background_tasks: BackgroundTasks, user: AuthenticatedUser = Depends(require_ai_user)):
    limit_sensitive("processing-retry:"+user.id, maximum=5, seconds=60)
    try:
        rows = await user_rest("GET", "ai_documents", user.access_token, params={
            "select": "id", "id": f"eq.{source_id}", "user_id": f"eq.{user.id}", "limit": "1",
        })
    except SupabaseAPIError as error:
        raise HTTPException(503, "source_processing_unavailable") from error
    if not rows:
        raise HTTPException(404, "source_not_found")
    await source_processing.enqueue(user.id, str(source_id))
    background_tasks.add_task(source_processing.drain, user.id)
    return {"accepted": True}


@router.get("/internal/ingestion")
async def scheduled_worker(request: Request, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    secret = os.getenv("CRON_SECRET", "")
    if len(secret) < 32:
        raise HTTPException(503, "processing_scheduler_not_configured")
    if not hmac.compare_digest(request.headers.get("authorization", "").encode(), ("Bearer "+secret).encode()):
        raise HTTPException(401, "worker_authentication_required")
    steps = await source_processing.drain()
    return {"steps": steps}
