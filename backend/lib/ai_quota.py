"""Shared, database-serialized AI allowance for every writing surface.

Reserve before retrieval/model work. Settle usage and reservation in one database
transaction; failed/fallback requests release their slot. Database dates are UTC.
"""

import asyncio
import logging
import os
from uuid import uuid4

from fastapi import HTTPException
from lib.supabase_client import service_rest, SupabaseAPIError

logger = logging.getLogger(__name__)


def resolve_daily_limit(entitlement: dict) -> int:
    """The stricter positive deployment or per-account cap wins; never unlimited."""
    try:
        caps = [int(os.getenv("AI_DAILY_REQUEST_LIMIT", "0") or 0),
                int(entitlement.get("daily_request_limit") or 0)]
    except (ValueError, TypeError):
        raise HTTPException(503, "ai_limit_not_configured") from None
    if any(cap < 0 for cap in caps):
        raise HTTPException(503, "ai_limit_not_configured")
    return min((cap for cap in caps if cap > 0), default=0)


class AIRequest:
    def __init__(self, user_id: str, daily_limit: int, request_type: str):
        self.user_id = user_id
        self.limit = daily_limit
        self.request_type = request_type
        self.id = str(uuid4())
        self.completed = False

    async def __aenter__(self):
        if self.limit <= 0:
            raise HTTPException(503, "ai_limit_not_configured")
        try:
            granted = await service_rest("POST", "rpc/ai_reserve_request", json={
                "p_user": self.user_id, "p_request": self.id,
                "p_limit": self.limit, "p_type": self.request_type,
            })
        except SupabaseAPIError as error:
            raise HTTPException(503, "ai_usage_unavailable") from error
        if granted is not True:
            raise HTTPException(429, "Daily AI suggestion limit reached")
        # Database reservations expire after five minutes on worker crashes. A
        # whole-request deadline stays well inside that lease, including retries.
        self.deadline = asyncio.timeout(120)
        await self.deadline.__aenter__()
        return self

    async def complete(self, input_tokens=None, output_tokens=None):
        try:
            completed = await service_rest("POST", "rpc/ai_complete_request", json={
                "p_user": self.user_id, "p_request": self.id,
                "p_input_tokens": input_tokens, "p_output_tokens": output_tokens,
            })
        except SupabaseAPIError as error:
            raise HTTPException(503, "ai_usage_unavailable") from error
        if completed is not True:
            raise HTTPException(503, "ai_usage_unavailable")
        self.completed = True

    async def __aexit__(self, exc_type, exc, tb):
        try:
            try:
                await self.deadline.__aexit__(exc_type, exc, tb)
            except TimeoutError as error:
                raise HTTPException(504, "ai_assistance_unavailable") from error
        finally:
            if not self.completed:
                try:
                    await service_rest("POST", "rpc/ai_release_request", json={
                        "p_user": self.user_id, "p_request": self.id,
                    })
                except SupabaseAPIError:
                    # A lost completion response cannot undo committed usage;
                    # release only removes pending rows. Crashed slots expire.
                    logger.warning("ai_quota_release_failed request=%s", self.id)


async def usage_counts(user_id: str) -> dict:
    try:
        return await service_rest("POST", "rpc/ai_usage_summary", json={"p_user": user_id})
    except SupabaseAPIError as error:
        raise HTTPException(503, "ai_usage_unavailable") from error
