# Substack → UnoWord Pro

Publication: **https://unoword.substack.com**. Verification mail: **Resend**.

This integration only reads the publication's Stripe account. It never creates a customer, subscription, charge, Checkout session, refund or cancellation in that account. Connecting has no second payment. UnoWord's original Stripe account, Monthly billing, Lifetime purchases, prices and assigned AI allowances remain unchanged.

**Live access starts disabled.** Actual account/API permissions and records cannot be verified until the owner supplies the separate Substack account credentials. The implementation's synthetic tests are not proof of live-account access. Dashboard visibility alone is insufficient.

## Architecture

- `ai_entitlements` remains the existing native UnoWord grant table. No Substack process writes it.
- `substack_subscriptions` stores minimal, verified Stripe references, an email index, status and paid-through evidence. `substack_links` binds an email-verified UnoWord account to a subscription. A unique index prevents two active owners of one subscription.
- `ai_effective_entitlements` considers both independent sources, preferring a valid native grant. An expired/disconnected Substack grant cannot revoke Monthly, Lifetime or another native grant.
- Existing server-side feature checks use `get_entitlement`. The workspace RLS helper, versioned AI reservation function, and durable knowledge-processing checks use the effective view too. Substack users receive the same assigned Pro allowance; multiple sources never multiply/reset quota.
- All seven new tables enable and force RLS, and direct anon/authenticated access is revoked. Service-only functions bind account, mode and owner in the backend. The authenticated workspace helper reveals only the caller's own access boolean.
- Native billing/admin revenue reports continue describing native UnoWord billing. External connection counts and lifecycle are managed separately in **Admin → Integrations → Substack**.

## 1. Apply the database migration

In the existing UnoWord Supabase project's **SQL Editor**, run the complete file:

`supabase/migrations/20261104020000_substack_pro_integration.sql`

It is additive, transactional and repeatable. It requires the existing workspace, shared AI allowance and durable knowledge-processing migrations. It creates no UnoWord accounts and deletes no writing or native subscriptions. Its function replacements extend trusted read checks rather than changing native billing writers. Keep RLS enabled.

The application can deploy with the integration unconfigured: native access checks remain unchanged and linking displays an unavailable/preparation state. Apply this migration before configuring, importing or activating the source.

## 2. Prepare a separate Stripe restricted key

Open the Stripe Dashboard for the **Substack publication's connected account**, not simply UnoWord's normal billing account. Record its `acct_…` account ID.

Create a restricted key with only these **read** permissions (Dashboard labels vary):

| Stripe objects/endpoints | Why |
| --- | --- |
| Account details — `GET /v1/account` | Independently verify the key belongs to the configured account |
| Customers — list/retrieve | Verify the subscription's current billing email after ownership proof |
| Subscriptions — list/retrieve | Verify current status, matching recurring prices and period boundaries |
| Invoices — list/retrieve, including returned invoice lines | Verify positive paid invoices, subscription association and paid-through dates |
| Prices — retrieve | Verify configured recurring price IDs; use read/list for manual discovery if needed |
| Products — retrieve, if product allowlisting is used | Verify configured product IDs and mode |
| Webhook endpoints/event destinations — list/read | Verify destination URL, enabled status, API versions and selected events |

**No write permission is needed.** No Charges, PaymentIntents, Checkout or payment-method write access is needed. Events-read is not required: signed events are durably recorded, and current invoices/subscriptions are retrieved using their references. Creation of the destination is done manually by the owner in Dashboard, not with this API key.

Keep Stripe console payload debugging (`STRIPE_LOG=debug` or `info`, or `stripe.log`) disabled for this source. Its provider calls refuse those settings and suppress only their own SDK URL/body logs; native billing correlation logs remain available.

Some Substack/Stripe Connect account types may not expose `GET /v1/account` or webhook endpoint listing to restricted keys. The connection check reports an error and activation stays blocked; do not bypass the check or assume the account ID. Obtain appropriate read permissions or review the account arrangement with Stripe/Substack. A separate account-scoped secret key is supported where restricted permissions genuinely cannot provide the required reads, but it must remain backend-only.

