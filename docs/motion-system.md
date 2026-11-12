# UnoWord motion system — audit and phased delivery

## Approval boundary

The owner approved **Phase 1** and requested Phase 2. Foundation review remains
in PR #32; Phase 2 is built on that approved branch without a production merge.
This work now implements **Phase 2 — Focus Mode**, for preview and owner approval.
Phases 3–8 remain unstarted. Focus Mode and project switching require functional
editor evidence and separate approval before advancing, as requested by the
owner. Phase approval is not treated as production deployment authorization.

## Audit before implementation

Inspected the current React/Vite application, shared Base UI wrappers, studio
tokens/primitives, marketing and account routes, Tiptap editor and workspace
hooks, project controls/manager, library and profile components, progress/rewards,
extension CSS, and the existing Expo application. The canonical web origin is
`https://unoword.app`; the supplied Vercel origin is a legacy alias. Browser APIs
use the existing `/api` boundary. No hosting migration, Emergent project
recreation, Supabase reconfiguration, or backend restructuring is proposed.

### Existing motion and platform inventory

| Area | Current implementation | Recommended treatment |
| --- | --- | --- |
| Shared components | Base UI 1.6; button `transition-all`, 100ms Tailwind popup fade/zoom/slide utilities; Sheet uses Base UI transition attributes | Central CSS tokens and Base UI lifecycle attributes; bounded opacity/translation, immediate control state |
| Motion dependencies | `motion` 12.42.2 installed and prebundled; no runtime imports in current source; `tw-animate-css` imported globally | No new dependency; CSS is sufficient for Phase 1. Do not add Motion to the entry bundle |
| Marketing | Home hero, sticky/mobile navigation, alternating captures, screenshot tabs, API-driven pricing, native details FAQ and footer; legacy marketing hover/rise CSS remains | Phase 6 owns hero/reveals/cards; keep text, assets, layout, pricing and routes intact |
| Login/signup/account | Shared StudioButtons plus existing account forms, provider, verification, billing and security states | Button feedback only now. Keep auth/Stripe logic and explicit account destinations intact |
| Studio shell/dashboard | Shared buttons/status; navigation background 140ms; mobile native dialog; Home prompts, goals and recent work | Navigation/page/drawer work belongs to Phase 5; no keyed route wrappers or route delays |
| Editor | Tiptap `useEditor`, rich formatting, native export details/selects/dialogs, persistent save status, completion and recovery | Never animate text or remount editor; native control migrations are deferred to the editor phase |
| Focus Mode | `useEditorPanels` toggles focus, shell and editor CSS hide panels with `display:none`; Escape exits | Phase 2 must prove selection, cursor, scroll, input, autosave and active/paused session stability before adding transitions |
| Projects | Persistent native project/AI selects; `switchProject` guards repeated requests, disables editing, pauses an active session, flushes writes/project metadata, restores unfinished documents, resets AI scope/resources | Phase 3 preserves these rules; accurate pending/error state and context isolation take priority over crossfades |
| Library/projects/profile | ProjectManager native dialogs, resource previews, search and assignment; guided profile persists answers | Phase 5/7. Do not reanimate search results per keystroke, change ownership on navigation, or hide permission/readiness changes |
| AI | Explicit consent/request flow; Quick Prompt remains non-AI; separate guidance and source/context summaries | Phase 4. No staged thinking delay, automatic request, consent change or authored-content animation |
| Progress/goals | Chart components with text tables; typed/pasted words, session/daily/lifetime metrics; settings and streak entitlements | Phase 7. No animated number count on each edit or metric changes |
| Rewards/notifications | `reward-arrive` 250ms, onboarding modal 250ms, static status/live regions; Sonner/admin short-operation spinners | Phase 7. Respect settings and dismissals; do not repeatedly announce visual transitions |
| Extension | Lightweight hover transitions, pulse, dialog entrance, occasional spring/pop, height transitions; scoped reduced-motion rules | Audit only now; Phase 8 must test real popup/action/worker lifetime, EN/ES and themes without permission/storage changes |
| iOS | Expo/React Native code exists, native Modal and Pressable controls, shared session/document engines; no Animated/Reanimated motion system found | Available source is not proof of a shipped iOS app. Phase 8 uses native reduce-motion settings and requires device verification |

### Accessibility and performance findings

- Reduced-motion rules in studio, editor and landing are descendant-scoped.
  Portaled Base UI popups live outside those roots. A global, class-targeted
  reduced-motion rule must cover them, including a preference change while open.
