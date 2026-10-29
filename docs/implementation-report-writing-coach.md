# UnoWord writing coach, plans, streaks, and marketing delivery

Implemented in the existing project. Production deployment is held until the two database migrations are applied. Stripe remains sandbox/test; no live campaigns or prices/products were changed.

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

## Screenshots and preview

Captured local, fixture-backed desktop/mobile screenshots are available in the current workspace:

- `/workspace/.onboarding/unoword/coach-plans/landing-1440.png`
- `/workspace/.onboarding/unoword/coach-plans/landing-390.png`

The tracked `frontend/public/brand/social-card.svg` and `.png` provide the updated 1200×630 sharing preview. To reproduce the site locally, build and preview `frontend`; run the browser tests with Playwright/Chromium and axe-core installed from the existing test dependencies. Tests do not authenticate against production.

## Required owner action before deployment

In Supabase → SQL Editor → New query, run these files **in order**, one at a time:

1. [Writing coach allowances](../supabase/migrations/20261028030000_writing_coach_allowances.sql)
2. [Verified streak presentation](../supabase/migrations/20261028040000_verified_streak_presentation.sql)

Both are transactional and repeatable. Earlier project migrations must already be applied. No new secret is required. The workspace's configured database host is IPv6-only/unreachable here, and the supplied pooler credentials also could not connect, so live DDL could not be applied from this environment.

After both succeed, merge/deploy the reviewed build, run live smoke checks, and update/reload the extension to 0.18.0 (adds the Chrome alarms permission for reliable queued retries). Existing unassigned local history needs the explicit **Sync this device’s writing history** action. Any activity already missing from both the old bounded local cache and cloud cannot be reconstructed; no days are invented. Live billing stays off without separate owner approval. No new Meta pixel or campaign was installed; no existing tracked frontend Meta pixel was found.

Live migration/deployment/model-generation validation for this build is **pending**. Isolated passing tests do not prove that production has received the changes.

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
