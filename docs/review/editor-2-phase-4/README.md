# Editor 2.0 — Phase 4 review

Phase 4 was approved and deployed at commit `1015bbc`.
[Phase 5 review](../editor-2-phase-5/README.md) records its release checks and
new import/export work.

[Implementation plan](../../editor-2-phase-4-plan.md)

## Professional writing tools

Open **Editing** in the compact formatting toolbar.

- **Find / Find and replace:** literal, case-sensitive or insensitive search,
  highlighted matches, previous/next navigation, one/all replacement and empty
  replacement for deletion. Search crosses text marks, including bold/italic,
  but keeps paragraph, cell, caption and hard-break boundaries intact.
- Replacements inherit common formatting/provenance from the matched text.
  Older or pasted writing never becomes new typed credit through replacement.
  The existing session reducer reconciles changed typed/pasted tokens and history
  restores their original credit. Replacing all is a single undoable action.
- Only 2,000 matches are highlighted at once; navigation highlights the active
  match beyond that window. The search retains up to 10,000 matches. If more exist,
  it explicitly asks for a narrower query and disables partial replace-all.
  Queries are limited to 200 characters and replacements to 2,000 characters.
  Replacement is declined before dispatch if it exceeds document size/node or caption limits.
- **Document outline:** semantic headings with nested visual indentation, live
  updates, navigation to the same editor and a close button. It is a floating
  panel, so opening it does not change the document's width or selection.
- **Document statistics:** body/caption word count, Unicode character count,
  characters without whitespace, paragraph count, reading time at 200 words/minute
  and selected-text words. Character counts include paragraph separators. Empty
  paragraphs count as paragraphs. Document title/subtitle metadata is excluded,
  matching the existing document-word total. Session progress remains separate.
- **Keyboard shortcuts:** Find, Replace, Save, Focus Mode, link, page break and
  print preview, plus a reference for the existing formatting, undo and selection
  shortcuts. Ctrl/⌘ shortcuts are scoped to the writing workspace. macOS ⌘H is
  left to the operating system; use ⌘ShiftF for Replace. IME composition and modal
  dialogs keep their own key handling. Find exits Focus Mode to show its controls.

Completed documents support search, statistics, outline and printing; replacement,
page-break insertion and print-metadata edits require an editable document.
Switching documents clears find/outline state, without remounting Tiptap.

## Page breaks and print

Insert a top-level page break with **Editing → Insert page break** or Ctrl/⌘Enter.
It appears as a discreet separator and participates in normal undo, autosave and
reopen. Breaks inside image captions, lists and table cells are not supported.
The server rejects nested breaks; source documents are not converted or flattened.

**Print preview** uses a separate sanitized, script-free iframe built from the
current document, including unsynced local edits. It has no project navigation,
AI controls or session statistics. It preserves supported headings, text styles,
lists, captions, images, table widths and intentional page breaks. Print assets
are constrained to inline styles and embedded images by a restrictive CSP.

Choose US Letter or A4, and narrow (0.5in), normal (1in) or wide (1.25in) margins.
These are bounded document metadata, saved by the existing revisioned pipeline.
Existing PDF/DOCX serializers honor these page settings and intentional breaks.
Table widths adapt to the printable area. Fixed editing columns are converted
to proportional print columns without mutating the stored document. No database migration is required.

Editing and the in-app preview remain continuous. Small screens can pan within
the isolated print preview without widening the editor. The browser's print dialog
provides actual pagination; select matching paper and disable browser headers and
footers. Physical printer output, all operating-system print dialogs, perfect
Word parity and import roundtrips are not claimed. Full import/export work remains
Phase 5. The native mobile application release is outside this browser phase.

## Verification

- Production build and focused lint passed.
- All 11 writing-tools browser scenario groups passed, including 5,400-match
  replacement, offline synchronization, completed documents, modal focus return,
  outline key isolation, page-break provenance, print tables and four responsive
  widths (1440, 768, 390 and 320px), with axe WCAG 2/2.1 AA checks.
- 47 backend tests passed: break/layout validation, DOCX page geometry/table widths,
  two-page PDF placement, existing media/formatting and session credit.
- 19 frontend tests passed: literal search, mark boundaries, conservative provenance,
  one-step replacement history, oversized edit rejection, long-query limits,
  Unicode statistics, legacy schema defaults and existing credit/serialization.
- Browser regressions passed: canvas (28 viewport/layout combinations), rich
  formatting (10 groups), media/tables (9 groups), Focus Mode (21 scenarios), and
  project switching (15 groups), and editor/AI interactions (8 groups).
- The editor/AI suite's initial concurrent run missed its 220ms typing-during-entry
  timing window. The isolated rerun passed all eight groups; no animation behavior
  was changed to satisfy that timing assertion.

The writing-tools browser suite also generates a real Chromium print PDF and
checks its A4 geometry and content with pypdf. Physical printer output is untested.

See the included executed test results and screenshots. All browser writing uses
isolated accounts, HTTP fixtures and IndexedDB. Fixture document writes run through
the actual Python validator, with no live private documents, paid AI or payments.

## Previews

- [Document outline](outline-desktop.png)
- [Document statistics](statistics-desktop.png)
- [Find and replace on mobile](find-mobile.png)
- [Print preview](print-desktop.png)
- [Print controls on mobile](print-mobile.png)
- [Generated browser print PDF — synthetic writing](browser-print.pdf)

## Phase 3 production release

- URL: https://unoword.app
- Environment: production; Vercel project `unoword`, UnoWord team.
- Commit: `e351f93eaf35ff878d8afb5d50820d5d632a3335`.
- Deployment: `dpl_9gK9sBcApxmgka2KmQC8G7NfJ17o`, READY; custom domain assigned.
- Framework: existing Vercel Services (Vite frontend / FastAPI backend).
- Build duration: approximately 94 seconds.
- Read-only production check received the editor HTML and its new entry asset.
- Post-release error/fatal log query for this deployment returned no records in
  the 15-minute window. No log drains are configured; Vercel runtime logs were used.

Automatic approval review rejected the interactive production test command because
it could potentially persist test data. It was not retried or bypassed. Browser
workflows are verified with local isolated fixtures instead; production interaction
coverage is limited to the read-only deployment checks above.

Phase 5 requires approval.
