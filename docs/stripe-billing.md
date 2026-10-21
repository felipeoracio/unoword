# Stripe billing for UnoWord

UnoWord Pro is **$20 USD per month after a 7-day free trial**, once per account.
Checkout collects a payment method before the trial starts. Users cancel in the
Stripe billing portal; cancellation takes effect at the end of the trial or paid
period. Free tracking, Quick Prompt and the editable Writing Profile stay free.
Existing independently granted Pro access is preserved and is not automatically
converted into a paid subscription. Stripe-backed Pro grants have 100 AI requests
per day; an existing larger entitlement limit is preserved.

## Finish configuration (start in a Stripe sandbox)

Prefer a separate Vercel preview and Supabase test project for sandbox billing.
If testing on the existing production project, use isolated QA accounts only;
cancel their sandbox subscriptions and delete those QA accounts before switching
to live keys. Existing sandbox customer IDs are not reused in live mode, and
sandbox entitlements cannot unlock Pro when the backend uses live keys.

1. In [Supabase SQL Editor](https://supabase.com/dashboard/project/jvcbpnmtnjhftpukgppw/sql/new),
   run **only** `supabase/migrations/20261021010000_stripe_billing.sql` against the
   existing project. It is safe to reapply. The application uses Supabase REST/RPC
   for billing, so billing does not depend on a reachable direct IPv6 DB hostname.
   The migration creates billing state, durable leases and event receipts; it
   adds a nullable entitlement source without changing existing grants.
2. In the Stripe sandbox Product catalog, create **UnoWord Pro** with a flat,
   recurring, licensed price of **20.00 USD every month**, quantity 1. Copy the
   `price_...` identifier. Trials are configured by the backend when creating
   Checkout; do not create a separate trial price.
3. In Stripe Settings → Billing → Customer portal, activate the **default**
   portal configuration in the same sandbox. Enable **payment method updates**
   and **subscription cancellation at the end of the billing period**. Disable
   **subscription updates** (including plan/quantity changes). The backend checks
   these settings before selling a subscription and explicitly uses that portal
   configuration. Set public business information and support details in Stripe.
4. In Stripe Workbench → Webhooks, add an HTTPS event destination:
   `https://unoword.vercel.app/api/subscription/webhook`.
   Use API version **2026-09-30.endive** and enable:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   Subscription events cover trial transitions, renewals, failed-payment status,
   scheduled cancellation and final cancellation. No invoice or checkout redirect
   grants access. Copy this endpoint's signing secret (`whsec_...`), not an API key
   or a Stripe CLI forwarding secret from a different endpoint.
5. In Vercel → UnoWord project → Settings → Environment Variables, configure the
   backend/server environment, **never a VITE_ variable**:

   | Variable | Value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Sandbox secret key, `sk_test_...` |
   | `STRIPE_PRO_PRICE_ID` | Sandbox recurring `price_...` from step 2 |
   | `STRIPE_WEBHOOK_SECRET` | Endpoint signing secret from step 4 |
   | `STRIPE_BILLING_ENABLED` | `true` after steps 1–4 |
   | `PUBLIC_APP_URL` | `https://unoword.vercel.app` |

   Existing Supabase URL, anonymous key and service-role key remain required.
   Add the same test values to secure cloud environment settings if Codex is to
   perform a real sandbox checkout test. Keep keys and database passwords out of
   chat, git, screenshots, the extension and the public frontend.
6. Redeploy Vercel so the backend sees the new settings. Run the read-only
   readiness check below, then use `/account?plan=pro` with an **isolated Free QA
   account**. Stripe supports the test card `4242 4242 4242 4242`, a future expiry
   and any valid test CVC. No real money is charged in a sandbox.
7. Verify Checkout shows the 7-day trial and $20 monthly renewal. Complete it,
   wait for a successful subscription webhook, and confirm Pro in the account
   page and reopened extension. Repeating the checkout request must reuse its
   open session or offer the portal, never create a second subscription.
8. Verify portal payment details and cancellation at trial end; use Stripe test
   clocks/fixtures for renewal, failed payments and trial end. Confirm canceled
   accounts lose AI access, preserve their writing/profile data and retain Free
   Quick Prompt. A returning subscriber must not get another trial.

**Before accepting real payments:** use the corresponding live product/price,
portal configuration, live webhook destination/signing secret and `sk_live_...`
key together; sandbox IDs do not work with live keys. Finish Stripe business
activation and publish the owner's formal terms, privacy contact and refund
policy. The current `/terms` route still explicitly says formal legal terms have
not been published. No legal or refund policy was invented by this integration.

## Read-only readiness check

From the repository root with backend dependencies and secure environment values:

```sh
python backend/scripts/check_stripe_billing.py
```

It verifies the enabled flag, exact Stripe price, portal settings, billing table
availability and the production webhook destination/events. It does not create
Stripe objects, modify accounts or print credentials. For a preview environment,
set `PUBLIC_APP_URL` and its own webhook destination to that preview's HTTPS origin.

## Behavior and recovery

- `GET /api/product` publishes the application offer (amount in cents, currency,
  interval and trial days), capabilities and whether checkout is configured.
  The server verifies the actual Stripe price before creating a session. Missing
  configuration or a price/portal mismatch fails closed without granting Pro.
- `GET /api/subscription` returns only the authenticated account's sanitized plan,
  trial eligibility, period end and cancellation state. No Stripe IDs are exposed.
- `POST /api/subscription/change` requires authentication, a trusted browser
  origin, explicit confirmation and a matching `expected_user_id`. `pro` starts
  Checkout or opens the portal for an existing subscriber; `free` **opens the
  portal**, where the user confirms cancellation. Opening the portal itself
  does not cancel. Return URLs are server-owned, and returned URLs are restricted
  to Stripe Checkout/portal hosts in both web and extension clients.
- `POST /api/subscription/webhook` verifies the raw-body Stripe signature with a
  five-minute tolerance and mode matching. Customer ownership comes from the
  server-created billing mapping, never from user-supplied IDs. Metadata is checked
  against this mapping. Only the configured single-seat price can grant access.
- A durable per-account lease serializes provider operations across Vercel
  instances. Persisted Checkout attempt IDs supply Stripe idempotency keys;
  open sessions are reused. Subscription history prevents duplicate subscriptions
  and repeat trials, including before the first webhook has arrived.
- Subscription state is fetched **from Stripe under the lease**; stale event
  payloads cannot roll back newer provider state. One database transaction stores
  billing state, the unique webhook receipt and the entitlement. Failed updates
  return a non-2xx response so Stripe can retry. A canceled older subscription
  cannot revoke a newer one. Active/trialing grants always expire at their
  verified period boundary. `past_due`, `unpaid`, `paused`, `incomplete`, canceled
  and unknown-price subscriptions do not grant AI access.
- A crashed worker's lease expires after five minutes; expired workers cannot
  commit. If `billing_busy` occurs, wait and retry. Provider/database outages do
  not cause the browser to grant access or the webhook to acknowledge a failed
  update. Replay failed events from Stripe Workbench after recovery.
- Set `STRIPE_BILLING_ENABLED=false` to stop **new checkout**. Keep the secret key,
  webhook secret and destination active: existing customers can still open the
  portal and cancellations/renewals continue to synchronize. Removing these keys
  would break management of existing subscriptions.
- If an account is manually removed through Supabase administration, cancel its
  Stripe subscription first. Deleting the auth row alone does not cancel billing.
- Aggregate revenue reporting in the admin dashboard remains unavailable;
  use Stripe's reporting. Billing receipts store event IDs, not raw card data.

## Local verification

```sh
PYTHONPATH=backend python -m pytest backend/tests/test_billing.py backend/tests/test_product.py backend/tests/test_account_security.py
cd frontend
# Use the project's yarn toolchain.
yarn build
yarn lint
```

Browser tests use the built frontend and actual extension popup/worker with HTTP
fixtures. `frontend/tests/marketing.browser.cjs` covers Checkout/portal navigation,
confirmation, a forged success URL, verified status polling and no local access
grant; `extension/tests/profile-security.browser.cjs` covers the corresponding
extension tab flow and EN/ES responsive layout.

`supabase/tests/billing.cjs` executes the real migration and RPCs in PostgreSQL
WASM (PGlite). It verifies idempotent migration application, leases/expiry,
transaction rollback, event replay, entitlement updates, preserved manual grants
and quotas, account isolation, and denied browser-role access to tables/RPCs.
Install `tests` dev dependencies and run from the repository root:

```sh
PGLITE_MODULE="$PWD/tests/node_modules/@electric-sql/pglite" node supabase/tests/billing.cjs
```

These isolated tests do not constitute a real Stripe payment or live webhook test.

## Implementation verification — 2026-10-21

- 153 selected backend tests passed, including billing, account security, shared
  product permissions, personalization, all suggestion modes, usage cost limits,
  links and knowledge availability. No real user accounts or API quotas were reset.
- The real billing migration and RPCs passed isolated PostgreSQL/PGlite checks.
- The frontend production build and type check passed. Lint has only the four
  existing UI export/admin-hook warnings and no new warnings.
- Built web and extension browser fixtures passed Checkout/portal navigation,
  account confirmation, no access from a success URL, verified status polling,
  recovery callbacks, original/AI suggestion behavior, writing-session counts,
  responsive EN/ES popup layouts (180–420 px) and web layouts (320–1440 px).
  The marketing/account accessibility audits passed.
- Extension unit tests passed; the downloadable release is version 0.14.0 and
  excludes environment files, tests and dependencies.
- Actual Stripe Checkout, paid invoices, live webhook delivery and remote migration
  application are **not verified**: Stripe credentials are missing and the cloud
  database connection could not be established. Complete the setup above and the
  real sandbox checklist before enabling live payments. Checkout stays disabled
  by default; the implementation does not fabricate successful billing.