Copy eligible Substack `price_…` IDs and/or `prod_…` IDs from Stripe. Verify they represent **unoword.substack.com paid subscriptions**. Product names and customer-email matches are not sufficient authority. The allowlist must be explicit; other subscriptions in the account never qualify automatically. Archived prices can remain valid for existing paid subscriptions.

## 3. Configure backend secrets

In Resend, add a domain you control, add its verification/DKIM/SPF records at your DNS provider, and wait for **Verified** status. Create a sending-only API key for that domain and choose a From address on it. A Substack-hosted `unoword.substack.com` address or a Gmail address cannot be verified as your own sending domain unless you control that domain's DNS. Keep the Resend key in backend settings; no verification emails are sent by the setup tests.

Set these in Vercel → UnoWord project → **Settings → Environment Variables**, for the intended deployment environment, and redeploy. Keep keys out of chat, source files, frontend/Vite/Expo variables and extension storage.

| Variable | Value/purpose |
| --- | --- |
| `SUBSTACK_PUBLICATION_URL` | `https://unoword.substack.com` |
| `SUBSTACK_STRIPE_SECRET_KEY` | Separate restricted `rk_test_…` or `rk_live_…` key; never reuse `STRIPE_SECRET_KEY` |
| `SUBSTACK_STRIPE_ACCOUNT_ID` | Intended account's `acct_…` ID |
| `SUBSTACK_STRIPE_PRICE_IDS` | Comma-separated publication paid recurring price IDs |
| `SUBSTACK_STRIPE_PRODUCT_IDS` | Optional comma-separated publication product IDs; at least one allowlist is required |
| `SUBSTACK_STRIPE_WEBHOOK_SECRET` | This destination's `whsec_…`, added after destination creation; never reuse `STRIPE_WEBHOOK_SECRET` |
| `SUBSTACK_LINK_HMAC_SECRET` | Stable, securely generated random secret of at least 32 characters |
| `RESEND_API_KEY` | Resend sending-only API key, preferably restricted to the verified sender domain |
| `SUBSTACK_EMAIL_FROM` | A sender on the verified Resend domain, e.g. `UnoWord <verify@YOUR-VERIFIED-DOMAIN>` |
| `SUBSTACK_LINKING_ENABLED` | Keep `false` during setup; allows the owner-approved email-link flow when set to `true` |
| `SUBSTACK_STRIPE_LIVE_ACCESS_APPROVED` | **Keep `false` until explicit owner approval after testing** |
| `CRON_SECRET` | Existing 32+ character worker secret; also protects this integration's scheduled recovery endpoint |

An optional `SUBSTACK_STRIPE_SAMPLE_SUBSCRIPTION_ID=sub_…` selects a representative existing paid subscription for readiness checks if it is not in the first page. Otherwise the checker uses a matching subscription from the first page or a verified imported snapshot, then retrieves its current state.

Do not change native `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, native prices or `STRIPE_LIVE_BILLING_APPROVED` to configure Substack. Test and live Substack credentials/events are checked separately. When changing accounts/modes, disable the previous integration in Admin first; activation also disables other Substack account/mode configurations.

The HMAC secret protects email indexes, one-time-code hashes and encrypted pending email addresses. Keep it stable. Rotating it requires a controlled reconciliation/reverification of existing links; it must not be casually changed during deployment. No plaintext subscriber email or raw webhook body is persisted.

## 4. Inspect and import, without granting access

If the publication has no paid subscribers yet, use the separate
[sandbox rehearsal](substack-sandbox-testing.md). An empty eligible-subscriber
result is expected; do not change valid live price IDs just to manufacture a
match, or point sandbox notifications at the live-configured production route.

If production reports **Not configured**, expand **Backend settings received** in this admin page. It lists missing/invalid variable names and presence/format checks only; it never displays values. Confirm the values were saved to the UnoWord project serving `unoword.vercel.app`, targeted to Production and available to the backend, then redeploy. A format check is not a successful Stripe permission test.

Sign in to **Admin → Integrations → Substack**.

1. Select **Check Stripe connection**. This makes read-only permission probes, checks the account ID, explicit recurring prices/products and representative subscription fields. Missing configuration or permission produces a clear failed check. It never enables access.
2. Select **Import existing subscriptions**. Continue batches until complete. Only matching publication products are individually verified and stored. No UnoWord account is created and no verification email is sent.
3. Initial and subsequent imports only upsert individually verified records. Missing rows, an interrupted page or incomplete CSV never revoke access. Partial invoice/customer/subscription results produce a retryable verification error rather than replacing known evidence with an inactive grant.

## 5. Create the Stripe event destination

Exact production endpoint:

**`https://unoword.vercel.app/api/webhooks/substack-stripe`**

