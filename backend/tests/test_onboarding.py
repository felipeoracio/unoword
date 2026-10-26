from types import SimpleNamespace
from copy import deepcopy
import pytest
from fastapi.testclient import TestClient
from server import app
from lib.auth import require_user
from routers import onboarding

OWNER = "00000000-0000-4000-8000-000000000001"
ORIGIN = {"Origin": "https://unoword.vercel.app"}


@pytest.fixture
def system(monkeypatch):
    metadata = {"unrelated": "keep"}
    calls = []

    async def auth(method, path, **kwargs):
        calls.append((method, path, deepcopy(kwargs)))
        if method == "PUT":
            metadata.update(kwargs["json"]["data"])
        return {"id": OWNER, "user_metadata": metadata}

    monkeypatch.setattr(onboarding, "auth_request", auth)
    app.dependency_overrides[require_user] = lambda: SimpleNamespace(
        id=OWNER, access_token="owner-token"
    )
    with TestClient(app) as client:
        yield client, metadata, calls
    app.dependency_overrides.clear()


def body(**patch):
    return {
        "expected_user_id": OWNER,
        "status": "in_progress",
        "current_step": "sentence",
        **patch,
    }


def test_empty_read_and_owner_scoped_write_preserves_metadata(system):
    client, metadata, calls = system
    assert client.get("/api/onboarding").json()["status"] == "not_started"
    r = client.put("/api/onboarding", json=body(), headers=ORIGIN)
    assert r.status_code == 200 and r.headers["cache-control"] == "private, no-store"
    assert metadata["unrelated"] == "keep"
    assert all(c[2]["access_token"] == "owner-token" for c in calls)


def test_resume_replay_never_erases_achievements(system):
    client, metadata, _ = system
    for patch in [
        {
            "completed_actions": {"first_sentence_written": True},
            "words": 8,
            "status": "completed",
        },
        {
            "current_step": "welcome",
            "completed_actions": {"first_sentence_written": False},
            "words": 0,
        },
    ]:
        r = client.put("/api/onboarding", json=body(**patch), headers=ORIGIN)
        assert r.status_code == 200
    assert r.json()["completed_actions"]["first_sentence_written"] is True
    assert r.json()["words"] == 8
    assert r.json()["completed_once"] is True


@pytest.mark.parametrize(
    "patch",
    [
        {"current_step": "invented"},
        {"completed_actions": {"fake": True}},
        {"skipped_steps": ["fake"]},
        {"words": -1},
        {"text": "private draft"},
        {"status": "pro"},
    ],
)
def test_unknown_private_or_invalid_fields_rejected(system, patch):
    client, _, calls = system
    assert (
        client.put("/api/onboarding", json=body(**patch), headers=ORIGIN).status_code
        == 422
    )
    assert not any(c[0] == "PUT" for c in calls)


def test_account_swap_csrf_and_signed_out_rejected(system):
    client, _, calls = system
    assert (
        client.put(
            "/api/onboarding",
            json=body(expected_user_id="00000000-0000-4000-8000-000000000002"),
            headers=ORIGIN,
        ).status_code
        == 409
    )
    assert client.put("/api/onboarding", json=body()).status_code == 403
    app.dependency_overrides.pop(require_user)
    assert client.get("/api/onboarding").status_code == 401
    assert not calls
