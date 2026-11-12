# Phase 3 — Signature project switching

The owner approved Phase 2 and requested this separately reviewable Phase 3.
This branch builds on PR #33. It does not merge or deploy the motion work to
production, and Phase 4 remains gated on the owner's review.

## Behavior and implementation

- The persistent project picker uses the existing shared Base UI Select,
  foundation popup transitions, studio tokens, active marker, keyboard handling
  and light/dark surfaces. No animation dependency is added. AI Context keeps
  its existing native control and request semantics.
  Its memoized project-specific composition and stable event forwarding keep
  Base UI's popup registry outside ordinary per-keystroke React updates.
- Choosing a project immediately disables competing edits/actions and announces
  the actual operation: saving the outgoing draft, opening the target document,
  or syncing the project preference. The old project label and body remain
  together until the target is available. No timeout impersonates readiness.
- Existing behavior is preserved: an active outgoing session pauses; a paused
  session stays paused. Switching does not start, end, copy or reassign a session.
  Pending document/activity writes flush through the existing workspace queue.
- `prepareDocument` shares the existing body-loading path with project preflight.
  It deduplicates reads, checks account/document identity and revision, preserves
  dirty drafts, and uses the existing IndexedDB cache. An uncached offline
  document or failed read keeps the original workspace available for retry.
- Project selection/preferences use the existing queue. The committed project,
  loaded body and default AI context change together. Current Project replaces
  any broader scope; selected resources, prior results and consent reset. This
  does not change document ownership or automatically request AI guidance.
- The same Tiptap instance receives the ready body before paint, preventing a
  new-project label above the previous project's text. The paper dims subtly
  while pending and reveals from 0.86 to 1 opacity over the shared 360ms token
  when ready. It is editable immediately after data readiness; animation does
  not delay typing. The first real `beforeinput` settles the reveal before text
  mutation, avoiding a large opacity layer being rerasterized while typing into
  long prose. No cloned writing, keyed editor, scaling or content animation
  is introduced. The normal unfinished-document restoration rules remain.
- Busy controls prevent overlapping project, document, session and AI actions.
  A sequence/account guard rejects obsolete completions. Statistics only display
  under the project they belong to. Reduced motion removes the reveal; changing
  that preference cancels an in-progress animation. Listeners/animations clean up.

### Issue found by interaction testing

The production CSS minifier expresses `360ms` and `420ms` as `.36s` and `.42s`.
JavaScript's previous `parseFloat` read these as fractions of a millisecond.
The shared `motionMilliseconds` reader now handles either unit for the project
reveal and Focus Mode paper movement. Actual production-editor checks assert
360ms and 420ms durations and type during the transitions. The Focus Mode
selection/scroll/session suite is rerun with the corrected full duration. This
supersedes the earlier assumption that parsing a CSS time always yielded ms.
Visual review also caught dark-menu focused text inheriting a generic light
foreground. Shared studio accent/popover/input aliases now resolve to the same
studio tokens, and a focused-child foreground check supplements axe.

## Actual editor tests and their limits

`tests/project-switching.browser.cjs` opens the production Tiptap editor and
creates non-sensitive projects/documents through its real controls. Keyboard
input, the actual workspace/session hooks, IndexedDB and full serialized bodies
are exercised against isolated persistence and AI-response APIs. Fixture stores
are inspected after acknowledged writes, then full reload verifies restoration.
This is **not live Supabase/account/provider verification**.

| Requested workflow | Evidence exercised |
| --- | --- |
| Multiple projects and documents | Creation dialogs, distinct bodies, independent goals |
| Type then switch immediately | Hold outgoing write; exact final characters survive return |
| Active and paused sessions | Same IDs/document attribution; outgoing pause; stable paused words/time |
| Slow network | Hold save, body read and preference write beyond animation duration; old workspace remains pending |
| Failed autosave | Original project/body preserved, retry and successful switch |
| Offline/reconnect | Cached drafts editable and retained across switches; reconnect persists complete JSON |
| Uncached offline target / failed load | No project commit or loss of current draft; successful online retry |
| Ownership and resource isolation | Associations unchanged, no membership mutation, filtered library and project goals |
| AI context | Broader scope/consent/results reset; explicit request carries only current project; no automatic request |
| Long documents / responsive | Two long drafts, 1440/1024/768/390/320px, no horizontal overflow |
| Rapid switching | Busy picker rejects competing selections; subsequent switches remain deterministic |
| Completion and reload | Completed document stays closed; last unfinished document/project/content restored |
| Accessibility | Keyboard selection/Escape/focus return, touch emulation, EN/ES, light/dark portal, reduced motion, axe |
| Editor continuity | Same Tiptap view through switches; ready typing during the full 360ms reveal |

`tests/projects.sql.test.cjs` additionally runs real SQL migrations, RLS,
compare-and-swap and context/resource-isolation policies using PGlite with
synthetic identities. Backend context/AI tests use isolated service fixtures.
These complement browser fixtures without claiming hosted Supabase coverage.

Manual VoiceOver/NVDA, physical Chrome/Safari/iPad/iPhone, long-session memory,
live account switching and live Supabase/provider/billing integrations remain
unverified. No backend, billing, entitlement or session-clock implementation is
changed. Extension/iOS adaptation belongs to later approved phases.

## Reproduce and review

```sh
npm --prefix frontend run build
node tests/project-switching.browser.cjs
node tests/focus-mode.browser.cjs
```

