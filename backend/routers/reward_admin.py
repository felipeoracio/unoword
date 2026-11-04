"""Definition management and aggregate counts, without private writing details."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from lib.admin_auth import require_admin
from lib.request_security import trusted_origin
from lib.supabase_client import SupabaseAPIError, service_rest
from lib.writing_image import image_attributes

router = APIRouter(
    prefix="/admin/achievements", tags=["admin-achievements"], dependencies=[Depends(require_admin)],
)


async def rest(method, path, **kwargs):
    try:
        return await service_rest(method, path, **kwargs)
    except SupabaseAPIError as error:
        raise HTTPException(503, "rewards_setup_required") from error


@router.get("")
async def definitions(response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await rest("POST", "rpc/writing_reward_admin_catalog", json={})


class Definition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    name_es: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, min_length=1, max_length=500)
    description_es: str | None = Field(default=None, min_length=1, max_length=500)
    threshold: int | None = Field(default=None, ge=1, le=1000000000000)
    active: bool | None = None
    badge_image: str | None = Field(default=None, max_length=270000)

    @field_validator("badge_image")
    @classmethod
    def raster_only(cls, value):
        if value is not None:
            image_attributes({"src": value, "alt": ""})
        return value


@router.patch("/{achievement_id}", dependencies=[Depends(trusted_origin)])
async def update(achievement_id: str, payload: Definition, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    patch = payload.model_dump(exclude={"revision"}, exclude_unset=True)
    if any(value is None for key, value in patch.items() if key != "badge_image"):
        raise HTTPException(422, "invalid_definition")
    result = await rest("POST", "rpc/writing_reward_admin_update", json={
        "p_id": achievement_id, "p_revision": payload.revision, "p_patch": patch,
    })
    if not result:
        raise HTTPException(409, "achievement_definition_changed")
    return result


class Backfill(BaseModel):
    model_config = ConfigDict(extra="forbid")
    after: UUID | None = None


@router.post("/backfill", dependencies=[Depends(trusted_origin)])
async def backfill(payload: Backfill, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await rest("POST", "rpc/writing_reward_backfill", json={
        "p_after": str(payload.after) if payload.after else None, "p_limit": 25,
    })
