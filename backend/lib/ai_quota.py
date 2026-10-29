"""Versioned, atomic allowances shared by the editor and Chrome extension."""

import asyncio
import hashlib
import json
import logging
import os
from contextvars import ContextVar
from uuid import uuid4
from fastapi import HTTPException
from lib.supabase_client import service_rest, SupabaseAPIError

logger = logging.getLogger(__name__)
active_request: ContextVar = ContextVar("uno_ai_request", default=None)


def resolve_daily_limit(entitlement: dict) -> int:
    """Compatibility only. Versioned SQL allowances govern production requests."""
    try:
        caps = [
            int(os.getenv("AI_DAILY_REQUEST_LIMIT", "0") or 0),
            int(entitlement.get("daily_request_limit") or 0),
        ]
    except (ValueError, TypeError):
        raise HTTPException(503, "ai_limit_not_configured") from None
    if any(cap < 0 for cap in caps):
        raise HTTPException(503, "ai_limit_not_configured")
    return min((cap for cap in caps if cap > 0), default=0)


async def rpc(name, body):
    try:
        return await service_rest("POST", "rpc/" + name, json=body)
    except SupabaseAPIError as error:
        raise HTTPException(503, "ai_usage_unavailable") from error


class AIRequest:
    def __init__(
        self,
        user_id,
        daily_limit=None,
        request_type="suggestion",
        *,
        payload=None,
        feature=None
    ):
        self.user_id = user_id
        self.request_type = request_type
        self.feature = feature or "suggestion"
        data = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else {}
        self.id = str(data.pop("request_id", None) or uuid4())
        self.fingerprint = hashlib.sha256(
            json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        self.timezone = (data.get("writing_progress") or {}).get("timezone")
        self.lease = str(uuid4())
        self.completed = False
        self.replay = None
        self.model = None
        self.provider_recorded = False
        self.failure_status = "released"

    async def __aenter__(self):
        result = await rpc(
            "ai_coach_reserve",
            {
                "p_user": self.user_id,
                "p_request": self.id,
                "p_feature": self.feature,
                "p_fingerprint": self.fingerprint,
                "p_timezone": self.timezone,
                "p_lease": self.lease,
            },
        )
        status = result.get("status")
        if status == "replay":
            self.replay = result["response"]
            self.completed = True
        elif status == "limited":
            raise HTTPException(429, "ai_limit_" + result.get("reason", "reached"))
        elif status == "forbidden":
            raise HTTPException(403, "An eligible UnoWord AI plan is required")
        elif status in {"pending", "conflict", "expired"}:
            raise HTTPException(409, "ai_request_" + status)
        elif status != "reserved":
            raise HTTPException(503, "ai_usage_unavailable")
        self.deadline = asyncio.timeout(120)
        await self.deadline.__aenter__()
        self.context = active_request.set(self)
        return self

    async def record_provider(self, model, usage=None, status="succeeded"):
        """Record actual model calls, including those later rejected by policy."""
        self.model = model
        self.provider_recorded = True
        details = getattr(usage, "prompt_tokens_details", None)
        try:
            await rpc(
                "ai_coach_cost",
                {
                    "p_user": self.user_id,
                    "p_request": self.id,
                    "p_feature": self.feature,
                    "p_model": model,
                    "p_input": getattr(
                        usage, "prompt_tokens", getattr(usage, "input_tokens", None)
                    ),
                    "p_cached": getattr(details, "cached_tokens", None),
                    "p_output": getattr(
                        usage,
                        "completion_tokens",
                        getattr(usage, "output_tokens", None),
                    ),
                    "p_status": status,
                },
            )
        except HTTPException:
            # Telemetry availability cannot consume or change subscriber credits.
            logger.warning("ai_cost_record_failed request=%s", self.id)

    async def complete(
        self,
        input_tokens=None,
        output_tokens=None,
        *,
        model=None,
        response=None,
        suggestions=None
    ):
        if not self.provider_recorded:
            from types import SimpleNamespace

            await self.record_provider(
                model or self.model,
                SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
            )
        completed = await rpc(
            "ai_coach_complete",
            {
                "p_user": self.user_id,
                "p_request": self.id,
                "p_model": model or self.model,
                "p_input": input_tokens,
                "p_cached": None,
                "p_output": output_tokens,
                "p_response": response or {},
                "p_suggestions": suggestions or [],
                "p_lease": self.lease,
            },
        )
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
            active_request.reset(self.context)
            if not self.completed:
                try:
                    if self.provider_recorded:
                        await rpc(
                            "ai_coach_mark_request",
                            {
                                "p_user": self.user_id,
                                "p_request": self.id,
                                "p_status": "failed" if exc_type else "fallback",
                            },
                        )
                except HTTPException:
                    logger.warning("ai_cost_status_failed request=%s", self.id)
                try:
                    await rpc(
                        "ai_coach_release",
                        {
                            "p_user": self.user_id,
                            "p_request": self.id,
                            "p_lease": self.lease,
                        },
                    )
                except HTTPException:
                    logger.warning("ai_quota_release_failed request=%s", self.id)


async def record_provider_call(model, usage=None, status="succeeded"):
    request = active_request.get()
    if request is not None:
        await request.record_provider(model, usage, status)


async def usage_counts(user_id, timezone=None):
    return await rpc("ai_coach_state", {"p_user": user_id, "p_timezone": timezone})


async def public_allowance():
    value = await rpc("ai_public_allowance", {})
    if not value:
        raise HTTPException(503, "ai_allowance_not_configured")
    return value


from contextlib import asynccontextmanager


@asynccontextmanager
async def model_cost_scope(user_id, feature, request_id=None):
    """Attribute internal indexing/model work without using a subscriber credit."""
    existing = active_request.get()
    if existing is not None:
        yield
        return
    scope = AIRequest(user_id, feature=feature)
    scope.id = str(request_id or uuid4())
    token = active_request.set(scope)
    try:
        yield
    finally:
        active_request.reset(token)
