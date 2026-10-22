# Stripe billing for Uno Word

Uno Word Pro is **$20 USD per month after a 7-day free trial**, once per account.
Checkout collects a payment method before the trial starts. Each session explicitly
sets `managed_payments.enabled=false` and uses standard Stripe Checkout subscriptions,
so an account-wide Managed Payments default does not add product tax-code requirements
to this integration. This does not change the Stripe account-wide setting. Standard
Checkout does not itself configure tax collection or Stripe Tax for the merchant. Users cancel in the
Stripe billing portal; cancellation takes effect at the end of the trial or paid
period. Free tracking, Quick Prompt and the editable Writing Profile stay free.
Existing independently granted Pro access is preserved and is not automatically
converted into a paid subscription. Stripe-backed Pro grants have 100 AI requests
per day; an existing larger entitlement limit is preserved.

## Review and current status — 2026-10-22

The existing integration was reviewed and reused; no second payment system was added.

| Existing part | How billing uses it | Input needed from you |
| --- | --- | --- |
| Supabase authentication | The backend verifies the signed-in user's token; development-only identities cannot access billing; billing belongs to the account ID, not a browser-supplied plan or email. Session cookies remain HTTP-only. | No new login system or user migration. |
| FastAPI backend on Vercel | Creates hosted Checkout/Customer Portal sessions and receives Stripe subscription events. Secret keys stay here. | Add sandbox Stripe settings securely. |
| Supabase database | Existing entitlements control access. Billing tables, private service-only functions, event receipts and mode fields were confirmed reachable in the current project by read-only checks. | No need to repeat the migration on this project. Apply it only for a different project or if it has not been applied there. |
| Free plan | Keeps tracking, Quick Prompt, recent history and editable Writing Profile. | None. |
| Pro plan | Stripe-managed accounts receive access only while their verified subscription is active/trialing and within its period. Previously granted independent Pro access is preserved rather than silently billed or removed. | Price remains your confirmed $20 USD/month, with an eligible 7-day trial. |

Here is what happens for a subscriber:

1. **Sign in.** Uno Word checks who the person is before opening an upgrade.
2. **Review payment on Stripe.** Checkout shows the trial and monthly price and
   collects the payment method on Stripe's own page. Uno Word does not collect
   card details on its own server.
3. **Confirm access from Stripe.** Stripe sends the backend a signed subscription
   message (a webhook). The backend verifies it and reads the current Stripe
   subscription before granting Pro. A browser's success URL cannot grant access.
4. **Manage or cancel.** The signed-in account opens Stripe's Customer Portal.
   Cancellation is scheduled for trial/paid-period end. The account page refreshes
   after returning, including delayed cancellation updates. Saved writing,
   profiles, documents, website sources and Free features are retained.
5. **Retry safely.** Repeated checkout requests reuse their session. Duplicate
   Stripe messages are recorded once in the same database transaction as access
   updates, so retries cannot grant access twice or erase a newer subscription.

**Sandbox only for this rollout.** This environment still has no Stripe secret
key, webhook signing secret or Pro price ID. New checkout is disabled. Live keys
are rejected unless a separate `STRIPE_LIVE_BILLING_APPROVED=true` setting is
explicitly authorized by you in a future step. Do not enable that setting now;
adding live keys or setting `STRIPE_BILLING_ENABLED=true` alone cannot authorize
live Checkout, live portal actions or live webhook entitlement changes.

Your remaining input is in steps 2–6 below: create/configure the sandbox product,
portal and webhook in your Stripe account, put their values in secure Vercel
settings, then redeploy. To let Codex run real sandbox API checks, also make the
same test values available in secure cloud environment settings. Do not paste
keys into chat. The read-only checker then verifies setup before the real
sandbox checkout/cancellation test. No real money is charged in sandbox mode.

## Finish configuration (start in a Stripe sandbox)

Prefer a separate Vercel preview and Supabase test project with the existing
Uno Word application schema for sandbox billing.
If testing on the existing production project, use isolated QA accounts only;
cancel their sandbox subscriptions and delete those QA accounts before switching
to live keys. Existing sandbox customer IDs are not reused in live mode, and
sandbox entitlements cannot unlock Pro when the backend uses live keys.

