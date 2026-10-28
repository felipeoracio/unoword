"""Shared editor/extension concurrency, accounting and failure contracts."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from lib import ai_quota, workspace_ai
from routers import ai


@pytest.mark.parametrize("env,account,expected", [(0,100,100),(100,250,100),(250,100,100),(0,250,250),(100,0,100),(0,0,0)])
def test_effective_limit_preserves_stricter_configured_cap(monkeypatch, env, account, expected):
    monkeypatch.setenv("AI_DAILY_REQUEST_LIMIT", str(env))
    assert ai_quota.resolve_daily_limit({"daily_request_limit": account}) == expected


@pytest.mark.parametrize("cap", ["bad", "-1"])
def test_bad_config_fails_closed(monkeypatch, cap):
    monkeypatch.setenv("AI_DAILY_REQUEST_LIMIT", cap)
    with pytest.raises(HTTPException) as error:
        ai_quota.resolve_daily_limit({"daily_request_limit": 100})
    assert error.value.status_code == 503


async def test_concurrent_editor_and_extension_requests_share_last_slots(monkeypatch, quota_store):
    user = SimpleNamespace(id="writer", access_token="private")
    async def entitlement(_):
        return {"plan": "pro", "daily_request_limit": 7}
    async def generation(payload, user, *args):
        quota = args[-1]
        # Allow all contenders to reach reservation while existing jobs run.
        await asyncio.sleep(0.01)
        await quota.complete(100, 20)
        return "generated"
    monkeypatch.setattr(ai, "_entitlement", entitlement)
    monkeypatch.setattr(workspace_ai, "get_entitlement", entitlement)
    monkeypatch.setattr(workspace_ai, "get_suggestion_provider", lambda: SimpleNamespace(name="test"))
    monkeypatch.setattr(ai, "_generate_suggestion", generation)
    monkeypatch.setattr(workspace_ai, "_generate_assistance", generation)
    results = await asyncio.gather(*[
        (ai.create_suggestion(None, user) if i % 2 else workspace_ai.generate_assistance(None, user))
        for i in range(40)
    ], return_exceptions=True)
    assert results.count("generated") == 7
    denied = [r for r in results if isinstance(r, HTTPException)]
    assert len(denied) == 33 and all(r.status_code == 429 for r in denied)
    assert len(quota_store.rows) == 7
    assert {r["request_type"] for r in quota_store.rows} == {"suggestion", "workspace_assistant"}
    assert all(r["input_tokens"] == 100 and r["output_tokens"] == 20 for r in quota_store.rows)
    summary = await ai.usage_summary(Response(), user)
    assert (summary.used_today, summary.pending_today, summary.remaining) == (7, 0, 0)
    # Another account has its own full allowance.
    other = SimpleNamespace(id="other", access_token="other-private")
    assert (await ai.usage_summary(Response(), other)).remaining == 7


async def test_pending_summary_then_idempotent_completion_without_double_count(monkeypatch, quota_store):
    async def entitlement(_): return {"plan": "pro", "daily_request_limit": 2}
    monkeypatch.setattr(ai, "_entitlement", entitlement)
    user = SimpleNamespace(id="writer")
    async with ai_quota.AIRequest(user.id, 2, "workspace_assistant") as quota:
        summary = await ai.usage_summary(Response(), user)
        assert (summary.used_today, summary.pending_today, summary.remaining) == (0, 1, 1)
        await quota.complete(20, 30)
        await quota.complete(20, 30)
        summary = await ai.usage_summary(Response(), user)
        assert (summary.used_today, summary.pending_today, summary.remaining) == (1, 0, 1)
    assert len(quota_store.rows) == 1


async def test_failure_fallback_and_cancellation_release_slots(quota_store):
    with pytest.raises(ValueError):
        async with ai_quota.AIRequest("writer", 1, "suggestion"):
            raise ValueError("provider or persistence failed")
    assert not quota_store.reservations
    async with ai_quota.AIRequest("writer", 1, "suggestion"):
        pass  # Local/basic fallback, no successful model call.
    assert not quota_store.reservations and not quota_store.rows
    started = asyncio.Event()
    async def job():
        async with ai_quota.AIRequest("writer", 1, "workspace_assistant"):
            started.set()
            await asyncio.Event().wait()
    task = asyncio.create_task(job())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert not quota_store.reservations


async def test_request_deadline_releases_before_database_lease_expires(monkeypatch, quota_store):
    timeout = asyncio.timeout
    monkeypatch.setattr(ai_quota.asyncio, "timeout", lambda _: timeout(0.01))
    with pytest.raises(HTTPException) as error:
        async with ai_quota.AIRequest("writer", 1, "suggestion"):
            await asyncio.Event().wait()
    assert error.value.status_code == 504 and not quota_store.reservations


@pytest.mark.parametrize("failure", ["ai_reserve_request", "ai_complete_request"])
async def test_database_errors_fail_closed_without_private_detail(quota_store, failure):
    quota_store.fail = failure
    with pytest.raises(HTTPException) as error:
        async with ai_quota.AIRequest("writer", 1, "suggestion") as quota:
            await quota.complete(10, 20)
    assert error.value.status_code == 503 and error.value.detail == "ai_usage_unavailable"
    assert not quota_store.rows and not quota_store.reservations


async def test_uncapped_generation_is_unavailable(quota_store):
    with pytest.raises(HTTPException) as error:
        async with ai_quota.AIRequest("writer", 0, "suggestion"):
            pytest.fail("No provider work without a configured cap")
    assert error.value.status_code == 503 and not quota_store.calls


async def test_usage_service_failure_is_unavailable(quota_store):
    quota_store.fail = "ai_usage_summary"
    with pytest.raises(HTTPException) as error:
        await ai_quota.usage_counts("writer")
    assert error.value.status_code == 503
