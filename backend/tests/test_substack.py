"""Isolated provider/security tests. No Stripe charges, real email or live mutations."""
import copy
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
import stripe
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from lib import substack_stripe as integration, ai_access
from lib.auth import require_user
from lib.admin_auth import require_admin
from lib.request_security import BrowserSecurityMiddleware, _bursts
from routers.substack import router

OWNER=str(uuid4());OTHER=str(uuid4());ORIGIN={'Origin':'https://unoword.vercel.app'}


def subscription(**patch):
    return {'id':'sub_paid','customer':'cus_reader','livemode':False,'status':'active',
        'items':{'has_more':False,'data':[{'price':{'id':'price_publication','product':'prod_publication','unit_amount':700,'recurring':{'interval':'month'}},'current_period_end':int(time.time())+86400}]},**patch}


def invoice(**patch):
    return {'id':'in_paid','livemode':False,'status':'paid','amount_paid':700,'subscription':'sub_paid',
        'lines':{'data':[{'price':{'id':'price_publication'},'amount':700,'period':{'end':int(time.time())+86400}}]},**patch}


@pytest.fixture
def system(monkeypatch):
    for key,value in {'SUBSTACK_STRIPE_SECRET_KEY':'rk_test_separate','SUBSTACK_STRIPE_WEBHOOK_SECRET':'whsec_separate',
        'SUBSTACK_STRIPE_ACCOUNT_ID':'acct_publication','SUBSTACK_PUBLICATION_URL':'https://unoword.substack.com',
        'SUBSTACK_STRIPE_PRICE_IDS':'price_publication','SUBSTACK_STRIPE_PRODUCT_IDS':'',
        'SUBSTACK_LINK_HMAC_SECRET':'independent-server-secret-32-characters-minimum','SUBSTACK_LINKING_ENABLED':'true',
        'SUBSTACK_STRIPE_LIVE_ACCESS_APPROVED':'false','RESEND_API_KEY':'re_fixture','SUBSTACK_EMAIL_FROM':'UnoWord <verify@example.com>',
        'AI_AUTH_MODE':'supabase','PUBLIC_APP_URL':'https://unoword.vercel.app','STRIPE_SECRET_KEY':'sk_test_NATIVE_UNCHANGED'}.items():monkeypatch.setenv(key,value)
    state=SimpleNamespace(subscription=subscription(),invoices=[invoice()],saved=[],calls=[],events={},sent=[],rows={},claim=True)
    provider=Mock();provider.raw_request.return_value={'id':'acct_publication'}
    provider.v1.subscriptions.retrieve.side_effect=lambda ref:copy.deepcopy(state.subscription)
    provider.v1.subscriptions.list.side_effect=lambda params: {'data':[copy.deepcopy(state.subscription)],'has_more':False}
    provider.v1.customers.retrieve.return_value={'id':'cus_reader','email':'substack.reader@example.com'}
    provider.v1.customers.list.return_value={'data':[{'id':'cus_reader','email':'substack.reader@example.com'}],'has_more':False}
    provider.v1.invoices.list.side_effect=lambda params:{'data':copy.deepcopy(state.invoices),'has_more':False}
    provider.v1.invoices.retrieve.side_effect=lambda ref:copy.deepcopy(state.invoices[0])
    provider.v1.prices.retrieve.return_value={'id':'price_publication','livemode':False,'recurring':{'interval':'month'},'unit_amount':700}
    provider.v1.webhook_endpoints.list.return_value={'data':[{'id':'we_endpoint','url':'https://unoword.vercel.app/api/webhooks/substack-stripe','status':'enabled','livemode':False,'api_version':'2026-09-30.endive','enabled_events':sorted(integration.EVENT_TYPES)}]}
    async def config_state(c):return {'policy_hash':c.policy,'enabled':False,'verification':{'read_permissions_verified':True}}
    async def rpc(name,**data):
        state.calls.append((name,copy.deepcopy(data)))
        if name=='subscription_claim':return state.claim
        if name=='subscription_commit':state.saved.append(copy.deepcopy(data['state']));return True
        if name in {'subscription_release','observe','event_finish','disconnect'}:
            if name=='event_finish':state.events[data['event']]['state']='done' if not data['error'] else 'queued'
            return True
        if name=='event_enqueue':
            event=copy.deepcopy(data['event']);state.events.setdefault(event['id'],{**event,'event_id':event['id'],'state':'queued'});return True
        if name=='event_claim':
            event=state.events.get(data['event'])
            if not event or event['state']=='done':return None
            event['state']='running';return copy.deepcopy(event)
        if name=='verification':
            if data['action']=='begin':state.rows[data['id']]={**data['data'],'user_id':data['user'],'id':data['id'],'status':'sending'};return {'created':True}
            row=state.rows.get(data['id'])
            if not row or row['user_id']!=data['user']:return {'invalid':True}
            if data['action']=='delivered':row['status']='pending';return {'delivered':True}
            if data['action']=='verify':
                if row['status']!='pending' or row['code_hash']!=data['data']['code_hash']:return {'invalid':True}
                row['status']='verified'
            if data['action']=='read_verified' and row['status']!='verified':return {'invalid':True}
            return copy.deepcopy(row)
        if name=='link':return True
        raise AssertionError(name)
    async def send(c,email,code,request_id):state.sent.append((email,code,request_id))
    async def database(method,path,**kwargs):
        if path=='substack_events':
            event_id=(kwargs.get('params',{}).get('event_id') or '')[3:]
            return [{'state':state.events[event_id]['state']}] if event_id else [{'processed_at':'2026-11-04T00:00:00Z'}]
        return []
    monkeypatch.setattr(integration,'db',database)
    monkeypatch.setattr(integration,'client',lambda c:provider);monkeypatch.setattr(integration,'integration',config_state);monkeypatch.setattr(integration,'rpc',rpc);monkeypatch.setattr(integration,'send_code',send)
    state.provider=provider;state.owner=SimpleNamespace(id=OWNER,email='different.login@example.com',access_token='verified-session')
    app=FastAPI();app.add_middleware(BrowserSecurityMiddleware);app.include_router(router,prefix='/api');app.dependency_overrides[require_user]=lambda:state.owner
    state.app=app;state.client=TestClient(app);_bursts.clear()
    yield state
    _bursts.clear()


