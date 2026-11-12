# Phase 8 — Cross-platform motion and final optimization

The owner approved Phases 1–7 and requested Phase 8. This branch stacks on
`feature/motion-supporting` (PR #38). These motion phases remain reviewable drafts;
phase approval has not been treated as permission to merge or deploy.

## Audit and implementation

The audit covers marketing, shell, editor, projects, Library, profile, progress,
rewards, account screens, MV3 and Expo. See the [initial inventory](motion-system.md).
No screens were recreated or dependencies added. Auth, billing, entitlements,
ownership, sessions, tracking and AI-context policies are unchanged.

### Shared foundation

`frontend/src/styles/studio-motion.css` remains the timing/easing source.
`node scripts/sync-motion-tokens.mjs --write` derives extension CSS, Shadow DOM
counter CSS and native constants. Its default/check command fails on drift and
runs before the frontend build. Generated files are committed so extension and
native startup need no web runtime. Existing token values are unchanged.

### Chrome extension

The audit found scattered timings, a perpetual active-status pulse, spring/pop,
chart-height tween and scaled dialogs. A small shared stylesheet replaces these
with bounded color/border/shadow feedback, shallow opacity and a 4px dialog
entrance. Charts/live counts update immediately. The counter consumes shared
values in its existing Shadow DOM. Reduced Motion disables decorative effects.
Tracking, messages, storage and permissions are unchanged.

The actual Spanish-control check also found that translated text did not update
the document language. Shared `applyI18n` now aligns `lang` when translating a
whole document. Source strings and selection semantics are unchanged.

Download candidate **0.24.3** is regenerated from source with matching metadata.
Only the manifest version changed; permissions, host access, content-script
matches and worker configuration are unchanged. No Web Store submission occurred.
Existing unpacked installations require an update/reload after release.

### Existing Expo/iOS client

The native adapter subscribes to `AccessibilityInfo` before its initial async
read; a newer OS event wins a late read. It starts conservatively, handles read
failure and cleans up listeners. Navigation uses the shared fade or `none` under
Reduce Motion. Profile question cues retain inputs; typing/numbers do not drive
animation. Custom-answer and notes inputs now have explicit accessibility labels.

Project/context and writing-tools modals close immediately. Retained native
content has a cancellable native-driver, non-interaction opacity entrance;
visibility never waits on a timer/animation. Preference changes cancel movement.
RN Web retains the original immediate Modal path. A preference change during an
animated RN Web exit left an invisible portal over the next control; immediate
closing removes that dependency. The test harness also sets esbuild's working
directory and supplies Metro's `global` alias for RN Animated. These are harness
fixes, not native application polyfills.

The native editor WebView, keyboard/selection, saving/project queue, sessions and
source authorization remain unchanged. No new native Focus Mode/workspace-switch
animation was added before physical-device verification.

### Web layout refinement

Cold-load attribution found a pending-route margin collapsing through `#root`,
moving BODY during account resolution. A root formatting context contains it
without changing auth/readiness. Narrow Progress metadata reserves two lines to
avoid the summary jumping as date/timezone text resolves. No fake loaded state,
artificial delay or authored-content animation was added.

## Validation and limits

[Review artifacts](review/cross-platform-motion/) distinguish the final matrix,
actual-editor checks, loaded extension, native fixtures and paired measurements.
Fixtures use non-sensitive test documents/accounts, with live QA/provider writes
disabled. They are not live Supabase, Stripe, email, Substack or AI-provider tests.

The final matrix covers **49 jobs**: foundation 12, web 19, editor 8, extension
fixtures 6, mobile 4. It includes build/lint; extension unit/cloud sync/archive;
five SQL suites; account/auth/billing; editor persistence/conflicts/offline;
projects/context; native unit/types/iOS export/screen fixtures. Backend:
**583 passed, 70 skipped, 7 warnings**. Skipped infrastructure/live tests are not
passes. Native units: **34 passed**. iOS export is not device runtime, signing,
distribution or App Store approval.

| Additional final motion suite | Result | Coverage |
| --- | --- | --- |
| Shared foundation | Passed | Keyboard, portals, dismiss/focus return, reduced motion, dark, five widths, 200% CSS magnification, repeated cleanup |
| Focus Mode | 21 scenarios | Short/long drafts, selection/scroll, real typing, active/paused sessions, autosave/reload, editor identity, responsive/reduced motion |
| Project switching | 15 groups | Immediate switch after typing, failed/slow/offline writes, repeated switches, sessions, completion, ownership, reload, context isolation |
| Editor/AI | 8 groups | Truthful saves, input/formatting, explicit consent, stale requests, sources, sessions |
| Navigation | 8 groups + departure guard | Drawer/routes/search/dialogs; failed save blocks departure, slow save completes before navigation |
| Marketing | 7 groups | Entrances/reveals, CTA routes/FAQ, reduced motion, no-JS fallback, five widths, targeted axe |
| Supporting | 5 groups | Profile persistence/offline, metrics/rewards settings, explicit billing, dark/Spanish, targeted axe |

Original required editor demonstrations remain available for
[Focus Mode](review/focus-mode/editor-demo.webm) and
[project switching](review/project-motion/editor-demo.webm). Fresh Phase 8 JSON
records their reruns against isolated APIs; this is not live persistence evidence.

### Loaded MV3, separately tested

Actual unpacked extension in Chrome for Testing **151.0.7922.34**, Linux,
disposable profile, external DNS blocked. Native action popup: observed viewport
**430 × 510**, scrollWidth 430. Five groups verify constraints; four actual
keyboard-entered words after closing the popup and the same worker session;
pause/resume/end with one history row; editor-origin suppression; and actual
Spanish controls/dark/Reduce Motion without running animations. Popup buttons use
CDP DOM activation with user gesture; content typing uses keyboard events.

The editor-origin check intercepts the canonical editor URL with a synthetic
textarea and exercises the real suppression branch, not an authenticated editor.
No Chrome API is mocked in this test. This is not proof of worker suspension/
restart recovery, retail Chrome installation, Web Store distribution, manual
browser UI interaction or signed-in cross-device sync. Fixtures separately check
sync/account isolation. Managed Chromium here blocks unpacked extension loading;
Chrome for Testing was used for the real loaded runtime.

### Native/accessibility boundaries

RN Web fixtures render real native components/provider and offline Tiptap bridge
at **320/390/820/1180px**. They test typing, project creation/context, Reduce Motion
changes during dialogs, close/reopen, retained profile answers, paid gating, dark,
overflow and JS errors. Screenshot `iphone`/`ipad` names denote viewport fixtures,
not physical iOS. Targeted axe, keyboard, touch sizes, reduced motion and CSS
magnification pass in relevant browser suites; they do not prove complete WCAG
conformance. VoiceOver/TalkBack, native selection handles, virtual keyboard,
physical iOS timing/memory and prolonged writing remain unverified.

### Failures investigated

- Backend environment lacked Stripe/reportlab; installing the existing exact
  pinned requirements produced the result above.
- Lifetime expected an older heading; only that expectation changed to approved
  copy. Refund, billing and entitlement assertions remain intact.
- An extension offline aggregate request-count check failed in an early concurrent
  run. Added endpoint diagnostics; strict isolated and full six-job retries pass.
  Its original cause is unverified.
- Foundation reduced-motion Select dismissal failed initially; its unchanged
  strict retry passes. No source/assertion was weakened; cause remains unverified.
  Monitor these two transient checks in CI.
- Native modal/preference and fixture issues were corrected as described above;
  the native matrix was rerun. The actual Spanish test now waits for visible
  Spanish and matching document language before capture.

## Performance evidence

Paired trials compare approved Phase 7 production bundle
`c7aaa638a167d2e5824a4b565b4699f21e96b938` against this working tree, sequentially,
without video/competing browser jobs. Profile/Progress: cold cache, 150ms latency,
1.6Mbps, desktop/mobile, 1×/4× CPU. Editor: 52k-character document, 25 actual input
events per condition, desktop/mobile, idle/held AI. Raw files record scope/counts.
Input-to-second-rAF is not field INP; frame intervals are not GPU FPS; short heap
snapshots do not prove leak absence. Single pairs do not establish statistical
non-inferiority. No field Core Web Vitals or physical-device results are claimed.

| 1× CPU cold-load metric | Before | After |
| --- | ---: | ---: |
| Desktop Library/profile CLS | 0.12338 | 0.00563 |
| Mobile Library/profile CLS | 0.17727 | 0.01876 |
| Mobile Progress CLS | 0.02821 | 0.00102 |
| Desktop Progress CLS, original pair | 0.06294 | 0.11157 |
| Mobile profile LCP | 5504ms | 5488ms |
| Mobile Progress LCP | 5516ms | 5516ms |

The 4× pair repeats the Library/mobile Progress shift reductions. Desktop
Progress is variable: its 4× pair is 0.05579 on both builds; follow-up 1× attribution
runs are 0.05579/0.05579 before and 0.05579/0.06294 after. They trace the existing
chart/card load pushing the detail grid below the viewport. The original worse
sample is retained above, not discarded. Desktop Progress shift and slow cold
mobile loading remain open optimization items. LCP in the throttled desktop
profile also varies (2904 → 6072ms in this single 4× pair), while Progress varies
in the opposite direction (6332 → 2708ms). These samples do not establish a load
speed improvement or cause; investigate chunk/font/data scheduling separately.

| Editor 1× CPU, input-to-second-frame p95 | Before | After |
| --- | ---: | ---: |
| Desktop, idle | 34.0ms | 32.2ms |
| Mobile, idle | 29.3ms | 31.1ms |
| Desktop, held AI | 32.2ms | 34.1ms |
| Mobile, held AI | 36.0ms | 35.1ms |

All 100 input events per build preserve exact content and confirmed persistence.
Both builds record zero typing-trial layout shifts/long tasks; frame p95 is
16.7–16.8ms. Mixed input changes of roughly 2ms do not prove zero latency overhead.
Forced-GC editor heap grows 10,118,676 → 11,143,868 bytes before and
10,076,596 → 11,160,576 after; not a long-session leak test. Foundation preview:
frame p95 16.7ms, synthetic action-to-commit p95 2ms, CLS 0, no long tasks, heap
+902,408 bytes after repeated cycles. This is scheduler/short-heap evidence only.

No runtime JS is added to the main web/editor chunks: entry remains 285,139 bytes,
AppShell 12,128 and WritingEditor 414,749; gzip differences of 1–2 bytes reflect
chunk names. Extension ZIP grows 237,225 → 238,780 bytes. Native token/adapter
code adds no dependency. See `bundles.json` and raw paired measurements.


## Reproduce and review

1. `npm --prefix frontend run build` checks token drift first. Regenerate with
   `node scripts/sync-motion-tokens.mjs --write` after a shared token change.
2. `node tests/run-redesign-regression.cjs` with existing Playwright/Chromium/axe,
   Python and PGlite paths configured. Live QA stays disabled.
3. `node tests/motion-extension-runtime.browser.cjs` with
   `EXTENSION_CHROME_EXECUTABLE` pointing to extension-enabled Chrome for Testing.
4. Native: `npm --prefix apps/mobile test`, `run typecheck`, `run export:ios`;
   `node apps/mobile/tests/native-ui.browser.cjs` for component/bridge fixtures.
   Use the existing Expo setup and `npm --prefix apps/mobile run start` for devices.
5. Review protected PR preview routes `/`, `/app`, `/editor`,
   `/library?view=profile`, `/progress`, `/rewards`, `/settings`. Use the existing
   sign-in flow if authorized. Local results do not imply hosted account testing.

### Physical review required for full cross-platform sign-off

- Real iPhone/iPad, portrait/landscape, light/dark, EN/ES, native stack and dialogs;
  OS Reduce Motion off/on/changed while open; VoiceOver, touch, focus/dismissal.
- Short/long non-sensitive documents: selection/middle scroll, typing during UI
  changes, keyboard open/close, responsive panels; actual input/frame/memory
  comparison, no remount, lost characters or unexpected scrolling.
- Save/reload, offline/reconnect, failed/slow saves, active/paused sessions, rapid
  project changes, correct ownership/context and no duplicate sessions.
- Authorized live-account smoke test for auth/sync/provider billing; subscription
  changes require the existing explicit purchase/confirmation flow.
- Retail Chrome unpacked update, popup close/reopen, worker suspension/restart,
  permissions, supported-site counting and signed-in synchronization.

Software review and physical cross-platform acceptance remain separate.
Production release requires explicit approval.
