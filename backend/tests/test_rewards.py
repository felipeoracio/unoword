"""Rewards trust boundary; all provider/DB calls are isolated, never live."""
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from routers import rewards, reward_admin
from lib.auth import require_user
from lib.admin_auth import require_admin
from lib.request_security import trusted_origin
from lib.supabase_client import SupabaseAPIError

@pytest.fixture
def setup(monkeypatch):
    state=SimpleNamespace(owner=str(uuid4()),paid=False,calls=[],conflict=False,error=False)
    async def user(): return SimpleNamespace(id=state.owner)
    async def entitlement(owner):
        assert owner==state.owner
        return {'verified':state.paid}
    async def rpc(method,path,*,json):
        state.calls.append((path,json))
        if state.error: raise SupabaseAPIError(500,'private internal connection details')
        if path.endswith('writing_rewards'): return {'user_id':json['p_user'],'enabled':True}
        if path.endswith('writing_reward_settings'): return {'conflict':True} if state.conflict else {'updated':True}
        if path.endswith('writing_reward_claim'): return 'words_100'
        if path.endswith('writing_reward_admin_update'): return None if state.conflict else {'id':json['p_id']}
        if path.endswith('writing_reward_backfill'): return {'processed':25,'next_cursor':None,'has_more':False}
        return []
    monkeypatch.setattr(rewards,'get_entitlement',entitlement)
    monkeypatch.setattr(rewards,'entitlement_is_active',lambda ent:ent['verified'])
    monkeypatch.setattr(rewards,'service_rest',rpc);monkeypatch.setattr(reward_admin,'service_rest',rpc)
    app=FastAPI();app.include_router(rewards.router,prefix='/api');app.include_router(reward_admin.router,prefix='/api')
    app.dependency_overrides[require_user]=user
    app.dependency_overrides[trusted_origin]=lambda:None
    state.app=app;state.client=TestClient(app)
    return state

@pytest.mark.parametrize('paid',[False,True])
def test_entitlement_and_identity_are_server_supplied(setup,paid):
    setup.paid=paid
    response=setup.client.get('/api/rewards?language=es&p_user=forged&p_paid=true')
    assert response.status_code==200
    assert response.headers['cache-control']=='private, no-store'
    assert setup.calls[-1][1]=={'p_user':setup.owner,'p_paid':paid,'p_language':'es'}

@pytest.mark.parametrize('path,method,extra',[
    ('/api/rewards/preferences','put',{'revision':0,'enabled':True}),
    ('/api/rewards/celebrations/claim','post',{}),
])
def test_account_switch_cannot_write_other_account(setup,path,method,extra):
    response=getattr(setup.client,method)(path,json={'expected_user_id':str(uuid4()),**extra})
    assert response.status_code==409
    assert setup.calls==[]

@pytest.mark.parametrize('payload',[
    {'p_paid':True},{'user_id':str(uuid4())},{'total_words':1000000},{'showcase':['a','b','c','d']},
])
def test_client_cannot_submit_entitlements_or_fake_totals(setup,payload):
    response=setup.client.put('/api/rewards/preferences',json={'expected_user_id':setup.owner,'revision':0,**payload})
    assert response.status_code==422
    assert setup.calls==[]

def test_preference_conflict_and_claim_reconcile(setup):
    setup.conflict=True
    assert setup.client.put('/api/rewards/preferences',json={'expected_user_id':setup.owner,'revision':0,'enabled':False}).status_code==409
    assert setup.client.post('/api/rewards/celebrations/claim',json={'expected_user_id':setup.owner}).json()=={'achievement_id':'words_100'}
    assert [path for path,_ in setup.calls][-2:]==['rpc/writing_rewards','rpc/writing_reward_claim']

def test_schema_errors_do_not_disclose_internal_details(setup):
    setup.error=True
    response=setup.client.get('/api/rewards')
    assert response.status_code==503
    assert response.json()=={'detail':'rewards_setup_required'}

def test_authentication_is_required(setup):
    async def reject(): raise HTTPException(401,'unauthenticated')
    setup.app.dependency_overrides[require_user]=reject
    assert setup.client.get('/api/rewards').status_code==401
    assert setup.calls==[]

def test_admin_role_required_and_definitions_validated(setup):
    async def reject(): raise HTTPException(403,'admin_required')
    setup.app.dependency_overrides[require_admin]=reject
    assert setup.client.get('/api/admin/achievements').status_code==403
    setup.app.dependency_overrides[require_admin]=lambda:None
    assert setup.client.patch('/api/admin/achievements/words_100',json={'revision':1,'id':'forged','threshold':100}).status_code==422
    assert setup.client.patch('/api/admin/achievements/words_100',json={'revision':1,'badge_image':'data:image/svg+xml;base64,PHN2Zz4='}).status_code in (400,413,422)
    assert setup.client.patch('/api/admin/achievements/words_100',json={'revision':1,'threshold':0}).status_code==422
    response=setup.client.patch('/api/admin/achievements/words_100',json={'revision':1,'threshold':200,'badge_image':None})
    assert response.status_code==200
    assert setup.calls[-1][1]=={'p_id':'words_100','p_revision':1,'p_patch':{'threshold':200,'badge_image':None}}
    setup.conflict=True
    assert setup.client.patch('/api/admin/achievements/words_100',json={'revision':1,'active':False}).status_code==409
    assert setup.client.post('/api/admin/achievements/backfill',json={'after':None}).status_code==200
    assert setup.calls[-1][1]=={'p_after':None,'p_limit':25}
