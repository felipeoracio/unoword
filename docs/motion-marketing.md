# Phase 6 — Marketing website motion

The owner approved Phase 5 and requested Phase 6. This draft stacks on PR #36;
the approved motion phases are not production merges. Phase 7 supporting
experiences and production deployment require separate approval.

## Audit and scope

The public page is `pages/Home.tsx`, prerendered through the existing marketing
SSR build and hydrated with React. It already consumes studio typography,
colors, surfaces, Button/Link, Card, Container, Image, SectionHeading and native
Accordion components. `StudioShowcase` owns keyboard-accessible screenshot tabs;
`useProduct` owns public catalog pricing/entitlements. The native mobile menu
uses `hidden`, Escape, focus return and a 900px breakpoint. The hero screenshot
has an existing static -2° desktop rotation. Legacy marketing styles contain
entrances for old `uw-hero` compositions, which do not match this page's `lp-`
compositions. Those legacy screens and the Lifetime page are unchanged.

No router, account, billing, analytics, content, screenshot, entitlement or
backend redesign is needed. No testimonials or feature claims were added.
There is no new dependency or animation-library import.

## Implementation decisions

- The single global motion source adds 420ms reveal, 40ms stagger, 16px section,
  8px hero and 2px hover offset tokens. Existing tokens remain unchanged.
  `revealEntrance` shares the existing surface helper's easing, time parsing,
  cancellation and live reduced-motion cleanup with `revealOpacity`.
- The headline stays fully opaque; supporting copy, CTA group and preview use
  an intentionally shallow 0.96 → 1 cue. Hero starts are staggered 0/40/80/120ms.
  Content is never hidden or made inert, and no completion callback gates a CTA.
  Independent CSS `translate` preserves the existing screenshot rotation; the
  test checks its rotation while the entrance runs. Initial inspection caught
  the ordinary transform animation replacing that angle and corrected it before
  final validation.
- One IntersectionObserver reveals existing static compositions once: journey,
  feature index and stories, showcase, how-it-works, AI, audience, pricing, trust,
  FAQ and final CTA. There is no scroll handler, result polling, per-letter
  animation, parallax, counter tween or loop. Offscreen hero items enter when
  scrolled into view. Nested children do not receive competing scroll cues.
- Normal DOM styles remain visible. JavaScript/observer failure leaves public
  prerendered text, links and native FAQ usable. There are no opacity-zero
  waiting classes, loading delays or layout dimension animations.
- Pointer interaction or focus settles its containing reveal immediately.
  Reduced motion cancels active effects, disconnects the observer, removes CSS
  movement and prevents further entrances. Unmount cancels outstanding effects
  and removes observer/media/focus/pointer listeners. Toggling motion back on
  does not replay a page full of reveals.
- Feature links rise 2px on fine-pointer hover with a shared border/shadow;
  touch targets do not move. Pricing borders and screenshot tabs retain their
  real immediate state. Navigation marks the actual URL hash, including native
  anchor/back navigation, rather than guessing a section during scroll.
- The existing mobile menu gets a short 180ms entrance; native closing,
  Escape/focus return, route selection and desktop resize stay immediate. Native
  FAQ answers get a 220ms opacity cue and a shared chevron transition; opening
  and closing do not wait for a height animation. Prices, error states, plan
  terms and security/privacy copy remain readable throughout.

Affected modules: Home, shared motion utility/tokens, new
`use-marketing-motion.ts` composition hook and `marketing-motion.css`. Existing
shared primitives and StudioShowcase are reused without duplicate components.
Editor and app navigation are regression checked because the common opacity
helper now delegates to the same internal surface routine.

## Review and reproduce

```sh
npm --prefix frontend run build
node tests/marketing-motion.browser.cjs
```

Configure `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE` and `AXE_SCRIPT` for the
installed tools. `MARKETING_RECORD_VIDEO=1` records the actual production UI.
`MARKETING_HEADED=1 MARKETING_PAUSE=1` leaves a local, synthetic-catalog review
page open. Outputs are under `tests/artifacts/marketing-motion/`.

For matched lab samples, set `MARKETING_LAB_LABEL=before`,
`MARKETING_LAB_DIST=/path/to/approved/phase5/dist` and `MARKETING_CPU_RATE=1` or
`4` when running `tests/marketing-motion-performance.browser.cjs`. Omit the dist
and label variables for the current build. This is a local benchmark, not field
Core Web Vitals or physical-device verification.

