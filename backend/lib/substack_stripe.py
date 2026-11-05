"""Read-only Stripe adapter and verified paid-through policy for one publication.

Never uses the UnoWord billing key, creates charges, or changes subscriptions.
"""
import asyncio
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import stripe
from cryptography.fernet import Fernet
from fastapi import HTTPException
from lib.supabase_client import service_rest, SupabaseAPIError

EVENT_TYPES = frozenset({'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'})
API_VERSION = '2026-09-30.endive'

# Stripe's INFO URL logs can include customer email filters. Keep native billing
# logging unchanged while suppressing SDK payload/URL logs in this call context.
_provider_context = ContextVar('substack_provider_log_context', default=False)


class _PrivateProviderLogs(logging.Filter):
    def filter(self, record):
        return not _provider_context.get()


logging.getLogger('stripe').addFilter(_PrivateProviderLogs())



@dataclass(frozen=True)
class Config:
    key: str = field(repr=False)
    webhook_secret: str = field(repr=False)
    hmac_secret: str = field(repr=False)
    account: str
    publication: str
    prices: frozenset[str]
    products: frozenset[str]
    linking: bool
    live_approved: bool

    @property
    def live(self):
        return self.key.startswith(('sk_live_', 'rk_live_'))

    @property
    def policy(self):
        payload = [self.account, self.live, self.publication, sorted(self.prices), sorted(self.products), 'positive-paid-invoice-through-v1']
        return hashlib.sha256(json.dumps(payload, separators=(',', ':')).encode()).hexdigest()


def config():
    key = os.getenv('SUBSTACK_STRIPE_SECRET_KEY', '').strip()
    if key and key==os.getenv('STRIPE_SECRET_KEY'):
        raise HTTPException(503,'substack_requires_separate_stripe_key')
    webhook_secret=os.getenv('SUBSTACK_STRIPE_WEBHOOK_SECRET','')
    if webhook_secret and webhook_secret==os.getenv('STRIPE_WEBHOOK_SECRET'):
        raise HTTPException(503,'substack_requires_separate_webhook_secret')
    account = os.getenv('SUBSTACK_STRIPE_ACCOUNT_ID', '').strip()
    publication = os.getenv('SUBSTACK_PUBLICATION_URL', 'https://unoword.substack.com').rstrip('/')
    prices = frozenset(filter(None, (s.strip() for s in os.getenv('SUBSTACK_STRIPE_PRICE_IDS', '').split(','))))
    products = frozenset(filter(None, (s.strip() for s in os.getenv('SUBSTACK_STRIPE_PRODUCT_IDS', '').split(','))))
    secret = os.getenv('SUBSTACK_LINK_HMAC_SECRET', '')
    try:
        parsed = urlsplit(publication)
    except ValueError as error:
        raise HTTPException(503,'substack_not_configured') from error
    if not (key.startswith(('sk_test_', 'rk_test_', 'sk_live_', 'rk_live_')) and re.fullmatch(r'acct_[A-Za-z0-9]+', account)
        and parsed.scheme == 'https' and parsed.hostname and not (parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path)
        and len(secret) >= 32 and (prices or products)
        and all(re.fullmatch(r'price_[A-Za-z0-9]+', s) for s in prices)
        and all(re.fullmatch(r'prod_[A-Za-z0-9]+', s) for s in products)):
        raise HTTPException(503, 'substack_not_configured')
    return Config(key, os.getenv('SUBSTACK_STRIPE_WEBHOOK_SECRET', ''), secret, account, publication, prices, products,
        os.getenv('SUBSTACK_LINKING_ENABLED', '').lower() == 'true',
        os.getenv('SUBSTACK_STRIPE_LIVE_ACCESS_APPROVED', '').lower() == 'true')


def client(c):
    return stripe.StripeClient(c.key, stripe_version=API_VERSION, max_network_retries=1, http_client=stripe.RequestsClient(timeout=15))


async def call(method, *args):
    if os.getenv('STRIPE_LOG', '').lower() in {'debug','info'} or getattr(stripe, 'log', None) in {'debug','info'}:
        # Stripe's opt-in console logger bypasses Python filters. Refuse it for
        # this source rather than mutating logging options for native billing.
        raise HTTPException(503,'substack_disable_verbose_stripe_logging')
    token = _provider_context.set(True)
    try:
        result = await asyncio.to_thread(method, *args)
        return result.to_dict() if isinstance(result, stripe.StripeObject) else result
    except stripe.PermissionError as error:
        raise HTTPException(503, 'substack_stripe_read_permission_denied') from error
    except stripe.AuthenticationError as error:
        raise HTTPException(503, 'substack_stripe_key_invalid') from error
    except stripe.StripeError as error:
        # Never log provider messages, customer emails, tokens or payloads.
        raise HTTPException(502, 'substack_stripe_unavailable') from error
    finally:
        _provider_context.reset(token)


