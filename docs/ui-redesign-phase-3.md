# UnoWord writing studio: Phase 3

## Ideas workspace

`/ideas` gives signed-in Free and Pro writers a dedicated prompt library. Both
studio Ideas links and Home's Get Ideas action open this page. The page is
private/noindex, with English and Spanish, light/dark themes, responsive layouts
and supplied landscape, winding-path and empty-state artwork.

The featured daily Quick Prompt shares the same account/day/language browser
state as Home. Both pages use the extension's existing static prompt library
and the account's selected themes. Shuffling is manual. Browser restoration
only accepts prompt IDs found in the library; stale or unknown theme choices
fall back to all themes. No AI request or AI credit is involved.

Writers can browse their selected themes or any individual theme, search prompt
text and theme labels, and show additional cards. These are exploration filters;
they do not overwrite account preferences. Preference-loading failures leave the
full static library available.

## Browser saves and writing actions

Bookmark buttons store known prompt IDs under an account-specific browser key.
The page labels this clearly: saves are on this browser, not synchronized across
devices. English and Spanish originals can coexist in the saved collection;
foreign-language entries retain their original wording and show their language.
Storage events refresh another tab's saves. When browser writes fail, saves last
for the current visit and the page explains that limitation. Account switches
hide the preceding account's collection before the next identity is loaded.

Free writers copy prompts into their writing app, with a visible Copied action
and a status message. Pro writers can start an empty draft through Phase 2's
one-use, account-bound prompt handoff. Existing writing is flushed first and the
prompt becomes the new title, leaving all prose to the writer. The Pro coach
link opens the existing editor assistant; the writer still chooses the draft,
context, consent and generation action there. No new AI service is introduced.

## Shared behavior

`useStudioAccount` extracts the verified identity, online status and cross-tab
logout behavior previously owned by Home. `useQuickPrompt` extracts Home's
daily static prompt behavior so Home and Ideas stay consistent. Ideas reads only
identity and preferences on opening; it does not mount the editor hook, fetch
document bodies/indexes, start activity, or write account settings.

The password sign-in return allowlist adds only `/ideas`. Authentication provider
configuration, subscriptions, editor persistence, tracking, extension permissions
and database schemas are unchanged.

## Validation

- Production build, TypeScript and lint; four pre-existing lint warnings remain.
- Synthetic Ideas browser coverage includes auth/noindex, shared Home prompt,
  selected themes, search/pagination, empty artwork, copying, browser save/reload,
  tab updates, storage quota failure, account isolation, offline exploration,
  preference failures, Pro empty-draft creation without lost writing, EN/ES,
  themes, 320–1440px and no paid AI/checkout calls.
- Home, studio shell and Google OAuth browser regression suites pass. The shell
  test follows Ideas into the existing coach and retains save-before-departure
  and failed-save protections. Editor and onboarding regression suites also run
  against the final build.
- Fixture screenshots are saved under ignored `tests/artifacts/ideas/`. Browser
  tests use synthetic accounts only. Automated axe and physical-device checks
  were not run.

Phase 3 is prepared separately for review; production remains on Phase 2.
