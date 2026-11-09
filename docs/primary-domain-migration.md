# Primary domain: unoword.app

Production origin: **https://unoword.app**. Existing account IDs, Supabase
project/data, Stripe customer/subscription references and plan rules stay intact.
This change does not enable live billing or Substack access.

## Cutover prerequisites — owner dashboards

Do these before merging/deploying the redirect configuration:

1. **Vercel → UnoWord → Domains**: connect `unoword.app` to Production with no
   domain-level redirect. The apex previously redirected to `www.unoword.app`.
   Connect `www.unoword.app` to the same deployment, also without a domain-level
   redirect: project rules perform the page redirects and preserve recovery/API
   exceptions. Keep `unoword.vercel.app` attached. Do not delete any domain.
2. Check Vercel's valid DNS/certificate status and direct HTTPS access to the
   apex. Existing DNS already routed the custom domains to this application;
   change registrar records only if Vercel reports they are invalid. Preserve
   email/DKIM/SPF/MX records used by Resend and the domain's other services.
3. Set **Production** `PUBLIC_APP_URL=https://unoword.app`. Review Production
   `AUTH_ALLOWED_ORIGINS` and `CORS_ORIGINS` for the primary origin. Code retains
   only the explicitly owned legacy origins for compatibility; wildcard CORS
   remains rejected. Preserve Preview's explicit test URLs and Stripe keys.
4. **Supabase → Authentication → URL Configuration**: set Site URL to
   `https://unoword.app`. Allow `https://unoword.app/**` for signup, Google
   callbacks and password recovery. Retain existing authorized Preview URLs
   and legacy callbacks during migration, including
   `https://unoword.vercel.app/api/auth/google/callback**` and
   `https://www.unoword.app/api/auth/google/callback**`. Keep the legacy root
   confirmation and account/security return URLs available for in-flight mail.
   Do not change the Supabase project, users, JWT keys or email templates' token
   parameters. Custom templates containing the old site URL should use the
   configured Site URL/RedirectTo value.
   Google's registered provider redirect URI stays on the existing Supabase
   project (`/auth/v1/callback`); review Google app branding/home/privacy URLs
   separately if they contain the previous website address.

Do not deploy old-host redirects while the apex still redirects to www; that
would create a loop. A Preview deployment validates code but is not proof that
these external dashboard settings are complete.

## Server redirects and compatibility

`vercel.json` returns **301**, preserving pathname and query, from both legacy
page hosts to the apex. Relative links continue working; existing unknown paths
remain unknown paths. No `/login`, `/signup`, `/settings` or `/pricing` routes
were invented; the existing account page and pricing section keep their routes.

The following deliberately retain same-origin responses instead of redirects:

- **`/api` and `/api/*`**: older extensions/native releases and signed Stripe
  POST requests must retain their method, body, signature and host cookies.
  Stripe does not follow an HTTP redirect as a successful webhook delivery.
- **`/assets/*` and `/writing-sw.js`**: old-origin offline workspaces need their
  same-origin bundles and service-worker updates.
- **`/editor?domain_recovery=1` and `/account?domain_recovery=1`**: explicit
  same-browser recovery of unsynced writing. Ordinary visits still get 301.
- **Legacy root `/?code=…`**: an in-flight email-confirmation code must complete
  on the host holding its PKCE cookie. Codes are removed from the address bar
  and never copied into a cross-domain session URL.

These are compatibility exceptions, not alternative public canonical sites.
Account/editor pages remain noindex. Keep browser-page redirects indefinitely.
Do not remove API exceptions until all integrations/old installed clients have
been migrated and the owner explicitly approves that separate change.

## Accounts, cookies and offline writing

Secure HttpOnly cookies and IndexedDB are origin-bound. Users sign in on the
new domain with the same account; cookies and private documents are never
copied into URLs. New signup/recovery/Google flows use the primary origin.
Legacy API callbacks remain available; explicit recovery Google flows retain
their original host-bound PKCE cookie. A pre-cutover flow that finishes on the
old host may still require a fresh sign-in on the new host.

Cloud documents, statistics and subscription history belong to the same account
and load normally after sign-in. Unsynced browser drafts stay in the original
origin's IndexedDB. On the original browser/device, open either recovery link:

- `https://unoword.vercel.app/editor?domain_recovery=1`
- `https://www.unoword.app/editor?domain_recovery=1`

Sign in to the same account if prompted, then synchronize or export. Links are
also on Support. Recovery retains the existing editor permissions, autosave,
revision/conflict rules and encryption/storage keys. It does not bypass Pro.
The editor shell cache fetches legacy recovery HTML on its original origin so
an update cannot replace the offline cache with cross-origin redirected HTML.

## Stripe and background jobs

