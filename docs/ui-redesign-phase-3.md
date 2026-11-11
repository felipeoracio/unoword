# Writing studio redesign: Phase 3 — Writing editor

## Scope

This phase implements the owner's Writing editor scope. It starts from deployed
Phase 2, not the Ideas prototype in closed PR #22. The complete approved phase
order is recorded in `ui-redesign-roadmap.md`; Ideas and AI guidance are Phase 4.

The editor retains its existing Tiptap instance, document/session hooks, data
format, save queues, permissions and AI request handlers. No database, backend,
tracking, extension permission, billing or authentication change is included.

## Presentation

- A compact writing header replaces the duplicate product logo. The shared
  `StudioStatus` shows the existing persistence status. A confirmed account save
  is green; pending/offline states and failed local/sync states remain distinct.
  Save status stays visible on mobile and in focus mode.
- The paper sits on the studio's warm surface, with a readable line length,
  editorial title/subtitle/body and room for images and copy controls. Title and
  subtitle resize when the library changes the paper width.
- The toolbar is one compact row. At smaller widths it scrolls horizontally;
  formatting buttons remain reachable with Tab and arrow/Home/End navigation.
  Existing selection-preserving mouse and formatting handlers are retained.
- Library cards use clearer selected/draft/completed states. The library can
  collapse on desktop; selecting or creating writing keeps it open there.
- Below 1200px, library and assistant are side panels over the document with
  a backdrop, dialog labels, keyboard containment, Escape and focus return.
  The assistant remains open across resizing. Existing native dialogs keep
  their own keyboard behavior.
- Focus mode removes navigation, project controls, panels and toolbar while
  retaining writing, copy controls, save status and session controls. The tour
  launcher is hidden in focus mode and while an overlay panel is open.

`useEditorPanels` owns only presentation state. Resizing, opening/closing panels
and focus mode never create/select a document or start a writing session. The
paper/editor remain mounted through these layout changes.

## Verification

Run `npm run build`, `npm run typecheck` and `npm run lint` in `frontend`.
Lint retains the four existing component/admin warnings.

Against the production build, `tests/writing-workspace.browser.cjs` supports:

| Run | Coverage |
| --- | --- |
| Default | Autosave/reopen, account isolation, formatting, typed/pasted counts, folders/archive/trash, conflicts, consent, coaching, profile/references, import/export, focus/themes, offline recovery and entitlements |
| `WRITING_STUDIO_ONLY=1` | Exact selected-text formatting, stable editor DOM, no extra sessions/words, paper sizing, mobile/focus/offline save status, desktop collapse, overlay keyboard/focus return, toolbar keyboard access, EN/ES, themes and 320–1440px |
| `WRITING_SUBTITLE_COPY_ONLY=1` | Title/subtitle/body clipboard formats, metadata persistence, export, offline copying, completed read-only copying |
| `WRITING_IMAGES_ONLY=1` | Embedded image upload/alt text/save/reopen, remove/undo, validation, offline use, rich copying, Markdown roundtrip and completed-image restrictions |
| `WRITING_SESSION_COMPLETION_ONLY=1` | Pause/end, independent completion, save failures, read-only reopen, trash confirmation and divergent draft recovery |
| `PROJECTS_ONLY=1` | Safe project/context switching, resource memberships, scoped AI requests and offline/save-failure behavior |

Studio shell, Home and onboarding regression suites also cover navigation,
save-before-departure, Home draft links and tour behavior. Use `PLAYWRIGHT_MODULE`
and `CHROMIUM_EXECUTABLE` if needed. Optional `WRITING_SCREENSHOTS` writes ignored
fixture images; reviewed desktop/mobile/dark captures are under
`tests/artifacts/editor-phase3/`.

All browser checks use synthetic accounts and API responses. No real production
writing, payments or paid AI were used. Automated axe and physical Chrome/iPad
checks were not run and remain separate Phase 8 validation work.

Phase 3 was merged via PR #23 and deployed at
`f6683abe9cee6ff6596bf7d5f740d04af05bc5bb`. Vercel reported success; the live
entry changed to `/assets/index-8HpOqa1T.js`. The layout and full editor suites
passed against deployed assets with synthetic APIs, including offline reload,
durable drafts, conflict recovery and entitlement gates. The container's
Chromium needed a certificate override for service workers; separate HTTPS
probes validated the production certificate normally. Phase 4 subsequently
superseded this deployment; see `ui-redesign-phase-4.md`.
