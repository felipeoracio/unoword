# Editor 2.0 — Phase 1 review

Status: Phase 1 approved by the user. Not deployed. Phase 2 implementation and
review materials are available in [the Phase 2 review](../editor-2-phase-2/README.md).

[Audit and implementation plan](../../editor-2-audit-and-plan.md)

## Actual editor previews

- [Comfortable / desktop](desktop.png)
- [Tablet](tablet.png) · [Mobile](mobile.png)
- [View → Page Width](view-menu.png)
- [Standard Page](standard-page.png)
- [Focus Mode](focus.png) · [Dark theme](dark.png)

These are screenshots of the built production editor with synthetic documents and
isolated HTTP fixtures, not design mockups or live/private writing.

## What changed

- Centered paper and content constraints with Comfortable as the default.
- View → Page Width offers Comfortable, Standard Page, Wide and Full Width.
  This viewing preference persists per account in this browser, across document
  switches/reloads. Storage failures do not disable the control.
- 18px / 1.7 desktop body typography; 17px / 1.7 on small screens; consistent
  paragraph, heading and list spacing, with explicit existing formatting retained.
- Images center naturally, cap at 560px and the available text width, retain
  aspect ratio and do not upscale small sources. Existing JSON dimensions stay intact.
- Existing Focus Mode preserves the actual paper/text width, scroll and editor view.
- Fixed a stale identity callback found by the regression suite. First edits now
  use the signed-in device identity so session controls restore correctly. Existing
  session records and statistics are not rewritten.

## Measured Comfortable layout

| Viewport | Outer paper | Text width | Landscape image |
| --- | --- | --- | --- |
| 2560px | 816px | 718px | 560px |
| 1920px | 816px | 718px | 560px |
| 1440px | 816px | 718px | 560px |
| 1024px | 816px | 718px | 560px |
| 768px | ~730px | ~664px | 560px |
| 390px | 370px | 328px | 328px |
| 320px | 300px | 258px | 258px |

Before this phase, the measured desktop paper was already 820px, its text was
678px and large images filled all 678px. The improvement is a consistent maximum
text measure, explicit layout choices, tighter typography, and independent image
sizing; the audit did not find an unbounded desktop paper in this checkout.

Standard Page is a continuous, Letter-inspired surface with a minimum 816×1056px
sheet and larger side margins on desktop. It shrinks on mobile. It is not live
pagination and does not change export page settings. Wide allows up to ~1040px
of text; Full Width is opt-in.

## Executed validation

- Production build (including TypeScript, motion-token and branding checks): passed.
- Focused frontend lint: passed.
- Session credit: 7 frontend regression tests and 8 backend validation tests passed.
- Canvas: 28 viewport/layout combinations passed (7 widths × 4 modes), including
  actual image/text bounds, aspect ratio and centering, no horizontal page overflow,
  unchanged document JSON, selection, editor instance and session word credit.
- Canvas workflow: undo/redo after changing layout, signed-in session identity,
  autosave/reopen, active session restoration, ended-record immutability, portrait
  and small images, storage failures, dark mode, English/Spanish and Escape dismissal.
- axe WCAG 2/2.1 AA checks with the View panel open passed at four viewport widths.
- Existing Focus Mode suite: all 21 scenarios passed, including long-document
  selection/scroll stability, transition typing, mobile/keyboard/IME, reduced
  motion, save failure and offline/reconnect checks with axe enabled.
- Existing editor/AI suite: all 8 grouped scenarios passed, including held/failed
  saves, offline/reconnect, consent/context isolation, paused/ended sessions,
  reduced motion, persistence and axe checks.
- Existing project suite: all 15 grouped scenarios passed, including interrupted
  saves, cold/failed loads, offline switching, session attribution/history,
  scoped AI payloads, keyboard/mobile controls, reduced motion and axe checks.

Full measured canvas results are in [canvas-checks.json](canvas-checks.json).
The baseline is in [baseline-measurements.json](baseline-measurements.json).
Project/editor scenario results are included alongside this file.

Browser test entry points:

```sh
node tests/editor-canvas.browser.cjs
node tests/focus-mode.browser.cjs
node tests/editor-polish.browser.cjs
node tests/project-switching.browser.cjs
```

Use `PLAYWRIGHT_MODULE` / `CHROMIUM_EXECUTABLE` for the installed Playwright and
Chromium paths, and `AXE_SCRIPT` for axe-core's `axe.min.js`. These suites run the
built frontend against isolated API fixtures and real IndexedDB. They do not
validate live Supabase, physical touch devices, or Microsoft Word/PDF fidelity.
No database changes or new dependencies are part of this patch.

Phase 2 typography settings, rich formatting and contextual controls remain
pending approval. Image controls/tables, professional tools and import/export
improvements retain their separate later approval checkpoints.