async def db(method, path, **kwargs):
    try:
        return await service_rest(method, path, **kwargs)
    except SupabaseAPIError as error:
        raise HTTPException(503, 'substack_storage_unavailable') from error


async def rpc(name, **data):
    return await db('POST', 'rpc/substack_' + name, json={'p_' + key: value for key, value in data.items()})


def scope(c):
    return {'account_id': 'eq.' + c.account, 'livemode': 'eq.' + str(c.live).lower()}


async def integration(c):
    rows = await db('GET', 'substack_integration', params={**scope(c), 'select': '*', 'limit': '1'})
    return rows[0] if rows else None


def email_value(value):
    value = str(value or '').strip()
    if len(value) > 254 or not re.fullmatch(r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+', value):
        raise HTTPException(422, 'substack_email_invalid')
    local, domain = value.rsplit('@', 1)
    return local + '@' + domain.casefold()


def digest(c, namespace, value):
    return hmac.new(c.hmac_secret.encode(), (namespace + ':' + value).encode(), hashlib.sha256).hexdigest()


def email_hash(c, email):
    return digest(c, 'email-v1', email_value(email))


def cipher(c):
    import base64
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(('substack-email-v1:' + c.hmac_secret).encode()).digest()))


def masked(email):
    local, domain = email.split('@')
    return local[:1] + '…@' + domain


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if value else None


def object_id(value):
    return value.get('id') if isinstance(value, dict) else value


def item_price(item):
    value = item.get('price') or item.get('plan') or {}
    return value if isinstance(value, dict) else {'id': value}


def allowed_price(c, price):
    return bool(price.get('id') in c.prices or object_id(price.get('product')) in c.products)


def invoice_subscription(invoice):
    parent = invoice.get('parent') or {}
    return object_id(invoice.get('subscription')) or object_id((parent.get('subscription_details') or {}).get('subscription'))


def line_price(line):
    return object_id(line.get('price')) or object_id(((line.get('pricing') or {}).get('price_details') or {}).get('price'))


def paid_through(subscription, invoices, prices):
    """Require paid recurring line evidence, never customer matching or trial status."""
    now = datetime.now(timezone.utc).timestamp()
    items = subscription.get('items') or {}
    if items.get('has_more'):
        raise HTTPException(502, 'substack_subscription_incomplete')
    eligible_items = [item for item in items.get('data', []) if item_price(item).get('id') in prices]
    if subscription.get('status') not in {'active', 'past_due'} or subscription.get('pause_collection'):
        return None
    ends = []
    for invoice in invoices:
        if invoice_subscription(invoice) != subscription.get('id') or invoice.get('status') != 'paid' or (invoice.get('amount_paid') or 0) <= 0:
            continue
        lines = invoice.get('lines') or {}
        if lines.get('has_more'):
            raise HTTPException(502, 'substack_invoice_incomplete')
        for line in lines.get('data', []):
            price = line_price(line)
            if price not in prices or (line.get('amount') or 0) <= 0:
                continue
            # A shared invoice/customer cannot qualify another subscription.
            sub = object_id((line.get('parent') or {}).get('subscription_item_details', {}).get('subscription')) or object_id(line.get('subscription'))
            if sub and sub != subscription['id']:
                continue
            period_end = (line.get('period') or {}).get('end')
            bounds = [item.get('current_period_end') or subscription.get('current_period_end') for item in eligible_items if item_price(item).get('id') == price]
            bounds = [n for n in bounds if isinstance(n, (int, float)) and not isinstance(n, bool)]
            if period_end and bounds:
                end = min(period_end, max(bounds))
                if subscription.get('cancel_at'):
                    end = min(end, subscription['cancel_at'])
                if end > now:
                    ends.append(end)
    return max(ends) if ends else None


async def verify_account(c, provider):
    account = await call(provider.raw_request, 'get', '/v1/account')
    if account.get('id') != c.account:
        raise HTTPException(503, 'substack_stripe_account_mismatch')
    return account


