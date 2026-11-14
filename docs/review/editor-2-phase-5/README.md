# Editor 2.0 — Phase 5 review

Phase 5 is approved and deployed to https://unoword.app at commit
`92538d951ca0e56df1404ae9989a4e9c562dd64f`. Vercel reports production READY.
[Phase 6 review](../editor-2-phase-6/README.md).

[Implementation plan](../../editor-2-phase-5-plan.md)

## Import and export

The existing editor, API routes, document JSON, Supabase project and revisioned
autosave are retained. No migration or new service is needed.

**Import TXT, Markdown or DOCX** from the document library. A review dialog shows
the proposed title, a text excerpt and compatibility notes before **Create new
document**. Cancel writes nothing. Confirmation flushes the existing draft safely,
then creates a separate document in the captured project. Imported text has no
session-credit marks and does not become new typed progress. TXT/Markdown work
offline; DOCX needs the existing authenticated parser.

Delayed conversions are discarded across account/project changes. Late export
responses are discarded after leaving their owner/document. Downloads use current
local writing, including unsynced edits, rather than an older stored revision.

A document-identity boundary now resets transient ProseMirror plugin/undo state,
preventing Undo in a new/imported draft from restoring a previous document's body.
The same editor/view remains mounted. Same-document edits, autosave responses and
Focus Mode preserve normal undo/redo, selection and session behavior.

### DOCX

- Imports traverse paragraphs, tables and cells in their actual OOXML order.
- Supported headings/title/subtitle, bold/italic/underline/strike, text colors,
  highlight, mapped font families/sizes, paragraph alignment/spacing/indentation,
  basic nested bullets/numbered lists and deliberate page breaks are retained.
- Tables retain rectangular spans/merges and supported proportional column widths.
  Malformed, nested or oversized table geometry is rejected safely.
- Embedded raster images retain supported display size/alignment and alt text.
  An immediately following Word Caption paragraph is associated with its image.
- Export uses real OOXML numbering, starting numbers, nested levels, table merges,
  caption styles and page breaks. Checklists use printable checked/unchecked text
  with a dedicated style, rather than interactive Word form controls.
- The title is written as document metadata and a dedicated visible title style.
  A leading legacy Subtitle paragraph retains its metadata convention.
- Available fonts/sizes and a single Letter/A4 layout are mapped to the editor's
  finite settings, with compatibility notes when a mapping is needed.

### PDF

PDF export now uses bundled, licensed DejaVu serif/sans/mono fonts with regular,
bold, italic and bold-italic variants. Latin, Greek and Cyrillic text are tested.
No fonts are downloaded at export time. The UI warns that some scripts or emoji
may need browser Print for font coverage. UI font choices remain unchanged.

Headings keep their hierarchy, paragraphs retain supported spacing/alignment,
images keep proportions, tables fit printable width, nested lists keep their
indentation, and deliberate breaks create real pages. Actual highlight painting
is tested in the PDF content stream. Long cells can split across pages.

Default exports now use the editor's typography and Letter/1in print defaults,
including when older documents have no explicit metadata. Explicit A4/Letter and
narrow/normal/wide margins remain supported.

### Markdown and plain text

Basic prose, headings, lists and simple headed tables remain ordinary Markdown.
Safe HTML represents advanced typography, rich/merged tables, embedded figures,
associated captions, checklist formatting and page breaks when Markdown cannot
express them. A bounded, versioned UnoWord comment retains supported typography,
subtitle and print metadata. Other readers may ignore that metadata or HTML.

Import uses DOMPurify and the existing schema, removes external images and unsafe
CSS/links/scripts, normalizes embedded raster images and restores standard GFM
checklists/tables. It never imports session provenance or arbitrary root metadata.
TXT is UTF-8 plain text; literal HTML stays text. It has no rich-layout fidelity.
Standalone HTML import is not exposed.

## Compatibility limits

