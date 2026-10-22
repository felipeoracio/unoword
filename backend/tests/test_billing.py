"""Provider-boundary tests: no real Stripe requests or user mutations."""
import copy
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from lib import billing
from lib.auth import require_user
from lib.ai_access import entitlement_is_active
from lib.request_security import _bursts
from server import app

USER = '00000000-0000-4000-8000-000000000001'
ORIGIN = {'Origin': 'https://unoword.vercel.app'}
PRICE = {'id': 'price_pro', 'active': True, 'type': 'recurring', 'unit_amount': 2000,
         'currency': 'usd', 'livemode': False, 'recurring': {'interval': 'month', 'interval_count': 1, 'usage_type': 'licensed'}}

@pytest.fixture
def fixture(monkeypatch):
    for key,value in {'STRIPE_SECRET_KEY':'sk_test_fixture', 'STRIPE_WEBHOOK_SECRET':'whsec_fixture',
        'STRIPE_PRO_PRICE_ID':'price_pro','STRIPE_BILLING_ENABLED':'true','STRIPE_LIVE_BILLING_APPROVED':'false','PUBLIC_APP_URL':'https://unoword.vercel.app'}.items():
        monkeypatch.setenv(key,value)
    state={'user_id':USER,'customer_id':None,'subscription_id':None,'subscription_created':0,
           'status':'inactive','trial_used':False,'checkout_id':None,'checkout_attempt':str(uuid4())}
    entitlement={}
    events=set()
    calls=[]
    async def database(method,path,**kwargs):
        calls.append((path,copy.deepcopy(kwargs)))
        payload=kwargs.get('json',{})
        if path=='billing_accounts':
            customer=kwargs['params'].get('customer_id')
            return [copy.deepcopy(state)] if not customer or customer=='eq.'+str(state['customer_id']) else []
        if path=='rpc/billing_lock':
            if state.get('lease_id'): raise HTTPException(409,'billing_busy')
            state['lease_id']=payload['p_lease_id']; return copy.deepcopy(state)
        if path=='rpc/billing_unlock':
            state.pop('lease_id',None); return None
        if path=='rpc/billing_commit':
            assert payload['p_lease_id']==state['lease_id']
            if payload.get('p_event_id') in events: return False
            state.update(payload['p_state'])
            if payload.get('p_entitlement') is not None:
                entitlement.update(payload['p_entitlement'],plan='pro',billing_source='stripe')
            if payload.get('p_event_id'): events.add(payload['p_event_id'])
            return True
        pytest.fail(path)
    async def get_entitlement(_): return entitlement or None
    provider=Mock()
    provider.v1.prices.retrieve.return_value=copy.deepcopy(PRICE)
    provider.v1.customers.create.return_value={'id':'cus_a'}
    provider.v1.subscriptions.list.return_value={'data':[],'has_more':False}
    provider.v1.checkout.sessions.create.return_value={'id':'cs_a','status':'open','url':'https://checkout.stripe.com/c/pay/fixture'}
    provider.v1.checkout.sessions.retrieve.return_value=provider.v1.checkout.sessions.create.return_value
    provider.v1.billing_portal.configurations.list.return_value={'data':[{'id':'bpc_fixture','features':{'subscription_cancel':{'enabled':True,'mode':'at_period_end'},'payment_method_update':{'enabled':True},'subscription_update':{'enabled':False}}}]}
    provider.v1.billing_portal.sessions.create.return_value={'url':'https://billing.stripe.com/p/session/fixture'}
    monkeypatch.setattr(billing,'db',database)
    monkeypatch.setattr(billing,'get_entitlement',get_entitlement)
    monkeypatch.setattr('routers.subscriptions.get_entitlement',get_entitlement)
    monkeypatch.setattr(billing,'client',lambda:provider)
    app.dependency_overrides[require_user]=lambda:SimpleNamespace(id=USER,email='fixture@example.com',access_token='verified-fixture-session')
    _bursts.clear()
    with TestClient(app) as client: yield SimpleNamespace(client=client,state=state,entitlement=entitlement,events=events,provider=provider,calls=calls)
    app.dependency_overrides.clear(); _bursts.clear()

def change(f,**kwargs):
    return f.client.post('/api/subscription/change',json={'target_plan':'pro','expected_user_id':USER,'confirmed':True,**kwargs},headers=ORIGIN)

def sub(**kwargs):
    return {'id':'sub_a','customer':'cus_a','created':100,'livemode':False,'status':'trialing',
            'trial_end':int(time.time())+7*86400,'metadata':{'unoword_user_id':USER},
            'items':{'data':[{'price':{'id':'price_pro'},'quantity':1,'current_period_end':int(time.time())+30*86400}]},**kwargs}

