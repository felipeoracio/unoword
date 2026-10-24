"""Isolated workspace boundary tests. No real users, model calls or uploads."""

from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from docx import Document
from pypdf import PdfReader
from server import app
from lib.auth import require_user
from lib.ai_access import require_ai_user
from lib.supabase_client import SupabaseAPIError
from lib.writing_document import clean_document, markdown, import_docx, to_docx
from routers import workspace

OWNER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"
ORIGIN = {"Origin": "https://unoword.vercel.app"}
CONTENT = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"level": 2},
            "content": [{"type": "text", "text": "A quiet beginning"}],
        },
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "text",
                    "text": "Some thoughtful words.",
                    "marks": [{"type": "bold"}],
                }
            ],
        },
    ],
}


@pytest.fixture
def fixture(monkeypatch):
    records = {}
    folder_records = {}
    calls = []

    async def provider(method, table, token, **kwargs):
        calls.append((method, table, token, deepcopy(kwargs)))
        params = kwargs.get("params", {})
        if table == "rpc/workspace_save_document":
            body = kwargs["json"]
            existing = records.get(body["p_id"])
            if existing and existing["mutation_id"] == body["p_mutation"]:
                return existing
            if existing and existing["revision"] != body["p_revision"]:
                raise SupabaseAPIError(400, "revision_conflict")
            if not existing and body["p_revision"] != 0:
                raise SupabaseAPIError(404, "document_not_found")
            saved = {
                **body["p_data"],
                "id": body["p_id"],
                "user_id": OWNER,
                "revision": (existing or {}).get("revision", 0) + 1,
                "mutation_id": body["p_mutation"],
            }
            records[body["p_id"]] = saved
            return saved
        if table == "writing_documents":
            assert params.get("user_id") == f"eq.{OWNER}"
            return [
                d
                for d in records.values()
                if not params.get("id") or f'eq.{d["id"]}' == params["id"]
            ]
        if table == "rpc/workspace_save_activity":
            return kwargs["json"]["p_data"]
        if table == "writing_folders" and method == "POST":
            body = kwargs["json"]
            folder_id = body.get("id", str(uuid4()))
            if folder_id in folder_records:
                return []
            folder_records[folder_id] = {**body, "id": folder_id}
            return [folder_records[folder_id]]
        if table == "writing_folders" and method == "GET":
            return [
                f
                for f in folder_records.values()
                if not params.get("id") or params["id"] == f'eq.{f["id"]}'
            ]
        return []

    async def pro(_):
        return {"plan": "pro", "status": "active"}

    monkeypatch.setattr(workspace, "get_entitlement", pro)
    monkeypatch.setattr(workspace, "user_rest", provider)
    app.dependency_overrides[require_user] = lambda: SimpleNamespace(
        id=OWNER, access_token="owner-token", email="writer@example.com"
    )
    app.dependency_overrides[require_ai_user] = lambda: SimpleNamespace(
        id=OWNER, access_token="owner-token"
    )
    with TestClient(app) as client:
        yield client, records, calls
    app.dependency_overrides.clear()


def payload(**patch):
    return {
        "expected_user_id": OWNER,
        "revision": 0,
        "mutation_id": str(uuid4()),
        "title": "My draft",
        "content": CONTENT,
        **patch,
    }


