# UnoWord writing studio: Phase 2

## Home dashboard

Authenticated Home lives at `/app`; `/` remains the public site and `/account`
continues to own sign-in, settings and billing. The studio brand and Home links
open `/app`. Account includes an Open Home link, and password sign-in accepts
the explicit `/app` return destination alongside the existing `/editor` path.
Other authentication callbacks and provider configuration are unchanged.

Home uses the supplied landscape, winding-path prompt illustration, notebook
empty state and three decorative cover images. It supports English and Spanish,
light and dark themes, and 320–1440px layouts. Cover thumbnails do not represent
user-selected document cover data.

## Account data and plan behavior

`useStudioHome` verifies the current account, reads existing writing preferences
and reuses `useAccountWriting` for authoritative daily words, goal, writing time,
streak and lifetime words. These are the same account totals used by the editor
and extension, with the existing reporting timezone and Free streak cap. Home
does not mount the workspace hook, start writing sessions or create activity.
Unavailable progress displays an unknown value rather than a confirmed zero.
An already-open offline Home labels its last confirmed totals and disables goal
changes; an offline initial visit offers the existing offline editor.

Daily goal edits use the existing preference endpoint with account ID and
revision checks. A conflict keeps the newer server settings and asks the writer
to review before retrying. The dialog contains keyboard focus and restores it
when dismissed. No schema or tracking changes are required.

Pro recent writing uses the existing bounded metadata index, filters out trash
and archived documents, sorts by updated time and shows three items. Home never
loads document bodies. Unsynchronized local drafts remain available in the
editor. Account changes invalidate private Home data; Free accounts never query
the document index. Free Start Writing opens extension setup, while the editor
and library retain their existing Pro gates.

## Prompts and document opening

Quick Prompts reuse the existing static prompt library and selected themes.
They persist per account, reporting day and interface language, with manual
shuffle. They make no AI request and consume no AI credits. Free users copy a
prompt for use in their writing app.

For Pro users, Use This Prompt prepares a short-lived, account-bound, one-use
session-storage handoff. The editor first completes its project restoration and
flushes existing writes, then creates a draft through the normal workspace
flow. The prompt becomes its title; the document body stays empty. The URL is
replaced with the new document link, so reloading does not create another draft.

Recent-document links select an existing project containing the document and
preserve its memberships. Explicit links can open completed documents read-only;
ordinary editor restoration still skips completed documents. Editor controls
stay locked until the initial project selection has finished. Existing save,
offline persistence, conflict and entitlement checks continue to apply.

## Verification

- Production build and TypeScript check pass; lint retains four existing warnings.
- `tests/studio-home.browser.cjs` uses synthetic accounts to exercise private
  routing, shared totals, themes and prompt persistence, goal save/conflict,
  keyboard focus, existing-draft restoration, project-aware recent links,
  completed read-only writing, one-use empty prompt drafts, no lost writing,
  320–1440px EN/ES and both themes, offline totals, empty/error states, account
  switching, downgrade isolation, Free copying and extension navigation.
- Existing editor, shell, onboarding and Google OAuth browser suites pass.
  These cover persistence and offline recovery, plan restrictions, formatting,
  conflicts, save-before-navigation, tours and existing sign-in flows.
- Browser fixtures make no live payment or paid AI requests. Screenshots in
  ignored `tests/artifacts/home/` contain synthetic data and were visually
  reviewed on desktop, mobile and in dark mode.

Run browser suites after a frontend production build against preview port 4175,
using `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` if needed. Automated axe checks
were not run; viewport checks do not substitute for physical device testing.
Phase 2 was deployed on November 11, 2026, through PR #21, production merge
`5049ac412b495dea7c83f0799e4811bafb1f2399`. Vercel reported success and the live
JavaScript entry matched the tested build. Public pages and `/app` returned 200;
the API root and product endpoint returned 200, while anonymous document and
project requests returned 401. The Home browser suite also passed against the
deployed assets with entirely synthetic API responses and analytics disabled.
The extension release remains 0.24.1. No production user data was changed.
