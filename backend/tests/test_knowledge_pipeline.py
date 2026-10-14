"""AI Knowledge Pipeline end-to-end tests (A-G) against the live backend + Supabase.

A: document upload -> chunks + embeddings      B: link -> chunks + embeddings
C: automatic per-source writing memory         D: suggestions use document/link context
E: disable/delete removes a source from context F: user isolation
G: failure handling (no embeddings, summary failure, bad file, bad/unreachable link)

Uses shared module fixtures; pytest.ini runs with --dist loadscope (one worker per module).
"""

from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest

from tests.conftest import API_URL

MARKER = f"Quenneville{uuid.uuid4().hex[:6]}"
DOC_TEXT = (
    f"My uncle Bartholomew {MARKER} restored antique lighthouse lenses in the harbor of Valparaiso. "
    "Every winter he polished the brass frames and told me stories about ships lost in the fog. "
    "I want to write about the lighthouse, the fog horn, and the smell of lamp oil in his workshop."
)
DRAFT = "I keep thinking about the lighthouse lenses my uncle restored and the fog over the harbor."


def _client(token: str) -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=120.0, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture(scope="module")
def ca(user_a_token):
    with _client(user_a_token) as c:
        yield c


@pytest.fixture(scope="module")
def cb(user_b_token):
    with _client(user_b_token) as c:
        yield c


@pytest.fixture(scope="module", autouse=True)
def reset_daily_usage(ca, cb):
    """Repeatable runs: clear today's usage rows for the two test accounts only."""
    from lib.dates import today_iso
    from lib.supabase_client import service_rest

    for client in (ca, cb):
        user_id = client.get("/ai/profile").json()["user_id"]
        asyncio.run(service_rest("DELETE", "ai_usage", params={
            "user_id": f"eq.{user_id}", "date": f"eq.{today_iso()}"}))


