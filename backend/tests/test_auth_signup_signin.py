"""Isolated verified signup tests; no real accounts, credentials or email delivery."""

import base64
import hashlib
import json
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
import pytest
from fastapi.testclient import TestClient
from server import app
from routers import auth, email_signup
from lib.request_security import _bursts
from lib.supabase_client import SupabaseAPIError

OWNER = "00000000-0000-4000-8000-000000000001"
ORIGIN = {"Origin": "https://unoword.vercel.app"}
CREDS = {"email": "writer@example.com", "password": "fixture-password-not-an-account"}


@pytest.fixture
def system(monkeypatch):
    _bursts.clear()
    monkeypatch.setenv("PUBLIC_APP_URL", "https://unoword.vercel.app")
    state = {
        "autoconfirm": False,
        "confirmed": True,
        "duplicate": False,
        "code_used": False,
        "unexpected_session": False,
    }
    calls = []
    identity = {
        "id": OWNER,
        "email": CREDS["email"],
        "email_confirmed_at": "2026-10-27T00:00:00Z",
    }
    session = {
        "access_token": "fixture-access-secret",
        "refresh_token": "fixture-refresh-secret",
        "user": identity,
        "expires_in": 3600,
    }

    async def provider(method, path, **kw):
        calls.append((method, path, kw))
        assert "admin" not in path and not kw.get(
            "service"
        ), "User signup must never use the admin API"
        if path == "settings":
            return {"mailer_autoconfirm": state["autoconfirm"]}
        if path.startswith("signup?"):
            if state["duplicate"]:
                raise SupabaseAPIError(422, "User already registered")
            state["challenge"] = kw["json"]["code_challenge"]
            return (
                session
                if state["unexpected_session"]
                else {"id": OWNER, "email": CREDS["email"]}
            )
        if path == "token?grant_type=password":
            if not state["confirmed"]:
                raise SupabaseAPIError(400, "Email not confirmed")
            if kw["json"]["password"] != CREDS["password"]:
                raise SupabaseAPIError(400, "Invalid login credentials")
            return session
        if path == "token?grant_type=pkce":
            challenge = (
                base64.urlsafe_b64encode(
                    hashlib.sha256(kw["json"]["code_verifier"].encode()).digest()
                )
                .decode()
                .rstrip("=")
            )
            if (
                state["code_used"]
                or kw["json"]["auth_code"] != "one-use-fixture-code"
                or challenge != state.get("challenge")
            ):
                raise SupabaseAPIError(400, "Invalid code or verifier")
            state["code_used"] = True
            return session
        if path == "user":
            return {
                **identity,
                "email_confirmed_at": (
                    identity["email_confirmed_at"] if state["confirmed"] else None
                ),
            }
        if path == "logout":
            return None
        pytest.fail(path)

    monkeypatch.setattr(auth, "auth_request", provider)
    monkeypatch.setattr(email_signup, "auth_request", provider)
    with TestClient(app, base_url="https://unoword.vercel.app") as client:
        yield SimpleNamespace(client=client, state=state, calls=calls)
    _bursts.clear()


def signup(f, intent="account"):
    return f.client.post(
        "/api/auth/signup", json={**CREDS, "intent": intent}, headers=ORIGIN
    )


def test_signup_waits_for_email_and_never_returns_or_sets_session(system):
    r = signup(system, "lifetime")
    assert r.status_code == 201 and r.json()["authenticated"] is False
    assert (
        r.json()["user"]["id"] == "pending-confirmation"
        and r.json()["user"]["ai_access"] is False
    )
    assert "access_token" not in r.text and CREDS["password"] not in r.text
    assert "uno_session=" not in r.headers["set-cookie"]
    assert (
        auth.EMAIL_SIGNUP_COOKIE in r.headers["set-cookie"]
        and "HttpOnly" in r.headers["set-cookie"]
        and "Secure" in r.headers["set-cookie"]
    )
    sent = system.calls[1]
    assert parse_qs(urlsplit(sent[1]).query)["redirect_to"] == [
        "https://unoword.vercel.app/"
    ]
    assert set(sent[2]["json"]) == {
        "email",
        "password",
        "code_challenge",
        "code_challenge_method",
    }
    assert sent[2]["json"]["code_challenge_method"] == "s256"
    saved = json.loads(
        base64.urlsafe_b64decode(system.client.cookies.get(auth.EMAIL_SIGNUP_COOKIE))
    )
    assert saved["intent"] == "lifetime" and saved["verifier"] not in r.text


