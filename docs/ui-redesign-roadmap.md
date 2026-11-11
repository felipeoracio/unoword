# Writing studio redesign roadmap

The owner supplied this phase order and authorized production through Phase 7.
Phases 3–7 are merged via PRs #23–27 and deployed; their implementation notes
record release commits and live verification. Phase 7 distributes extension
0.24.2 through the website; no Chrome Web Store submission was made. Phase 8
automated regression and polish are prepared for review on a separate branch.
Physical-device and live authenticated acceptance remain outstanding. Native Chrome
action-popup verification remains blocked by the managed browser policy in this
environment; physical Chrome and iPad checks remain outstanding. The Ideas
prototype from closed PR #22 was reused in Phase 4.

## Phase 3 — Writing editor · High complexity

- Calmer header, readable paper, compact toolbar, focus mode, responsive sidebars,
  persistent save status.
- Modules: `WritingEditor.tsx`, editor styles, project controls, document cards.
- Depends on the stable shell and status components.
- Risks: selection loss, autosave regressions, session duplication, offline recovery.
- Acceptance: title/subtitle/body, images, formatting, copying, import/export,
  completion, trash and recovery retain their behavior across responsive layouts.

## Phase 4 — Ideas and AI guidance · Medium–high complexity

- Prompt/guidance cards, saved ideas, clear modes, context summary, compact usage.
- Modules: editor assistant, writing-task components, existing AI types/hooks,
  proposed web Ideas screen.
- Depends on shared cards and approved information hierarchy.
- Risks: request semantics, consent, allowances and coaching boundaries.
- Acceptance: Quick Prompt stays non-AI; paid modes retain restrictions; context
  is explicit; guidance stays separate from authored writing.

## Phase 5 — Progress · Medium complexity

- Daily summary, readable trends, activity calendar, personal milestones.
- Modules: account-writing/streak hooks, existing charts/rewards, proposed Progress.
- Depends on Phase 1 and existing summary/history APIs.
- Risks: confusing metrics, exposing premium streak history, timezone errors.
- Acceptance: session/daily/lifetime time remain distinct; Free cap is presentation
  only; charts have accessible text alternatives.

## Phase 6 — Library and Settings · High complexity

- Unified navigation for writing, projects, references, memory, ideas, profile,
  account settings.
- Modules: `ProjectManager`, guided profile, existing library controls,
  `Account.tsx`, security and Substack components.
- Depends on approved taxonomy, editor and ideas components.
- Risks: merging resource permissions or moving documents when switching projects.
- Acceptance: existing content remains findable and intact; authored writing and
  AI references stay distinguishable; permissions and processing states are visible.

## Phase 7 — Chrome extension · High complexity

- Apply web visual language to popup/counter without changing tracking architecture.
- Modules: popup HTML/CSS/controllers, viewport handling, localized strings,
  floating-counter styles.
- Depends on established web patterns and separately approved input hardening.
- Risks: popup constraints, content-script interference, storage/message regressions.
- Acceptance: real popup dimensions work; background sessions survive closure;
  editor activity is not counted twice; permissions stay unchanged; EN/ES and
  themes remain usable.

## Phase 8 — Testing and final polish · High complexity

- Complete regression, accessibility, responsive, performance, subscription validation.
- Modules: existing backend, extension, SQL, native and browser suites.
- Depends on all approved redesign phases.
- Risk: fixture-only confidence without real platform verification.
- Acceptance: critical saving/auth/sync/entitlement workflows pass; screenshots
  reviewed at agreed sizes; real Chrome and iPad checks recorded separately;
  no unsupported testing claims.
