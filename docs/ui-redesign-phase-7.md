# Phase 7 — Chrome extension

Phase 6 is deployed through PR #26 at
`9c2754a450226838f384e47cf12731d4d35c6748`. Phase 7 is merged through PR #27
and deployed at `668011ad26cf3b0d25af3a2445dc2aea9cee373d`. No backend or
database migration is required. It has not been submitted to the Chrome Web Store.

## Production verification

Vercel reports a successful production deployment. Certificate-validating HTTPS
probes returned 200 for `/editor`, `/ideas`, `/progress`, `/library`, `/settings`,
`/api/` and `/api/product`. The production `/downloads/release.json` advertises
version 0.24.2 and SHA256
`6671903128fe94a251a2e7f1fbf0f4cc2c1a32bd11d0b480c0e15c1c5e2caa19`.
The downloaded archive matches the committed archive byte-for-byte; its manifest,
content script and supplied header artwork match source. Existing unpacked
installations still require an explicit local update/reload. This verifies web
distribution, not native installation or a Chrome Web Store update.

## Popup and counter

The popup uses the studio's warm paper, navy text, blue actions, editorial
headings and compact cards. The header reuses the approved web landscape asset
byte-for-byte. Write presents session status, words, duration and Start/Pause/End
before daily/lifetime totals, guidance and project context. This keeps the primary
controls in the initial 420×600 fixture viewport. Native width retains the existing
420px intrinsic contract; long content scrolls vertically. Embedded previews
reflow at 180–420px. OS light/dark themes, reduced motion and forced-color focus
indicators are supported.

Main, Library and Progress tabs use roving focus with arrows and Home/End.
Progress chart values have text alternatives. Existing account, profile, source,
project and AI controls retain their handlers and ownership/entitlement checks.
Two display/navigation corrections were necessary while testing:

- The worker's fallback daily aggregate already includes the active session.
  The popup now displays it once instead of adding the active count again.
  Server summary/pending reconciliation is unchanged.
- Library's early upgrade redirect prevented Free accounts from reaching their
  existing writing profile. Profile access now reaches the existing controller;
  the inner Pro-resource gate still prevents protected source/memory requests.

The floating counter uses scoped studio colors inside its existing shadow root.
A named group contains separate native toggle and End buttons; Enter/Space
expands, Escape closes and restores focus. Labels follow EN/ES, paused status
has its own dot color, and dragging/resize bounds use the existing position store.
Mounting does not take focus from writing.

The background worker and counting modules are unchanged. The content script's
input pipeline before the floating-counter section is byte-for-byte unchanged.
Manifest changes only version 0.24.1 → 0.24.2; permissions, host access and script
registration are identical. Input hardening is outside this presentation phase.

## Verification

Checks use actual shipped popup, worker and content scripts with Chrome, storage
and HTTP boundaries replaced by fixtures. They do not use real accounts, email,
payments or paid AI.

- All extension unit suites pass, including counting, history, clock, cloud
  progress, profile/API, memory and editor bridge coverage.
- Dashboard browser regression: four views, local daily aggregate, website
  processing/actions/previews, Free access panels, Google sign-in routing,
  EN/ES, intrinsic-width detection and embedded 194px Free preview.
- Progress browser regression: popup/dashboard synchronization, active-session
  preservation, deletion, ordered edits, imports, refresh, no duplicated stop,
  Free/Pro and localized layouts.
- Phase 7 fixture: initial session controls, pause/recreate/close persistence,
  continued counting with the popup closed, counter keyboard/end/drag/resize,
  host CSS isolation, focus retention and approved web-editor counting
  suppression. Light/dark EN/ES Write, Ideas, Progress and Settings receive
  targeted axe scans; 180/194/320/360/420px layouts reflow without horizontal
  overflow. Main/Library/range keyboard navigation and chart text are checked.
- Existing suggestion, rewards and profile/security browser regressions pass:
  Quick Prompt remains non-AI, paid modes retain gates, account changes reject
  stale responses, Free profile access remains available and Pro theme controls
  remain restricted.
- Light English and dark Spanish 420px popup captures and the dark Spanish
  expanded counter were visually reviewed. Ignored captures live under
  `tests/artifacts/phase7/`.
- Frontend production build/type checks pass. Lint retains four existing warnings.
  The package contains matching runtime source and the approved image, excludes
  tests/tools, and matches its release metadata SHA256.

Run from the repository root with Playwright and Chromium available:

```sh
node --test extension/tests/*.test.js
node extension/tests/dashboard.browser.cjs
node extension/tests/progress.browser.cjs
STUDIO_EXTENSION_ONLY=1 AXE_SCRIPT=/path/to/axe.min.js node extension/tests/progress.browser.cjs
node extension/tests/profile-security.browser.cjs
node extension/tests/suggestion-modes.browser.cjs
node extension/tests/rewards.browser.cjs
python frontend/scripts/package-extension.py
```

`PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` can select installed runtimes.
`AXE_SCRIPT` is required to include axe scans in the Phase 7 fixture.

## Native verification remaining

A native unpacked-extension launch was attempted with Chromium 154.0.8037.57.
No extension worker loaded. This environment's managed policy at
`/etc/chromium/policies/managed/extensions.json` sets
`ExtensionInstallBlocklist: ["*"]`, with only the environment's forced extension
allowed. The policy was not bypassed.

The 420×600 fixture verifies layout and simulated popup closure; it does not
verify Chrome's actual action sizing, service-worker suspension/restart, or real
multi-tab lifecycle. Those native checks, actual installation/update, and physical
iPad checks remain separate Phase 8 work. Automated axe results are not
accessibility certification.
