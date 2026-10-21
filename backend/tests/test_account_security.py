"""Provider-boundary tests; never email or mutate an existing real account."""
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from server import app
from lib.auth import require_user
from lib.supabase_client import SupabaseAPIError
from lib.request_security import _bursts
from routers import account_security as security
from routers import subscriptions

ORIGIN = {'Origin': 'https://unoword.vercel.app'}
OWNER = 'writer-a'
CURRENT = 'current-secret-never-reflect'
NEW = 'replacement-secret-never-reflect'

@pytest.fixture
def fixture(monkeypatch):
    _bursts.clear()
    monkeypatch.setenv('STRIPE_BILLING_ENABLED', 'false')
    calls = []
    identity = {'id': OWNER, 'email': 'writer@example.com', 'email_confirmed_at': 'today', 'app_metadata': {'providers': ['email']}}
    session = {'access_token': 'fresh-session-secret', 'refresh_token': 'refresh-secret', 'user': identity}
    async def provider(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if path == 'user' and method == 'GET': return identity
        if path == 'settings': return {'mailer_autoconfirm': False}
        if path == 'verify': return session
        return identity
    async def grant(email, password):
        if password != CURRENT: raise SupabaseAPIError(400, 'Invalid login credentials')
        assert email == identity['email']
        return session
    monkeypatch.setattr(security, 'auth_request', provider)
    monkeypatch.setattr(security, '_password_grant', grant)
    monkeypatch.setenv('AUTH_SECURITY_EMAILS_CONFIGURED', 'true')
    app.dependency_overrides[require_user] = lambda: SimpleNamespace(id=OWNER, access_token='current-session', email='stale@example.com')
    with TestClient(app) as client:
        yield client, calls, identity
    app.dependency_overrides.clear()
    _bursts.clear()

def owned(**kwargs):
    return {'expected_user_id': OWNER, 'current_password': CURRENT, **kwargs}

def test_password_uses_reauth_and_provider_revokes_other_sessions(fixture):
    client, calls, identity = fixture
    result = client.post('/api/auth/password/change', json=owned(new_password=NEW, confirm_password=NEW), headers=ORIGIN)
    assert result.status_code == 200
    assert result.json()['other_sessions_revoked'] is True
    update = next(c for c in calls if c[:2] == ('PUT', 'user'))
    assert update[2] == {'access_token': 'fresh-session-secret', 'json': {'password': NEW}}
    assert any(c[1] == 'logout?scope=others' for c in calls)
    assert 'HttpOnly' in result.headers['set-cookie'] and 'Secure' in result.headers['set-cookie']
    assert all('admin/' not in c[1] for c in calls)
    assert NEW not in result.text

@pytest.mark.parametrize('path,body', [
    ('password/change', owned(new_password=NEW, confirm_password='different-password')),
    ('password/change', owned(new_password='tiny', confirm_password='tiny')),
    ('email/change', owned(email='invalid')),
    ('password/change', owned(new_password=NEW, confirm_password=NEW, user_id='writer-b')),
])
def test_validation_never_reflects_secrets(fixture, path, body):
    client, calls, _ = fixture
    result = client.post('/api/auth/' + path, json=body, headers=ORIGIN)
    assert result.status_code == 422
    assert CURRENT not in result.text and NEW not in result.text
    assert not calls

@pytest.mark.parametrize('path,body', [
    ('password/change', owned(new_password=NEW, confirm_password=NEW)), ('email/change', owned(email='new@example.com')),
])
def test_wrong_current_password_never_mutates(fixture, path, body):
    client, calls, _ = fixture
    body['current_password'] = 'wrong-secret'
    result = client.post('/api/auth/' + path, json=body, headers=ORIGIN)
    assert result.status_code == 401
    assert not any(c[0] == 'PUT' for c in calls)
    assert 'wrong-secret' not in result.text

def test_account_swap_rejected_before_provider(fixture):
    client, calls, _ = fixture
    result = client.post('/api/auth/password/change', json=owned(expected_user_id='writer-b', new_password=NEW, confirm_password=NEW), headers=ORIGIN)
    assert result.status_code == 409 and calls == []

@pytest.mark.parametrize('headers', [{}, {'Origin': 'https://attacker.example'}, {'Origin': 'chrome-extension://fake/path'}])
def test_cookie_csrf_rejected(fixture, headers):
    client, calls, _ = fixture
    result = client.post('/api/auth/password/change', json=owned(new_password=NEW, confirm_password=NEW), headers=headers)
    assert result.status_code == 403 and calls == []

def test_social_identity_uses_provider_guidance(fixture):
    client, calls, identity = fixture
    identity['app_metadata']['providers'] = ['google']
    assert client.get('/api/auth/security').json()['password_identity'] is False
    result = client.post('/api/auth/email/change', json=owned(email='new@example.com'), headers=ORIGIN)
    assert result.status_code == 409 and result.json()['detail'] == 'identity_provider_required'
    assert not any(c[0] == 'PUT' for c in calls)

def test_email_request_preserves_current_identity_and_requires_verification(fixture):
    client, calls, identity = fixture
    result = client.post('/api/auth/email/change', json=owned(email='new@example.com'), headers=ORIGIN)
    assert result.status_code == 200 and result.json()['status'] == 'verification_required'
    assert identity['email'] == 'writer@example.com' and identity['id'] == OWNER
    assert next(c for c in calls if c[0] == 'PUT')[2]['json'] == {'email': 'new@example.com'}

def test_email_disabled_until_configured_and_never_autoconfirmed(fixture, monkeypatch):
    client, calls, _ = fixture
    monkeypatch.setenv('AUTH_SECURITY_EMAILS_CONFIGURED', 'false')
    result = client.post('/api/auth/email/change', json=owned(email='new@example.com'), headers=ORIGIN)
    assert result.status_code == 503 and not any(c[0] == 'PUT' for c in calls)

def test_email_autoconfirm_rejected(fixture, monkeypatch):
    client, calls, _ = fixture
    original = security.auth_request
    async def provider(method, path, **kwargs):
        if path == 'settings': return {'mailer_autoconfirm': True}
        return await original(method, path, **kwargs)
    monkeypatch.setattr(security, 'auth_request', provider)
    result = client.post('/api/auth/email/change', json=owned(email='new@example.com'), headers=ORIGIN)
    assert result.status_code == 503 and not any(c[0] == 'PUT' for c in calls)

def test_resend_uses_provider_pending_address_and_cooldown(fixture):
    client, calls, identity = fixture
    identity['new_email'] = 'pending@example.com'
    assert client.post('/api/auth/email/resend', json=owned(), headers=ORIGIN).status_code == 200
    assert client.post('/api/auth/email/resend', json=owned(), headers=ORIGIN).status_code == 429
    assert next(c for c in calls if c[1] == 'resend')[2]['json']['email'] == identity['new_email']

def test_recovery_is_generic_even_for_provider_rejection(fixture, monkeypatch):
    client, calls, _ = fixture
    async def unavailable(*args, **kwargs): raise SupabaseAPIError(400, 'User not found')
    monkeypatch.setattr(security, 'auth_request', unavailable)
    results = [client.post('/api/auth/recovery', json={'email': email}, headers=ORIGIN) for email in ['missing@example.com', 'real@example.com']]
    assert all(r.status_code == 202 for r in results)
    assert results[0].json() == results[1].json()

def test_recovery_rate_limited(fixture):
    client, _, _ = fixture
    for _ in range(5): assert client.post('/api/auth/recovery', json={'email': 'a@example.com'}, headers=ORIGIN).status_code == 202
    assert client.post('/api/auth/recovery', json={'email': 'a@example.com'}, headers=ORIGIN).status_code == 429

def test_recovery_consumes_one_use_provider_token_before_password_update(fixture, monkeypatch):
    client, calls, _ = fixture
    provider = security.auth_request
    used = False
    async def once(method, path, **kwargs):
        nonlocal used
        if path == 'verify':
            if used: raise SupabaseAPIError(403, 'Token expired')
            used = True
            assert kwargs['json']['type'] == 'recovery'
        return await provider(method, path, **kwargs)
    monkeypatch.setattr(security, 'auth_request', once)
    body = {'token_hash': 'one-use-secret', 'new_password': NEW, 'confirm_password': NEW}
    first = client.post('/api/auth/recovery/complete', json=body, headers=ORIGIN)
    second = client.post('/api/auth/recovery/complete', json=body, headers=ORIGIN)
    assert first.status_code == 200 and second.status_code == 400
    assert len([c for c in calls if c[0] == 'PUT']) == 1
    assert 'one-use-secret' not in first.text + second.text

def test_email_verification_does_not_claim_both_links_complete(fixture):
    client, calls, _ = fixture
    result = client.post('/api/auth/email/verify', json={'token_hash': 'secret-token'}, headers=ORIGIN)
    assert result.status_code == 200 and result.json()['status'] == 'verification_accepted_check_both_addresses'
    assert next(c for c in calls if c[1] == 'verify')[2]['json']['type'] == 'email_change'

def test_signed_out_cannot_mutate(fixture):
    client, calls, _ = fixture
    app.dependency_overrides.clear()
    result = client.post('/api/auth/password/change', json=owned(new_password=NEW, confirm_password=NEW), headers=ORIGIN)
    assert result.status_code == 401 and not calls

@pytest.mark.parametrize('confirmed,owner,status', [(False,OWNER,409),(True,'writer-b',409),(True,OWNER,503)])
def test_plan_requests_never_grant_entitlement(fixture, confirmed, owner, status):
    client, calls, _ = fixture
    result = client.post('/api/subscription/change', json={'target_plan':'pro','expected_user_id':owner,'confirmed':confirmed}, headers=ORIGIN)
    assert result.status_code == status and not calls

@pytest.mark.parametrize('status,detail,expected', [(422,'Email already registered','email_unavailable'),(422,'Weak password policy','password_policy_rejected')])
def test_provider_rejections_never_echo_credentials(fixture, monkeypatch, status, detail, expected):
    client, _, _ = fixture
    original = security.auth_request
    async def provider(method, path, **kwargs):
        if method == 'PUT': raise SupabaseAPIError(status, detail)
        return await original(method, path, **kwargs)
    monkeypatch.setattr(security, 'auth_request', provider)
    result = client.post('/api/auth/email/change', json=owned(email='duplicate@example.com'), headers=ORIGIN)
    assert result.status_code == 400 and result.json()['detail'] == expected
    assert CURRENT not in result.text


def test_provider_outage_does_not_claim_session_is_invalid(fixture, monkeypatch):
    client, _, _ = fixture
    from routers import auth
    async def unavailable(*args, **kwargs): raise SupabaseAPIError(502, 'Supabase temporarily unreachable')
    monkeypatch.setattr(auth, 'auth_request', unavailable)
    assert client.get('/api/auth/me').status_code == 502
    monkeypatch.setattr(security, 'auth_request', unavailable)
    assert client.get('/api/auth/security').status_code == 502


def test_me_displays_verified_provider_email_instead_of_stale_jwt(fixture, monkeypatch):
    client, _, identity = fixture
    from routers import auth
    async def provider(*args, **kwargs): return identity
    async def entitlement(*args): return {'plan':'pro','status':'active'}
    monkeypatch.setattr(auth,'auth_request',provider)
    monkeypatch.setattr(auth,'get_entitlement',entitlement)
    result=client.get('/api/auth/me')
    assert result.status_code == 200 and result.json()['email']==identity['email']
    assert result.json()['id']==OWNER and result.json()['ai_access']
