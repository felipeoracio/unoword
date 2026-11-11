"""AI document controls are access-controlled (acceptance matrix criterion 2).

Signed-out requests must not reach document data, and an authenticated Pro
user (server-side entitlement in ai_entitlements, not the extension's local
demo plan) must be able to list their private documents.
"""

import io

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def anonymous_client():
    # Exercise the actual routes without requiring a live server or account.
    from server import app

    with TestClient(app, base_url="https://unoword.app", headers={"Origin": "https://unoword.app"}) as client:
        yield client


def test_signed_out_cannot_list_documents(anonymous_client):
    response = anonymous_client.get("/api/documents")
    assert response.status_code == 401, response.text


def test_signed_out_cannot_upload_document(anonymous_client):
    response = anonymous_client.post(
        "/api/documents/upload",
        data={"document_title": "tscheck-doc-access-anon", "document_type": "notes"},
        files={"file": ("tscheck-anon.txt", io.BytesIO(b"anonymous upload attempt"), "text/plain")},
    )
    assert response.status_code == 401, response.text


def test_authenticated_pro_user_can_list_documents(client_a):
    response = client_a.get("/documents")
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), list)
