# Phase 4 — Ideas and AI guidance

This phase builds on the Phase 3 editor merged via PR #23. Phase 4 was merged
via PR #24 and deployed after Phase 3's live verification passed. The earlier
static Ideas prototype is part of Phase 4, alongside the editor coaching changes
described here.

## Ideas and saved guidance

`/ideas` is an authenticated, noindex studio page for Free and Pro. Home's Get
Ideas and studio Ideas navigation open it. The supplied artwork, EN/ES, both
themes and responsive layouts follow the shared studio design.

Home and Ideas share a static daily Quick Prompt for the account, reporting day
and language. The existing extension library supplies every prompt. Theme and
search filters do not write account preferences. Bookmarks store known prompt
IDs on this browser under account-specific keys; the page identifies this limit,
supports tab updates and keeps session-only saves if storage writes fail.

Free writers copy Quick Prompts. Pro writers can create an empty draft through
the existing account-bound, one-use handoff: existing writing is flushed first,
the static prompt becomes the title and the body stays empty.

Saved AI ideas are a separate section. It reads existing `/ai/ideas` only when
the writer asks to view it and has verified Pro access. Responses are checked
against the current owner. Loading/error/empty/offline states are distinct;
cached offline ideas are labeled. Free accounts never query this endpoint.
Cards show the saved idea, questions, existing context/source labels and writing
task when available. Copying an idea never inserts it into an authored document.
The editor's explicit Save idea action uses existing
`PUT /ai/suggestions/{id}/save`, with retry and owner-aware UI handling. No new
memory model, generation request or AI credit is involved in saving/viewing.

## Editor guidance

- Quick Prompt is labeled non-AI and separate from Pro coaching.
- Existing modes get clear descriptions and allowance labels. Their action
  values and request semantics are unchanged.
- A context summary shows the project, library scope, selected resource count
  and whether this draft will be included. Review closes a mobile assistant and
  focuses the existing scope control. Permissions remain in the existing picker
  and server checks; selecting scope never enables persistent source consent.
- The draft inclusion predicate is shared by the summary and existing request
  builder. Consent is still required and still resets when context changes.
  Its label reflects whether the draft is included or the request uses only
  the selected context.
- Usage is compact in the editor with keyboard-accessible details. Account's
  full usage display stays available. Counts, pending reservations, protected
  plans, reset dates/timezone and monthly buckets still come from the server.
- Organization, research and feedback now disable at an exhausted Writing
  Guidance allowance, matching the server's existing classification alongside
  Help Me Continue. Suggestion modes keep their separate daily/monthly checks;
  protected plans still use the shared daily allowance for all modes.
- Result cards are labeled as AI guidance, separate from authored writing. The
  existing source evidence actions and owner/idea-specific writing-task checklist
  remain. There are no insert, rewrite or apply-to-selection actions.

Only web presentation and existing API consumers change. No database migration,
backend quota policy, AI provider prompt, entitlement, tracking, extension
permission, authentication provider or editor persistence change is included.

## Verification

Build, TypeScript and lint pass, with the four pre-existing lint warnings.
Synthetic browser coverage includes:

- `tests/studio-ideas.browser.cjs`: authenticated route, shared prompt, themes,
  search/pagination, bookmark reload/tab sync/storage failure, Free copying,
  saved AI reads/copying/search/offline display and mismatched-owner rejection,
  Pro empty-draft handoff, no automatic generation, EN/ES and 320–1440px.
- `WRITING_COACH_ONLY=1` mode of `tests/writing-workspace.browser.cjs`: consent
  and context resets, unchanged scope/payload, no persistent private-document
  opt-in, save failure/retry without generation, independent allowance buckets,
  protected pending reservations, unchanged writing/sessions, compact usage,
  mobile context review, themes and EN/ES.
- Default editor, project/context, Home, studio shell, onboarding and Google OAuth regressions.
- Backend `test_workspace_ai.py` and `test_ai_quota.py`: 14 tests passed with
  mocked provider/RPC fixtures. These do not test production database concurrency.

Browser screenshots are ignored fixture artifacts under
`tests/artifacts/ideas/` and `tests/artifacts/phase4/coaching/`; desktop, mobile
and dark layouts were visually reviewed. Tests used no production users,
payments or paid AI. Automated axe and physical Chrome/iPad checks remain
separate Phase 8 work.

## Production release

On 2026-11-11 UTC, the owner authorized deployment through Phase 4. PR #24 was
retargeted to main after Phase 3 merged, then merged at
`a5b51a15944a56f1b84d38b6e0453c809e2f8cad`. Vercel reported a successful
production deployment. `https://unoword.app` serves the new entry
`/assets/index-ZKmkRbDK.js`.

Certificate-validating HTTPS probes returned 200 for the public site, Home,
editor, Ideas, Account, API root and product endpoint. Anonymous document,
project and saved-AI-idea requests returned 401. Ideas, coaching and Home browser
suites passed against deployed assets using synthetic APIs with analytics
disabled. Those checks cover consent, allowance gates, account isolation,
separate guidance, save retries, prompt handoffs and responsive EN/ES themes.
Container Chromium required a certificate override; the independent HTTPS
probes did not. No production user data, payment or paid AI was used.

Phase 5 subsequently superseded this deployment; its implementation notes record
the release commit and live verification.