async def observe(c=None):
    """Read-only permission and field probes; never enables entitlement changes."""
    c = c or config()
    provider = client(c)
    await verify_account(c, provider)
    prices = []
    for price_id in sorted(c.prices):
        price = await call(provider.v1.prices.retrieve, price_id)
        if bool(price.get('livemode')) != c.live or not price.get('recurring') or (price.get('unit_amount') or 0) <= 0:
            raise HTTPException(503, 'substack_price_not_paid_recurring')
        prices.append(price)
    for product_id in sorted(c.products):
        product = await call(provider.v1.products.retrieve, product_id)
        if bool(product.get('livemode')) != c.live:
            raise HTTPException(503, 'substack_product_mode_mismatch')
    subs = await call(provider.v1.subscriptions.list, {'status': 'all', 'limit': 25})
    await call(provider.v1.customers.list, {'limit': 1})
    invoice_probe = await call(provider.v1.invoices.list, {'limit': 1})
    if invoice_probe.get('data'):
        await call(provider.v1.invoices.retrieve, invoice_probe['data'][0]['id'])
    destinations = await call(provider.v1.webhook_endpoints.list, {'limit': 100})
    from lib.billing import app_url
    webhook_url = app_url() + '/api/webhooks/substack-stripe'
    endpoints = [e for e in destinations.get('data', []) if e.get('url') == webhook_url and e.get('status') == 'enabled'
        and bool(e.get('livemode')) == c.live and (set(e.get('enabled_events') or []) >= EVENT_TYPES or '*' in (e.get('enabled_events') or []))]
    samples = [s for s in subs.get('data', []) if any(allowed_price(c, item_price(i)) for i in (s.get('items') or {}).get('data', []))]
    # Explicit subscription/customer/invoice retrieval permissions are probed,
    # not inferred from Dashboard visibility or the ability to list records.
    inspection = None
    sample_ref = os.getenv('SUBSTACK_STRIPE_SAMPLE_SUBSCRIPTION_ID', '')
    if not sample_ref and samples:sample_ref=samples[0]['id']
    if not sample_ref:
        cached=await db('GET','substack_subscriptions',params={**scope(c),'select':'subscription_id','policy_hash':'eq.'+c.policy,'eligible':'eq.true','order':'verified_at.desc','limit':'1'})
        if cached:sample_ref=cached[0]['subscription_id']
    if sample_ref:
        if not re.fullmatch(r'sub_[A-Za-z0-9]+',sample_ref):raise HTTPException(503,'substack_sample_reference_invalid')
        inspection = await inspect_subscription(c, provider, sample_ref)
    deliveries=await db('GET','substack_events',params={**scope(c),'select':'processed_at','state':'eq.done',
        'signing_key_hash':'eq.'+digest(c,'webhook-secret-v1',c.webhook_secret),
        'last_received_at':'gt.'+(datetime.now(timezone.utc)-timedelta(days=1)).isoformat(),'limit':'1'})
    report = {'account_verified': True, 'read_permissions_verified': True, 'api_version': API_VERSION,
        'eligible_sample_verified': inspection is not None, 'eligible_sample_paid': bool(inspection and inspection['eligible']),
        'webhook_delivery_verified':bool(deliveries), 'webhook_destination_verified': bool(endpoints), 'webhook_api_versions': sorted({str(e.get('api_version') or 'account-default') for e in endpoints}),
        'mode': 'live' if c.live else 'test', 'policy': 'paid_through_only_no_extra_grace',
        'restricted_key': c.key.startswith('rk_'),
        'ready': bool(endpoints) and bool(deliveries) and bool(inspection and inspection['eligible']) and bool(c.webhook_secret)}
    await rpc('observe', account=c.account, live=c.live, url=c.publication, policy=c.policy, report=report)
    return report


async def inspect_subscription(c, provider, subscription_id):
    sub = await call(provider.v1.subscriptions.retrieve, subscription_id)
    if sub.get('id') != subscription_id or bool(sub.get('livemode')) != c.live:
        raise HTTPException(502, 'substack_subscription_scope_mismatch')
    prices = [item_price(i) for i in (sub.get('items') or {}).get('data', [])]
    allowed = {p['id'] for p in prices if allowed_price(c, p) and p.get('recurring') and (p.get('unit_amount') or 0) > 0}
    state = {'customer_id': object_id(sub.get('customer')), 'email_hash': None, 'status': sub.get('status', 'unknown'), 'eligible': False,
        'paid_through': None, 'cancel_at_period_end': bool(sub.get('cancel_at_period_end') or sub.get('cancel_at')),
        'price_ids': sorted(allowed), 'policy_hash': c.policy}
    if not allowed:
        return state
    customer = await call(provider.v1.customers.retrieve, state['customer_id'])
    if customer.get('deleted') or customer.get('id') != state['customer_id']:
        return state
    try:
        state['email_hash'] = email_hash(c, customer.get('email'))
    except HTTPException:
        return state
    invoices = await call(provider.v1.invoices.list, {'subscription': subscription_id, 'status': 'paid', 'limit': 100})
    until = paid_through(sub, invoices.get('data', []), allowed)
    if not until and invoices.get('has_more'):
        # An incomplete scan is not evidence to revoke a previously verified grant.
        raise HTTPException(502, 'substack_invoice_history_incomplete')
    state.update(eligible=bool(until), paid_through=stamp(until))
    return state


