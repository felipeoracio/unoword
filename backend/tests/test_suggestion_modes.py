"""Modes, actual text grounding, source attribution, saving and access guards."""
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
from lib import ai_access, suggestion_knowledge
from lib.ai_provider import OpenAISuggestionProvider, SuggestionProviderResponse, SuggestionUsage
from lib.auth import AuthenticatedUser, require_user
from models.ai import AISuggestionResult
from routers import ai

A, B, D1, D2 = [str(uuid4()) for _ in range(4)]
TEXT1 = 'Fictional: Neri measures the tide twice before launching a solar ferry at Mist Harbor.'
TEXT2 = 'Fictional: Ivo tests clay kiln temperatures with three witness cones before firing blue bowls.'
QUESTIONS = ['What observation changes the decision?', 'What does the second test reveal?', 'How could this matter to a reader?']

@pytest.fixture
def system(monkeypatch):
    state = {name:[] for name in ('ai_profiles','ai_onboarding_answers','ai_memories','ai_suggestions','ai_usage','ai_feedback')}
    state['ai_documents'] = [dict(id=sid,user_id=A,source_kind='file',document_title=title,summary=text,enabled=True,processing_status='ready')
        for sid,title,text in [(D1,'Solar ferries',TEXT1),(D2,'Clay workshop',TEXT2)]]
    state['ai_document_chunks'] = [dict(id=str(uuid4()),user_id=A,document_id=sid,content=text) for sid,text in [(D1,TEXT1),(D2,TEXT2)]]
    calls = []
    def filtered(table, params):
        rows = list(state.get(table, []))
        for key, condition in (params or {}).items():
            if key in {'select','order','limit','offset','on_conflict'}: continue
            if condition.startswith('eq.'):
                rows = [r for r in rows if str(r.get(key)).lower()==condition[3:].lower()]
            elif condition.startswith('in.('):
                rows = [r for r in rows if str(r.get(key)) in condition[4:-1].split(',')]
            elif condition=='not.is.null':
                rows = [r for r in rows if r.get(key) is not None]
        return rows[:int((params or {}).get('limit','1000'))]
    async def rest(method,table,token,params=None,json=None,prefer=None):
        owner = A if token=='token-a' else B
        params = {**(params or {}),'user_id':f'eq.{owner}'}
        if method=='GET': return filtered(table,params)
        if method=='POST':
            assert json['user_id']==owner
            row = {'id':str(uuid4()),**json}
            if table=='ai_memories': state[table] = [r for r in state[table] if r['id']!=row['id']]
            state[table].insert(0,row)
            return [row]
        if method=='PATCH':
            rows = filtered(table,params)
            for row in rows: row.update(json)
            return rows
        raise AssertionError((method,table))
    async def rows(table,user,*,extra): return await rest('GET',table,user.access_token,params=extra)
    async def service(method,table,params=None,json=None,prefer=None):
        if method=='GET': return filtered(table,params)
        state[table].insert(0,{'id':str(uuid4()),**json})
        return []
    async def entitlement(_): return {'plan':'pro','daily_request_limit':100}
    async def noop(*args,**kwargs): return []
    async def disabled(*args): return set()
    class Provider:
        name,model = 'test','test-model'
        cited = [D1,D2]
        async def generate_suggestion(self,context,*,mode,language):
            calls.append(dict(context=context,mode=mode,language=language))
            return SuggestionProviderResponse(AISuggestionResult(title='Tests before a leap',suggestion='Connect the fictional crafts through observation before commitment.',
                why='Both crafts involve concrete tests.',questions=QUESTIONS,source_ids=self.cited),SuggestionUsage(200,100))
    provider = Provider()
    for name,value in [('_user_rows',rows),('user_rest',rest),('service_rest',service),('_entitlement',entitlement),
                       ('_resolve_daily_limit',lambda _:100),('get_suggestion_provider',lambda:provider),
                       ('get_embeddings_service',lambda:SimpleNamespace(enabled=False)),('retrieve_user_chunks',noop)]:
        monkeypatch.setattr(ai,name,value)
    monkeypatch.setattr(ai.knowledge,'heal_missing_embeddings',noop)
    monkeypatch.setattr(ai.knowledge,'disabled_source_ids',disabled)
    monkeypatch.setattr(suggestion_knowledge,'user_rest',rest)
    app = FastAPI()
    app.include_router(ai.router,prefix='/api')
    def user(x_user:str=Header(default='a')):
        return AuthenticatedUser(id=A if x_user=='a' else B,plan='pro',access_token=f'token-{x_user}')
    app.dependency_overrides[ai.require_ai_user]=user
    with TestClient(app) as client: yield SimpleNamespace(client=client,state=state,calls=calls,provider=provider)

@pytest.mark.parametrize('mode',['new_topic','expand_idea','connect_dots'])
@pytest.mark.parametrize('language',['en','es'])
def test_mode_and_actual_text_reach_provider(system,mode,language):
    payload = dict(mode=mode,language=language)
    if mode=='expand_idea': payload['current_writing']='My actual idea concerns observation before commitment.'
    response = system.client.post('/api/ai/suggestion',json=payload)
    assert response.status_code==200,response.text
    body = response.json()
    assert body['mode']==mode and len(body['questions'])==3
    assert {s['source_id'] for s in body['inspired_by']}=={D1,D2}
    call = system.calls[-1]
    assert (call['mode'],call['language'])==(mode,language)
    assert 'measures the tide twice' in call['context'] and 'three witness cones' in call['context']
    assert len(system.state['ai_usage'])==1 and system.state['ai_usage'][0]['request_type']=='suggestion'

