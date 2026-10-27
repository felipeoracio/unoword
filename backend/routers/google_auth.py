"""Supabase-hosted Google OAuth with backend-only PKCE and browser-bound state."""

import time
from typing import Literal
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict

from lib.request_security import trusted_origin, limit_sensitive
from lib.supabase_config import get_supabase_config
from lib.supabase_client import auth_request, SupabaseAPIError
from routers.auth import GOOGLE_OAUTH_COOKIE, _set_session_cookies
from lib.browser_auth import (
    DESTINATIONS,
    app_origin,
    private,
    issue_flow,
    read_flow,
    clear_flow,
    verified_code_session,
)

router = APIRouter(prefix="/auth/google", tags=["auth"])
TTL = 600
_settings_cache = (0.0, False)


def provider_origin():
    p = urlsplit(get_supabase_config().url)
    if (
        p.scheme != "https"
        or not p.hostname
        or p.username
        or p.password
        or p.path not in {"", "/"}
        or p.query
        or p.fragment
    ):
        raise HTTPException(503, "google_oauth_unavailable")
    return p.geturl().rstrip("/")


async def enabled():
    global _settings_cache
    if _settings_cache[0] > time.monotonic():
        return _settings_cache[1]
    try:
        provider_origin()
        data = await auth_request("GET", "settings")
        value = data.get("external", {}).get("google") is True
    except (SupabaseAPIError, HTTPException, TypeError, AttributeError):
        value = False
    _settings_cache = (time.monotonic() + 30, value)
    return value


class Start(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent: Literal["account", "pro", "lifetime", "editor"] = "account"


@router.get("")
async def configuration(response: Response):
    private(response)
    return {"enabled": await enabled()}


@router.post("/start", dependencies=[Depends(trusted_origin)])
async def start(payload: Start, request: Request, response: Response):
    limit_sensitive(
        "google-start:" + (request.client.host if request.client else "unknown"),
        maximum=20,
        seconds=60,
    )
    if not await enabled():
        raise HTTPException(503, "google_oauth_not_configured")
    nonce, challenge = issue_flow(response, GOOGLE_OAUTH_COOKIE, payload.intent, TTL)
    callback = app_origin() + "/api/auth/google/callback?" + urlencode({"flow": nonce})
    url = (
        provider_origin()
        + "/auth/v1/authorize?"
        + urlencode(
            {
                "provider": "google",
                "redirect_to": callback,
                "code_challenge": challenge,
                "code_challenge_method": "s256",
                "scopes": "openid email profile",
                "prompt": "select_account",
            }
        )
    )
    private(response)
    return {"url": url}


def finish(intent, outcome):
    path = DESTINATIONS.get(intent, DESTINATIONS["account"])
    if intent == "editor":
        path = "/account?next=%2Feditor"
    location = (
        app_origin()
        + path
        + ("&" if "?" in path else "?")
        + urlencode({"oauth": outcome})
    )
    result = private(RedirectResponse(location, status_code=303))
    clear_flow(result, GOOGLE_OAUTH_COOKIE)
    return result


@router.get("/callback")
async def callback(request: Request):
    intent = "account"
    try:
        saved = read_flow(
            request,
            GOOGLE_OAUTH_COOKIE,
            TTL,
            nonce=request.query_params.get("flow", ""),
        )
        verifier = saved["verifier"]
        intent = saved["intent"]
    except (ValueError, TypeError, KeyError):
        return finish("account", "expired")
    if request.query_params.get("error"):
        # Never reflect a provider error description or authorization code.
        return finish(intent, "canceled")
    code = request.query_params.get("code", "")
    if not code or len(code) > 4096:
        return finish(intent, "failed")
    try:
        session, _identity = await verified_code_session(auth_request, code, verifier)
        result = finish(intent, "success")
        _set_session_cookies(result, session)
        return result
    except (SupabaseAPIError, ValueError, TypeError):
        return finish(intent, "failed")