def event(f,body=None,event_id='evt_a',signature=True,age=0,livemode=False):
    obj=body or sub()
    payload=json.dumps({'id':event_id,'type':'customer.subscription.updated','livemode':livemode,'data':{'object':obj}}).encode()
    at=int(time.time())-age
    digest=hmac.new(b'whsec_fixture',str(at).encode()+b'.'+payload,hashlib.sha256).hexdigest()
    return f.client.post('/api/subscription/webhook',content=payload,headers={'stripe-signature':f't={at},v1={digest if signature else "bad"}'})

def test_new_checkout_is_bound_to_owner_with_one_trial_and_no_client_entitlement(fixture):
    f=fixture; result=change(f)
    assert result.status_code==200 and result.json()['destination']=='checkout'
    params=f.provider.v1.checkout.sessions.create.call_args.args[0]
    assert params['mode']=='subscription' and params['customer']=='cus_a' and params['client_reference_id']==USER
    assert params['line_items']==[{'price':'price_pro','quantity':1}]
    assert params['subscription_data']['trial_period_days']==7 and params['payment_method_collection']=='always'
    assert params['success_url']=='https://unoword.vercel.app/account?billing=success'
    assert f.entitlement=={}
    # Ownership mapping was persisted before creating a subscription session.
    assert f.calls[1][0]=='rpc/billing_commit' and f.calls[1][1]['json']['p_state']['customer_id']=='cus_a'
    key=f.provider.v1.checkout.sessions.create.call_args.kwargs['options']['idempotency_key']
    assert key.endswith(f.state['checkout_attempt'])
    assert change(f).json()==result.json()
    assert f.provider.v1.checkout.sessions.create.call_count==1

def test_returning_customer_never_receives_another_trial(fixture):
    f=fixture; f.state.update(customer_id='cus_a',trial_used=True)
    assert change(f).status_code==200
    assert 'trial_period_days' not in f.provider.v1.checkout.sessions.create.call_args.args[0]['subscription_data']

def test_provider_history_prevents_repeated_trial_even_if_flag_missing(fixture):
    f=fixture; f.state['customer_id']='cus_a'
    f.provider.v1.subscriptions.list.return_value={'data':[{'status':'canceled'}]}
    assert change(f).status_code==200
    assert 'trial_period_days' not in f.provider.v1.checkout.sessions.create.call_args.args[0]['subscription_data']

@pytest.mark.parametrize('status',['trialing','active','incomplete','past_due','unpaid','paused'])
def test_existing_subscription_opens_portal_without_second_subscription(fixture,status):
    f=fixture; f.state['customer_id']='cus_a'; f.provider.v1.subscriptions.list.return_value={'data':[{'status':status}]}
    assert change(f).json()['destination']=='portal'
    f.provider.v1.checkout.sessions.create.assert_not_called()

def test_cancellation_management_works_with_checkout_disabled_or_wrong_price(fixture,monkeypatch):
    f=fixture; f.state['customer_id']='cus_a'; monkeypatch.setenv('STRIPE_BILLING_ENABLED','false')
    f.provider.v1.prices.retrieve.return_value['unit_amount']=9000
    assert change(f,target_plan='free').json()['destination']=='portal'
    f.provider.v1.prices.retrieve.assert_not_called()

@pytest.mark.parametrize('patch',[{'unit_amount':100},{'currency':'eur'},{'active':False},{'livemode':True},
                                 {'recurring':{'interval':'year','interval_count':1,'usage_type':'licensed'}}])
def test_wrong_stripe_price_fails_closed(fixture,patch):
    f=fixture; f.provider.v1.prices.retrieve.return_value.update(patch)
    assert change(f).json()['detail']=='billing_price_mismatch'
    f.provider.v1.checkout.sessions.create.assert_not_called()

def test_manual_pro_preserved(fixture):
    f=fixture; f.entitlement.update(plan='pro',status='active')
    assert change(f).json()['detail']=='plan_managed_separately'
    f.provider.v1.customers.create.assert_not_called()

@pytest.mark.parametrize('payload,expected',[({'expected_user_id':'another-user'},409),({'confirmed':False},409),({'customer':'cus_victim'},422)])
def test_client_cannot_inject_identity_or_skip_confirmation(fixture,payload,expected):
    f=fixture; assert change(f,**payload).status_code==expected
    f.provider.v1.customers.create.assert_not_called()