@pytest.mark.parametrize('status',['trialing','unpaid','incomplete','incomplete_expired','canceled','paused'])
def test_nonpaid_statuses_never_qualify(status):
    assert integration.paid_through(subscription(status=status),[invoice()],{'price_publication'}) is None


@pytest.mark.parametrize('patch',[{'amount_paid':0},{'status':'open'},{'subscription':'sub_unrelated'},
    {'lines':{'data':[{'price':{'id':'price_OTHER'},'amount':700,'period':{'end':int(time.time())+86400}}]}},
    {'lines':{'data':[{'price':{'id':'price_publication'},'amount':0,'period':{'end':int(time.time())+86400}}]}}])
def test_matching_email_or_zero_payment_is_not_proof(patch):
    assert integration.paid_through(subscription(),[invoice(**patch)],{'price_publication'}) is None


def test_cancel_at_period_end_keeps_verified_paid_time():
    boundary=int(time.time())+3600
    assert integration.paid_through(subscription(cancel_at_period_end=True,cancel_at=boundary),[invoice()],{'price_publication'})==boundary


def test_payment_failure_only_keeps_previously_paid_through_time():
    assert integration.paid_through(subscription(status='past_due'),[invoice()],{'price_publication'})>time.time()
    old=invoice(lines={'data':[{'price':{'id':'price_publication'},'amount':700,'period':{'end':int(time.time())-100}}]})
    assert integration.paid_through(subscription(status='past_due'),[old],{'price_publication'}) is None


