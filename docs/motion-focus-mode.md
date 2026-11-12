# Phase 2 — Signature Focus Mode

Phase 2 was subsequently approved. Phase 3's interaction tests found that the
production CSS minifier expresses the Focus token in seconds; the shared time
reader is corrected and the full 420ms behavior is reverified in
[the Phase 3 report](motion-project-switching.md). The earlier measurements below
describe the Phase 2 bundle as it was tested, before that correction.

Phase 1 was approved by the owner. This is the separately reviewable Phase 2;
Phase 3/project switching and production deployment are not part of this change.

## Implementation

- `useFocusMode` snapshots paper and scroll geometry only at mode changes. It
  uses the approved 420ms token and a horizontal Web Animations API transform,
  without scaling or fading typed text. It does not read or write editor content,
  ProseMirror selection, autosave queues, sessions, document ownership or AI scope.
- The paper keeps its existing reading measure. Space vacated by project and
  formatting controls becomes a scrollable margin: the viewport expands without
  moving the current lines vertically or repeatedly rewrapping them. Short
  writing keeps its starting position; the extra margin can be scrolled away.
- Navigation, library, assistant, toolbar and nonessential header controls fade
  and become inert/aria-hidden immediately. Retained nodes keep panel state;
  they are not keyboard reachable while fading. The editor remains mounted.
- Save status, Retry, session controls and the discreet Focus exit remain
  accessible. Pointer activation preserves editor focus/selection. Keyboard
  activation returns focus to the existing caret. Escape exits Focus Mode and
  restores the original panel state; Escape inside an open dialog is unchanged.
- Rapid reversals begin at the current visual position. No completion callback
  restores stale scroll or selection after the writer has typed or scrolled.
- Reduced motion removes the fades and paper transform, including a preference
  change during an in-progress transition. Animations and the media listener are
  canceled/removed at unmount. No animation dependency or continuous app loop is
  added; no layout animation runs per keystroke.

## Functional editor verification

`tests/focus-mode.browser.cjs` opens the **actual production Tiptap editor** with
non-sensitive short and 360-paragraph imported documents. It uses normal editor
controls, keyboard events, real DOM selection and scroll, IndexedDB and the
existing workspace/session code. Isolated API endpoints record document and
activity persistence, avoiding real users, providers or purchases. This is not
a claim of live Supabase end-to-end persistence or physical-device verification.

The flow checks selection endpoints/text, line boxes on sampled animation frames,
paper width, DOM and Tiptap view identity, ProseMirror document identity, exact
serialized saved content and reload behavior. It separately waits for session
API persistence; document “Saved” is not used as proof of an activity checkpoint.

Required coverage: short and middle-scrolled long documents; selection/caret;
typing during the transition; exact character and five-word delta; autosave;
active/paused sessions and elapsed-time tolerance; sidebars restored; desktop,
tablet and mobile widths; keyboard/Escape and accessibility; reduced motion;
no remount/reflow/vertical jumps; intentional scrolling/rapid reversals; failed
save/retry; offline edits, reconnect and full reload.

Resolved during testing: Escape previously also closed the assistant; exiting
Focus now preserves its prior open state. Moving project controls into a fade
container required retaining their original desktop/mobile CSS selectors.
ProseMirror consumes Escape while typing; the scoped capture handler now exits
Focus without changing selection, and respects dialogs and IME composition.
The first long-document performance trial exposed repeated style invalidation:
geometry reads are now batched before writes, with values scoped to their own
panels rather than inherited from the entire editor root. Normal-CPU trials
after that change recorded no long tasks during the measured transitions.
Empty paragraphs in imported writing are skipped when choosing a text selection
for the test. Hidden controls are checked for inertness and final visibility,
instead of requiring their removal from the DOM.

## Reproduce and interact

Build the app, then run with the existing Playwright/Chromium installation:

```sh
npm --prefix frontend run build
node tests/focus-mode.browser.cjs
```

Supply `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE` and `AXE_SCRIPT` as appropriate
for the test environment. `FOCUS_RECORD_VIDEO=1` records actual editor interactions
with Playwright FFmpeg installed. For a working local, interactive test studio:

```sh
FOCUS_HEADED=1 FOCUS_PAUSE=1 node tests/focus-mode.browser.cjs
```

The test leaves the real editor open in the Playwright inspector with isolated
test documents. Resume typing, enter/exit Focus, pause/resume a session, and
reload within that browser context. Closing the process ends the in-memory test
API; this is a local review workflow, not a production account or a new product
route. Test outputs/recordings are under `tests/artifacts/focus/`.

