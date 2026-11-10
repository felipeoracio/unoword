# Multi-project writing workspace

This release adds Pro project workspaces to the existing React/Tiptap editor, FastAPI backend, Supabase storage, Chrome extension, and Expo application. It retains the account-wide writing ledger, authentication, verified paid entitlements, extraction/indexing pipeline, and AI quota infrastructure. It does not change prices, grant paid access, or migrate/delete existing writing.

## User experience

- `/projects` is a private, noindex dashboard, linked from Account and the editor. Projects have a name, description, custom type, status, daily/weekly/total goals, target date, and optional audience, tone, objectives, research focus, and challenges.
- Search/sort projects; edit, archive, restore, or delete with name confirmation. Deleting a project removes memberships only. Shared resources retain their other memberships; unassigned writing remains in **General Writing**.
- Project tabs: Overview, Documents, Resources, AI Context, Settings. The web library supports existing resource assignment, source-file upload, public website ingestion, research notes, source renaming, and text previews. Uploads/links use the existing secure ingestion and durable processing pipeline.
- The persistent editor **Project** selector changes the workspace. **Move document** is a separate, confirmed action. A resource can be shared with several projects without duplicating its file or document body.
- User-initiated switching pauses the current session, flushes durable writing changes, and requires cloud confirmation when online. Offline drafts remain on device. Startup restores saved metadata without requiring an unrelated cloud save. A failed switch leaves the original writing open.
- The last unfinished document is remembered by project. Completed documents are not automatically reopened. A remote active-project change does not silently replace an open web writing workflow.
- Project progress reads existing activity for unique associated documents. A shared document can appear in several project reports; these reports must never be summed to calculate account totals. Account-wide goals, words, time, streaks, and subscriptions keep their existing definitions. AI writing-task budgets retain the existing daily account-progress contract; project goals also form part of the selected project's coaching preferences.

## Five AI context modes

| Mode | Permitted context |
| --- | --- |
| Current Project | Selected project preferences, canonical Writing Profile, and this project's authorized resources. General Writing uses unassigned resources. |
| Selected Resources | Only explicitly selected, eligible resources, plus the applicable profile/project preferences. |
| All Projects / Full Library | Eligible resources across the account, including unassigned material. Requires an explicit broader choice. |
| Writing Profile Only | Canonical profile/answers; no library text, active draft text, project text, or library history. |
| No Library Context | No profile, project text, draft text, or library/history content. Existing non-personal task-budget input remains available. |

Overrides are temporary and reset to Current Project when switching projects. Selecting a resource never grants persistent AI permission. An active draft has a separate one-request consent control; other editor documents require their saved `ai_allowed` permission. Disabled or unready sources are excluded. Derived source memories follow their parent source permissions.

`workspace_ai_scope` resolves account-owned IDs before any personal text is selected. The common context loader reads only those IDs. Both vector and keyword search use a service-only scoped matcher; there is no fallback to unrestricted retrieval. Scoped document passages are bounded. Prior suggestion/feedback context must have valid project provenance and currently available evidence. Citations are validated against actual supplied evidence and can open owner-authorized previews. The existing coaching-only output policy rejects generated/replacement prose. Shared AI reservations, replay handling, subscription checks, and usage allowances remain in place.

## Guided Writing Profile

Ten canonical questions offer single/multiple choice answers, custom text, optional notes, progress, skip/back, partial saving, offline drafts, and later editing. Web questions and choices are available in English/Spanish; native guided questions follow the saved language. Existing free-text profile fields and previous answers are retained.

Structured answers live in the existing `ai_onboarding_answers` table under `setup:<question-id>`, with version, revision, and stable mutation ID. They enrich the existing canonical profile; no competing profile is created. Coaching/privacy rules remain authoritative. Explicit request context takes priority, followed by project preferences, general profile preferences, then defaults.

## Storage and synchronization

The additive migration introduces:

- `writing_projects`: owner-bound, revisioned project metadata.
- `writing_project_resources`: many-to-many references to existing editor documents, sources, memories, and saved writing sessions.
- `writing_resource_versions`: compare-and-swap revisions for membership changes.
- `writing_workspace_preferences`: account active project and last-document map.
- Nullable `ai_suggestions.project_id`, materialized atomically from existing context JSON by a trigger so the existing quota-completion RPC remains compatible.

All new tables have explicit RLS enabled within the migration transaction. Browser roles have owner-scoped Pro reads, with mutations restricted to validated RPCs. RPCs bind ownership to `auth.uid()`, verify paid access, and check revisions. The vector matcher is callable only by the backend service role. Project APIs use the existing private/no-store response policy.

