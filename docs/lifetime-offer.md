# $100 lifetime Pro offer — first 25 purchasers

Public page: `/lifetime`. Account/purchase flow: `/account?offer=lifetime`.
The offer is a **one-time $100 USD payment**, not a subscription or trial, for
UnoWord Pro access on that account. It includes the current Pro editor/library,
AI tools and personalization, writing knowledge, goals/history, and extension.
It does not include unlimited AI or storage. A new grant uses the existing Pro
100-request entitlement; the public page calculates the effective daily limit
with the same environment-cap resolver as the existing AI endpoints. Your
account remains authoritative for its exact allowance. Requests can return
multiple ideas while consuming one request.

The owner confirmed a **14-day full-refund window**. Eligible account holders can
request a full refund from the signed-in lifetime-offer panel. The server checks
the verified Stripe payment date and refunds that original PaymentIntent using
a stable idempotency key. Verified full refunds revoke the lifetime grant.
Partial refunds do not revoke it. Disputes suspend the lifetime grant; a verified
won dispute can restore it. Refunded/disputed purchases do not reopen a sold
place, keeping this to the first 25 historical lifetime purchasers. No purchase,
refund, or dispute processing deletes documents or user writing.

## Activation steps required

The code is complete but this environment has no Stripe test key or lifetime
price ID, no Vercel API token, and cannot connect to Supabase SQL directly or
through the supplied pooler. It therefore could not create a real Stripe test
price, apply the inventory migration remotely, or run an actual Stripe-hosted
sandbox payment. Provider-boundary, SQL, and browser tests are isolated fixtures;
they are not evidence of a completed Stripe sandbox charge.

1. In the existing Supabase project's **SQL Editor**, run
   `supabase/migrations/20261026010000_lifetime_offer.sql`. It requires the existing
   billing migration (`20261021010000_stripe_billing.sql`) and AI entitlement
   foundation, which the existing subscription integration already uses. The new
   migration adds only lifetime inventory/orders and service-role-only RPCs.
2. In the **same Stripe sandbox** used by the current backend, create an active
   product/price for UnoWord Pro Lifetime: **one-time**, **USD 100.00**, not recurring.
3. In Vercel's backend environment settings set:
   - `STRIPE_LIFETIME_PRICE_ID=price_...` (the one-time test price)
   - `STRIPE_LIFETIME_ENABLED=true`
   Keep the existing `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as test values.
   Keep `STRIPE_LIVE_BILLING_APPROVED=false`. Redeploy after updating settings.
4. Keep using the existing signed webhook URL:
   `https://unoword.vercel.app/api/subscription/webhook`. Add these event types to
   its sandbox destination, alongside the existing subscription events:
   `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`.
5. Sign in with an ordinary Free sandbox test account, open `/lifetime`, and go
   through the confirmed account checkout. Use Stripe's test payment details.
   Confirm webhook delivery, then verify the account's lifetime status is paid
   and its editor is accessible. Test the signed-in refund action as well.

No new live billing has been authorized or enabled. This lifetime integration
rejects live keys **even if** the general subscription live-approval flag is true.
It requires a separate, explicitly approved change before a live lifetime launch.
Sandbox grants are excluded from paid access if the backend later uses live keys.
The existing monthly price, trial, checkout, and subscription management remain.

## Capacity and payment correctness

- SQL serializes inventory reservation and allocates at most 25 numbered slots.
  Browser roles cannot read/write orders or call inventory/entitlement RPCs.
- Paid slots have a separate durable ledger. Deleting an account or refunding a
  payment cannot manufacture a 26th lifetime place.
- The public counts distinguish **deals left = 25 minus verified purchases** from
  **places available now**, which also subtracts checkout reservations. Holds
  are never called paid sales. Missing inventory returns unknown counts rather
  than pretending all 25 are available.
- Open Stripe checkout holds a place. A slot is released only after verifying the
  exact Stripe session is expired. A local timer or browser cancellation cannot
  free a session that might still accept payment. Existing reservations can
  resume even when all remaining slots are held. Stripe's default session
  expiration applies; held sessions can temporarily exhaust available inventory.
- Checkout creation uses a stored attempt UUID and Stripe idempotency key. An
  unbound reservation older than 23 hours fails closed for manual review instead
  of creating a second payment after Stripe's idempotency retention window.
- Webhook signatures/mode checks reuse the current integration. The backend
  retrieves current Stripe state, verifies owner/customer/metadata, one line
  item, original price, quantity one, $100 USD total, a succeeded PaymentIntent,
  and its paid charge. Only then does an atomic receipt transaction grant Pro.
  The paid grant has no expiration but retains Pro AI limits.