Use the installed Playwright/Chromium through `PLAYWRIGHT_MODULE` and
`CHROMIUM_EXECUTABLE`; set `AXE_SCRIPT` to the installed axe script for WCAG
checks. `PROJECT_RECORD_VIDEO=1` records real interactions when Playwright FFmpeg
is available. Artifacts are written under `tests/artifacts/project-motion/`.

For a working interactive studio with the test projects already created:

```sh
PROJECT_HEADED=1 PROJECT_PAUSE=1 node tests/project-switching.browser.cjs
```

The Playwright inspector leaves the actual editor open after the test flow.
Select Motion Memoir / Motion Novel, type, pause/resume and reload within that
browser context. The isolated in-memory API ends with the process. This is a
review harness, not a new product route or an account with access restrictions
removed. The branch Vercel preview requires existing team/application access;
its authentication protection remains enabled.

## Results, measurements and preview

Frontend production build/type/branding checks pass. Lint retains four existing
unrelated warnings. The wider final regression passes **13 jobs**: seven editor
flows (workspace, projects, coach, studio editor, images, subtitle/copy,
session/completion) and six web flows (shell, Home, Library/Settings, landing,
login redirects, Google OAuth). Backend context/AI tests pass **14 tests**; the
SQL isolation suite passes. Dedicated editor evidence covers **15 grouped
project scenarios** and the **21 Focus Mode scenarios** with the corrected
420ms duration. All use the isolated scope described above.

Performance trials run sequentially against the preserved approved Phase 2
production bundle, commit `c469939`, using two approximately 45k-character
documents and six switches per CPU rate. The choice marker is the native
select's `change` event before, and the shared picker's option `pointerdown`
after; opening the menu is excluded. Readiness requires the committed project,
matching document title and editable canvas, observed in the browser DOM.

| Width / destination | Input p95 before | Input p95 after | 4× before | 4× after |
| --- | --- | --- | --- | --- |
| 1440px / Memoir | 18.0ms | 17.4ms | 102.9ms | 107.3ms |
| 1440px / Novel | 16.1ms | 16.5ms | 98.3ms | 113.3ms |
| 768px / Memoir | 29.6ms | 30.8ms | 101.9ms | 113.0ms |
| 768px / Novel | 13.7ms | 31.8ms | 119.2ms | 107.2ms |
| 390px / Memoir | 30.9ms | 30.9ms | 130.3ms | 113.9ms |
| 390px / Novel | 30.8ms | 30.8ms | 98.2ms | 97.0ms |

Input means event → second animation frame, **not INP**. These single matched
trials contain both increases and decreases; they do not establish zero typing
overhead. The final reveal yields to the first real edit, all injected
characters are checked, and complete saved JSON is compared after every trial.
An earlier long-document trial motivated memoizing the picker and settling its
opacity reveal before typing, rather than keeping a large animated text layer.

Normal-CPU project readiness was **83–117ms before, 191–259ms after**. The 4×
trial was **380–564ms before, 884–1187ms after**. The target body is now prepared
before committing the workspace; the shared accessible popup adds work compared
with the native control. No 360ms delay is imposed on readiness. Slower-CPU
switching remains a performance risk and needs profiling on real lower-power
devices before claiming production-level performance. Accurate pending status
continues throughout that work.

Normal-CPU frame-interval p95 remains 16.7–16.8ms, with one 50ms long task before
and none after. This is rAF scheduling, not GPU FPS. The 4× trial records 154→179
long tasks across six switch-and-type samples; it does not meet a 60 FPS claim.
Observed layout-shift sums excluding recent input are 0.9403→0 at normal CPU and
0.3451→1.1435 at 4×. These include intentional document replacement once slower
work outlasts the recent-input window, so they are retained as diagnostics rather
than used to claim zero shift across devices. Focus's separate geometry tests
check line positions/selection directly throughout mode transitions.

Forced-GC heap after six switches is 11,317,444→13,052,620 bytes at normal CPU,
and 11,167,216→12,964,028 bytes at 4×. The picker/library and test caches differ;
short snapshots do not prove long-session memory stability or absence of leaks.

The Focus correction's normal-CPU p95 input ranges are 26.8–32.1ms before and
25.7–28.9ms after. Its six final enter/exit trials record no long tasks or layout
shifts excluding recent input. Raw per-width/direction results are retained.

Using the same local gzip level for both builds: entry JS is 87.93→88.79kB,
editor lazy JS 97.62→135.75kB, and editor CSS 6.44→6.75kB. The existing shared
Select contributes additional lazy editor code; no package dependency is added.
These are bundle measurements, not a field page-load or Core Web Vitals claim.

Review evidence:

- [Actual editor recording](review/project-motion/editor-demo.webm)
- [Project scenarios](review/project-motion/functional-results.json)
- [Focus regression scenarios](review/project-motion/focus-regression.json)
- [Broader regression results](review/project-motion/regressions.json)
- [Full before/after measurements](review/project-motion/measurements.json)
- [Desktop](review/project-motion/desktop.png), [mobile](review/project-motion/mobile.png),
  [dark picker](review/project-motion/mobile-dark-picker.png), [pending load](review/project-motion/pending-load.png)

The protected branch preview is listed with the review PR. Live account/provider
persistence, physical devices and manual screen-reader testing remain
outstanding. Phase 4 requires owner
approval; no motion phase is merged or deployed to production by this change.
