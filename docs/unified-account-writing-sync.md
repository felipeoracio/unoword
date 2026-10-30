# Unified account writing synchronization

Implemented on `feat/unified-account-writing-sync`. Database migration must be
applied before deploying this branch. This report does not claim production
verification before that deployment.

## Confirmed root cause

The editor already persisted `writing_activity.duration_seconds` and timer
snapshots. The extension imported editor word counts into its history, but its
main time card read `wc_state` / `lastResult` through `WCSessionClock.forSession`.
That is the extension's own session, so an editor-only writer saw zero. There
was no account-wide time aggregator. Historical statistics were also calculated
from a device's bounded local history, and goals/timezones were device settings.
The editor fetched remote documents during startup but did not periodically
refresh the library after startup.

## Metrics and authority

- **Session Time:** active duration for one stable session identifier. Pause,
  resume, refresh and End keep that identifier. Session history keeps individual
  durations; other devices' open sessions are returned separately and are not
  automatically resumed by an editor on a different device.
- **Today’s Writing Time:** the union of persisted active intervals intersected
  with the account's reporting day. Editor and extension activity both contribute.
  Paused gaps and overlapping intervals are counted zero extra times.
- **Total Writing Time:** the union of the same intervals across recorded history,
  independent of the selected reporting day or device history window.

Supabase's existing owner-scoped `writing_activity` ledger remains authoritative.
No new activity table, counter database or billing system is introduced.
`active_intervals` stores ordered, nonoverlapping `[start_ms,end_ms]` pairs on the
existing session row. `device_id` identifies the writing client, never the user.
Client clocks checkpoint exact spans; session ID + increasing sequence makes
snapshot retry/replay idempotent. Total durations are calculated in PostgreSQL,
not by summing local UI timers. An interval shared by two sessions counts once
for the account; each session retains its own full duration.

`writing_account_time_ranges` performs the interval union. It supplies both
`writing_account_summary` and `writing_daily_activity`; history and range charts
use the latter. Reporting-day boundaries are local midnights converted to UTC,
so daylight-saving days can be 23 or 25 hours. Typed words retain the existing
per-calendar-day session rollover rule; pasted words do not count. Streak
qualification remains at least one typed word per day. Stored history and actual
streak calculations are never capped by subscription.

The Free streak presentation remains capped at seven. Paid history, milestones,
editor, documents and folders keep their existing verified Pro boundary. Monthly
and Lifetime use the same entitlement check; prices and billing are unchanged.

## Qualifying time and checkpoints

Running sessions retain the existing explicit Start/Pause/Resume/End behavior.
Five minutes without qualifying input automatically pauses new clients. This is
a five-minute activity grace window, not a claim that every second represents a
keystroke. The editor checkpoints every ten seconds; the extension checkpoints
on state changes, open-view refreshes, and its one-minute background alarm.
Paused intervals do not advance active time. A stale editor checkpoint restored
after more than 90 seconds resumes as paused at its saved checkpoint, excluding
the closed-browser gap. Backend totals never extrapolate an abandoned timer into
unobserved overnight writing. Active, unfinished sessions contribute as soon as
their checkpoints are saved; End is not required.

Under normal connectivity expect approximately 30 seconds for an editor
checkpoint to appear in another visible interface. An extension session with
its popup closed can require about 90 seconds because its durable background
alarm runs once a minute. Browser throttling, suspension, offline devices and
network errors can delay this; local activity survives reconnection. Account
summaries display saved, confirmed time rather than a speculative ticking total.
The individual session timer still updates locally each second.

## Shared endpoints and synchronization

Authenticated endpoints:

- `GET /api/progress/summary`: current account totals, reporting date/timezone,
  goal/progress, capped streak, daily session checkpoints and separate open
  sessions. Optional historical reporting dates require paid access; Free
  receives the current reporting day only.
- `GET /api/progress/statistics`: authoritative Today/Week/Month/Year/All totals
  and chart buckets. Extended ranges require paid entitlement.
- `GET /api/progress/activity`: paginated activity metadata from both sources,
  with the caller's token and existing owner/history RLS.
