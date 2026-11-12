# Phase 5 — Application navigation

The owner approved Phase 4 and requested this separately reviewable phase.
It builds on PR #35. Production deployment and Phase 6 marketing motion require
separate approval; extension/iOS and supporting profile/reward work remain in
their planned phases.

## Audit and implementation

The application already uses page-owned `AppShell` instances, a 232px desktop
sidebar, the editor's 76px rail, a native mobile navigation dialog below 900px,
shared studio components/tokens, Library view queries, native Settings hash
anchors, project queues and an editor `beforeNavigate` save gate. Those contracts
and route destinations are retained; no router wrapper or keyed route tree is
introduced. No dependency, backend, subscription, permission, session or word
engine change is needed.

- **Page entry:** non-editor content receives a 280ms opacity cue from 0.98 to 1,
  using the existing page token and shared reduced-motion utility. It remains
  readable and interactive throughout. There is no exit delay, blank intermediate
  screen or artificial loading state. It runs on mount/path change, not for
  theme, hash, query, data polling or typing. Input settles an active cue. The
  writing editor keeps its separately approved opening/focus/project behavior.
- **Desktop sidebar:** a shared button toggles full labels and a compact 76px
  navigation rail on non-editor pages. Labels, destinations, active indicators,
  tooltips and accessible names remain available. Its `aria-expanded` state and
  keyboard focus follow the existing nodes. Layout changes immediately; a 260ms
  opacity cue acknowledges the change without tweening layout dimensions.
  The browser stores only an optional visual boolean under
  `uno-studio-navigation-compact`, alongside existing browser visual preferences.
  It is written only after an explicit collapse/expand choice, not on login or
  page mount; authentication still stores no credentials/tokens in browser storage.
  Storage failure does not block the control. Editor rail and Focus Mode geometry
  are unchanged; no hidden mobile sidebar animation runs.
- **Mobile drawer:** the existing native dialog/focus trap/Escape/outside-close
  receives a 6px, 260ms entrance and a brief backdrop fade. Closing, choosing a
  route and returning focus remain native/immediate; no animation callback gates
  navigation. Mobile always keeps full labels regardless of desktop compact mode.
- **Navigation/cards:** links, tabs, dashboard cards, project cards and Library
  actions use bounded shared color/border/shadow transitions. Interactive cards
  show a focus/hover boundary. There are no animated counters, progress widths,
  result-list entrances or card transforms that move pointer targets.
- **Library:** choosing a different view cues the existing panel at 220ms.
  Its first mount uses the page cue instead; fetching, searching, filtering,
  pagination, processing or permission changes do not replay every result.
  Source permission/readiness text stays immediately readable. Preview cues follow
  actual preview data. Guided profile questions are left for Phase 7.
- **Projects:** deliberate card/detail-tab selection cues the retained detail
  panel. Search, refresh, form typing and hidden editor project panels do not
  animate. Creation forms receive a brief entrance. Existing create/archive/restore,
  selection, queue/CAS and resource-assignment behavior is untouched. No visual
  delay removes data before its existing operation is confirmed/reversible.
- **Settings:** the existing hash/focus handler briefly marks its actual target
  border, without remounting forms or fading billing/security information.
  Router `pushState` did not reliably update CSS `:target`; a temporary DOM
  attribute follows the existing target and is removed on navigation/cleanup.
  No recovery, preference or subscription operation runs because of motion.

The existing `revealOpacity` accepts an optional shared duration token; Phase 4
callers retain their 220ms default. Temporary media listeners are removed after
finish/cancel. Reduced motion removes the new cues while controls remain usable.
There are no new application timers, continuous loops or animation dependencies.

Affected modules: `AppShell`, `Library`, `ProjectManager`, the shared motion
utility and new `styles/navigation-motion.css`. Existing studio spacing, colors,
typography, artwork and breakpoints remain the source of truth.

## Functional evidence and limits