In the Substack account's Stripe Dashboard, open **Workbench → Webhooks / Event destinations → Add destination**. Select events from **this account** (not unrelated connected accounts or an organization-wide stream). Choose:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Use snapshot events for these v1 objects. Keep sandbox and live destinations, keys and signing secrets separate. Choose an API version supported by the account; the handler accepts the relevant older invoice `subscription` field and newer `parent.subscription_details.subscription` reference. Provider reads explicitly request `2026-09-30.endive`. The readiness report records the destination's actual API version(s); it does not pretend the Dashboard defaults are the same as the application's read version.

Copy the signing secret into **`SUBSTACK_STRIPE_WEBHOOK_SECRET`** in backend environment settings and redeploy. Do not put it in a URL, browser field or repository.

A disabled source may observe properly signed events without granting Pro. Before automatic **live** access is enabled, the owner must review this handoff, complete testing and explicitly approve activation. The code does not create/enable a live destination or grant live access on its own.

Use sandbox/synthetic records for lifecycle testing. For an actual connected-account signing/field check, the owner can resend an **existing** appropriate event in Workbench; that action does not create a charge or cancel a subscription. Do not create live payments for testing. An invented Stripe Dashboard/CLI fixture ID that does not resolve to a real subscription is not paid-subscription proof and must not grant access.

Run **Check Stripe connection** again after delivery. Readiness requires an eligible positive-paid sample, the exact destination and required event set, and a successfully processed event signed by the **currently configured secret** within the previous day. A copied secret alone is not enough.

## 6. Configure recovery

Schedule **GET `https://unoword.vercel.app/api/internal/substack-sync`** about every five minutes using the existing authenticated scheduler pattern. Send `Authorization: Bearer <CRON_SECRET>` as a secret header. Do not put the secret in the URL. If using an external scheduler, create a second job alongside `/api/internal/ingestion` rather than replacing the existing knowledge-processing job.

The endpoint resumes persisted event leases, retries queued work, refreshes the oldest linked subscription snapshots, and clears expired encrypted verification-email copies. Stripe receives an error while a durably queued event is still unresolved so it continues its own retries too. Admin controls can process/retry failed events and reconcile linked subscriptions manually. The worker updates a heartbeat; stale/error conditions remain visible through synchronization timestamps and failed-event status.

A session cannot process an event twice concurrently. A worker that loses its lease cannot commit. Processing retrieves the **current** subscription while holding a per-subscription database lease, so older webhook bodies do not restore stale access. No raw webhook body, card data or verification code is stored. Only minimal references, a payload digest and delivery state are retained.

## 7. Email ownership and linking

Enable linking only after Resend's sender/domain is verified and read permissions/imports are ready. `SUBSTACK_LINKING_ENABLED=true` can allow email verification and staged connections while live source access stays disabled.

Users open **Account/Settings → Subscription → Connect Substack**. Extension Settings and native Profile provide an entry point to the existing web account screen. The website uses existing Supabase sign-in; the Expo browser may require signing into that same account normally. Native tokens are never put in external URLs.

