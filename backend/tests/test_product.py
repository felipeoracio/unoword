"""Anonymous marketing catalog shares the same capability policy as AI access."""
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from lib.ai_access import entitlement_is_active
from lib.plans import plan_features
from server import app
import pytest


def test_public_catalog_does_not_require_auth_or_expose_credentials(monkeypatch):
    from routers import ai
    monkeypatch.setenv('STRIPE_BILLING_ENABLED', 'false')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'must-not-appear')
    monkeypatch.setenv('OPENAI_API_KEY', 'must-not-appear')
    monkeypatch.setattr(ai, 'get_suggestion_provider', lambda: pytest.fail('Marketing must not resolve an AI provider'))
    response = TestClient(app).get('/api/product')
    assert response.status_code == 200
    result = response.json()
    assert result['name'] == 'UnoWord'
    assert result['billing_available'] is False
    assert result['plans'][0]['price'] is None
    assert result['plans'][1]['price'] == {'amount': 2000, 'currency': 'usd', 'interval': 'month', 'trial_days': 7}
    assert 'must-not-appear' not in response.text
    assert 'daily_request_limit' not in response.text
    for plan in result['plans']:
        assert plan['features'] == plan_features(plan['id'])
    assert result['plans'][0]['features']['writing_profile'] is True
    assert result['plans'][0]['features']['quick_prompt'] is True
    assert result['plans'][0]['features']['writing_editor'] is False
    assert result['plans'][1]['features']['writing_editor'] is True
    assert result['plans'][0]['features']['new_topic'] is False


@pytest.mark.parametrize('plan,status,eligible', [('free','active',False),('pro','active',True),('premium','trialing',True),('pro','expired',False),('invented','active',False)])
def test_catalog_and_paid_authorization_agree(plan,status,eligible):
    assert entitlement_is_active({'plan':plan,'status':status}) is eligible


def test_expired_paid_account_remains_ineligible():
    assert not entitlement_is_active({'plan':'pro','status':'active','valid_until':(datetime.now(timezone.utc)-timedelta(days=1)).isoformat()})


@pytest.mark.parametrize('url', ['javascript:alert(1)','https://attacker.example/detail/abc','https://chromewebstore.google.com.attacker.example/detail/abc','http://chromewebstore.google.com/detail/abc','https://[invalid',''])
def test_unverified_listing_config_is_not_accepted(monkeypatch,url):
    monkeypatch.setenv('PUBLIC_CHROME_STORE_URL',url)
    assert TestClient(app).get('/api/product').json()['chrome_store_url'] is None


def test_configured_chrome_store_link_is_returned(monkeypatch):
    url='https://chromewebstore.google.com/detail/example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    monkeypatch.setenv('PUBLIC_CHROME_STORE_URL',url)
    assert TestClient(app).get('/api/product').json()['chrome_store_url']==url
