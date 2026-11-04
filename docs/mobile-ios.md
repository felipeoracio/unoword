# UnoWord native iOS client

## Architecture audit and implementation plan

The existing system is a Vite/React application, FastAPI backend on Vercel,
Supabase Auth/Postgres/Storage with RLS, Chrome MV3 extension and verified Stripe
Monthly/Lifetime entitlements. Browser authentication uses httpOnly cookies;
`lib.auth.require_user` also already supports verified Supabase bearer JWTs.
`BrowserSecurityMiddleware` already permits non-browser bearer requests without
Origin and continues enforcing cookie CSRF/origin rules for browsers.

The backend already owns progress summary/statistics, revisioned preference
updates, session activity, interval-union daily/lifetime time, streak presentation,
private document/folder access, completion and AI quota/personalization. A new
client should consume those definitions rather than sum device totals itself.

The implementation adds `apps/mobile` with Expo SDK 58, React Native, TypeScript,
Expo Router, SecureStore, encrypted account caches and TanStack Query. It leaves
frontend/extension directories and their public routes unchanged. Native screens
use the same API; a self-contained Tiptap editing canvas preserves rich document
JSON, subtitle and image format without flattening writing.

Phases followed: native/auth/storage foundation; dashboard/library/editor/session
integration; existing prompts/AI/profile services; offline/CAS recovery, responsive
layouts, security tests, iOS export and Expo Go startup verification.

## Database and compatibility

**No database migration.** The native client reuses existing owner/Pro RLS, UUIDs,
revision RPCs, preferences, activity source `editor` and `ios-` device identifiers.
Subscription pricing, grandfathered allowance assignments and billing remain
unchanged. No Pro grant is made locally or from a redirect.

One read-only backend route was added: `GET /api/auth/client-config`. It publishes
only the project URL and known public anon/publishable key, rejecting service-role,
secret and unknown formats. This is deliberate client configuration, not privileged
access. The existing verified user JWT and RLS still protect all private data.

Primary risks addressed: stale revisions (keep both versions), owner changes
(owner-bound requests and caches), session replay (stable UUID/sequence), paused
and closed-app time (checkpointed intervals), remote completion (fresh-document
selection), prior Pro history on downgrade (server permissions and capped display),
unsafe document content (existing sanitation plus network-disabled canvas), and
Expo Go native dependency compatibility (SDK-pinned modules/Doctor/iOS export).

## Scope and remaining checks

See [mobile README](../apps/mobile/README.md) for setup and detailed behavior.
The Expo Go milestone consumes existing subscriptions, not iOS purchases. Google
OAuth, Apple login/IAP, account deletion, signing and App Store publication have
separate production requirements. Mobile signup/recovery intentionally reuse
the existing verified website flow. The interface is English; the shared prompt
bank, request language, account settings and existing AI responses support English
and Spanish. Full native UI translation is a follow-up; existing web/extension
localization was not changed.

Physical iPhone/iPad testing is not available in this Linux workspace. Browser
fixture screenshots verify actual native screen component layout through RN Web
and the real offline rich-text canvas, not iOS keyboard or runtime behavior.
No claim of physical-device testing, native Google completion, reminder delivery
on iOS or live IAP verification is made.

## Executed verification

- 22 native core tests passed: shared tokenizer/prompts, timer/pause/idle/restore,
  midnight/DST, rich document/subtitle/image preservation, offline folder/document
  recovery, concurrent edits, mutation replay, conflict copies, completion, Free
  restrictions, active checkpoints, goal/timezone CAS, encrypted cache integrity,
  owner-bound API requests, AI retry tickets and chunked Keychain serialization.
- 108 backend tests passed across native public configuration, workspace,
  assistant, progress permissions, browser security and existing auth signup/login.
- TypeScript and mobile lint passed without warnings. Expo Doctor passed **20/20**;
  SDK 58's iOS/Hermes export succeeded (1,418 modules, approximately 4.6 MB bundle).
- The web production build passed. Web lint retains its four pre-existing UI/admin
  warnings; existing bundle-size/dynamic-import notices are unchanged.
- Actual native screen components rendered through React Native Web passed
  320/390/820/1180px checks, typing through the real local rich-text canvas,
  dark mode and Free editor denial, with no overflow or JS exceptions. The iPad
  three-panel view was also captured. These are browser fixtures, not iOS devices.
- The existing web editor browser regression passed authentication isolation,
  autosave/reopen, formatting, typed/pasted counts, library/folders/trash,
  conflicts, coaching consent, import/export, responsive EN/ES, offline recovery,
  Free restrictions and verified Pro/Lifetime access. The existing extension
  suggestion browser suite and eight cloud-progress/clock tests passed. One first
  extension run crossed UTC midnight and its daily-prompt expectation changed;
  a fresh run after the boundary passed without application changes.
- A real Supabase password login using the dedicated existing QA account accessed
  production APIs with the same bearer mechanism as mobile. A disposable rich
  document/subtitle round-tripped; its repeated mutation kept one revision;
  active/paused checkpoints appeared before End with one deduplicated record;
  completion persisted with a trusted timestamp. The exact fixture document and
  activity were removed and prior account word/time totals were verified intact.
  No AI generation, billing, or preference changes occurred in that live check.

Screenshots from this run are available under
`/workspace/.onboarding/unoword/mobile/`, including `iphone-editor.png`,
`ipad-landscape-editor.png`, `ipad-landscape-three-panels.png` and native-screen
fixture previews for every tab. These files contain fictional demonstration data.

## Expo Go server access

Metro started on port 8084 and returned an iOS Expo manifest naming UnoWord,
SDK 58.0.0 and a launch asset. **No reachable public QR/tunnel was available in
this cloud environment.** The default SDK 58 tunnel requires an Expo account
login; the explicit ngrok fallback timed out. No Expo/Apple account was created
or signed into on the owner's behalf. Run the documented local commands using
your own free Expo account to obtain a QR for your phone/tablet. Starting Metro
and exporting a bundle do not establish that a physical Expo Go client loaded.

Native Google OAuth, iOS keyboard/external-keyboard interactions, reminder delivery,
background behavior on a physical OS, VoiceOver and true iPhone-to-iPad execution
remain device acceptance checks. The core algorithms, layout fixtures and real
backend interoperability were tested as described above.
