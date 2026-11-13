# Editor 2.0 — Phase 5 implementation plan

Phase 4 approved for deployment; Phase 5 authorized. Retain Tiptap, Supabase JSONB,
revisioned autosave, source provenance and project ownership. Stop before Phase 6;
keep Phase 5 local for review before release. No database migration.

## Audit findings

Existing TXT/Markdown exports run offline from current editor content. DOCX/PDF
POST exports also use unsynced content. Their validators already support the
Phase 1–4 schema, tables, image layouts, captions and print metadata. DOCX import
reads all paragraphs before all tables, flattens tables, loses most typography,
list nesting, breaks, image display sizes and caption association. Markdown's
allowlist discards tables, captions, checklist controls and document styles.
Imports create new documents, but need explicit compatibility feedback and guards
against delayed conversion across owner/project changes. Export downloads need
similar identity guards and concurrent-operation feedback.

## Implementation

- Keep the existing API routes and libraries. Move DOCX parsing into a bounded
  module that traverses real OOXML body/cell order, reconstructs rectangular
  tables/merges, nested lists, paragraph/text formatting, page breaks, embedded
  images/display size and associated captions where representable.
- Preserve supported page size/margins and document typography; map unsupported
  fonts/sizes to the finite editor vocabulary and report limitations. External
  image relationships are never fetched. Reject unsafe archives, macros,
  malformed dimensions and unsupported nested-table geometry safely.
- Improve DOCX export semantics (nested numbering, captions, intentional breaks,
  block order), PDF typography/font coverage and layout within printable margins.
  Use distributable bundled fonts with licenses, preserving supported styles.
- Improve Markdown's safe rich-HTML fallback for editor-only formatting, figures,
  tables, checklist state and breaks while retaining normal Markdown for basic
  prose. Preserve supported document metadata in an explicitly marked, bounded
  format. Never import session-credit marks. TXT remains plain UTF-8.
- Add an import review dialog with title, body excerpt, compatibility notes and
  Create new document / Cancel. Keep TXT/MD available offline; DOCX uses the
  authenticated bounded parser. Capture owner/project and discard stale results.
  Never overwrite an existing draft or count imported content as typed progress.
  Clear transient undo/plugin state at document-identity boundaries so a new
  import cannot undo into an older draft; preserve same-document/Focus history.
- Explain format limitations in the export UI. Guard async downloads by owner
  and document, keep filenames safe and use the newest unsynced content.

## Verification

Test real API authorization/limits, malicious HTML/archives/relationships,
DOCX and Markdown supported-format roundtrips, block order/merges/lists/images,
page geometry/breaks, original-document/session integrity, offline imports and
identity/project changes during conversion. Generate PDF/DOCX/MD/TXT examples;
open/render DOCX in LibreOffice and read PDF with compatible tools. Document
remaining fidelity limits rather than claiming perfect Microsoft Word support.
