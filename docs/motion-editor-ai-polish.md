# Phase 4 — Editor and AI polish

The owner approved Phase 3 and requested this separately reviewable phase.
It builds on PR #34; production deployment and Phase 5 are not part of this
change. The motion system, studio tokens, routes, editor, session engine and AI
contract remain the existing UnoWord application.

## Audit and scope

The editor already supplies native toolbar selects, selection-preserving format
buttons, native link/image/evidence/export controls, confirmed workspace save
states, explicit AI consent/usage gates, stale-response guards and separate
authored writing/guidance. These controls are retained. No new UI library,
editor wrapper, keyed editor, request mode, automatic AI request, subscription
change or persistence implementation is introduced.

The existing session timer/word counters and autosave queue remain authoritative.
Their state is presented immediately; an animation never delays or manufactures
"Saved", an allowance, successful persistence or a completed request.

## Implementation

- **Editor opening:** a stable callback ref records an existing paper mount;
  after ordinary hydration/readiness it receives a 220ms opacity cue from 0.96
  to 1. It does not change content, selection,
  scrolling, reading width or editability. First real input settles that cue
  before text mutation. Keystrokes, saves, session ticks and AI updates do not
  replay it. A project transition retains Phase 3's own reveal instead.
- **Shared utility:** `revealOpacity` consumes the existing panel/easing tokens
  and CSS time-unit reader. It honors reduced motion, cancels on a live preference
  change and removes its temporary listener when finished/canceled. Callers cancel
  on unmount; there is no timer, continuous animation loop or React state update.
- **Toolbar/dialogs:** color, border and pressed feedback use the shared 120ms
  token, with an active-format underline. Native controls, tooltips, keyboard
  behavior, selection protection and focus outlines remain immediate. Native
  editor dialogs use a 260ms opacity cue. Project/profile dialogs remain in their
  separately scoped phases.
- **Save status:** the existing live status text changes immediately and stays
  visible. Its tone transitions gently; no saving spinner or status-text fade is
  added. Local saving, cloud pending, offline, failed-device-save and sync-paused
  meanings are not conflated.
- **Sessions:** existing start/pause/resume/end controls receive restrained
  feedback. An ended session reveals a read-only line of its typed words and
  active time; the existing expandable details stay user-controlled. No live
  counter is animated, no focus moves, and no session operation is added.
- **AI:** an explicit request immediately shows “Preparing guidance…” with a
  static indicator. There is no thinking loop, spinner, simulated wait or delayed
  result. The existing live result region is busy only while the request is
  pending. New result cards and mode descriptions receive a brief opacity cue;
  editing or saving an idea does not replay the card entrance. Mode descriptions
  and allowance text are associated with the selector for assistive technology.
- **Context:** actual project/scope/draft-sharing details remain fully visible
  while a small decorative marker acknowledges a scope/resource change. Consent
  resets, authorized resources, current-text sharing, quota buckets and result
  invalidation use the unchanged handlers. Source previews remain explicit.

New CSS is confined to the editor/coaching/native editor dialog classes, and
uses shared studio colors and motion tokens. It does not activate Phase 5 page,
sidebar, dashboard or Library transitions. Reduced motion removes all new cues;
errors, context, save status and results remain readable throughout.

Affected files: `WritingEditor.tsx`, `CoachingContext.tsx`, the existing
`lib/motion.ts`, and new `styles/editor-polish.css`. There are no backend,
session-clock, word-engine, authentication, billing or entitlement changes.

## Functional evidence

`tests/editor-polish.browser.cjs` exercises the actual production Tiptap editor,
normal keyboard input, selection, IndexedDB and the real workspace/session code.
Isolated API fixtures hold/fail saves and guidance responses without using real
accounts, private writing, AI providers or purchases. Backend policy/context tests
and real SQL/RLS tests complement these browser fixtures; they do not substitute
for a live hosted Supabase integration check.

The dedicated scenarios cover opening/typing with no replay/remount; toolbar
selection and native link/export; truthful held-save/failure/retry/offline states;
non-AI Quick Prompts; explicit AI pending/results while continuing to write;
source preview after explicitly choosing the resource without enabling persistent
AI permission; stale responses after mode/scope changes; error/retry; session
pause/resume/end and summary; reduced motion; five widths, dark mode and Spanish;
full saved JSON and reload with unchanged session identities/counts.

Stale-response tests wait for the actual held response to finish before asserting
that it was ignored. A cache status is not treated as proof of a remote write.
Context text never fades, and guidance is compared against the author's complete
structured document to confirm it has not inserted or rewritten their content.

## Reproduce and interact

```sh
npm --prefix frontend run build
node tests/editor-polish.browser.cjs
node tests/focus-mode.browser.cjs
node tests/project-switching.browser.cjs
```

Use `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE` and `AXE_SCRIPT` for the installed
test tools. `POLISH_RECORD_VIDEO=1` records the actual interactions when
Playwright FFmpeg is installed. Artifacts are under `tests/artifacts/editor-polish`.