def test_save_retry_and_conflict_never_lose_revision(fixture):
    client, records, calls = fixture
    doc = str(uuid4())
    body = payload()
    first = client.put(f"/api/workspace/documents/{doc}", json=body, headers=ORIGIN)
    assert first.status_code == 200 and first.json()["revision"] == 1
    assert first.headers["Cache-Control"] == "private, no-store"
    assert first.json()["plain_text"] == "A quiet beginning\nSome thoughtful words."
    assert (
        client.put(f"/api/workspace/documents/{doc}", json=body, headers=ORIGIN).json()[
            "revision"
        ]
        == 1
    )
    updated = client.put(
        f"/api/workspace/documents/{doc}",
        json=payload(revision=1, title="Newer version"),
        headers=ORIGIN,
    )
    assert updated.json()["revision"] == 2
    conflict = client.put(
        f"/api/workspace/documents/{doc}",
        json=payload(revision=1, title="Stale"),
        headers=ORIGIN,
    )
    assert conflict.status_code == 409 and records[doc]["title"] == "Newer version"
    assert all(call[2] == "owner-token" for call in calls)


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://evil.example"}])
def test_csrf_rejected_without_data_call(fixture, headers):
    client, _, calls = fixture
    assert (
        client.put(
            f"/api/workspace/documents/{uuid4()}", json=payload(), headers=headers
        ).status_code
        == 403
    )
    assert not calls


def test_account_swap_and_unknown_owner_fields_rejected(fixture):
    client, _, calls = fixture
    assert (
        client.put(
            f"/api/workspace/documents/{uuid4()}",
            json=payload(expected_user_id=OTHER),
            headers=ORIGIN,
        ).status_code
        == 409
    )
    assert (
        client.put(
            f"/api/workspace/documents/{uuid4()}",
            json=payload(user_id=OTHER),
            headers=ORIGIN,
        ).status_code
        == 422
    )
    assert calls == []


def test_private_reads_always_have_owner_predicate(fixture):
    client, _, calls = fixture
    for path in ("documents", "activity", "folders", "sources"):
        assert client.get("/api/workspace/" + path).status_code == 200
    assert all(call[3]["params"]["user_id"] == f"eq.{OWNER}" for call in calls)
    assert client.get(f"/api/workspace/documents/{uuid4()}").status_code == 404


def test_signed_out_cannot_read_or_write(fixture):
    client, _, calls = fixture
    app.dependency_overrides.pop(require_user)
    assert client.get("/api/workspace/documents").status_code == 401
    assert (
        client.put(
            f"/api/workspace/documents/{uuid4()}", json=payload(), headers=ORIGIN
        ).status_code
        == 401
    )
    assert not calls


def test_unsafe_attributes_removed_and_private_validation_not_reflected(fixture):
    client, _, _ = fixture
    content = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "attrs": {"onclick": "steal()", "style": "position:fixed"},
                "content": [
                    {
                        "type": "text",
                        "text": "Private text",
                        "marks": [
                            {"type": "link", "attrs": {"href": "javascript:alert(1)"}},
                            {"type": "bold"},
                        ],
                    }
                ],
            }
        ],
    }
    result = client.put(
        f"/api/workspace/documents/{uuid4()}",
        json=payload(content=content),
        headers=ORIGIN,
    )
    assert result.status_code == 200
    assert "javascript" not in result.text and "onclick" not in result.text
    result = client.put(
        f"/api/workspace/documents/{uuid4()}",
        json=payload(title={"private secret": "never echo"}),
        headers=ORIGIN,
    )
    assert result.status_code == 422 and "private secret" not in result.text


@pytest.mark.parametrize(
    "content",
    [
        {"type": "script"},
        {"type": "doc", "content": "secret"},
        {"type": "doc", "content": [{"type": "unknown", "text": "secret"}]},
    ],
)
def test_unsupported_json_rejected_without_writes(fixture, content):
    client, _, calls = fixture
    assert (
        client.put(
            f"/api/workspace/documents/{uuid4()}",
            json=payload(content=content),
            headers=ORIGIN,
        ).status_code
        == 422
    )
    assert not calls


def test_activity_is_metadata_only_and_validates_document(fixture):
    client, _, calls = fixture
    doc = str(uuid4())
    client.put(f"/api/workspace/documents/{doc}", json=payload(), headers=ORIGIN)
    body = {
        "expected_user_id": OWNER,
        "id": str(uuid4()),
        "document_id": doc,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "typed_words": 10,
        "pasted_words": 20,
        "duration_seconds": 45,
        "sequence": 1,
    }
    result = client.put("/api/workspace/activity", json=body, headers=ORIGIN)
    assert result.status_code == 200 and "content" not in result.json()
    assert (
        client.put(
            "/api/workspace/activity",
            json={**body, "content": "private"},
            headers=ORIGIN,
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/workspace/activity",
            json={**body, "document_id": str(uuid4())},
            headers=ORIGIN,
        ).status_code
        == 404
    )