The Vercel branch preview uses `/editor` with existing team/application access.
Its access protection must stay enabled. No production credentials are included
in the test harness; automated live account/provider interactions are unverified.

## Measurements and approval

Before/after runs use the Phase 1 production bundle and this Phase 2 bundle in
the same browser lab, with non-sensitive drafts and 4× CPU slowdown. Input to the
second animation frame is a lab latency observation, not INP; rAF intervals do
not measure GPU FPS. Single samples do not prove zero latency increase.

The final dedicated suite passes **21 scenarios**, including all 15 requested
workflow categories. The tested long document has 360 non-sensitive paragraphs;
the final author content is compared with the persisted structured document and
then reopened after a full page reload. Normal typing adds exactly five words;
paused typing changes the document without adding session words or active time.
Session identities remain stable, active time follows elapsed wall time within
the test tolerance, and no AI-generation request occurs.

The wider regression covers full writing workspace, studio layout, session and
completion, subtitle/copy, projects, coaching, shell, landing and login redirects.
The tests now wait for a fade to finish before checking final visibility/contrast,
and for the existing project restoration gate before editing a restored paused
document. That gate and the editor's actual editability rules are unchanged.

### Matched transition measurements

Each cell is p95 input-event → second-animation-frame time while typing during a
mode transition. Normal CPU and 4× CPU are separate matched trials against the
preserved Phase 1 bundle. The injected text and persistence checks are identical.
These are single lab trials, not statistical proof of zero overhead or INP.

| Viewport/direction | Normal before | Normal after | 4× before | 4× after |
| --- | --- | --- | --- | --- |
| 1440px enter | 26.3ms | 23.5ms | 84.6ms | 86.8ms |
| 1440px exit | 26.1ms | 27.7ms | 108.3ms | 68.5ms |
| 768px enter | 28.2ms | 28.6ms | 83.5ms | 82.3ms |
| 768px exit | 26.6ms | 26.7ms | 120.3ms | 80.5ms |
| 390px enter | 27.1ms | 28.8ms | 76.1ms | 91.0ms |
| 390px exit | 27.1ms | 26.8ms | 89.0ms | 93.9ms |

Normal-CPU frame-interval p95 was 16.7ms before, 16.7–16.8ms after. No long tasks
or layout shifts excluding recent input were observed in either normal-CPU
transition trial. The 4× trials recorded 144/147 long tasks across all six
samples; normal-CPU smoothness is not a guarantee under artificial CPU pressure.
Text/view/selection geometry is also checked directly on sampled frames, rather
than relying on the layout-shift metric, which excludes recent user input.

Forced-GC heap after six transitions plus real typing: 11,196,188 bytes before,
11,206,724 after at normal CPU; 11,066,812 before, 11,038,416 after at 4× CPU.
These short snapshots do not prove long-session memory stability.

The separate existing 52,850-character typing control at 4× CPU measured p95
159.9→139.4ms (1440px) and 169.7→169.5ms (390px). Its navigation probe observed
different cache/resource work and LCP candidates, so its navigation/load values
are retained as diagnostics in the JSON and are **not** a valid causal speedup
or regression claim. Entry JS remains 88.91kB gzip. The editor lazy JS grows
98.03→98.91kB gzip; its CSS grows 6.11→6.42kB. No runtime library is added.

Manual VoiceOver/NVDA, physical Safari/iPad/iPhone, long-session memory and live
Supabase persistence remain unverified. Native extension/iOS changes belong to
later phases. Owner approval is required before Phase 3 begins.

## Review evidence and preview

All **9 final regression jobs passed** on the final implementation (six editor
flows and three shell/landing/login flows). Frontend build/type/branding checks
pass; lint retains the four existing unrelated warnings. No backend, billing,
entitlement, session-clock or autosave hook is changed.

- Actual-editor recording: [editor-demo.webm](review/focus-mode/editor-demo.webm)
- Scenario results: [functional-results.json](review/focus-mode/functional-results.json)
- Before/after measurements: [measurements.json](review/focus-mode/measurements.json)
- Broader regression results: [regressions.json](review/focus-mode/regressions.json)
- Settled desktop/mobile/dark screenshots: `docs/review/focus-mode/`

Vercel preview: https://unoword-git-feature-motion-focus-mode-unoword.vercel.app/editor

It requires the existing Vercel team login and an application account with editor
access. Automated interaction tests were performed locally with isolated APIs;
the protected remote account/editor workflow is unverified. The headed harness
above provides a working actual-editor preview with non-sensitive sample data
and no production account. Production remains on its previous approved release.