def test_current_and_legacy_invoice_shapes():
    end=int(time.time())+3600
    modern=invoice(subscription=None,parent={'subscription_details':{'subscription':'sub_paid'}},lines={'data':[{'pricing':{'price_details':{'price':'price_publication'}},'parent':{'subscription_item_details':{'subscription':'sub_paid'}},'amount':700,'period':{'end':end}}]})
    assert integration.invoice_subscription(modern)=='sub_paid'
    assert integration.paid_through(subscription(),[modern],{'price_publication'})==end


def test_incomplete_invoice_history_cannot_be_used_as_revocation():
    with pytest.raises(HTTPException):integration.paid_through(subscription(),[invoice(lines={'has_more':True,'data':[]})],{'price_publication'})


async def test_separate_read_only_client_and_scope_verification(system):
    c=integration.config();assert c.key=='rk_test_separate';assert not c.live
    result=await integration.refresh_subscription(c,'sub_paid');assert result['eligible']
    assert result['email_hash']==integration.email_hash(c,'substack.reader@example.com')
    assert 'substack.reader@example.com' not in json.dumps(system.saved)
    system.provider.v1.subscriptions.create.assert_not_called();system.provider.v1.subscriptions.cancel.assert_not_called();system.provider.v1.charges.create.assert_not_called()
    system.provider.raw_request.assert_called_with('get','/v1/account')
    system.provider.raw_request.return_value={'id':'acct_WRONG'}
    with pytest.raises(HTTPException) as error:await integration.refresh_subscription(c,'sub_paid')
    assert error.value.detail=='substack_stripe_account_mismatch'


async def test_allowlist_and_scope_mode_fail_closed(system):
    system.subscription['items']['data'][0]['price']['id']='price_other'
    result=await integration.refresh_subscription(integration.config(),'sub_paid');assert not result['eligible']
    system.provider.v1.customers.retrieve.assert_not_called()
    system.subscription['livemode']=True
    with pytest.raises(HTTPException):await integration.refresh_subscription(integration.config(),'sub_paid')


async def test_readiness_verifies_permissions_and_webhook_event_set(system):
    result=await integration.observe();assert result['ready'] and result['read_permissions_verified'] and result['eligible_sample_paid']
    assert result['restricted_key']
    system.provider.v1.webhook_endpoints.list.return_value={'data':[]}
    assert not (await integration.observe())['ready']
    system.provider.v1.invoices.list.side_effect=stripe.PermissionError('fixture denied')
    with pytest.raises(HTTPException) as error:await integration.observe()
    assert error.value.detail=='substack_stripe_read_permission_denied'


async def test_live_activation_refuses_without_explicit_approval(system,monkeypatch):
    monkeypatch.setenv('SUBSTACK_STRIPE_SECRET_KEY','rk_live_external')
    with pytest.raises(HTTPException) as error:await integration.set_enabled(True,True,'admin')
    assert error.value.detail=='substack_live_access_not_approved'
    assert not any(name=='set_enabled' for name,_ in system.calls)


async def test_email_proof_is_owner_bound_and_can_differ_from_login(system):
    started=await integration.begin_link(system.owner,'substack.reader@EXAMPLE.com')
    email,code,request_id=system.sent[0];assert email!='different.login@example.com' and len(code)==8
    assert 'code' not in started and started['masked_email']=='s…@example.com'
    assert system.rows[request_id]['email_ciphertext']!='substack.reader@example.com'
    assert (await integration.verify_link(system.owner,request_id,code))['connected']
    assert any(name=='link' and data['user']==OWNER for name,data in system.calls)
    with pytest.raises(HTTPException):await integration.verify_link(system.owner,request_id,code)
    with pytest.raises(HTTPException):await integration.finish_link(SimpleNamespace(id=OTHER),request_id)


def signed(event,secret='whsec_separate',age=0):
    payload=json.dumps(event).encode();at=int(time.time())-age
    sig=hmac.new(secret.encode(),str(at).encode()+b'.'+payload,hashlib.sha256).hexdigest()
    return payload,{'stripe-signature':f't={at},v1={sig}'}


