# Google sign-in for UnoWord

Google is an alternative way to create an account or sign in. Payments still use
the existing Stripe Checkout integration. Signing in does not start a payment,
activate a trial, or grant Pro. No database migration or new npm/Python dependency
is required.

## Setup the project owner must complete

Google sign-in was disabled in this project's Supabase provider settings during
implementation. The application keeps the Google button disabled and offers
email/password until Supabase reports that Google is enabled. These steps require
access to your Google Cloud and Supabase dashboards; do not send secrets in chat.

1. Open [Google Cloud credentials](https://console.cloud.google.com/apis/credentials).
   Select or create the project for UnoWord. Configure Google Auth Platform's
   branding/consent screen, support email, and audience. Create an OAuth client of
   type **Web application**. Under **Authorized redirect URIs**, add exactly:

   ```text
   https://jvcbpnmtnjhftpukgppw.supabase.co/auth/v1/callback
   ```

   This is Google's return address **to Supabase**, not the UnoWord callback.
   If the console asks for an authorized JavaScript origin, use
   `https://unoword.vercel.app` (the integration uses a server redirect rather than
   a Google JavaScript SDK). For a consent screen in Testing, add the Google
   accounts you control as test users before trying sign-in. Choose the appropriate
   audience; an Internal consent screen excludes people outside your organization.

2. In the **jvcbpnmtnjhftpukgppw** Supabase project, open **Authentication → Sign
   In / Providers → Google** (the dashboard may label this Providers). Enter the
   Google **Client ID** and **Client secret** from step 1, enable Google, and save.
   Keep the secret in Supabase, never in GitHub, the frontend, or an extension.
   No additional Google secret environment variable is needed in Vercel.

3. In **Supabase → Authentication → URL Configuration**, set the Site URL to
   `https://unoword.vercel.app`. Add this to the **Redirect URLs** allowlist:

   ```text
   https://unoword.vercel.app/api/auth/google/callback**
   ```

   The final `**` permits the per-attempt `?flow=…` query. Keep the exact trusted
   hostname and callback path; do not allow arbitrary hosts. Preserve existing
   `/account/security` email-recovery/change redirects. The Vercel backend's
   `PUBLIC_APP_URL` must be `https://unoword.vercel.app` (also the default).

4. Wait up to 30 seconds for the provider-settings cache, then reload
   [the account page](https://unoword.vercel.app/account). Choose **Continue with
   Google** and finish consent with a test account you control. New Google users
   start with Free access. Existing access is read from the same permanent
   Supabase account ID. Supabase handles identity linking; the application never
   merges data, changes ownership, or grants access based on a matching email.
   Verify a controlled existing account before offering Google to existing users;
   provider identity-linking policies determine which identities share an ID.

5. Test both upgrade paths: `/account?plan=pro` and `/lifetime`. After Google
   sign-in, the intended offer should remain selected. The user must review and
   confirm the purchase separately. Leave Stripe in sandbox/test mode and keep
   `STRIPE_LIVE_BILLING_APPROVED=false`; enabling Google does not authorize live
   billing. The lifetime offer retains its separate configuration requirements
   documented in [lifetime billing](lifetime-offer.md).

Publish/configure your Google consent screen for the intended audience when ready.
Google's verification requirements depend on your app, audience and scopes. The
flow requests only the standard `openid email profile` scopes, not Gmail, Drive,
or access to a user's writing.

## Chrome extension

Install/reload extension **0.16.1**, open Settings → Account, and select **Continue
with Google on the website**. Complete web sign-in, then reopen the popup to refresh
the account. The existing HTTP-only session and account verification are reused;
no provider token passes through extension JavaScript and no extra Chrome
permissions were added. Email/password sign-in remains available.

## How it works

- `GET /api/auth/google` reports provider availability without exposing credentials.
- `POST /api/auth/google/start` checks the browser origin and rate limit, creates
  a PKCE verifier/challenge and random flow nonce, and returns Supabase's Google
  authorization URL. The verifier, nonce and approved destination live in a
  10-minute Secure, HTTP-only, host-only `__Host-uno_google_oauth` cookie.
- Google returns to Supabase; Supabase returns a one-use authorization code to
  `/api/auth/google/callback?flow=…`. The backend validates the flow/expiry,
  exchanges the code using the secret verifier, and verifies the authenticated
  Supabase identity before setting the existing HTTP-only session cookies.
- The callback clears the temporary cookie and redirects to a fixed account,
  monthly, lifetime, or editor destination. It does not accept arbitrary URLs.
  Access/refresh tokens never appear in frontend URLs or local storage. The
  callback has `no-store` and `no-referrer` response headers.
- The account page clears the previous user's in-memory query cache and local
  writing-identity marker, then verifies `/auth/me`. Account-scoped offline drafts
  are preserved. Editor destinations resume through this account boundary first.
- Entitlements continue to come from server-side account records and verified
  Stripe events. A Google identity, OAuth URL parameter or checkout success URL
  cannot activate Pro. Existing document/profile/RLS ownership rules are unchanged.

Each browser can have one pending Google flow. Starting again replaces it; an
older attempt fails safely. Canceled, failed or expired attempts show a recoverable
message and retain the intended offer when its validated flow is available.
Google-only users manage Google credentials through Google; this does not silently
add a password identity. Preview deployments need their own explicit allowlisted
callback and matching `PUBLIC_APP_URL`; a host-only cookie cannot move between a
preview hostname and production.

## Verification

```sh
PYTHONPATH=backend python -m pytest backend/tests/test_google_auth.py \
  backend/tests/test_account_security.py backend/tests/test_billing.py \
  backend/tests/test_lifetime.py -q
node --test extension/tests/*.test.js
node extension/tests/dashboard.browser.cjs
# Run a built frontend preview at http://localhost:4175 first:
node tests/google-oauth.browser.cjs
node tests/landing.browser.cjs
node tests/lifetime.browser.cjs
```

Browser tools are environment dependencies, not new production dependencies. Set
`PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` when they are installed outside the
repository. `AXE_SCRIPT` enables the OAuth page's WCAG audit;
`GOOGLE_SCREENSHOTS` selects an output directory for 320/390/768/1440px screenshots.

Isolated tests cover PKCE/session handling, rejected origins/state/redirects,
single-use codes, cancellation, identity mismatch, provider disabled/failure,
signup/sign-in, preserved upgrade destinations, cross-account cache cleanup,
no automatic purchase/Pro grant, editor access gates, extension EN/ES website
navigation, responsive layout, and accessibility. These provider fixtures do
**not** certify Google's actual consent screen. A real Google sign-in must be
tested after the owner completes the dashboard setup above.

Implementation checks: 157 selected backend tests, 22 extension unit suites,
Google OAuth browser fixtures, landing/lifetime/onboarding browser regressions,
and the extension dashboard browser suite passed. The production build and lint
completed; lint retains four existing warnings outside these changes.
