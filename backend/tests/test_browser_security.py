"""CORS and origin protection before any private handler or provider work."""

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware
import pytest
from lib.request_security import (
    BrowserSecurityMiddleware,
    web_origins,
    extension_origin_pattern,
    _bursts,
)

SITE = "https://unoword.vercel.app"
EXT = "chrome-extension://" + "a" * 32


@pytest.fixture
def system(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_URL", SITE)
    monkeypatch.setenv("CORS_ORIGINS", "*")
    monkeypatch.delenv("AUTH_ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("AUTH_ALLOWED_EXTENSION_IDS", raising=False)
    _bursts.clear()

    def create():
        app = FastAPI()
        calls = []

        @app.api_route(
            "/api/private", methods=["GET", "POST", "PUT", "PATCH", "DELETE"]
        )
        async def private():
            calls.append("private")
            return {"ok": True}

        @app.post("/api/subscription/webhook")
        async def webhook(request: Request):
            if request.headers.get("stripe-signature") != "fixture-signed":
                raise HTTPException(400, "invalid_webhook_signature")
            calls.append("webhook")
            return {"ok": True}

        app.add_middleware(BrowserSecurityMiddleware)
        app.add_middleware(
            CORSMiddleware,
            allow_credentials=True,
            allow_origins=web_origins(),
            allow_origin_regex=extension_origin_pattern(),
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "Authorization"],
        )
        return TestClient(app), calls

    yield create, monkeypatch
    _bursts.clear()


@pytest.mark.parametrize(
    "origin",
    [
        "https://untrusted.example",
        "null",
        "https://unoword.vercel.app.evil.example",
        "https://unoword.vercel.app/path",
        "chrome-extension://fake",
        EXT + "/path",
    ],
)
def test_unknown_origin_cannot_read_or_write_even_with_a_cookie(system, origin):
    client, calls = system[0]()
    for method in ["GET", "POST", "PUT", "PATCH", "DELETE"]:
        r = client.request(
            method,
            "/api/private",
            headers={"Origin": origin, "Cookie": "uno_session=opaque"},
        )
        assert r.status_code == 403
        assert r.headers.get("access-control-allow-origin") is None
    assert calls == []


@pytest.mark.parametrize("origin", [SITE, EXT])
def test_trusted_web_and_unpacked_extension_keep_credentialed_access(system, origin):
    client, calls = system[0]()
    for method in ["GET", "POST"]:
        r = client.request(
            method,
            "/api/private",
            headers={"Origin": origin, "Cookie": "uno_session=opaque"},
        )
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == origin
        assert r.headers["access-control-allow-credentials"] == "true"
    assert len(calls) == 2


def test_mutations_require_origin_or_explicit_non_browser_bearer(system):
    client, calls = system[0]()
    for method in ["POST", "PUT", "PATCH", "DELETE"]:
        assert client.request(method, "/api/private").status_code == 403
    assert calls == []
    assert client.get("/api/private").status_code == 200
    # Real handlers still verify this token; the guard only distinguishes callers.
    assert (
        client.post(
            "/api/private", headers={"Authorization": "Bearer fixture"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/private",
            headers={
                "Authorization": "Bearer fixture",
                "Origin": "https://evil.example",
            },
        ).status_code
        == 403
    )


def test_cross_origin_preflight_is_rejected_and_valid_preflight_succeeds(system):
    client, calls = system[0]()
    for origin, status in [(SITE, 200), ("https://evil.example", 400)]:
        r = client.options(
            "/api/private",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert r.status_code == status
        assert r.headers.get("access-control-allow-origin") == (
            origin if status == 200 else None
        )
    assert calls == []


def test_originless_extension_marker_preserves_worker_access_but_cannot_bypass_a_web_origin(
    system,
):
    client, calls = system[0]()
    marker = {"X-Uno-Extension-Id": "a" * 32}
    assert client.post("/api/private", headers=marker).status_code == 200
    assert (
        client.post(
            "/api/private", headers={**marker, "Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert (
        client.post("/api/private", headers={**marker, "Origin": "null"}).status_code
        == 403
    )
    assert (
        client.post("/api/private", headers={"X-Uno-Extension-Id": "fake"}).status_code
        == 403
    )
    assert calls == ["private"]


def test_explicit_preview_and_extension_id_allowlists(system):
    create, monkeypatch = system
    monkeypatch.setenv(
        "AUTH_ALLOWED_ORIGINS", "https://preview.example,https://bad.example/path,*"
    )
    monkeypatch.setenv("AUTH_ALLOWED_EXTENSION_IDS", "a" * 32)
    client, calls = create()
    assert (
        client.post(
            "/api/private", headers={"Origin": "https://preview.example"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/private", headers={"Origin": "chrome-extension://" + "b" * 32}
        ).status_code
        == 403
    )
    assert "*" not in web_origins() and "https://bad.example/path" not in web_origins()


def test_only_exact_signature_checked_webhook_bypasses_browser_origin(system):
    client, calls = system[0]()
    assert client.post("/api/subscription/webhook").status_code == 400
    assert (
        client.post(
            "/api/subscription/webhook",
            headers={
                "Origin": "https://evil.example",
                "Stripe-Signature": "fixture-signed",
            },
        ).status_code
        == 200
    )
    assert client.post("/api/subscription/webhook/anything").status_code == 403
    assert calls == ["webhook"]


def test_admin_validation_never_reflects_a_submitted_secret():
    from server import app
    from lib.admin_auth import require_admin

    app.dependency_overrides[require_admin] = lambda: {"sub": "fixture-admin"}
    try:
        with TestClient(app) as client:
            r = client.post(
                "/api/admin/openai-key",
                json={"api_key": "private"},
                headers={"Origin": SITE},
            )
            assert r.status_code == 422
            assert "private" not in r.text
            assert r.json()["detail"][0]["loc"][-1] == "api_key"
    finally:
        app.dependency_overrides.clear()


def test_admin_sessions_cannot_use_a_known_development_secret(monkeypatch):
    from lib.admin_auth import create_token

    monkeypatch.delenv("ADMIN_JWT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(HTTPException) as result:
        create_token("fixture-admin", "admin@example.com")
    assert result.value.status_code == 503


def test_real_app_accepts_extension_marker_preflight():
    from server import app

    with TestClient(app) as client:
        r = client.options(
            "/api/auth/refresh",
            headers={
                "Origin": EXT,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-uno-extension-id,content-type",
            },
        )
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == EXT
