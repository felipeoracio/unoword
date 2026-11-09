"""Domain migration preserves explicit test URLs, origin isolation and callbacks."""
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from lib.site_urls import PRIMARY_ORIGIN, LEGACY_ORIGINS, public_app_url, webhook_urls
from lib.billing import app_url
from lib.browser_auth import app_origin, flow_origin
from lib.request_security import web_origins, allowed_origin


@pytest.mark.parametrize('configured',[None,PRIMARY_ORIGIN,*LEGACY_ORIGINS])
def test_all_production_defaults_and_old_settings_resolve_to_primary(monkeypatch,configured):
    monkeypatch.delenv('PUBLIC_APP_URL',raising=False)
    if configured is not None:monkeypatch.setenv('PUBLIC_APP_URL',configured+'/')
    assert public_app_url()==app_url()==app_origin()==PRIMARY_ORIGIN


def test_explicit_preview_remains_separate_from_production_and_legacy_hooks(monkeypatch):
    monkeypatch.setenv('PUBLIC_APP_URL','https://sandbox.example.com/')
    assert app_url()==app_origin()=='https://sandbox.example.com'
    assert webhook_urls('/api/webhooks/substack-stripe')==['https://sandbox.example.com/api/webhooks/substack-stripe']


def test_primary_and_owned_legacy_clients_are_allowed_without_wildcards(monkeypatch):
    monkeypatch.setenv('PUBLIC_APP_URL',PRIMARY_ORIGIN)
    monkeypatch.setenv('CORS_ORIGINS','*')
    monkeypatch.setenv('AUTH_ALLOWED_ORIGINS','https://unoword.app.evil.example/path')
    assert all(allowed_origin(origin) for origin in (PRIMARY_ORIGIN,*LEGACY_ORIGINS))
    assert '*' not in web_origins()
    assert not allowed_origin('https://unoword.app.evil.example')
    assert not allowed_origin('null')


@pytest.mark.parametrize('value',['http://unoword.app','https://user:secret@unoword.app','https://unoword.app/other','https://unoword.app?next=evil'])
def test_invalid_auth_and_billing_origins_still_fail_closed(monkeypatch,value):
    monkeypatch.setenv('PUBLIC_APP_URL',value)
    with pytest.raises(HTTPException):app_origin()
    with pytest.raises(HTTPException):app_url()


@pytest.mark.parametrize('host',['unoword.vercel.app','www.unoword.app','unoword.app','evil.example'])
@pytest.mark.parametrize('query',[b'',b'domain_recovery=1'])
def test_recovery_flow_never_returns_an_unowned_origin(monkeypatch,host,query):
    monkeypatch.setenv('PUBLIC_APP_URL',PRIMARY_ORIGIN)
    request=Request({'type':'http','scheme':'https','server':(host,443),'path':'/api/auth/google/start','query_string':query,'headers':[(b'host',host.encode())]})
    expected='https://'+host if query and 'https://'+host in LEGACY_ORIGINS else PRIMARY_ORIGIN
    assert flow_origin(request)==expected


def test_existing_stripe_destinations_are_bounded_compatibility_urls(monkeypatch):
    monkeypatch.setenv('PUBLIC_APP_URL',PRIMARY_ORIGIN)
    assert webhook_urls('/api/webhooks/substack-stripe')==[origin+'/api/webhooks/substack-stripe' for origin in (PRIMARY_ORIGIN,*LEGACY_ORIGINS)]