@pytest.fixture(scope="module")
def doc(ca):
    r = ca.post(
        "/documents/upload",
        files={"file": ("lighthouse.txt", DOC_TEXT.encode(), "text/plain")},
        data={"document_title": "Uncle's lighthouse", "document_type": "other"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    yield body
    ca.delete(f"/documents/{body['id']}")


@pytest.fixture(scope="module")
def link(ca):
    tag = uuid.uuid4().hex[:8]
    r = ca.post("/links", json={"url": f"https://example.com/?unoword={tag}", "title": f"Pipeline link {tag}"})
    assert r.status_code == 201, r.text
    body = r.json()
    yield body
    ca.delete(f"/links/{body['id']}")


def _suggest(client: httpx.Client, draft: str = DRAFT) -> dict:
    r = client.post("/ai/suggestion", json={"current_writing": draft})
    assert r.status_code == 200, r.text
    return r.json()


def _index(client: httpx.Client, doc_id: str) -> dict:
    r = client.get(f"/documents/{doc_id}/index-status")
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- A ----------------
def test_a_document_upload_is_chunked_and_embedded(ca, doc):
    assert doc["processing_status"] == "ready"
    assert doc["processing_error"] is None
    status = _index(ca, doc["id"])
    assert status["chunk_count"] >= 1
    assert status["embedded_chunk_count"] == status["chunk_count"]


# ---------------- B ----------------
def test_b_link_is_chunked_and_embedded(ca, link):
    assert link["processing_status"] == "ready", link
    assert link["word_count"] > 0
    status = _index(ca, link["id"])
    assert status["chunk_count"] >= 1
    assert status["embedded_chunk_count"] == status["chunk_count"]


# ---------------- C ----------------
def test_c_writing_memory_is_built_per_source(ca, doc, link):
    memories = ca.get("/ai/memories").json()
    doc_mem = [m for m in memories if m.get("source_id") == doc["id"]]
    link_mem = [m for m in memories if m.get("source_id") == link["id"]]
    assert len(doc_mem) == 1 and len(link_mem) == 1
    assert "lighthouse" in doc_mem[0]["memory"].lower()
    assert _index(ca, doc["id"])["memory_ids"] == [doc_mem[0]["id"]]
    refreshed = ca.get(f"/documents/status/{doc['id']}").json()
    assert refreshed.get("summary")


def test_c_saved_writing_session_builds_memory(ca):
    r = ca.post("/ai/writing-sessions", json={
        "word_count": 30, "writing_duration_seconds": 60, "save_to_memory": True,
        "content": "Today I wrote about my grandmother's beehives behind the orchard and the honey we sold at the market.",
    })
    assert r.status_code == 201, r.text
    session_id = r.json()["id"]
    memories = [m for m in ca.get("/ai/memories").json() if m.get("source_id") == session_id]
    assert len(memories) == 1 and memories[0]["memory_type"] == "experience"
    ca.delete(f"/ai/memories/{memories[0]['id']}")


# ---------------- D ----------------
def test_d_suggestion_uses_document_context(ca, doc):
    s = _suggest(ca)
    assert MARKER in s["context_summary"], s["context_summary"][:800]
    memory_ids = _index(ca, doc["id"])["memory_ids"]
    assert set(memory_ids) & set(s["source_ids"])


def test_d_suggestion_uses_link_context(ca, link):
    s = _suggest(ca, "Writing about domains used for documentation and illustrative examples.")
    memory_ids = _index(ca, link["id"])["memory_ids"]
    assert set(memory_ids) & set(s["source_ids"]) or "example" in s["context_summary"].lower()
    assert "Example Domain" in s["context_summary"] or "documentation" in s["context_summary"].lower()


# ---------------- E ----------------
def test_e_disabled_link_is_excluded(ca, link):
    memory_ids = set(_index(ca, link["id"])["memory_ids"])
    assert ca.patch(f"/links/{link['id']}", json={"enabled": False}).status_code == 200
    try:
        s = _suggest(ca, "Writing about domains used for documentation and illustrative examples.")
        assert not memory_ids & set(s["source_ids"])
        assert link["document_title"] not in s["context_summary"]
    finally:
        ca.patch(f"/links/{link['id']}", json={"enabled": True})


def test_e_deleted_document_is_removed_everywhere(ca):
    marker = f"Zorvathi{uuid.uuid4().hex[:6]}"
    r = ca.post(
        "/documents/upload",
        files={"file": ("tmp.txt", f"The {marker} glassblowers of Murano taught me patience.".encode(), "text/plain")},
        data={"document_title": "Glassblowers", "document_type": "other"},
    )
    assert r.status_code == 201, r.text
    doc_id = r.json()["id"]
    assert ca.delete(f"/documents/{doc_id}").status_code == 204
    assert ca.get(f"/documents/{doc_id}/index-status").status_code == 404
    assert not [m for m in ca.get("/ai/memories").json() if m.get("source_id") == doc_id]
    s = _suggest(ca, "The glassblowers of Murano and what they taught me.")
    assert marker not in s["context_summary"]


# ---------------- F ----------------
def test_f_user_isolation(ca, cb, doc):
    assert cb.get(f"/documents/{doc['id']}/index-status").status_code == 404
    assert not [m for m in cb.get("/ai/memories").json() if m.get("source_id") == doc["id"]]
    s = _suggest(cb)
    assert MARKER not in s["context_summary"]
    a_ids = set(_index(ca, doc["id"])["memory_ids"])
    assert not a_ids & set(s["source_ids"])


# ---------------- G ----------------
def test_g_bad_file_and_bad_links_are_rejected(ca):
    r = ca.post("/documents/upload", files={"file": ("x.png", b"\x89PNG....", "image/png")},
                data={"document_title": "img"})
    assert r.status_code == 422
    assert ca.post("/links", json={"url": "http://127.0.0.1/admin"}).status_code == 400
    assert ca.post("/links", json={"url": "file:///etc/passwd"}).status_code == 400


def test_g_unreachable_link_fails_cleanly(ca):
    r = ca.post("/links", json={"url": f"https://unoword-{uuid.uuid4().hex[:10]}.invalid/page"})
    assert r.status_code in (201, 400), r.text
    if r.status_code == 201:
        body = r.json()
        try:
            assert body["processing_status"] == "failed" and body["processing_error"]
            assert _index(ca, body["id"])["chunk_count"] == 0
        finally:
            ca.delete(f"/links/{body['id']}")


class _NoEmbeddings:
    enabled = False


def test_g_embedding_outage_keeps_content_and_heals(ca, monkeypatch):
    from lib import knowledge, retrieval
    from lib.supabase_client import service_rest

    user_id = ca.get("/ai/profile").json()["user_id"]
    marker = f"Kestrelwood{uuid.uuid4().hex[:6]}"
    doc_id = str(uuid.uuid4())

    async def run():
        await service_rest("POST", "ai_documents", json={
            "id": doc_id, "user_id": user_id, "source_kind": "link",
            "source_url": f"https://example.com/{doc_id}", "filename": "example.com",
            "file_type": "text/html", "document_title": "Outage test", "document_type": "reference",
            "processing_status": "ready", "word_count": 5,
        }, prefer="return=minimal")
        try:
            with monkeypatch.context() as m:
                m.setattr(knowledge, "get_embeddings_service", lambda: _NoEmbeddings())
                m.setattr(retrieval, "get_embeddings_service", lambda: _NoEmbeddings())
                count, embedded = await knowledge.index_source(
                    user_id, None, doc_id, f"The {marker} falcons nest in the old quarry.", {})
                assert (count, embedded) == (1, 0)
                hits = await retrieval.retrieve_user_chunks(user_id, f"{marker} falcons quarry")
                assert any(marker in h.content and h.match == "keyword" for h in hits)
            assert await knowledge.heal_missing_embeddings(user_id) >= 1
            rows = await service_rest("GET", "ai_document_chunks", params={
                "select": "id", "document_id": f"eq.{doc_id}", "embedding": "is.null"})
            assert rows == []
        finally:
            await service_rest("DELETE", "ai_documents", params={"id": f"eq.{doc_id}"})

    asyncio.run(run())


def test_g_summary_failure_falls_back_to_extractive(ca, monkeypatch):
    from lib import ai_provider, knowledge
    from lib.supabase_client import service_rest

    class _Broken:
        async def summarize(self, title, text):
            raise RuntimeError("model down")

    monkeypatch.setattr(ai_provider, "get_suggestion_provider", lambda: _Broken())
    user_id = ca.get("/ai/profile").json()["user_id"]
    source_id = str(uuid.uuid4())

    async def run():
        try:
            memory = await knowledge.rebuild_source_memory(
                user_id, None, source_id, title="Notes", text="Rivers carve canyons. Time is patient.",
                kind="writing session")
            assert memory and "Rivers carve canyons." in memory
        finally:
            await service_rest("DELETE", "ai_memories", params={"source_id": f"eq.{source_id}"})

    asyncio.run(run())


def test_g_thresholds_fit_embedding_model():
    from lib import retrieval
    from lib.knowledge import CHUNK_CHARS, keyword_terms

    assert retrieval.MATCH_THRESHOLD <= 0.3 and retrieval.MIN_ADJUSTED_SIMILARITY <= 0.25
    assert CHUNK_CHARS <= 2000
    assert keyword_terms("The lighthouse and the fog, the LIGHTHOUSE again") == ["lighthouse", "again"]


def test_c_refresh_rebuilds_missing_link_memory(ca, link):
    for mid in _index(ca, link["id"])["memory_ids"]:
        ca.delete(f"/ai/memories/{mid}")
    assert _index(ca, link["id"])["memory_ids"] == []
    r = ca.post(f"/links/{link['id']}/refresh")
    assert r.status_code == 200 and r.json()["processing_status"] == "ready", r.text
    assert len(_index(ca, link["id"])["memory_ids"]) == 1
