"""Centralized server-side OpenAI configuration.

Single source of truth for the OpenAI API key and models used by every AI
feature (personalized suggestions + embeddings / RAG retrieval). The key
resolves from the admin-configured value stored ENCRYPTED in
``public.app_settings``, falling back to the ``OPENAI_API_KEY`` environment
variable. The raw key never leaves the server process and is never returned to
any client. Changing the key via the admin API takes effect for subsequent AI
requests without a redeploy (providers rebuild when the resolved key changes).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg2
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

_KEY_SETTING = "openai_api_key"
_HINT_SETTING = "openai_key_hint"
_SET_AT_SETTING = "openai_key_set_at"
_TEST_AT_SETTING = "openai_last_test_at"
_TEST_OK_SETTING = "openai_last_test_ok"
_SOURCE_DB = "database"
_SOURCE_ENV = "environment"

_CACHE_TTL = 5.0
_cache: dict = {"key": None, "source": None, "ts": 0.0}


@contextmanager
def _db():
    conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"], connect_timeout=15)
    try:
        conn.set_session(readonly=False, autocommit=True)
        yield conn
    finally:
        conn.close()


def _fernet() -> Fernet:
    raw = os.environ.get("SETTINGS_ENC_KEY", "").strip()
    if raw:
        try:
            return Fernet(raw.encode())
        except Exception:
            material = raw
    else:
        material = (
            os.environ.get("ADMIN_JWT_SECRET")
            or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or "uno-word-settings-dev"
        )
    derived = base64.urlsafe_b64encode(hashlib.sha256(material.encode()).digest())
    return Fernet(derived)


def _get(key: str) -> str | None:
    with _db() as conn, conn.cursor() as cur:
        cur.execute("select value from public.app_settings where key=%s", (key,))
        row = cur.fetchone()
    return row[0] if row else None


def _set(key: str, value: str) -> None:
    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into public.app_settings (key, value, updated_at) values (%s,%s,now()) "
            "on conflict (key) do update set value=excluded.value, updated_at=now()",
            (key, value),
        )


def _del(key: str) -> None:
    with _db() as conn, conn.cursor() as cur:
        cur.execute("delete from public.app_settings where key=%s", (key,))


def invalidate() -> None:
    """Force the next resolve to re-read from the database."""
    _cache["ts"] = 0.0


def get_chat_model() -> str:
    return os.environ.get("OPENAI_CHAT_MODEL") or os.environ.get("AI_MODEL", "gpt-5.4-mini")


def get_embed_model() -> str:
    return os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")


def _resolve_uncached() -> tuple[str | None, str | None]:
    enc = None
    try:
        enc = _get(_KEY_SETTING)
    except Exception as exc:
        logger.warning("app_settings_read_failed err=%s", exc)
    if enc:
        try:
            return _fernet().decrypt(enc.encode()).decode(), _SOURCE_DB
        except Exception as exc:
            logger.error("openai_key_decrypt_failed err=%s", exc)
    env = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if env:
        return env, _SOURCE_ENV
    return None, None


def resolve_openai_key() -> tuple[str | None, str | None]:
    """Return ``(api_key, source)`` for server-side OpenAI calls. DB overrides env."""
    now = time.monotonic()
    if _cache["ts"] and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["key"], _cache["source"]
    key, source = _resolve_uncached()
    _cache.update({"key": key, "source": source, "ts": now})
    return key, source


def set_openai_key(raw: str) -> None:
    raw = (raw or "").strip()
    token = _fernet().encrypt(raw.encode()).decode()
    _set(_KEY_SETTING, token)
    _set(_HINT_SETTING, raw[-4:] if len(raw) >= 4 else "")
    _set(_SET_AT_SETTING, datetime.now(timezone.utc).isoformat())
    _del(_TEST_AT_SETTING)
    _del(_TEST_OK_SETTING)
    invalidate()


def remove_openai_key() -> None:
    for k in (_KEY_SETTING, _HINT_SETTING, _SET_AT_SETTING, _TEST_AT_SETTING, _TEST_OK_SETTING):
        _del(k)
    invalidate()


def record_test(ok: bool) -> str:
    ts = datetime.now(timezone.utc).isoformat()
    _set(_TEST_AT_SETTING, ts)
    _set(_TEST_OK_SETTING, "true" if ok else "false")
    return ts


def get_status() -> dict:
    """Non-sensitive status for the admin UI. Never includes the raw key."""
    key, source = resolve_openai_key()
    hint = set_at = test_at = None
    test_ok: bool | None = None
    try:
        hint = _get(_HINT_SETTING)
        set_at = _get(_SET_AT_SETTING)
        test_at = _get(_TEST_AT_SETTING)
        to = _get(_TEST_OK_SETTING)
        test_ok = (to == "true") if to is not None else None
    except Exception:
        pass
    return {
        "configured": bool(key),
        "source": source,
        "key_hint": hint,
        "key_set_at": set_at,
        "last_test_at": test_at,
        "last_test_ok": test_ok,
        "chat_model": get_chat_model(),
        "embed_model": get_embed_model(),
    }


async def test_connection() -> tuple[bool, str, str]:
    """Make a minimal, cheap real request to verify the configured key.

    Returns ``(ok, status_label, message)``. The message never contains the key.
    """
    from openai import (
        APIConnectionError,
        APITimeoutError,
        AsyncOpenAI,
        AuthenticationError,
        OpenAIError,
        RateLimitError,
    )

    key, _source = resolve_openai_key()
    if not key:
        return False, "not_configured", "No API key is configured."
    client = AsyncOpenAI(api_key=key, timeout=10.0)
    try:
        await client.embeddings.create(
            model=get_embed_model(), input="ping", encoding_format="float"
        )
        return True, "connected", "Connection successful."
    except AuthenticationError:
        return False, "invalid_key", "The API key was rejected by OpenAI."
    except RateLimitError as exc:
        msg = str(exc).lower()
        if "quota" in msg or "insufficient" in msg or "billing" in msg:
            return False, "quota", "The key is valid but has no available quota or billing."
        return False, "rate_limited", "OpenAI rate limit reached. Try again shortly."
    except (APITimeoutError, APIConnectionError):
        return False, "network", "Could not reach OpenAI. Check network connectivity."
    except OpenAIError:
        return False, "service_error", "OpenAI returned an error while verifying the key."
    finally:
        try:
            await client.close()
        except Exception:
            pass
