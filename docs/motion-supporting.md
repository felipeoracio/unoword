# Phase 7 — Supporting experiences

Subsequent status: the owner approved Phase 7 and requested
[Phase 8 — Cross-platform motion and final optimization](motion-cross-platform.md).
The Phase 7 record below describes its original review boundary.

The owner approved Phase 6 and requested this separately reviewable phase.
It stacks on PR #37; the approved motion phases remain unmerged drafts.
Production deployment and Phase 8 cross-platform optimization require separate
approval. Extension/iOS and their storage, messaging and permissions are unchanged.

## Audit and implementation decisions

Guided Writing Profile already caches answers in IndexedDB and queues explicit
saves through the project workspace. Custom answers and notes are always visible;
single-choice custom text clears that question's selected option. Those semantics
are preserved, including Back, Skip, previous free-text profile, offline recovery,
owner isolation and revisioned saves. A retained question wrapper receives a
220ms, 0.98 → 1 cue when its actual question identity changes. Completion uses
the same hook; typing, checkbox values, answered counts and save labels do not
drive animation. The wrapper retains the original label spacing. Profile buttons
now have 44px minimum height. Selected options and keyboard focus use the existing
studio tokens; the native progress fill uses the shared accent instead of the browser-default green. Checked and progress values change immediately. No custom
answer is newly hidden or conditionally unmounted to create a decorative reveal.

`useSurfaceCue` reuses the existing duration/easing/reduced-motion utility. It
does not delay readiness, move focus, schedule a timer or remount a keyed view.
Input settles an active cue. Effect cleanup cancels old motion during rapid
changes/unmount; the shared helper removes its media listener on finish/cancel.
Existing motion tokens remain unchanged and no dependency is added.

Progress cues the retained trend card when the actual validated reporting range
becomes available, and the chart only on deliberate measure changes. Initial
chart appearance shares its parent cue. Refresh/polling within the same range
does not replay the chart or summaries; numbers, goal fill and bar heights are
never tweened. Native chart tables/counting explanations and selected-data text
get a brief opacity entrance; accessible text alternatives remain intact.
Session, daily and lifetime time, timezone/date rules and Free access stay owned
by the existing hooks and server response validation. No writing/session engine
is mounted just to show progress, and viewing Progress does not claim a reward.

Rewards already claim real eligible achievements once, suppress historical
backfills, respect enabled/celebration/widget preferences, clear on dismiss and
automatically dismiss after the existing ten seconds. In the editor they remain
suppressed while a writing session is active. That logic, claim payload, timeout
and preference mutation/CAS are unchanged. Only an existing claimed toast receives
a 220ms entrance and its badge a restrained 650ms reveal; ordinary badge lists,
progress values and poll refreshes do not replay a celebration. Both animations
stop for reduced motion. Toast color/link surfaces inherit studio tokens and its
dismiss target is at least 44px; no flashing, confetti, sound, rank or loop was added.

The existing modeless Writing Tour keeps its same aside and editor. A step cue
uses actual step/open state, rather than the number of words typed. Existing
first-sentence recognition remains based on real typing, not paste. The existing
tour achievement animation now uses the shared panel token with shallow opacity,
without moving the editor or stealing its cursor. Launcher, pause/resume, hide,
session reuse, optional/skipped steps and preferences are unchanged.

Substack connection cues use verified connected/active/pending status, not email
or code text or polling object identity. Native forms and input nodes remain;
invalid-code errors remain immediate. A held verification cannot display a
connected subscription early. The existing owner checks, code expiry, proof
retry, explicit cancel/disconnect and access refresh are untouched. Stripe
confirmation and portal behavior remain explicit and do not run because of
motion. Native subscription/reward controls share bounded color/border feedback.
Targeted noncritical status notices use the panel cue; no generic global live
region/error animation or artificial success/loading state was introduced.

Affected modules: GuidedWritingProfile, Progress/ProgressTrend, WritingTour,
ConnectSubstack, rewards/onboarding/project styles, the new shared surface-cue
hook and small globally imported `supporting-motion.css`. Shared UI components,
tokens, typography and native semantics are reused; there is no new component
library, route, backend, data schema, authorization or analytics change.

