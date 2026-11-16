"""Bounded, read-only session access via the existing transaction pooler.

Only verified server identities reach this adapter. It does not replace the user
Data API or bypass its RLS; it uses the same service-role authority as the existing
server entitlement read, with fixed SQL and an owner-bound UUID.
"""
import asyncio
import logging
import os
from contextlib import contextmanager
from threading import BoundedSemaphore
from urllib.parse import urlsplit
from uuid import UUID

import psycopg2
from fastapi import HTTPException
from lib.supabase_config import get_supabase_config

logger = logging.getLogger(__name__)
_slots = BoundedSemaphore(2)


def _pooler_url():
    config = get_supabase_config()
    try:
        url = urlsplit(config.db_url)
        if (url.scheme not in {'postgres', 'postgresql'} or url.port != 6543
                or not (url.hostname or '').endswith('.pooler.supabase.com')):
            raise ValueError('transaction pooler required')
        project = urlsplit(config.url).hostname or ''
        if project.endswith('.supabase.co') and not (url.username or '').endswith('.' + project.split('.')[0]):
            raise ValueError('pooler project mismatch')
    except (ValueError, TypeError):
        raise HTTPException(503, 'session_database_configuration_invalid') from None
    return config.db_url


@contextmanager
def _read():
    dsn = _pooler_url()
    if not _slots.acquire(timeout=1):
        raise HTTPException(503, 'session_database_busy')
    connection = None
    try:
        connection = psycopg2.connect(dsn, connect_timeout=3, sslmode='require', application_name='unoword-session-access')
        connection.set_session(readonly=True, autocommit=False)
        with connection.cursor() as cursor:
            cursor.execute("set local statement_timeout = '2500ms'")
            cursor.execute("set local lock_timeout = '500ms'")
            cursor.execute('set local role service_role')
            yield cursor
    except psycopg2.Error:
        # Provider exception strings can contain connection secrets. Log category only.
        logger.warning('session_database_unavailable')
        raise HTTPException(503, 'session_database_unavailable') from None
    finally:
        try:
            if connection is not None:
                connection.close()  # rollback read-only transaction; release pooler slot
        finally:
            _slots.release()


def _lookup(user_id):
    from lib.ai_access import entitlement_is_active
    try:
        owner = str(UUID(user_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(401, 'session_identity_invalid') from None
    with _read() as cursor:
        cursor.execute('select to_jsonb(e) from public.ai_entitlements e where user_id=%s::uuid limit 1', (owner,))
        row = cursor.fetchone()
        native = row[0] if row else None
        if entitlement_is_active(native) or not os.getenv('SUBSTACK_STRIPE_SECRET_KEY'):
            return native
        from lib import substack_stripe
        try:
            config = substack_stripe.config()
        except HTTPException:
            return native  # same policy as the existing server adapter
        cursor.execute('select public.substack_entitlement(%s::uuid,%s::text,%s::boolean)', (owner, config.account, config.live))
        row = cursor.fetchone()
        return (row[0] if row else None) or native


async def get_session_entitlement(user_id):
    if not get_supabase_config().db_url:
        from lib.ai_access import get_entitlement
        return await get_entitlement(user_id)
    try:
        return await asyncio.to_thread(_lookup, user_id)
    except HTTPException as error:
        if error.status_code < 500:
            raise
        logger.warning('session_pooler_fallback_to_data_api')
        from lib.ai_access import get_entitlement
        return await get_entitlement(user_id)


def _probe():
    with _read() as cursor:
        cursor.execute('select user_id from public.ai_entitlements limit 0')


async def probe_session_database():
    await asyncio.to_thread(_probe)
