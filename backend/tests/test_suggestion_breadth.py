"""Keep broad interests and novelty available even when passages are long."""

from types import SimpleNamespace

import pytest

from lib.ai_provider import SuggestionProviderResponse, SuggestionUsage
from lib.retrieval import RetrievedChunk
from lib.writing_context import library_overview
from models.ai import AISuggestionRequest, AISuggestionResult
from routers import ai


def test_long_passages_cannot_crowd_out_interests_history_or_other_sources():
    profile = [{"id": "profile", "favorite_subjects": ["urban gardens", "family rituals"],
                "avoid_topics": ["politics"], "writing_goal": "Personal essays"}]
    sources = [
        {"id": "file", "document_title": "Family recipes", "summary": "Meals as a form of care."},
        {"id": "link", "source_kind": "link", "document_title": "City gardens",
         "summary": "Growing food in shared spaces."},
    ]
    memories = [
        {"id": "memory", "memory_type": "interest", "memory": "I love listening to jazz."},
        {"id": "writing", "source_id": "session", "memory_type": "experience",
         "memory": "A saved reflection about learning to ask for help."},
    ]
    previous = [{"title": "The kitchen table", "suggestion": "Describe a family meal.", "status": "shown"}]
    retrieved = [RetrievedChunk("document_chunk", f"chunk{i}", "file", "flour " * 500, 0.8)
                 for i in range(6)]
    draft = "word " * 600
    context, ids = ai._compose_prompt_context(
        AISuggestionRequest(current_writing=draft), profile,
        [{"id": "answer", "question": "Who is your audience?", "answer": "New writers"}],
        memories, previous, retrieved, sources,
    )
    assert len(context) <= ai.MAX_CONTEXT_CHARS
    assert draft[:ai.MAX_DRAFT_CHARS] in context
    for text in ("urban gardens", "politics", "The kitchen table", "Family recipes",
                 "City gardens", "jazz", "ask for help", "New writers", "flour"):
        assert text in context
    assert {"profile", "memory", "writing", "file", "link", "answer"} <= set(ids)


def test_overview_deduplicates_source_memories_and_ignores_disabled_sources():
    sources = [
        {"id": "a", "document_title": "Recipes", "summary": "Cooking together"},
        {"id": "disabled", "enabled": False, "document_title": "Hidden source"},
    ]
    memories = [
        {"id": "derived", "source_id": "a", "memory": "Cooking together"},
        {"id": "hidden-memory", "source_id": "disabled", "memory": "Hidden text"},
        {"id": "personal", "memory": "I enjoy birdwatching."},
    ]
    overview = library_overview(sources, memories, [])
    assert len(overview) == 2
    assert sum("Cooking together" in text for text, _ in overview) == 1
    assert all("Hidden" not in text for text, _ in overview)
    assert any(set(ids) == {"a", "derived"} for _, ids in overview)


def test_less_recently_surfaced_sources_rotate_into_bounded_overview():
    sources = [{"id": str(i), "document_title": f"Topic {i}", "summary": f"Interest {i}"}
               for i in range(30)]
    previous = [{"source_ids": [str(i) for i in range(12)]}]
    context, ids = ai._compose_prompt_context(AISuggestionRequest(), [], [], [], previous, [], sources)
    assert set(ids) == {str(i) for i in range(12, 24)}
    assert 'file "Topic 0"' not in context
    assert len(context) <= ai.MAX_CONTEXT_CHARS


@pytest.mark.asyncio
@pytest.mark.parametrize("focused", [False, True])
async def test_suggestion_route_includes_library_and_only_this_users_enabled_context(monkeypatch, focused):
    user = SimpleNamespace(id="writer-a", access_token="test-token")
    captured = {}
    records = {
        "ai_profiles": [{"id": "profile", "writing_goal": "Creative essays", "favorite_subjects": ["music"]}],
        "ai_onboarding_answers": [],
        "ai_memories": [{"id": "hidden-memory", "source_id": "disabled", "memory": "SECRET_DISABLED"},
                        {"id": "personal", "memory": "I like astronomy."}],
        "ai_documents": [{"id": "file", "document_title": "Recipe notes", "summary": "Family meals"},
                         {"id": "link", "source_kind": "link", "document_title": "Garden article",
                          "summary": "Urban gardens"}],
        "ai_suggestions": [{"title": "Yesterday's topic", "suggestion": "Write about a recipe."}],
    }

    async def rows(table, current_user, *, extra):
        assert current_user is user
        if table == "ai_documents":
            assert extra["enabled"] == "eq.true"
            assert extra["processing_status"] == "eq.ready"
        return records[table]

    async def disabled(user_id, token):
        assert (user_id, token) == (user.id, user.access_token)
        return {"disabled"}

    async def retrieve(user_id, query):
        assert user_id == user.id
        captured["query"] = query
        return []

    async def noop(*args, **kwargs):
        return {}

    async def store(method, table, token, *, json, prefer):
        assert token == user.access_token
        return [json]

    class Provider:
        name, model = "test", "test-model"

        async def generate_suggestion(self, context, **kwargs):
            captured["context"] = context
            return SuggestionProviderResponse(
                AISuggestionResult(title="A new angle", suggestion="Explore an unexpected interest.",
                                   why="It connects with your broader interests.", related_topics=[]),
                SuggestionUsage(100, 20),
            )

    monkeypatch.setattr(ai, "_user_rows", rows)
    monkeypatch.setattr(ai, "_entitlement", noop)
    monkeypatch.setattr(ai, "_resolve_daily_limit", lambda _: 0)
    monkeypatch.setattr(ai, "_record_usage", noop)
    monkeypatch.setattr(ai, "user_rest", store)
    monkeypatch.setattr(ai.knowledge, "disabled_source_ids", disabled)
    monkeypatch.setattr(ai.knowledge, "heal_missing_embeddings", noop)
    monkeypatch.setattr(ai, "retrieve_user_chunks", retrieve)
    async def passages(user, retrieved, sources, **kwargs):
        return retrieved
    monkeypatch.setattr(ai, "diverse_passages", passages)
    monkeypatch.setattr(ai, "get_suggestion_provider", Provider)
    payload = AISuggestionRequest(current_writing="Continue my poem about rain." if focused else None)
    result = await ai.create_suggestion(payload, user)
    for text in ("astronomy", "music", "Urban gardens", "Family meals", "Yesterday's topic"):
        assert text in captured["context"]
    assert "SECRET_DISABLED" not in captured["context"]
    assert "hidden-memory" not in result.source_ids
    if focused:
        assert captured["query"] == payload.current_writing
        assert payload.current_writing in captured["context"]
    else:
        assert "astronomy" in captured["query"]
