# Editor 2.0 — Phase 2 implementation plan

Phase 1 approved by the user. Phase 2 authorized; stop before Phase 3.

Keep Tiptap/ProseMirror, the retained editor instance, existing document JSON and
revisioned save/recovery APIs. No Supabase migrations or infrastructure changes.

- Add bounded text-style and highlight marks, paragraph spacing/line-height/indent
  attributes, title/subtitle style variants, and document typography metadata.
- Use the installed official Tiptap task-list/task-item implementation for nested
  checklists. Keep ordinary bullet/numbered lists and existing shortcuts.
- Preserve all new fields through server document validation. Reject arbitrary CSS;
  accept only approved font categories, sizes, spacing, colors and indent ranges.
- Keep the familiar basic toolbar; group advanced controls in Text, Paragraph and
  Document style panels. Add checklist/indent/justify and safe Clear Formatting.
- Optional selection toolbar with a persisted per-account browser toggle; keyboard
  alternatives remain in the main toolbar. Do not remount the editor or obscure
  selection. Hide while disabled, composing, noneditable or in external dialogs.
- Root typography applies to this document and survives reopening. Inline font/size
  controls apply to a selection. Existing explicit formatting takes precedence.
- Update existing serializers enough to retain checklist content and supported
  formatting safely. Full pagination/import-export fidelity remains Phase 5.
- Test real formatting UI, mixed selections, nested lists/checklists, clear format,
  undo/redo, autosave/offline/reopen, saved JSON, session provenance, project/focus
  regressions, responsive controls and accessibility. Include actual screenshots.

Fonts use existing system Georgia and bundled Inter/JetBrains Mono resources.
No automatic AI insertion, pricing changes, AI scope changes or analytics resets.
Do not deploy Phase 2 without a separate release instruction.
