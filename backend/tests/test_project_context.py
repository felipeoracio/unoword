"""Content is retrieved only after scope resolution, never broad then filtered."""
from uuid import uuid4
from types import SimpleNamespace
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from models.ai import AISuggestionRequest
from lib import projects, project_context
from lib.project_context import request_text
from lib.personalization import effective_profile
from lib.profile_setup import QUESTIONS
from routers import projects as routes

U,A,B,D=[str(uuid4()) for _ in range(4)]

async def test_scope_uses_account_active_only_when_project_is_omitted(monkeypatch):
    calls=[]
    async def rpc(name,user,body): calls.append(body);return body
    monkeypatch.setattr(projects,'project_rpc',rpc)
    user=SimpleNamespace(id=U)
    await projects.resolve_scope(user,AISuggestionRequest())
    await projects.resolve_scope(user,AISuggestionRequest(project_id=None))
    await projects.resolve_scope(user,AISuggestionRequest(project_id=A,context_scope='selected_resources',selected_resources=[{'kind':'source','id':D}]))
    assert [r['p_use_active'] for r in calls]==[True,False,False]
    assert calls[-1]['p_project']==A and calls[-1]['p_selected']==[{'kind':'source','id':D}]

@pytest.mark.parametrize('mode',['none','profile_only'])
async def test_text_free_modes_do_not_fetch_any_library_content(monkeypatch,mode):
    calls=[]
    scope={'scope':mode,'project_id':None,'project':None,'profile_enabled':mode=='profile_only',
           **{key:[] for key in ['source_ids','document_ids','request_document_ids','memory_ids','session_ids','suggestion_ids','feedback_ids']}}
    async def resolve(*_):calls.append('resolve');return scope
    async def rest(method,table,*_,**__):calls.append(table);return []
    async def rpc(*_):raise AssertionError('Library content RPC is forbidden')
    monkeypatch.setattr(project_context,'resolve_scope',resolve)
    monkeypatch.setattr(project_context,'user_rest',rest)
    monkeypatch.setattr(project_context,'project_rpc',rpc)
    data=await project_context.load_project_context(SimpleNamespace(id=U,access_token='synthetic'),AISuggestionRequest(context_scope=mode))
    assert calls==(['resolve','ai_profiles','ai_onboarding_answers'] if mode=='profile_only' else ['resolve'])
    assert data['retrieved']==data['memories']==data['sources']==[]
    assert request_text(scope,D,'PRIVATE DRAFT')==''

async def test_scoped_retrieval_passes_only_authorized_ids(monkeypatch):
    calls=[]
    scope={'scope':'current_project','project_id':A,'project':{'name':'Memoir'},'profile_enabled':False,'source_ids':[D],
           'document_ids':[],'request_document_ids':[],'memory_ids':[],'session_ids':[],'suggestion_ids':[],'feedback_ids':[]}
    async def resolve(*_):calls.append('resolved');return scope
    async def rpc(name,user,body):
        assert calls[0]=='resolved' and name=='workspace_context_rows'
        assert body=={'p_kind':'source','p_ids':[D]};calls.append('scoped-content')
        return [{'id':D,'summary':'AUTHORIZED RESEARCH','document_title':'Reference','source_kind':'file'}]
    async def retrieve(owner,query,scope):assert scope['source_ids']==[D] and owner==U;calls.append('scoped-search');return []
    monkeypatch.setattr(project_context,'resolve_scope',resolve)
    monkeypatch.setattr(projects,'project_rpc',rpc)
    monkeypatch.setattr(project_context,'retrieve_user_chunks',retrieve)
    data=await project_context.load_project_context(SimpleNamespace(id=U),AISuggestionRequest(project_id=A))
    assert data['sources'][0]['id']==D and calls==['resolved','scoped-content','scoped-search']
    assert request_text(scope,D,'not in project')==''
    scope['request_document_ids']=[D]
    assert request_text(scope,D,'explicit one-request consent')=='explicit one-request consent'
    assert request_text(scope,B,'other project')==''

def test_guided_profile_preserves_custom_answers_and_legacy_fields():
    import json
    row={'question_id':'setup:types','answer':json.dumps({'version':1,'selected_option_ids':['memoir'],'custom_answer':'My custom genre','notes':'My detailed notes','legacy_answer':'My previous answer'})}
    original={'writing_goal':'Keep my goal','writing_style':'Keep my voice','ai_preferences':{'profile_edited':True}}
    result=effective_profile(original,[row])
    assert result['writing_goal']=='Keep my goal' and result['writing_style']=='Keep my voice'
    values=next(iter(result['ai_preferences']['guided_profile'].values()))
    assert all(s in values for s in ['My custom genre','My detailed notes','My previous answer'])
    assert 'guided_profile' not in original['ai_preferences']
    assert len(QUESTIONS)==10
    assert all(q['title_es'] and q['options'] for q in QUESTIONS)

def test_project_routes_validate_owner_and_answer_choices(monkeypatch):
    app=FastAPI();app.include_router(routes.router,prefix='/api')
    app.dependency_overrides[routes.require_workspace_user]=lambda:SimpleNamespace(id=U,access_token='synthetic')
    calls=[]
    async def rpc(name,user,body=None):calls.append((name,body));return {'question_id':'setup:experience','answer':'{}'}
    monkeypatch.setattr(routes,'project_rpc',rpc)
    base={'expected_user_id':U,'revision':0,'mutation_id':str(uuid4())}
    with TestClient(app,headers={'Origin':'https://unoword.app'}) as client:
        path='/api/workspace/projects/profile/answers/experience'
        assert client.put(path,json={**base,'selected_option_ids':['starting','professional']}).status_code==422
        assert client.put(path,json={**base,'selected_option_ids':['invented']}).status_code==422
        assert client.put(path,json={**base,'expected_user_id':B,'selected_option_ids':['starting']}).status_code==409
        assert not calls
        assert client.put(path,json={**base,'selected_option_ids':['starting'],'custom_answer':'Personal background','notes':'Keep my notes'}).status_code==200
        assert calls[-1][1]['p_answer']['notes']=='Keep my notes'
        assert client.put('/api/workspace/projects/'+A,json={**base,'name':'Memoir'}).status_code==200
        assert client.put('/api/workspace/projects/'+A,json={**base,'name':'Memoir','actual_streak':500}).status_code==422
        assert client.put(path,json={**base,'selected_option_ids':['starting']},headers={'Origin':'https://malicious.invalid'}).status_code==403

async def test_new_resource_uploads_reject_account_changes_before_processing(monkeypatch):
    from io import BytesIO
    from uuid import UUID
    from fastapi import BackgroundTasks, UploadFile
    from routers.documents import upload_document
    from routers.links import add_link
    from models.ai import AILinkCreate
    user=SimpleNamespace(id=U,access_token='synthetic')
    file=UploadFile(file=BytesIO(b'Private account A research'),filename='notes.txt')
    with pytest.raises(HTTPException) as error:
        await upload_document(BackgroundTasks(),file,'Private notes','notes',user,UUID(B))
    assert error.value.status_code==409 and file.file.closed
    with pytest.raises(HTTPException) as error:
        await add_link(AILinkCreate(url='https://example.com',expected_user_id=B),BackgroundTasks(),user)
    assert error.value.status_code==409
