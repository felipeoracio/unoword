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
ORIGIN = {"Origin": "https://unoword.app"}
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
        if table == "rpc/workspace_empty_trash":
            requested = kwargs["json"]["p_documents"]
            removed = [item["id"] for item in requested if item["id"] not in records]
            deleted = []
            for item in requested:
                record = records.get(item["id"])
                if record and record["status"] == "trashed" and record["revision"] == item["revision"]:
                    deleted.append(item["id"])
                    removed.append(item["id"])
                    del records[item["id"]]
            return {"deleted_ids": deleted, "removed_ids": removed, "activities": []}
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
            saved.setdefault("folder_id", None)
            saved.setdefault("completion_status", (existing or {}).get("completion_status", "draft"))
            saved["completed_at"] = ("2026-10-29T12:00:00Z" if saved["completion_status"] == "completed" else None)
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


def test_completion_preserves_saved_writing_and_uses_revision_checks(fixture):
    client, records, _ = fixture
    doc = str(uuid4())
    original = client.put(f"/api/workspace/documents/{doc}", json=payload(), headers=ORIGIN).json()
    body = {"expected_user_id": OWNER, "revision": 1, "mutation_id": str(uuid4()), "completion_status": "completed"}
    response = client.post(f"/api/workspace/documents/{doc}/completion", json=body, headers=ORIGIN)
    assert response.status_code == 200
    completed = response.json()
    assert completed["completion_status"] == "completed" and completed["completed_at"]
    assert completed["status"] == "active"  # not archived or trashed
    assert completed["content"] == original["content"] and completed["plain_text"] == original["plain_text"]
    assert client.post(f"/api/workspace/documents/{doc}/completion", json=body, headers=ORIGIN).json() == completed
    stale = {**body, "mutation_id": str(uuid4()), "completion_status": "draft"}
    assert client.post(f"/api/workspace/documents/{doc}/completion", json=stale, headers=ORIGIN).status_code == 409
    stale["revision"] = completed["revision"]
    reverted = client.post(f"/api/workspace/documents/{doc}/completion", json=stale, headers=ORIGIN).json()
    assert reverted["completion_status"] == "draft" and reverted["completed_at"] is None
    assert records[doc]["content"] == original["content"]


def test_completion_requires_owner_pro_origin_and_trusted_timestamp(fixture, monkeypatch):
    client, _, _ = fixture
    doc = str(uuid4())
    body = {"expected_user_id": OWNER, "revision": 1, "mutation_id": str(uuid4()), "completion_status": "completed"}
    route = f"/api/workspace/documents/{doc}/completion"
    assert client.post(route, json=body).status_code == 403
    assert client.post(route, json={**body, "expected_user_id": OTHER}, headers=ORIGIN).status_code == 409
    assert client.post(route, json={**body, "completed_at": "2026-10-29T12:00:00Z"}, headers=ORIGIN).status_code == 422
    assert client.post(route, json=body, headers=ORIGIN).status_code == 404
    async def free(_): return {"plan": "free", "status": "active"}
    monkeypatch.setattr(workspace, "get_entitlement", free)
    assert client.post(route, json=body, headers=ORIGIN).status_code == 403


def test_activity_persists_paused_clock_without_changing_session_identity(fixture):
    client, _, calls = fixture
    doc = str(uuid4())
    client.put(f"/api/workspace/documents/{doc}", json=payload(), headers=ORIGIN)
    now = datetime.now(timezone.utc)
    timer = {"status": "paused", "active_ms": 25*60000, "paused_ms": 0, "changed_at": int(now.timestamp()*1000)}
    body = {"id": str(uuid4()), "document_id": doc, "expected_user_id": OWNER, "started_at": now.isoformat(), "typed_words": 100, "duration_seconds": 1500, "sequence": 1, "timer": timer}
    r = client.put('/api/workspace/activity', json=body, headers=ORIGIN)
    assert r.status_code == 200 and r.json()['timer'] == timer
    assert r.json()['id'] == body['id'] and r.json()['typed_words'] == 100
    assert client.put('/api/workspace/activity', json={**body, "timer": {**timer, "changed_at": timer['changed_at']+600000}}, headers=ORIGIN).status_code == 422
    assert client.put('/api/workspace/activity', json={**body, "timer": {**timer, "status": "forged"}}, headers=ORIGIN).status_code == 422