async def refresh_subscription(c, subscription_id, provider=None):
    if not re.fullmatch(r'sub_[A-Za-z0-9]+', subscription_id or ''):
        raise HTTPException(422, 'substack_subscription_reference_invalid')
    provider = provider or client(c)
    await verify_account(c, provider)
    state = await integration(c)
    if not state or state['policy_hash'] != c.policy:
        raise HTTPException(503, 'substack_connection_check_required')
    token = str(uuid4())
    if not await rpc('subscription_claim', account=c.account, live=c.live, subscription=subscription_id, token=token, policy=c.policy):
        raise HTTPException(409, 'substack_sync_busy')
    try:
        value = await inspect_subscription(c, provider, subscription_id)
        if not await rpc('subscription_commit', account=c.account, live=c.live, subscription=subscription_id, token=token, state=value):
            raise HTTPException(409, 'substack_sync_retry')
        return value
    except Exception as error:
        code = error.detail if isinstance(error, HTTPException) and isinstance(error.detail, str) else 'substack_sync_failed'
        await rpc('subscription_release', account=c.account, live=c.live, subscription=subscription_id, token=token, error=code)
        raise


async def import_batch(cursor=None):
    c = config();provider = client(c)
    await verify_account(c, provider)
    params = {'status': 'all', 'limit': 25}
    if cursor:
        params['starting_after'] = cursor
    rows = await call(provider.v1.subscriptions.list, params)
    matched = 0
    for sub in rows.get('data', []):
        if any(allowed_price(c, item_price(i)) for i in (sub.get('items') or {}).get('data', [])):
            await refresh_subscription(c, sub['id'], provider);matched += 1
    next_cursor = rows['data'][-1]['id'] if rows.get('has_more') and rows.get('data') else None
    await db('PATCH', 'substack_integration', params=scope(c), json={'import_cursor': next_cursor,
        **({'last_import_completed_at': datetime.now(timezone.utc).isoformat()} if not next_cursor else {})})
    return {'inspected': len(rows.get('data', [])), 'eligible_products_matched': matched, 'next_cursor': next_cursor, 'has_more': bool(next_cursor)}


async def find_candidates(c, email):
    provider = client(c)
    await verify_account(c, provider)
    customers = await call(provider.v1.customers.list, {'email': email, 'limit': 100})
    if customers.get('has_more'):
        raise HTTPException(502, 'substack_customer_search_incomplete')
    candidates = []
    cached = await db('GET','substack_subscriptions',params={**scope(c),'email_hash':'eq.'+email_hash(c,email),'select':'subscription_id','limit':'101'})
    if len(cached)>100:
        raise HTTPException(502,'substack_subscription_search_incomplete')
    checked=set()
    for row in cached:
        checked.add(row['subscription_id'])
        state=await refresh_subscription(c,row['subscription_id'],provider)
        if state['eligible'] and state['email_hash']==email_hash(c,email):candidates.append((row['subscription_id'],state['paid_through']))
    for customer in customers.get('data', []):
        if email_hash(c, customer.get('email')) != email_hash(c, email):
            continue
        rows = await call(provider.v1.subscriptions.list, {'customer': customer['id'], 'status': 'all', 'limit': 100})
        if rows.get('has_more'):
            raise HTTPException(502, 'substack_subscription_search_incomplete')
        for sub in rows.get('data', []):
            if sub['id'] not in checked and any(allowed_price(c, item_price(i)) for i in (sub.get('items') or {}).get('data', [])):
                checked.add(sub['id'])
                state = await refresh_subscription(c, sub['id'], provider)
                if state['eligible'] and state['email_hash'] == email_hash(c, email):
                    candidates.append((sub['id'], state['paid_through']))
    return sorted(candidates, key=lambda row: row[1], reverse=True)