`tests/navigation-motion.browser.cjs` opens the actual production Home, Library,
Projects and Settings UI with isolated accounts/catalog APIs, followed by a real
Tiptap editor departure test with IndexedDB and isolated persistence endpoints.
These are synthetic non-sensitive records, not live Supabase/provider/account,
billing, email or physical-device verification.

Scenarios cover shared timing and no replay on data changes; desktop collapse,
keyboard/focus and reload persistence; unchanged form nodes/values; source
permissions and processing; previews; stable search results; project creation,
archive/restore without moving writing or changing the active project; Settings
anchors and explicit billing/security actions; responsive EN/ES/themes; native
mobile focus containment/return; reduced motion; account isolation and Free gates.

The editor guard deliberately fails a cloud save and then holds it longer than
the page motion duration. Navigation stays in the editor with the full draft;
only after confirmed persistence does it leave. Complete structured content,
session identities and exactly five legitimately typed words are checked. No
AI request, source permission or subscription mutation is introduced.

The inverse sidebar control also receives a contrast/hover check: the shared
ghost button's expanded state otherwise applied a light background underneath
white navigation text. Its inverse surface stays scoped to this control; other
shared button variants remain unchanged.

## Reproduce and review

```sh
npm --prefix frontend run build
node tests/navigation-motion.browser.cjs
```

Set `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE` and `AXE_SCRIPT` for installed
tools. `NAV_RECORD_VIDEO=1` records both studio navigation and the actual editor
guard with Playwright FFmpeg installed. Outputs live under
`tests/artifacts/navigation-motion/`.

```sh
NAV_HEADED=1 NAV_PAUSE=1 NAV_SKIP_GUARD=1 node tests/navigation-motion.browser.cjs
```

The headed harness leaves the studio open with non-sensitive catalog/project
data for reviewing navigation, forms and Settings. It is a local review workflow;
the fixture API ends with the process. The protected Vercel branch preview uses
an existing Vercel team login and an UnoWord account with the relevant access.
Authentication and preview protection remain enabled.

Live hosted Supabase/provider/billing flows, real Chrome/iPad/iPhone, manual
VoiceOver/NVDA and long-session memory behavior remain unverified. Backend and
data rules are preserved and tested using the existing isolated suites.

## Results and measurements

Final working-tree verification:

- Eight navigation scenario groups and the actual-editor failed/slow-save
  departure guard passed. The full structured draft persisted before leaving;
  session IDs stayed unchanged and exactly five newly typed words were counted.
- Existing signature suites passed: 21 Focus Mode, 15 project-switching and eight
  editor/AI scenario groups. These exercise actual production Tiptap interactions
  against isolated persistence/provider fixtures, not live services.
- All 18 final broader browser jobs passed: seven editor and eleven web jobs,
  including auth redirects/security, billing, rewards, Library and landing flows.
  The full workspace job ran in isolation. Backend context/coach tests passed
  32/32; the existing PGlite project/RLS/context/CAS suite passed.
- Production build/type check passed. Lint passed with four existing warnings.
  Axe checks passed at 1440, 1024, 768, 390 and 320px, including dark/Spanish cases,
  native drawer keyboard focus and reduced motion. Automated checks do not replace
  manual screen-reader or physical-device review.

Earlier exploratory full-workspace runs failed a deletion-counter wait and an
aggregate Free-downgrade request-count assertion following two-tab recovery. The
final isolated run and a control against the approved Phase 4 bundle passed;
these earlier failures' causes remain unverified. Diagnostic output was added
without weakening assertions. They are retained in the results summary, and
live entitlement isolation or stability under concurrent test load is not claimed.
A missing PGlite environment variable was corrected for rewards. The billing
storage assertion found and prompted the explicit-choice-only preference-write
fix described above. Contrast and Settings targeting failures were fixed and
rechecked. See [regression details](review/app-navigation/regressions.json).

### Before/after performance