def test_empty_trash_requires_confirmation_and_keeps_other_documents(fixture, monkeypatch):
    client, records, _ = fixture
    trash, draft = str(uuid4()), str(uuid4())
    client.put(f'/api/workspace/documents/{trash}', json=payload(status='trashed'), headers=ORIGIN)
    client.put(f'/api/workspace/documents/{draft}', json=payload(), headers=ORIGIN)
    body = {'expected_user_id': OWNER, 'confirm': True, 'documents': [{'id': trash, 'revision': 1}, {'id': draft, 'revision': 1}]}
    route = '/api/workspace/trash/empty'
    assert client.post(route, json={**body, 'confirm': False}, headers=ORIGIN).status_code == 422
    assert client.post(route, json=body).status_code == 403
    assert client.post(route, json={**body, 'expected_user_id': OTHER}, headers=ORIGIN).status_code == 409
    result = client.post(route, json=body, headers=ORIGIN)
    assert result.status_code == 200 and result.json()['deleted_ids'] == [trash]
    assert draft in records and trash not in records
    assert client.post(route, json=body, headers=ORIGIN).json()['deleted_ids'] == []
    async def free(_): return {'plan': 'free', 'status': 'active'}
    monkeypatch.setattr(workspace, 'get_entitlement', free)
    assert client.post(route, json=body, headers=ORIGIN).status_code == 403


@pytest.mark.parametrize('billing_source', ['stripe', 'stripe_lifetime'])
def test_monthly_and_lifetime_share_completion_and_trash_access(fixture, monkeypatch, billing_source):
    client, _, _ = fixture
    monkeypatch.setenv('STRIPE_SECRET_KEY', 'sk_test_fixture_only')
    async def paid(_):
        return {'plan': 'pro', 'status': 'active', 'billing_source': billing_source, 'billing_livemode': False}
    monkeypatch.setattr(workspace, 'get_entitlement', paid)
    doc = str(uuid4())
    assert client.put(f'/api/workspace/documents/{doc}', json=payload(status='trashed'), headers=ORIGIN).status_code == 200
    response = client.post(f'/api/workspace/documents/{doc}/completion', json={'expected_user_id': OWNER, 'revision': 1, 'mutation_id': str(uuid4()), 'completion_status': 'completed'}, headers=ORIGIN)
    assert response.status_code == 200
    response = client.post('/api/workspace/trash/empty', json={'expected_user_id': OWNER, 'confirm': True, 'documents': [{'id': doc, 'revision': response.json()['revision']}]}, headers=ORIGIN)
    assert response.status_code == 200 and response.json()['deleted_ids'] == [doc]


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


def test_signed_out_cannot_read_or_write(fixture, monkeypatch):
    from lib import auth
    monkeypatch.setattr(auth, "auth_is_configured", lambda: True)
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
        assert result.headers["Content-Disposition"] == f'attachment; filename="UnoWord-document.{format}"'
        if format == "docx":
            assert "A quiet beginning" in "\n".join(
                p.text for p in Document(BytesIO(result.content)).paragraphs
            )
        else:
            assert PdfReader(BytesIO(result.content)).metadata.author == "UnoWord"
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
    assert result.status_code == 422 # Removed rewriting actions are rejected before model work.
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


