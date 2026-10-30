"""Server presentation authorization; actual calendar/streak math is tested in SQL."""

from types import SimpleNamespace
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from lib.auth import require_user
from routers import progress, workspace

OWNER = str(uuid4())
OTHER = str(uuid4())
ORIGIN = {"Origin": "https://unoword.vercel.app"}


@pytest.fixture
def system(monkeypatch):
    state = {"paid": False, "actual": 20, "calls": [], "records": []}

    async def entitlement(_):
        return (
            {
                "plan": "pro",
                "status": "active",
                "billing_source": "stripe_lifetime",
                "valid_until": None,
            }
            if state["paid"]
            else None
        )

    async def rpc(name, body):
        state["calls"].append((name, body))
        assert body["p_user"] == OWNER
        if name == "writing_streak_presentation":
            paid = body["p_unlimited"]
            return {
                "displayedStreak": state["actual"] if paid else min(7, state["actual"]),
                "hasUnlimitedStreakAccess": paid,
                "streakLimitReached": not paid and state["actual"] >= 7,
                "journeyContinues": not paid and state["actual"] > 7,
                "timezone": body["p_timezone"],
                "asOf": "2026-10-28T12:00:00Z",
            }
        if name == "writing_sync_extension":
            state["records"] += body["p_sessions"]
            return len(body["p_sessions"])
        if name == "writing_progress_history":
            return [{"date": "2026-10-20", "typed_words": 20}]
        if name == "writing_clear_progress":
            return None
        raise AssertionError(name)

    monkeypatch.setattr(progress, "get_entitlement", entitlement)
    monkeypatch.setattr(progress, "rpc", rpc)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fixture")
    app = FastAPI()
    app.include_router(progress.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: SimpleNamespace(
        id=OWNER, access_token="private"
    )
    with TestClient(app) as client:
        yield client, state


def test_plan_transitions_only_change_exposed_values(system):
    c, s = system

    def view():
        return c.get("/api/progress/streak?timezone=America/Chicago")

    assert (
        c.get("/api/progress/streak?unlimited=true&actualStreak=90").json()[
            "displayedStreak"
        ]
        == 7
    )
    r = view()
    assert r.status_code == 200 and r.headers["cache-control"] == "private, no-store"
    assert r.json()["displayedStreak"] == 7 and "actualStreak" not in r.json()
    s["paid"] = True
    assert view().json()["displayedStreak"] == 20
    s["paid"] = False
    assert view().json()["displayedStreak"] == 7
    s["actual"] = 25
    s["paid"] = True
    assert view().json()["displayedStreak"] == 25
    s["actual"] = 0
    assert view().json()["displayedStreak"] == 0
    assert all(name == "writing_streak_presentation" for name, _ in s["calls"])


def test_free_still_syncs_after_seven_days_and_cannot_send_streak_or_permissions(
    system,
):
    c, s = system
    row = {
        "key": "device-session",
        "started_at": "2026-10-20T12:00:00Z",
        "typed_words": 50,
        "pasted_words": 100,
        "duration_seconds": 20,
        "sequence": 1,
    }
    assert (
        c.post(
            "/api/progress/sessions",
            json={"expected_user_id": OWNER, "sessions": [row]},
            headers=ORIGIN,
        ).status_code
        == 200
    )
    assert len(s["records"]) == 1
    assert (
        c.post(
            "/api/progress/sessions",
            json={
                "expected_user_id": OWNER,
                "sessions": [row],
                "actualStreak": 99,
                "unlimited": True,
            },
            headers=ORIGIN,
        ).status_code
        == 422
    )
    assert (
        c.post(
            "/api/progress/sessions",
            json={"expected_user_id": OTHER, "sessions": [row]},
            headers=ORIGIN,
        ).status_code
        == 409
    )
    assert c.get("/api/progress/streak?timezone=not-a-zone").status_code == 422
    assert len(s["records"]) == 1


def test_history_and_premium_milestones_require_verified_paid_access(system):
    c, s = system
    assert c.get("/api/progress/history").status_code == 403
    assert not s["calls"]
    s["paid"] = True
    assert c.get("/api/progress/history").json()["days"][0]["typed_words"] == 20


def test_read_only_recovery_remains_owner_scoped_after_downgrade(monkeypatch):
    calls = []
    document_id = str(uuid4())

    async def rest(method, table, params):
        assert params["user_id"] == "eq." + OWNER
        calls.append(params)
        if params.get("id") == "eq." + document_id:
            return [
                {
                    "title": "Owned writing",
                    "content": {
                        "type": "doc",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {"type": "text", "text": "My original words."}
                                ],
                            }
                        ],
                    },
                }
            ]
        return []

    monkeypatch.setattr(workspace, "service_rest", rest)
    app = FastAPI()
    app.include_router(workspace.router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: SimpleNamespace(
        id=OWNER, access_token="private"
    )
    with TestClient(app) as client:
        for fmt in ["txt", "md", "docx", "pdf"]:
            r = client.get(f"/api/workspace/recovery/{document_id}/export/{fmt}")
            assert r.status_code == 200 and len(r.content) > 0
            assert r.headers["cache-control"] == "private, no-store"
        assert (
            client.get(f"/api/workspace/recovery/{OTHER}/export/txt").status_code == 404
        )
    assert len(calls) == 5


def test_shared_summary_is_account_scoped_and_paid_from_server(system, monkeypatch):
    c, s = system
    async def summary_rpc(name, body):
        s['calls'].append((name,body))
        assert body['p_user']==OWNER
        assert name=='writing_account_summary'
        return {'user_id':OWNER,'dailyActiveWritingSeconds':2100,'lifetimeActiveWritingSeconds':3600,
                'displayedStreak':15 if body['p_unlimited'] else 7,'sessions':[
                    {'id':'editor','active_seconds':1200},{'id':'extension','active_seconds':900}]}
    monkeypatch.setattr(progress,'rpc',summary_rpc)
    r=c.get('/api/progress/summary?timezone=America/Chicago&unlimited=true')
    assert r.status_code==200 and r.headers['cache-control']=='private, no-store'
    assert r.json()['dailyActiveWritingSeconds']==2100
    assert r.json()['displayedStreak']==7
    assert not s['calls'][-1][1]['p_unlimited']
    s['paid']=True
    assert c.get('/api/progress/summary').json()['displayedStreak']==15
    assert c.get('/api/progress/summary?timezone=invalid').status_code==422
    assert c.get('/api/progress/summary?date=not-a-date').status_code==422


def test_preferences_revisions_owner_and_reporting_validation(system,monkeypatch):
    c,s=system
    async def pref_rpc(name,body):
        assert body['p_user']==OWNER
        if name=='writing_account_preferences':return {'user_id':OWNER,'revision':4,'daily_goal':1000}
        if body['p_revision']!=4:return {'conflict':True,'current':{'user_id':OWNER,'revision':4,'daily_goal':1000}}
        return {'user_id':OWNER,'revision':5,**body['p_patch']}
    monkeypatch.setattr(progress,'rpc',pref_rpc)
    assert c.get('/api/progress/preferences').json()['daily_goal']==1000
    body={'expected_user_id':OWNER,'revision':4,'daily_goal':500,'timezone':'America/Chicago'}
    assert c.put('/api/progress/preferences',json=body,headers=ORIGIN).json()['revision']==5
    assert c.put('/api/progress/preferences',json={**body,'revision':1},headers=ORIGIN).status_code==409
    assert c.put('/api/progress/preferences',json={**body,'expected_user_id':OTHER},headers=ORIGIN).status_code==409
    assert c.put('/api/progress/preferences',json={**body,'timezone':'bad-zone'},headers=ORIGIN).status_code==422
    assert c.put('/api/progress/preferences',json={**body,'plan':'pro'},headers=ORIGIN).status_code==422
    assert c.put('/api/progress/preferences',json=body,headers={'Origin':'https://untrusted.test'}).status_code==403


def test_intervals_are_validated_and_cannot_relabel_source(system):
    c,s=system
    row={'key':'one','started_at':'2026-10-20T12:00:00Z','typed_words':50,'duration_seconds':1200,'sequence':1,
         'device_id':'device-A','active_intervals':[[1792497600000,1792498800000]],
         'timer':{'status':'paused','active_ms':1200000,'paused_ms':0,'changed_at':1792498800000}}
    def send(item):return c.post('/api/progress/sessions',json={'expected_user_id':OWNER,'sessions':[item]},headers=ORIGIN)
    assert send(row).status_code==200
    assert send({**row,'active_intervals':[[1792498800000,1792497600000]]}).status_code==422
    assert send({**row,'duration_seconds':100}).status_code==422
    assert send({**row,'source':'editor'}).status_code==422
    assert send({**row,'timer':{**row['timer'],'status':'invalid'}}).status_code==422


def test_remote_activity_uses_user_token_and_owner_filter(system,monkeypatch):
    c,s=system
    async def rest(method,table,token,params):
        assert method=='GET' and table=='writing_activity' and token=='private'
        assert params['user_id']=='eq.'+OWNER and 'source' not in params
        return [{'id':'editor','user_id':OWNER},{'id':'extension','user_id':OWNER}]
    monkeypatch.setattr(progress,'user_rest',rest)
    assert len(c.get('/api/progress/activity').json())==2
    assert c.get('/api/progress/activity?offset=-1').status_code==422


def test_premium_history_statistics_gate(system,monkeypatch):
    c,s=system
    async def stats_rpc(name,body):
        assert name=='writing_account_statistics' and body['p_user']==OWNER
        return {'totalWords':1000,'activeWritingSeconds':2700,'buckets':[]}
    monkeypatch.setattr(progress,'rpc',stats_rpc)
    assert c.get('/api/progress/statistics').json()['activeWritingSeconds']==2700
    assert c.get('/api/progress/statistics?range=all').status_code==403
    assert c.get('/api/progress/statistics?range=invalid').status_code==422
    s['paid']=True
    assert c.get('/api/progress/statistics?range=all').json()['totalWords']==1000


def test_free_historical_summary_is_mapped_to_permission_denial(monkeypatch):
    import asyncio
    from fastapi import HTTPException
    from lib.supabase_client import SupabaseAPIError
    async def blocked(*args,**kwargs):
        raise SupabaseAPIError(403,'writing_history_pro_required')
    monkeypatch.setattr(progress,'service_rest',blocked)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(progress.rpc('writing_account_summary',{'p_user':OWNER,'p_unlimited':False}))
    assert caught.value.status_code==403
