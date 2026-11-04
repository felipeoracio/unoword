"""The unauthenticated native bootstrap must never disclose a privileged key."""
import base64
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers.mobile import router


def token(role):
    part = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
    return "header." + part + ".signature"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-only")
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return TestClient(app)


@pytest.mark.parametrize("key", ["sb_publishable_example", token("anon")])
def test_only_public_config_is_exposed(client, monkeypatch, key):
    monkeypatch.setenv("SUPABASE_ANON_KEY", key)
    response = client.get("/api/auth/client-config")
    assert response.status_code == 200
    assert response.json() == {"supabase_url": "https://project.supabase.co", "supabase_anon_key": key}
    assert response.headers["cache-control"] == "public, max-age=300"


@pytest.mark.parametrize("key", ["sb_secret_bad", token("service_role"), token("authenticated"), "malformed", "", "a.@@@@.b"])
def test_privileged_or_unknown_keys_fail_closed(client, monkeypatch, key):
    monkeypatch.setenv("SUPABASE_ANON_KEY", key)
    response = client.get("/api/auth/client-config")
    assert response.status_code == 503
    assert response.json() == {"detail": "mobile_public_auth_not_configured"}
    assert key not in response.text if key else True


def test_same_value_as_service_role_never_exposed(client, monkeypatch):
    key = token("anon")
    monkeypatch.setenv("SUPABASE_ANON_KEY", key)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", key)
    assert client.get("/api/auth/client-config").status_code == 503


@pytest.mark.parametrize("url", ["http://project.supabase.co", "https://name:password@project.supabase.co", "https://project.supabase.co?secret=x"])
def test_invalid_project_url_is_not_published(client, monkeypatch, url):
    monkeypatch.setenv("SUPABASE_ANON_KEY", token("anon"))
    monkeypatch.setenv("SUPABASE_URL", url)
    assert client.get("/api/auth/client-config").status_code == 503