- `GET/PUT /api/progress/preferences`: daily goal, timezone, language, prompt
  themes and revision. Updates require expected account, trusted origin and CAS.
- Existing editor activity and extension metadata endpoints now accept exact
  intervals, timer snapshots and a device marker.

Visible views poll every 15 seconds and refresh on focus/reconnection. Confirmed
editor saves also notify the local extension through the existing origin-checked
metadata bridge. Documents/folders refresh after uploads and on the same bounded
poll/focus/reconnect cycle. Dirty drafts retain the existing revision-conflict
and recovery-copy workflow. Newer completed status is not silently overwritten
or automatically reopened. Clean library metadata is cached for offline use.

This implementation uses authenticated polling and the existing local bridge,
not a direct Supabase Realtime socket. Authentication currently uses backend
httpOnly cookies, without exposing Supabase access tokens to JavaScript. Polling
preserves that boundary and also works when a change feed is unavailable. The
result is bounded eventual consistency rather than instantaneous push delivery.

Offline activity and preference outboxes remain account-scoped. New snapshots
are removed only after acknowledging the exact uploaded revision. Newer pending
edits survive an older successful save. A conflicting settings revision adopts
the newer account setting and explains the conflict, rather than overwriting it
with an old device's settings. Initial migration adopts a device's existing goal
and timezone only if the account has no configured revision yet. Later devices
adopt account settings. Writing Profile/AI consent remain in the existing AI
profile system; documents are not newly shared with an AI provider.

The extension now labels daily, lifetime and session time separately. Signed-in
daily time never falls back to the extension-only timer. Offline saved totals
are marked offline; local, unacknowledged word changes can be shown as pending
without adding the same session twice. Anonymous extension tracking remains
local, with an explicitly session-based timer.

## Authentication and integrity

- Summary RPCs are service-only, called with the server-verified account and
  subscription. No client-selectable user ID or uncapped Free streak is returned.
- Direct activity reads retain owner and Pro/history RLS. Interval validation
  runs in both API models and a database trigger, including raw REST writes.
- Owner-checked writes, stable extension keys and increasing revisions prevent
  replay inflation. New extension keys include a random session UUID.
- Logout/account changes clear the visible session/account-summary cache and
  reset prior-account goals/profile settings. Durable queues retain their owner.
- Both clients share concurrent secure cookie refresh requests and retry an
  expired access cookie once; no tokens or secret keys enter local storage.
- The content script and worker both exclude the production editor, including
  its trailing-slash route, from external-site tracking.
- Cloud-imported history stays marked through CSV export/import, so it cannot
  echo back as a second session via the extension metadata bridge/outbox.
- Empty Trash retains the existing ledger/FK behavior and freezes at confirmed
  checkpoint time, rather than manufacturing an active tail during deletion.

## Migration and rollout

Apply `supabase/migrations/20261030010000_unified_account_writing_sync.sql` after
the already-applied session completion migration. It is transactional and
repeatable. It adds columns to existing RLS-protected tables, validates interval
writes, and installs/replaces the shared RPCs. It does not delete historical
rows, reset streaks, alter subscriptions or change prices.

Supabase's SQL editor may flag trigger/function replacement and the existing
Empty Trash function body. The deletion statement belongs to the explicitly
invoked, owner/revision/Pro-checked Empty Trash action; applying this migration
does not invoke it. No new table is created without RLS.

After applying, deploy the matching backend/frontend and install/reload extension
**0.20.0**, available in the branch's packaged download. Older extension versions
continue posting legacy duration snapshots, but their UI remains session-only
until updated. Do not deploy the new API against an unmigrated schema.

## Historical limitations

Older rows contain duration but no exact active intervals. Their saved duration
is retained and represented as an approximate span starting at the session
start, bounded by saved duration. Previous pause positions, exact historical
midnight splits, idle periods and overlapping-device timing cannot be recovered
from those records. No historic word counts or durations are rewritten. Exact
allocation and deduplication apply to interval-equipped clients going forward.
The extension's rich offline history remains a bounded device cache; online
account summaries/charts are no longer limited to that cache.