def mail_configured():
    sender = os.getenv('SUBSTACK_EMAIL_FROM', '')
    return bool(os.getenv('RESEND_API_KEY') and sender and '\r' not in sender and '\n' not in sender)


async def send_code(c, email, code, request_id):
    if not mail_configured():
        raise HTTPException(503, 'substack_email_not_configured')
    try:
        async with httpx.AsyncClient(timeout=15) as transport:
            result = await transport.post('https://api.resend.com/emails', headers={'Authorization': 'Bearer ' + os.environ['RESEND_API_KEY'],
                'Idempotency-Key': 'substack-link-' + request_id}, json={'from': os.environ['SUBSTACK_EMAIL_FROM'], 'to': [email],
                'subject': 'Verify your Substack subscription for UnoWord',
                'text': f'Your UnoWord subscription-link code is {code}. It expires in 10 minutes.\n\nUse it only in the UnoWord account where you requested it. This does not change your sign-in email or purchase a subscription.\n\nPublication: {c.publication}\nIf you did not request this, ignore this message.'})
            if result.status_code not in (200, 201, 202):
                raise HTTPException(503, 'substack_email_delivery_failed')
    except httpx.HTTPError as error:
        raise HTTPException(503, 'substack_email_delivery_failed') from error


async def begin_link(user, email):
    c = config()
    state = await integration(c)
    if not c.linking or not mail_configured() or not state or state['policy_hash'] != c.policy or not state.get('verification', {}).get('read_permissions_verified'):
        raise HTTPException(503, 'substack_linking_unavailable')
    email = email_value(email);request_id = str(uuid4());code = str(secrets.randbelow(10**8)).zfill(8)
    code_hash = digest(c, 'code-v1', request_id + ':' + user.id + ':' + code)
    result = await rpc('verification', action='begin', user=user.id, id=request_id, data={'account_id': c.account, 'livemode': c.live,
        'email_hash': email_hash(c, email), 'delivery_rate_hash':digest(c,'email-rate-v1',email.casefold()), 'email_ciphertext': cipher(c).encrypt(email.encode()).decode(), 'masked_email': masked(email), 'code_hash': code_hash})
    if result.get('limited'):
        raise HTTPException(429, 'substack_email_rate_limited')
    try:
        await send_code(c, email, code, request_id)
        await rpc('verification', action='delivered', user=user.id, id=request_id, data={})
    except Exception:
        await rpc('verification', action='delivery_failed', user=user.id, id=request_id, data={})
        raise
    return {'request_id': request_id, 'status': 'verification_sent', 'expires_in_seconds': 600, 'masked_email': masked(email)}


async def finish_link(user, request_id):
    c = config()
    if not c.linking:
        raise HTTPException(503,'substack_linking_unavailable')
    row = await rpc('verification', action='read_verified', user=user.id, id=request_id, data={})
    if row.get('invalid') or row.get('account_id') != c.account or row.get('livemode') != c.live:
        raise HTTPException(400, 'substack_verification_invalid')
    email = cipher(c).decrypt(row['email_ciphertext'].encode()).decode()
    candidates = await find_candidates(c, email)
    if not candidates:
        raise HTTPException(409, 'substack_no_verified_paid_subscription')
    for subscription_id, _until in candidates:
        if await rpc('link', user=user.id, request=request_id, subscription=subscription_id):
            return {'connected': True}
    raise HTTPException(409, 'substack_subscription_already_linked')


async def verify_link(user, request_id, code):
    c = config()
    row = await rpc('verification', action='verify', user=user.id, id=request_id,
        data={'code_hash': digest(c, 'code-v1', request_id + ':' + user.id + ':' + code)})
    if row.get('invalid'):
        raise HTTPException(400, 'substack_verification_invalid')
    return await finish_link(user, request_id)


