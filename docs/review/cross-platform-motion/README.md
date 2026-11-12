# Phase 8 review evidence

See [implementation, audit, measurements and open checks](../../motion-cross-platform.md).
These artifacts describe the candidate working tree based on Phase 7
`c7aaa638a167d2e5824a4b565b4699f21e96b938`, not a production release.

- `regressions.json`: final 49-job matrix. Final reruns replace job identities;
  run metadata and exact final output in `logs/` are retained. The matrix's raw
  historical “Native Chrome unverified” scope refers to its fixture jobs; loaded
  runtime evidence is separate below. `initial-failures.json` preserves initial
  failed statuses; its original log paths are mutable test-output locations,
  not archived first-run logs. Causes, fixes and unexplained retries are in the report.
- `*-regression.json`, `editor-departure.json`, `logs/*motion.txt`: fresh final
  functional reruns against actual production web components and isolated APIs.
- `extension-runtime.json`, `action-popup.png`, `live-counter.png`,
  `action-popup-dark-reduced-es.png`: actual loaded MV3, Chrome for Testing151,
  native action popup, real worker/content script; remote DNS blocked.
- `native-profile-answer.png`, `native-reduced-context.png`,
  `ipad-landscape-editor.png`, `iphone-dark.png`: real native screen components
  through RN Web/offline editor bridge. Viewport names do not imply physical iOS.
- `profile-desktop.png`, `progress-desktop.png`, `marketing-mobile.png`: final
  production web UI with synthetic non-sensitive data.
- `profile-progress-final-{before,after}-{1,4}x.json`, `editor-{before,after}-1x.json`:
  matched sequential lab trials. `foundation-performance.json` measures repeated
  shared-control cycles. Definitions/limitations are embedded in each file.
- `library-shift-attribution.json`: preliminary baseline narrow-screen trace that
  motivated the root/metadata fixes. `progress-shift-attribution.json`: separate
  two-before/two-after desktop follow-up, retaining existing chart-load shifts.
- `bundles.json`, `extension-release.json`: byte counts and verified archive SHA256.
- `production-probes.json`: read-only anonymous HTTPS checks; production assets
  remain unchanged. No production auth, billing, writing or configuration was altered.

Full acceptance still needs the physical iPhone/iPad, retail Chrome and authorized
live-integration checklist in the report. Slow cold mobile LCP and variable
desktop Progress loading shifts remain open. No deployment or Store submission
is implied by these local results.