def test_csrf_and_unauthenticated_requests_denied(fixture):
    f=fixture
    assert f.client.post('/api/subscription/change',json={'target_plan':'pro','expected_user_id':USER,'confirmed':True},headers={'Origin':'https://attacker.example'}).status_code==403
    app.dependency_overrides.clear()
    assert change(f).status_code==401

def test_current_trial_renewal_failure_and_cancellation_sync(fixture):
    f=fixture; f.state['customer_id']='cus_a'
    for i,status in enumerate(['trialing','active','past_due','active','canceled']):
        current=sub(status=status)
        f.provider.v1.subscriptions.retrieve.return_value=current
        # Event body is deliberately stale. Current Stripe state is authoritative.
        result=event(f,event_id=f'evt_{i}')
        assert result.status_code==200,result.text
        assert f.entitlement['status']==status
        assert entitlement_is_active(f.entitlement)==(status in ['active','trialing'])
    assert f.state['trial_used'] and len(f.events)==5
    assert event(f,event_id='evt_4').status_code==200 and len(f.events)==5

@pytest.mark.parametrize('signature,age',[(False,0),(True,301)])
def test_invalid_or_expired_signatures_never_touch_storage(fixture,signature,age):
    f=fixture
    assert event(f,signature=signature,age=age).status_code==400
    assert f.calls==[]

def test_cross_account_subscription_never_grants_access(fixture):
    f=fixture;f.state['customer_id']='cus_a';f.provider.v1.subscriptions.retrieve.return_value=sub(customer='cus_victim')
    assert event(f).status_code==400 and not f.entitlement

def test_previous_subscription_cannot_revoke_current_access(fixture):
    f=fixture;f.state.update(customer_id='cus_a',subscription_id='sub_new',subscription_created=200)
    f.entitlement.update(status='active',plan='pro')
    f.provider.v1.subscriptions.retrieve.return_value=sub(status='canceled')
    assert event(f).status_code==200 and f.entitlement['status']=='active'

def test_non_pro_price_and_missing_period_never_grant_indefinitely(fixture):
    f=fixture;f.state['customer_id']='cus_a'
    f.provider.v1.subscriptions.retrieve.return_value=sub(items={'data':[{'price':{'id':'price_other'},'quantity':1}]})
    assert event(f).status_code==200 and f.entitlement['status']=='inactive'
    f.provider.v1.subscriptions.retrieve.return_value=sub(trial_end=None)
    assert event(f,event_id='evt_missing').status_code==502
    assert 'evt_missing' not in f.events

def test_cancel_at_period_end_preserves_access_until_that_date(fixture):
    f=fixture;f.state['customer_id']='cus_a'
    f.provider.v1.subscriptions.retrieve.return_value=sub(cancel_at_period_end=True)
    assert event(f).status_code==200
    assert entitlement_is_active(f.entitlement) and f.state['cancel_at_period_end']

def test_webhook_retries_transient_provider_failure_and_releases_lease(fixture):
    import stripe
    f=fixture;f.state['customer_id']='cus_a'
    f.provider.v1.subscriptions.retrieve.side_effect=stripe.APIConnectionError('sensitive provider detail')
    response=event(f)
    assert response.status_code==502 and 'sensitive' not in response.text
    assert not f.events and not f.state.get('lease_id')
    f.provider.v1.subscriptions.retrieve.side_effect=None
    f.provider.v1.subscriptions.retrieve.return_value=sub()
    assert event(f).status_code==200

def test_subscription_status_is_sanitized_and_does_not_grant_from_redirect(fixture):
    f=fixture;f.state['customer_id']='cus_a'
    response=f.client.get('/api/subscription?billing=success')
    assert response.json()['plan']=='free'
    assert response.json()['user_id']==USER and response.json()['managed_by_stripe']
    assert 'cus_a' not in response.text and 'sk_test' not in response.text

def test_retry_after_provider_failure_reuses_same_checkout_attempt(fixture):
    import stripe
    f=fixture;f.provider.v1.checkout.sessions.create.side_effect=stripe.APIConnectionError('network')
    assert change(f).status_code==502
    first=f.provider.v1.checkout.sessions.create.call_args.kwargs['options']
    f.provider.v1.checkout.sessions.create.side_effect=None
    assert change(f).status_code==200
    assert f.provider.v1.checkout.sessions.create.call_args.kwargs['options']==first

def test_sdk_uses_pinned_version_and_real_requests_transport(monkeypatch):
    monkeypatch.setenv('STRIPE_SECRET_KEY','sk_test_not_a_real_key')
    c=billing.client()
    assert c.v1.checkout.sessions and c.v1.billing_portal.sessions