async def user_status(user):
    result = {'user_id': user.id, 'configured': False, 'available': False, 'connected': False,
        'active': False, 'source': 'substack_stripe', 'subscriptions': [], 'pending_request': None}
    try:
        c = config()
    except HTTPException:
        return result
    state = await integration(c)
    links = await db('GET', 'substack_links', params={**scope(c), 'select': 'subscription_id,masked_email,verified_email_hash', 'user_id': 'eq.' + user.id, 'disconnected_at': 'is.null'})
    result.update(configured=True, available=bool(c.linking and mail_configured() and state and state['policy_hash'] == c.policy and state.get('verification', {}).get('read_permissions_verified')),
        connected=bool(links), publication_url=c.publication, access_enabled=bool(state and state.get('enabled')))
    for link in links:
        rows = await db('GET', 'substack_subscriptions', params={**scope(c), 'select': '*', 'subscription_id': 'eq.' + link['subscription_id'], 'limit': '1'})
        if not rows:
            continue
        row = rows[0];active = bool(row['eligible'] and row['email_hash'] == link['verified_email_hash'] and row.get('paid_through') and datetime.fromisoformat(row['paid_through'].replace('Z','+00:00')) > datetime.now(timezone.utc) and state and state['enabled'] and (not c.live or state['live_approved']) and row['policy_hash']==c.policy)
        result['active'] |= active
        result['subscriptions'].append({'masked_email': link['masked_email'], 'status': row['status'], 'active': active, 'paid_through': row['paid_through'], 'cancel_at_period_end': row['cancel_at_period_end'], 'verified_at': row['verified_at']})
    pending = await db('GET', 'substack_email_verifications', params={'user_id': 'eq.' + user.id, 'account_id': 'eq.' + c.account,
        'livemode': 'eq.'+str(c.live).lower(), 'select': 'id,status,expires_at,masked_email', 'status': 'in.(pending,verified)',
        'expires_at': 'gt.'+datetime.now(timezone.utc).isoformat(), 'order': 'created_at.desc', 'limit': '1'})
    result['pending_request'] = pending[0] if pending else None
    return result


async def process_event(event_id=None):
    c = config();token = str(uuid4())
    event = await rpc('event_claim', account=c.account, live=c.live, token=token, event=event_id)
    if not event:
        return False
    try:
        provider = client(c)
        await verify_account(c, provider)
        subscription_id = event['object_id']
        if event['object_type'] == 'invoice':
            invoice = await call(provider.v1.invoices.retrieve, event['object_id'])
            if bool(invoice.get('livemode')) != c.live:
                raise HTTPException(400, 'substack_invoice_mode_mismatch')
            subscription_id = invoice_subscription(invoice)
            if not subscription_id:
                # Non-subscription invoices in a mixed Stripe account are unrelated.
                await rpc('event_finish', account=c.account, live=c.live, event=event['event_id'], token=token, error=None)
                return True
        await refresh_subscription(c, subscription_id, provider)
        if not await rpc('event_finish', account=c.account, live=c.live, event=event['event_id'], token=token, error=None):
            raise HTTPException(409, 'substack_event_lease_expired')
        return True
    except Exception as error:
        code = error.detail if isinstance(error, HTTPException) and isinstance(error.detail, str) else 'substack_event_failed'
        await rpc('event_finish', account=c.account, live=c.live, event=event['event_id'], token=token, error=code)
        raise


async def accept_event(body, signature):
    c = config()
    if not c.webhook_secret:
        raise HTTPException(503, 'substack_webhook_not_configured')
    try:
        event = stripe.Webhook.construct_event(body, signature, c.webhook_secret, tolerance=300).to_dict()
    except (ValueError, stripe.SignatureVerificationError) as error:
        raise HTTPException(400, 'substack_signature_invalid') from error
    if bool(event.get('livemode')) != c.live or (event.get('account') and event['account'] != c.account):
        raise HTTPException(400, 'substack_webhook_scope_mismatch')
    if event.get('type') not in EVENT_TYPES:
        return {'received': True, 'ignored': True}
    obj = (event.get('data') or {}).get('object') or {}
    object_type = 'invoice' if event['type'].startswith('invoice.') else 'subscription'
    if not (re.fullmatch(r'evt_[A-Za-z0-9]+', event.get('id', '')) and obj.get('object') == object_type
        and re.fullmatch(('in_' if object_type == 'invoice' else 'sub_') + r'[A-Za-z0-9]+', obj.get('id', ''))
        and isinstance(event.get('created'), int)):
        raise HTTPException(400, 'substack_event_invalid')
    await rpc('event_enqueue', account=c.account, live=c.live, event={'id': event['id'], 'type': event['type'], 'api_version': event.get('api_version'),
        'object_id': obj['id'], 'object_type': object_type, 'body_hash': hashlib.sha256(body).hexdigest(), 'signing_key_hash':digest(c,'webhook-secret-v1',c.webhook_secret), 'created': event['created']})
    # The durable record exists BEFORE processing. Failed requests return 5xx so
    # Stripe retries; the authenticated worker can recover expired leases too.
    processed = await process_event(event['id'])
    if not processed:
        receipt=await db('GET','substack_events',params={**scope(c),'event_id':'eq.'+event['id'],'select':'state','limit':'1'})
        if not receipt or receipt[0]['state']!='done':
            raise HTTPException(503,'substack_event_pending',headers={'Retry-After':'30'})
    return {'received': True}


