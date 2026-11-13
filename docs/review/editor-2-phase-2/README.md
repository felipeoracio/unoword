# Editor 2.0 — Phase 2 review

Phases 1 and 2 were approved. This report records the Phase 2 formatting work.
[Phase 3 image/table review](../editor-2-phase-3/README.md) is now available.
This work is local and not deployed.

[Implementation plan](../../editor-2-phase-2-plan.md)

## Controls and document behavior

- **Text:** selected-text font family, size, text color and highlight; safe Clear
  Formatting. Existing bold/italic/underline/strike and links remain available.
- **Paragraph:** left/center/right/justify alignment, line spacing, paragraph
  spacing and indentation. Indent is bounded and adapts to narrow screens.
- **Document style:** defaults for font, size, line height and paragraph spacing.
  These persist in the document's revisioned JSON, alongside the existing subtitle.
  Explicit selected-text and paragraph overrides continue to take precedence.
- **Styles:** Title, Subtitle, Heading 1–3 and normal text. Titles remain semantic
  headings; subtitle styles remain paragraphs. Existing document title/subtitle
  fields are preserved separately.
- **Lists:** existing bullet/numbered/nested lists plus official Tiptap nested task
  lists with saved checkbox state. Enter splits checklist items; Tab/Shift+Tab nest
  and lift list items. Alt/Option+Shift+arrows control indentation. Normal Tab
  outside lists remains available for keyboard navigation.
- **Selection toolbar:** bold, italic, underline, H2, link and highlight, positioned
  outside the selected text. Disable it under Document style → Show selection
  toolbar. This preference persists per account in this browser.

Fonts reuse system Georgia and existing bundled Inter / JetBrains Mono resources.
Sizes range from 12–64px; color/highlight controls offer curated presets. No arbitrary
CSS is stored. Server validation bounds font categories, sizes, spacing, indentation,
style names and hex colors and preserves the original session provenance marks.

The main toolbar remains usable when the optional selection toolbar is disabled.
Native popovers escape the scrollable toolbar, fit the viewport, and support
Escape/outside dismissal without remounting the editor.

## Persistence and history

- New formatting travels through the existing IndexedDB/autosave/revision/conflict
  pipeline. The existing Supabase JSON column needs no migration or new project.
- Document hydration restores all root attributes so typography does not disappear
  on reopening or project/document changes.
- Formatting actions have clear undo boundaries. Resetting the final inline override
  removes empty marks before saving, preserving undo after server normalization.
- Clear Formatting removes visual marks and paragraph overrides while retaining
  session credit and semantic structure. It does not reset document typography.
- Changing formatting/list structure never grants typed-word credit. Structural
  changes without inserted prose no longer start an empty writing session.
- No changes to subscriptions, AI insertion behavior, retrieval scope, usage limits,
  account ownership or completed session records are part of this phase.

## Existing exporters

Existing Markdown serializers now retain checklist state and nested content.
Existing DOCX/PDF exporters retain supported typography, paragraph attributes,
inline font/color/highlight and checklist content. Checks cover generated DOCX XML
and PDF text extraction. They are not a Microsoft Word or physical print-fidelity
certification: PDF uses standard built-in font substitutions, DOCX font availability
is viewer-dependent, and checkboxes export as readable markers. Markdown has no
standard representation for font/color/spacing. Full import/export fidelity remains
Phase 5; task-list Markdown import parity is not claimed here.

Responsive browser behavior is tested. The separate native mobile app retains its
existing unsupported-format editing guard; this phase does not ship a native app
schema update or claim physical-device coverage.

## Validation

See the result JSON files included with this review for executed scenario names.

- Production build passed, including TypeScript, shared motion-token and branding checks.
- Focused frontend lint passed.
- 18 backend tests passed: new schema roundtrip, bounded formatting / malicious CSS
  rejection, checklist serialization, DOCX/PDF smoke checks and existing credit tests.
- 7 frontend session-credit regression tests passed.
- The formatting browser suite uses actual built editor controls, real IndexedDB
  and isolated HTTP fixtures. Document writes run through the **real Python
  clean_document validator**, rather than a JSON echo.
- All three formatting panels were audited with axe WCAG 2/2.1 AA at 1440, 1024,
  768, 390 and 320px. Large text and maximum indentation were checked at 320px.
- Existing regression suites passed: 28 canvas viewport/layout combinations,
  21 Focus Mode scenarios, 15 project-switching scenarios and 8 editor/AI groups.

Run after building the frontend:

```sh
node tests/editor-formatting.browser.cjs
```

Set `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `AXE_SCRIPT` to installed paths;
set `FORMATTING_PYTHON` to a Python environment with backend validation dependencies
to exercise the real server validator. These tests use synthetic fixture writing,
not live/private Supabase data or paid AI calls.

## Preview

- [Text settings](text-desktop.png)
- [Document typography](document-desktop.png)
- [Selection toolbar](selection-desktop.png)
- [Paragraph settings on mobile](paragraph-mobile.png)
- [Focus selection tools](focus-selection.png)
- [Dark document settings](dark-document.png)

Stop here for approval before Phase 3 (advanced image controls and tables).