1. In [Supabase SQL Editor](https://supabase.com/dashboard/project/jvcbpnmtnjhftpukgppw/sql/new),
   **For this existing project, the billing schema is already present.** For a new
   project that already has the application tables, run **only**
   `supabase/migrations/20261021010000_stripe_billing.sql` against that database. It is safe to reapply. The application uses Supabase REST/RPC
   for billing, so billing does not depend on a reachable direct IPv6 DB hostname.
   The migration creates billing state, durable leases and event receipts; it
   adds a nullable entitlement source without changing existing grants.
2. In the Stripe sandbox Product catalog, create **Uno Word Pro** with a flat,
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
5. In Vercel → Uno Word project → Settings → Environment Variables, configure the
   backend/server environment, **never a VITE_ variable**:

   | Variable | Value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Sandbox secret key, `sk_test_...` |
   | `STRIPE_PRO_PRICE_ID` | Sandbox recurring `price_...` from step 2 |
   | `STRIPE_WEBHOOK_SECRET` | Endpoint signing secret from step 4 |
   | `STRIPE_BILLING_ENABLED` | `true` after steps 1–4, using sandbox keys |
   | `STRIPE_LIVE_BILLING_APPROVED` | `false` — leave this disabled |
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

**Live billing is not authorized.** Keep `STRIPE_LIVE_BILLING_APPROVED=false`.
Only after the owner explicitly approves a future launch should that setting be
enabled alongside the corresponding live product/price,
portal configuration, live webhook destination/signing secret and `sk_live_...`
key together; sandbox IDs do not work with live keys. Finish Stripe business
activation and publish the owner's formal terms, privacy contact and refund
policy. The current `/terms` route still explicitly says formal legal terms have
not been published. No legal or refund policy was invented by this integration.

## Identifying a failed Stripe setup

Checkout fails closed when Stripe configuration is incomplete. The backend now
returns stable error labels and logs only the operation, exception class,
allowlisted Stripe error code and request correlation ID. It does not log keys,
provider messages/bodies, customer data or hosted session URLs.

| Error label | What to check |
| --- | --- |
| `billing_price_mismatch` | `STRIPE_PRO_PRICE_ID` must begin with `price_`, not `prod_`; it must be an active flat licensed price of 20 USD/month in the same sandbox as the key. |
| `billing_price_not_found` | The price ID is missing from the Stripe sandbox used by the secret key. Copy that sandbox's recurring Price ID and redeploy. |
| `billing_key_invalid` | Replace the invalid/revoked sandbox secret key in secure Vercel settings, then redeploy. |
| `billing_permission_denied` | The configured key lacks permission for the requested Stripe operation. Use an appropriately permitted sandbox key. |
| `billing_portal_not_configured` | Activate the default sandbox portal with payment-method updates and cancellation at period end, without subscription updates. |
| `billing_checkout_configuration_invalid` | Inspect the matching request in Stripe Workbench API logs for Checkout configuration requirements. Uno Word explicitly disables Managed Payments per session; a Managed Payments tax-code error indicates the deployment predates that fix. |
| `billing_provider_unavailable` | A transient/network error or another provider error occurred; inspect the bounded `stripe_request_failed` log entry and its operation/request ID. |

## Read-only readiness check

From the repository root with backend dependencies and secure environment values:

```sh
python backend/scripts/check_stripe_billing.py
```

It verifies allowed sandbox/live mode, the enabled flag, exact Stripe price, portal settings, billing table
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
  Billing status and hosted session responses use private, no-store cache headers.
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
- At initial implementation, remote migration application and real Stripe delivery
  were not verified. The 2026-10-22 read-only review confirmed billing tables,
  entitlement fields and all three RPCs are now available. Actual Stripe Checkout,
  invoices and webhook delivery still require sandbox credentials and end-to-end
  testing. New checkout stays disabled by default, and live billing remains locked
  until explicit owner approval.

## Review verification — 2026-10-22

- 168 selected backend tests passed, covering existing account/profile/AI behavior,
  authenticated billing, subscription lifecycle, signature verification, duplicate
  events, development-auth rejection, non-cacheable billing responses, and live
  requests rejected without explicit approval. Live-approval tests use fake keys
  and fake API clients; no live Stripe requests or charges were made.
- The real PostgreSQL/PGlite migration and atomic RPC tests passed, including
  duplicate receipts, transaction rollback, leases, preservation of manual grants
  and quotas, and denied access for browser database roles.
- Read-only checks confirmed the existing Supabase billing tables, entitlement
  mode/source fields, and all three service RPCs are available. No production user
  records, subscriptions, data, grants or quota counters were changed by this review.
- Frontend build/type checks passed; lint has the four existing unrelated warnings.
  Browser tests passed for Checkout/portal navigation, forged success URLs,
  delayed cancellation while Pro stays active, canceled-to-Free status updates,
  mobile layout, and accessibility. The extension account/profile/security browser
  regression test passed in English and Spanish at popup dimensions.
- The readiness script still reports missing `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRO_PRICE_ID` in this environment. Actual
  sandbox Checkout, invoices and signed webhook delivery remain unverified until
  these settings are supplied and the real sandbox checklist is completed.