async def reconcile_links(limit=10):
    c = config()
    rows = await rpc('due_subscriptions',account=c.account,live=c.live,limit=limit)
    processed = 0
    for subscription_id in rows:
        await refresh_subscription(c, subscription_id);processed += 1
    return processed


async def worker():
    c = config()
    await db('PATCH','substack_integration',params=scope(c),json={'last_worker_at':datetime.now(timezone.utc).isoformat()})
    events = 0
    for _ in range(3):
        if not await process_event():
            break
        events += 1
    subscriptions = await reconcile_links(5)
    # Delete expiring secret email copies, retaining only bounded abuse counters.
    now = datetime.now(timezone.utc).isoformat()
    await db('PATCH', 'substack_email_verifications', params={'expires_at': 'lte.'+now, 'email_ciphertext': 'neq.'},
        json={'email_ciphertext': '', 'status': 'expired', 'code_hash': ''})
    return {'events': events, 'subscriptions': subscriptions}


def configuration_checks():
    """Admin-only presence/format diagnostics. Never return settings values."""
    checks = {}
    key = os.getenv('SUBSTACK_STRIPE_SECRET_KEY', '').strip()
    checks['SUBSTACK_STRIPE_SECRET_KEY'] = ('missing' if not key else
        'same_as_unoword_key' if key == os.getenv('STRIPE_SECRET_KEY') else
        'format_ok' if key.startswith(('rk_test_', 'rk_live_', 'sk_test_', 'sk_live_')) else 'invalid_format')
    account = os.getenv('SUBSTACK_STRIPE_ACCOUNT_ID', '').strip()
    checks['SUBSTACK_STRIPE_ACCOUNT_ID'] = 'missing' if not account else 'format_ok' if re.fullmatch(r'acct_[A-Za-z0-9]+', account) else 'invalid_format'
    allowlist_present = False
    for name, prefix in [('SUBSTACK_STRIPE_PRICE_IDS', 'price_'), ('SUBSTACK_STRIPE_PRODUCT_IDS', 'prod_')]:
        items = [item.strip() for item in os.getenv(name, '').split(',') if item.strip()]
        checks[name] = 'not_set' if not items else 'format_ok' if all(re.fullmatch(prefix + r'[A-Za-z0-9]+', item) for item in items) else 'invalid_format'
        allowlist_present = allowlist_present or bool(items)
    checks['ELIGIBLE_PRICE_OR_PRODUCT_IDS'] = 'present' if allowlist_present else 'missing'
    secret = os.getenv('SUBSTACK_LINK_HMAC_SECRET', '')
    checks['SUBSTACK_LINK_HMAC_SECRET'] = 'missing' if not secret else 'length_ok' if len(secret) >= 32 else 'too_short'
    checks['RESEND_API_KEY'] = 'present' if os.getenv('RESEND_API_KEY') else 'missing'
    sender = os.getenv('SUBSTACK_EMAIL_FROM', '')
    checks['SUBSTACK_EMAIL_FROM'] = 'missing' if not sender else 'present' if '\r' not in sender and '\n' not in sender else 'invalid_format'
    checks['SUBSTACK_STRIPE_WEBHOOK_SECRET'] = 'present' if os.getenv('SUBSTACK_STRIPE_WEBHOOK_SECRET') else 'not_set'
    return checks


