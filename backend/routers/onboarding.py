"""Cosmetic tour progress in the authenticated user's existing Auth metadata.
Never grants features, stores writing text, or feeds AI personalization.
"""

from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from lib.auth import AuthenticatedUser, require_user
from lib.request_security import trusted_origin
from lib.supabase_client import auth_request, SupabaseAPIError, raise_http

KEY = "unoword_tour_v1"
STEPS = {
    "welcome",
    "sentence",
    "celebrate",
    "counter",
    "session",
    "goal",
    "progress",
    "suggestion",
    "profile",
    "extension",
    "summary",
}
ACTIONS = {
    "first_sentence_written",
    "word_counter_explored",
    "writing_session_started",
    "writing_goal_set",
    "suggestion_explored",
    "ai_profile_started",
    "extension_explored",
}
router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class Progress(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    completed_once: bool = False
    status: Literal["not_started", "in_progress", "paused", "completed"] = "not_started"
    current_step: str = Field(default="welcome", max_length=30)
    completed_actions: dict[str, bool] = Field(default_factory=dict, max_length=7)
    skipped_steps: list[str] = Field(default_factory=list, max_length=11)
    draft_id: UUID | None = None
    words: int = Field(default=0, ge=0, le=1000000)


class SaveProgress(Progress):
    expected_user_id: UUID


async def identity(user):
    try:
        result = await auth_request("GET", "user", access_token=user.access_token)
    except SupabaseAPIError as error:
        raise_http(error)
    if result.get("id") != user.id:
        raise HTTPException(401, "session_expired")
    return result


def validated(raw):
    try:
        p = Progress.model_validate(raw or {})
        if (
            p.current_step not in STEPS
            or set(p.completed_actions) - ACTIONS
            or set(p.skipped_steps) - STEPS
        ):
            raise ValueError()
        return p
    except (ValueError, TypeError):
        return Progress()


@router.get("")
async def read(response: Response, user: AuthenticatedUser = Depends(require_user)):
    response.headers["Cache-Control"] = "private, no-store"
    account = await identity(user)
    return validated((account.get("user_metadata") or {}).get(KEY))


@router.put("", dependencies=[Depends(trusted_origin)])
async def save(
    payload: SaveProgress,
    response: Response,
    user: AuthenticatedUser = Depends(require_user),
):
    response.headers["Cache-Control"] = "private, no-store"
    if str(payload.expected_user_id) != user.id:
        raise HTTPException(409, "account_changed")
    if (
        payload.current_step not in STEPS
        or set(payload.completed_actions) - ACTIONS
        or set(payload.skipped_steps) - STEPS
    ):
        raise HTTPException(422, "invalid_tour_progress")
    account = await identity(user)
    old = validated((account.get("user_metadata") or {}).get(KEY))
    data = payload.model_dump(mode="json", exclude={"expected_user_id"})
    data["completed_actions"] = {
        key: True
        for key in ACTIONS
        if old.completed_actions.get(key) or payload.completed_actions.get(key)
    }
    data["skipped_steps"] = sorted(set(old.skipped_steps) | set(payload.skipped_steps))
    data["completed_once"] = (
        old.completed_once or old.status == "completed" or payload.status == "completed"
    )
    data["words"] = max(old.words, payload.words)
    data["draft_id"] = data["draft_id"] or (str(old.draft_id) if old.draft_id else None)
    try:
        # GoTrue merges these top-level metadata keys; unrelated account metadata survives.
        await auth_request(
            "PUT", "user", access_token=user.access_token, json={"data": {KEY: data}}
        )
    except SupabaseAPIError as error:
        raise_http(error)
    return data
