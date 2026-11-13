# Editor 2.0 — Phase 4 plan

Phase 3 approved for production; Phase 4 implementation authorized. Stop before
Phase 5. Keep Phase 4 on a separate branch for review before deployment.

Retain Tiptap, document JSON, revisioned autosave, session provenance, Focus Mode,
project ownership and AI scope. No Supabase schema changes are needed.

- Add literal, case-sensitive/insensitive document search with highlighted matches,
  next/previous navigation and single/all replacement. Search spans formatting
  marks but not structural boundaries. Replacements form one undo step and inherit
  source provenance conservatively; they must not turn older/pasted words into new
  typed progress. Bound highlights and report any search limit explicitly.
- Add a collapsible heading outline with navigation to the existing editor.
  Keep it out of Focus Mode and use an overlay on small screens.
- Add document statistics (Unicode characters, characters without whitespace,
  paragraphs, reading time and selected words), separate from session totals.
- Add Find, Replace, Save, Focus Mode and print shortcuts plus an accessible
  reference for existing formatting/navigation shortcuts. Keep browser shortcuts
  outside the editor and respect IME composition and modal dialogs.
- Add an explicit top-level page-break node. Preserve it in storage, undo and
  existing DOCX/PDF serializers. Reject page breaks inside tables/captions.
- Keep continuous editing. Add an isolated print preview with Letter/A4 and
  preset margins stored in document metadata, and print-only styles for headings,
  images, tables, captions and intentional breaks. Browser print preview provides
  pagination; do not claim artificial live pagination or perfect Word parity.

Verify literal search and mark boundaries, replacement provenance and undo,
document switches, completed documents, long documents, selection/outline
navigation, page-break persistence/export, print isolation, responsive menus,
accessibility, autosave and existing session/project/focus regressions.
