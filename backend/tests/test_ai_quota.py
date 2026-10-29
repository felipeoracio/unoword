"""Atomic versioned allowance orchestration; PostgreSQL concurrency tested separately."""
import asyncio
from uuid import uuid4
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from lib import ai_quota
from models.ai import AISuggestionRequest

async def test_surfaces_share_last_suggestion_slot_and_guidance_is_independent(quota_store):
    quota_store.daily=1
    async def call(feature):
        async with ai_quota.AIRequest('writer',feature=feature) as quota:
            await asyncio.sleep(.01)
            await quota.complete(100,20,model='test',response={'feature':feature})
            return 'generated'
    results=await asyncio.gather(*[call('suggestion') for _ in range(20)],return_exceptions=True)
    assert results.count('generated')==1
    assert all(r.status_code==429 for r in results if isinstance(r,HTTPException))
    assert await call('guidance')=='generated'
    assert len(quota_store.rows)==2

async def test_idempotent_retry_replays_result_without_second_model_or_credit(quota_store):
    payload=AISuggestionRequest(request_id=uuid4())
    async with ai_quota.AIRequest('writer',payload=payload) as quota:
        await quota.complete(100,20,model='test',response={'title':'Coaching'})
    async with ai_quota.AIRequest('writer',payload=payload) as retry:
        assert retry.replay=={'title':'Coaching'}
    assert len(quota_store.rows)==1
    changed=payload.model_copy(update={'current_writing':'Different context'})
    with pytest.raises(HTTPException) as error:
        async with ai_quota.AIRequest('writer',payload=changed): pytest.fail('Changed payload cannot reuse the key')
    assert error.value.status_code==409

async def test_failure_and_cancellation_release_slots(quota_store):
    quota_store.daily=1
    with pytest.raises(ValueError):
        async with ai_quota.AIRequest('writer'): raise ValueError('provider failed')
    assert not quota_store.reservations and not quota_store.rows
    started=asyncio.Event()
    async def work():
        async with ai_quota.AIRequest('writer'):
            started.set();await asyncio.Event().wait()
    task=asyncio.create_task(work());await started.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert not quota_store.reservations

async def test_deadline_releases_before_lease_expires(monkeypatch,quota_store):
    timeout=asyncio.timeout;monkeypatch.setattr(ai_quota.asyncio,'timeout',lambda _:timeout(.01))
    with pytest.raises(HTTPException) as error:
        async with ai_quota.AIRequest('writer'): await asyncio.Event().wait()
    assert error.value.status_code==504 and not quota_store.reservations

@pytest.mark.parametrize('failure',['ai_coach_reserve','ai_coach_complete'])
async def test_database_failure_fails_closed_without_private_detail(quota_store,failure):
    quota_store.fail=failure
    with pytest.raises(HTTPException) as error:
        async with ai_quota.AIRequest('writer') as quota: await quota.complete(20,30)
    assert error.value.status_code==503 and error.value.detail=='ai_usage_unavailable'
    assert not quota_store.rows and not quota_store.reservations

async def test_provider_failure_does_not_erase_recorded_model_cost(quota_store):
    with pytest.raises(ValueError):
        async with ai_quota.AIRequest('writer') as quota:
            await quota.record_provider('gpt-5.4-mini',SimpleNamespace(prompt_tokens=100,completion_tokens=20))
            raise ValueError('policy rejection')
    assert not quota_store.rows
    assert any(p=='rpc/ai_coach_cost' for p,_ in quota_store.calls)
    assert any(p=='rpc/ai_coach_mark_request' for p,_ in quota_store.calls)