Checkout success/cancel, portal return and lifetime return URLs use the primary
origin. Prices, customer IDs, subscriptions and live-approval flags are untouched.

Review the **existing** native and Substack destinations in their respective
Stripe accounts/modes before editing them. Their paths remain:

- Native billing: `https://unoword.app/api/subscription/webhook`
- Substack: `https://unoword.app/api/webhooks/substack-stripe`

After the new domain/API is verified, update each existing destination's URL
in place and verify a signed delivery/replay. Preserve signing secrets unless
Stripe requires a rotation; store any replacement only in backend settings.
The old API endpoints continue serving signed events during this transition.
Substack readiness reports whether the matched destination is canonical or a
compatible legacy destination; Preview destinations must still match Preview.
Do not create charges, cancel subscriptions, or enable live entitlements to
test this domain change.

Reapply `supabase/setup/ingestion-cron.sql` and
`supabase/setup/substack-cron.sql` to update their existing named jobs to the
primary URL, or edit the equivalent external scheduler URLs. Keep the existing
Vault/CRON_SECRET authorization. Legacy job URLs remain functional meanwhile.

## Client release

Extension **0.23.0** uses the primary API, sign-in, editor, rewards and Substack
links, retaining legacy host permission for transition compatibility. Content
and worker guards prevent duplicate editor activity on all three owned hosts.
Publish the update under the **same extension ID**. Unpacked installs should
replace files in the existing installation folder and Reload; removing the
extension or changing its identity can discard extension-local queued work.
The downloadable ZIP and SHA-256 metadata are regenerated together.
An old extension that needs a fresh browser sign-in must update first: a
new-domain login cannot issue host-only cookies for the old API origin. Plan
the same-ID extension release alongside cutover and communicate the sign-in
requirement. Already authenticated older clients retain direct API access.

New mobile/Expo bundles use the primary API and preserve the Supabase identity,
private local storage and activity queues. Offline startup can reuse the old
public connection cache after the API-origin change. Existing installed builds
continue through the legacy API; reload Expo or publish a normal app update to
use the new default. No native credential/session keys are changed.

## Validation and rollback

Run the domain-routing tests against Vercel's actual route compiler, backend
auth/billing tests, extension worker/browser tests, mobile tests/typecheck and
the frontend production build. Verify sitemap/canonical/OG/JSON-LD metadata,
private noindex policy, responsive navigation and old-origin draft recovery.
After cutover, probe both hosts independently, direct-load every existing app
route, and verify exact 301 path/query preservation and a single hop to apex.
Real Google consent, signup email and password-reset delivery also need an
owner-controlled browser/inbox test after Supabase settings are saved.

Rollback means reverting the redirect release and restoring dashboard settings
if necessary; keep every domain attached and preserve all accounts/data. The
legacy API and recovery exceptions keep existing clients and unsynced writing
accessible during either direction of rollout.

## Implementation verification before cutover

The following checks were executed against this branch:

- Frontend production build and typecheck passed. Lint completed with four
  existing warnings (UI component exports and the Admin dashboard hook).
- Changed backend test modules: **420 passed, 31 skipped**. Live tests were
  explicitly disabled. Coverage includes domain validation, host-bound Google
  PKCE recovery, authentication, billing returns and legacy webhook discovery.
- Vercel configuration schema validation passed. **6** compiled-routing/SEO/
  extension-package tests passed, including exact 301 destinations and query
  preservation. A local multi-origin browser fixture verified canonical
  navigation, confirmation cleanup and old-origin storage recovery.
- Maintained landing, editor, Google OAuth, Substack and extension-progress
  browser suites passed with synthetic account/provider fixtures. These include
  responsive layouts, accessibility checks, offline editor recovery, Free/Pro/
  Lifetime restrictions and independent account sessions.
- Extension unit checks passed, including **36** shared progress tests and
  editor duplicate-tracking guards for all three owned hosts. Mobile **26**
  tests and typecheck passed. The Cron SQL repeatability/legacy conflict test
  passed using a local PostgreSQL-compatible fixture.

The older `frontend/tests/marketing.browser.cjs` suite still fails on its
pre-redesign hero-copy assertion. The current maintained
`tests/landing.browser.cjs` suite passes; this old assertion is not a domain
regression and has not been reported as passing.

Strict HTTPS requests succeeded for all three hosts before deployment.
However, **the apex still returned 308 to www**, while www and the Vercel host
served the current application. The production 301 rules are not yet deployed.
Local browser and compiler tests do not prove a deployed redirect or external
Supabase configuration. No real Google consent, email delivery, Stripe signed
delivery on the new domain, live charge or subscription mutation was performed
for this migration. Complete the dashboard prerequisites and post-cutover
checks above before declaring the migration finished.
