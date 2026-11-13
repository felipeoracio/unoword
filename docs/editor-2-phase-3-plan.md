# Editor 2.0 — Phase 3 plan

Phase 2 approved; Phase 3 authorized. Stop before Phase 4 and do not deploy.

Retain Tiptap, the existing image node name and JSON documents, session credit,
revisioned autosave and Supabase storage. No new database or migrations.

## Images

Keep source width/height intrinsic. Add bounded display mode/width and alignment.
Extend the existing image node to allow inline caption content; existing empty
image nodes remain valid. Captions are associated with their image and ordinary
ProseMirror text, so editing, undo and typed/pasted provenance work naturally.

Add a DOM node view with an aspect-preserving figure, keyboard-accessible corner
handles and one history transaction per completed drag. A contextual panel offers
numeric size, left/center/right alignment, original/fit sizing, captions, safe
replacement and deletion. Async replacements map their node bookmark and abort
on document/identity changes. No authored text is replaced during insertion.

Use reliable block / break-text placement. Defer inline images and floating text
wrap: they require a different schema/Word anchoring model and current exporters
cannot preserve them reliably. Do not expose cosmetic wrap controls that lose
layout when reopened or exported.

## Tables

Pin the official Tiptap 3.32 table extension to the existing editor version.
Support bounded insertion, row/column operations, header rows, merge/split,
paragraph alignment inside cells, pointer column resizing and numeric keyboard
column sizing. Wrap tables in a horizontally scrollable region on small screens.
Keep cell content in the existing block schema with safe colspan/rowspan/colwidth
validation and rectangular grid checks. No nested tables.

## Persistence / existing exporters

Extend server validation and existing TXT/Markdown/DOCX/PDF serialization together
so tables/captions never silently disappear. Preserve image alignment/size/caption
and supported table merges and widths in DOCX/PDF. Use Markdown tables for simple
structures and safe HTML tables when spans require it. No perfect Word roundtrip
or live pagination claim; comprehensive import/export work remains Phase 5.

## Verification

Run actual built-editor tests with isolated APIs + the real Python validator:
image drag/keyboard/numeric resize, alignment, captions and provenance, replacement
cancellation, deletion, undo/redo, merge/split, table navigation/resizing, reopen,
offline sync, desktop/tablet/mobile geometry and accessibility. Generate real
preview screenshots and backend serialization/security tests. Re-run relevant
canvas, formatting, focus and project regressions. Never touch private writing.