- Popups need Base UI's `data-starting-style` / `data-ending-style` and
  `data-instant` semantics. Use library focus containment, Escape, outside press,
  keyboard navigation and return focus; do not implement timers to hide/unmount.
- Keep viewport positioning transforms separate from animated translation.
  Aligned Select must not slide its selected row away from the trigger.
- Native select menus remain native. Existing top-layer native editor dialogs
  and navigation drawers are not replaced in this phase.
- No animation on Tiptap content, title/subtitle input, per-keystroke counters,
  autosave scheduling, project queue operations, or permission/consent text.
- Avoid `transition: all`, animated layout dimensions, blur changes, perpetual
  decorative loops and retained `will-change` layers in the new foundation.
- Existing breakpoints (900px shell, 1200px editor compact panels), brand colors,
  fonts, illustration assets, reading width, routes, focus outlines and data
  ownership boundaries remain unchanged.

## Phase 1 architecture

Use one globally imported motion CSS foundation. Root-scoped timing/easing
tokens remain available inside portals; existing `--studio-motion` becomes an
alias. Reusable control, popup, dialog and overlay classes are applied inside
existing shared components. CSS state selectors follow Base UI's own lifecycle.
No animation library, dependency, component replacement or backend change is
needed. Route and signature-transition tokens are reserved for later phases;
defining them does not activate those effects.

A lazy review page is available in development and Vercel **preview** builds
only. Production builds omit its route/module. It renders the actual shared
components with harmless local state, without authentication, documents, AI,
billing or network mutations. It explicitly does not demonstrate Phase 2 or 3.

## Remaining phase gates

1. Foundation: owner approved the tested controls/preview and requested Phase 2.
2. Focus Mode: actual editor interactions with short/long non-sensitive drafts,
   selection, typing during transition, active/paused sessions, save/reload,
   scroll/remount checks, responsive/reduced motion; recording or reproducible
   demo plus before/after measurements. Owner approval required.
3. Project switching: multiple actual test projects/documents; immediate typing
   and switching, slow/offline/failed saves, rapid switching, reload, completion,
   session attribution and context isolation. Persistence/session evidence and
   recording or reproducible demo; owner approval required.
4. Editor/AI polish; 5. Navigation/projects/library/settings;
   6. Marketing; 7. Supporting experiences; 8. Cross-platform/optimization.
   Each requires an independent tested preview and owner approval.

## Validation and review

Local browser tests use the production frontend and isolated synthetic API
responses. They are not live Supabase, Stripe, AI-provider, Chrome extension or
physical iPad/iPhone verification. No real user data is used.

### Implemented foundation

`frontend/src/styles/studio-motion.css` is imported once from `index.css`.
`--studio-motion` aliases the central feedback duration. Shared Button and
StudioLink/StudioButton use a bounded control transition; SelectTrigger shares
that feedback. Dialog, Popover, SelectContent, DropdownMenuContent and submenus
use the existing Base UI lifecycle with shared CSS classes. Dropdown alignment,
dialog centering, keyboard handling, focus guards and disabled semantics remain
library-owned. There is no new hook, provider, delayed callback, page wrapper,
global JavaScript listener, editor remount or new application dependency.

| Token group | Duration | Use in Phase 1 |
| --- | --- | --- |
| Feedback | 120ms | Shared button/link/trigger color and press feedback |
| Hover / dropdown | 180ms | Popup entrance and overlay fade; hover token reserved for later cards |
| Dialog | 260ms | 6px downward-offset entrance with opacity |
| Exit | 140ms | Dialog/popup exit; Base UI instant-dismiss state remains instant |
| Panel/page/sidebar | 220/280/260ms | Reserved; no new page/drawer transitions enabled |
| Project/focus/achievement | 360/420/650ms | Reserved for approved later phases |

Popup movement is 4px; aligned Select uses opacity alone. Exits fade without
translation. All new transitions stop for reduced motion, including portals and
a setting change while open. Focus rings and action handlers remain immediate.
Existing Sheet/native drawer motion is deferred to Phase 5; native editor
dialogs and native project/AI selects are unchanged.

### Before/after lab measurements

Same local Chromium production build setup, sequential samples, 4× CPU throttle,
150ms latency, 1.6Mbps download and disabled browser cache. Each editor sample
types into a 52,850-character document and verifies the complete saved result.
These are single-run observations with normal scheduler/cache variability,
not statistical proof of a speedup or field/device Web Vitals.

