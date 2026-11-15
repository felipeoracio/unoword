"""Session outages stay distinct from authentication rejection and paid access."""
import logging
from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest
from server import app
from lib.auth import AuthenticatedUser, require_user
from routers import auth


@pytest.fixture
def session(monkeypatch):
    user = AuthenticatedUser(id="verified-owner", plan="unverified", access_token="private-access-token")
    monkeypatch.setitem(app.dependency_overrides, require_user, lambda: user)

    async def identity(*args, **kwargs):
        return {"id": user.id, "email": "writer@example.com"}

    monkeypatch.setattr(auth, "auth_request", identity)
    with TestClient(app, base_url="https://unoword.app") as client:
        yield client, user


def test_database_outage_does_not_turn_a_verified_owner_into_free_or_signed_out(session, monkeypatch, caplog):
    async def unavailable(*args):
        raise HTTPException(502, "account_lookup_unavailable")
    monkeypatch.setattr(auth, "get_entitlement", unavailable)
    with caplog.at_level(logging.WARNING, logger="routers.auth"):
        result = session[0].get("/api/auth/me")
    assert result.status_code == 502
    assert "ai_access" not in result.json()
    assert "session_account_lookup_unavailable status=502" in caplog.text
    for private in [session[1].id, session[1].access_token, "writer@example.com"]:
        assert private not in caplog.text


def test_verified_paid_access_is_retained(session, monkeypatch):
    async def entitlement(*args):
        return {"plan": "pro", "status": "active"}
    monkeypatch.setattr(auth, "get_entitlement", entitlement)
    result = session[0].get("/api/auth/me")
    assert result.status_code == 200
    assert result.json()["id"] == session[1].id
    assert result.json()["plan"] == "pro" and result.json()["ai_access"] is True


def test_mismatched_identity_never_reaches_entitlement_lookup(session, monkeypatch):
    async def foreign(*args, **kwargs):
        return {"id": "another-owner"}
    async def forbidden(*args):
        pytest.fail("unverified identity must not resolve entitlements")
    monkeypatch.setattr(auth, "auth_request", foreign)
    monkeypatch.setattr(auth, "get_entitlement", forbidden)
    assert session[0].get("/api/auth/me").status_code == 401
