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
    from tests.project_helpers import install_project_boundary
    install_project_boundary(monkeypatch, rows, retrieval=retrieval, disabled=disabled)
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


async def test_rejected_coaching_retries_once_without_extra_credit(
    system, quota_store, caplog
):
    import json
    from lib.ai_quota import record_provider_call

    original = system.provider.generate_workspace
    attempts = 0

    async def generate(*args):
        nonlocal attempts
        attempts += 1
        result = await original(*args)
        await record_provider_call(system.provider.model, result.usage)
        if attempts == 1:
            parsed = json.loads(result.choices[0].message.content)
            parsed['items'][0]['text'] = 'I was walking past PRIVATE QA NARRATION.'
            result.choices[0].message.content = json.dumps(parsed)
        return result

    system.provider.generate_workspace = generate
    result = await workspace_ai.generate_assistance(system.payload, system.user)
    assert attempts == 2 and len(result['items']) == 3
    assert len(quota_store.rows) == 1
    assert len([c for c in quota_store.calls if c[0] == 'rpc/ai_coach_cost']) == 2
    assert len([c for c in system.calls if c[0] == 'saved']) == 1
    assert 'non_coaching_response' in caplog.text
    assert 'PRIVATE QA NARRATION' not in caplog.text


async def test_repeated_rejected_coaching_never_saves_or_charges(
    system, quota_store
):
    import json
    from lib.ai_quota import record_provider_call

    original = system.provider.generate_workspace
    attempts = 0

    async def generate(*args):
        nonlocal attempts
        attempts += 1
        result = await original(*args)
        await record_provider_call(system.provider.model, result.usage)
        parsed = json.loads(result.choices[0].message.content)
        parsed['items'][0]['text'] = 'Here is your rewritten paragraph: A new day.'
        result.choices[0].message.content = json.dumps(parsed)
        return result

    system.provider.generate_workspace = generate
    with pytest.raises(HTTPException) as error:
        await workspace_ai.generate_assistance(system.payload, system.user)
    assert error.value.status_code == 502
    assert attempts == 2
    assert quota_store.rows == [] and system.reservations == {}
    assert not any(c[0] == 'saved' for c in system.calls)
    assert len([c for c in quota_store.calls if c[0] == 'rpc/ai_coach_cost']) == 2
    assert any(c[0] == 'rpc/ai_coach_mark_request' for c in quota_store.calls)

@pytest.mark.parametrize('goal,headings,allocations',[(100,['Detail','Meaning'],[60,40]),(500,['Scene','Experience','Response','Reflection'],[100,200,100,100]),(1000,['Circumstances','Experience','Conflict','Outcome','Reflection'],[150,250,250,200,150])])
async def test_guided_directions_use_session_scope(system,quota_store,goal,headings,allocations):
    import json
    from models.guided_writing import GuidedSession
    system.payload.action='session_direction';system.payload.guided_session=GuidedSession(goal=goal,intention='expand')
    async def model(context,instruction,language,schema):
        assert f'Exactly {goal} words remain' in instruction
        assert 'word_allocations' in schema['properties']['items']['items']['required']
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'items':[{'title':'A meaningful detail','text':'Explore how one detail reveals a change in perspective. What makes it significant?','outline':headings,'word_allocations':allocations,'source_ids':[]}]})))],usage=SimpleNamespace(prompt_tokens=50,completion_tokens=50))
    system.provider.generate_workspace=model;result=await workspace_ai.generate_assistance(system.payload,system.user)
    assert len(result['items'])==1
    d=result['items'][0]['guided_direction'];assert d['goal']==goal and sum(s['words'] for s in d['sections'])==goal
    assert 'writing_task' not in result['items'][0]
    assert quota_store.rows[0]['feature']=='suggestion'

async def test_guided_adaptive_uses_remaining_words_and_guidance_allowance(system,quota_store):
    import json
    from models.guided_writing import GuidedSession
    system.payload.action='session_continue';system.payload.guided_session=GuidedSession(goal=500,written_words=350,intention='continue',original_direction='Explore a turning point.',session_text='A new realization in this session.')
    async def model(context,instruction,language,schema):
        assert 'Exactly 150 words remain' in instruction and '350 session words' in instruction
        assert 'UNTRUSTED GUIDED SESSION CONTEXT' in context
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'items':[{'title':'Lasting impact','text':'Consider what you understood differently afterward. Which detail shows that shift?','outline':['Impact','Reflection'],'word_allocations':[100,50],'source_ids':[]}]})))],usage=SimpleNamespace(prompt_tokens=50,completion_tokens=50))
    system.provider.generate_workspace=model;result=await workspace_ai.generate_assistance(system.payload,system.user)
    assert result['items'][0]['guided_direction']['target_words']==150 and quota_store.rows[0]['feature']=='guidance'

async def test_invalid_guided_allocation_retries_but_never_charges_or_saves(system,quota_store):
    import json
    from models.guided_writing import GuidedSession
    system.payload.action='session_direction';system.payload.guided_session=GuidedSession(goal=100);attempts=[]
    async def model(*args):
        attempts.append(1)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'items':[{'title':'A detail','text':'Explore one meaningful detail.','outline':['Detail'],'word_allocations':[99],'source_ids':[]}]})))],usage=SimpleNamespace(prompt_tokens=50,completion_tokens=50))
    system.provider.generate_workspace=model
    with pytest.raises(HTTPException) as e:await workspace_ai.generate_assistance(system.payload,system.user)
    assert e.value.status_code==502 and len(attempts)==2 and quota_store.rows==[]
    assert not any(c[0]=='saved' for c in system.calls)

async def test_guided_adaptive_cannot_transmit_unauthorized_draft_or_session_text(system,monkeypatch):
    import json
    from models.guided_writing import GuidedSession
    from lib import projects
    system.payload.action='session_continue';system.payload.current_text='FORBIDDEN CURRENT DRAFT';system.payload.guided_session=GuidedSession(goal=500,written_words=350,session_text='FORBIDDEN SESSION TEXT')
    original_scope=projects.resolve_scope
    async def scope(user,payload):
        await original_scope(user,payload)
        return {'scope':'profile_only','project_id':None,'project':None,'profile_enabled':True,'source_ids':[],'document_ids':[],'request_document_ids':[],'memory_ids':[],'session_ids':[],'suggestion_ids':[],'feedback_ids':[],'resource_count':0}
    monkeypatch.setattr(projects,'resolve_scope',scope)
    async def model(context,instruction,language,schema):
        assert 'FORBIDDEN CURRENT DRAFT' not in context and 'FORBIDDEN SESSION TEXT' not in context
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'items':[{'title':'A meaningful question','text':'Consider one unresolved question. What could you explore?','outline':['Question','Reflection'],'word_allocations':[100,50],'source_ids':[]}]})))],usage=SimpleNamespace(prompt_tokens=50,completion_tokens=50))
    system.provider.generate_workspace=model
    assert (await workspace_ai.generate_assistance(system.payload,system.user))['items'][0]['guided_direction']['target_words']==150
