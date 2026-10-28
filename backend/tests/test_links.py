"""Website Links in Private Documents: SSRF guards, CRUD, retrieval integration,
and cross-user isolation. Hits the live backend on :8001."""

from __future__ import annotations

import os

import httpx
import pytest

pytestmark = pytest.mark.skipif(os.getenv("UNOWORD_RUN_LIVE_TESTS") != "1", reason="Live account tests require explicit opt-in and private credentials")


API_URL = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
USER_A = ("unoword.e2e.a@example.com", os.environ.get("UNOWORD_TEST_USER_A_PASSWORD", ""))
USER_B = ("unoword.e2e.b@example.com", os.environ.get("UNOWORD_TEST_USER_B_PASSWORD", ""))


def _token(creds) -> str:
    r = httpx.post(f"{API_URL}/auth/login", json={"email": creds[0], "password": creds[1]}, headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")}, timeout=30)
    r.raise_for_status()
    for part in r.headers.get("set-cookie", "").split(","):
        if "uno_session=" in part:
            return part.split("uno_session=")[1].split(";")[0]
    raise AssertionError("login did not set uno_session")


def _client(creds) -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=60.0,
                        headers={"Authorization": f"Bearer {_token(creds)}"})


@pytest.mark.parametrize("url", [
    "http://localhost:8001/api/ai/status",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.0.1/",
    "http://10.0.0.5/",
    "file:///etc/passwd",
    "ftp://example.com/x",
])
def test_ssrf_and_scheme_blocked(url):
    with _client(USER_A) as c:
        r = c.post("/links", json={"url": url})
        assert r.status_code == 400, f"{url} -> {r.status_code} {r.text}"


def test_requires_auth():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        assert c.get("/links").status_code == 401
        assert c.post("/links", json={"url": "https://example.com"}).status_code == 401


def test_add_list_toggle_refresh_delete_and_isolation():
    a = _client(USER_A)
    b = _client(USER_B)
    link_id = None
    try:
        r = a.post("/links", json={"url": "https://example.com/", "category": "research"})
        assert r.status_code == 201, r.text
        link = r.json()
        link_id = link["id"]
        assert link["source_kind"] == "link"
        assert link["enabled"] is True
        assert link["processing_status"] in {"pending", "processing", "ready", "failed"}

        # appears in /links but NOT in the uploaded-files list
        listed = a.get("/links").json()
        assert any(x["id"] == link_id for x in listed)
        files = a.get("/documents").json()
        assert all(x["id"] != link_id for x in files)

        # disable → enabled False
        upd = a.patch(f"/links/{link_id}", json={"enabled": False, "category": "interests"})
        assert upd.status_code == 200 and upd.json()["enabled"] is False
        assert upd.json()["category"] == "interests"

        # refresh keeps the same id (no duplicate record)
        ref = a.post(f"/links/{link_id}/refresh")
        assert ref.status_code == 200 and ref.json()["id"] == link_id

        # cross-user: B cannot see, patch, refresh or delete A's link
        assert all(x["id"] != link_id for x in b.get("/links").json())
        assert b.patch(f"/links/{link_id}", json={"enabled": True}).status_code == 404
        assert b.post(f"/links/{link_id}/refresh").status_code == 404
        assert b.delete(f"/links/{link_id}").status_code == 404
    finally:
        if link_id:
            a.delete(f"/links/{link_id}")
        a.close()
        b.close()


def test_duplicate_link_rejected():
    a = _client(USER_A)
    link_id = None
    try:
        r1 = a.post("/links", json={"url": "https://example.org/"})
        assert r1.status_code == 201
        link_id = r1.json()["id"]
        r2 = a.post("/links", json={"url": "https://example.org/"})
        assert r2.status_code == 409
    finally:
        if link_id:
            a.delete(f"/links/{link_id}")
        a.close()