def test_subtitle_roundtrip_counts_legacy_save_clear_and_completion(fixture):
    c, records, _ = fixture
    doc = str(uuid4())
    content = {**deepcopy(CONTENT), 'attrs': {'subtitle': 'Small beginnings, lasting ideas'}}
    r = c.put('/api/workspace/documents/'+doc,json=payload(content=content),headers=ORIGIN)
    assert r.status_code==200
    saved=r.json()
    assert saved['content']['attrs']['subtitle']=='Small beginnings, lasting ideas'
    assert saved['plain_text']==workspace.plain_text(CONTENT), 'Subtitle is metadata, not counted body text'
    assert c.get('/api/workspace/documents/'+doc).json()['content']['attrs']['subtitle']=='Small beginnings, lasting ideas'
    legacy=c.put('/api/workspace/documents/'+doc,json=payload(revision=saved['revision'],content=CONTENT),headers=ORIGIN)
    assert legacy.status_code==200 and legacy.json()['content']['attrs']['subtitle']=='Small beginnings, lasting ideas'
    completed=c.post('/api/workspace/documents/'+doc+'/completion',json={'expected_user_id':OWNER,'revision':legacy.json()['revision'],'mutation_id':str(uuid4()),'completion_status':'completed'},headers=ORIGIN)
    assert completed.status_code==200 and completed.json()['content']['attrs']['subtitle']=='Small beginnings, lasting ideas'
    cleared=c.put('/api/workspace/documents/'+doc,json=payload(revision=completed.json()['revision'],content={**deepcopy(CONTENT),'attrs':{'subtitle':None}}),headers=ORIGIN)
    assert cleared.status_code==200 and cleared.json()['content']['attrs']['subtitle'] is None


@pytest.mark.parametrize('subtitle', [500*'a'+'b', {'text':'unsafe'}, 123, '\x00'])
def test_invalid_subtitle_is_rejected_without_writes(fixture,subtitle):
    c,records,_=fixture
    r=c.put('/api/workspace/documents/'+str(uuid4()),json=payload(content={**deepcopy(CONTENT),'attrs':{'subtitle':subtitle}}),headers=ORIGIN)
    assert r.status_code==422 and not records


def test_subtitle_exports_plain_safe_text_and_docx_metadata(fixture):
    c,_,_=fixture
    from lib.writing_document import plain_text, export_text
    subtitle='A <quiet> start & a new perspective'
    content=clean_document({**deepcopy(CONTENT),'attrs':{'subtitle':subtitle,'onclick':'unsafe'}})
    assert content['attrs']=={'subtitle':subtitle}
    assert subtitle not in plain_text(content)
    assert export_text(content).startswith(subtitle+'\n\n')
    assert 'data-document-subtitle="true">A &lt;quiet&gt; start &amp; a new perspective</p>' in markdown(content)
    for format in ['docx','pdf']:
        response=c.post('/api/workspace/export/'+format,json={'expected_user_id':OWNER,'title':'An essay','content':content},headers=ORIGIN)
        assert response.status_code==200
        if format=='docx':
            doc=Document(BytesIO(response.content))
            assert doc.paragraphs[0].style.name=='Subtitle' and doc.paragraphs[0].text==subtitle
            imported=import_docx(response.content)
            assert imported['attrs']['subtitle']==subtitle
            assert plain_text(imported)==plain_text(CONTENT)
        else:
            assert subtitle in PdfReader(BytesIO(response.content)).pages[0].extract_text()


def image_document():
    import base64
    from PIL import Image
    data=BytesIO();Image.new('RGB',(48,32),(30,100,240)).save(data,format='PNG')
    source='data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()
    return {'type':'doc','content':[deepcopy(CONTENT['content'][1]),{'type':'image','attrs':{'src':source,'alt':'Blue garden illustration','width':999999,'onclick':'unsafe'}},deepcopy(CONTENT['content'][1])]}


def test_embedded_images_save_private_metadata_and_do_not_count_alt_text(fixture):
    c,records,_=fixture;doc=str(uuid4())
    response=c.put('/api/workspace/documents/'+doc,json=payload(content=image_document()),headers=ORIGIN)
    assert response.status_code==200
    saved=response.json();image=saved['content']['content'][1]
    assert image['attrs']['width']==48 and image['attrs']['height']==32
    assert image['attrs']['alt']=='Blue garden illustration' and 'onclick' not in image['attrs']
    assert 'Blue garden illustration' not in saved['plain_text'] and 'data:' not in saved['plain_text']
    assert c.get('/api/workspace/documents/'+doc).json()['content']['content'][1]==image
    assert '<figure data-document-image="true"' in markdown(saved['content'])
    assert 'src="data:image/png;base64,' in markdown(saved['content'])
    assert 'alt="Blue garden illustration"' in markdown(saved['content'])


