"""Admin extra tests: lockout, logout, feedback, audit-log, secret leakage."""
import os
import time
import re
import pathlib
import httpx
import pytest

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "felipe.oracio.gonzalez@gmail.com")
ADMIN_PW = os.environ.get("ADMIN_INITIAL_PASSWORD", "***ADMIN_PW_REDACTED***")


def _admin_token():
    r = httpx.post(f"{BASE}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=30)
    assert r.status_code == 200, r.text
    for part in r.headers.get("set-cookie", "").split(","):
        if "uno_admin=" in part:
            return part.split("uno_admin=")[1].split(";")[0]
    pytest.fail("uno_admin cookie not set")


# ---- Lockout / rate limit ----
def test_lockout_after_5_failures_bogus_email():
    bogus = f"lockme-{int(time.time())}@example.com"
    last = None
    for i in range(6):
        last = httpx.post(f"{BASE}/admin/login", json={"email": bogus, "password": "wrong"}, timeout=30)
    # After 5 failed attempts, next (6th) must be 429
    assert last.status_code == 429, f"expected 429 after 5 fails, got {last.status_code}: {last.text}"


# ---- Logout ----
def test_logout_then_me_unauthorized():
    token = _admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    me = httpx.get(f"{BASE}/admin/me", headers=headers, timeout=30)
    assert me.status_code == 200
    out = httpx.post(f"{BASE}/admin/logout", headers=headers, timeout=30)
    assert out.status_code in (200, 204)
    # Without any auth, /me must be 401
    assert httpx.get(f"{BASE}/admin/me", timeout=30).status_code == 401


# ---- Feedback: present, no writing content leak ----
FORBIDDEN_FIELDS = {"content", "writing_content", "session_content", "ai_writing_sessions"}


def test_feedback_endpoint_no_writing_content():
    token = _admin_token()
    r = httpx.get(f"{BASE}/admin/feedback", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200
    data = r.json()
    # Walk payload keys and ensure no forbidden user-content fields present
    items = data.get("items") if isinstance(data, dict) else data
    if items:
        for row in items[:20]:
            keys = set(row.keys()) if isinstance(row, dict) else set()
            leaks = keys & FORBIDDEN_FIELDS
            assert not leaks, f"feedback leaks writing content fields: {leaks}"


# ---- Audit log works ----
def test_audit_log_accessible():
    token = _admin_token()
    r = httpx.get(f"{BASE}/admin/audit-log", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200
    data = r.json()
    # Should be a dict with items or a list
    assert isinstance(data, (dict, list))


# ---- Users endpoint with search/filter/pagination parameters ----
def test_users_endpoint_supports_search_and_filter():
    token = _admin_token()
    r = httpx.get(
        f"{BASE}/admin/users",
        params={"q": "unoword", "plan": "all", "page": 1, "page_size": 10},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict) or isinstance(data, list)


# ---- Secrets not exposed in built frontend bundle ----
SECRETS_TO_CHECK = [
    v for v in (
        os.environ.get("ADMIN_INITIAL_PASSWORD"),
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    )
    if v
]


def test_secrets_not_in_frontend_bundle():
    if not SECRETS_TO_CHECK:
        pytest.skip("no runtime secrets configured to scan for")
    dist = pathlib.Path("/app/frontend/dist")
    if not dist.exists():
        pytest.skip("frontend/dist not built")
    files = list(dist.rglob("*"))
    text_files = [p for p in files if p.is_file() and p.suffix in {".js", ".html", ".css", ".map", ".txt", ".json"}]
    leaks = []
    for p in text_files:
        try:
            content = p.read_text(errors="ignore")
        except Exception:
            continue
        for s in SECRETS_TO_CHECK:
            if s in content:
                leaks.append(str(p))
    assert not leaks, f"secrets found in bundle: {leaks}"
