# Multi-project workspace validation

Completed on November 10, 2026. Tests used fictional users/documents and isolated fixtures. No real AI generation, charges, subscription cancellation, production database migration, or production deployment was performed.

| Check | Result |
| --- | --- |
| Targeted backend regression/security suites | 174 passed |
| Project SQL on PGlite + pgvector | Passed: repeatable migration; Pro/owner RLS; cross-account rejection; CAS/idempotency; shared resources; five context modes; scoped search; quota-compatible project provenance; preserved writing and activity; archive/delete fallback |
| Production frontend build + TypeScript | Passed |
| Frontend lint | Passed with four pre-existing warnings in shared UI components/AdminDashboard; no new warnings |
| Existing production-editor browser regression | Passed: authentication isolation; autosave/reopen; formatting; typed/pasted counts; folders/trash; document conflicts/recovery; AI consent; source/profile editing; import/export; focus/themes; offline/reconnect; Free/Pro/Lifetime gates; English/Spanish; 320/390/768/1440 px |
| Dedicated project browser flow | Passed: creation; switching; shared document membership without copies; actual scoped AI request body; override reset; offline switching/edit/reconnect; failed-save preservation; custom guided answers; private/noindex route; responsive screenshots |
| Extension JavaScript unit tests | 36 passed |
| Actual extension service-worker integration with fake network | Passed: historical Free/Pro streak behavior; persistent offline outbox; pause/resume; owner isolation; owner-bound project reads/selection; wrong-account rejection before network; explicit AI scope forwarding |
| Native unit tests | 32 passed, including project reducer/recovery and prequeue validation |
| Native TypeScript | Passed |
| Native screen/provider browser fixtures | Passed at 320/390/820/1180 px; typing bridge, paid gating, dark theme; new project creation/save/open and AI context selection using real components/providers; no JS errors or horizontal overflow |
| Expo iOS export | Passed |
| Diff whitespace check | Passed |

Browser testing exposed startup/new-document and switching races. Startup now restores durable cached workspace state without requiring an unrelated cloud save, while explicit online project switches still require confirmation. Create/duplicate/recovery actions wait for restoration. Recovering a draft cannot delete its old copy unless the replacement exists. Recovered conflict copies retain project memberships.

## Main implementation files

- `supabase/migrations/20261109010000_multi_project_workspace.sql`: additive tables, explicit RLS, ownership/CAS RPCs, scoped content/search, progress, canonical answer persistence, project provenance.
- `backend/routers/projects.py`, `backend/models/projects.py`, `backend/lib/projects.py`, `backend/lib/project_context.py`, `backend/lib/profile_setup.py`: private project APIs, validated contracts, authorized context loading, guided questions.
- `backend/routers/ai.py`, `backend/lib/workspace_ai.py`, `backend/lib/retrieval.py`, `backend/lib/personalization.py`, `backend/lib/suggestion_details.py`: shared scoped AI, canonical profile enrichment, evidence attribution, existing quota integration.
- `frontend/src/pages/Projects.tsx`, `frontend/src/components/projects/*`, `frontend/src/lib/use-project-workspace.ts`, `frontend/src/styles/projects.css`, `shared/projects.ts`: dashboard, resource management, selectors, guided setup, offline outbox, shared metadata contracts/reducer.
- `frontend/src/pages/WritingEditor.tsx`, `frontend/src/lib/use-writing-workspace.ts`: safe editor switching, project membership, scoped coaching, profile integration, preserved recovery workflows.
- `apps/mobile/src/providers/ProjectProvider.tsx`, `apps/mobile/src/features/{Projects,ProjectControls,GuidedProfile}.tsx`, existing native editor/profile/coach: encrypted owner-scoped project state and native controls.
- `extension/background.js`, `extension/popup/projects.js`, popup markup/controller, manifest and packaged release: extension 0.24.0 integration.
- Routing, account navigation, robots and private metadata were updated for `/projects`. Public analytics allowlists and billing logic were preserved.

## Review artifacts and remaining rollout checks

Desktop and mobile screenshots are generated under `tests/artifacts/projects-*.png`; native screenshots are under `apps/mobile/.expo/screenshots`. Generated test artifacts are ignored by Git.

Apply the migration **before deployment**, following [the rollout instructions](multi-project-workspace.md#rollout-apply-schema-before-deployment). Then test real Supabase project synchronization with a Pro account and two devices, reload extension 0.24.0, and perform a physical iPhone/iPad smoke test. Automated HTTP/SQL fixtures and iOS export do not verify production connectivity or a physical-device runtime.

Native reference-file ingestion/source renaming and confirmed project deletion open the full web library. Project AI task sizing retains the existing account daily-progress budget; selected project goals/preferences are also supplied as coaching context. No live pricing, billing, or user-history migration decisions were made.
