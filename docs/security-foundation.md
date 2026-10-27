# Account security foundation

This phase hardens existing authentication and browser access. It preserves
account IDs, writing, offline drafts, profiles, plans, Stripe pricing, and the
signature-verified webhook. No database migration is required.

## Browser origins

All API reads reject an explicitly untrusted browser Origin. All API mutations
require a trusted web/extension Origin, a valid extension runtime marker on an
originless privileged worker request, or an explicit non-browser Bearer caller;
the endpoint still verifies that caller's token and permissions. The exact POST
`/api/subscription/webhook` is exempt from browser-origin checks and continues to
require Stripe signature and mode verification. Top-level OAuth GET callbacks
can arrive without an Origin header.

Allowed web origins come from `PUBLIC_APP_URL`, `AUTH_ALLOWED_ORIGINS`, and explicit
`CORS_ORIGINS` entries. Wildcards, malformed values, URL credentials, and paths
are ignored. A deployment that previously used `CORS_ORIGINS=*` now fails closed
for unrelated sites. The default production origin is
`https://unoword.vercel.app`. Set explicit localhost origins in local development
settings, or explicit preview origins in the corresponding preview deployment.

Only correctly formed Chrome extension origins are accepted. Unpacked extension
IDs vary by installation; after publishing a verified store release, set
`AUTH_ALLOWED_EXTENSION_IDS` to its ID (or a comma-separated approved set) to
narrow access. Until then, properly formed unpacked-extension origins remain
compatible. Browser cookies remain Secure and HTTP-only.
Extension 0.16.3 adds its runtime ID in `X-Uno-Extension-Id` to authenticated
requests, refreshes and uploads for Chrome worker requests that omit Origin.
The marker is not authentication: the endpoint still verifies the session/token.
It never overrides an untrusted or null Origin. Ordinary websites cannot send
this custom header without passing the origin-restricted CORS preflight.
Admin session signing fails closed if neither a dedicated admin secret nor the
existing server credential is configured; it cannot fall back to a known
development signing secret. Malformed admin credential/key inputs are redacted
from validation responses.

## Verified email signup

`POST /api/auth/signup` uses Supabase's public signup API, with PKCE. It never
calls the admin user-create/update API or marks an address confirmed. It checks
that Supabase requires email confirmation and refuses unexpected auto-confirmed
sessions. Responses remain generic for already registered addresses. Signup and
password login have bounded burst limits in addition to provider limits.

Signup accepts only email, password and the approved account/monthly/lifetime/
editor intent. The response is pending: no session or paid access is granted.
The PKCE verifier and intent live in a one-hour Secure, HTTP-only, host-only
cookie. Access and refresh tokens do not appear in frontend JSON or local storage.

Supabase's confirmation email first proves ownership and then returns a one-use
PKCE code to the application's Site URL. The web app removes the code from the
address bar and asks the user to continue. `POST /api/auth/signup/complete`
exchanges it server-side, verifies the returned identity and confirmed email,
sets the existing session cookies, and restores the approved account destination.
The UI clears the previous account's query/identity cache at that session boundary.
Confirmation does not start Checkout, grant Pro, or consume AI usage.

Opening the link on another browser/device lacks the verifier cookie and cannot
silently replace that browser's session. The email may already be confirmed at
Supabase; the page offers normal email/password or Google sign-in. Expired or
consumed codes cannot be reused. Submitting Create free account again requests a new
confirmation through the provider; provider cooldowns still apply.

Existing confirmed users retain password sign-in and their account IDs. An
unconfirmed password login returns `email_confirmation_required` and guidance;
it never invokes an admin confirmation fallback. Google uses the same shared
PKCE helpers as before and retains its existing callback and nonce protection.

### Supabase settings the project owner should verify

1. Authentication → Email: **Confirm email must be enabled**. The application
   refuses new email signups when Supabase reports automatic confirmation.
2. Authentication → URL Configuration: Site URL must be
   **`https://unoword.vercel.app`**. Keep the existing Google callback allowlist.
   Email signup returns to the Site URL and needs no new callback path.
3. Authentication → Email Templates → Confirm signup: retain the standard
   provider confirmation link, for example:

   ```html
   <a href="{{ .ConfirmationURL }}">Confirm your UnoWord account</a>
   ```

   Do not replace this signup link with the password-recovery or email-change
   template. Those flows retain their existing TokenHash-based templates and
   `AUTH_SECURITY_EMAILS_CONFIGURED` setup flag.
4. Configure production SMTP, sender identity, delivery limits, and provider
   email/security controls before a public signup campaign. Test delivery to an
   inbox you control. Isolated tests do not certify actual mailbox delivery.

## QA credentials

Hardcoded dedicated QA passwords were removed from tracked scripts/tests and
credential fields were redacted from historical test reports. The two existing
example.com QA accounts had their passwords rotated while preserving their IDs;
their refresh sessions were revoked. Previously issued access tokens may remain
valid until provider expiry. The replacements are saved only in the ignored
local backend environment file; move them into secure settings for any separate
test environment. Real customer and administrator credentials were not rotated.

Live QA tests now require `UNOWORD_RUN_LIVE_TESTS=1` and private
`UNOWORD_TEST_USER_A_PASSWORD` / `UNOWORD_TEST_USER_B_PASSWORD` settings. The seed
script requires both settings and never prints their values. The ordinary signup
tests now use isolated provider fixtures and send no email or real account changes.
Old Git history may retain original report text; invalidating exposed credentials
is required even after redacting the current tree. This phase does not rewrite
shared Git history.

## Validation

Selected isolated backend suites cover CORS/preflight, hostile and missing Origins,
legacy API writes, explicit previews/extensions, webhook exemptions/signatures,
pending signup, rejection of auto-confirm, one-use PKCE codes, cross-browser
failures, identity verification, existing password login, Google sign-in, account
security, editor ownership, AI restrictions, and monthly/lifetime billing.

```sh
PYTHONPATH=backend python -m pytest backend/tests/test_browser_security.py \
  backend/tests/test_auth_signup_signin.py backend/tests/test_google_auth.py \
  backend/tests/test_account_security.py backend/tests/test_product.py \
  backend/tests/test_workspace.py backend/tests/test_billing.py \
  backend/tests/test_lifetime.py backend/tests/test_onboarding.py \
  backend/tests/test_suggestion_modes.py backend/tests/test_link_library.py -q
# After building and starting a frontend preview on port 4175:
node tests/email-signup.browser.cjs
node tests/google-oauth.browser.cjs
node tests/landing.browser.cjs
node tests/lifetime.browser.cjs
node frontend/tests/account-security.browser.cjs
node extension/tests/dashboard.browser.cjs
node --test extension/tests/*.test.js
```

Browser fixtures do not call Google consent, send emails, create real payments,
or invoke paid models. The updated extension package is **0.16.3**.
The selected backend run passed **285 tests**; extension unit checks, signup,
Google, landing, lifetime, recovery and popup browser fixtures also passed.
The managed Chromium environment could not start a native extension worker;
runtime-marker JSON/upload/refresh handling was checked with the actual client
code under isolated worker fixtures and against backend origin/preflight rules.
Reload the updated installed extension and verify its account connection.
