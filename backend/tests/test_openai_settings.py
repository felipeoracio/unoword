"""Admin OpenAI API settings: authz, masked storage, real test, removal.

These hit the live uvicorn process. The test saves a BOGUS key to the DB
(which overrides env), then always removes it in teardown so the running app
falls back to the real environment key. The real OpenAI /openai-test with a
bogus key performs a genuine minimal request that fails as 'invalid_key' — this
exercises error handling without consuming credits.
"""

from __future__ import annotations

import asyncio
import os

import httpx
import pytest

from lib.supabase_client import service_rest

API_URL = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
ADMIN_PW = os.environ.get("ADMIN_INITIAL_PASSWORD", "")
BOGUS_KEY = "sk-proj-UNOWORD-TEST-BOGUS-000000000000000000000000"

pytestmark = pytest.mark.skipif(not (ADMIN_EMAIL and ADMIN_PW), reason="admin creds not configured")


def _admin_token() -> str:
    r = httpx.post(f"{API_URL}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=30)
    r.raise_for_status()
    for part in r.headers.get("set-cookie", "").split(","):
        if "uno_admin=" in part:
            return part.split("uno_admin=")[1].split(";")[0]
    raise AssertionError("admin login did not set uno_admin cookie")


def _admin_client() -> httpx.Client:
    return httpx.Client(
        base_url=API_URL, timeout=30.0,
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )


def test_openai_settings_requires_admin():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        assert c.get("/admin/openai-settings").status_code == 401
        assert c.post("/admin/openai-key", json={"api_key": BOGUS_KEY}).status_code == 401
        assert c.delete("/admin/openai-key").status_code == 401


def _snapshot_settings() -> list[dict]:
    return asyncio.run(service_rest("GET", "app_settings", params={"select": "*", "key": "like.openai_*"})) or []


def _restore_settings(rows: list[dict]) -> None:
    async def run():
        await service_rest("DELETE", "app_settings", params={"key": "like.openai_*"})
        if rows:
            await service_rest("POST", "app_settings", json=rows, prefer="return=minimal")
    asyncio.run(run())


# Temporarily swaps the live key, so it is opt-in: it would break concurrent AI tests.
@pytest.mark.skipif(os.environ.get("UNOWORD_RUN_KEY_SWAP_TEST") != "1", reason="set UNOWORD_RUN_KEY_SWAP_TEST=1")
def test_save_test_and_remove_key_never_leaks_plaintext():
    snapshot = _snapshot_settings()
    c = _admin_client()
    try:
        # save
        r = c.post("/admin/openai-key", json={"api_key": BOGUS_KEY})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["configured"] is True
        assert body["source"] == "database"
        assert body["key_hint"] == BOGUS_KEY[-4:]
        # full key must never be returned anywhere in the payload
        assert BOGUS_KEY not in r.text

        # status reflects it, still no plaintext
        s = c.get("/admin/openai-settings")
        assert s.status_code == 200
        assert s.json()["configured"] is True
        assert BOGUS_KEY not in s.text

        # real minimal connection test against the bogus key -> graceful failure
        tr = c.post("/admin/openai-test")
        assert tr.status_code == 200, tr.text
        tj = tr.json()
        assert tj["ok"] is False
        assert tj["status"] in {"invalid_key", "quota", "rate_limited", "network", "service_error"}
        assert tj["tested_at"]
        assert BOGUS_KEY not in tr.text
    finally:
        # always remove so the live app falls back to the environment key
        dr = c.delete("/admin/openai-key")
        c.close()
        assert dr.status_code == 200, dr.text

    # after removal, config resolves from environment (OPENAI_API_KEY is set in this env)
    c2 = _admin_client()
    try:
        after = c2.get("/admin/openai-settings").json()
        assert after["source"] in {"environment", None}
    finally:
        c2.close()
        _restore_settings(snapshot)


def test_save_rejects_non_openai_key():
    c = _admin_client()
    try:
        r = c.post("/admin/openai-key", json={"api_key": "not-a-real-key-123456"})
        assert r.status_code == 400
    finally:
        c.close()