Tests use isolated accounts and fictional writing. No production writing,
streak, quota, Stripe payment or model call is changed by verification. New
browser integration uses accelerated clocks, not a claim that a tester spent
20 physical minutes writing.

## Verification performed

- Production frontend build and TypeScript compilation passed. Lint passed with
  four existing warnings in UI exports/admin code; the existing editor bundle
  size and marketing SSR import warnings remain.
- 47 selected backend tests passed: workspace ownership/Pro enforcement, activity
  input validation, shared summary privacy, account settings revisions, trusted
  origins, historical range permissions, AI coaching entitlements and exports.
- 34 top-level Node tests passed, including the existing engine/history/profile
  assertion suites. Added exact pause-gap checkpoints and concurrent secure
  token refresh coverage.
- Real PostgreSQL/PGlite migration tests passed: repeatable migration, preserved
  rows/settings, 20 editor + 15 extension = 35 minutes, overlapping sessions,
  unfinished active checkpoints, duplicate/stale snapshots, pause gaps, midnight,
  DST, historical chart/summary parity, settings CAS, owner and service-only RPC
  permissions, Free streak presentation and retained activity after Trash.
- Existing SQL streak regression passed: Day 1/7/8/15/20/25, upgrades/downgrades,
  missed days, timezone/DST, history preservation, RLS and explicit clear behavior.
- Actual extension worker integration passed: durable offline outbox,
  acknowledgements, account switching, timestamp rollover, Free pause/resume,
  duplicate End/Start, unchanged UUID keys during explicit historical import and
  a five-minute idle cutoff.
- Production-bundle editor browser regression passed: autosave, formatting,
  folders/library, import/export, consent/coach-only AI fixtures, Free denial,
  Monthly/Lifetime parity, account isolation, conflicts, offline edits/reload/
  reconnect and EN/ES layouts at 320/390/768/1440px, with accessibility checks.
- Separate session/completion/Trash browser regression passed: persistent pause,
  new-tab restore, completion/revert, pending-save failures, recovery copies,
  confirmation/cancel, preserved ledger and responsive/accessibility checks.
- New two-browser Chromium + real PostgreSQL integration passed: Device A's
  accelerated 20-minute editor session appears on Device B; a five-minute pause
  adds no active time; completion reaches B without auto-opening the completed
  document; a later ten-minute session on B brings A to approximately 30 minutes.
  Both retain the same account goal/timezone, and another Free account sees no
  writing or time from the first account. No AI requests occur.
- Actual popup/content/worker browser regression passed. It explicitly verifies
  **20 minutes in the popup with no local extension session**, separate local
  session versus daily totals, word deletion/clear, imports, manual refresh,
  Free/Pro and EN/ES popup layouts at 320/420px.
- The actual packaged 0.20.0 ZIP passed the same extension browser regression.
  Release SHA256 and byte-for-byte equality against distributable source passed;
  no tests or credentials are packaged.
- `git diff --check` and branding checks passed.

Screenshots are available in this workspace:
`/workspace/.onboarding/unoword/unified-sync/second-device-completion.png` and
`/workspace/.onboarding/unoword/unified-sync/cleared-progress-320-en.png` (also ES
and desktop variants). The cross-device screenshot shows approximately 30
minutes of account writing time alongside a separate ten-minute session timer.

## Main files changed

Backend: `backend/routers/progress.py`, `backend/routers/workspace.py`, new
`backend/lib/activity_time.py`, and progress API tests.

Database: new unified-account migration and
`supabase/tests/account-writing-sync.cjs`.

Web: `frontend/src/lib/use-account-writing.ts`, `api.ts`, `writing.ts`,
`writing-cache.ts`, `use-writing-workspace.ts` and `pages/WritingEditor.tsx`.

Extension: shared clock/cloud-progress/history/API/i18n modules,
`background.js`, `content.js`, popup/dashboard controllers and markup, manifest,
worker/browser/API/clock tests, and the packaged 0.20.0 download/release metadata.

Integration: `tests/account-writing-sync.browser.cjs`, workspace browser fixtures,
this report and README links.
