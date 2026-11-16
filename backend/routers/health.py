"""Readiness checks for real dependencies; response contains no account data."""
import asyncio
from fastapi import APIRouter, Response, Request
from lib.session_access import probe_session_database
from lib.supabase_client import _request, _rest_headers
from lib.supabase_config import require_supabase_runtime
from lib.request_security import limit_sensitive

router = APIRouter(tags=['health'])


async def probe_data_api():
    config = require_supabase_runtime()
    await _request('POST', config.url.rstrip('/') + '/rest/v1/rpc/ai_public_allowance',
                   _rest_headers(None, service=True, prefer=None), json={}, timeout=2.5)


@router.get('/health/ready')
async def ready(response: Response, request: Request):
    limit_sensitive('readiness:' + (request.client.host if request.client else 'unknown'), maximum=30, seconds=60)
    response.headers['Cache-Control'] = 'private, no-store'
    results = await asyncio.gather(probe_session_database(), probe_data_api(), return_exceptions=True)
    checks = dict(zip(['session_database', 'data_api'], ['error' if isinstance(r, BaseException) else 'ok' for r in results]))
    healthy = all(value == 'ok' for value in checks.values())
    response.status_code = 200 if healthy else 503
    return {'status': 'ready' if healthy else 'degraded', 'checks': checks}
