"""Pre-scaffolded pytest fixtures for the FastAPI backend.

Tests hit the live uvicorn process managed by supervisor (not an in-process ASGI app), so
the app under test is the same one the frontend and Playwright see. Do NOT re-create this
file — add app-specific fixtures below the marker at the bottom.
"""

import os

import httpx
import pytest
import pytest_asyncio

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API_URL = f"{BACKEND_URL}/api"


def api_url(path: str = "") -> str:
    """Absolute URL for an /api route: api_url("/status") -> http://localhost:8001/api/status."""
    return f"{API_URL}{path}"


@pytest.fixture(scope="session")
def backend_url() -> str:
    return BACKEND_URL


@pytest.fixture
def client():
    """Sync httpx client rooted at /api — the default for endpoint tests.

    Example:
        def test_status(client):
            assert client.get("/status").status_code == 200
    """
    with httpx.Client(base_url=API_URL, timeout=90.0) as c:
        yield c


@pytest_asyncio.fixture
async def aclient():
    """Async variant, for tests that also await motor/backend helpers directly."""
    async with httpx.AsyncClient(base_url=API_URL, timeout=90.0) as c:
        yield c


# --- app-specific fixtures below this line ---

@pytest.fixture
def quota_store(monkeypatch):
    """Local RPC fixture only; never touches Supabase or a paid AI provider."""
    import asyncio
    from types import SimpleNamespace
    from lib import ai_quota
    from lib.supabase_client import SupabaseAPIError

    state = SimpleNamespace(rows=[], reservations={}, calls=[], fail=None, daily=100, monthly=200, guidance=30, on_complete=None, responses={})
    lock = asyncio.Lock()

    async def rpc(method, path, *, json):
        assert method == "POST"
        state.calls.append((path, json))
        if state.fail and path.endswith(state.fail):
            raise SupabaseAPIError(503, "private database detail")
        async with lock:
            owner = json["p_user"]
            rows = [row for row in state.rows if row["user_id"] == owner]
            pending = [r for r in state.reservations.values() if r["user_id"] == owner and r["state"] == "pending"]
            used = sum(r.get("feature", "suggestion") == "suggestion" for r in rows)
            guidance = sum(r.get("feature") == "guidance" for r in rows)
            ps = sum(r["feature"] == "suggestion" for r in pending)
            pg = sum(r["feature"] == "guidance" for r in pending)
            if path == "rpc/ai_coach_state":
                from datetime import datetime, timezone, timedelta
                now = datetime.now(timezone.utc)
                return dict(date=now.date().isoformat(), version_id="version", version_name="Coach test", legacy_shared=False,
                    timezone=json.get("p_timezone") or "UTC", daily_reset_at=(now+timedelta(days=1)).isoformat(), monthly_reset_at=(now+timedelta(days=30)).isoformat(),
                    daily_limit=state.daily, used_today=used, pending_today=ps, total_today=len(rows), remaining=max(0,state.daily-used-ps),
                    suggestions_monthly_limit=state.monthly,suggestions_monthly_used=used,suggestions_monthly_remaining=max(0,state.monthly-used-ps),
                    guidance_monthly_limit=state.guidance,guidance_monthly_used=guidance,guidance_monthly_remaining=max(0,state.guidance-guidance-pg))
            request = json["p_request"]
            if path in {"rpc/ai_coach_cost", "rpc/ai_coach_mark_request"}: return None
            reservation = state.reservations.get(request)
            if path == "rpc/ai_coach_reserve":
                if reservation:
                    if reservation['user_id'] != owner or reservation['fingerprint'] != json['p_fingerprint']: return {'status':'conflict'}
                    return {'status':'replay','response':state.responses[request]} if reservation['state']=='done' else {'status':'pending'}
                feature = json['p_feature']
                reason = ('daily' if used+ps>=state.daily else 'suggestions_monthly' if used+ps>=state.monthly else None) if feature=='suggestion' else ('guidance_monthly' if guidance+pg>=state.guidance else None)
                if reason: return {'status':'limited','reason':reason}
                state.reservations[request] = dict(user_id=owner,state='pending',feature=feature,fingerprint=json['p_fingerprint'],request_type='suggestion' if feature=='suggestion' else 'workspace_assistant')
                return {'status':'reserved'}
            if not reservation or reservation["user_id"] != owner: return False
            if path == "rpc/ai_coach_complete":
                if reservation["state"] != "done":
                    if state.on_complete: await state.on_complete(json.get('p_suggestions', []))
                    state.rows.append(dict(id=request,user_id=owner,feature=reservation['feature'],request_type=reservation['request_type'],input_tokens=json['p_input'],output_tokens=json['p_output']))
                    reservation["state"] = "done"
                    state.responses[request] = json['p_response']
                return True
            if path == "rpc/ai_coach_release":
                if reservation["state"] == "pending": del state.reservations[request]
                return None
            raise AssertionError(path)

    monkeypatch.setattr(ai_quota, "service_rest", rpc)
    state.rpc = rpc
    monkeypatch.setenv("AI_DAILY_REQUEST_LIMIT", "0")
    return state

# Load backend/.env so tests use the same configuration as the running server
# (e.g. the rotated ADMIN_INITIAL_PASSWORD) instead of any hard-coded default.
from dotenv import load_dotenv as _load_dotenv

_load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


USER_A_EMAIL = "unoword.e2e.a@example.com"
USER_A_PASSWORD = os.environ.get("UNOWORD_TEST_USER_A_PASSWORD", "")
USER_B_EMAIL = "unoword.e2e.b@example.com"
USER_B_PASSWORD = os.environ.get("UNOWORD_TEST_USER_B_PASSWORD", "")


def _login_access_token(email: str, password: str) -> str:
    """Logs in against the live Supabase-auth-backed API and returns the bearer
    access token straight from the login response's httpOnly cookie -- the
    `require_user` dependency accepts the same token via `Authorization: Bearer`.
    """
    if os.getenv("UNOWORD_RUN_LIVE_TESTS") != "1" or not password:
        pytest.skip("Live QA tests require opt-in and private QA credential settings")
    with httpx.Client(base_url=API_URL, timeout=90.0, headers={"Origin": os.getenv("PUBLIC_APP_URL", "https://unoword.vercel.app")}) as c:
        response = c.post("/auth/login", json={"email": email, "password": password})
        response.raise_for_status()
        token = response.cookies.get("uno_session")
        assert token, "login did not set uno_session cookie"
        return token


@pytest.fixture(scope="session")
def user_a_token() -> str:
    return _login_access_token(USER_A_EMAIL, USER_A_PASSWORD)


@pytest.fixture(scope="session")
def user_b_token() -> str:
    return _login_access_token(USER_B_EMAIL, USER_B_PASSWORD)


@pytest.fixture
def client_a(user_a_token):
    with httpx.Client(
        base_url=API_URL, timeout=90.0, headers={"Authorization": f"Bearer {user_a_token}"}
    ) as c:
        yield c


@pytest.fixture
def client_b(user_b_token):
    with httpx.Client(
        base_url=API_URL, timeout=90.0, headers={"Authorization": f"Bearer {user_b_token}"}
    ) as c:
        yield c
