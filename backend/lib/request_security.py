"""Browser origin checks and a bounded burst limiter, in addition to GoTrue limits."""

import os
import time
import re
from collections import OrderedDict
from urllib.parse import urlsplit
from fastapi import HTTPException, Request
from starlette.responses import JSONResponse

_bursts = OrderedDict()


def web_origins():
    """Explicit origins only. Legacy wildcard settings cannot enable credentials."""
    candidates = [os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")]
    for setting in ("AUTH_ALLOWED_ORIGINS", "CORS_ORIGINS"):
        candidates.extend(os.getenv(setting, "").split(","))
    allowed = set()
    for candidate in candidates:
        candidate = candidate.strip().rstrip("/")
        try:
            p = urlsplit(candidate)
            if (
                p.scheme in {"http", "https"}
                and p.hostname
                and not (p.username or p.password or p.path or p.query or p.fragment)
            ):
                allowed.add(candidate)
        except ValueError:
            pass
    return sorted(allowed)


def extension_origin_pattern():
    configured = os.getenv("AUTH_ALLOWED_EXTENSION_IDS", "").strip()
    if not configured:
        # Unpacked extensions have installation-specific IDs. A verified store
        # release can narrow this to its stable ID without breaking local setups.
        ids = "[a-p]{32}"
    else:
        ids = "|".join(
            re.escape(value.strip())
            for value in configured.split(",")
            if re.fullmatch("[a-p]{32}", value.strip())
        )
        if not ids:
            return r"(?!)"
        ids = "(?:" + ids + ")"
    return r"chrome-extension://" + ids


def allowed_origin(origin):
    return origin in web_origins() or bool(
        re.fullmatch(extension_origin_pattern(), origin)
    )


def trusted_origin(request: Request):
    origin = request.headers.get("origin", "")
    if allowed_origin(origin):
        return
    # Privileged extension workers can omit Origin on host-permission requests.
    # A web page cannot send this non-simple header without a CORS preflight;
    # an explicitly untrusted/null Origin is always rejected, even with a marker.
    extension_id = request.headers.get("x-uno-extension-id", "")
    if not origin and re.fullmatch(
        extension_origin_pattern(), "chrome-extension://" + extension_id
    ):
        return
    # Non-browser clients explicitly using bearer authentication are not subject
    # to cookie CSRF. A browser cannot forge its Origin header.
    if not origin and request.headers.get("authorization", "").startswith("Bearer "):
        return
    raise HTTPException(403, "untrusted_origin")


class BrowserSecurityMiddleware:
    """Protect all API writes, including older cookie-authenticated routes.

    Stripe's exact webhook route relies on its own signature verification.
    OAuth/email top-level GET callbacks remain possible without Origin headers.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            request = Request(scope)
            webhook = (
                request.method == "POST"
                and request.url.path == "/api/subscription/webhook"
            )
            if not webhook and request.method != "OPTIONS":
                try:
                    origin = request.headers.get("origin")
                    if origin is not None and not allowed_origin(origin):
                        raise HTTPException(403, "untrusted_origin")
                    if request.method not in {"GET", "HEAD"}:
                        trusted_origin(request)
                except HTTPException as error:
                    result = JSONResponse(
                        {"detail": error.detail},
                        status_code=error.status_code,
                        headers={"Cache-Control": "private, no-store"},
                    )
                    return await result(scope, receive, send)
        return await self.app(scope, receive, send)


def limit_sensitive(key: str, maximum: int = 5, seconds: int = 300):
    now = time.monotonic()
    entries = [at for at in _bursts.pop(key, []) if now - at < seconds]
    if len(entries) >= maximum:
        _bursts[key] = entries
        raise HTTPException(
            429, "security_rate_limited", headers={"Retry-After": str(seconds)}
        )
    _bursts[key] = entries + [now]
    while len(_bursts) > 4096:
        _bursts.popitem(last=False)