def evt(kind='customer.subscription.updated',**patch):
    return {'id':'evt_fixture','type':kind,'created':int(time.time()),'livemode':False,'api_version':'2024-06-20',
        'data':{'object':{'id':'in_paid' if kind.startswith('invoice.') else 'sub_paid','object':'invoice' if kind.startswith('invoice.') else 'subscription','status':'active'}},**patch}


def test_raw_signature_new_webhook_path_and_duplicate_delivery(system):
    body,headers=signed(evt());assert system.client.post('/api/webhooks/substack-stripe',content=body,headers=headers).status_code==200
    assert system.client.post('/api/webhooks/substack-stripe',content=body,headers=headers).status_code==200
    assert len(system.saved)==1 and len(system.events)==1
    assert system.client.post('/api/webhooks/substack-stripe',content=body+b' ',headers=headers).status_code==400
    bad,old=signed(evt(id='evt_old'),age=1000);assert system.client.post('/api/webhooks/substack-stripe',content=bad,headers=old).status_code==400
    native,native_signature=signed(evt(),secret='whsec_NATIVE');assert system.client.post('/api/webhooks/substack-stripe',content=native,headers=native_signature).status_code==400


@pytest.mark.parametrize('kind',sorted(integration.EVENT_TYPES))
def test_all_supported_event_types_use_current_subscription_not_event_snapshot(system,kind):
    system.subscription.update(status='canceled')
    body,headers=signed(evt(kind));response=system.client.post('/api/webhooks/substack-stripe',content=body,headers=headers)
    assert response.status_code==200,response.json()
    assert not system.saved[0]['eligible'] and system.saved[0]['status']=='canceled'


def test_webhook_failure_is_durable_and_retryable(system):
    system.provider.v1.subscriptions.retrieve.side_effect=stripe.APIConnectionError('fixture unavailable')
    body,headers=signed(evt());response=system.client.post('/api/webhooks/substack-stripe',content=body,headers=headers)
    assert response.status_code==502 and len(system.events)==1 and not system.saved
    assert system.events['evt_fixture']['state']=='queued'
    system.provider.v1.subscriptions.retrieve.side_effect=lambda ref:copy.deepcopy(system.subscription)
    assert system.client.post('/api/webhooks/substack-stripe',content=body,headers=headers).status_code==200
    assert len(system.saved)==1


@pytest.mark.parametrize('patch',[{'account':'acct_unrelated'},{'livemode':True}])
def test_foreign_account_and_mode_are_rejected(system,patch):
    body,headers=signed(evt(**patch));assert system.client.post('/api/webhooks/substack-stripe',content=body,headers=headers).status_code==400
    assert not system.events


def test_link_mutations_reject_wrong_user_extra_grants_and_csrf(system):
    assert system.client.post('/api/subscription/substack/connect',json={'expected_user_id':OTHER,'email':'reader@example.com'},headers=ORIGIN).status_code==409
    assert system.client.post('/api/subscription/substack/connect',json={'expected_user_id':OWNER,'email':'reader@example.com','plan':'pro'},headers=ORIGIN).status_code==422
    assert system.client.post('/api/subscription/substack/connect',json={'expected_user_id':OWNER,'email':'reader@example.com'},headers={'Origin':'https://untrusted.example'}).status_code==403
    system.app.dependency_overrides[require_admin]=lambda: (_ for _ in ()).throw(HTTPException(401,'admin_required'))
    assert system.client.get('/api/admin/integrations/substack').status_code==401


async def test_external_lookup_never_overwrites_or_disables_native_lifetime(system,monkeypatch):
    native={'user_id':OWNER,'plan':'pro','status':'active','billing_source':'stripe_lifetime','billing_livemode':False}
    async def rest(*args,**kwargs):return [native]
    monkeypatch.setattr(ai_access,'service_rest',rest)
    assert await ai_access.get_entitlement(OWNER)==native
    assert not system.calls
    native.update(status='inactive')
    external={**native,'status':'active','billing_source':'substack_stripe'}
    async def rpc(name,**args):assert name=='entitlement';return external
    monkeypatch.setattr(integration,'rpc',rpc)
    assert (await ai_access.get_entitlement(OWNER))['billing_source']=='substack_stripe'
    assert native['status']=='inactive' and native['billing_source']=='stripe_lifetime'


