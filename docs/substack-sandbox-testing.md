# Substack integration: sandbox rehearsal

Use this guide when the publication has no paid subscribers yet. Having no
eligible paid subscription is expected in that case; it does not mean that the
publication's configured prices are wrong. Sandbox records exercise UnoWord's
linking mechanism, not the existence of an actual paid Substack subscriber.

The `test/substack-sandbox` branch contains the same application implementation
as production plus this guide. Its Vercel Preview is for testing. Do not promote
it to Production or replace the Production Stripe settings with sandbox values.

## Preview settings

Use the exact Preview URL supplied by Vercel after this branch deploys. Save
these variables for **Preview only**, then redeploy this branch:

| Setting | Preview value |
| --- | --- |
| `SUBSTACK_STRIPE_SECRET_KEY` | The sandbox restricted read-only key |
| `SUBSTACK_STRIPE_ACCOUNT_ID` | The account ID verified for that sandbox key |
| `SUBSTACK_STRIPE_PRICE_IDS` | Recurring sandbox test price IDs, comma-separated |
| `SUBSTACK_STRIPE_PRODUCT_IDS` | Leave unset unless explicitly testing a sandbox product allowlist |
| `SUBSTACK_PUBLICATION_URL` | `https://unoword.substack.com` |
| `SUBSTACK_STRIPE_WEBHOOK_SECRET` | The Preview destination's sandbox signing secret, added after destination creation |
| `SUBSTACK_LINKING_ENABLED` | `false` during initial connection setup |
| `SUBSTACK_STRIPE_LIVE_ACCESS_APPROVED` | `false` throughout sandbox testing |
| `PUBLIC_APP_URL` | The exact HTTPS Preview origin, with no path |
| `AUTH_ALLOWED_ORIGINS` | The exact HTTPS Preview origin |
| `CORS_ORIGINS` | The exact HTTPS Preview origin |
| `STRIPE_BILLING_ENABLED` | `false` for this integration-only rehearsal |
| `STRIPE_LIFETIME_ENABLED` | `false` for this integration-only rehearsal |
| `STRIPE_LIVE_BILLING_APPROVED` | `false` |

The Preview backend also needs its existing Supabase authentication/database,
admin authentication, `AI_AUTH_MODE=supabase`, stable
`SUBSTACK_LINK_HMAC_SECRET`, `RESEND_API_KEY`, and `SUBSTACK_EMAIL_FROM`
configuration. A variable scoped only to Production is not automatically a
Preview variable. Keep all secret values in secure backend settings.

If using the existing Supabase database for read-only verification and staging
subscription snapshots, keep the Substack source **disabled** in Admin. These
tables distinguish Stripe account and mode, but enabling test entitlements in
a shared database can affect shared authorization. Test access activation in a
separate migrated Supabase test project, with a dedicated test user. Never
enable a sandbox source in the production database as a shortcut.

## Sandbox destination and fixture

1. In the Stripe sandbox, create an enabled snapshot-event destination for
   `https://YOUR-PREVIEW-HOST/api/webhooks/substack-stripe`.
2. Select `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, and
   `invoice.payment_failed`, from that sandbox account.
3. Save this destination's signing secret as
   `SUBSTACK_STRIPE_WEBHOOK_SECRET` for Preview only and redeploy the Preview.
4. Confirm the endpoint is publicly reachable by Stripe. A Vercel sign-in or
   deployment-protection response blocks webhook delivery. Configure a public
   staging deployment for the test if needed; do not change production
   protection or put authentication secrets in the webhook URL.
5. Use Stripe's sandbox UI to create a test customer with an email address you
   control and a paid test subscription to the allowlisted recurring test
   price. Use Stripe's test payment method, never a real charge. A trial or
   zero-value invoice does not qualify as a paid subscription.
6. Check delivery of the resulting supported event. If it occurred before the
   destination was ready, resend that existing sandbox event to the Preview
   destination. A generic generated event with a nonexistent subscription ID
   cannot verify paid eligibility.

No UnoWord provider code creates or changes subscriptions: fixture creation is
performed manually in Stripe's sandbox. The integration key remains read-only.

## Checks and activation boundary

In Preview Admin → Integrations → Substack, check the connection and import
existing sandbox subscriptions. Verify account, mode, read permissions,
positive-paid eligible sample, destination and current signing-secret delivery.
Keep the shared-database source disabled. Readiness does not activate access.

Only on an isolated test database, enable the sandbox linking flow and test
email ownership, linking, paid access, cancellation, expiry, failed payment,
duplicates, out-of-order events, disconnection and preservation of independent
Monthly/Lifetime entitlements. Email tests should be initiated by the owner
using the dedicated test inbox. Test results must distinguish actual provider
delivery from synthetic automated coverage.

Return to Production for a separate live-account verification once an actual
eligible paid Substack subscription exists. Sandbox success cannot prove a
live subscriber's payment or email ownership. Automatic live access still
requires explicit owner approval and fresh production readiness checks.
