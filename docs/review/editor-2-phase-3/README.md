# Editor 2.0 — Phase 3 review

Phase 2 approved. Phase 3 adds image layouts/captions and tables to the existing
Tiptap editor. This work is local, on `feature/editor-2-media`, and not deployed.
Stop for approval before Phase 4.

[Implementation plan](../../editor-2-phase-3-plan.md)

## Images

Select an image to reveal the **Image** menu and two corner resize handles.

- Resize with drag handles, arrow keys (Shift = 50px), or a numeric width field.
  One completed drag is one undoable change. Aspect ratio remains locked.
- Align left, center or right. Comfortable, Original size and Fit to page all
  respect the available content width; small images remain small by default.
- Add/edit a caption within the image figure. Caption text uses ordinary editor
  text and provenance marks, so typed and pasted words remain separate and undo
  restores their original credit. Caption limit: 2,000 characters.
- Enter exits the caption. Boundary deletion and heading/list commands cannot
  accidentally convert a caption into a paragraph and discard the image.
- Replace an image while retaining its caption and layout. Async replacements
  map the original node bookmark and abort on document/account changes.
- Delete the image and caption together, with undo. Edit its accessible description
  in the same panel.

Intrinsic image width/height stay unchanged; display size is stored separately.
Existing empty image nodes remain valid. The node is extended with inline caption
content rather than replacing the editor or introducing unattached caption records.
Dimensions reserve the image's aspect ratio before loading.

Images deliberately use **block / break-text placement**. Floating text wrap and
inline placement are deferred: the existing Word/PDF serializers cannot reliably
preserve those models. No unsupported cosmetic wrapping controls are exposed.

## Tables

The Table menu provides insertion and contextual editing:

- Rows/columns with an optional first header row (enabled on insertion).
- Add/delete rows and columns, toggle headers, delete the table.
- Select cells with Shift + click, then merge/split supported rectangular ranges.
- Left/center/right/justified paragraph alignment inside cells.
- Drag column borders or enter a numeric column width for keyboard access.
- Tab/Shift+Tab navigate cells; wide tables scroll inside their own accessible
  region on narrow screens, rather than stretching ordinary paragraphs.

The official Tiptap table extension is pinned to **3.32.0**, matching the existing
editor. Limits: 100 rows, 20 columns, no nested tables; column widths are bounded.
Clipboard parsing bounds raw cell spans before table-grid allocation.
Storage validation checks spans, widths and rectangular geometry and rejects holes,
overlap and malformed nested structures.

Table insertion preserves selected prose. Structural table changes retain original
word provenance, including pasted cell text; they do not relabel moved text as new
writing. Images inserted from a selection also preserve the surrounding prose.

## Existing persistence and exporters

No Supabase migration, project, bucket or ownership change is needed. The existing
JSONB content column and revisioned autosave/IndexedDB pipeline remain in use.
The connected **UnoWord** project is accessible and ACTIVE_HEALTHY; read-only
metadata queries confirmed JSONB content, revision/mutation fields and existing
size constraints. No private document contents were queried or changed.

Server validation and existing serializers now preserve captions, image display
sizes/alignment, table content, spans and supported column proportions. DOCX tests
inspect real tables, merges and image dimensions; PDF tests extract caption/table
text from generated files. Simple tables export as Markdown; spans or rich cell
blocks use escaped HTML tables. Plain text retains caption/cell text.

This is not a claim of perfect Microsoft Word compatibility, physical print parity,
or full import roundtrip support. Full import/export work remains Phase 5. Native
mobile application release/schema parity is outside this browser-editor phase;
responsive Chromium viewports are tested, not physical devices or a native release.

## Verification

- The selection toolbar stays within the writing viewport, keeping the main toolbar accessible.
- Production build passed: TypeScript, motion-token and branding checks included.
- Focused frontend lint passed.
- 38 backend tests passed: image/caption validation, rectangular table constraints,
  horizontal/vertical merges, native cell alignment, DOCX/PDF/Markdown serialization and existing formatting
  and session-credit tests.
- 11 frontend tests passed: schema defaults/legacy images, caption/Markdown table
  serialization and existing word-credit regressions.
- Nine browser media scenario groups passed. The suite uses the actual production editor, real IndexedDB and
  isolated HTTP fixtures; document writes pass through the real Python validator.
  It exercises insertion, all resize paths, one-step undo, caption typing/paste,
  boundary protection, replacement/deletion, real cell selection, merges, pointer
  column resizing, reopen, offline/reconnect, focus, stale replacement cancellation
  and oversized clipboard spans.
- Image/table panels and bounds are checked at 1440, 1024, 768, 390 and 320px,
  including axe WCAG 2/2.1 AA audits and contained horizontal table scrolling.

Browser entry point (after building):

```sh
node tests/editor-media.browser.cjs
```

Set `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `AXE_SCRIPT` to installed paths;
set `FORMATTING_PYTHON` to a Python environment with backend dependencies to exercise
real validation. No live Supabase document writes or paid AI calls are used.

## Previews

- [Image controls and caption](image-desktop.png)
- [Editable table](table-desktop.png)
- [Image controls on mobile](image-mobile.png)
- [Table controls on mobile](table-mobile.png)
- [Focus Mode](focus-media.png)

Additional browser regression suites passed on the Phase 3 implementation:

| Suite | Executed result |
| --- | --- |
| Canvas | 28 viewport/layout combinations, focus, history, autosave/reopen |
| Rich formatting | 10 scenario groups |
| Focus Mode | 21 scenarios |
| Project switching | 15 scenario groups |
| Editor/AI controls | 8 scenario groups |
| Legacy images | Upload, validation, offline reload, clipboard, Markdown roundtrip, completed/read-only and responsive checks |

The included result JSON files record executed scenarios and canvas measurements.
Phase 4 (find/replace, outline, statistics and professional writing tools) remains
pending approval under the requested phase gate.
