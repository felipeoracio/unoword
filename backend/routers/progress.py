"""Account-scoped activity metadata and entitlement-filtered streak presentation."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, ConfigDict, field_validator
from lib.auth import AuthenticatedUser, require_user
from lib.ai_access import get_entitlement, entitlement_is_active
from lib.plans import plan_features
from lib.request_security import trusted_origin
from lib.supabase_client import service_rest, SupabaseAPIError

router = APIRouter(prefix="/progress", tags=["writing-progress"])


async def rpc(name, body):
    try:
        return await service_rest("POST", "rpc/" + name, json=body)
    except SupabaseAPIError as error:
        raise HTTPException(503, "progress_sync_unavailable") from error


class Session(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=100)
    started_at: datetime
    typed_words: int = Field(ge=0, le=1000000)
    pasted_words: int = Field(default=0, ge=0, le=1000000)
    duration_seconds: int = Field(ge=0, le=86400)
    sequence: int = Field(ge=1, le=9007199254740991)

    @field_validator("started_at")
    @classmethod
    def valid_time(cls, value):
        if (
            value.tzinfo is None
            or value.year < 2000
            or value.timestamp() > datetime.now(timezone.utc).timestamp() + 300
        ):
            raise ValueError("Invalid activity time")
        return value


class Sync(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_user_id: UUID
    sessions: list[Session] = Field(max_length=500)


@router.post("/sessions", dependencies=[Depends(trusted_origin)])
async def sync(
    payload: Sync, response: Response, user: AuthenticatedUser = Depends(require_user)
):
    response.headers["Cache-Control"] = "private, no-store"
    if str(payload.expected_user_id) != user.id:
        raise HTTPException(409, "account_changed")
    return {
        "synced": await rpc(
            "writing_sync_extension",
            {
                "p_user": user.id,
                "p_sessions": [s.model_dump(mode="json") for s in payload.sessions],
            },
        )
    }


@router.get("/streak")
async def streak(
    response: Response,
    timezone: str = "UTC",
    user: AuthenticatedUser = Depends(require_user),
):
    response.headers["Cache-Control"] = "private, no-store"
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "invalid_timezone") from None
    paid = entitlement_is_active(await get_entitlement(user.id))
    permissions = plan_features("pro" if paid else "free")
    result = await rpc(
        "writing_streak_presentation",
        {
            "p_user": user.id,
            "p_timezone": timezone,
            "p_unlimited": permissions["unlimited_writing_streaks"],
        },
    )
    return {"user_id": user.id, **result}


class Clear(BaseModel):
    expected_user_id: UUID
    before: datetime
    confirmed: bool = False
    keep_extension_key: str | None = Field(default=None, max_length=100)


@router.post("/clear", dependencies=[Depends(trusted_origin)])
async def clear(
    payload: Clear, response: Response, user: AuthenticatedUser = Depends(require_user)
):
    if str(payload.expected_user_id) != user.id:
        raise HTTPException(409, "account_changed")
    if not payload.confirmed:
        raise HTTPException(422, "confirmation_required")
    if payload.before.tzinfo is None:
        raise HTTPException(422, "invalid_clear_time")
    response.headers["Cache-Control"] = "private, no-store"
    await rpc(
        "writing_clear_progress",
        {
            "p_user": user.id,
            "p_before": payload.before.isoformat(),
            "p_keep_key": payload.keep_extension_key,
        },
    )
    return {"cleared": True}


@router.get("/history")
async def history(
    response: Response,
    timezone: str = "UTC",
    offset: int = 0,
    user: AuthenticatedUser = Depends(require_user),
):
    if not entitlement_is_active(await get_entitlement(user.id)):
        raise HTTPException(403, "unlimited_streaks_pro_required")
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "invalid_timezone") from None
    if offset < 0:
        raise HTTPException(422, "invalid_offset")
    response.headers["Cache-Control"] = "private, no-store"
    return {
        "days": await rpc(
            "writing_progress_history",
            {"p_user": user.id, "p_timezone": timezone, "p_offset": offset},
        )
    }
