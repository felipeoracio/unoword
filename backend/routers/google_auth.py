"""Supabase-hosted Google OAuth with backend-only PKCE and browser-bound state."""

import base64
import hashlib
import json
import os
import secrets
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

router = APIRouter(prefix="/auth/google", tags=["auth"])
TTL = 600
DESTINATIONS = {
    "account": "/account",
    "pro": "/account?plan=pro",
    "lifetime": "/account?offer=lifetime",
    "editor": "/editor",
}
_settings_cache = (0.0, False)


def app_origin():
    value = os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app").rstrip("/")
    p = urlsplit(value)
    if (
        p.scheme != "https"
        or not p.hostname
        or p.username
        or p.password
        or p.path
        or p.query
        or p.fragment
    ):
        raise HTTPException(503, "google_oauth_unavailable")
    return value


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


def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


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
    nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
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
    state = base64.urlsafe_b64encode(
        json.dumps(
            {
                "nonce": nonce,
                "verifier": verifier,
                "intent": payload.intent,
                "issued": int(time.time()),
            },
            separators=(",", ":"),
        ).encode()
    ).decode()
    # __Host- prevents subdomain cookie tossing. Lax permits the provider's
    # top-level GET callback; no session/access token appears in this cookie.
    response.set_cookie(
        GOOGLE_OAUTH_COOKIE,
        state,
        max_age=TTL,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
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
    result.delete_cookie(
        GOOGLE_OAUTH_COOKIE, path="/", secure=True, httponly=True, samesite="lax"
    )
    return result


@router.get("/callback")
async def callback(request: Request):
    intent = "account"
    try:
        raw = request.cookies.get(GOOGLE_OAUTH_COOKIE, "")
        if not raw or len(raw) > 2048:
            raise ValueError()
        saved = json.loads(base64.urlsafe_b64decode(raw.encode()))
        if not isinstance(saved, dict):
            raise ValueError()
        flow = request.query_params.get("flow", "")
        issued = saved.get("issued")
        if (
            not isinstance(issued, int)
            or issued > time.time() + 30
            or issued < time.time() - TTL
        ):
            raise ValueError()
        if (
            saved.get("intent") not in DESTINATIONS
            or not isinstance(saved.get("nonce"), str)
            or not 32 <= len(saved["nonce"]) <= 128
            or not secrets.compare_digest(saved["nonce"], flow)
        ):
            raise ValueError()
        verifier = saved.get("verifier", "")
        if not isinstance(verifier, str) or not 43 <= len(verifier) <= 128:
            raise ValueError()
        intent = saved["intent"]
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return finish("account", "expired")
    if request.query_params.get("error"):
        # Never reflect a provider error description or authorization code.
        return finish(intent, "canceled")
    code = request.query_params.get("code", "")
    if not code or len(code) > 4096:
        return finish(intent, "failed")
    try:
        session = await auth_request(
            "POST",
            "token?grant_type=pkce",
            json={"auth_code": code, "code_verifier": verifier},
        )
        if not isinstance(session, dict):
            raise ValueError()
        access, refresh = session.get("access_token"), session.get("refresh_token")
        if (
            not isinstance(access, str)
            or not access
            or not isinstance(refresh, str)
            or not refresh
        ):
            raise ValueError()
        identity = await auth_request("GET", "user", access_token=access)
        if not isinstance(identity, dict):
            raise ValueError()
        session_user = session.get("user")
        if (
            not isinstance(session_user, dict)
            or not identity.get("id")
            or identity.get("id") != session_user.get("id")
        ):
            raise ValueError()
        result = finish(intent, "success")
        _set_session_cookies(result, session)
        return result
    except (SupabaseAPIError, ValueError, TypeError):
        return finish(intent, "failed")
