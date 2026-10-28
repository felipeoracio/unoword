"""Queue HTTP boundaries: authenticated ownership, scheduler secret and uploads."""
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from lib.auth import AuthenticatedUser, require_user
from lib import request_security
from lib.request_security import BrowserSecurityMiddleware
from routers import documents, processing

ORIGIN={"Origin":"https://unoword.vercel.app"}


@pytest.fixture
def system(monkeypatch):
    user=AuthenticatedUser(id=str(uuid4()),plan="pro",access_token="private-user-token")
    state=SimpleNamespace(rows=[],kicks=[],queued=[],uploads=[],fail_queue=False)
    async def rest(method,table,token,params=None,json=None,prefer=None):
        assert token==user.access_token and table=="ai_documents"
        if method=="POST":state.rows.append(json);return [json]
        rows=[r for r in state.rows if r["user_id"]==user.id]
        for key,value in (params or {}).items():
            if value.startswith("eq."):rows=[r for r in rows if str(r.get(key))==value[3:]]
        if method=="PATCH":
            for row in rows:row.update(json)
        return rows
    async def upload(path,token,data,file_type):
        assert path.startswith(user.id+"/") and token==user.access_token
        state.uploads.append((path,data,file_type))
    async def enqueue(owner,source,**kwargs):
        if state.fail_queue:raise HTTPException(503,"source_processing_unavailable")
        assert owner==user.id
        state.queued.append((owner,source))
        return str(uuid4())
    async def drain(owner=None,**kwargs):state.kicks.append(owner);return 1
    monkeypatch.setattr(documents,"user_rest",rest)
    monkeypatch.setattr(processing,"user_rest",rest)
    monkeypatch.setattr(documents,"user_storage_upload",upload)
    monkeypatch.setattr(processing.source_processing,"enqueue",enqueue)
    monkeypatch.setattr(processing.source_processing,"drain",drain)
    monkeypatch.setattr(request_security,"_bursts",{})
    monkeypatch.setenv("CRON_SECRET","a-strong-fixture-secret-at-least-32-characters")
    app=FastAPI();app.include_router(documents.router,prefix="/api");app.include_router(processing.router,prefix="/api")
    app.add_middleware(BrowserSecurityMiddleware)
    app.dependency_overrides[documents.require_ai_user]=lambda:user
    with TestClient(app,headers=ORIGIN) as client:
        yield SimpleNamespace(client=client,state=state,user=user,app=app)


def test_valid_file_returns_saved_pending_metadata_and_enqueues_owner(system):
    response=system.client.post('/api/documents/upload',files={'file':('notes.txt',b'An explicitly shared fictional reference.','text/plain')},data={'document_title':'Fictional notes'})
    assert response.status_code==201,response.text
    body=response.json()
    assert body['processing_status']=='pending' and body['processing_phase']=='queued'
    assert system.state.queued==[(system.user.id,body['id'])]
    assert system.state.kicks==[system.user.id]
    assert system.state.uploads and system.state.rows


@pytest.mark.parametrize('filename,content',[('bad.exe',b'unsafe'),('bad.pdf',b'not a pdf'),('empty.txt',b''),('bad.docx',b'PKbad'),('bad.txt',b'\xff\xfe')])
def test_bad_upload_is_rejected_before_storage_or_queue(system,filename,content):
    response=system.client.post('/api/documents/upload',files={'file':(filename,content)},data={'document_title':'Bad file'})
    assert response.status_code==422
    assert not system.state.uploads and not system.state.queued


def test_queue_failure_preserves_upload_with_retryable_failed_state(system):
    system.state.fail_queue=True
    response=system.client.post('/api/documents/upload',files={'file':('notes.txt',b'A safe fictional reference.')},data={'document_title':'Saved file'})
    assert response.status_code==503
    assert len(system.state.uploads)==1 and system.state.rows[0]['processing_status']=='failed'


def test_retry_requires_ownership_and_does_not_duplicate_source(system):
    source=str(uuid4())
    system.state.rows.append(dict(id=source,user_id=system.user.id))
    response=system.client.post(f'/api/processing/{source}/retry')
    assert response.status_code==202 and len(system.state.rows)==1
    assert system.state.queued==[(system.user.id,source)]
    assert system.client.post(f'/api/processing/{uuid4()}/retry').status_code==404


def test_user_kick_cannot_target_another_account(system):
    response=system.client.post('/api/processing/run',json={'user_id':str(uuid4())})
    assert response.status_code==202 and system.state.kicks==[system.user.id]


def test_scheduler_requires_separate_secret_not_browser_session(system):
    assert system.client.get('/api/internal/ingestion').status_code==401
    assert system.client.get('/api/internal/ingestion',headers={'Authorization':'Bearer private-user-token'}).status_code==401
    response=system.client.get('/api/internal/ingestion',headers={'Authorization':'Bearer a-strong-fixture-secret-at-least-32-characters'})
    assert response.status_code==200 and response.json()=={'steps':1}
    assert response.headers['cache-control']=='private, no-store'
    assert system.state.kicks==[None]


def test_unconfigured_scheduler_fails_closed(system,monkeypatch):
    monkeypatch.delenv('CRON_SECRET')
    assert system.client.get('/api/internal/ingestion').status_code==503
    assert not system.state.kicks


def test_foreign_site_cannot_kick_cookie_authenticated_work(system):
    assert system.client.post('/api/processing/run',headers={'Origin':'https://untrusted.example'}).status_code==403
    assert not system.state.kicks


def test_user_queue_routes_require_auth_and_pro(system,monkeypatch):
    from lib import ai_access
    system.app.dependency_overrides.clear()
    assert system.client.post('/api/processing/run').status_code==401
    system.app.dependency_overrides[require_user]=lambda:system.user
    async def free(_):return dict(plan='free',status='active')
    monkeypatch.setattr(ai_access,'get_entitlement',free)
    assert system.client.post('/api/processing/run').status_code==403