The draft PR provides the protected Vercel branch URL. Team login and the
existing account permissions remain enabled. There is no production deployment
or preview protection bypass. Local tests use actual production React/Tiptap UI,
non-sensitive synthetic catalog/account data and isolated persistence/provider
responses, not live Supabase, Stripe, email or AI calls. Manual VoiceOver/NVDA,
real iPad/iPhone, physical browser zoom and long-session memory remain unverified.

## Results and evidence

The dedicated suite passes seven grouped scenarios: hero/rotation and focus,
reveal-once/anchors, tabs/FAQ keyboard, responsive/touch/axe, dark/live reduced
motion, real signup/Pro routing and unmount cleanup, and observer/JavaScript
fallbacks. A trusted pointer click is exercised while the CTA entrance is active;
Playwright is instructed not to wait for decorative movement to settle. Hover
movement is tested separately with a fine pointer and removed in reduced motion.

Axe checks cover 1440, 1024, 768, 390 and 320px plus dark mode. The primary CTA
stays in the first 1000px viewport at every size. Existing landing regression
also checks real prerendered SEO/canonical/structured data, API-driven changed
prices/trials, unavailable catalog fallback, extension URL, footer and signup
links. No SEO or published product copy was changed.

Eight selected broader browser jobs passed: landing, analytics privacy, login
redirects, Google OAuth, email signup, billing, account security and domain
migration. The actual-editor regressions passed all eight editor/AI groups,
21 Focus Mode scenarios and 15 project-switching groups. Navigation passed eight
groups plus the actual-editor failed/held-save departure guard. Build (branding,
TypeScript, client/SSR and prerender) passed; lint has four existing warnings.
[Regression results](review/marketing-motion/regressions.json) link the exact
local working-tree job details. No backend/provider code changed, and no live
subscription or provider verification is claimed.

### Matched performance observations

Both production bundles use cold browser caches, 150ms latency, 1.6Mbps download
and the same synthetic catalog, with normal and 4× CPU. Initial LCP and FCP were
identical in each sample; the table records milliseconds before scrolling.

| Width | Normal before → after LCP/FCP | 4× CPU before → after LCP/FCP |
| --- | ---: | ---: |
| 390 | 2600 → 2512 | 2676 → 2836 |
| 1440 | 2664 → 2684 | 2832 → 2828 |

Mobile throttled loading was 160ms higher in this single trial. Desktop initial
layout-shift sum stayed 0.000115; mobile stayed zero. Two repeated scroll cycles
recorded no qualifying layout shifts or long tasks and 16.7–16.8ms frame-interval
p95. The baseline has fewer frame samples because it does not wait for reveals.
These are local rAF observations, not a universal 60 FPS or performance-win claim.
Startup long tasks still occur and are retained in the raw report.

Editor controls type into an actual 52k-character Tiptap document during an
active session, idle and with a held AI-response fixture. Each cell is the p95
capture-phase beforeinput → second animation frame for 25 real input events.
The first pair ran before → after; the repeat ran after → before.

| Editor condition | First before → after (ms) | Repeat before → after (ms) |
| --- | ---: | ---: |
| Desktop idle | 32.6 → 46.5 | 33.4 → 36.8 |
| Mobile idle | 33.9 → 33.4 | 33.6 → 32.8 |
| Desktop AI pending | 33.1 → 33.6 | 37.3 → 32.5 |
| Mobile AI pending | 32.2 → 48.3 | 35.8 → 31.6 |

All legitimate characters persisted. The larger first-run mobile tail did not
recur; desktop idle remained slightly higher in the repeat. No zero-overhead or
INP-improvement claim is made. Both pairs and their frame/long-task observations
are retained, rather than choosing the fastest trial.

Entry JS gzip grew 88,803 → 89,799 bytes; CSS 26,917 → 27,319 bytes. Editor CSS
is unchanged; its lazy JS is 136,068 → 136,056 bytes. Post-scroll forced-GC heap
snapshots and initial/scroll long-task arrays are in the raw data; short snapshots
do not establish long-session memory stability. No new library is loaded.

[Raw matched measurements](review/marketing-motion/measurements.json) include
superseded diagnostic samples from before the screenshot-rotation correction.

### Review assets

- [Actual landing interactions recording](review/marketing-motion/marketing-demo.webm)
- [Desktop hero](review/marketing-motion/hero-1440.png) and
  [mobile hero](review/marketing-motion/hero-390.png)
- [Mobile pricing](review/marketing-motion/pricing-mobile.png) and
  [dark FAQ](review/marketing-motion/faq-mobile-dark.png)
- [Dedicated functional results](review/marketing-motion/functional.json)

The recordings show production UI with fixture content. Live account creation,
payments, providers and actual hosted editor interactions have not been tested.
Production remains unchanged; Phase 7 remains unstarted pending owner approval.

