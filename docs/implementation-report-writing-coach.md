# UnoWord writing coach, plans, streaks, and marketing delivery

Merged in [PR #4](https://github.com/felipeoracio/unoword/pull/4) and deployed to [unoword.vercel.app](https://unoword.vercel.app/). The owner applied the database migrations; live schema and permission checks passed. Vercel confirmed production deployments for merge `a338d03` and coaching reliability follow-up `ce0a717`. No Stripe mode, prices/products, subscriber terms, or live campaigns were changed.

## Delivered behavior

- AI text improvement, replacements, and insertion controls removed; **Help Me Continue** offers AI Writing Guidance. All author-facing calls share the coaching policy and reject obvious prose/replacement output.
- New Monthly Pro and Lifetime accounts share 10 suggestions/day, 200/calendar month, and 30 guidance/calendar month. Atomic, versioned server quotas cover the extension and editor, with retry replay and failure release. Existing protected subscribers and pre-update Checkout quotes keep their applicable allowances.
- Admin AI Management includes preview/save/future publication, historical configurations/audit, model pricing, warning thresholds, and content-free cost monitoring. The $2 target is monitoring, not an allowance reduction.
- The latest requested matrix is enforced: Free tracks supported writing, goals, basic statistics, non-AI prompts, and up to seven visible streak days. Editor, formatting, library/folders, personalized profile, AI, full streak visibility/history, and premium milestones require verified Pro or Lifetime.
- Activity continues beyond Day 7. A single trusted server calculation preserves the existing typed-word/calendar-day rule; only presentation caps Free results. Upgrades/downgrades do not rewrite history. Past earned milestones remain derivable after a current streak breaks.
- Extension 0.18.0 synchronizes metadata only, with durable offline queues, revision-safe acknowledgement, deterministic session IDs, explicit adoption of older unassigned history, account isolation, and writer-local midnight rollover. It consumes the filtered server streak. No draft text is sent by progress sync.
- Downgrades retain documents and offline drafts. A read-only, owner-scoped recovery path downloads existing cloud documents without restoring editor permissions.
- Landing page updated with **Your Words. Your Voice. Your Story.**, coaching philosophy, Free/Pro/Lifetime cards, a responsive 16-row comparison, factual streak copy, paid feature labels, FAQ, SEO and a matching social card. Public demos never call AI. Social ad copy/creative specifications are prepared, not published.

The [architecture and complete permission matrix](writing-coach-plans-and-streaks.md) explain the three streak layers and grandfathering. The [four campaign briefs](../marketing/paid-social-briefs.md) include feed, square and Stories/Reels specifications. The social-sharing PNG/SVG are actual created assets; advertising image production is not claimed.

## Verification actually performed

- **366 selected backend regression cases passed**, covering coach policy, removed actions, personalization, goals, quotas/idempotency/failures, Pro permissions, recovery ownership/export formats, Stripe/Lifetime test boundaries, authentication/security, source processing, and onboarding. These are isolated selected suites; potentially mutating legacy live suites were not run.
- **28 top-level Node extension tests passed**, including the existing word-count/history/date engines and new metadata/offline-cache boundaries.
- Actual service-worker integration passed for explicit historical adoption, a 15-day Free=7 / Pro=15 display, downgrade preservation, offline queue/reconnect, deduplication, acknowledgement, account switching, and midnight rollover without duplicated words.
- Two in-memory real-Postgres (PGlite) harnesses passed: migrations/reapply, protected versions and rollout quotes, concurrency and daily/monthly/guidance limits, exact published token rates, atomic rollback, idempotent replay and leases, RLS/private functions, streak Days 1/7/8/15/20/25, missed-day history/milestones, upgrade/downgrade/re-upgrade, DST/timezone parity, and explicit-clear tombstones.
- Six production-bundle browser suites passed: writing workspace, landing page, Lifetime purchase/refund UI, admin AI Management, extension progress, and extension suggestion modes. They cover real UI/worker code using synthetic HTTP fixtures; they did not charge cards or change real accounts.
- Responsive layouts checked from **320 to 1440px**, plus existing Lifetime viewport cases. Landing, editor, and Lifetime accessibility checks passed; keyboard navigation, consent, CTAs, auth redirects, sold-out/error states, offline edits/conflicts, and preserved drafts were exercised.
- Production build, TypeScript, branding guard and lint passed. Lint reports four pre-existing warnings; existing bundle-size/SSR build warnings remain. Python compilation and whitespace checks pass.
- Extension ZIP version **0.18.0**, SHA-256, every distributable source file, secret/test exclusions, and built public ZIP were verified.
- **32 focused backend checks passed after the live-test follow-up**, including two new cases for rejected coaching responses: one bounded retry shares a single reservation/credit, each model call retains cost telemetry, and a second rejection saves nothing and releases the credit. Diagnostics exclude private generated text. The editor prompt now explicitly uses its multi-item contract and short coaching labels.

## Production verification after the migrations

These checks used real production HTTP, Supabase, model calls, and Chromium, with dedicated QA accounts and temporary fictional documents/activity. They are separate from the isolated regression suites above.

- Confirmed all required Lifetime and AI allowance tables and streak functions exist. Published defaults are **10 suggestions/day, 200/calendar month, and 30 Writing Guidance requests/calendar month**. An existing QA subscriber retained its protected shared allowance.
- Anonymous and authenticated browser roles were denied direct reads of all seven private AI management tables. Signed-out admin, editor, usage and streak endpoints require authentication.
- A temporary Free account was denied editor configuration, document/folder management, personalized profile, AI usage, and premium history. Owner-only read-only recovery/export remained available for a seeded historical document; another account could not export a Pro document.
- Synced 15 fictional qualifying days for Free and Pro accounts and repeated the identical batch: exactly 15 rows remained per account. Free displayed seven days without full-streak/history fields; Pro displayed the actual qualifying streak. Folder creation, document save/reopen, save replay and activity sequence updates passed without duplicate records.
- Four successful real AI requests covered editor guidance, three personalized directions in one generation, optional guidance after goal completion, and an extension-style suggestion. Targets followed 250, zero, and 100 remaining words. Exactly four credits were used; replaying an identical completed request used none. Guidance/suggestion monthly counters increased by two each. Consent and removed rewrite actions were enforced, with actual model cost records retained.
- An initial live editor response failed the coaching/output boundary without charging a credit. Follow-up `ce0a717` added explicit output instructions, safe diagnostics and one guarded retry; subsequent live coaching checks passed. This does not promise that model/provider failures can never occur.
- Live Chromium checks passed for the landing page and editor at **1440, 768, 390 and 320px**, with no horizontal overflow, JavaScript exceptions or automatic AI calls. All three pricing plans and the protected usage display rendered correctly.
- A temporary document was edited offline, reopened after an offline page reload, then synchronized successfully after reconnecting; its cloud text matched. The first browser attempt was blocked by this execution environment's HTTPS proxy certificate when registering the service worker. Allowing that proxy certificate in the test browser resolved the test-environment issue; application TLS/security settings were unchanged.
- Public extension **0.18.0** downloaded successfully and matched the published SHA-256.

Temporary accounts, folders, documents, synthetic activity, and generated QA suggestions/response caches were removed. Existing users, documents and entitlements were preserved. Real AI usage and model-cost history were retained. No checkout, payment, quota reset, administrator publication or advertising publication was performed. Authenticated administrator publishing and a new Stripe purchase were not exercised in this production smoke check.

## Screenshots and preview

Captured local, fixture-backed desktop/mobile screenshots are available in the current workspace:

- `/workspace/.onboarding/unoword/coach-plans/landing-1440.png`
- `/workspace/.onboarding/unoword/coach-plans/landing-390.png`

Additional screenshots captured from the deployed production site:

- `/workspace/.onboarding/unoword/coach-plans/production-landing-1440.png`
- `/workspace/.onboarding/unoword/coach-plans/production-landing-390.png`

The tracked `frontend/public/brand/social-card.svg` and `.png` provide the updated 1200×630 sharing preview. To reproduce the site locally, build and preview `frontend`; run the browser tests with Playwright/Chromium and axe-core installed from the existing test dependencies. Those repository browser suites use isolated fixtures; the production smoke checks described above were run separately.

## Applied migrations and extension update

The owner applied the following setup in Supabase, and the resulting schema was verified against the app's configured database:

1. [Lifetime offer prerequisite](../supabase/migrations/20261026010000_lifetime_offer.sql)
2. [Writing coach allowances](../supabase/migrations/20261028030000_writing_coach_allowances.sql)
3. [Verified streak presentation](../supabase/migrations/20261028040000_verified_streak_presentation.sql)

The migrations are transactional and repeatable. On another database, core AI/editor/quota migrations and monthly Stripe setup must already be applied. The allowance migration also tolerates absent billing modules without creating incomplete placeholder tables; missing modules need their real setup before their checkout can work. No new secret is required. Direct PostgreSQL connections from this workspace were unavailable, so the owner applied SQL and live verification used Supabase REST/RPC plus the deployed APIs.

The remaining user action is to update/reload the extension to **0.18.0** (adds the Chrome alarms permission for reliable queued retries). Existing unassigned local history needs the explicit **Sync this device’s writing history** action. Any activity already missing from both the old bounded local cache and cloud cannot be reconstructed; no days are invented. Live billing still requires separate owner approval. No new Meta pixel or campaign was installed; no existing tracked frontend Meta pixel was found.

## Files modified

- `README.md`
- `backend/lib/ai_provider.py`
- `backend/lib/ai_quota.py`
- `backend/lib/billing.py`
- `backend/lib/coach_policy.py`
- `backend/lib/embeddings.py`
- `backend/lib/lifetime.py`
- `backend/lib/plans.py`
- `backend/lib/prompts.py`
- `backend/lib/source_processing.py`
- `backend/lib/workspace_ai.py`
- `backend/models/ai.py`
- `backend/models/auth.py`
- `backend/routers/ai.py`
- `backend/routers/ai_management.py`
- `backend/routers/auth.py`
- `backend/routers/product.py`
- `backend/routers/progress.py`
- `backend/routers/workspace.py`
- `backend/server.py`
- `backend/tests/conftest.py`
- `backend/tests/test_ai_quota.py`
- `backend/tests/test_billing.py`
- `backend/tests/test_coach_policy.py`
- `backend/tests/test_lifetime.py`
- `backend/tests/test_product.py`
- `backend/tests/test_profile_personalization.py`
- `backend/tests/test_progress_permissions.py`
- `backend/tests/test_suggestion_breadth.py`
- `backend/tests/test_suggestion_modes.py`
- `backend/tests/test_workspace.py`
- `backend/tests/test_workspace_ai.py`
- `docs/account-security-and-profiles.md`
- `docs/goal-based-suggestions.md`
- `docs/implementation-report-writing-coach.md`
- `docs/landing-redesign.md`
- `docs/lifetime-offer.md`
- `docs/pro-writing-workspace.md`
- `docs/shared-ai-usage.md`
- `docs/stripe-billing.md`
- `docs/writing-coach-plans-and-streaks.md`
- `docs/writing-workspace.md`
- `extension/background.js`
- `extension/content.js`
- `extension/manifest.json`
- `extension/popup/popup.html`
- `extension/popup/popup.js`
- `extension/shared/cloud-progress.js`
- `extension/shared/i18n.js`
- `extension/tests/cloud-progress.test.js`
- `extension/tests/cloud-sync.integration.cjs`
- `extension/tests/progress.browser.cjs`
- `extension/tests/suggestion-modes.browser.cjs`
- `frontend/index.html`
- `frontend/public/brand/social-card.png`
- `frontend/public/brand/social-card.svg`
- `frontend/public/downloads/release.json`
- `frontend/public/downloads/unoword-extension.zip`
- `frontend/scripts/render-social-card.cjs`
- `frontend/src/admin/AIManagement.tsx`
- `frontend/src/admin/AdminDashboard.tsx`
- `frontend/src/admin/i18n.ts`
- `frontend/src/components/AIUsage.tsx`
- `frontend/src/components/PageMetadata.tsx`
- `frontend/src/components/WritingRecovery.tsx`
- `frontend/src/components/WritingStreak.tsx`
- `frontend/src/components/marketing/LifetimeAccount.tsx`
- `frontend/src/components/marketing/ProductPreview.tsx`
- `frontend/src/index.css`
- `frontend/src/lib/auth-types.ts`
- `frontend/src/lib/lifetime.ts`
- `frontend/src/lib/product.ts`
- `frontend/src/lib/use-ai-usage.ts`
- `frontend/src/lib/use-writing-streak.ts`
- `frontend/src/lib/writing.ts`
- `frontend/src/pages/Account.tsx`
- `frontend/src/pages/Home.tsx`
- `frontend/src/pages/Information.tsx`
- `frontend/src/pages/Lifetime.tsx`
- `frontend/src/pages/WritingEditor.tsx`
- `frontend/src/styles/landing.css`
- `marketing/paid-social-briefs.md`
- `supabase/migrations/20261028030000_writing_coach_allowances.sql`
- `supabase/migrations/20261028040000_verified_streak_presentation.sql`
- `supabase/tests/writing-coach.cjs`
- `supabase/tests/writing-streak.cjs`
- `tests/ai-management.browser.cjs`
- `tests/landing.browser.cjs`
- `tests/lifetime.browser.cjs`
- `tests/writing-workspace.browser.cjs`