- Duplicate webhook IDs do not duplicate grants. Current provider state protects
  against delayed events undoing refunds or dispute outcomes. Old monthly
  cancellations cannot overwrite an active lifetime entitlement.
- A redirect alone never grants access. The account page shows pending/verified
  state from the backend. There are no frontend keys or client-set prices.
- Once 25 purchases are verified, the page states sold out and points to ordinary
  plans; the server cannot allocate another place, even with a stale open page.

## Existing-customer and operational limits

An active monthly subscription, trial, or open monthly checkout must be resolved
before buying lifetime; the integration does not silently cancel paid plans or
allow simultaneous monthly/lifetime purchases. Independently granted Pro accounts
require support review. Refunded/disputed lifetime orders cannot be repurchased
through this introductory offer. Successful lifetime access protects existing
writing, profile, and history.

Do not remove the configured lifetime price ID while outstanding purchases need
webhook/refund processing. The receipt stores the original price ID for later
verification. Do not delete paid inventory/ledger rows to reset public counts.
For a rare checkout crash before its session ID is stored, a matching webhook can
repair the binding. Unresolved old reservations require checking Stripe rather
than releasing places blindly. The first-25 SQL migration is test inventory;
any later live launch needs its own reviewed inventory and access/mode plan.

Fair-use copy explains personal account use, daily caps, rate limits, and no
bypassing limits by automated bulk requests, shared credentials, or resale. The
implemented daily caps/rate limits remain the existing ones; this change does
not add an automated abuse classifier or modify ordinary Pro pricing.

## Files

- Page/design: `frontend/src/pages/Lifetime.tsx`,
  `frontend/src/styles/lifetime.css`, `frontend/src/App.tsx`.
- Purchase/refund account UI: `frontend/src/components/marketing/LifetimeAccount.tsx`,
  `frontend/src/lib/lifetime.ts`, `frontend/src/pages/Account.tsx`,
  `frontend/src/pages/Information.tsx`.
- Public SEO/prerender route: `frontend/src/components/PageMetadata.tsx`,
  `frontend/src/entry-marketing.tsx`, `frontend/scripts/prerender.mjs`, `vercel.json`.
- Backend: `backend/lib/lifetime.py`, `backend/routers/subscriptions.py`,
  `backend/lib/billing.py`, `backend/lib/ai_access.py`, `backend/.env.example`.
- Migration and tests: `supabase/migrations/20261026010000_lifetime_offer.sql`,
  `supabase/tests/lifetime.cjs`, `backend/tests/test_lifetime.py`,
  `tests/lifetime.browser.cjs`.

No new dependencies or application services are introduced. The writing editor,
Chrome extension, monthly subscription offer, and saved user data are preserved.

## Verification

- Production build and TypeScript; lint with only the four existing shared UI/
  admin warnings. The SSR build notes that its static Lifetime import resolves
  App's dynamic import within the server bundle; browser routing stays lazy.
- **116 lifetime/payment, existing billing, and public-product backend tests** cover
  signed owner/confirmation checks, test-only enforcement, rejected client-set
  amounts/quantities, price validation, stable checkout retries, verified payment
  grants, duplicate events, refunds/window checks, dispute outcomes, expiry,
  limits, and sandbox-to-live grant separation.
- Isolated PostgreSQL tests execute and reapply migrations: 25-slot allocation,
  duplicate retries, expiry compare-and-swap, paid/refund receipt idempotency,
  lifetime grant, old monthly cancellation protection, durable sold counts after
  account deletion, and denial of anonymous/browser SQL access.
- The page browser suite checks seven viewport widths (320–1920px), no horizontal
  overflow/clipped controls, WCAG A/AA, all offer terms, actual-paid-versus-held
  counts, unknown inventory, sold-out behavior, account sign-in/sign-up intent,
  one-time checkout confirmation and destination, redirect-not-Pro behavior,
  existing-subscription error handling, and the refund action. All HTTP/payment
  responses in that suite are fixtures; no real customer or charge is modified.
- Existing landing regression passed for its 14 widths, links, auth gates,
  pricing/entitlements, SEO/branding, and accessibility.

Screenshots: `/workspace/.onboarding/unoword/lifetime/lifetime-1440.png`,
`lifetime-768.png`, `lifetime-390.png`, and matching `-viewport.png` captures.
Their inventory values are browser fixtures, clearly shown under the test-mode
banner; production availability always comes from the database.

Run the new checks with the production build preview at localhost:4175:

```sh
PYTHONPATH=backend python -m pytest backend/tests/test_lifetime.py backend/tests/test_billing.py backend/tests/test_product.py -q
PGLITE_MODULE=/path/to/@electric-sql/pglite node supabase/tests/lifetime.cjs
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium AXE_SCRIPT=/path/to/axe-core/axe.min.js node tests/lifetime.browser.cjs
```