- The user enters the Stripe billing email associated with their Substack payment. It may differ from their UnoWord sign-in email.
- Resend delivers an eight-digit code, valid for ten minutes. Codes are bound to the authenticated account and request, hashed with a server secret, limited to five attempts, and consumed once. Distributed per-account and per-mailbox request limits prevent repeated sends.
- The server verifies current Stripe customer/subscription/payment evidence, then atomically links an eligible subscription. An email match or successful redirect never grants Pro.
- Failed provider verification can be retried during the verification window without resending the email. Canceling a pending verification does not disconnect an existing subscription.
- Email local-part case and plus/dot aliases are not rewritten; use the exact billing mailbox. Domain case is normalized. A Stripe customer email change requires fresh ownership verification; the old link cannot silently claim a different mailbox.
- Disconnect removes only this account's Substack eligibility. It does not cancel Stripe/Substack or remove native UnoWord access, writing, documents or history.

## 8. Eligibility and limitations

Access requires a current `active` or `past_due` subscription, a matching positive-priced recurring item, the verified customer email, and positive paid-invoice line evidence for that subscription/price. The paid-through boundary is clipped to the verified item period and any scheduled cancellation boundary.

- A scheduled period-end cancellation keeps access until the verified paid-through date.
- `past_due` keeps only time already covered by verified payment; there is **no invented extra grace period**. A failed invoice alone is not a revocation instruction.
- Expired, canceled, unpaid, paused/incomplete subscriptions and zero-payment trials/complimentary invoices do not qualify. A missing required field or incomplete history fails verification; it does not fabricate an indefinite period.
- External eligibility expires in trusted SQL at the paid-through date even if no webhook arrives. Native Monthly/Lifetime remains independently valid. Already assigned allowances and user data are never reset.
- Product/price association with the publication must be explicitly reviewed by the owner. Stripe has no universal guaranteed `is_substack_publication` field. Names/email matches are never automatically treated as that proof.
- Legacy/tiered plans without supported positive recurring price/period fields, gifts, complimentary access, app-store purchases, migrated/off-Stripe payments and records not exposed by the connected account may need separate authoritative evidence. Do not market them as automatically supported.
- Paid-through evidence describes invoice payment and subscription status. Standalone refund/credit/dispute rules beyond the requested five subscription/invoice events require an explicit additional policy/integration; do not assume an arbitrary refund cancels a still-active Substack subscription.
- A bounded invoice-history lookup refuses an incomplete result if it cannot establish paid coverage. Stripe API failures retain last verified data through its existing expiry; another source is never revoked.

### CSV fallback

Upload up to 500 rows / 512 KB using the canonical template:

```csv
email,stripe_subscription_id,paid_through,status
subscriber@example.com,sub_example,2027-01-01T00:00:00Z,paid
```

`email` is required. Other columns are optional. Map differently named columns from the official Substack export to this template. Dates must include an explicit timezone.

CSV rows are encrypted/staged as **needs verification**. **Verify with Stripe** checks the referenced subscription or searches the verified email and stores authoritative provider evidence if available. The subscriber still must prove email ownership and link their UnoWord account. CSV dates/status are never used to grant access directly. Off-Stripe entries remain for manual review rather than being treated as paid Stripe subscriptions. A reliable signed Substack authority or an explicitly designed manual-grant policy is needed to extend automatic support to those types; this implementation does not invent one or silently enable a CSV bypass.

## 9. Approve live access — final owner action

After reviewing executed tests and the actual-account readiness report:

1. Give **explicit approval** for live Substack entitlement changes.
2. In backend secure environment settings set `SUBSTACK_STRIPE_LIVE_ACCESS_APPROVED=true`, with `SUBSTACK_LINKING_ENABLED=true`; redeploy.
3. In Admin → Integrations → Substack, confirm the source access change and select **Enable verified access**. The server repeats readiness and requires a fresh successful report; client flags cannot bypass it.
4. Verify a consenting paid reader's existing subscription link. Confirm Pro in web/editor/extension/native after account refresh, without purchasing anything.

The database activation switch is authoritative for RLS and workers. For an emergency stop, use **Disable Substack access** in Admin before rotating/removing configuration or withdrawing approval. That operation affects only this source. Keep native UnoWord billing flags unchanged.

