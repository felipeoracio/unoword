# UnoWord Editor 2.0 — audit and phased plan

Phases 1–5 are approved and deployed. Phase 6 is implemented locally for
[review](review/editor-2-phase-6/README.md); Phase 7 awaits approval.

## Architecture and existing capabilities

Audit of `frontend/src/pages/WritingEditor.tsx`, `lib/document-image.ts`,
`lib/document-subtitle.ts`, `lib/session-credit.ts`, `lib/use-writing-workspace.ts`,
`lib/use-focus-mode.ts`, `lib/use-project-workspace.ts`, the editor stylesheets,
and `backend/lib/writing_document.py` / `backend/routers/workspace.py`.

| Area | Existing implementation | Remaining work / phase |
| --- | --- | --- |
| Framework | Tiptap 3.32, ProseMirror state/history; one retained editor instance | Keep this framework and instance throughout |
| Document format | JSON tree: paragraphs, H1–H3, lists/list items, quotes, rules, hard breaks, safe block images; root subtitle; bold/italic/underline/strike/link and session provenance marks | Extend schemas deliberately, with server validation and export parity, in later phases |
| Toolbar | Heading selector, basic inline formatting, alignment, bullet/numbered lists, quotes, rules, images, links, undo/redo | Group advanced font/color/paragraph controls in Phase 2 |
| Images | Embedded PNG/JPEG/WebP only; validated, compressed to bounded WebP; width/height stored, aspect ratio preserved; 192KB image and document-size limits; bookmarked insertion prevents replacing selected writing | Phase 1 display cap and centering; resizing/alignment/captions in Phase 3 |
| Storage / autosave | Existing Supabase workspace API; IndexedDB local drafts; 1s debounced sync; revision/mutation conflict checks, per-owner guards, recovery, queued offline changes, truthful save status | Preserve; no migrations or new Supabase project in Phase 1 |
| Undo / redo | ProseMirror history; content hydration suppresses update and avoids resetting history on autosave | Verify view changes leave history and selection untouched |
| Sessions / words | Document tokenizer separate from session typed/pasted provenance; session timers, pause/resume/end, completed records | Preserve and run existing word-credit regression tests |
| Focus Mode | Presentation-only transition snapshots paper width, selection/scroll and chrome geometry; editor stays mounted | Preserve stable paper width through transition; responsive constraints |
| Projects | Persistent project picker, flushed writes, ownership/membership guards, remembered documents, scoped resources | No changes; run project-switch regression suite |
| AI | Existing suggestions and coaching modes; consent and usage limits; five explicit context scopes; no automatic insertion | No changes; run existing editor/AI regression suite |
| Export | Latest unsynced document exports; TXT/Markdown client support, DOCX/PDF bounded server exporters; supports current headings/lists/formatting/images | Phase 5 verify layout/export parity; no new print fidelity claims in Phase 1 |
| Import | TXT/Markdown create new documents; sanitized Markdown HTML through DOMPurify/schema; bounded server DOCX import with supported images | Phase 5 improve fidelity and unsupported-format feedback |
| Responsive | Scrollable compact toolbar; overlay side panels below 1200px; mobile adjustments; light/dark themes; English/Spanish | Phase 1 actual viewport and image measurements + screenshots |
| Professional tools | Document/session words and time, title/subtitle, standard editor shortcuts | Find/replace, outline, full statistics, page breaks and print in Phase 4; tables/checklists still require schema work |

## Phase 1 implementation plan

1. Retain the current editor schema and state. Add a presentation-only canvas
   stylesheet after existing editor styles, avoiding document mutations.
2. Default to Comfortable: max 816px outer paper, 48px desktop side padding,
   yielding at most 718px of text after borders. Standard Page uses a US Letter
   visual proportion, a continuous editing surface and larger margins (not live
   pagination). Wide supports ~1040px text; Full Width is explicitly opt-in.
   All modes shrink naturally to the available workspace, with mobile padding.
3. Add a compact View menu in the document bar, with a labeled Page Width selector.
   Persist the choice per account on this browser. Width is a viewing preference,
   not document formatting or an export setting.
4. Use 18px body text, 1.7 line height, measured paragraph spacing, coherent headings
   and nested-list indentation; preserve explicit stored alignment/formatting.
5. Center images by default, cap their normal display to 560px and content width,
   keep small images at their stored/intrinsic size, and retain aspect ratio and
   stored dimensions. Do not rewrite existing image JSON. Phase 3 will add controls.
6. Test the actual built editor with isolated API fixtures and IndexedDB. Measure
   desktop/ultrawide/tablet/mobile text and image bounds; verify width persistence,
   selection/history, focus transitions, autosave and reopen. Run existing editor,
   project and session regressions. No live/private writing is used for tests.

No major architectural change is proposed. No database migrations are needed.
Per-document typography settings are Phase 2; custom margins, page-size selection
and export-aware layout are Phases 4/5, rather than hidden schema changes now.

## Approval checkpoints

Phases 1–5 are approved and deployed at commit `92538d9`. Phase 6 is
implemented separately for [review](review/editor-2-phase-6/README.md); its release
and Phase 7 remain pending approval. Historical phase descriptions follow.

- **Phase 1 (completed and approved):** audit + canvas/layout/typography/image-fit preview. Stop
  and request approval before Phase 2. Do not deploy this redesign without review.
- **Phase 2:** grouped rich formatting, fonts/sizes/colors/highlight, paragraph
  styles, indentation/checklists and optional contextual toolbar. Extend frontend,
  server validation and serialization together; verify autosave/history/reopen.
- **Phase 3:** image sizing/alignment/captions and reliable wrapping; basic tables
  and responsive table containers. Verify persistence and supported exports.
- **Phase 4:** find/replace, outline, statistics, shortcuts, page breaks and print
  layout; keep continuous editing when live pagination would compromise stability.
- **Phase 5:** import/export fidelity across PDF/DOCX/Markdown/text; explicit limits,
  sanitized input and safe new-document imports, compatible-application checks.
- **Phase 6:** established motion tokens for toolbar/context/focus/open/switch/save
  feedback, with reduced-motion support.
- **Phase 7:** long-document performance, accessibility and cross-feature regressions;
  preserve ownership/context isolation, analytics and existing Supabase data.

Each next phase requires the user's approval. Do not implement the complete list
at once. Pricing, AI limits, existing records and authored content remain outside
this redesign's mutation scope.

## Regression finding during Phase 1

The project-switch tests exposed a stale closure in the recently added session
credit extension: Tiptap installs extensions once, and its credit callback retained
the pre-authentication device identity. New sessions could therefore be saved with
a device ID that the signed-in editor would not restore. The callback now delegates
to a ref containing the latest render's identity/session functions. This does not
rewrite any historical session rows or reset statistics. The canvas browser suite
asserts that even the first edit uses the signed-in device ID and that the session
UI restores after reload; the full project/session and editor suites are rerun.
