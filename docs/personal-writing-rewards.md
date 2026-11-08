# Personal writing rewards

Rewards are private, optional recognition of a writer's own practice. There are no points, prizes, comparisons, rankings, public profiles, leaderboards, or AI requests.

## Rollout

1. Apply `supabase/migrations/20261104010000_personal_writing_rewards.sql` in the **existing UnoWord Supabase project's SQL Editor**. It requires the existing writing-workspace, verified-streak, document-completion, and unified-account-sync migrations. Run the entire file once; it is transactional and safe to rerun.
2. Deploy this application branch after the migration succeeds. No new secret, Stripe setting, cron service, or billing change is required. Until the schema exists, new rewards panels show an unavailable message and normal writing continues.
3. Sign in as an administrator, open **Achievements**, and select **Backfill verified history (25 accounts)**. Continue the batches until the page says complete. A batch uses a cursor; restarting the page starts a fresh, idempotent scan. Run subsequent batches sequentially, not in several admin tabs.
4. Verify `/rewards` with a Free and a paid test account. Check Settings → Rewards & Achievements, then open the same account on another device. Existing users also receive a quiet historical evaluation automatically on their first rewards read.
5. Install the refreshed downloadable extension, version **0.21.0**. The iOS changes are included in the existing Expo application; they require no additional native dependency.

The migration adds evidence tables and functions, enables and forces RLS, and removes direct anon/authenticated access. Its `DROP TRIGGER IF EXISTS` statements only replace the newly named rewards triggers; it does not delete writing, replace subscriptions, or reset streaks. Supabase's generic SQL warning about trigger replacement is expected. Every new table enables RLS immediately. Never remove RLS to get the migration to run.

## Interfaces

- Web: `/rewards`, an account dashboard widget, account settings, and editor welcome/settings panels.
- Extension: next milestone in Write, rewards toggles in Settings, and a link to the full private dashboard.
- iOS: a native Rewards route, Home milestone widget, Profile settings, private showcase, achievement categories and personal journey. It consumes the same definitions and summaries as web.
- Admin: bilingual definitions, enabled state, thresholds, validated raster badge uploads, aggregate unlock counts and bounded historical backfill. It exposes no user writing or individual achievement lists.

All three clients refresh every 15 seconds while available, and web/extension reconnect or focus refreshes reconcile changes. Native uses the existing app connection/query lifecycle. This is polling with recovery, not a new Realtime dependency. Nothing in rewards writes a writing activity record or starts a session.

## Trusted data and rules

`GET /api/rewards` authenticates the account and resolves current paid entitlement using existing subscription verification. The caller cannot select another account, submit a total, claim paid status, or award itself a badge. Service-only SQL reads the existing account ledger:

| Metric | Evidence |
| --- | --- |
| Lifetime words | Existing `writing_daily_activity`, typed words only; pasted text excluded |
| Active time | Existing `writing_account_time_ranges` union; overlaps count once, paused/idle gaps excluded, no abandoned timer extrapolation |
| Sessions | Distinct positive-typed-word records with definitive `timer.status = ended`; pause/resume updates the same record |
| Streaks | Existing actual and historical streak functions; historical unlocks survive a later missed day |
| Goal days | Unique reporting-day targets captured before/during writing; targets cannot be lowered after writing to create an award |
| Completed documents | First verified completion of each distinct document ID; re-completing or deleting it does not erase that evidence |

The 53 definitions contain 10 word, 9 streak, 7 goal, 7 session, 9 time, 6 document, and 5 personal-growth achievements. English and Spanish descriptions are server-owned. Bronze, Silver, Gold, Platinum and Diamond are visual tiers only. Shared TypeScript presentation helpers format active time in hours rather than presenting a raw seconds quota.

Settings use optimistic concurrency (a revision), preventing a stale device from silently overwriting a newer preference. Showcase selections must be earned and have at most three distinct IDs. Conflicts refresh the saved setting and ask the user to retry. Rewards are not edited offline: normal offline writing remains available, and rewards reconcile when its activity uploads.

Disabling rewards hides badges, progress, dashboard navigation and celebrations. It preserves earned rows and normal tracking. Trusted evaluation continues recognizing verified evidence quietly; re-enabling restores earned badges without replaying a notification queue. None of the toggles modifies existing writing preferences, words, documents, or streak calculation.