@pytest.mark.asyncio
async def test_sdk_v16_resources_are_converted_to_plain_recursive_data():
    import stripe
    value = stripe.Price.construct_from(PRICE, 'sk_test_fixture')
    result = await billing.call(lambda: value)
    assert result['recurring'].get('interval') == 'month'
    assert result.get('unit_amount') == 2000

@pytest.mark.parametrize('features', [{}, {'subscription_cancel': {'enabled': True, 'mode': 'immediately'}, 'payment_method_update': {'enabled': True}}, {'subscription_cancel': {'enabled': True, 'mode': 'at_period_end'}, 'payment_method_update': {'enabled': True}, 'subscription_update': {'enabled': True}}])
def test_unconfigured_or_unrestricted_portal_prevents_new_sales(fixture, features):
    f = fixture
    f.provider.v1.billing_portal.configurations.list.return_value = {'data': [{'id': 'bpc_wrong', 'features': features}]}
    assert change(f).json()['detail'] == 'billing_portal_not_configured'
    f.provider.v1.checkout.sessions.create.assert_not_called()

@pytest.mark.parametrize('url', ['https://attacker.example/pay', 'javascript:alert(1)', 'https://checkout.stripe.com.attacker.example/', 'http://checkout.stripe.com/'])
def test_hosted_redirects_are_allowlisted(fixture,url):
    f=fixture; f.provider.v1.checkout.sessions.create.return_value['url']=url
    assert change(f).json()['detail']=='invalid_billing_redirect'

def test_expired_checkout_uses_a_new_durable_attempt(fixture):
    f=fixture; f.state.update(customer_id='cus_a',checkout_id='cs_old')
    previous=f.state['checkout_attempt']
    f.provider.v1.checkout.sessions.retrieve.return_value={'id':'cs_old','status':'expired'}
    assert change(f).status_code==200
    assert f.state['checkout_attempt'] != previous

def test_durable_busy_lease_prevents_parallel_creation(fixture):
    f=fixture;f.state['lease_id']='another-worker'
    assert change(f).status_code==409
    f.provider.v1.customers.create.assert_not_called()

def test_checkout_disabled_by_missing_key_does_not_call_stripe(fixture,monkeypatch):
    monkeypatch.delenv('STRIPE_WEBHOOK_SECRET')
    assert change(fixture).json()['detail']=='billing_unavailable'
    fixture.provider.v1.customers.create.assert_not_called()

def test_missing_trial_flag_cannot_hide_an_active_subscription_beyond_first_page(fixture):
    f=fixture; f.state['customer_id']='cus_a'
    f.provider.v1.subscriptions.list.return_value={'data':[{'status':'canceled'}],'has_more':True}
    assert change(f).json()['detail']=='billing_history_review_required'
    f.provider.v1.checkout.sessions.create.assert_not_called()


def test_webhook_rejects_oversized_body_before_provider_or_storage(fixture):
    f=fixture
    assert f.client.post('/api/subscription/webhook', content=b'x'*262145).status_code==413
    assert f.calls==[]


def test_billing_validation_does_not_reflect_accidentally_submitted_secret(fixture):
    secret='accidental-secret-never-reflect'
    response=change(fixture,secret_key=secret)
    assert response.status_code==422 and secret not in response.text


@pytest.mark.asyncio
async def test_storage_outage_is_retryable_and_sanitized(monkeypatch):
    from lib.supabase_client import SupabaseAPIError
    async def failure(*args,**kwargs): raise SupabaseAPIError(503,'private provider message')
    monkeypatch.setattr(billing,'service_rest',failure)
    with pytest.raises(HTTPException) as error:
        await billing.db('GET','billing_accounts')
    assert error.value.status_code==503 and error.value.detail=='billing_storage_unavailable'


def test_manual_grant_does_not_block_management_of_an_existing_stripe_subscription(fixture):
    f=fixture;f.state['customer_id']='cus_a';f.entitlement.update(plan='pro',status='active')
    assert change(f,target_plan='free').json()['destination']=='portal'
    f.provider.v1.checkout.sessions.create.assert_not_called()


def test_customer_from_other_stripe_mode_is_not_reused(fixture):
    f=fixture;f.state.update(customer_id='cus_live',livemode=True)
    assert change(f).json()['detail']=='billing_mode_mismatch'
    f.provider.v1.checkout.sessions.create.assert_not_called()