```sh
POLISH_HEADED=1 POLISH_PAUSE=1 node tests/editor-polish.browser.cjs
```

This leaves the actual studio open in the Playwright inspector with non-sensitive
test writing. Start a session, write, open the assistant, choose context and
explicitly request guidance, format or reload within that browser context. The
in-memory fixture API ends with the process. This is a local review harness, not
a new product route or a relaxation of authentication/entitlements.

The Vercel branch preview uses the existing team login and an UnoWord account
with editor access. Protection stays enabled. Automated remote account/provider
flows, physical Chrome/Safari/iPad/iPhone, manual VoiceOver/NVDA, and long-session
memory behavior remain unverified. Production stays on its previous release.

## Results and performance

The dedicated suite passes **8 grouped actual-editor scenarios**. The final
candidate also passes **21 Focus Mode scenarios**, **15 project-switching
groups**, and **13 broader browser regression jobs**: workspace, projects,
coaching, studio editor, images, subtitle/copy, session/completion, shell, Home,
Library/Settings, landing, login redirects and Google OAuth. The context/AI/coach
backend suites pass **32 tests**; the real SQL/RLS/project-isolation suite passes.
Production build/type/branding checks pass. Lint retains four existing unrelated
warnings. These results have the isolated scope described above.

The opening test exposed a readiness issue: a mount-time cue could finish while
the new document was still locked by project preparation. It now starts after
the existing hydration/editability effect and readiness gate, with no timer or
new persistence behavior. Real typing is delivered during the full 220ms cue
and settles it before mutation. The stable editor/view and one-entry count are
checked through subsequent edits, saves, sessions and AI operations.

Matched trials compare approved Phase 3 commit `c4c0e84` with this phase,
using the same 52k-character test draft, idle and during a held AI request, at
1440px/390px and normal/4× CPU. Desktop pending trials keep the assistant visible;
mobile trials close the existing modal so the writer can type while the request
continues. Each sample settles layout and reapplies CPU throttling. No
performance trial overlaps another browser test. Geometry is captured in JSON.

The final probe starts in **capture-phase `beforeinput`**, including the editor's
handling before waiting for two animation frames. An earlier diagnostic began
at a later `input` listener and excluded some processing; its timing varied with
work ordering. Both sides of the final comparison use the same earlier probe.
It is not directly comparable to the later-input probes in prior phase reports.

| Viewport / condition | Before p95 | After p95 | 4× before | 4× after |
| --- | --- | --- | --- | --- |
| 1440px idle | 31.2ms | 33.6ms | 191.4ms | 203.0ms |
| 390px idle | 31.9ms | 33.2ms | 198.3ms | 227.3ms |
| 1440px AI pending | 33.0ms | 33.2ms | 331.9ms | 324.9ms |
| 390px AI pending | 33.7ms | 32.3ms | 186.9ms | 200.0ms |

All injected characters and complete persisted structured documents are checked.
Normal-CPU frame-interval p95 is 16.7ms on both sides, with no observed long tasks
or layout shifts excluding recent input. At 4× CPU, each side has 100 long tasks
across the four samples; after frame-interval p95 is 100–166.6ms. This does not
support a 60 FPS claim under CPU pressure. Layout-shift observations are zero.

Some tails increase, including 198.3→227.3ms in throttled mobile idle writing.
These single trials do not establish zero typing overhead or a causal regression.
Real lower-power devices, repeated longer sessions and manual assistive-technology
testing remain an open performance/accessibility validation item before making
production-level guarantees.

Forced-GC heap after four samples is 11,082,680→11,122,624 bytes at normal CPU,
and 11,071,904→11,203,900 bytes at 4×. These short observations cannot prove
absence of memory leaks. The new animation listener is removed on finish/cancel;
no app interval or per-keystroke animation loop is added.

Using the same local gzip settings: entry JS remains approximately 88.79kB,
editor lazy JS is 135.75→136.23kB, and editor CSS 6.75→7.19kB. There is no new
package dependency. Bundle size is not a field page-load/Web Vitals measurement.

Review evidence:

- [25-second actual-editor recording](review/editor-polish/editor-demo.webm)
- [Dedicated scenarios](review/editor-polish/functional-results.json)
- [Focus regression](review/editor-polish/focus-regression.json) and [project regression](review/editor-polish/project-regression.json)
- [Broader checks](review/editor-polish/regressions.json)
- [Full measurements](review/editor-polish/measurements.json)
- [Confirmed pending save](review/editor-polish/saving.png), [AI pending](review/editor-polish/guidance-pending.png),
  [desktop guidance](review/editor-polish/guidance-desktop.png), [mobile dark context](review/editor-polish/guidance-mobile-dark.png)

The protected preview is linked from the Phase 4 review PR. It requires existing
Vercel team and application access. Production remains unchanged, and Phase 5
awaits owner approval.

Beforeinput → second animation frame is a lab observation, not INP; rAF intervals
are not GPU FPS. Single matched trials, local fixtures and short forced-GC heap
snapshots cannot establish zero overhead, field Core Web Vitals, or leak absence.
