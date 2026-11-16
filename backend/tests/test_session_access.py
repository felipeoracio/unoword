"""Read-only pooler transport, verified owner scope, failures and readiness."""
from types import SimpleNamespace
from unittest.mock import Mock, MagicMock
import pytest
import psycopg2
from fastapi import HTTPException
from fastapi.testclient import TestClient
from server import app
from lib import session_access as access, ai_access
from routers import health, auth
from lib.auth import require_user, AuthenticatedUser

OWNER = '00000000-0000-4000-8000-000000000001'
PRO = {'user_id': OWNER, 'plan': 'pro', 'status': 'active', 'billing_source': 'manual'}
DSN = 'postgresql://postgres.project:private-password@aws-0.region.pooler.supabase.com:6543/postgres'

@pytest.fixture
def database(monkeypatch):
    monkeypatch.setattr(access, 'get_supabase_config', lambda: SimpleNamespace(db_url=DSN, url='https://project.supabase.co'))
    monkeypatch.delenv('SUBSTACK_STRIPE_SECRET_KEY', raising=False)
    cursor = MagicMock();cursor.fetchone.return_value = (PRO,);cursor.__enter__.return_value=cursor
    connection = Mock();connection.cursor.return_value = cursor
    connect = Mock(return_value=connection);monkeypatch.setattr(access.psycopg2, 'connect', connect)
    return SimpleNamespace(cursor=cursor,connection=connection,connect=connect)

@pytest.mark.asyncio
async def test_pooler_serves_verified_session_while_data_api_is_down(database,monkeypatch):
    async def unavailable(*args):pytest.fail('healthy pooler must not call the failing Data API')
    monkeypatch.setattr(ai_access,'get_entitlement',unavailable)
    assert await access.get_session_entitlement(OWNER)==PRO
    database.connection.set_session.assert_called_once_with(readonly=True,autocommit=False)
    sql=database.cursor.execute.call_args_list
    assert sql[0].args == ("set local statement_timeout = '2500ms'",)
    assert sql[1].args == ("set local lock_timeout = '500ms'",)
    assert sql[2].args == ('set local role service_role',)
    assert sql[3].args[1] == (OWNER,)
    assert '%s::uuid' in sql[3].args[0] and OWNER not in sql[3].args[0]
    database.connection.close.assert_called_once()
    assert database.connect.call_args.kwargs['connect_timeout']==3
    assert database.connect.call_args.kwargs['sslmode']=='require'

@pytest.mark.asyncio
async def test_missing_native_grant_does_not_create_paid_access(database):
    database.cursor.fetchone.return_value=None
    assert await access.get_session_entitlement(OWNER) is None

@pytest.mark.asyncio
async def test_invalid_identity_is_rejected_before_connecting(database):
    with pytest.raises(HTTPException) as error:await access.get_session_entitlement("x' or true--")
    assert error.value.status_code==401
    database.connect.assert_not_called()

@pytest.mark.parametrize('dsn',[DSN.replace(':6543',':5432'),DSN.replace('.pooler.supabase.com','.outside.example'),DSN.replace('postgres.project','postgres.another'), 'bad'])
def test_invalid_or_cross_project_pooler_is_not_used(database,monkeypatch,dsn):
    monkeypatch.setattr(access,'get_supabase_config',lambda:SimpleNamespace(db_url=dsn,url='https://project.supabase.co'))
    with pytest.raises(HTTPException):access._probe()
    database.connect.assert_not_called()

@pytest.mark.asyncio
async def test_connection_failure_uses_independent_existing_api(database,monkeypatch,caplog):
    database.connect.side_effect=psycopg2.OperationalError('private-password')
    async def healthy(owner):assert owner==OWNER;return PRO
    monkeypatch.setattr(ai_access,'get_entitlement',healthy)
    assert await access.get_session_entitlement(OWNER)==PRO
    assert 'private-password' not in caplog.text

@pytest.mark.asyncio
async def test_both_transports_failing_never_grants_access(database,monkeypatch):
    database.connect.side_effect=psycopg2.OperationalError('down')
    async def unavailable(owner):raise HTTPException(503,'unavailable')
    monkeypatch.setattr(ai_access,'get_entitlement',unavailable)
    with pytest.raises(HTTPException) as error:await access.get_session_entitlement(OWNER)
    assert error.value.status_code==503


def test_saturation_does_not_open_another_connection(database,monkeypatch):
    slots=Mock();slots.acquire.return_value=False;monkeypatch.setattr(access,'_slots',slots)
    with pytest.raises(HTTPException):access._probe()
    database.connect.assert_not_called();slots.acquire.assert_called_once_with(timeout=1)


def test_query_failure_closes_connection_and_releases_slot(database,monkeypatch):
    slots=Mock();slots.acquire.return_value=True;monkeypatch.setattr(access,'_slots',slots)
    database.cursor.execute.side_effect=psycopg2.errors.QueryCanceled('timeout')
    with pytest.raises(HTTPException):access._probe()
    database.connection.close.assert_called_once();slots.release.assert_called_once()

@pytest.mark.asyncio
async def test_no_pooler_configuration_preserves_api_adapter(monkeypatch):
    monkeypatch.setattr(access,'get_supabase_config',lambda:SimpleNamespace(db_url=''))
    async def api(owner):assert owner==OWNER;return PRO
    monkeypatch.setattr(ai_access,'get_entitlement',api)
    assert await access.get_session_entitlement(OWNER)==PRO


def test_configured_external_grant_is_owner_scoped(database,monkeypatch):
    monkeypatch.setenv('SUBSTACK_STRIPE_SECRET_KEY','rk_test_external')
    from lib import substack_stripe
    monkeypatch.setattr(substack_stripe,'config',lambda:SimpleNamespace(account='acct_expected',live=False))
    database.cursor.fetchone.side_effect=[None,({'user_id':OWNER,'plan':'pro','status':'active'},)]
    result=access._lookup(OWNER)
    assert result['plan']=='pro'
    assert database.cursor.execute.call_args.args[1]==(OWNER,'acct_expected',False)


def test_health_reports_real_dependency_failure_without_private_details(monkeypatch):
    async def ok():return None
    async def bad():raise RuntimeError('private-connection-string')
    monkeypatch.setattr(health,'probe_session_database',ok);monkeypatch.setattr(health,'probe_data_api',bad)
    with TestClient(app) as client:result=client.get('/api/health/ready')
    assert result.status_code==503
    assert result.json()=={'status':'degraded','checks':{'session_database':'ok','data_api':'error'}}
    assert result.headers['cache-control']=='private, no-store'
    assert 'private-connection-string' not in result.text


def test_health_ready_only_when_both_dependencies_work(monkeypatch):
    async def ok():return None
    monkeypatch.setattr(health,'probe_session_database',ok);monkeypatch.setattr(health,'probe_data_api',ok)
    with TestClient(app) as client:result=client.get('/api/health/ready')
    assert result.status_code==200 and result.json()['status']=='ready'


def test_session_route_uses_pooler_without_changing_authorization(database,monkeypatch):
    user=AuthenticatedUser(id=OWNER,plan='unverified',access_token='private-token')
    monkeypatch.setitem(app.dependency_overrides,require_user,lambda:user)
    async def identity(*args,**kwargs):return {'id':OWNER,'email':'writer@example.com'}
    monkeypatch.setattr(auth,'auth_request',identity)
    with TestClient(app) as client:result=client.get('/api/auth/me')
    assert result.status_code==200 and result.json()['ai_access'] is True
    database.connection.close.assert_called_once()
