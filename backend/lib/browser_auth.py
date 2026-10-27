"""Browser-bound PKCE state shared by Google and verified email signup."""

import base64
import hashlib
import json
import os
import secrets
import time
from urllib.parse import urlsplit
from fastapi import HTTPException

DESTINATIONS = {
    "account": "/account",
    "pro": "/account?plan=pro",
    "lifetime": "/account?offer=lifetime",
    "editor": "/account?next=%2Feditor",
}


def app_origin():
    value = os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app").rstrip("/")
    try:
        p = urlsplit(value)
        valid = (
            p.scheme == "https"
            and p.hostname
            and not (p.username or p.password or p.path or p.query or p.fragment)
        )
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(503, "authentication_unavailable")
    return value


def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def issue_flow(response, cookie, intent, ttl):
    nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    state = {
        "nonce": nonce,
        "verifier": verifier,
        "intent": intent,
        "issued": int(time.time()),
    }
    response.set_cookie(
        cookie,
        base64.urlsafe_b64encode(
            json.dumps(state, separators=(",", ":")).encode()
        ).decode(),
        max_age=ttl,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    return nonce, challenge


def read_flow(request, cookie, ttl, *, nonce=None):
    """Email returns to Site URL; its code is bound by the secret verifier.

    Google additionally returns a nonce in its allowlisted callback URL.
    """
    raw = request.cookies.get(cookie, "")
    if not raw or len(raw) > 2048:
        raise ValueError("missing_state")
    saved = json.loads(base64.urlsafe_b64decode(raw.encode()))
    if not isinstance(saved, dict):
        raise ValueError("invalid_state")
    issued = saved.get("issued")
    if (
        not isinstance(issued, int)
        or issued > time.time() + 30
        or issued < time.time() - ttl
    ):
        raise ValueError("expired_state")
    if (
        saved.get("intent") not in DESTINATIONS
        or not isinstance(saved.get("nonce"), str)
        or not 32 <= len(saved["nonce"]) <= 128
    ):
        raise ValueError("invalid_state")
    if nonce is not None and not secrets.compare_digest(saved["nonce"], nonce):
        raise ValueError("nonce_mismatch")
    verifier = saved.get("verifier", "")
    if not isinstance(verifier, str) or not 43 <= len(verifier) <= 128:
        raise ValueError("invalid_verifier")
    return saved


def clear_flow(response, cookie):
    response.delete_cookie(cookie, path="/", secure=True, httponly=True, samesite="lax")


async def verified_code_session(auth_request, code, verifier):
    session = await auth_request(
        "POST",
        "token?grant_type=pkce",
        json={"auth_code": code, "code_verifier": verifier},
    )
    if not isinstance(session, dict) or not all(
        isinstance(session.get(k), str) and session[k]
        for k in ("access_token", "refresh_token")
    ):
        raise ValueError("invalid_session")
    identity = await auth_request("GET", "user", access_token=session["access_token"])
    if (
        not isinstance(identity, dict)
        or not isinstance(session.get("user"), dict)
        or not identity.get("id")
        or identity["id"] != session["user"].get("id")
    ):
        raise ValueError("identity_mismatch")
    return session, identity
