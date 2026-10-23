# Uno Word writing workspace

The full-page editor lives at **`/editor`**, alongside the existing marketing,
account and admin routes. The account page and extension **Open Writing Editor**
action open the same workspace. The extension release is **0.15.1**.

## Activate cloud saving

1. Open the existing Supabase project `jvcbpnmtnjhftpukgppw`.
2. Go to **SQL Editor → New query**.
3. Paste the entire [workspace migration](../supabase/migrations/20261023010000_writing_workspace.sql) and select **Run**.
4. Run the [Pro workspace access migration](../supabase/migrations/20261023020000_writing_workspace_pro.sql).
5. Reopen `/editor` with an eligible Pro account, or use its refresh/retry button to synchronize local changes.

The migration is additive and has passed isolated PostgreSQL execution and reapply
tests. It does not reset accounts, documents, AI usage, billing or extension
history. This cloud workspace has no working SQL connection to production, so
applying it in the Supabase dashboard remains an owner action. Missing tables
produce a sync error while preserving device-local drafts.

## Architecture and reuse

- React/TypeScript/Vite adds a lazy-loaded Tiptap editor with StarterKit and
  TextAlign. Public landing pages do not load the editor bundle. Existing brand
  assets, authentication routes and design colors are reused.
- FastAPI adds `/api/workspace`. Existing HTTP-only Supabase cookies authenticate
  users. Writes validate the browser origin and expected account ID. All document
  queries forward the verified JWT with an owner predicate; database RLS enforces
  that owner independently.
- New `writing_documents`, `writing_folders` and `writing_activity` tables keep
  editable writing and counts separate from existing AI reference uploads.
  `workspace_ai_requests` holds service-only quota reservations.
- The editor imports the extension's actual tokenizer, word reducer, prompt bank,
  date functions and streak engine. It uses the same Writing Profile, AI provider,
  entitlement, suggestion, feedback and usage systems. Stripe pricing and live
  billing approval are unchanged.

## Documents, offline work and conflicts

Users can create, rename, search titles/content, favorite, duplicate, assign
folders, archive, trash and restore documents. Library queries paginate metadata;
full content loads when a document is opened. Created/modified dates are visible.
Light/dark themes, focus mode, mobile drawers and English/Spanish controls are
included. Escape exits focus mode.

Every edit first persists to account- and tab-specific IndexedDB, then synchronizes
with the server. Status distinguishes local persistence, cloud saving, offline
writing and errors. Before-unload protection covers pending/failed device writes.
Revision comparisons run inside a database transaction. Mutation UUIDs make
lost-response retries idempotent. A stale revision preserves both versions for
comparison and **Keep both copies**; it never silently overwrites newer writing.
Other tabs' unsynced drafts appear as recoverable copies.

A service worker caches only the static editor shell and bundled assets, never
authenticated APIs or account pages. Offline reopening needs one successful
online visit. Previously opened documents and local drafts remain editable, and
reconnection retries under a freshly verified identity. Account changes stop
synchronization and do not reveal another account's cached writing.

Offline copies remain in this browser until its site data is cleared. They are
browser storage, not an encrypted backup service. Use a trusted browser profile;
browser storage eviction and clearing site data can remove local copies.

## Statistics and extension integration

Document count includes current body text. Activity counts new typed words, tracks
pasted words separately, and checkpoints active writing time. Importing,
duplicating, loading and inserting AI output do not count as typing. Deletion
reduces the current session using the existing reducer.

Each editor activity has one UUID and increasing snapshot sequence: retries update
the same record and late snapshots cannot restore deleted words. Only metadata is
stored in `writing_activity`. Sessions split on document changes or calendar days.

The extension skips ordinary typing tracking on the official `/editor` page. It
reads authenticated activity records and merges them by stable IDs into its
existing dashboard; it never trusts counts supplied by page messages. Its local
non-editor sessions can also appear in the web editor through an origin/owner
checked metadata bridge. Imported editor rows are excluded from that bridge.

The extension passes its current daily goal and timezone when opening the editor.
Goals can be adjusted without changing billing. Clearing extension history remains
a device-local operation; it does not delete cloud manuscripts or cloud activity.
A clear timestamp prevents older imported editor history from reappearing.

## AI and plan permissions

The editor, document library, cloud saving, formatting, focus mode, and
import/export require an active Pro subscription or eligible trial. Pro users can
write offline and sync local drafts after reconnecting. Free retains extension
tracking, recent history, and the original **Quick Prompt** bank. Quick Prompt
does not call a model or consume AI allowance. Downgrading preserves existing
documents and drafts; see [Pro workspace access](pro-writing-workspace.md).

