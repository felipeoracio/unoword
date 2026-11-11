# Phase 5 — Progress

`/progress` gives signed-in writers an account summary, period statistics,
historical trends, a current-month calendar, open synced session checkpoints and
a preview of earned milestones. Studio Progress navigation and Home's progress
link open it. Existing Account anchors remain compatible. Sign-in's explicit
return allowlist adds only `/progress`; provider configuration is unchanged.

This phase builds on deployed Phase 4. PR #25 was merged and deployed after its
validation. No backend, schema, tracking, entitlement or extension
change is introduced.

## Authoritative metrics

`useStudioProgress` reuses verified studio identity and the existing account
summary hook. It reads account preferences, `/progress/summary`,
`/progress/statistics` and existing rewards. Opening the page never mounts the
editor/session hook or makes a client mutation, celebration claim, AI request,
document fetch or progress reset.

- Today's words/goal and daily/lifetime active time come from the account
  summary. Overlapping active intervals are already deduplicated by the server.
- Open sessions show each session's last saved active time, source and paused or
  active status. They are not a live stopwatch and are never summed into the
  daily or lifetime cards. No arbitrary session is resumed or adopted.
- Period totals and chart buckets come from the statistics API. “This week” is
  the server's calendar week, not a rolling seven-day estimate. Year view uses
  monthly buckets. Future buckets are omitted from trends.
- No recorded activity is different from unavailable data. Errors show unknown
  totals or an error state; verified zero activity has its own illustrated state.
  An already-open offline page labels last confirmed totals. Initial offline
  access offers the existing editor rather than trusting cached identity.

## Reporting dates and access

The summary's reporting date/timezone anchor all statistics and the calendar.
Owner, range, timezone and anchor-bucket checks prevent mixed-period responses
from being displayed. API date keys are already local reporting dates: display
formatting uses UTC only to preserve their literal calendar date and never shifts
them into the browser's timezone again. Leap-month length and Monday-first
offsets use calendar arithmetic on those keys.

Free requests only today's statistics, never a historical statistics range,
raw activity or streak history. Its streak display is capped at seven without
changing recording. Pro uses week/month/year trends and month-calendar metadata.
Query keys include owner and entitlement so a downgrade does not reuse premium
results. Free never renders longest/raw streak fields or badges above seven days.
Server authorization remains authoritative.

The calendar distinguishes typed-word activity, time-only activity, known
inactive days, future dates and missing data. It does not infer past goals from
today's target. The explanatory disclosure preserves the existing policy: words
belong to the session start day; active time is split across reporting days;
pasted words do not qualify streaks.

## Accessible trends and personal milestones

Charts offer word/time measures, keyboard-operable bar selection, full-value
labels and a native data-table disclosure. Calendar buttons expose date, words
and time as text and show the selected day's details. Future dates are not
interactive. Horizontally scrolling charts/tables stay inside the card on phones.

Milestones use existing, earned reward records and preference controls. Disabled
rewards/dashboard previews are respected, unavailable rewards are not treated as
unearned, and no threshold or goal evidence is calculated on this page. The
existing Badge component accepts optional supplied artwork as a fallback while
retaining configured badge images. No celebration is claimed automatically.

## Verification

- After integrating deployed Phase 4, the production build, Progress workflow,
  targeted axe scans and both embedded PostgreSQL suites passed again. Phase 4
  live verification is recorded in `ui-redesign-phase-4.md`.
- Production build and TypeScript pass; lint retains four existing warnings.
- `tests/studio-progress.browser.cjs` uses synthetic accounts to check private
  routing, separate daily/lifetime/session time, goal and streak presentation,
  period/calendar metadata, future dates, leap day, a browser timezone different
  from account timezone, live reporting-timezone changes, chart text/keyboard
  access, milestone error/disabled/empty states, offline/error behavior, account
  isolation, Free downgrade and no client writes/history/AI requests.
- Targeted axe checks cover the new Progress content in light, dark and Spanish
  mobile layouts with reduced motion enabled for settled theme colors. These
  are automated checks, not an accessibility certification.
- `tests/progress-reporting.sql.test.cjs` runs the actual migrations/functions in
  embedded PostgreSQL. It verifies midnight time splits, start-day words, both
  DST transitions, overlapping-session union time, changed reporting timezone,
  stable lifetime totals and owner isolation. Existing rewards SQL tests cover
  earned evidence, Free streak filtering, preferences and durable unlocks.
- Backend progress-permission and rewards suites: 22 tests pass. Existing Home,
  studio-shell, Google OAuth and rewards browser regressions are also checked.
  The rewards browser test follows the shared shell's current headings and
  language control.
- Desktop/mobile/dark fixture screenshots under ignored
  `tests/artifacts/progress/` were visually reviewed. No production writing,
  real payment or paid AI was used. Physical Chrome/iPad and live infrastructure
  verification remain separate Phase 8 work.

Run browser tests against the built preview on port 4175, setting
`PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` as needed. `AXE_SCRIPT` enables
Progress axe scans; `PGLITE_ROOT` locates the test-only PostgreSQL packages.

## Production release

The owner authorized deployment of Phase 5 and continuation with Phase 6.
PR #25 merged at `1db7fc1863e3f812fbeaeb3a0063a4876d14955d`. Vercel reported
success; the production entry is `/assets/index-BDsX-n8T.js`. Normal HTTPS probes
returned 200 for `/progress`, the API root and product endpoint, and 401 for
anonymous document/project requests. The Progress browser workflow and targeted
axe scans passed against deployed assets with synthetic API responses and
analytics disabled. Container Chromium required a certificate override;
independent HTTPS probes validated certificates normally. Production remains on
Phase 5 while Phase 6 is prepared separately.
