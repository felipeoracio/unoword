# Editor subtitles and section copying

The editor has an optional subtitle below the title, with separate Copy title,
Copy subtitle and Copy body controls. Copy body supplies both formatted HTML and
plain text where supported; title/subtitle copy their exact text. Copy failures
show an accessible error and never report success. Empty sections disable their
copy button. Copying works offline and on completed read-only documents.

Subtitles use the existing revisioned document JSON (`content.attrs.subtitle`),
not a new table or database column. Autosave, offline storage, document sync,
duplication, completion and conflict recovery therefore preserve them through
the existing workflow. **No database migration is needed.** The backend validates
subtitle text at 500 characters, strips unsupported metadata and preserves an
existing subtitle when an older cached client omits the attribute. New clients
send an explicit null to clear it.

The subtitle stays outside the body. Metadata editing and copying do not start
sessions or add tracked words. TXT/Markdown/DOCX/PDF exports retain the subtitle;
DOCX imports recognize a leading Subtitle paragraph. Body copying excludes both
title and subtitle. Document search includes subtitle text.

The Tiptap loading path explicitly restores root attributes because setContent
replaces body nodes without restoring root metadata. Hydration suppresses update
events, avoiding phantom edits and protecting subtitles during later body edits.

Validation:

- Production build/TypeScript passed; lint has only the four pre-existing UI and
  admin warnings.
- 53 selected backend tests passed, including subtitle persistence, old-client
  preservation, explicit clearing, completion, validation, safe exports and DOCX
  subtitle round-trip, ownership and existing subscription boundaries.
- Dedicated production-bundle Chromium tests passed for exact clipboard values,
  formatted body copying, denied permissions, autosave/reload, body editing after
  reopening, offline edit/copy/reload/reconnect, clearing, unchanged tracked words
  and session count, TXT/Markdown exports, completed-document copying, focus,
  light/dark themes, English/Spanish and 320/390/768/1440px layout/accessibility.
- Existing full editor browser regression passed: authentication, formatting,
  word tracking, folders/library, conflicts, AI consent, import/export, offline
  recovery, Free editor denial and Monthly/Lifetime access.
- A read-only query against the actual Supabase schema verified subtitle-search
  compatibility without changing data.

Local screenshots:
`/workspace/.onboarding/unoword/subtitle-copy/subtitle-copy-1440.png` and
`/workspace/.onboarding/unoword/subtitle-copy/subtitle-copy-390.png`.

Files: editor UI/CSS, new document-subtitle and copy-writing helpers, client
Markdown serialization, existing backend document validation/export/API helpers,
and workspace backend/browser tests. The extension and billing are unchanged.