def test_sandbox_entitlement_cannot_unlock_pro_under_live_keys(monkeypatch):
    entitlement={'plan':'pro','status':'active','billing_source':'stripe','billing_livemode':False}
    monkeypatch.setenv('STRIPE_SECRET_KEY','sk_live_fixture')
    assert not entitlement_is_active(entitlement)
    entitlement['billing_livemode']=True
    assert entitlement_is_active(entitlement)
    monkeypatch.delenv('STRIPE_SECRET_KEY')
    assert entitlement_is_active(entitlement), 'Temporary key removal preserves verified, unexpired grants'


@pytest.mark.parametrize('key',['sk_live_fixture','rk_live_fixture'])
@pytest.mark.parametrize('target',['pro','free'])
def test_live_keys_cannot_start_checkout_or_portal_without_owner_approval(fixture,monkeypatch,key,target):
    f=fixture;monkeypatch.setenv('STRIPE_SECRET_KEY',key)
    f.state.update(customer_id='cus_live',livemode=True)
    assert not billing.billing_available()
    response=change(f,target_plan=target)
    assert response.status_code==503 and response.json()['detail']=='live_billing_not_approved'
    assert f.calls==[]
    f.provider.v1.checkout.sessions.create.assert_not_called()
    f.provider.v1.billing_portal.sessions.create.assert_not_called()


def test_even_valid_live_signature_cannot_grant_pro_before_approval(fixture,monkeypatch):
    f=fixture;monkeypatch.setenv('STRIPE_SECRET_KEY','sk_live_fixture')
    f.state.update(customer_id='cus_live',livemode=True)
    result=event(f,body=sub(customer='cus_live',livemode=True),livemode=True)
    assert result.status_code==503 and result.json()['detail']=='live_billing_not_approved'
    assert not f.calls and not f.events and not f.entitlement


def test_live_sdk_cannot_be_constructed_without_approval(monkeypatch):
    import stripe
    monkeypatch.setenv('STRIPE_SECRET_KEY','sk_live_fixture')
    monkeypatch.delenv('STRIPE_LIVE_BILLING_APPROVED',raising=False)
    monkeypatch.setattr(stripe,'StripeClient',lambda *a,**kw:pytest.fail('No live API client is permitted'))
    with pytest.raises(HTTPException) as error: billing.client()
    assert error.value.detail=='live_billing_not_approved'


def test_future_explicit_approval_gate_requires_true_and_does_not_enable_checkout_alone(monkeypatch):
    import stripe
    constructed=[]
    monkeypatch.setenv('STRIPE_SECRET_KEY','sk_live_fixture')
    monkeypatch.setenv('STRIPE_LIVE_BILLING_APPROVED','true')
    monkeypatch.setenv('STRIPE_BILLING_ENABLED','false')
    monkeypatch.setattr(stripe,'StripeClient',lambda *a,**kw:constructed.append(kw) or object())
    assert billing.require_allowed_mode() is True
    assert not billing.billing_available()
    billing.client()
    assert len(constructed)==1  # Fake client only; no Stripe network requests.


@pytest.mark.parametrize('key',['','not-a-stripe-key','sk_live-invalid'])
def test_unknown_key_formats_do_not_enable_billing(fixture,monkeypatch,key):
    monkeypatch.setenv('STRIPE_SECRET_KEY',key)
    monkeypatch.setenv('STRIPE_LIVE_BILLING_APPROVED','true')
    assert not billing.billing_available()
    assert change(fixture).status_code==503
    assert not fixture.calls


def test_subscription_status_shows_provider_cancellation_while_access_remains_trialing(fixture):
    f=fixture;f.state.update(customer_id='cus_a',subscription_id='sub_a',status='trialing',cancel_at_period_end=True)
    f.entitlement.update(plan='pro',status='trialing',billing_source='stripe')
    result=f.client.get('/api/subscription').json()
    assert result['status']=='trialing' and result['cancel_at_period_end'] and result['plan']=='pro'


@pytest.mark.parametrize('mode,token',[('development_header',''),('development_header','fixture-token'),('supabase','')])
def test_development_identity_and_missing_sessions_cannot_authorize_billing(fixture,monkeypatch,mode,token):
    f=fixture;monkeypatch.setenv('AI_AUTH_MODE',mode)
    app.dependency_overrides[require_user]=lambda:SimpleNamespace(id=USER,email='fixture@example.com',access_token=token)
    for response in [f.client.get('/api/subscription'),change(f)]:
        assert response.status_code==401 and response.json()['detail']=='billing_sign_in_required'
    assert not f.calls
    f.provider.v1.customers.create.assert_not_called()



def test_private_billing_status_and_hosted_session_urls_are_not_cacheable(fixture):
    f=fixture
    for response in [f.client.get('/api/subscription'),change(f)]:
        assert response.status_code==200
        assert response.headers['cache-control']=='private, no-store'
