# Editor folder creation fix

Folder creation previously required a successful cloud POST before updating the
sidebar. Production `writing_folders` and `writing_documents` currently return
404 from Supabase, so that operation failed; its error was behind the open modal.
Offline creation also failed for the same reason.

Folders now commit to owner-specific IndexedDB before appearing in the sidebar
or document folder selector. Pending folders survive reloads and are merged with
cloud results rather than replaced. Synchronization creates folders before
saving documents that reference them. Each folder keeps one UUID; the new
owner-scoped, Pro-protected PUT endpoint ignores duplicate insert retries and
returns the existing folder. It does not overwrite names on delayed retries.

The creation dialog trims names, explains empty/whitespace names inside the
modal, reports local-storage failures inline, and disables repeat submissions.
Both English and Spanish messages are supported. Existing Pro restrictions and
account-change isolation remain in place. No database migration is added by this
fix.

Files: `backend/routers/workspace.py`, `backend/tests/test_workspace.py`,
`frontend/src/lib/writing.ts`, `frontend/src/lib/writing-cache.ts`,
`frontend/src/lib/use-writing-workspace.ts`,
`frontend/src/pages/WritingEditor.tsx`, and
`tests/writing-workspace.browser.cjs`.

Verification: production build/TypeScript; lint (only four existing unrelated
warnings); 38 workspace/product backend tests; full editor browser regression.
Added coverage checks folder creation and document assignment, inline validation,
a 503 during cloud creation followed by reload and recovery, offline folder
creation/reload/reconnect, duplicate retries, owner checks, and Free denial.
Browser fixtures do not create real accounts, call AI, or change production data.

Cloud sync still needs the previously supplied workspace schema and Pro policies
in Supabase; see `docs/pro-writing-workspace.md`. Until those are activated,
folders and writing stay on this browser and synchronization remains queued.
Use the same browser profile and do not clear site data before cloud sync or
exporting your work.