This is supported-format preservation, not perfect Microsoft Word compatibility.
Comments, tracked-change state, headers/footers, footnotes, fields, text boxes,
complex numbering, floating wrap and multi-section page layouts are unsupported
or simplified. The review notes explain these limits before creation. Some
unsupported embedded images are omitted with a note; linked images are never
fetched. Unsupported nested/irregular tables fail without touching existing work.
Fonts, line wrapping and pagination can differ between applications. DOCX uses
available Word-compatible font names; PDF embeds substitute DejaVu families.
Markdown viewers vary in HTML support. Physical printers, every Word version and
native mobile schema/release parity are not claimed.

## Verification

Browser fixtures use the actual production bundle, real IndexedDB, and real Python
import/export/document validation with synthetic writing. There are no live
private documents, payments or paid AI calls.

- Production build and focused frontend lint passed. All 130 frontend/backend
  tests passed (25 frontend, 57 document/backend, 48 isolated workspace API).
- 25 frontend tests passed. They cover portable Markdown/escaping/metadata, document-history
  boundaries, existing schema/formatting serialization and session provenance.
- 57 backend document tests passed. They cover OOXML order, spans/merges, caption association, nested
  numbering/checklists, typography, page geometry, PDF painted highlights,
  long-table splitting, Unicode, archive/entity/macro rejection and external-image
  omission, plus existing document/media/session tests.
- 48 workspace API tests passed. They use `TestClient(app)`, in-memory storage/entitlement mocks and
  a process-wide outbound socket guard. The first network-enabled command was
  rejected by automatic approval review because the shared conftest describes live
  QA fixtures. Inspection confirmed this module uses local mocks; the guarded,
  isolated alternative passed without allowing outbound service connections.
- All 9 portability browser groups passed. They cover review/cancel/new-document integrity, all four actual
  downloads, rich and GFM Markdown import, offline TXT/MD synchronization,
  document/project async boundaries, file rejection, 320–1440px layouts and axe
  WCAG 2/2.1 AA checks.

Browser regressions also passed: 21 Focus Mode scenarios, 15 project-switching
groups, 10 rich-formatting groups and the legacy image workflow (upload,
validation, offline reload, clipboard, Markdown roundtrip, read-only, responsive,
dark and Spanish checks). All 11 Phase 4 writing-tools groups also passed on this branch.

Reproduce the isolated API checks with
`python backend/tests/run_isolated_workspace.py`; see the runner's outbound guard.
The production browser entry point is `node tests/editor-portability.browser.cjs`
after building; set `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `AXE_SCRIPT` and
`FORMATTING_PYTHON` to installed test dependencies.

Existing dark-theme and floating-toolbar tests now wait for settled presentation
before measuring contrast/position. Production animation behavior was not changed
to satisfy those asynchronous test assertions.

## Files and previews

- [Import review](import-desktop.png)
- [Import review on mobile](import-mobile.png)
- [Export notes on mobile](export-mobile.png)
- [Exported PDF](sample.pdf) and [first page](pdf-preview.png)
- [Exported DOCX](sample.docx)
- [DOCX rendered by LibreOffice to PDF](libreoffice.pdf)
- [Portable Markdown](sample.md) and [plain text](sample.txt)

All examples are synthetic. LibreOfficeDev 26.8 opened the DOCX and rendered a
2-page PDF. pypdf verified text from tables, captions, nested lists and the final
page; exported PDFs were also rendered for visual inspection. LibreOffice emitted
font-cache directory warnings, but completed conversion. Native Microsoft Word
was not available; its exact rendering is unverified.

## Phase 4 production release

- URL: https://unoword.app — production READY.
- Commit: `1015bbcc5479b65822b0049dfed6b3dd9fa7c2bd`.
- Vercel project: `unoword`, UnoWord team; existing Vite/FastAPI Services.
- Deployment: `dpl_7U3wzDNkMSJSAvNv1XzJe7fhcKup`; approximately 53 seconds to build.
- Custom domain assigned; read-only editor HTML check received the new entry asset.
- Error/fatal log query returned no records for this deployment in the 15-minute
  post-release window. No log drains were configured at the prior inspection;
  Vercel runtime logs were used. No stateful production tests were performed.

Phase 5 deployment and Phase 6 require approval.
