# Phase 8 — Regression and final polish

Phase 7 is deployed at `668011ad26cf3b0d25af3a2445dc2aea9cee373d` through
PR #27, distributing extension 0.24.2. Phase 8 ships through
[PR #28](https://github.com/felipeoracio/unoword/pull/28); its merge commit and
production deployment status are tracked there. Extension 0.24.2 remains the
current download. Completion of automated fixtures does not establish native or
live authenticated acceptance; those checks remain listed separately below.

## Changes

The full editor/onboarding axe scans exposed low contrast in compact AI usage
text. Studio usage text now retains full opacity with the existing theme colors;
allowance values, entitlement rules and requests are unchanged.

The repeatable matrix in `tests/run-redesign-regression.cjs` runs backend,
extension, embedded PostgreSQL, web/editor and mobile suites. It builds the
production frontend before browsers, caps concurrent jobs at two, manages its
own local production-bundle server and writes logs and machine-readable reports
under ignored `tests/artifacts/phase8/`. It always disables live-account/key-swap
tests. An explicitly supplied browser origin must be local. Per-group runs are
available for `foundation`, `web`, `editor`, `extension` and `mobile`.

Older tests were updated to current contracts: signup supplies the shared
account consumers, the two-device PostgreSQL test applies project migrations
and exercises their actual project RPCs, and the release check compares manifest
and artifact versions instead of pinning an obsolete version. Generated DOCX
test IDs are stable across pytest's two configured workers. Live admin tests now
honor the existing explicit opt-in; anonymous document authorization checks use
the actual ASGI routes locally with a trusted origin. No live server/account is
needed for these anonymous checks. The existing secret-leakage test now locates
the repository's actual frontend build rather than skipping a fixed `/app` path.

`tests/check-extension-release.py` verifies the distributable's source parity,
checksum, approved permissions, required entrypoints, artwork, safe archive paths
and exclusion of non-runtime files. It does not install or execute an extension.

## Executed results

All 48 distinct jobs have passing final executions, including focused reruns
after fixture repairs and the preview-server interruption. This is a consolidated
result across runs, not one uninterrupted 48-job pass. Reports retain initial
failures; per-job logs reflect the latest execution. Per-group and focused reports
record the rechecks.

| Group | Passing jobs | Evidence covered |
| --- | ---: | --- |
| Foundation | 12 | Production build/types, lint, 583 backend tests, extension unit suites, worker cloud-sync integration, canonical-domain/release integrity and five embedded PostgreSQL suites |
| Web | 18 | Shell/Home/Ideas/Progress/Library/Settings, onboarding, signup, Google callbacks, retired Lifetime links, Substack, rewards, two-device PostgreSQL sync, admin AI management, analytics privacy, domain recovery, landing, secure callbacks and account/billing |
| Editor | 8 | Full workspace, projects, coaching, studio layout, images, subtitle/copy, session/completion/trash/recovery and throttled large-document typing/save |
| Extension | 6 | Popup/dashboard, progress, profile/security, suggestions, rewards and studio/counter accessibility/lifecycle fixtures |
| Mobile | 4 | 32 unit tests, TypeScript, offline iOS JavaScript export and native-component/editor-bridge browser fixtures |

The backend run used pytest's configured two workers: **583 passed, 70 skipped,
7 warnings**. Skips are explicit live QA/key-swap/credential-dependent checks;
they are not passes. Warnings are the existing Starlette/httpx and HTTP 422
deprecations. Frontend lint retains four existing warnings. Extension's Node test
runner reports 36 passing tests in addition to the custom assertion-runner suites.

The editor checks cover title/subtitle/body and images, formatting/copy and
imports/exports, saved/failed/offline states, conflict recovery, completion and
trash. They preserve typed/pasted distinctions, current session identity and
save-before-navigation. PostgreSQL checks exercise ownership/RLS, project
associations without duplicate bodies, account permissions, DST/midnight and
overlapping session time. The two-browser integration verifies 20 minutes from
one device plus 10 from another, excludes a five-minute pause, and propagates
document completion without adopting the other device's session.

Targeted axe checks pass with the usage-contrast fix. Responsive fixtures cover
320/390/768/1024/1440px web layouts where supported by each suite, 180–420px
extension layouts and 320/390/820/1180px mobile component layouts. Light coaching,
dark desktop paper, Spanish 390px editor, and 1180px tablet component layouts were
visually reviewed. Screenshots remain ignored under `tests/artifacts/phase8/`
and the older suites' existing artifact directories.

### Performance observation

A 52,850-character draft retained every final keystroke and saved intact with
4× Chromium CPU slowdown and a configured 150ms/1.6Mbps network profile. Across
25 keystrokes per size, input-event-to-second-animation-frame p95 was **131ms at
1440px** and **135ms at 390px**. Observed application navigation LCP was 1.95s;
the recorded shift sum was 0.084. These are one local lab sample, without a hard
performance budget, not field INP/CLS or a physical-device result. Setup navigates
through sign-in before measurement; it is not a cold-start audit. API responses
are synthetic and bypass network throttling. Browser cache is disabled; these
figures do not establish an offline service-worker cache-transfer budget.

The raw observation is `tests/artifacts/phase8/performance.json`. The iOS export
produced a bundled editor canvas and Hermes JavaScript/assets; no signing or
physical-device execution occurred. No real account data, provider mail, charge,
refund or paid AI was used by the automated checks.

## Reproduce

Install frontend, mobile and test dependencies plus backend development
dependencies. Browser fixtures require Chromium and Playwright; SQL fixtures use
the existing PGlite/vector test dependencies. For installed dependencies outside
the repository, supply absolute runtime/module paths:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/path/to/chromium \
AXE_SCRIPT=/path/to/axe-core/axe.min.js \
PGLITE_ROOT=/path/to/test/node_modules \
PYTHON_EXECUTABLE=/path/to/python \
node tests/run-redesign-regression.cjs all
```

When dependencies use repository defaults, omit their overrides. `AXE_SCRIPT`
must be set to include the optional axe checks in older suites. The landing and
billing suites also require axe. Group-only web/editor runs require an existing
frontend build; their fixture server starts automatically. Mobile export uses
offline mode with telemetry disabled and two Metro workers. No signing, EAS
upload, app-store publication, real email, payment or paid AI is performed.

To rerun specific jobs, pass comma-separated job names after their group, for
example `node tests/run-redesign-regression.cjs web email-signup,lifetime`.
Focused reports use the job names in their filenames, preserving the earlier
group report. A failure is never silently retried or recorded as a pass.

## Platform and live verification remaining

The environment's Chromium policy still sets `ExtensionInstallBlocklist: ["*"]`
and only permits its forced extension. The policy is not bypassed. Native action
sizing, extension installation/update, service-worker suspension/restart and real
multi-tab lifecycle are **blocked here**. Popup/worker/content-script fixtures
remain useful isolated regressions, but cannot establish those results.

No physical iPad or iOS simulator is attached. The mobile screen fixtures render
React Native components through React Native Web and a bundled editor bridge.
An iOS JavaScript export is not a signed app or physical-device test.

Use dedicated QA accounts and fictional writing for the remaining checks. Record
actual platform/version, viewport, plan, steps, result and evidence; leave result
unverified until executed:

| Environment | Required checks | Current result |
| --- | --- | --- |
| Unmanaged Chrome with extension 0.24.2 | Actual action dimensions; long-popup scrolling; EN/ES and themes; close/reopen during writing; suspend/restart worker; multi-tab; pause/end; extension update; web editor counts once; permissions unchanged | Blocked by managed policy |
| Physical iPad Safari | Portrait/landscape and split view; software/hardware keyboard and selection; title/subtitle/body/images/formatting; copy/import/export; autosave/offline reload/recovery; completion/trash; VoiceOver/focus; account switch | Not executed |
| Physical iPad native app | Real WKWebView/editor bridge; Keychain restoration; background/foreground session gaps; offline encrypted drafts and conflict recovery; subscriptions; native callbacks; keyboard and VoiceOver | Not executed |
| Live authenticated QA infrastructure | Same-account web/extension/device sync; sign-in/refresh/recovery and mail delivery; Free/paid/Lifetime/Substack permissions; provider-return handling with an approved test subscription | Not executed in this phase |

These checks remain explicit acceptance work. No fixture result is substituted
for them. Automated axe results are not accessibility certification, and local
performance measurements are not field Web Vitals or physical iPad measurements.
