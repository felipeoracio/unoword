# Pro writing workspace and offline saving

The writing editor and its private document library are now Pro-only features.
Free retains Chrome extension tracking, Quick Prompt, and recent history. The
public product catalog and landing-page pricing cards use the same plan policy.
Pricing, trial duration, and Stripe billing behavior are unchanged.

## Access enforcement

- `backend/lib/plans.py`: `writing_editor` is false for Free and true for Pro.
- `backend/routers/workspace.py`: document reads/writes, folder management,
  configuration, import/export, and new editor activity require the existing
  server-verified active/trialing Pro entitlement. Expired, canceled, past-due,
  Free, signed-out, and Stripe-mode-mismatched accounts are denied. Existing
  AI routes retain their paid checks. Historical counts remain owner-scoped and
  readable after downgrade so extension progress is preserved.
- `frontend/src/lib/use-writing-workspace.ts` and `WritingEditor.tsx`: Free users
  see an upgrade screen before private documents or local drafts load. The app
  rechecks access on focus, reconnect, and periodic synchronization. Downgrades
  hide the workspace without deleting IndexedDB drafts or cloud documents;
  renewal restores access. Account links offer an upgrade instead of opening
  the editor for Free users. The gate is translated into English and Spanish.
- `frontend/src/pages/Home.tsx` and `landing.css`: the editor/library appear on
  Pro pricing only, with Pro labels on paid feature cards and matching FAQ copy.
- `supabase/migrations/20261023020000_writing_workspace_pro.sql`: additive,
  restrictive RLS policies enforce active Pro ownership even through direct
  Supabase requests and workspace RPCs. No documents or folders are deleted.

## Offline behavior

Pro users can continue editing cached documents and create new documents offline
once the editor has been opened online in that browser. Every change saves first
to account-specific IndexedDB; the service worker caches the editor shell and
bundled assets, never private API responses. The UI reports local/offline status.
Reconnection verifies the account and Pro entitlement, then synchronizes pending
changes. Revision checks protect newer cloud content; conflict resolution retains
both versions. AI and server-based DOCX/PDF conversion require connectivity.
Cached Free identities do not unlock the editor offline. A remotely changed
subscription can only be rechecked once connectivity returns; offline writing
uses the last verified account status. Use a trusted browser profile and export
backups before clearing site data.

## Required Supabase activation

The production `writing_documents` REST endpoint currently returns 404, so the
previous editor schema has not yet been made available to the application.
The environment's direct SQL connection and the supplied shared-pooler ports
cannot connect (the pooler returns connection refused). No migration was applied
remotely, and no database records were changed by this task.

In the project's Supabase SQL Editor, run these files in order:

1. `supabase/migrations/20261023010000_writing_workspace.sql`
2. `supabase/migrations/20261023020000_writing_workspace_pro.sql`

Both are additive and safe to reapply. The first enables document cloud saving;
the second adds the Pro checks at the database layer. Backend Pro checks work
independently of the SQL activation. Without the first migration, Pro drafts
remain local and pending until cloud storage is configured.

A combined, ready-to-run copy is available in this session at
`/workspace/.onboarding/unoword/pro-workspace/activate-writing-workspace.sql`.
It contains exactly the two migrations above, with no credentials or user data.

## Verification

- Production frontend build and TypeScript.
- Lint with only the four existing unrelated shared UI/admin warnings.
- Workspace, AI workspace, and product backend tests, including Free/expired/
  canceled denial, active Pro/trial access, owner isolation, and saved-data safety.
- Isolated PostgreSQL migration/reapply tests: direct RLS/RPC restrictions,
  downgrade/renewal/expiry, retained documents and historical statistics,
  owner isolation, idempotent autosave, and conflict protection.
- Editor browser regression includes offline edit/reload, creating a document
  completely offline, reconnect/sync, two-tab offline conflicts, Pro downgrade
  and renewal, cached-Free offline denial, authentication isolation, and existing
  formatting/profile/AI/library functionality.
- Landing browser regression includes 14 screen widths, accessibility, pricing
  features, current backend offer/failure states, signup, and Pro/editor auth gates.

Run the existing commands documented in `docs/landing-redesign.md` and
`docs/writing-workspace.md`; for SQL use:

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite node supabase/tests/workspace.cjs
```