async def test_missing_allowlist_never_assumes_all_subscriptions(system,monkeypatch):
    monkeypatch.setenv('SUBSTACK_STRIPE_PRICE_IDS','')
    with pytest.raises(HTTPException) as error:integration.config()
    assert error.value.detail=='substack_not_configured'

async def test_zero_dollar_trial_is_not_a_ready_sample(system):
    system.invoices[0]['amount_paid']=0
    report=await integration.observe()
    assert not report['ready'] and not report['eligible_sample_paid']

async def test_a_current_signed_delivery_is_required_for_readiness(system,monkeypatch):
    async def no_delivery(*args,**kwargs):return []
    monkeypatch.setattr(integration,'db',no_delivery)
    report=await integration.observe()
    assert not report['ready'] and not report['webhook_delivery_verified']

async def test_provider_failure_does_not_commit_an_inactive_snapshot(system):
    system.provider.v1.invoices.list.side_effect=stripe.APIConnectionError('fixture unavailable')
    with pytest.raises(HTTPException):await integration.refresh_subscription(integration.config(),'sub_paid')
    assert system.saved==[] and any(name=='subscription_release' for name,_ in system.calls)

async def test_csv_never_grants_or_sends_email_and_rejects_unsafe_dates(system,monkeypatch):
    writes=[]
    async def database(method,path,**kwargs):writes.append((method,path,kwargs));return None
    monkeypatch.setattr(integration,'db',database)
    result=await integration.import_csv('email,stripe_subscription_id,paid_through,status\nreader@example.com,,2030-01-01T00:00:00Z,paid\n','admin')
    assert result['grants_created']==0 and result['staged']==1 and system.sent==[]
    row=writes[0][2]['json'][0]
    assert row['review_status']=='needs_verification' and row['email_ciphertext']!='reader@example.com'
    with pytest.raises(HTTPException):await integration.import_csv('email,paid_through\nreader@example.com,2030-01-01\n','admin')

def test_development_headers_never_authorize_subscription_data(system,monkeypatch):
    monkeypatch.setenv('AI_AUTH_MODE','development_header')
    assert system.client.get('/api/subscription/substack').status_code==401

def test_email_normalization_does_not_merge_local_part_or_plus_aliases():
    assert integration.email_value('Reader@EXAMPLE.COM')=='Reader@example.com'
    assert integration.email_value('reader+paid@example.com')!='reader@example.com'


@pytest.mark.parametrize('name,native',[('SUBSTACK_STRIPE_SECRET_KEY','STRIPE_SECRET_KEY'),('SUBSTACK_STRIPE_WEBHOOK_SECRET','STRIPE_WEBHOOK_SECRET')])
def test_native_billing_credentials_cannot_be_reused(system,monkeypatch,name,native):
    import os
    monkeypatch.setenv(native,os.environ[name])
    with pytest.raises(HTTPException) as error:integration.config()
    assert 'separate' in error.value.detail


async def test_source_sdk_logs_cannot_disclose_lookup_email_but_native_logs_remain(system,caplog):
    import logging
    logger=logging.getLogger('stripe')
    caplog.set_level(logging.INFO,logger='stripe')
    def provider():
        logger.info('customer lookup email=fixture-only@example.com')
        return {'ok':True}
    assert await integration.call(provider)=={'ok':True}
    assert 'fixture-only@example.com' not in caplog.text
    logger.info('native billing correlation remains available')
    assert 'native billing correlation remains available' in caplog.text

@pytest.mark.parametrize('verbose',['debug','info'])
async def test_opt_in_sdk_console_payload_logging_blocks_source_calls(system,monkeypatch,verbose):
    monkeypatch.setenv('STRIPE_LOG',verbose)
    with pytest.raises(HTTPException) as error:await integration.call(lambda:{'ok':True})
    assert error.value.detail=='substack_disable_verbose_stripe_logging'
