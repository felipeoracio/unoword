"""OAuth security boundaries; no Google accounts, tokens or paid calls involved."""

import asyncio
import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlsplit
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from server import app
from routers import google_auth as google
from lib.supabase_client import SupabaseAPIError
from lib.request_security import _bursts

OWNER = "00000000-0000-4000-8000-000000000001"
ORIGIN = {"Origin": "https://unoword.vercel.app"}


@pytest.fixture
def system(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_URL", "https://unoword.vercel.app")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    calls = []
    used = False

    async def enabled():
        return True

    async def auth(method, path, **kwargs):
        nonlocal used
        calls.append((method, path, kwargs))
        if path == "token?grant_type=pkce":
            if used:
                raise SupabaseAPIError(400, "code already consumed")
            used = True
            return {
                "access_token": "oauth-access-secret",
                "refresh_token": "oauth-refresh-secret",
                "expires_in": 3600,
                "user": {"id": OWNER},
            }
        if path == "user":
            return {
                "id": OWNER,
                "email": "google@example.com",
                "identities": [{"provider": "google"}],
            }
        pytest.fail(path)

    monkeypatch.setattr(google, "enabled", enabled)
    monkeypatch.setattr(google, "auth_request", auth)
    _bursts.clear()
    with TestClient(
        app, base_url="https://unoword.vercel.app", follow_redirects=False
    ) as client:
        yield SimpleNamespace(client=client, calls=calls, monkeypatch=monkeypatch)
    _bursts.clear()


def start(f, intent="account"):
    r = f.client.post("/api/auth/google/start", json={"intent": intent}, headers=ORIGIN)
    assert r.status_code == 200
    url = r.json()["url"]
    params = parse_qs(urlsplit(url).query)
    flow = parse_qs(urlsplit(params["redirect_to"][0]).query)["flow"][0]
    cookie = f.client.cookies.get(google.GOOGLE_OAUTH_COOKIE)
    saved = json.loads(base64.urlsafe_b64decode(cookie))
    return r, params, flow, cookie, saved


@pytest.mark.parametrize(
    "intent,path",
    [
        ("account", "/account?oauth=success"),
        ("pro", "/account?plan=pro&oauth=success"),
        ("lifetime", "/account?offer=lifetime&oauth=success"),
        ("editor", "/account?next=%2Feditor&oauth=success"),
    ],
)
def test_secure_pkce_google_session_and_intent(system, intent, path):
    f = system
    r, params, flow, cookie, saved = start(f, intent)
    assert params["provider"] == ["google"] and params["code_challenge_method"] == [
        "s256"
    ]
    assert params["code_challenge"][0] == base64.urlsafe_b64encode(
        hashlib.sha256(saved["verifier"].encode()).digest()
    ).decode().rstrip("=")
    assert saved["verifier"] not in r.text
    set_cookie = r.headers["set-cookie"]
    assert (
        "HttpOnly" in set_cookie
        and "Secure" in set_cookie
        and "SameSite=lax" in set_cookie
        and "Path=/" in set_cookie
    )
    response = f.client.get(
        "/api/auth/google/callback", params={"flow": flow, "code": "one-use-auth-code"}
    )
    assert (
        response.status_code == 303
        and response.headers["location"] == "https://unoword.vercel.app" + path
    )
    assert (
        response.headers["cache-control"] == "private, no-store"
        and response.headers["referrer-policy"] == "no-referrer"
    )
    cookies = response.headers.get_list("set-cookie")
    assert any(
        "uno_session=" in c and "HttpOnly" in c and "Secure" in c for c in cookies
    )
    assert any("uno_refresh=" in c and "Path=/api/auth" in c for c in cookies)
    assert any(google.GOOGLE_OAUTH_COOKIE in c and "Max-Age=0" in c for c in cookies)
    assert (
        "secret" not in response.headers["location"] + response.text
        and "one-use-auth-code" not in response.headers["location"]
    )
    assert f.calls[0][2]["json"] == {
        "auth_code": "one-use-auth-code",
        "code_verifier": saved["verifier"],
    }
    assert all("admin" not in call[1] for call in f.calls)


@pytest.mark.parametrize(
    "payload",
    [
        {"intent": "https://evil.example"},
        {"intent": "//evil.example"},
        {"intent": "lifetime", "redirect_to": "https://evil.example"},
        {"intent": "lifetime", "plan": "pro"},
    ],
)
def test_no_open_redirect_or_extra_auth_fields(system, payload):
    r = system.client.post("/api/auth/google/start", json=payload, headers=ORIGIN)
    assert r.status_code == 422 and not system.calls


def test_start_requires_trusted_origin(system):
    assert (
        system.client.post("/api/auth/google/start", json={"intent": "pro"}).status_code
        == 403
    )
    assert not system.calls


@pytest.mark.parametrize(
    "bad",
    [
        "missing",
        "mismatch",
        "expired",
        "malformed",
        "array",
        "bad_verifier",
        "untrusted_intent",
    ],
)
def test_bad_state_never_exchanges_or_sets_session(system, bad):
    f = system
    _, _, flow, cookie, saved = start(f)
    if bad == "missing":
        f.client.cookies.clear()
    elif bad == "mismatch":
        flow = "wrong"
    else:
        if bad == "expired":
            saved["issued"] = int(time.time()) - google.TTL - 1
        if bad == "bad_verifier":
            saved["verifier"] = "short"
        if bad == "untrusted_intent":
            saved["intent"] = "https://evil.example"
        if bad == "array":
            saved = []
        value = (
            "!!!"
            if bad == "malformed"
            else base64.urlsafe_b64encode(json.dumps(saved).encode()).decode()
        )
        f.client.cookies.set(
            google.GOOGLE_OAUTH_COOKIE, value, domain="unoword.vercel.app", path="/"
        )
    r = f.client.get("/api/auth/google/callback", params={"flow": flow, "code": "code"})
    assert (
        r.status_code == 303
        and r.headers["location"] == "https://unoword.vercel.app/account?oauth=expired"
    )
    assert not f.calls and not any(
        "uno_session=" in x for x in r.headers.get_list("set-cookie")
    )


def test_provider_cancel_preserves_offer_and_never_reflects_description(system):
    f = system
    _, _, flow, _, _ = start(f, "lifetime")
    r = f.client.get(
        "/api/auth/google/callback",
        params={
            "flow": flow,
            "error": "access_denied",
            "error_description": "untrusted provider message",
        },
    )
    assert (
        r.headers["location"].endswith("/account?offer=lifetime&oauth=canceled")
        and not f.calls
    )
    assert "untrusted" not in r.text + r.headers["location"]


def test_code_is_one_use_even_if_old_state_cookie_is_restored(system):
    f = system
    _, _, flow, cookie, _ = start(f)
    assert (
        f.client.get(
            "/api/auth/google/callback", params={"flow": flow, "code": "same-code"}
        )
        .headers["location"]
        .endswith("oauth=success")
    )
    f.client.cookies.set(
        google.GOOGLE_OAUTH_COOKIE, cookie, domain="unoword.vercel.app", path="/"
    )
    r = f.client.get(
        "/api/auth/google/callback", params={"flow": flow, "code": "same-code"}
    )
    assert r.headers["location"].endswith("oauth=failed")
    assert not any("uno_session=" in x for x in r.headers.get_list("set-cookie"))


def test_disabled_provider_reports_unavailable_without_setting_state(system):
    async def disabled():
        return False

    system.monkeypatch.setattr(google, "enabled", disabled)
    assert system.client.get("/api/auth/google").json() == {"enabled": False}
    r = system.client.post(
        "/api/auth/google/start", json={"intent": "pro"}, headers=ORIGIN
    )
    assert r.status_code == 503 and not r.headers.get("set-cookie") and not system.calls


def test_provider_identity_mismatch_cannot_create_browser_session(system):
    f = system
    _, _, flow, _, _ = start(f)

    async def wrong(method, path, **kw):
        return (
            {"access_token": "a", "refresh_token": "b", "user": {"id": OWNER}}
            if method == "POST"
            else {"id": "other"}
        )

    f.monkeypatch.setattr(google, "auth_request", wrong)
    r = f.client.get("/api/auth/google/callback", params={"flow": flow, "code": "c"})
    assert r.headers["location"].endswith("oauth=failed") and not any(
        "uno_session=" in x for x in r.headers.get_list("set-cookie")
    )


@pytest.mark.parametrize("provider_enabled", [True, False])
def test_provider_settings_are_cached_without_exposing_configuration(
    monkeypatch, provider_enabled
):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setattr(google, "_settings_cache", (0.0, False))
    calls = []

    async def settings(method, path, **kwargs):
        calls.append((method, path))
        return {"external": {"google": provider_enabled}, "unrelated": "not-exposed"}

    monkeypatch.setattr(google, "auth_request", settings)
    with TestClient(app) as client:
        for _ in range(2):
            r = client.get("/api/auth/google")
            assert r.status_code == 200
            assert r.json() == {"enabled": provider_enabled}
            assert r.headers["cache-control"] == "private, no-store"
    assert calls == [("GET", "settings")]


def test_unreachable_provider_fails_closed(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setattr(google, "_settings_cache", (0.0, False))

    async def offline(*args, **kwargs):
        raise SupabaseAPIError(502, "private upstream error")

    monkeypatch.setattr(google, "auth_request", offline)
    assert asyncio.run(google.enabled()) is False


@pytest.mark.parametrize(
    "origin",
    [
        "http://unoword.vercel.app",
        "https://example.com/bad",
        "https://example.com?bad=1",
    ],
)
def test_unsafe_configured_callback_origin_is_rejected(system, origin):
    system.monkeypatch.setenv("PUBLIC_APP_URL", origin)
    r = system.client.post(
        "/api/auth/google/start", json={"intent": "pro"}, headers={"Origin": origin}
    )
    assert r.status_code in {403, 503}
    assert not r.headers.get("set-cookie") and not system.calls


def test_signout_clears_pending_oauth(system):
    start(system)
    r = system.client.post("/api/auth/logout", headers=ORIGIN)
    assert r.status_code == 204
    assert any(
        google.GOOGLE_OAUTH_COOKIE in c and "Max-Age=0" in c
        for c in r.headers.get_list("set-cookie")
    )
