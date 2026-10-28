# Goal-based writing suggestions

New personalized suggestions use the current daily goal and **typed words today**
from the existing dashboard. The backend calculates `max(0, goal - written)`
before calling AI. Pasted text, imported editor history and manually checked
outline sections never add writing credit.

The extension collects a consistent snapshot in its existing session mutation
queue. It uses the same history, active session, calendar helpers and goal setting
as the dashboard. Imported editor activity is already merged by stable IDs. The
web editor uses its existing merged cloud/local activity plus the owner-checked
extension bridge; imported editor records are excluded from that bridge. Active
extension sessions now participate in the bridge as metadata only. Both displays
and AI requests reuse the same daily-total helper; no second tracker or progress
table is created.

These device-reported progress snapshots are advisory personalization data, not
authority for billing, entitlements or AI quota. The backend validates timezone,
calendar date, timestamp and bounded nonnegative counts. A stale day/snapshot is
rejected before reserving quota or generating text. Existing server-side Pro and
shared AI usage checks remain authoritative.

## Task size and scope

- Around 100 words: one reflection, moment or paragraph.
- Around 250: one idea in two or three paragraphs.
- Around 500: a short story or article.
- 750–2,000: a more developed piece with five manageable sections.
- Completed goal: optional inspiration, no required target or section checklist.
- No configured goal or older client: a reasonable default from the existing
  `WRITING_DEFAULT_DAILY_GOAL` setting (250 by default).

`AI_MAX_TASK_WORDS` optionally caps a single proposed task (default 2,000), so a
very large remaining goal becomes a manageable first part. This is a planning
size, not a quota, pricing change or rigid writing limit. The AI response stays
concise: the word estimate refers to the author's future writing.

For longer tasks, AI supplies topic-specific section headings in the same model
call. The server assigns approximate section sizes that add up exactly to the
planned target. A 2,000-word plan uses 200/500/500/500/300 words. Invalid/missing
headings fall back to localized section labels. Three editor suggestions are
alternatives for the same remaining goal, not three cumulative assignments.

The three Pro suggestion modes and editor next/continue/block/brainstorm tools
use this plan. Selected-text improvement preserves its existing scope and never
pads a passage to meet a word target. Free/Pro Original Writing Suggestion
(Quick Prompt) remains local and unchanged.

## Saved suggestions and milestones

A task snapshot is stored with each suggestion in its existing versioned details
column. Older suggestions remain readable. A shared display renders word
estimates, optional status and section checklists in both the popup and editor.
Checkbox choices persist on that device under account and suggestion IDs. They
are a planning checklist, not a new writing-progress or goal system.

Changing a goal, typing, deleting, refreshing progress, or crossing midnight does
not generate AI calls or overwrite the current suggestion. The next explicit
Generate/Try Another request collects fresh progress. Stored suggestions show the
remaining count at generation time and retain their original plan.

## Rollout and verification

No database migration, scheduler change, new secret or billing configuration is
needed. Deploy the application and update the installed extension to **0.17.0**.
Older clients receive default-sized suggestions until updated.

Tests cover small/large/remaining/completed/default targets, DST and timezone
dates, stale snapshots rejected before AI quota, exact milestone totals,
serialization, current personalization, active/duplicate/pasted/deleted words,
saved checklists, explicit regeneration, and readable responsive layouts. Browser
suites use production bundles and the real extension worker with isolated HTTP
fixtures; live QA validation can test a few requests without changing goals or
writing data because snapshots are advisory request metadata.