@pytest.mark.parametrize(
    "intent,path",
    [
        ("account", "/account"),
        ("pro", "/account?plan=pro"),
        ("lifetime", "/account?offer=lifetime"),
        ("editor", "/account?next=%2Feditor"),
    ],
)
def test_verified_code_uses_same_account_and_preserves_intent(system, intent, path):
    signup(system, intent)
    r = system.client.post(
        "/api/auth/signup/complete",
        json={"code": "one-use-fixture-code"},
        headers=ORIGIN,
    )
    assert r.status_code == 200 and r.json() == {"redirect": path}
    cookies = r.headers.get_list("set-cookie")
    assert any(
        "uno_session=" in c and "HttpOnly" in c and "Secure" in c for c in cookies
    )
    assert any("uno_refresh=" in c and "Path=/api/auth" in c for c in cookies)
    assert any(auth.EMAIL_SIGNUP_COOKIE in c and "Max-Age=0" in c for c in cookies)
    assert (
        r.headers["cache-control"] == "private, no-store"
        and r.headers["referrer-policy"] == "no-referrer"
    )
    assert (
        "fixture-access-secret" not in r.text and "fixture-refresh-secret" not in r.text
    )
    again = system.client.post(
        "/api/auth/signup/complete",
        json={"code": "one-use-fixture-code"},
        headers=ORIGIN,
    )
    assert again.status_code == 400 and not any(
        "uno_session=" in c for c in again.headers.get_list("set-cookie")
    )


@pytest.mark.parametrize(
    "problem",
    ["missing_cookie", "wrong_code", "unconfirmed", "changed_verifier", "expired"],
)
def test_wrong_browser_code_or_unconfirmed_identity_cannot_sign_in(system, problem):
    signup(system)
    code = "one-use-fixture-code"
    if problem == "missing_cookie":
        system.client.cookies.clear()
    if problem == "wrong_code":
        code = "foreign-auth-code"
    if problem == "unconfirmed":
        system.state["confirmed"] = False
    if problem in {"changed_verifier", "expired"}:
        saved = json.loads(
            base64.urlsafe_b64decode(
                system.client.cookies.get(auth.EMAIL_SIGNUP_COOKIE)
            )
        )
        if problem == "changed_verifier":
            saved["verifier"] = "x" * 64
        else:
            saved["issued"] = 0
        system.client.cookies.set(
            auth.EMAIL_SIGNUP_COOKIE,
            base64.urlsafe_b64encode(json.dumps(saved).encode()).decode(),
            domain="unoword.vercel.app",
            path="/",
        )
    r = system.client.post(
        "/api/auth/signup/complete", json={"code": code}, headers=ORIGIN
    )
    assert r.status_code == 400 and r.json()["detail"] == "signup_verification_failed"
    assert not any("uno_session=" in c for c in r.headers.get_list("set-cookie"))


def test_signup_and_duplicate_have_identical_generic_result_and_no_auto_login(system):
    first = signup(system).json()
    system.state["duplicate"] = True
    _bursts.clear()
    second = signup(system)
    assert second.json() == first and not any(
        p == "token?grant_type=password" for _, p, _ in system.calls
    )


@pytest.mark.parametrize("problem", ["autoconfirm", "unexpected_session"])
def test_provider_must_require_ownership_confirmation(system, problem):
    system.state[problem] = True
    r = signup(system)
    assert (
        r.status_code == 503
        and r.json()["detail"] == "email_confirmation_not_configured"
    )
    assert not r.headers.get("set-cookie")


def test_existing_verified_password_login_is_preserved(system):
    r = system.client.post("/api/auth/login", json=CREDS, headers=ORIGIN)
    assert (
        r.status_code == 200
        and r.json()["authenticated"] is True
        and r.json()["user"]["id"] == OWNER
    )
    assert "uno_session=" in r.headers["set-cookie"]


def test_unverified_login_never_admin_confirms_email(system):
    system.state["confirmed"] = False
    r = system.client.post("/api/auth/login", json=CREDS, headers=ORIGIN)
    assert r.status_code == 403 and r.json()["detail"] == "email_confirmation_required"
    assert not r.headers.get("set-cookie") and len(system.calls) == 1


def test_signup_rejects_privileged_fields_and_arbitrary_redirects(system):
    for extra in [
        {"email_confirm": True},
        {"redirect_to": "https://evil.example"},
        {"intent": "https://evil.example"},
        {"user_metadata": {"plan": "pro"}},
    ]:
        r = system.client.post(
            "/api/auth/signup", json={**CREDS, **extra}, headers=ORIGIN
        )
        assert r.status_code == 422 and CREDS["password"] not in r.text
    assert system.calls == []


def test_untrusted_origin_rejected_before_signup_or_verification(system):
    for path, body in [
        ("/api/auth/signup", CREDS),
        ("/api/auth/login", CREDS),
        ("/api/auth/signup/complete", {"code": "secret"}),
    ]:
        for headers in [{}, {"Origin": "https://evil.example"}]:
            r = system.client.post(path, json=body, headers=headers)
            assert r.status_code == 403
    assert system.calls == []
