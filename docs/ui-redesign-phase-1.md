# UnoWord writing studio: Phase 1

## Scope

Presentation-only design system and application shell on
`feature/unoword-ui-redesign`. No schema, billing, authentication, tracking engine,
extension permissions, native app, or deployment changes.

`components/studio/AppShell.tsx` wraps authenticated Account, Projects and Rewards,
plus the paid editor. Existing screen hooks continue to own data and lifecycle.
The editor uses a narrow desktop navigation rail; focus mode hides the rail and
mobile bar without remounting the editor. Mobile navigation uses a modal dialog
with keyboard containment, Escape, focus return and automatic desktop dismissal.

## Design system

`styles/studio.css` scopes semantic tokens to `.uw-studio`, leaving public and
admin styles intact. Navy #102B55, blue #086BFF, sky #5DA9F6, cream #F8F2E8,
soft white #F6F8FC, white; Georgia editorial headings and existing Inter dependency
(Latin subset). Dark tokens, reduced motion and forced-color selected states.
Small links use a darker accessible blue on cream. Reusable buttons/cards wrap
existing primitives; page headers and caller-confirmed status indicators are shared.

`studio-preferences.ts` reuses existing editor theme/language storage keys. These
are presentation preferences only; account writing preferences retain their
existing synchronization. New navigation is localized in English and Spanish;
existing account content has not undergone its later localization/layout phase.

## Incremental navigation

No placeholder routes are introduced. During Phase 1:

| Item | Existing destination |
| --- | --- |
| Home | `/account` (dedicated Home is Phase 2) |
| Write, paid | `/editor` |
| Write, Free | `/account#install` |
| Ideas, paid | `/editor?assistant=1` (opens assistant, never generates) |
| Ideas, Free | `/account#quick-prompt` (explains existing extension Quick Prompt) |
| Progress | `/account#writing-progress` |
| Library | `/projects` (existing Pro gate remains) |
| Milestones | `/rewards` |
| Settings | `/account#account-settings` |

Account anchor navigation scrolls/focuses the destination. Legacy recovery links
keep their existing `domain_recovery` parameter. Public marketing and admin
remain outside this shell. Auth callbacks and plan/payment query parameters are
unchanged. Later phases replace transitional destinations with fuller screens.

## Saving safety

The editor passes its existing `flushWrites` to the shell. Ordinary same-tab
navigation away waits for local persistence and, while online, cloud confirmation.
Existing save/conflict failures keep the editor open with its error message.
Offline navigation still waits for local writes. New-tab/modifier-click behavior
remains native and switching the editor assistant does not unmount the editor.

## Artwork

The owner's `Assets.zip` has been imported into `src/assets/studio/` as optimized
WebP files, with source mappings in `manifest.json` and transparency preserved.
The sidebar uses the supplied mountain/pine art; light-mode page headers use the
desktop or mobile landscape with readable text overlays. Dark headers retain
quiet dark surfaces. Covers, badges, prompt art and empty states are stored for
later phases and are not imported into the shell. The duplicate contact sheet
is omitted. These asset changes do not change document data or achievements.
Decorative artwork is not required for offline writing; the existing service
worker's private-data and static-shell cache boundaries remain unchanged.

## Verification

- Production build, TypeScript check, lint (pre-existing warnings remain).
- `tests/studio-shell.browser.cjs`: fixture-only auth/Pro gates, 320–1440px,
  supplied-artwork decoding and responsive desktop/mobile crops,
  mobile keyboard/focus, route navigation, focus mode, themes, EN/ES, save before
  departure, blocked departure on save failure, offline writing/reconnection,
  Free tracking/Quick Prompt destinations, no AI or billing requests.
- Existing `tests/writing-workspace.browser.cjs` covers critical editor persistence,
  account isolation, formatting, counts, library/folders/trash, conflicts,
  consent, profile/sources, import/export and offline workflows.
- Existing `tests/onboarding.browser.cjs` checks tours and supported entry actions.

Browser scripts use `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` when the installed
runtime is outside `tests/node_modules`. Run against `npm run preview -- --port 4175`
after a production build. Fixture screenshots live in ignored
`tests/artifacts/studio/`; they contain synthetic data, not production accounts.

No production login, real payment, paid AI request, physical iPad test or live
deployment is part of Phase 1 verification.