async def admin_status():
    base = {'configured': False, 'enabled': False, 'live_approval': False, 'publication_url': os.getenv('SUBSTACK_PUBLICATION_URL', 'https://unoword.substack.com'),
        'webhook_path': '/api/webhooks/substack-stripe', 'required_events': sorted(EVENT_TYPES), 'email_configured': mail_configured(), 'configuration_checks': configuration_checks()}
    try:
        c = config()
    except HTTPException as error:
        return {**base,'configuration_error':error.detail}
    state = await integration(c)
    counts=await rpc('admin_counts',account=c.account,live=c.live)
    failed = await db('GET', 'substack_events', params={**scope(c), 'select': 'event_id,event_type,state,attempts,last_error,received_at', 'last_error': 'not.is.null', 'order':'received_at.desc','limit': '50'})
    review = await db('GET', 'substack_csv_candidates', params={**scope(c), 'select':'row_hash,masked_email,subscription_id,claimed_paid_through,claimed_status,review_status', 'review_status':'eq.needs_verification','limit':'50'})
    return {**base, 'configured': True, 'account_id': c.account, 'mode': 'live' if c.live else 'test', 'live_approval': c.live_approved,
        'enabled': bool(state and state['enabled']), 'connection': (state or {}).get('verification'), 'verified_at': (state or {}).get('verified_at'),
        'last_worker_at': (state or {}).get('last_worker_at'), 'last_successful_sync': (state or {}).get('last_sync_at'), 'import_cursor': (state or {}).get('import_cursor'),
        'last_import_completed_at': (state or {}).get('last_import_completed_at'), **counts, 'failed_events': failed, 'csv_review': review}


async def set_enabled(enabled, confirmed, admin):
    c = config()
    if not confirmed:
        raise HTTPException(409, 'substack_confirmation_required')
    if enabled:
        if not c.linking or (c.live and not c.live_approved):
            raise HTTPException(409, 'substack_live_access_not_approved' if c.live else 'substack_linking_disabled')
        report = await observe(c)
        if not report['ready']:
            raise HTTPException(409, 'substack_readiness_incomplete')
    if not await rpc('set_enabled', account=c.account, live=c.live, enabled=enabled, approved=c.live_approved, admin=admin):
        raise HTTPException(409, 'substack_activation_not_ready')
    return {'enabled': enabled}


async def import_csv(text, admin):
    c = config();reader = csv.DictReader(io.StringIO(text.lstrip('\ufeff')))
    if not reader.fieldnames or 'email' not in reader.fieldnames:
        raise HTTPException(422, 'substack_csv_email_column_required')
    rows = list(reader)
    if len(rows)>500:
        raise HTTPException(413, 'substack_csv_too_many_rows')
    prepared = []
    for row in rows:
        email = email_value(row.get('email'))
        sub = (row.get('stripe_subscription_id') or '').strip()
        if sub and not re.fullmatch(r'sub_[A-Za-z0-9]+', sub):
            raise HTTPException(422, 'substack_csv_subscription_invalid')
        until = (row.get('paid_through') or '').strip()
        if until:
            try:
                parsed = datetime.fromisoformat(until.replace('Z','+00:00'))
                if not parsed.tzinfo:
                    raise ValueError()
                until = parsed.astimezone(timezone.utc).isoformat()
            except ValueError:
                raise HTTPException(422, 'substack_csv_timezone_required') from None
        key = digest(c, 'csv-row-v1', json.dumps([email, sub, until, row.get('status')],separators=(',',':')))
        prepared.append({'account_id':c.account, 'livemode':c.live, 'row_hash':key, 'email_hash':email_hash(c,email),
            'email_ciphertext':cipher(c).encrypt(email.encode()).decode(), 'masked_email':masked(email), 'subscription_id':sub or None,
            'claimed_paid_through':until or None, 'claimed_status':str(row.get('status') or '')[:50], 'review_status':'needs_verification'})
    if prepared:
        await db('POST','substack_csv_candidates',json=prepared,prefer='resolution=ignore-duplicates')
    await db('POST','substack_admin_audit',json={'admin_id':admin,'action':'csv_stage','detail':{'rows':len(prepared)}})
    return {'staged':len(prepared),'grants_created':0,'note':'CSV entries require current Stripe verification; absent subscribers are never revoked.'}


async def reconcile_csv(row_hash):
    c = config()
    rows = await db('GET','substack_csv_candidates',params={**scope(c),'row_hash':'eq.'+row_hash,'select':'*','limit':'1'})
    if not rows:
        raise HTTPException(404,'substack_csv_row_missing')
    row = rows[0]
    if row['review_status']=='stripe_verified':
        return {'verified':True,'grants_created':0,'requires_subscriber_link':True}
    email=cipher(c).decrypt(row['email_ciphertext'].encode()).decode()
    if row.get('subscription_id'):
        state=await refresh_subscription(c,row['subscription_id'])
        found=bool(state['eligible'] and state['email_hash']==row['email_hash'])
    else:
        found=bool(await find_candidates(c,email))
    if found:
        await db('PATCH','substack_csv_candidates',params={**scope(c),'row_hash':'eq.'+row_hash},json={'review_status':'stripe_verified','email_ciphertext':''})
    return {'verified':found,'grants_created':0,'requires_subscriber_link':True}
