"""Auth cookie/refresh + Links SSRF/CRUD/isolation. Runs against the public preview URL
so Secure cookies are retained (dropped over plain http://localhost)."""

from __future__ import annotations

import os
import httpx
import pytest

pytestmark = pytest.mark.skipif(os.getenv("UNOWORD_RUN_LIVE_TESTS") != "1", reason="Live account tests require explicit opt-in and private credentials")


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://uno-word-build.preview.emergentagent.com").rstrip("/")
API_URL = f"{BASE_URL}/api"
USER_A = ("unoword.e2e.a@example.com", os.environ.get("UNOWORD_TEST_USER_A_PASSWORD", ""))
USER_B = ("unoword.e2e.b@example.com", os.environ.get("UNOWORD_TEST_USER_B_PASSWORD", ""))


def _login(creds) -> httpx.Response:
    with httpx.Client(base_url=API_URL, timeout=30.0, headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")}) as c:
        return c.post("/auth/login", json={"email": creds[0], "password": creds[1]})


def _token_from_cookies(resp: httpx.Response) -> str:
    # cookies attr already parsed by httpx
    tok = resp.cookies.get("uno_session")
    assert tok, f"uno_session cookie not set. Headers: {resp.headers.get('set-cookie')}"
    return tok


def _refresh_from_cookies(resp: httpx.Response) -> str:
    tok = resp.cookies.get("uno_refresh")
    assert tok, f"uno_refresh cookie not set. Headers: {resp.headers.get('set-cookie')}"
    return tok


def _client(creds) -> httpx.Client:
    r = _login(creds)
    assert r.status_code == 200, r.text
    tok = _token_from_cookies(r)
    return httpx.Client(base_url=API_URL, timeout=60.0, headers={"Authorization": f"Bearer {tok}"})


# -------------------- AUTH --------------------

class TestAuth:
    def test_login_sets_both_cookies(self):
        r = _login(USER_A)
        assert r.status_code == 200, r.text
        assert r.cookies.get("uno_session"), "uno_session cookie missing"
        assert r.cookies.get("uno_refresh"), "uno_refresh cookie missing"
        body = r.json()
        assert body["authenticated"] is True

    def test_refresh_with_refresh_cookie_only_returns_new_session(self):
        r = _login(USER_A)
        refresh = _refresh_from_cookies(r)
        # Send ONLY the refresh cookie, no access token.
        with httpx.Client(base_url=API_URL, timeout=30.0, headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")}) as c:
            rr = c.post("/auth/refresh", cookies={"uno_refresh": refresh})
        assert rr.status_code == 200, rr.text
        body = rr.json()
        assert body["authenticated"] is True
        assert rr.cookies.get("uno_session"), "refresh did not set a new uno_session cookie"

    def test_refresh_without_cookie_returns_401(self):
        with httpx.Client(base_url=API_URL, timeout=30.0, headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")}) as c:
            rr = c.post("/auth/refresh")
        assert rr.status_code == 401, rr.text

    def test_me_shows_pro_and_ai_access(self):
        r = _login(USER_A)
        tok = _token_from_cookies(r)
        with httpx.Client(base_url=API_URL, timeout=30.0, headers={"Authorization": f"Bearer {tok}"}) as c:
            me = c.get("/auth/me")
        assert me.status_code == 200, me.text
        body = me.json()
        assert body["plan"] == "pro", body
        assert body["ai_access"] is True, body
        assert body["email"].lower() == USER_A[0].lower()

    def test_logout_204_and_clears_cookies(self):
        r = _login(USER_A)
        tok = _token_from_cookies(r)
        with httpx.Client(base_url=API_URL, timeout=30.0, headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")}) as c:
            lo = c.post("/auth/logout", cookies={"uno_session": tok})
        assert lo.status_code == 204, lo.text
        # delete_cookie emits Set-Cookie with Max-Age=0 / expires in past
        set_cookie = lo.headers.get("set-cookie", "")
        assert "uno_session=" in set_cookie
        assert "uno_refresh=" in set_cookie


# -------------------- LINKS SSRF --------------------

SSRF_URLS = [
    "http://localhost:8001/api/ai/status",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.0.1/",
    "http://10.0.0.5/",
    "file:///etc/passwd",
    "ftp://example.com/x",
]


@pytest.mark.parametrize("url", SSRF_URLS)
def test_links_ssrf_blocked(url):
    with _client(USER_A) as c:
        r = c.post("/links", json={"url": url})
        assert r.status_code == 400, f"{url} -> {r.status_code} {r.text}"


def test_links_requires_auth():
    with httpx.Client(base_url=API_URL, timeout=30.0, headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")}) as c:
        assert c.get("/links").status_code == 401
        assert c.post("/links", json={"url": "https://example.com"}).status_code == 401


# -------------------- LINKS CRUD + isolation --------------------

def test_links_full_flow_and_isolation():
    a = _client(USER_A)
    b = _client(USER_B)
    link_id = None
    try:
        # Create
        r = a.post("/links", json={"url": "https://example.com/", "category": "research"})
        assert r.status_code == 201, r.text
        link = r.json()
        link_id = link["id"]
        assert link["source_kind"] == "link"
        assert link["enabled"] is True
        assert link["processing_status"] in {"ready", "failed"}, link

        # Appears in /links but NOT in /documents
        listed = a.get("/links").json()
        assert any(x["id"] == link_id for x in listed)
        docs = a.get("/documents").json()
        assert all(x["id"] != link_id for x in docs)

        # Toggle disable + category
        upd = a.patch(f"/links/{link_id}", json={"enabled": False, "category": "interests"})
        assert upd.status_code == 200, upd.text
        assert upd.json()["enabled"] is False
        assert upd.json()["category"] == "interests"

        # Refresh keeps same id
        ref = a.post(f"/links/{link_id}/refresh")
        assert ref.status_code == 200, ref.text
        assert ref.json()["id"] == link_id

        # Enabled flag persists through refresh (still false)
        after = a.get("/links").json()
        same = [x for x in after if x["id"] == link_id][0]
        assert same["enabled"] is False, "disabled flag must persist (used by RAG filter)"

        # Cross-user isolation
        assert all(x["id"] != link_id for x in b.get("/links").json())
        assert b.patch(f"/links/{link_id}", json={"enabled": True}).status_code == 404
        assert b.post(f"/links/{link_id}/refresh").status_code == 404
        assert b.delete(f"/links/{link_id}").status_code == 404
    finally:
        if link_id:
            a.delete(f"/links/{link_id}")
        a.close()
        b.close()


def test_links_duplicate_rejected_with_409():
    a = _client(USER_A)
    link_id = None
    try:
        r1 = a.post("/links", json={"url": "https://example.org/"})
        assert r1.status_code == 201, r1.text
        link_id = r1.json()["id"]
        r2 = a.post("/links", json={"url": "https://example.org/"})
        assert r2.status_code == 409, r2.text
    finally:
        if link_id:
            a.delete(f"/links/{link_id}")
        a.close()


# -------------------- CLEANUP SAFETY NET --------------------

def test_zz_cleanup_any_leftover_links():
    """Catch-all: delete any lingering links on either test account."""
    for creds in (USER_A, USER_B):
        c = _client(creds)
        try:
            for link in c.get("/links").json():
                # Only this module's fixed URLs; other modules own their unique links.
                if link.get("source_url") in {"https://example.com/", "https://example.org/"}:
                    c.delete(f"/links/{link['id']}")
        finally:
            c.close()