Pro users may request three next-topic directions, continuation, writer's-block
questions, three brainstorming angles/outlines, or improvements to a selection.
The server checks active entitlements and existing daily limits. A durable SQL
reservation prevents concurrent new editor calls exceeding that allowance. One
provider call returning three ideas uses **one request**. Successful editor calls
also appear in the existing usage summary and original suggestion endpoint's cap.
Failed provider calls release their reservation.

Each request reloads the canonical Writing Profile, onboarding answers, themes,
preferences, enabled reference materials, writing memory, previous suggestions and
feedback. Written documents enter personalization only with their explicit opt-in.
Revoked sources and historical suggestions that depend on them are excluded.

Sharing the current draft requires a request-specific checkbox. Autosave does not
send drafts to a model or create embeddings. AI proposals render as text and never
replace writing automatically. Applying an improvement checks that the document
still matches the version reviewed; later edits require a fresh proposal.
Profile edits use `/api/ai/profile`; Cancel retains saved values. Reference controls
operate on existing Writing Library sources. Upload and website ingestion remain
available through the existing extension Library.

## Portable files

TXT/Markdown import and export work offline with current local content. Markdown
HTML is sanitized and parsed into the supported schema. DOCX import reuses the
existing ZIP safety limits (5 MB upload and bounded expansion), preserving basic
headings, lists, links, alignment and inline styles. Complex Word tables flatten to
text; images, tracked changes and elaborate page layouts are not supported.

DOCX/PDF exports use authenticated server endpoints and the current draft, so an
older cloud revision is never exported accidentally. These formats need internet.
DOCX uses existing `python-docx`; PDF uses ReportLab. Unsupported structures,
unsafe links and oversized documents are rejected or sanitized server-side.

## Verification and preview

The final verification includes **170 passing backend tests**, the PostgreSQL/RLS
suite, the production-browser workflow, and WCAG 2/2.1 AA automated checks on
light/dark desktop and Spanish mobile layouts. Four pre-existing frontend lint
warnings remain in shared UI/admin files; the editor adds no lint warnings.

Main implementation files:

- `frontend/src/pages/WritingEditor.tsx` and `frontend/src/styles/writing-editor.css`:
  editor, library, assistant, responsive layouts and dialogs.
- `frontend/src/lib/use-writing-workspace.ts`, `writing-cache.ts`, `writing.ts`,
  `writing-markdown.ts`, and `frontend/public/writing-sw.js`: saving, synchronization,
  shared counting, offline persistence and portable text formats.
- `backend/routers/workspace.py`, `backend/lib/writing_document.py`, and
  `backend/lib/workspace_ai.py`: private APIs, safe rich text, exports and assistance.
- `extension/background.js`, `extension/content.js`, and `extension/popup/*`:
  workspace launch, activity synchronization and account-change notifications.
- The additive SQL migration and new backend, PostgreSQL, browser and bridge tests.

- Production build and TypeScript checks.
- Backend authentication, owner/origin checks, consent, real DOCX/PDF generation,
  imports, provider-boundary personalization, source exclusion and quota tests.
- PostgreSQL migration/reapply, owner RLS, foreign folder rejection, revision
  conflicts, idempotent saves, stale activity retries and AI reservations.
- Production-bundle Chromium workflow covering create/save/reopen, formatting,
  library actions, conflicts, AI approval and stale-proposal protection, profile
  Cancel/save, reference controls, portable files, focus and themes.
- Offline reload/reconnect and simultaneous offline edits in two real tabs.
- English/Spanish layouts at 320, 390, 768 and 1440px.
- Existing extension unit, dashboard, suggestion-mode, profile/security and
  progress regressions, plus editor activity deduplication and clear-history tests.

Tests use isolated fixtures, not real users or paid model calls. Production cloud
round-trip testing requires the activation step above. Browser screenshots are
saved under the cloud workspace's onboarding artifacts.

After `yarn build`, serve with `yarn vite preview --port 4175`, then run:

```sh
node tests/writing-workspace.browser.cjs
```

Optional `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `WRITING_TEST_ORIGIN` and
`WRITING_SCREENSHOTS` select the browser, server and screenshot directory.

After deployment, visit `/editor`. For Chrome, download the extension ZIP, extract
over the existing unpacked extension directory, reload on `chrome://extensions`,
and reload writing tabs. Keep the same directory to preserve local history/settings.

**Every idea starts with Uno Word.**
