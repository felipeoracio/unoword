"""Stripe is authoritative; redirects and client-supplied plans never grant access."""
import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import urlsplit
from uuid import uuid4

import stripe
from fastapi import HTTPException
from lib.ai_access import get_entitlement, entitlement_is_active
from lib.supabase_client import service_rest, SupabaseAPIError

PRO_PRICE = {'amount': 2000, 'currency': 'usd', 'interval': 'month', 'trial_days': 7}
API_VERSION = '2026-09-30.endive'
TERMINAL = {'canceled', 'incomplete_expired'}


def require_allowed_mode():
    """Default to sandbox. Live keys need a separately approved deployment setting."""
    key = os.getenv('STRIPE_SECRET_KEY', '')
    if key.startswith(('sk_test_', 'rk_test_')):
        return False
    if key.startswith(('sk_live_', 'rk_live_')):
        if os.getenv('STRIPE_LIVE_BILLING_APPROVED', '').lower() != 'true':
            raise HTTPException(503, 'live_billing_not_approved')
        return True
    raise HTTPException(503, 'billing_unavailable')


def billing_available():
    try:
        require_allowed_mode()
    except HTTPException:
        return False
    return os.getenv('STRIPE_BILLING_ENABLED', '').lower() == 'true' and all(
        os.getenv(key, '').strip() for key in
        ('STRIPE_WEBHOOK_SECRET', 'STRIPE_PRO_PRICE_ID'))


def client():
    require_allowed_mode()
    return stripe.StripeClient(os.environ['STRIPE_SECRET_KEY'], stripe_version=API_VERSION, max_network_retries=1,
                               http_client=stripe.RequestsClient(timeout=20))


async def call(method, *args, **kwargs):
    try:
        result = await asyncio.to_thread(method, *args, **kwargs)
        return result.to_dict() if isinstance(result, stripe.StripeObject) else result
    except stripe.StripeError as error:
        # Never send provider payloads, request bodies or credentials to clients.
        raise HTTPException(502, 'billing_provider_unavailable') from error


def app_url():
    url = os.getenv('PUBLIC_APP_URL', 'https://unoword.vercel.app').rstrip('/')
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise HTTPException(503, 'billing_unavailable')
    return url


def hosted_url(url, portal=False):
    parsed = urlsplit(url or '')
    host = 'billing.stripe.com' if portal else 'checkout.stripe.com'
    if parsed.scheme != 'https' or parsed.netloc != host:
        raise HTTPException(502, 'invalid_billing_redirect')
    return url


async def verified_price(c):
    price = await call(c.v1.prices.retrieve, os.getenv('STRIPE_PRO_PRICE_ID', ''))
    recurring = price.get('recurring') or {}
    if not (price.get('active') and price.get('type') == 'recurring'
            and price.get('unit_amount') == PRO_PRICE['amount'] and price.get('currency') == 'usd'
            and recurring.get('interval') == 'month' and recurring.get('interval_count') == 1
            and recurring.get('usage_type') == 'licensed'
            and price.get('livemode') == os.getenv('STRIPE_SECRET_KEY', '').startswith(('sk_live_', 'rk_live_'))):
        raise HTTPException(503, 'billing_price_mismatch')
    return price


async def db(method, path, **kwargs):
    try:
        return await service_rest(method, path, **kwargs)
    except SupabaseAPIError as error:
        if 'billing_busy' in error.detail:
            raise HTTPException(409, 'billing_busy', headers={'Retry-After': '5'}) from error
        raise HTTPException(503, 'billing_storage_unavailable') from error


async def account(user_id):
    rows = await db('GET', 'billing_accounts', params={'user_id': f'eq.{user_id}', 'select': '*', 'limit': '1'})
    return rows[0] if rows else None


