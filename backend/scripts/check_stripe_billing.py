"""Read-only Stripe readiness check. Never prints secret values or provider bodies."""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
sys.path.insert(0, str(ROOT))
from fastapi import HTTPException
from lib import billing


async def main():
    required = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRO_PRICE_ID']
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        print('Missing secure settings: ' + ', '.join(missing))
        return 1
    if not billing.billing_available():
        print('New checkout is disabled: STRIPE_BILLING_ENABLED must be true after configuration.')
        return 1
    try:
        c = billing.client()
        await billing.verified_price(c)
        print('PASS: Stripe price is active, 20 USD/month, licensed, and matches key mode.')
        await billing.portal_configuration(c)
        print('PASS: Default portal supports payment methods and cancellation at period end; subscription updates disabled.')
        await billing.db('GET', 'billing_accounts', params={'select': 'user_id', 'limit': '0'})
        await billing.db('GET', 'billing_events', params={'select': 'event_id', 'limit': '0'})
        await billing.db('GET', 'ai_entitlements', params={'select': 'billing_source,billing_livemode', 'limit': '0'})
        print('PASS: Billing migration tables and entitlement source are reachable through Supabase REST.')
        endpoints = await billing.call(c.v1.webhook_endpoints.list, {'limit': 100})
        expected = billing.app_url() + '/api/subscription/webhook'
        required_events = {'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
                           'customer.subscription.paused', 'customer.subscription.resumed'}
        ready = any(e.get('url') == expected and e.get('status') == 'enabled'
                    and e.get('api_version') == billing.API_VERSION
                    and ('*' in e.get('enabled_events', []) or required_events.issubset(e.get('enabled_events', [])))
                    for e in endpoints['data'])
        if not ready:
            print('FAIL: Matching enabled webhook destination/version/events not found. See docs/stripe-billing.md.')
            return 1
        print('PASS: Enabled webhook destination matches this application origin, API version and subscription events.')
        print('Configuration checks passed. A real sandbox checkout and successful signed webhook still need to be tested.')
        return 0
    except HTTPException as error:
        print('FAIL: ' + str(error.detail) + '. See docs/stripe-billing.md.')
        return 1
    except Exception:
        print('FAIL: Configuration check could not complete. No credentials were printed.')
        return 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
