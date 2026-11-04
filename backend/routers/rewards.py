"""Private personal rewards over the existing, trusted writing activity ledger."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from lib.ai_access import entitlement_is_active, get_entitlement
from lib.auth import AuthenticatedUser, require_user
from lib.request_security import trusted_origin
from lib.supabase_client import SupabaseAPIError, service_rest

router = APIRouter(prefix="/rewards", tags=["writing-rewards"])


async def rpc(name, body):
    try:
        return await service_rest("POST", "rpc/" + name, json=body)
    except SupabaseAPIError as error:
        if "invalid_showcase" in error.detail:
            raise HTTPException(422, "invalid_showcase") from error
        raise HTTPException(503, "rewards_setup_required") from error


async def access(user):
    return entitlement_is_active(await get_entitlement(user.id))


async def summary(user, paid, language):
    return await rpc("writing_rewards", {
        "p_user": user.id, "p_paid": paid, "p_language": language,
    })


@router.get("")
async def rewards(
    response: Response,
    language: str = "auto",
    user: AuthenticatedUser = Depends(require_user),
):
    response.headers["Cache-Control"] = "private, no-store"
    return await summary(user, await access(user), language if language in {"en", "es"} else "auto")


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_user_id: UUID
    revision: int = Field(ge=0)
    enabled: bool | None = None
    celebrations: bool | None = None
    widget: bool | None = None
    showcase: list[str] | None = Field(default=None, max_length=3)


@router.put("/preferences", dependencies=[Depends(trusted_origin)])
async def preferences(
    payload: Preferences,
    response: Response,
    user: AuthenticatedUser = Depends(require_user),
):
    if str(payload.expected_user_id) != user.id:
        raise HTTPException(409, "account_changed")
    response.headers["Cache-Control"] = "private, no-store"
    patch = payload.model_dump(exclude={"expected_user_id", "revision"}, exclude_none=True)
    result = await rpc("writing_reward_settings", {
        "p_user": user.id, "p_paid": await access(user),
        "p_revision": payload.revision, "p_patch": patch,
    })
    if result.get("conflict"):
        raise HTTPException(409, "rewards_preferences_changed")
    return result


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_user_id: UUID


@router.post("/celebrations/claim", dependencies=[Depends(trusted_origin)])
async def claim(
    payload: Claim,
    response: Response,
    user: AuthenticatedUser = Depends(require_user),
):
    if str(payload.expected_user_id) != user.id:
        raise HTTPException(409, "account_changed")
    response.headers["Cache-Control"] = "private, no-store"
    paid = await access(user)
    # Reconcile checkpoints first; an active writer still cannot be claimed.
    await summary(user, paid, "en")
    return {"achievement_id": await rpc("writing_reward_claim", {"p_user": user.id, "p_paid": paid})}