@pytest.mark.parametrize('source',[
    'https://example.com/tracker.png', 'file:///etc/passwd','javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
    'data:image/png;base64,PGh0bWw+bm90IGFuIGltYWdlPC9odG1sPg==',
    'data:image/png;base64,'+'A'*(192*1024*4//3+100),
])
def test_untrusted_or_oversized_images_are_rejected_without_writes(fixture,source):
    c,records,_=fixture;content={'type':'doc','content':[{'type':'image','attrs':{'src':source,'alt':'Unsafe'}}]}
    r=c.put('/api/workspace/documents/'+str(uuid4()),json=payload(content=content),headers=ORIGIN)
    assert r.status_code==422 and not records


def test_images_reject_spoofed_mime_and_oversized_dimensions():
    import base64
    from PIL import Image
    from fastapi import HTTPException
    src=image_document()['content'][1]['attrs']['src'].replace('image/png','image/jpeg')
    with pytest.raises(HTTPException):clean_document({'type':'doc','content':[{'type':'image','attrs':{'src':src}}]})
    output=BytesIO();Image.new('RGB',(1700,1)).save(output,format='PNG')
    src='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
    with pytest.raises(HTTPException):clean_document({'type':'doc','content':[{'type':'image','attrs':{'src':src}}]})


def test_embedded_images_export_docx_pdf_and_import_docx(fixture):
    import zipfile
    c,_,_=fixture
    content=clean_document(image_document())
    for format in ['docx','pdf']:
        r=c.post('/api/workspace/export/'+format,json={'expected_user_id':OWNER,'title':'An illustrated draft','content':content},headers=ORIGIN)
        assert r.status_code==200
        if format=='docx':
            with zipfile.ZipFile(BytesIO(r.content)) as z:assert any(name.startswith('word/media/') for name in z.namelist())
            restored=import_docx(r.content)
            images=[node for node in restored['content'] if node['type']=='image']
            assert len(images)==1 and images[0]['attrs']['alt']=='Blue garden illustration'
        else:
            pdf=PdfReader(BytesIO(r.content));assert any(len(page.images)>0 for page in pdf.pages)
            assert 'Some thoughtful words.' in pdf.pages[0].extract_text()



def test_image_exports_preserve_palette_transparency_and_photo_orientation():
    import base64
    from PIL import Image
    from lib.writing_image import png_image
    image=Image.new('P',(2,2));image.putpalette([0,0,0,0,100,255]+[0]*762)
    data=BytesIO();image.save(data,format='PNG',transparency=0)
    src='data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()
    exported,_=png_image(src)
    assert Image.open(BytesIO(exported)).getpixel((0,0))[3]==0
    image=Image.new('RGB',(3,2),'blue');exif=Image.Exif();exif[274]=6
    data=BytesIO();image.save(data,format='JPEG',exif=exif)
    src='data:image/jpeg;base64,'+base64.b64encode(data.getvalue()).decode()
    _,size=png_image(src);assert size==(2,3)


def test_portable_docx_import_notes_and_export_are_isolated_from_storage(fixture):
    from tests.test_document_portability import sample
    c, records, calls = fixture
    source = sample()
    response = c.post('/api/workspace/export/docx', json={'expected_user_id':OWNER,'title':'Portable sample','content':source}, headers=ORIGIN)
    assert response.status_code == 200
    imported = c.post('/api/workspace/import', files={'file':('portable.docx',response.content)}, headers=ORIGIN)
    assert imported.status_code == 200
    result = imported.json()
    assert result['title'] == 'Portable sample' and 'docx_compatibility' in result['warnings']
    assert any(node['type']=='table' for node in result['content']['content'])
    assert records == {} and not any(call[0]!='GET' for call in calls)


def test_malformed_docx_xml_returns_controlled_import_error(fixture):
    from zipfile import ZipFile
    c,records,_ = fixture
    output=BytesIO()
    with ZipFile(output,'w') as archive:
        archive.writestr('[Content_Types].xml','<broken')
        archive.writestr('word/document.xml','<broken')
    response=c.post('/api/workspace/import',files={'file':('broken.docx',output.getvalue())},headers=ORIGIN)
    assert response.status_code==422 and records=={}