def test_selected_idea_uses_actual_body_and_enforces_ownership(system):
    response = system.client.post('/api/ai/suggestion',json=dict(mode='expand_idea',idea_source_id=D1))
    assert response.status_code==200,response.text
    assert TEXT1 in system.calls[-1]['context'].split('Broader shared')[0]
    foreign = system.client.post('/api/ai/suggestion',headers={'x-user':'b'},json=dict(mode='expand_idea',idea_source_id=D1))
    assert foreign.status_code==404

def test_expand_requires_real_input_without_spending_allowance(system):
    assert system.client.post('/api/ai/suggestion',json={'mode':'expand_idea'}).status_code==422
    assert not system.calls and not system.state['ai_usage']

def test_insufficient_connection_is_honest_without_model_call(system):
    system.state['ai_documents']=system.state['ai_documents'][:1]
    body=system.client.post('/api/ai/suggestion',json={'mode':'connect_dots'}).json()
    assert 'not enough' in body['suggestion'] and not body['inspired_by'] and not system.calls
    assert system.state['ai_usage'][0]['request_type']=='suggestion_fallback_insufficient_context'

def test_unseen_source_credits_are_discarded(system):
    system.provider.cited=[D1,str(uuid4())]
    body=system.client.post('/api/ai/suggestion',json={'mode':'new_topic'}).json()
    assert body['source_ids']==[D1]
    assert [s['title'] for s in body['inspired_by']]==['Solar ferries']

def test_one_cited_source_cannot_masquerade_as_a_connection(system):
    system.provider.cited=[D1]
    body=system.client.post('/api/ai/suggestion',json={'mode':'connect_dots'}).json()
    assert 'not enough' in body['suggestion'] and not body['inspired_by']

def test_save_use_reload_and_user_isolation(system):
    body=system.client.post('/api/ai/suggestion',json={'mode':'connect_dots'}).json()
    path=f'/api/ai/suggestions/{body["id"]}'
    for _ in range(2): assert system.client.put(path+'/save',json={}).status_code==200
    assert len(system.state['ai_memories'])==1
    saved=system.client.get('/api/ai/ideas').json()
    assert len(saved)==1 and saved[0]['mode']=='connect_dots' and saved[0]['questions']==QUESTIONS
    assert 'not completed writing' in system.state['ai_memories'][0]['memory']
    used=system.client.post(path+'/use',json={})
    assert used.status_code==200 and used.json()['status']=='written'
    assert system.client.get('/api/ai/ideas',headers={'x-user':'b'}).json()==[]
    assert system.client.put(path+'/save',headers={'x-user':'b'},json={}).status_code==404
    assert system.client.post(path+'/use',headers={'x-user':'b'},json={}).status_code==404
    assert len(system.state['ai_usage'])==1

@pytest.mark.parametrize('mode',['new_topic','expand_idea','connect_dots'])
def test_existing_daily_cap_applies_to_all_modes(system,mode):
    from lib.dates import today_iso
    system.state['ai_usage']=[dict(user_id=A,date=today_iso(),request_type='suggestion',id=str(i)) for i in range(100)]
    assert system.client.post('/api/ai/suggestion',json=dict(mode=mode,current_writing='An idea')).status_code==429
    assert not system.calls

def test_empty_context_has_localized_useful_fallback(system):
    system.state['ai_documents']=[]
    body=system.client.post('/api/ai/suggestion',json=dict(mode='new_topic',language='es')).json()
    assert 'Observa' in body['title'] and len(body['questions'])==3
    assert not body['inspired_by'] and not system.calls

def test_titles_without_source_content_are_not_treated_as_evidence(system):
    for source in system.state['ai_documents']:
        source['summary'] = None
    system.state['ai_document_chunks'] = []
    body = system.client.post('/api/ai/suggestion', json={'mode':'connect_dots'}).json()
    assert 'not enough' in body['suggestion'] and not body['inspired_by']
    assert not system.calls

def test_new_routes_keep_authentication_and_entitlement_guards(monkeypatch):
    app=FastAPI()
    app.include_router(ai.router,prefix='/api')
    routes=[('post','/api/ai/suggestion'),('get','/api/ai/ideas'),('get','/api/ai/idea-options'),('put',f'/api/ai/suggestions/{D1}/save'),('post',f'/api/ai/suggestions/{D1}/use')]
    with TestClient(app) as client:
        for method,path in routes: assert getattr(client,method)(path).status_code==401
        app.dependency_overrides[require_user]=lambda:AuthenticatedUser(id=A,plan='free',access_token='token-a')
        async def no_plan(_): return {'plan':'free','status':'inactive'}
        monkeypatch.setattr(ai_access,'get_entitlement',no_plan)
        for method,path in routes: assert getattr(client,method)(path).status_code==403

@pytest.mark.asyncio
async def test_real_provider_request_boundary_includes_text_and_trusted_mode():
    captured={}
    async def create(**kwargs):
        captured.update(kwargs)
        output=dict(title='Careful observation',suggestion='Explore a decision pattern.',why='Two concrete crafts.',questions=QUESTIONS,related_topics=[],source_ids=[D1,D2])
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(output)))],usage=None)
    provider=OpenAISuggestionProvider('test-model','test-key')
    provider._client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    await provider.generate_suggestion(TEXT1+'\n'+TEXT2,mode='connect_dots',language='es')
    assert 'CONNECT THE DOTS' in captured['messages'][0]['content'] and 'Spanish' in captured['messages'][0]['content']
    assert TEXT1 in captured['messages'][1]['content'] and TEXT2 in captured['messages'][1]['content']
    assert captured['response_format']['json_schema']['strict'] is True
