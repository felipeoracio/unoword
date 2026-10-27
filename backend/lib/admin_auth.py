"""Server-side admin authentication: bcrypt hashing, signed HttpOnly cookie
sessions, and in-memory brute-force lockout. Fully separate from Supabase
end-user auth. Secrets live only in env."""

from __future__ import annotations

import hashlib
import os
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request, Response, status

ADMIN_COOKIE = "uno_admin"
_ALG = "HS256"
_SESSION_HOURS = 8
MAX_FAILS = 5
LOCK_SECONDS = 15 * 60


def _secret() -> str:
    explicit = os.environ.get("ADMIN_JWT_SECRET")
    if explicit:
        return explicit
    # Stable across restarts, server-side only, never shipped to clients.
    base = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base:
        raise HTTPException(503, "Admin authentication is not configured")
    return hashlib.sha256(f"admin-session:{base}".encode()).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_token(admin_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(admin_id),
        "email": email,
        "type": "admin",
        "iat": now,
        "exp": now + timedelta(hours=_SESSION_HOURS),
    }
    return jwt.encode(payload, _secret(), algorithm=_ALG)


def decode_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, _secret(), algorithms=[_ALG])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "admin":
        return None
    return payload


def set_admin_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        ADMIN_COOKIE, token,
        httponly=True, secure=True, samesite="none",
        max_age=_SESSION_HOURS * 3600, path="/",
    )


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(ADMIN_COOKIE, path="/", secure=True, samesite="none")


# --- brute-force protection (in-memory; per process) ------------------------
_FAILS: dict[str, list] = {}  # email -> [count, lock_until_epoch]


def lock_seconds_remaining(email: str) -> int:
    rec = _FAILS.get(email)
    if rec and rec[1] and rec[1] > time.time():
        return int(rec[1] - time.time())
    return 0


def record_failure(email: str) -> None:
    rec = _FAILS.get(email, [0, 0])
    rec[0] += 1
    if rec[0] >= MAX_FAILS:
        rec[1] = time.time() + LOCK_SECONDS
        rec[0] = 0
    _FAILS[email] = rec


def clear_failures(email: str) -> None:
    _FAILS.pop(email, None)


def require_admin(request: Request) -> dict:
    token = request.cookies.get(ADMIN_COOKIE)
    if not token:
        header = request.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            token = header[7:]
    payload = decode_token(token) if token else None
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Admin authentication required")
    return payload