def test_real_docx_pdf_exports_and_docx_import(fixture):
    client, _, _ = fixture
    for format in ("docx", "pdf"):
        result = client.post(
            "/api/workspace/export/" + format,
            json={"expected_user_id": OWNER, "title": "An essay", "content": CONTENT},
            headers=ORIGIN,
        )
        assert (
            result.status_code == 200
            and result.headers["Cache-Control"] == "private, no-store"
        )
        if format == "docx":
            assert "A quiet beginning" in "\n".join(
                p.text for p in Document(BytesIO(result.content)).paragraphs
            )
        else:
            assert (
                "A quiet beginning"
                in PdfReader(BytesIO(result.content)).pages[0].extract_text()
            )
    imported = client.post(
        "/api/workspace/import",
        files={"file": ("draft.docx", to_docx(CONTENT, "Essay"))},
        headers=ORIGIN,
    )
    assert (
        imported.status_code == 200
        and imported.json()["content"]["content"][0]["type"] == "heading"
    )
    assert "A quiet beginning" in markdown(imported.json()["content"])


def test_portable_formats_preserve_links_lists_and_safe_inline_styles(fixture):
    client, _, _ = fixture
    content = {
        "type": "doc",
        "content": [
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "An accessible link",
                                        "marks": [
                                            {"type": "bold"},
                                            {"type": "underline"},
                                            {
                                                "type": "link",
                                                "attrs": {
                                                    "href": "https://example.com/essay?a=1&b=2"
                                                },
                                            },
                                        ],
                                    }
                                ],
                            }
                        ],
                    }
                ],
            },
            {"type": "horizontalRule"},
        ],
    }
    for format in ("docx", "pdf"):
        response = client.post(
            "/api/workspace/export/" + format,
            json={"expected_user_id": OWNER, "title": "Formats", "content": content},
            headers=ORIGIN,
        )
        assert response.status_code == 200
        if format == "docx":
            result = import_docx(response.content)
            assert "accessible link" in markdown(result)
            assert "https://example.com/essay" in markdown(result)
        else:
            assert (
                "An accessible link"
                in PdfReader(BytesIO(response.content)).pages[0].extract_text()
            )


def test_import_rejects_invalid_archive_or_unsupported_file(fixture):
    client, _, _ = fixture
    for name, data in [
        ("unsafe.docx", b"not a zip"),
        ("script.html", b"<script>bad</script>"),
    ]:
        assert (
            client.post(
                "/api/workspace/import", files={"file": (name, data)}, headers=ORIGIN
            ).status_code
            == 422
        )


def test_ai_requires_server_entitlement_and_explicit_consent(fixture, monkeypatch):
    client, _, calls = fixture
    doc = str(uuid4())
    client.put(f"/api/workspace/documents/{doc}", json=payload(), headers=ORIGIN)
    calls.clear()
    body = {
        "expected_user_id": OWNER,
        "document_id": doc,
        "action": "next",
        "current_text": "private words",
    }
    assert (
        client.post("/api/workspace/assistant", json=body, headers=ORIGIN).status_code
        == 422
    )
    assert not calls
    app.dependency_overrides.pop(require_ai_user)

    async def free(_):
        return None

    monkeypatch.setattr("lib.ai_access.get_entitlement", free)
    assert (
        client.post(
            "/api/workspace/assistant", json={**body, "consent": True}, headers=ORIGIN
        ).status_code
        == 403
    )


