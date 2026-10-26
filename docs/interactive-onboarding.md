# Interactive UnoWord onboarding

## Delivered experience

The first action in the Pro writing tour is writing a sentence in the existing
Tiptap editor. The tour creates a new private draft, reopens its prior draft, or
lets an existing writer explicitly use their current document. It never inserts
sample content or replaces a document. On completion it returns to that draft.

A compact, nonmodal guide highlights real canvas, word-count, session, goal,
statistics, prompt, and profile controls. The writing canvas remains usable;
the first-sentence celebration announces itself without moving keyboard focus.
Cards have step progress, optional actions, skip, pause/Escape, resume, and
replay controls. Reduced motion disables the celebration animation. Unavailable
or asynchronously rendered spotlight targets do not prevent skipping a step.
The real editor and counter remain the only writing and tracking systems.

The rest of the tour follows the requested progression: word counting, writing
sessions, goals, progress, Quick Prompt, the existing Writing Profile, Chrome
installation instructions, and a summary of actual completed actions. The tour
never invokes paid AI, sets AI consent, enables a document as an AI source, or
puts the first sentence into writing memory. Opening the Writing Profile is
recorded as **profile opened**, not as a completed profile or upload.

## Trigger and subscription behavior

Authenticated account activation automatically displays a welcome offer in
`/account`. Pro access comes from the existing server-verified entitlement;
Stripe return URLs do not grant access. Opening the editor with no prior tour
state offers the welcome guide. In-progress tours reopen at the saved step;
paused and completed tours remain closed until the user resumes or replays.
Renewals and payment-method changes do not reset progress or achievements.

Free accounts receive an extension-focused offer because the full editor and
private document library are Pro-only. They can install the existing packaged
extension and use its short walkthrough for Start Session, counts, progress,
and the Free prompt library. No new editor is exposed to Free accounts. The
account offer sends a newly eligible writer without a tour draft to the welcome
step when they enter the Pro editor.

## First-sentence detection and achievements

Observation comes from the editor's actual input/update events. Formatting,
unchanged content, paste, drop, imports, and AI insertion do not earn the typed
sentence achievement. The existing extension-shared word-count algorithm is
reused. After actual typed input, one added word with terminal punctuation or
five added words without punctuation is enough. Perfect grammar is unnecessary.
The baseline is captured for the current step, so an existing document does not
earn a fresh achievement merely by opening it. A completed first-sentence action
can be revisited on replay without forcing the writer to type it again.

Word-count exploration is recorded only when actual typing increases the count.
Session tracking is acknowledged only if a real editor session exists. Goals
are recorded only when the user changes the existing goal or explicitly keeps
it. Prompt and profile achievements require real button actions. Skipped steps
are kept separately and never become completed actions merely by navigation.
The summary displays only true actions, along with the actual draft word count.

## Persistence, privacy, and replay

`/api/onboarding` reads and updates `unoword_tour_v1` in the signed-in user's
existing Supabase Auth metadata. It requires authentication, owner identity
checks, trusted-origin protection for writes, bounded validation, and private
no-store responses. It stores only a draft UUID, step/status, action flags,
skipped steps, a count, and version. It accepts no document text. Unrelated Auth
metadata is preserved. These cosmetic flags cannot grant subscription access.

Achievements and the `completed_once` flag merge monotonically. Replay preserves
original achievements, documents, and goals. In-progress steps may be revisited;
replay never starts duplicate sessions or repeats AI profile setup automatically.
Concurrent devices preserve action flags seen by the server, though simultaneous
writes to Auth metadata are not a transactional event log: the last arriving
cursor/status can win. This does not change documents, account permissions, or
writing activity.

Owner-scoped IndexedDB stores pending progress. Offline edits and tour actions
survive refresh/reopen, and metadata sync retries after connectivity returns.
A storage failure is reported rather than silently promising persistence. The
extension walkthrough separately stores its cosmetic cursor/actions per account
in existing Chrome storage; its web preview uses local storage as a fallback.
Extension-local tour steps do not synchronize across devices.

Replay from the account's **Take the UnoWord Tour** action or the editor's
persistent tour button. The extension adds **Settings → Take the UnoWord Tour**.
Extension release **0.16.0** is packaged at `/downloads/unoword-extension.zip`;
existing developer-mode installations must reload/update that extension to see
its new walkthrough.

## Architecture adaptations and limits

- The web editor automatically starts tracking when the user types. Its tour
  recognizes that existing session and explains the extension's Start Session
  control. It does not add a second web session button or session engine.
- The web editor already has live progress statistics rather than a separate web
  dashboard. **View My Progress** highlights those real statistics. The extension
  walkthrough points to its existing Progress view.
- Goal presets call the same existing goal update as the editor's Daily goal
  input. A custom goal uses that input. Goals retain their current browser-based
  storage behavior; a separate cloud goal system was not introduced.
- The web tutorial copy is currently English. Existing editor English/Spanish
  functionality is preserved; the extension walkthrough has both languages.
- Cloud document synchronization still depends on the previously supplied
  workspace migrations. They are not required for tour Auth-metadata storage.
  While cloud documents are unavailable, new tour writing stays in the existing
  local draft cache and AI generation remains disabled until drafts synchronize.
- No legal or billing terms, subscription prices, permissions, or AI quotas were
  changed. There are no new dependencies or database migrations.

## Files and verification

New modules: `backend/routers/onboarding.py`, `backend/tests/test_onboarding.py`,
`frontend/src/lib/onboarding.ts`,
`frontend/src/components/onboarding/AccountTour.tsx`,
`frontend/src/components/onboarding/WritingTour.tsx`,
`frontend/src/styles/onboarding.css`, `extension/popup/tour.js`, and
`tests/onboarding.browser.cjs`.
Integration changes: backend router registration, Account and WritingEditor,
extension popup HTML/CSS and manifest/release artifacts, plus existing browser
fixtures to account for the new cosmetic progress endpoint.

Verified with isolated fixtures (no real user edits, paid AI requests, or charges):

- Production build and TypeScript; lint with only the four existing shared UI/
  admin warnings.
- 47 backend onboarding/workspace/product tests: metadata persistence, replay,
  monotonic achievements, field validation/no writing payloads, authentication,
  CSRF, owner isolation, and existing Pro/document checks.
- Onboarding browser workflow: first sentence without punctuation, paste
  exclusion, no typing-focus interruption, real counts/session/goal/prompt/profile
  actions, refresh/reopen, pause/Escape/resume, replay, a fresh all-skipped tour
  without false achievements, offline tour reload, Free/editor restrictions,
  account offers/navigation, 320–1440px layouts, WCAG checks, and no AI calls.
- Full existing editor browser regression, including offline drafts, folder
  creation, autosave, import/export, conflicts, consent, and English/Spanish.
- Landing regression: CTA/auth gates, 14 widths, pricing/entitlement states,
  SEO/branding, and accessibility.
- 22 extension Node test files and popup browser regression, including the new
  walkthrough's launch, pause, and persisted resume in the embedded preview.

To rerun against the built app preview at localhost:4175:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/path/to/chromium \
AXE_SCRIPT=/path/to/axe-core/axe.min.js \
ONBOARDING_SCREENSHOTS=/tmp/unoword-onboarding \
node tests/onboarding.browser.cjs
```

Desktop/mobile screenshots for this session are in
`/workspace/.onboarding/unoword/interactive-onboarding/`.