| Measure | Before | After |
| --- | --- | --- |
| Editor input to second frame p95, 1440px | 151.7ms | 155.1ms |
| Editor input to second frame p95, 390px | 153.6ms | 125.9ms |
| Editor observed LCP | 1888ms | 1864ms |
| Editor observed layout-shift sum | 0.02149 | 0.02118 |
| Editor observed long-task sum | 749ms | 623ms |
| Marketing observed LCP/FCP, 390px | 2780ms | 2676ms |
| Marketing observed layout-shift sum | 0 | 0 |
| Marketing transferred bytes | 679,757 | 679,183 |
| Initial entry JS, gzip (build report) | 88.94kB | 88.91kB |
| Entry CSS, gzip (build report) | 26.91kB | 26.87kB |

The desktop typing tail differed by +3.4ms; no material regression is evident in
this limited sample, but it cannot establish a zero-latency increase. Larger
before/after editor trials are required for the signature transitions.

The separate unthrottled foundation lab measures frame intervals, action-to-React
commit time, long tasks, layout shifts and forced-GC heap snapshots. Its JSON
report records the actual observations; rAF interval is not a GPU FPS measure,
synthetic action latency is not INP, and short-run heap measurements cannot prove
the absence of leaks. Repeated closed menus/dialogs/popovers unmount; Base UI
Select intentionally retains a hidden item registry.

### Functional and accessibility evidence

`tests/motion-foundation.browser.cjs` exercises the actual shared components in
the preview bundle: Space/Enter actions, disabled controls, keyboard menu and
submenu navigation, focus return, selection, centered dialogs, text input,
Tab/Shift+Tab containment, Escape, repeated cleanup and live reduced-motion
changes. It checks 1440/1024/768/390/320px and 200% **CSS magnification** (not
physical browser/device zoom), and captures desktop/mobile images. Optional
`MOTION_RECORD_VIDEO=1` records the interactions when Playwright FFmpeg is
installed. No API requests are allowed by the preview test.

WCAG A/AA axe checks cover light/dark sample surfaces and open controls. The only
explicit exclusion is `[data-base-ui-focus-guard]`: Base UI's empty, aria-hidden
keyboard sentinels trigger `aria-hidden-focus`. Actual interactive controls are
not excluded, and focus containment/return is tested separately. Manual
VoiceOver/NVDA compatibility remains unverified.

Production build/type/branding checks pass; lint has the four existing unrelated
warnings. Normal production builds are checked to contain neither the review
page module nor its CSS. All 10 selected web regressions and 3 editor/workspace,
project and AI-context regressions pass on the normal production bundle. The
final foundation suite passes on the local preview production bundle. See
`docs/review/motion/measurements.json` for the sanitized measurements and job
results.

The final unrecorded foundation lab observed 287 frame intervals: p50 16.7ms,
p95 16.8ms. Synthetic action-to-React-commit p50/p95 was 1.4/2.1ms, with zero
observed layout shifts and no recorded long tasks during the measured cycles.
After three warm-up cycles, forced-GC heap snapshots increased from 5,807,564 to
6,702,752 bytes across twelve measured cycles (+895,188 bytes). This short
observation does not establish a leak or prove stable long-session memory use;
long-duration/device profiling remains outstanding. The new foundation itself
adds CSS and existing-component classes, with no new runtime listener/timer.

### Review before approval

Draft PR: https://github.com/felipeoracio/unoword/pull/32

Preview: https://unoword-git-feature-motion-foundation-unoword.vercel.app/motion-preview

Vercel reports a successful preview deployment. Its team login protection is
enabled: unauthenticated automated checks reach **Login – Vercel**, so remote
application interactions are unverified. Sign in to Vercel with project access
to review it; protection was not bypassed or disabled. The local preview-build
suite passes. A certificate-validating probe confirms production still serves
the previous approved release. Local review:

```sh
npm --prefix frontend run dev
# Open http://localhost:3000/motion-preview
```

To build the same review module for isolated browser tests:

```sh
UNOWORD_MOTION_PREVIEW=1 npm --prefix frontend run build
# Use the existing Playwright/Chromium/axe installation through
# PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE and AXE_SCRIPT as needed.
node tests/motion-foundation.browser.cjs
```

Try the menu with arrows and Escape, select a writing time, type in the sample
dialog, switch the sample theme, and enable OS/browser Reduce Motion while a
popup is open. Sample state never changes an account or document. Review the
regular landing page and application through the same preview for shared button
feedback. Phase 1 has since been approved. The current Focus Mode implementation
and actual-editor evidence are in `motion-focus-mode.md`. Phase 2 still requires
its own approval before Phase 3; no production merge is included.
