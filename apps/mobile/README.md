# UnoWord for iPhone and iPad

A native Expo/TypeScript client for the existing UnoWord account, APIs and
Supabase project. No new database, pricing, Stripe product or entitlement is
created. The web app and Chrome extension stay in their existing directories.

## Open it in Expo Go

Use Node 24 LTS (Node 22.13+ also meets the SDK engine requirement). Install the
current Expo Go from the iOS App Store on your iPhone and iPad.

```bash
cd apps/mobile
npm ci
npm start
```

Scan the QR code printed by Expo with your iPhone/iPad Camera and open it in
Expo Go. On the same Wi-Fi, the default LAN connection is usually sufficient.
If the devices cannot reach the computer:

```bash
npx expo login
npm run start:tunnel
```

SDK 58's default tunnel requires your own free Expo account. The alternative is
`npx expo start --tunnel ngrok` if that service is reachable. Leave the terminal
running; this is a development server, not an App Store installation. Use the
same QR on both devices and your existing UnoWord credentials.

`npm ci` generates the self-contained editing canvas in its postinstall step;
`npm start` rebuilds it before starting Metro. After installing dependencies,
`npx expo start --tunnel` also works directly (with your Expo account signed in). After setting environment values,
restart with `npm start -- --clear`.

### Connection settings

No credentials need to be pasted into the mobile source. The app fetches only
the existing public Supabase URL/publishable-or-anon key from
`https://unoword.app/api/auth/client-config`. The backend rejects secret,
service-role and non-anon JWT values. Public configuration is cached for offline
startup and pinned to the expected project. The server route must be deployed
before the default connection works.

For a different trusted deployment, copy `.env.example` to ignored `.env.local`.
Set `EXPO_PUBLIC_API_URL`, and optionally both existing public Supabase values.
All `EXPO_PUBLIC_*` values are client-visible. Never put a service-role key,
Stripe key, database password or AI key there. The native client uses the same
Supabase user IDs and sends its user's bearer JWT to the existing API; it never
calls privileged tables or billing changes directly.

### Login, signup and recovery

Email/password sign-in, Keychain persistence, foreground token refresh and local
sign-out are native. Signup and password recovery open the **existing secure
website flow**, preserving its email confirmation/security policies. Confirm
your email or set the password there, then return to sign in here. No second
account is created when an existing customer signs in.

Expo Go does not own the `unoword://` callback scheme needed for reliable native
OAuth. Its Google button explains the limitation. A Google-only customer can use
the website recovery flow to set an email/password for the same account, where
Supabase permits it. Do not create another account for that address.

The Google PKCE browser flow is prepared for an Expo **development build**.
Before enabling it, allow the exact `unoword://auth/callback` URL in the same
Supabase project's Auth URL configuration. Keep the existing Google-to-Supabase
provider callback unchanged. This flow still needs actual iOS device testing.
Apple login and production in-app purchases are not implemented in this milestone.

## Screens and access

- **Home:** shared daily words/goal, daily time, lifetime time, capped or full
  verified streak, open account sessions, refresh.
- **Write:** Pro-only native document/folder navigation, search, favorites,
  archive/trash/restore, duplication, subtitle, completion, autosave and focus.
  At tablet widths the library stays beside the editor; AI is a collapsible
  third panel. Phones use a full-page editor and a compact coach panel.
- **Progress:** authoritative daily statistics and session history. Verified
  paid access enables week/month/year/all ranges.
- **Ideas:** the same bilingual local **Quick Prompt** bank for everyone;
  eligible accounts add the existing three AI modes, saved ideas and feedback.
- **Profile:** account/subscription status, shared goal/timezone/themes/language,
  the existing Writing Profile, actual server AI allowance, appearance, optional
  device reminders, privacy/terms/support and logout.

Free never receives editor/document/folder controls or personal AI access.
Monthly Pro, Lifetime and existing grandfathered grants use `/auth/me`'s
verified features. Account usage always comes from the existing quota endpoint;
no local quota replaces the backend, and protected legacy assignments remain
unchanged. There is no subscription purchase/upgrade button inside this app.

## Writing, saving and offline behavior

Only the **editing canvas** uses a bundled, network-disabled Tiptap document in
a WKWebView. Navigation, library, forms, dashboard, statistics and settings are
React Native. It is not a WebView of the website. The canvas has no authentication
tokens, remote scripts, cookies, storage or network connections. It reuses the
web image/subtitle extensions and exact Tiptap JSON format. Unsupported structure
locks editing instead of flattening writing. Embedded images render offline;
new image selection is currently available through the web editor.

Formatting includes headings 1–3, bold/italic/underline/strike, lists,
blockquotes, links, alignment, dividers and undo/redo. Keyboard shortcuts are
provided by the shared editing engine. Hardware keyboard and iOS keyboard
behavior still require device verification.