## Reproduce and review

```sh
npm --prefix frontend run build
node tests/supporting-motion.browser.cjs
SUPPORT_MOTION=1 node tests/run-redesign-regression.cjs web onboarding
```

Set `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `AXE_SCRIPT` and `PGLITE_ROOT` to
the installed browser/axe/SQL runtimes. `SUPPORT_RECORD_VIDEO=1` records the actual
UI and the optional tour run. `SUPPORT_HEADED=1 SUPPORT_PAUSE=1` leaves a local
profile preview open with synthetic catalog/verification data. No email is sent
and no live account or subscription is changed by this fixture harness.

The performance script accepts `SUPPORT_LAB_LABEL=before`,
`SUPPORT_LAB_DIST=/path/to/approved/phase6/dist`, and `SUPPORT_CPU_RATE=1` or `4`:

```sh
node tests/supporting-motion-performance.browser.cjs
```

Production React/Tiptap, native keyboard input and IndexedDB are exercised with
isolated synthetic account/persistence/provider responses. These are not live
Supabase, signup, email, AI or payment verifications. The existing rewards browser
suite separately evaluates real reward SQL in PGlite. Physical devices, native
Chrome/iOS, manual VoiceOver/NVDA, browser zoom and long-session memory remain
unverified and belong in the final cross-platform review. Preview protection and
account permissions remain enabled; no protection bypass or production merge.

## Results and measurements

The dedicated production-browser suite passes five grouped workflows:

1. Profile choices/custom answers, retained input node while typing, held save,
   Back/Skip, single-choice behavior, offline queue/reconnect and reload.
2. Validated chart range/measure changes, immediate numeric/fill updates, no
   refresh replay or reward claim, and accessible chart data.
3. Real claim-response celebration, 44px dismissal, quiet historical/polling
   behavior, disabled rewards and retained preferences.
4. Invalid/held subscription verification, no premature connected state, stable
   input/polling, and explicit Stripe confirmation.
5. Profile, Progress, Rewards and Settings at 1440/1024/768/390/320px; dark mode,
   Spanish Settings, axe A/AA checks, live reduced-motion cancellation and
   functional reduced-motion profile/chart/celebration controls.

Eight final broader web jobs pass: Home, Progress, Library/Settings, onboarding,
Substack, rewards, account security and billing. Onboarding runs with additional
motion assertions: the same tour aside survives step changes and typed-word
updates do not replay its 220ms cue; real Tiptap typing still saves without focus
loss. The rewards job executes its existing migration/evaluation/claim tests in
PGlite, separate from the synthetic notification response in the dedicated suite.

The audit corrected original label spacing when adding the question wrapper,
ensured actual 44px profile controls, branded the native progress fill, and fixed
two dark reward links with measured contrast 2.56:1 by using the existing theme
link token. Initial test-fixture issues were corrected without weakening product
checks: full statistics/timezone and quota response shapes are supplied; async
reward preferences are awaited until confirmed; textarea identity uses a stable
node locator after validating its label; theme setup now preserves explicit
changes across navigation. No data/authorization validator was removed.

The final actual-editor suites also pass all 21 Focus Mode scenarios, 15
project-switching groups and eight editor/AI groups. Navigation passes eight
groups plus the failed/held-save actual Tiptap departure guard; all seven
marketing motion groups pass. Build/TypeScript/SSR/prerender and lint pass, with
four existing lint warnings. See [full regression results](review/supporting-motion/regressions.json)
and the [actual tour log](review/supporting-motion/writing-tour-regression.log).

### Matched local performance

Approved Phase 6 commit `839aa51` is the baseline. Both builds use the same
production Chromium setup and isolated catalog APIs, cold cache, 150ms latency,
1.6Mbps download and normal/4× CPU. Profile samples contain 26 actual native input
events and eight question changes; chart samples contain eight native selections.
Question/chart readiness measures actual event → rendered content, independent
of the 220ms decorative duration. These are single trials, not statistical proof
of a speedup, field INP or physical-device equivalents.

| Width / measure | Normal before → after (ms) | 4× CPU before → after (ms) |
| --- | ---: | ---: |
| 1440 / profile input → second frame p95 | 32.3 → 33.1 | 32.0 → 29.2 |
| 390 / profile input → second frame p95 | 32.5 → 32.2 | 31.0 → 29.0 |
| 1440 / question ready p95 | 1.0 → 1.8 | 4.3 → 8.7 |
| 390 / question ready p95 | 1.1 → 1.6 | 5.0 → 7.6 |
| 1440 / chart measure ready p95 | 2.3 → 2.6 | 11.5 → 14.5 |
| 390 / chart measure ready p95 | 2.2 → 3.4 | 14.0 → 17.3 |

Question and chart changes have small measured additional processing, without
waiting for animation completion. All typed characters and retained input nodes
were verified. Profile interaction samples recorded no long tasks or qualifying
layout shifts; frame-interval p95 was 16.7–16.8ms, which is not a GPU FPS claim.
Startup still has long tasks/layout shifts, recorded separately below.

The actual 52k-character editor control used an active writing session and 25
input events per condition, with isolated persistence and held AI-response APIs:

| Editor condition | Before → after input-to-second-frame p95 (ms) |
| --- | ---: |
| Desktop idle | 31.1 → 33.3 |
| Mobile idle | 34.0 → 32.3 |
| Desktop AI pending | 35.9 → 35.5 |
| Mobile AI pending | 49.0 → 30.8 |

All legitimate characters persisted. Candidate editor samples had no recorded
long tasks or qualifying layout shifts. The mixed/small sample does not establish
zero typing overhead; desktop idle was 2.2ms higher in this pair.

### Outstanding initial-load behavior

| Width / view | Normal observed LCP before → after (ms) | 4× CPU before → after (ms) |
| --- | ---: | ---: |
| 1440 / Profile | 2716 → 2732 | 2876 → 2932 |
| 390 / Profile | 5424 → 5488 | 5756 → 5852 |
| 1440 / Progress | 2588 → 2616 | 2688 → 2732 |
| 390 / Progress | 5532 → 5544 | 6032 → 5992 |

Cold private-page loads already shift during auth/data/artwork loading. Profile
initial layout-shift sum was 0.123–0.177 before and 0.123–0.177 after; Progress
0.028–0.063 before and 0.028–0.056 after. These are not resolved Web Vitals goals.
They remain a Phase 8 performance-review item; no large shell/loading rewrite is
included in this motion phase. The raw initial and interaction observations are
kept separate, rather than reporting only the no-shift interaction interval.

Entry JS gzip changed 89,799 → 89,808 bytes, entry CSS 27,319 → 27,619 bytes.
The shared lazy surface-cue module is 326 bytes gzip; editor JS changed
136,056 → 136,098 bytes and its CSS is unchanged. No dependencies were added.
Forced-GC snapshots are in the raw report; short samples do not prove leak
absence or stability through long writing sessions.

### Review evidence

- [Supporting interactions recording, 23.84s](review/supporting-motion/supporting-demo.webm)
- [Actual writing-tour interactions, 13.64s](review/supporting-motion/writing-tour.webm)
- [Profile](review/supporting-motion/profile-desktop.png),
  [Progress](review/supporting-motion/progress-desktop.png) and
  [subscription](review/supporting-motion/subscription-desktop.png) screenshots
- [Dark Spanish Settings](review/supporting-motion/settings-mobile-dark-es.png)
  and [dark celebration](review/supporting-motion/reward-dark-mobile.png)
- [Dedicated results](review/supporting-motion/functional.json) and
  [matched measurements](review/supporting-motion/measurements.json)

Recordings use real production UI and non-sensitive fixture records. The draft
PR links the protected preview and final regression report. Production remains
unchanged. Phase 8 remains unstarted pending owner approval.