Free responses omit document achievements and streak milestones beyond seven days. They cap the current displayed streak, not actual history. Pro Monthly and Lifetime use identical paid visibility. Paid awards remain stored through downgrade and are available after verified re-upgrade; premium showcase selections are hidden without deleting the saved selections. Direct REST cannot bypass these filters because reward tables and RPCs are service-only.

## Historical evidence and personal growth

- Existing retained writing history is evaluated quietly; cumulative badges do not require starting over. Award rows are unique by account and achievement. `achieved_on` records the reporting date when it can be reconstructed; `awarded_at` is when trusted evaluation persisted the badge.
- Older daily goals with no captured target are **not invented**. Launch captures the current known target for today's existing activity. Offline uploads can complete an earlier day only if its target was already captured; missing offline goal snapshots are not guessed. Timezone changes cannot award two overlapping reporting days for the same writing.
- Old sessions lacking a definitive ended timer are excluded from session-completion badges. They still contribute to ordinary metrics under existing tracking rules.
- Before launch, only documents still marked completed with a saved completion timestamp can be backfilled. Older completions that were already reopened are not reconstructable. After launch, durable completion evidence prevents repeat counting.
- Personal bests compare qualifying daily totals with earlier retained recorded days. The first day has no earlier baseline. One milestone per reporting day stores the greatest verified value and earlier best. Clearing history does not revoke previously earned badges; descriptions explicitly refer to recorded history.
- Monthly growth compares the **last two fully completed months**, using the account timezone. Both must be covered by observation since rollout (or the latest history clear). Partial months or missing observation never earn comparison badges. Completed-session comparisons exclude active/paused sessions. First observation begins at launch for existing accounts and the first rewards evaluation for new accounts.
- A New Chapter recognizes writing after at least 14 intervening days without **recorded** writing. It makes no claim about activity outside UnoWord's recorded history.
- Steady Progress uses captured qualifying goal days in four distinct local calendar weeks. It does not require consecutive weeks or penalize breaks.

## Celebrations and admin changes

A service-only claim serializes on the account, acknowledges the pending batch, and returns one badge. A second device cannot claim it again. Claims are blocked while any recently checkpointed account session is active, and at most one batch appears per five minutes. Initial history, disabled periods, re-enabling and premium history exposed on upgrade are quiet. Web celebrations dismiss automatically after ten seconds or through the close button, support reduced motion, and appear outside the active editor. Native/extension notices are small and dismissible.

Claim-before-display gives **at-most-once delivery**: closing a device after the claim may mean a toast is never seen. The badge stays on the dashboard. This trades guaranteed notification delivery for avoiding duplicate/interruption floods.

Admin edits use definition revisions. Stable IDs and awarded requirement snapshots preserve earned badges when requirements increase or a definition is disabled. Disabling prevents new unlocks but preserves earned display. Lowering an enabled threshold can recognize new eligible accounts on the next evaluation. Update descriptions alongside thresholds so the prose stays accurate. Artwork is re-encoded and restricted to small PNG/JPEG/WebP data images; SVG, remote tracking URLs and arbitrary HTML are rejected.

Backfill/evaluation is lazy and bounded, rather than a large launch-time rewrite or new scheduler. Unlock dates for growth rules without an exact reconstructable threshold-crossing date reflect verification date; no exact historical timestamp is invented. A milestone reached and then explicitly erased from writing history before its first evaluation may no longer be provable.

## Verification

See the completion report in the pull request for commands and results. New tests use isolated real PostgreSQL through PGlite and browser HTTP fixtures; they never modify production users, charge Stripe, or invoke AI. Physical iPhone/iPad interaction and live Supabase rollout must be checked after applying the migration. An iOS export/typecheck is not a physical-device test.

Executed validation on this branch:

- Frontend production/SSR/prerender build and TypeScript checks passed. Lint passed with four existing warnings in shared UI/admin code; no new rewards warnings.
- 110 isolated backend tests passed across rewards, account permissions, workspace, coaching quota, browser security and public mobile bootstrap. The existing Starlette/httpx deprecation warning remains.
- 34 extension unit tests passed; the real popup/worker rewards browser test passed at 320px and 420px.
- Real PostgreSQL/RLS reward integration passed: 53 definitions, verified counters, quiet/idempotent unlocks, interval overlap/pause handling, paid filtering, historical streak retention, CAS preferences, showcase restrictions, saved target rules, distinct completions, completed-month comparisons, record-history deduplication, timezone overlap, DST day length, batch backfill, migration reapplication and direct-client denial.
- Two-browser rewards tests passed against the production bundle and real PostgreSQL: synchronized disable/re-enable, retained favorite, account isolation, Free/paid restoration, English/Spanish, reduced motion, 1440/768/320px layouts, no horizontal scroll and axe WCAG A/AA checks. Admin threshold changes, raster upload and bounded backfill also passed.
- Existing two-browser editor/account-sync regression passed with the new migration installed (20 + 10 active minutes across devices, pause exclusion, completion sync, Free isolation). Existing full production-editor browser regression passed for autosave, formatting, library/folders/trash, offline recovery, conflicts, coaching restrictions, import/export and paid access.
- Native TypeScript and 24 core/shared-presentation tests passed. Expo iOS export completed. Physical-device reward interaction has not been tested.

Reproduce from the repository root after installing existing project/test dependencies:

```sh
node --test tests/rewards.sql.test.cjs
node --test extension/tests/*.test.js
python -m pytest backend/tests/test_rewards.py backend/tests/test_progress_permissions.py backend/tests/test_workspace.py backend/tests/test_workspace_ai.py backend/tests/test_ai_quota.py backend/tests/test_browser_security.py backend/tests/test_mobile_config.py
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile test
npm --prefix apps/mobile run export:ios
yarn --cwd frontend build
yarn --cwd frontend lint
```

For browser checks, start `yarn --cwd frontend preview --host 127.0.0.1 --port 4186 --strictPort`, then run the following in another terminal. Use `PGLITE_ROOT`, `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, or `AXE_MODULE` overrides if tools live outside `tests/node_modules` or Chromium is elsewhere.

```sh
WRITING_TEST_ORIGIN=http://127.0.0.1:4186 AXE_MODULE=tests/node_modules/axe-core/axe.min.js node tests/rewards.browser.cjs
node extension/tests/rewards.browser.cjs
WRITING_TEST_ORIGIN=http://127.0.0.1:4186 node tests/account-writing-sync.browser.cjs
WRITING_TEST_ORIGIN=http://127.0.0.1:4186 node tests/writing-workspace.browser.cjs
```

Screenshots are generated in ignored `tests/artifacts/rewards`, or the `WRITING_SCREENSHOTS` directory you configure. Initial implementation validation preceded the production rollout recorded below.


## Production rollout — November 4, 2026

- The owner applied the SQL migration; a subsequent service-only schema check confirmed all 53 definitions. Anonymous direct reads of every new rewards table were denied.
- PR #10 was merged as `64a7df9`, and the production deployment succeeded at the historical hostname https://unoword.vercel.app. The current canonical rewards URL is https://unoword.app/rewards (sign-in required).
- Bounded historical backfill completed in two batches for 31 existing accounts, persisting 13 verified awards quietly. No writing history, subscriptions, prices, or AI allowances were changed.
- Production API smoke checks passed on both existing paid QA accounts: 53 definitions, owner-bound summaries, English/Spanish localization, private/no-store caching, repeated-read consistency, quiet historical claims, stale-owner rejection and fabricated-total rejection.
- A disposable Free account received 41 eligible definitions. Document achievements and streak thresholds beyond seven days were absent. Authenticated direct reward-table access, paid editor access and admin access were denied. The disposable account was deleted afterward.
- Existing admin sign-in and the live 53-definition admin catalog passed. No definition or entitlement was changed during these production checks.
- Real production Chromium checks passed for the paid dashboard, 1440/768/320px layouts without horizontal scrolling, axe WCAG A/AA checks, automatic preference synchronization between two browsers, quiet restoration after re-enabling, and loading the existing editor. There were no browser JavaScript errors; original QA settings were restored. Screenshots were captured locally.
- Production extension download 0.21.0 includes the rewards module and matches its published ZIP checksum. Existing unpacked extension installations need to update/reload this package to receive the new controls.
- Temporary QA sessions were ended and the private browser authentication file was removed. No AI generation or payment operation was invoked. Physical iPad/iPhone rewards interaction remains untested; the existing native export/typecheck results above still apply.