def test_assistant_never_runs_for_changed_owner_or_missing_selection(fixture):
    client, _, calls = fixture
    doc = str(uuid4())
    client.put(f"/api/workspace/documents/{doc}", json=payload(), headers=ORIGIN)
    result = client.post(
        "/api/workspace/assistant",
        json={
            "expected_user_id": OWNER,
            "document_id": doc,
            "action": "improve",
            "consent": True,
        },
        headers=ORIGIN,
    )
    assert result.status_code == 422 and result.json()["detail"] == "select_text_first"
    calls.clear()
    assert (
        client.post(
            "/api/workspace/assistant",
            json={
                "expected_user_id": OTHER,
                "document_id": doc,
                "action": "next",
                "consent": True,
            },
            headers=ORIGIN,
        ).status_code
        == 409
    )
    assert not calls


@pytest.mark.parametrize(
    "entitlement",
    [
        None,
        {"plan": "free", "status": "active"},
        {"plan": "pro", "status": "canceled"},
        {"plan": "pro", "status": "past_due"},
        {"plan": "pro", "status": "active", "valid_until": "2020-01-01T00:00:00Z"},
    ],
)
def test_non_pro_cannot_use_workspace_but_keeps_statistics(
    fixture, monkeypatch, entitlement
):
    client, records, calls = fixture

    async def current(_):
        return entitlement

    monkeypatch.setattr(workspace, "get_entitlement", current)
    doc = str(uuid4())
    for path in [
        "config",
        "documents",
        "folders",
        f"documents/{doc}",
        f"documents/{doc}/export/pdf",
    ]:
        assert client.get("/api/workspace/" + path).status_code == 403
    assert (
        client.put(
            f"/api/workspace/documents/{doc}", json=payload(), headers=ORIGIN
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/workspace/folders",
            json={"expected_user_id": OWNER, "name": "Private"},
            headers=ORIGIN,
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/workspace/import",
            files={"file": ("test.txt", b"Private words", "text/plain")},
            headers=ORIGIN,
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/workspace/export/pdf",
            json={"expected_user_id": OWNER, "title": "Private", "content": CONTENT},
            headers=ORIGIN,
        ).status_code
        == 403
    )
    assert (
        client.put("/api/workspace/activity", json={}, headers=ORIGIN).status_code
        == 403
    )
    assert (
        client.put(
            f"/api/workspace/folders/{doc}",
            json={"expected_user_id": OWNER, "name": "Private"},
            headers=ORIGIN,
        ).status_code
        == 403
    )
    assert calls == [] and records == {}
    assert client.get("/api/workspace/activity").status_code == 200


@pytest.mark.parametrize("status", ["active", "trialing"])
def test_active_pro_and_trial_can_open_workspace(fixture, monkeypatch, status):
    client, _, _ = fixture

    async def pro(_):
        return {"plan": "pro", "status": status}

    monkeypatch.setattr(workspace, "get_entitlement", pro)
    assert client.get("/api/workspace/documents").status_code == 200


def test_folder_sync_retry_is_idempotent_and_owner_scoped(fixture):
    client, _, calls = fixture
    folder_id = str(uuid4())
    body = {"expected_user_id": OWNER, "name": "  Field notes  "}
    first = client.put(f"/api/workspace/folders/{folder_id}", json=body, headers=ORIGIN)
    assert first.status_code == 200
    assert first.json()["id"] == folder_id and first.json()["name"] == "Field notes"
    retry = client.put(f"/api/workspace/folders/{folder_id}", json=body, headers=ORIGIN)
    assert retry.status_code == 200 and retry.json() == first.json()
    assert len(client.get("/api/workspace/folders").json()) == 1
    assert (
        client.put(
            f"/api/workspace/folders/{folder_id}",
            json={**body, "expected_user_id": OTHER},
            headers=ORIGIN,
        ).status_code
        == 409
    )
    assert (
        client.put(
            f"/api/workspace/folders/{folder_id}",
            json={**body, "name": "   "},
            headers=ORIGIN,
        ).status_code
        == 422
    )
    assert (
        client.put(f"/api/workspace/folders/{folder_id}", json=body).status_code == 403
    )
    assert all(call[2] == "owner-token" for call in calls)