Sequential local Chromium production trials compare approved Phase 4 commit
`34742e3080a24beb6dc47ec09586e5b58a1a2802` with this final working tree. The same
isolated APIs and normal/4× CPU settings were used without competing browser
suites. Heading readiness starts at the actual link click; opening the mobile
drawer, initial loading and full API/data readiness are excluded. Each cell is
one route trial, not a statistically established latency improvement.

| Width / route | Normal before → after (ms) | 4× CPU before → after (ms) |
| --- | ---: | ---: |
| 1440 / Library | 58.9 → 55.9 | 241.3 → 272.5 |
| 1440 / Settings | 76.1 → 79.6 | 248.4 → 192.4 |
| 1440 / Home | 38.0 → 38.5 | 138.8 → 122.8 |
| 390 / Library | 24.0 → 29.2 | 135.2 → 117.1 |
| 390 / Settings | 35.5 → 37.5 | 159.2 → 211.6 |
| 390 / Home | 42.1 → 44.2 | 160.3 → 208.0 |

Normal runs recorded no long tasks or recent-input-excluding layout shifts.
Frame interval p95 was approximately 16.7ms except desktop Settings (24.1ms
before, 33.3ms after). Under 4× CPU the before/after runs recorded eight/nine long
tasks; final frame p95 ranged 33.3–50.1ms. Some routes slowed under throttling.
There is no universal 60 FPS or performance-improvement claim. The 280ms visual
cue never delays route interactions or represents completed data loading.

The matched 52k-character editor control used 25 real input events per condition,
active sessions, desktop/mobile and idle/held-AI responses. Capture-phase
`beforeinput` to second animation frame p95:

| Editor condition | Before → after (ms) |
| --- | ---: |
| Desktop idle | 35.4 → 31.6 |
| Mobile idle | 32.2 → 32.0 |
| Desktop AI pending | 36.9 → 33.8 |
| Mobile AI pending | 31.2 → 31.7 |

All input characters persisted; no long task or qualifying layout shift was
observed in those editor samples. An earlier matched pair recorded desktop idle
34.3 → 45.1ms; both pairs are retained. The variability and small sample preclude
claims of zero typing overhead, INP improvement or physical-device equivalence.

Post-navigation forced-GC heap snapshots were about 5.95 → 5.99MB normal and
5.96 → 5.99MB throttled (before vs after implementation). Short snapshots are not
proof of leak absence. The entry JS gzip size changed 88,789 → 88,803 bytes;
lazy AppShell JS 4,025 → 4,747 and CSS 2,655 → 3,235 bytes. Editor CSS and global
CSS are unchanged. No dependencies were added. All raw navigation/input/frame,
heap and bundle observations are in [measurements](review/app-navigation/measurements.json).

### Review evidence

- [Navigation recording, 17.8 seconds](review/app-navigation/navigation-demo.webm)
- [Actual editor save/departure guard, 5.48 seconds](review/app-navigation/editor-guard.webm)
- [Desktop compact Home](review/app-navigation/home-compact.png)
- [Library source states](review/app-navigation/library-references.png)
- [Settings desktop](review/app-navigation/settings-desktop.png)
- [Mobile dark drawer](review/app-navigation/drawer-mobile-dark.png)
- [Held editor save](review/app-navigation/guard-pending.png)
- [Navigation results](review/app-navigation/functional-results.json) and
  [editor guard results](review/app-navigation/guard.json)
- [Focus](review/app-navigation/focus-regression.json),
  [project switching](review/app-navigation/project-regression.json) and
  [editor/AI](review/app-navigation/editor-regression.json) regression results

Recordings and screenshots show the real application with synthetic content.
The headed harness above provides a reproducible interactive review; protected
branch-preview details are provided in the draft pull request. Hosted sign-in,
Supabase, billing providers and real-device checks still require owner review.
Production remains unchanged. Phase 6 remains unstarted pending owner approval.
