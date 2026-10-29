"""Model-boundary tests for editor personalization, consented sources and quota."""

from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from lib import workspace_ai
from routers import ai


@pytest.fixture
def system(monkeypatch, quota_store):
    user = SimpleNamespace(id="writer", access_token="user-token")
    state = {
        "ai_profiles": [
            {
                "id": "profile",
                "user_id": "writer",
                "writing_goal": "Reflective gardening essays",
                "primary_topics": ["gardens"],
                "ai_preferences": {"profile_edited": True},
            }
        ],
        "ai_onboarding_answers": [],
        "ai_memories": [
            {
                "id": "memory",
                "source_id": "revoked",
                "memory": "REVOKED SECRET",
                "memory_type": "theme",
            }
        ],
        "ai_suggestions": [
            {
                "id": "old",
                "source_ids": ["removed"],
                "suggestion": "DELETED SOURCE QUOTE",
                "status": "shown",
            }
        ],
        "ai_feedback": [
            {
                "helpful": False,
                "reason": "too_vague",
                "note": "Prefer specific, practical angles",
            }
        ],
        "ai_documents": [
            {
                "id": "reference",
                "document_title": "Community gardens",
                "summary": "Shared planting and observation",
                "source_kind": "file",
            }
        ],
        "writing_documents": [
            {
                "id": "authorized",
                "title": "Shared essay",
                "plain_text": "A CONSENTED DOCUMENT",
            }
        ],
    }
    calls = []
    quota_store.daily = 2
    async def saved(records): calls.append(("saved", records))
    quota_store.on_complete = saved
    reservations = quota_store.reservations

    async def rows(table, owner, *, extra):
        assert owner is user
        if table == "writing_documents":
            assert extra["ai_allowed"] == "eq.true" and extra["status"] == "eq.active"
        return state.get(table, [])

    async def entitlement(_):
        return {"daily_request_limit": 2, "plan": "pro"}

    async def disabled(*_):
        return {"revoked"}

    async def retrieval(*_):
        return []

    async def record(*args, **kwargs):
        calls.append(("usage", kwargs))

    async def save(method, table, token, **kwargs):
        assert method == "POST" and table == "ai_suggestions" and token == "user-token"
        calls.append(("saved", kwargs["json"]))

    class Provider:
        model = "configured-model"
        name = "openai"
        fail = False

        async def generate_workspace(self, context, instruction, language, schema):
            calls.append(("model", context, instruction, language))
            if self.fail:
                raise RuntimeError("provider-private-details")
            import json

            count = schema["properties"]["items"]["minItems"]
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "items": [
                                        {
                                            "title": f"Angle {i}",
                                            "text": "Consider a specific writing direction.",
                                            "replacement": None,
                                        }
                                        for i in range(count)
                                    ]
                                }
                            )
                        )
                    )
                ],
                usage=SimpleNamespace(prompt_tokens=100, completion_tokens=100),
            )

    provider = Provider()
    monkeypatch.setattr(ai, "_user_rows", rows)
    monkeypatch.setattr(workspace_ai, "get_entitlement", entitlement)
    monkeypatch.setattr(workspace_ai, "get_suggestion_provider", lambda: provider)
    monkeypatch.setattr(workspace_ai, "user_rest", save)
    monkeypatch.setattr(workspace_ai.knowledge, "disabled_source_ids", disabled)
    monkeypatch.setattr(workspace_ai, "retrieve_user_chunks", retrieval)
    payload = SimpleNamespace(
        document_id="current-draft",
        action="next",
        language="en",
        current_text="A draft shared with one-request consent.",
        selected_text="",
    )
    return SimpleNamespace(
        user=user,
        state=state,
        calls=calls,
        reservations=reservations,
        provider=provider,
        payload=payload,
    )


async def test_three_directions_use_current_profile_and_authorized_context(system):
    result = await workspace_ai.generate_assistance(system.payload, system.user)
    assert len(result["items"]) == 3
    context = next(call[1] for call in system.calls if call[0] == "model")
    assert (
        "Reflective gardening essays" in context and "A CONSENTED DOCUMENT" in context
    )
    assert "Prefer specific, practical angles" in context
    assert "REVOKED SECRET" not in context and "DELETED SOURCE QUOTE" not in context
    system.state["ai_profiles"][0][
        "writing_goal"
    ] = "Contemporary astronomy for curious readers"
    await workspace_ai.generate_assistance(system.payload, system.user)
    assert (
        "Contemporary astronomy"
        in [call[1] for call in system.calls if call[0] == "model"][-1]
    )
    assert all(value["state"] == "done" for value in system.reservations.values())


async def test_quota_stops_model_before_a_third_call(system):
    await workspace_ai.generate_assistance(system.payload, system.user)
    await workspace_ai.generate_assistance(system.payload, system.user)
    with pytest.raises(HTTPException) as error:
        await workspace_ai.generate_assistance(system.payload, system.user)
    assert error.value.status_code == 429
    assert len([call for call in system.calls if call[0] == "model"]) == 2


async def test_provider_failure_releases_reservation_and_hides_private_error(system):
    system.provider.fail = True
    with pytest.raises(HTTPException) as error:
        await workspace_ai.generate_assistance(system.payload, system.user)
    assert (
        error.value.status_code == 502
        and error.value.detail == "ai_assistance_unavailable"
    )
    assert system.reservations == {}


async def test_guidance_only_returns_questions_not_replacements(system):
    system.payload.action = "guidance"
    system.payload.language = "es"
    result = await workspace_ai.generate_assistance(system.payload, system.user)
    assert len(result["items"]) == 1
    call = next(call for call in system.calls if call[0] == "model")
    assert "Never supply a sentence" in call[2] and call[3] == "es"
    assert all(not item.get('replacement') for item in result['items'])

async def test_editor_and_guidance_use_remaining_words(system):
    from datetime import datetime,timezone
    from models.writing_goal import WritingProgress
    now=datetime.now(timezone.utc)
    system.payload.writing_progress=WritingProgress(daily_goal=1000,words_written_today=750,timezone='UTC',date=now.date(),captured_at=now)
    result=await workspace_ai.generate_assistance(system.payload,system.user)
    assert all(item['writing_task']['target_words']==250 for item in result['items'])
    assert '"target_words": 250' in next(call[1] for call in system.calls if call[0]=='model')
    system.payload.action='guidance'
    result=await workspace_ai.generate_assistance(system.payload,system.user)
    assert all(item['writing_task']['target_words']==250 for item in result['items'])