Web outboxes use account/tab-scoped IndexedDB records. Recovery merges unique pending operations from account-owned tab caches rather than dropping another tab's changes. Native outboxes use the existing encrypted account store. Stable mutation IDs make retries safe; conflicting revisions and unavailable/invalid targets require explicit reconciliation. Choosing the cloud version retains a local recovery record. Offline operations are validated before entering the queue. Account changes clear/remount project context and never transfer queued operations to another account.

Metadata synchronizes initially, approximately every 15 seconds while visible, on focus/reconnect, and on explicit flush. This is polling with recovery, not a new Realtime dependency. Autosave and account-statistics synchronization retain their existing behavior. A local save is not reported as a confirmed cloud save.

## Platforms

- Web: full project management, shared resource ingestion/assignment, selectors, guided/free-text profiles, and conflict recovery.
- Chrome extension 0.24.0: compact project/context selectors, selected resource picker, owner-bound service-worker calls, and a link to Projects/Writing Profile. Quick Prompt and Free external-site word tracking are unchanged. Reload/reinstall the updated extension package to obtain the new UI.
- Expo: Projects navigation, creation/edit/archive/restore, resource membership/previews, persistent editor selectors, project progress, scoped coaching, guided profile, and encrypted offline metadata. The full web library handles new reference-file ingestion, source renaming, and confirmed project deletion; the native screen links to it. These operations may require signing in on the web. Physical iPhone/iPad runtime testing is still required; RN Web fixture checks and iOS export do not replace that test.
- Text previews and retrieval are bounded; long documents are not sent whole. Source previews can remain unavailable while processing. Previously downloaded writing is available offline; new resource uploads and AI require a connection. Direct offline navigation to a never-loaded Projects route is not guaranteed; project management remains available within the cached editor workspace.

## Rollout: apply schema before deployment

1. Open this branch's `supabase/migrations/20261109010000_multi_project_workspace.sql` in the Supabase SQL Editor for UnoWord. Apply it before deploying this release. Existing prerequisite migrations must already be installed.
2. The migration is transactional and repeatable. It enables RLS explicitly and does not copy or delete existing writing/history/files. A SQL warning about destructive operations can refer to replacement of named policies/triggers or definitions of confirmed project-deletion functions; applying the migration does not invoke those deletion functions. Review the whole file before execution.
3. Confirm the query succeeds. Deploy the application branch/PR through the usual Vercel flow. No new environment variables, billing setup, API keys, or plan changes are required.
4. Sign in as Pro, open `/projects`, create a project, switch in `/editor`, assign/share a document, and verify goals, resource permissions, and another signed-in device. Test an offline edit/reconnect. Confirm Free still cannot fetch paid workspace APIs and still has Quick Prompt/external tracking.
5. Reload extension 0.24.0 and refresh the Expo development build. Check the same account/project in each client. Source processing jobs continue using the already configured worker.

Keep the migration's tables if rolling back code: they contain project metadata. Do not drop tables, clear caches, or delete writing to recover from a failed rollout. Until the migration exists, new scoped APIs fail closed; do not ship the application changes first.

## Verification commands

Run from the repository root unless noted. PGlite tests use synthetic accounts and a real PostgreSQL-compatible engine with pgvector; browser and native fixture suites use fictional API responses and never charge a real account.

```sh
python -m pytest backend/tests/test_project_context.py backend/tests/test_workspace.py backend/tests/test_workspace_ai.py backend/tests/test_suggestion_modes.py backend/tests/test_suggestion_breadth.py backend/tests/test_profile_personalization.py backend/tests/test_progress_permissions.py backend/tests/test_writing_goal.py backend/tests/test_link_library.py
PGLITE_ROOT=/path/to/node_modules node tests/projects.sql.test.cjs
yarn --cwd frontend build
yarn --cwd frontend lint
node --test extension/tests/*.test.js
node extension/tests/cloud-sync.integration.cjs
npm --prefix apps/mobile test
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run export:ios
```

Serve the production frontend with Vite preview and set `WRITING_TEST_ORIGIN`, `PLAYWRIGHT_MODULE`, and `CHROMIUM_EXECUTABLE` as needed:

```sh
node tests/writing-workspace.browser.cjs
PROJECTS_ONLY=1 node tests/writing-workspace.browser.cjs
# Run the native fixture browser suite from apps/mobile:
node tests/native-ui.browser.cjs
```

The project browser flow captures desktop/tablet/mobile screenshots under `tests/artifacts/projects-*.png` (ignored generated artifacts). Native fixture screenshots are under `apps/mobile/.expo/screenshots`. Fixture tests verify HTTP contracts and UI behavior; they do not establish production Supabase connectivity or live cross-device operation before rollout.
