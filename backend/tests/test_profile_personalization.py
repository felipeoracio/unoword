"""Canonical profile edits, clears, permissions and actual provider input."""
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from lib.personalization import effective_profile, contextual_answers
from lib.ai_provider import SuggestionProviderResponse, SuggestionUsage
from models.ai import AIProfileUpdate, AISuggestionRequest, AISuggestionResult
from routers import ai


def test_onboarding_reused_until_explicit_edits_and_clears():
    answers = [{'question_id':'writingGoal','answer':'Old gardening goal'},{'question_id':'primary_topics','answer':'gardening, plants'}]
    initial = effective_profile({'id':'p'}, answers)
    assert initial['primary_topics'] == ['gardening','plants']
    edited = {'id':'p','writing_goal':None,'primary_topics':[], 'ai_preferences':{'profile_edited':True}}
    assert effective_profile(edited, answers) == edited
    assert contextual_answers(edited, answers) == []

@pytest.mark.parametrize('mode', ['new_topic','expand_idea','connect_dots'])
async def test_each_request_uses_latest_profile_at_provider_boundary(monkeypatch, mode, quota_store):
    user = SimpleNamespace(id='writer-a',access_token='a-token')
    profile = {'id':'profile','writing_goal':'Educational gardening posts','writing_style':'encouraging', 'audience':'apartment gardeners', 'primary_topics':['urban gardening'], 'ai_preferences':{'prompt_themes':['sustainability'],'profile_edited':True},'updated_at':'2026-10-21T00:00:00Z'}
    records = {'ai_profiles':[profile], 'ai_onboarding_answers':[{'id':'old','question_id':'writingGoal','answer':'OBSOLETE_PREFERENCE'}],
        'ai_memories':[], 'ai_documents':[{'id':'a','summary':'Observation of stars.', 'document_title':'Stargazing'}, {'id':'b','summary':'Building fictional worlds.', 'document_title':'Worldbuilding'}],
        'ai_suggestions':[{'source_ids':['profile'],'created_at':'2026-10-20T00:00:00Z','suggestion':'OBSOLETE_HISTORY'}]}
    contexts=[]
    async def rows(table, owner, **kwargs):
        assert owner is user
        return records[table]
    async def noop(*args, **kwargs): return {}
    async def disabled(*args): return set()
    async def passages(*args, **kwargs): return []
    async def store(*args, json, **kwargs): return [json]
    class Provider:
        name,model='test','model'
        async def generate_suggestion(self, context, **kwargs):
            contexts.append(context)
            return SuggestionProviderResponse(AISuggestionResult(title='A topic',suggestion='A direction',why='Personal interests',source_ids=['profile','a','b']),SuggestionUsage(1,1))
    for key,value in {'_user_rows':rows,'_entitlement':noop,'user_rest':store,'retrieve_user_chunks':passages,'diverse_passages':passages,'get_suggestion_provider':Provider}.items(): monkeypatch.setattr(ai,key,value)
    monkeypatch.setattr(ai.knowledge,'disabled_source_ids',disabled)
    monkeypatch.setattr(ai.knowledge,'heal_missing_embeddings',noop)
    payload=AISuggestionRequest(mode=mode,current_writing='My current draft about community science.' if mode=='expand_idea' else None)
    await ai.create_suggestion(payload,user)
    assert all(x in contexts[-1] for x in ['Educational gardening','encouraging','apartment gardeners','sustainability'])
    profile.update(writing_goal='Science fiction stories',writing_style='lyrical',audience='young adults',primary_topics=['astronomy'],ai_preferences={'prompt_themes':['science'],'profile_edited':True})
    await ai.create_suggestion(payload,user)
    assert all(x in contexts[-1] for x in ['Science fiction','young adults','astronomy','lyrical'])
    assert all(x not in contexts[-1] for x in ['gardening','sustainability','OBSOLETE_PREFERENCE','OBSOLETE_HISTORY'])
    assert len(contexts[-1]) <= ai.MAX_CONTEXT_CHARS
    if mode=='expand_idea': assert payload.current_writing in contexts[-1]
    profile.update(writing_goal=None,writing_style=None,audience=None,primary_topics=[],ai_preferences={'prompt_themes':[],'profile_edited':True})
    await ai.create_suggestion(payload,user)
    assert 'Science fiction' not in contexts[-1] and 'astronomy' not in contexts[-1]

async def test_profile_owner_and_free_theme_permissions(monkeypatch):
    user=SimpleNamespace(id='writer-a',access_token='a-token')
    writes=[]
    async def rows(*args,**kwargs): return [{'user_id':user.id,'ai_preferences':{'prompt_themes':['ideas']}}]
    async def entitlement(*args): return None
    async def store(*args,json,**kwargs):
        writes.append(json);return [json]
    monkeypatch.setattr(ai,'_user_rows',rows);monkeypatch.setattr(ai,'get_entitlement',entitlement);monkeypatch.setattr(ai,'user_rest',store)
    with pytest.raises(HTTPException) as mismatch: await ai.update_profile(AIProfileUpdate(expected_user_id='writer-b'),user)
    assert mismatch.value.status_code==409 and writes==[]
    with pytest.raises(HTTPException) as forbidden: await ai.update_profile(AIProfileUpdate(ai_preferences={'prompt_themes':['science']}),user)
    assert forbidden.value.status_code==403 and writes==[]
    result=await ai.update_profile(AIProfileUpdate(expected_user_id=user.id,writing_goal=None,primary_topics=[]),user)
    assert result.user_id==user.id and result.writing_goal is None
    assert writes[0]['ai_preferences']=={'prompt_themes':['ideas'],'profile_edited':True}
    assert 'expected_user_id' not in writes[0]
