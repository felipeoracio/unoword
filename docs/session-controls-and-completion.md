# Persistent sessions, document completion, and Empty Trash

Deployed to [unoword.vercel.app](https://unoword.vercel.app/) after the owner
applied the migration. [PR #5](https://github.com/felipeoracio/unoword/pull/5)
merged as `d1acc1d`; Vercel confirmed production deployment and the live checks
below passed. Extension **0.19.0** is published.

This change extends the existing Tiptap/React writing workspace, FastAPI API,
Supabase owner/Pro policies, revision-safe document RPCs, IndexedDB drafts, and
Chrome extension service worker. Authentication, billing, prices, AI generation,
word tokenization, and streak qualification are unchanged.

## Writing sessions

The editor and extension share `extension/shared/session-clock.js`. A saved timer
has `status` (`active`, `paused`, or `ended`), accumulated `active_ms` and
`paused_ms`, and a transition timestamp `changed_at`. Intervals repaint/checkpoint
the timer; elapsed time comes from timestamps. Repeating a transition is safe.
Ended sessions cannot accidentally resume, and duplicate extension Start requests
retain the existing open session, including a paused one.

- Active controls: **Pause Session** and **End Session**.
- Paused controls: **Resume Session** and **End Session**, with a paused indicator.
- Pausing freezes active duration and tracked word counts. The editor still saves
  document edits; typing while paused does not add to session progress.
- Resume keeps the activity/session ID, counters, and previously accumulated time.
- Session details show active, paused, and total elapsed time separately.
- A 25-minute active period, 10-minute break, and 20-minute active period records
  **45 active minutes, 10 paused minutes, and 55 elapsed minutes**.
- Editor timer state persists in the existing account-scoped activity cache and
  `writing_activity.timer`. Extension state persists in `chrome.storage.local`.
  Refreshing or opening another tab restores a paused session without resuming it.
- Background tabs do not lose time because intervals are throttled. An active
  session remains active until paused/ended; users should pause before a break.
- Selecting another editor document pauses the previous document's active session.
  Returning to it allows explicit Resume. Existing calendar-day activity rollover
  remains in place so words stay assigned to their qualifying local day.
- Ending a session does not complete the document. The completion control asks
  whether to complete and end an associated open session, or keep writing; it
  never ends an unrelated session.

Extension history, dashboard time, cloud progress metadata, and AI Memory duration
use active time. New CSV exports retain active/paused durations; old CSV files and
sessions without timer metadata remain readable. Extension **0.19.0** is published
in the verified download ZIP; no additional Chrome permissions were introduced.

Restored activity responses are normalized before submission: database-only fields
such as `user_id`, `source`, and `updated_at` are not forwarded to strict API inputs.

## Document completion

Existing `status` continues to mean `active`, `archived`, or `trashed`.
`completion_status` is an independent `draft`/`completed` field, and
`completed_at` comes from a database trigger. Existing documents default to drafts.
Completing writing never archives, deletes, or changes its content or formatting.

The checkmark in the document action bar has the accessible tooltip
**Mark Document as Complete**. It waits for pending local persistence and cloud
saving, then sends a revision-checked completion request. No success is displayed
if a save, conflict, account check, or completion confirmation fails. Repeating a
completion request after a lost response reuses its mutation ID. Older autosave
clients that omit completion fields preserve the saved status and timestamp.

After completion, the confirmation offers **Start New Document** and
**View Document Library**. Returning to the editor shows **Ready for Your Next
Idea?** instead of reopening completed writing. An unfinished last selection
continues reopening normally, including after a paid plan is restored. Selection
is stored per account; an authentication/downgrade gate does not erase it.

The library combines All Documents/Drafts/Completed filtering with existing
folders, search, favorites, Archive and Trash. Completed writing can be opened
manually, exported, and changed back using **Mark as Draft**. The completed view
is read-only until that action; reverting clears `completed_at` and keeps content.

Completion requires an online confirmed save. Offline writing/autosave continues
using the existing cache and reconnect/conflict flow.

## Empty Trash

Select **Trash → Empty Trash**. A native accessible modal states the number of
confirmed documents and that permanent deletion cannot be undone. Cancel does
nothing; the action is unavailable offline. Only verified Pro Monthly/Lifetime
users can invoke the owner-scoped backend and database operation.

The operation saves pending work, then submits the explicitly confirmed IDs and
revisions in batches of at most 1,000. The transactional RPC locks and removes
only matching owner documents still in Trash. Changed, restored, newly trashed
but unconfirmed, and other-account documents are kept. Repeating a request is safe.

Writing activity is retained: only the document reference becomes null. Open
sessions associated with removed documents are frozen without adding paused time
to active time. Unrelated sessions stay active; earned writing days and streaks
remain in the existing ledger.

This browser's document/draft cache is cleared for removed IDs. Account-scoped
local tombstones prevent late autosaves from resurrecting deleted documents.
Divergent unsaved writing in another tab is retained as a recovery copy with a
new ID rather than silently discarded. Reopen the editor and choose **Recovered
drafts → Recover as a new document** to retrieve it. This protects copies available
in this browser; it does not reach into a different offline device's storage.

## Applied database migration

The owner applied this file in the existing Supabase project's SQL Editor:

`supabase/migrations/20261029010000_session_pause_document_completion.sql`

Prerequisite: the existing writing workspace/Pro migrations and
`20261028040000_verified_streak_presentation.sql` are already applied. The migration
is transactional and repeatable. It adds two document fields and nullable timer
metadata, preserves the existing RLS policies, and updates the existing save RPCs.
No documents or activity are deleted when applying it. The deletion function runs
only when a signed-in paid user explicitly confirms Empty Trash.

No new secret, billing setup, or AI allowance change was required. Direct
PostgreSQL connections from this workspace remain unavailable, so the owner ran
SQL and verification used the actual Supabase REST/RPC and deployed API routes.
Completion columns, timer metadata, and the paid Trash RPC were confirmed before
merging. An empty Trash snapshot was rejected without changing data.

After deployment, refresh the web app and update/reload the extension to
**0.19.0**. Do not clear browser site data to update: local offline drafts should
remain available.

## Production verification

These were real deployed API, database, and Chromium checks, separate from the
isolated suites below. Changes were confined to temporary fictional documents,
activity and a temporary Free identity; the existing dedicated Pro QA account's
entitlement was used without granting or changing paid access. The live QA
browser filtered its library to disposable document IDs, while authentication,
permissions and every save/completion/Trash mutation used the real backend.

- Free API and direct RPC access to the paid operations was denied. A Pro request
  could not delete another account's document. Existing document metadata and paid
  entitlement were unchanged after cleanup.
- Actual session saves recorded **45 active / 10 paused / 55 elapsed minutes**
  under one activity UUID. Duplicate and stale snapshots did not create rows or
  replace an ended timer.
- Completion preserved content/formatting, used the database timestamp, replayed
  safely, survived an older-client autosave, rejected stale revisions and forged
  timestamps, and reverted to draft with the timestamp cleared.
- Trash deletion skipped changed/restored documents and left an active keeper
  document intact. A paused session for a deleted test document ended without
  adding its break to active time. Activity survived with a null document link;
  deletion replay was safe.
- The live editor paused/resumed the same session, restored pause after reload
  and opening another tab, preserved counts during paused edits, ended while
  paused, confirmed saves before completion, opened a fresh experience afterward,
  manually reopened completed writing, and reverted it to an editable draft.
- Offline editing, offline reload and subsequent cloud synchronization passed.
  The real Trash modal's Cancel and confirmed deletion worked, restricted to one
  temporary QA document. Responsive layouts passed at **320/390/768/1440px**, with
  no JavaScript exceptions or automatic AI/processing calls.
- The public **0.19.0** ZIP matched its release checksum and contained the shared
  timer. The actual popup/content-script/worker browser suite also passed using
  that downloaded ZIP with isolated network fixtures, including Free/Pro,
  pause/resume, popup reopening and English/Spanish at 320/420px.

Temporary accounts, documents and synthetic activity were removed. Original
writing/streak presentation, entitlements and AI usage counters were verified
unchanged. No model generation, payment, live billing activation or quota reset
was performed. These are scoped smoke checks, not a claim that every production
workflow or device was exercised.

Production evidence in this workspace:

- `/workspace/.onboarding/unoword/session-completion/production-live-results.json`
- `production-session-paused.png`
- `production-document-completed.png`
- `production-empty-trash-mobile.png`

## Verification performed

The pre-deployment suites below used isolated local fixtures; no real writing,
subscriptions, production quotas, paid AI requests, or cards were changed by those
suites. Production smoke checks are documented separately above.

- 41 selected backend cases passed: document save/replay/conflict, completion and
  revert, owner/origin checks, timestamp rejection, timer persistence/validation,
  confirmed Trash deletion, Free restrictions, Monthly/Lifetime parity, recovery,
  progress permissions and the existing AI assistant boundary.
- 33 top-level Node tests passed, including the new clock/CSV cases and the
  existing word-count, history, dates, metadata and privacy tests.
- Actual service-worker integration passed for the 45/10/55-minute example,
  paused input suppression, persistent state, duplicate Start/End protection,
  Free tracking, metadata outboxes, account isolation and calendar-day rollover.
- Real isolated PostgreSQL (PGlite) passed migration/reapply, legacy content/draft
  preservation, independent archive/completion states, database timestamps,
  completion CAS/replay/revert, old-client compatibility, timer update ordering,
  owner/Pro RLS, confirmed Trash snapshots, related-session ending, unchanged
  activity/streaks, and preserved changed/restored/foreign/unconfirmed documents.
- Production-bundle editor browser tests passed both the full existing workspace
  workflow and the new session/completion/Trash workflow. Coverage includes save
  failure/retry, paused refresh/new-tab restoration, manual completed reopening,
  draft reversion, filters, confirmed/cancelled/offline Trash handling, and
  recovery of divergent unsaved writing from another tab.
- The onboarding browser regression passed, including real typing, tour progress,
  refresh/replay, keyboard dismissal, account restoration/isolation, Free restrictions,
  320–1440px layouts and axe checks. Its HTTP fixtures were updated for the current
  usage/streak/Lifetime endpoints; it never calls a model.
- The existing PostgreSQL streak regression also passed the 1/7/8/15/20/25-day,
  upgrade/downgrade, missed-day, DST/timezone, RLS and clearing cases.
- The actual popup/content-script/worker browser suite passed with pause/resume,
  popup reopening, paused typing suppression, Free access, word deletion, progress
  synchronization and English/Spanish layouts at 320/420px.
- Editor layouts were checked at 320, 390, 768 and 1440px. Axe checks passed for
  the editor, paused controls, completion confirmation and desktop/mobile Trash
  dialog. Production build and TypeScript passed; lint retains only four existing
  unrelated warnings. Python compilation and whitespace checks passed.

Fixture screenshots are available in this workspace under
`/workspace/.onboarding/unoword/session-completion/`, including
`session-paused-desktop.png`, `document-completed-desktop.png`,
`empty-trash-desktop.png`, and `empty-trash-mobile.png`.

## Main files

- API: `backend/routers/workspace.py`.
- Database: `supabase/migrations/20261029010000_session_pause_document_completion.sql`.
- Editor/cache: `frontend/src/pages/WritingEditor.tsx`,
  `frontend/src/lib/use-writing-workspace.ts`, `frontend/src/lib/writing.ts`,
  `frontend/src/lib/writing-cache.ts`, and `frontend/src/styles/writing-editor.css`.
- Extension: `extension/shared/session-clock.js`, `background.js`, `content.js`,
  popup/dashboard controllers and markup, history/metadata/localization helpers,
  manifest, and the packaged download.
- Tests: `backend/tests/test_workspace.py`, `extension/tests/session-clock.test.js`,
  `extension/tests/cloud-sync.integration.cjs`, `extension/tests/progress.browser.cjs`,
  `supabase/tests/session-completion.cjs`, `tests/writing-workspace.browser.cjs`,
  and `tests/onboarding.browser.cjs`.
