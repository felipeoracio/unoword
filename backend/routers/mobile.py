"""Public connection details for the native client; never credentials with privilege."""

import base64
import json
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Response
from lib.supabase_config import get_supabase_config

router = APIRouter(prefix="/auth", tags=["mobile"])


def is_public_key(key: str) -> bool:
    if key.startswith("sb_publishable_"):
        return True
    if key.startswith("sb_secret_"):
        return False
    try:
        parts = key.split(".")
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "===")) if len(parts) == 3 else None
        return isinstance(claims, dict) and claims.get("role") == "anon"
    except (ValueError, TypeError, UnicodeDecodeError):
        return False


@router.get("/client-config")
async def client_config(response: Response):
    config = get_supabase_config()
    try:
        parsed = urlsplit(config.url)
    except ValueError:
        raise HTTPException(503, "mobile_public_auth_not_configured") from None
    if (
        not is_public_key(config.anon_key)
        or config.anon_key == config.service_role_key
        or parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise HTTPException(503, "mobile_public_auth_not_configured")
    # These are intentionally public Supabase project identifiers. RLS and the
    # user's verified JWT, not secrecy of an anon key, protect private records.
    response.headers["Cache-Control"] = "public, max-age=300"
    return {"supabase_url": config.url, "supabase_anon_key": config.anon_key}
