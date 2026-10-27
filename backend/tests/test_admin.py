"""Admin dashboard auth + authorization tests (live backend on :8001)."""
import os
import httpx
import pytest

pytestmark = pytest.mark.skipif(os.getenv("UNOWORD_RUN_LIVE_TESTS") != "1", reason="Live account tests require explicit opt-in and private credentials")


BASE = "http://localhost:8001/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "felipe.oracio.gonzalez@gmail.com")
ADMIN_PW = os.environ.get("ADMIN_INITIAL_PASSWORD", "***ADMIN_PW_REDACTED***")


def _login(email, password):
    return httpx.post(f"{BASE}/admin/login", json={"email": email, "password": password}, headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")}, timeout=30)


def test_admin_login_success_sets_cookie():
    r = _login(ADMIN_EMAIL, ADMIN_PW)
    assert r.status_code == 200, r.text
    assert r.json().get("authenticated") is True
    assert "uno_admin" in r.headers.get("set-cookie", "")


def test_invalid_credentials_rejected():
    assert _login(ADMIN_EMAIL, "definitely-wrong-pw").status_code == 401


def test_unauthenticated_endpoints_rejected():
    for path in ("/admin/overview", "/admin/users", "/admin/feedback", "/admin/audit-log", "/admin/me"):
        assert httpx.get(f"{BASE}{path}", timeout=30).status_code == 401, path


def test_ordinary_user_token_cannot_access_admin():
    # An end-user Supabase token must not authorize admin endpoints.
    login = httpx.post(f"{BASE}/auth/login", headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")},
                       json={"email": "unoword.e2e.a@example.com", "password": os.environ.get("UNOWORD_TEST_USER_A_PASSWORD", "")}, timeout=30)
    if login.status_code != 200:
        pytest.skip("seeded user unavailable")
    cookie = login.headers.get("set-cookie", "")
    token = ""
    for part in cookie.split(","):
        if "uno_session=" in part:
            token = part.split("uno_session=")[1].split(";")[0]
    r = httpx.get(f"{BASE}/admin/overview", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 401


def test_overview_returns_real_metrics_with_session():
    token = ""
    r = _login(ADMIN_EMAIL, ADMIN_PW)
    for part in r.headers.get("set-cookie", "").split(","):
        if "uno_admin=" in part:
            token = part.split("uno_admin=")[1].split(";")[0]
    ov = httpx.get(f"{BASE}/admin/overview", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert ov.status_code == 200
    cards = ov.json()["cards"]
    assert cards["total_users"] >= 1
    assert cards["revenue"] is None  # unavailable, clearly labeled
    assert cards["free_users"] + cards["paid_users"] == cards["total_users"]