## Verification performed

Tests and final execution counts are recorded in the implementation PR. New suites:

- `backend/tests/test_substack.py`: mocked, read-only Stripe boundary and Resend fixtures; no external emails/payments. Covers payment status/paid-through rules, both invoice layouts, scope/mode checks, permissions, readiness/approval, different verified/login emails, signature/raw-body/age validation, duplicate/out-of-order delivery, retry recovery, ownership/CSRF, CSV staging and native Lifetime preservation.
- `tests/substack.sql.test.cjs`: real PostgreSQL/RLS in PGlite with existing migrations. Covers independent grants, active-Free-row precedence, activation, code consumption/attempts/expiry, unique ownership, effective editor/AI/ingestion access, native Lifetime protection, disconnect/expiry, fenced durable events, policy changes and migration replay.
- `tests/substack.browser.cjs`: production web bundle with explicitly synthetic HTTP/mail fixtures. Covers the user flow and provider-error recovery, different emails, immediate account refresh, private owner switching, cancellation vs disconnect, native Lifetime retention, responsive layouts, accessibility, admin activation gating, CSV staging and Spanish admin copy.

No actual Substack Stripe permission, paid-record format, live webhook delivery or Resend deliverability result is claimed while those separate credentials are absent. No live entitlement activation, charge, cancellation or real verification-email send is part of development testing.

### Executed checks for this implementation

- **259 backend tests passed**, including 43 dedicated Substack boundary tests and existing billing/Lifetime, rewards, workspace, quota, origin/security and processing regressions.
- **Real PostgreSQL/RLS integration passed** with the existing migrations and the new migration, including native Monthly/Lifetime independence, active-Free-row precedence, source gating, one-time proof/attempts/expiry, owner uniqueness, editor/AI/ingestion access, durable event leases, signing-secret rotation receipts, disconnect/expiration, policy changes and repeat application.
- **Production-bundle Substack browser tests passed** with explicitly synthetic HTTP/mail fixtures at 1440/768/320px, reduced motion and axe WCAG A/AA checks. Invalid codes, verified-proof recovery without another email, immediate Pro/account refresh, cancel-vs-disconnect, Lifetime preservation, account switching, CSV staging and live-activation blocking passed.
- Existing production-editor browser regression passed for authentication isolation, autosave/reopen, formatting, counts, library/folders/trash, conflicts, coaching restrictions, import/export, focus/themes, offline recovery, Free restrictions and Pro/Lifetime access.
- **34 extension unit tests** and the real popup/worker browser test passed, including the Substack account-screen entry point. Extension package **0.22.0** was rebuilt.
- Native TypeScript, **24 native/core tests**, and Expo iOS export passed. No physical iPhone/iPad linking interaction is claimed.
- Frontend production build/prerender and lint passed. Four existing UI/admin lint warnings and the existing SSR dynamic-import/Starlette-httpx warnings remain.

Reproduce after installing the project's existing dependencies:

```sh
python -m pytest backend/tests/test_substack.py backend/tests/test_billing.py backend/tests/test_lifetime.py backend/tests/test_rewards.py backend/tests/test_progress_permissions.py backend/tests/test_workspace.py backend/tests/test_workspace_ai.py backend/tests/test_ai_quota.py backend/tests/test_browser_security.py backend/tests/test_source_processing.py
node --test tests/substack.sql.test.cjs
node --test extension/tests/*.test.js
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile test
npm --prefix apps/mobile run export:ios
yarn --cwd frontend build
yarn --cwd frontend lint
```

Start the frontend preview on port 4186, then run `tests/substack.browser.cjs`, `tests/writing-workspace.browser.cjs`, and `extension/tests/rewards.browser.cjs`. The test scripts accept the existing `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `PGLITE_ROOT`, `WRITING_TEST_ORIGIN`, `AXE_SCRIPT` and screenshot-directory overrides. Screenshots are local synthetic fixtures, not real subscriber data.