@asynccontextmanager
async def locked(user_id):
    lease = str(uuid4())
    state = await db('POST', 'rpc/billing_lock', json={'p_user_id': user_id, 'p_lease_id': lease})
    try:
        yield state, lease
    finally:
        try:
            await db('POST', 'rpc/billing_unlock', json={'p_user_id': user_id, 'p_lease_id': lease})
        except HTTPException:
            pass  # A crashed worker's lease expires; never mask the original failure.


async def commit(state, lease, entitlement=None, event_id=None):
    return await db('POST', 'rpc/billing_commit', json={
        'p_user_id': state['user_id'], 'p_lease_id': lease, 'p_state': state,
        'p_entitlement': entitlement, 'p_event_id': event_id})


async def portal_configuration(c):
    result = await call(c.v1.billing_portal.configurations.list,
                        {'active': True, 'is_default': True, 'limit': 1})
    configs = result.get('data', [])
    features = configs[0].get('features', {}) if configs else {}
    cancellation = features.get('subscription_cancel', {})
    if not (cancellation.get('enabled') and cancellation.get('mode') == 'at_period_end'
            and features.get('payment_method_update', {}).get('enabled')
            and not features.get('subscription_update', {}).get('enabled')):
        raise HTTPException(503, 'billing_portal_not_configured')
    return configs[0]['id']


async def portal(c, customer_id):
    configuration = await portal_configuration(c)
    result = await call(c.v1.billing_portal.sessions.create,
                        {'customer': customer_id, 'configuration': configuration,
                         'return_url': app_url() + '/account?billing=return'})
    return {'url': hosted_url(result['url'], portal=True), 'destination': 'portal'}


async def change_plan(user, target_plan):
    require_allowed_mode()
    if target_plan == 'pro' and not billing_available():
        raise HTTPException(503, 'billing_unavailable')
    c = client()
    async with locked(user.id) as (state, lease):
        entitlement = await get_entitlement(user.id)
        independent_pro = entitlement_is_active(entitlement) and (entitlement or {}).get('billing_source') != 'stripe'
        customer_id = state.get('customer_id')
        livemode = os.getenv('STRIPE_SECRET_KEY', '').startswith(('sk_live_', 'rk_live_'))
        if customer_id and bool(state.get('livemode')) != livemode:
            raise HTTPException(409, 'billing_mode_mismatch')
        if independent_pro and not customer_id and target_plan == 'pro':
            raise HTTPException(409, 'plan_managed_separately')
        if customer_id:
            subs = await call(c.v1.subscriptions.list, {'customer': customer_id, 'status': 'all', 'limit': 100})
            # Prevent a second subscription even before the first webhook arrives.
            if target_plan == 'free' or any(s['status'] not in TERMINAL for s in subs['data']):
                return await portal(c, customer_id)
            if independent_pro:
                raise HTTPException(409, 'plan_managed_separately')
            if subs.get('has_more'):
                raise HTTPException(409, 'billing_history_review_required')
            if subs['data']:
                state['trial_used'] = True
        elif target_plan == 'free':
            raise HTTPException(409, 'no_paid_subscription')
        else:
            customer = await call(c.v1.customers.create, {'metadata': {'unoword_user_id': user.id}},
                                  options={'idempotency_key': 'unoword-customer-' + user.id})
            state['livemode'] = livemode
            state['customer_id'] = customer_id = customer['id']
            # Commit the ownership binding before Stripe can send a webhook.
            await commit(state, lease)
        await verified_price(c)
        await portal_configuration(c)
        if state.get('checkout_id'):
            previous = await call(c.v1.checkout.sessions.retrieve, state['checkout_id'])
            if previous['status'] == 'open':
                return {'url': hosted_url(previous['url']), 'destination': 'checkout'}
            if previous['status'] == 'complete':
                return await portal(c, customer_id)
            state['checkout_attempt'] = str(uuid4())
            state['checkout_id'] = None
        # Persist an attempt before making a network call. Retrying after a crash
        # uses the same Stripe idempotency key, including on different instances.
        await commit(state, lease)
        subscription_data = {'metadata': {'unoword_user_id': user.id}}
        if not state['trial_used']:
            subscription_data.update(trial_period_days=7,
                trial_settings={'end_behavior': {'missing_payment_method': 'cancel'}})
        session = await call(c.v1.checkout.sessions.create, {
            'mode': 'subscription', 'customer': customer_id, 'client_reference_id': user.id,
            'line_items': [{'price': os.environ['STRIPE_PRO_PRICE_ID'], 'quantity': 1}],
            'payment_method_collection': 'always', 'subscription_data': subscription_data,
            'success_url': app_url() + '/account?billing=success',
            'cancel_url': app_url() + '/account?plan=pro&billing=canceled',
        }, options={'idempotency_key': 'unoword-checkout-' + state['checkout_attempt']})
        state['checkout_id'] = session['id']
        await commit(state, lease)
        return {'url': hosted_url(session['url']), 'destination': 'checkout'}


def timestamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if value else None


def subscription_entitlement(sub):
    items = sub.get('items', {}).get('data', [])
    # Only the configured, single-seat Pro price can grant access.
    if len(items) != 1 or items[0].get('price', {}).get('id') != os.getenv('STRIPE_PRO_PRICE_ID') or items[0].get('quantity') != 1:
        return {'status': 'inactive', 'valid_until': timestamp(sub.get('ended_at'))}
    status = sub['status']
    end = sub.get('trial_end') if status == 'trialing' else items[0].get('current_period_end')
    # Never grant indefinitely if Stripe omits a required period boundary.
    if status in {'active', 'trialing'} and not end:
        raise HTTPException(502, 'billing_period_missing')
    return {'status': status if status in {'active', 'trialing', 'past_due', 'canceled'} else 'inactive',
            'valid_until': timestamp(end)}


async def process_event(event):
    if bool(event.get('livemode')) != require_allowed_mode():
        raise HTTPException(400, 'billing_mode_mismatch')
    if not event['type'].startswith('customer.subscription.'):
        return
    obj = event['data']['object']
    customer_id = obj.get('customer')
    if not isinstance(customer_id, str):
        raise HTTPException(400, 'invalid_billing_event')
    rows = await db('GET', 'billing_accounts', params={'customer_id': f'eq.{customer_id}', 'select': 'user_id', 'limit': '1'})
    if not rows:
        return  # Other products/accounts in the same Stripe account are unrelated.
    user_id = rows[0]['user_id']
    async with locked(user_id) as (state, lease):
        c = client()
        # Fetch CURRENT provider state while holding the account lease. Delayed
        # and out-of-order webhook bodies cannot roll back a newer subscription.
        sub = await call(c.v1.subscriptions.retrieve, obj['id'])
        if sub.get('customer') != state['customer_id'] or sub.get('metadata', {}).get('unoword_user_id') != user_id:
            raise HTTPException(400, 'billing_owner_mismatch')
        if bool(sub.get('livemode')) != bool(event.get('livemode')) or bool(state.get('livemode')) != bool(event.get('livemode')):
            raise HTTPException(400, 'billing_mode_mismatch')
        if state.get('subscription_id') != sub['id'] and sub['created'] <= state['subscription_created']:
            # Stripe timestamps have one-second resolution. A replacement in
            # that same second is safe only after the old subscription ended.
            if not (sub['created'] == state['subscription_created'] and
                    state['status'] in TERMINAL and sub['status'] not in TERMINAL):
                return
        entitlement = subscription_entitlement(sub)
        state.update(subscription_id=sub['id'], subscription_created=sub['created'], status=sub['status'],
                     period_end=entitlement['valid_until'], trial_used=True,
                     cancel_at_period_end=bool(sub.get('cancel_at_period_end') or sub.get('cancel_at')),
                     checkout_id=None, checkout_attempt=str(uuid4()))
        await commit(state, lease, entitlement, event['id'])