Local document writes coalesce for 250 ms and are flushed on background/logout.
Cloud saves debounce for one second; periodic/foreground/reconnection refreshes
also flush pending edits. "Synced" requires a confirmed response. Owner-scoped
XChaCha20-Poly1305 encrypted caches/outboxes live in AsyncStorage; their keys and
chunked session credentials stay in iOS Keychain through Expo SecureStore.
Account switching immediately hides prior-account data and every API closure
is bound to its original owner. Logout preserves that owner's encrypted drafts,
never reassigning them to a later login.

An offline startup uses cached public connection details and the stored session.
Previously verified Pro access permits offline editing for up to **24 hours**
after its last online verification; server checks apply again on reconnection.
The app does not promise indefinite offline entitlement renewal. A first login
and first document download require a connection.

Optimistic revisions and stable mutation IDs are identical to the web app's.
An offline conflict preserves the original cloud document and the mobile draft;
**Keep both versions** creates a separately named recovery copy. The app never
blindly overwrites a newer cloud revision. Completion is persisted through the
same revisioned API and receives the database's timestamp. Completed last drafts
are excluded from automatic reopening. Other-device updates refresh clean
versions; dirty versions enter the recovery flow.

## Sessions and account time

Start, Pause, Resume and End use the exact existing pure clock/tokenizer engines.
The device marker begins with `ios-`; activity is stored as an existing `editor`
row associated with its document, not a duplicate mobile ledger. Checkpoints are
saved every ten seconds; stable IDs/sequences make retries idempotent. Pasted
words are distinct from typed words and do not advance daily goals/streaks.
Formatting, opening, recovery and initial content loading add no writing credit.

- **Session Time** is the active duration of this device's selected session.
- **Today's Writing Time** is the backend's account-wide, timezone-based daily
  union of saved active intervals across editor, extension and devices.
- **Total Writing Time** is the same authoritative union over account history.

Paused/background gaps do not count. The existing five-minute inactivity grace
is retained. Backgrounding pauses/persists a session; restart restores it paused
at its confirmed checkpoint, without inventing closed-app time. Resume is
explicit. Qualifying input after a day boundary rolls to a new stable session.
The backend retains midnight/DST allocation and overlapping-interval policies.
No new goals or streak calculations are introduced.

Visible views refresh on foreground, reconnect and pull-to-refresh, with a
15-second account polling fallback and ten-second active-session checkpoints.
No realtime publication is currently configured by existing migrations; this
client therefore uses the existing authenticated API contract, not a new
unverified direct change feed. Typical online updates take roughly 30 seconds;
background/offline devices synchronize when active/connected again.

## AI and privacy

All personalized requests use the protected existing suggestion/assistant APIs,
latest Writing Profile, authorized reference sources, account progress and
versioned daily/monthly allowance. A lost response can retry the same exact
request UUID/body. Progress updates do not spend AI credits or replace results.

The coach requires explicit per-request consent before sending the current
writing to the online provider. Document `ai_allowed` remains a separate,
user-controlled permission for future automatic personalization. There is no
prose insertion, completion or rewrite action. UnoWord supplies questions and
structure: **You do the writing. UnoWord helps you keep going.**

## Verification commands

```bash
npm test
npm run typecheck
npx expo-doctor
npm run export:ios
# Optional browser layout/embedded-canvas fixtures (requires Playwright Chromium):
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium \
  node tests/native-ui.browser.cjs
```

`tests/live-api.mjs` is an explicit QA-account-only real API smoke check. Its
server-side cleanup credential is read only by Node from environment settings
and never imported by the Expo app. It creates/removes only its own fictional
QA document/activity; it does not request AI or change payments/preferences.
Do not provide that credential as an `EXPO_PUBLIC_*` variable.

See [implementation and verification report](../../docs/mobile-ios.md) for
executed results and outstanding physical-device checks.

## App Store roadmap — not published

`app.config.ts` includes UnoWord branding, tablet support, automatic appearance,
orientation flexibility and proposed bundle ID `com.felipeoracio.unoword`.
Confirm ownership/availability before registration. `eas.json` separates internal
development/preview and production profiles; no EAS project, Apple application
or store listing was created, and no live billing flag was changed.

Before App Store submission:

1. Test the actual iPhone/iPad builds, keyboard, split view, backgrounding,
   accessibility, reminders, Google callback, offline recovery and account switching.
2. Confirm Apple Developer team, bundle ID, signing and high-resolution icon.
3. Implement authenticated in-app account deletion, with retention disclosures,
   through a trusted backend. Current support links are not a deletion workflow.
4. Review then-current Apple digital-subscription/reader-app/storefront rules.
   Add StoreKit/RevenueCat in a development build where required, with verified
   server purchase reconciliation to the existing entitlements, duplicate-purchase
   protection and existing-customer recognition. Do not reuse web Stripe Checkout
   as an in-app iOS sale. Do not change or activate live Stripe billing implicitly.
5. Add Sign in with Apple where required by the enabled sign-in options.
6. Finish privacy policy/terms/support, App Privacy disclosures, export-compliance
   review, purchase disclosures, restoration/refund testing and App Review access.
7. Bind an owner-approved EAS project and production environment, then explicitly
   approve submission. The present task does not publish to the App Store.
