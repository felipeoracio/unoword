# Session-check incident and recovery

Deployed to **https://unoword.app** at `da5f2a6`. Vercel production deployment
`dpl_9GcMsDsMJUbPAAfxpV2BRVdsmats` reached READY; its build took 61.882 seconds.
[Release verification](release.json) confirms deployed files match the tested build,
a real database lookup succeeds, Google sign-in is enabled, signed-out access is
rejected and invalid password credentials are still rejected by the provider.

The live Data API stopped serving account queries: Supabase logs reported internal
pool timeouts (`PGRST003`) and subsequently an unavailable schema cache (`PGRST002`).
Verified session checks require the account's entitlement lookup, so both password
and Google sign-in reached the same failing path. Direct SQL and the password
provider were working. This was not an invalid-password or entitlement downgrade.

The existing project was paused/resumed after lighter config/schema reload and
an isolated old-idle-connection reset failed. The Data API recovered; `/api/product`
now confirms a successful real database RPC in approximately 0.57 seconds instead
of the earlier 20-second timeout/fallback. Google sign-in remains enabled. All
nine migration-ledger records retain their fingerprint, RLS remains enabled and
browser-role ledger privileges remain revoked. No writing or activity rows were changed.

## Application fix

- Account and editor checks share one refresh-token request with protected API calls.
- Refresh-provider outages propagate as service failures instead of silently becoming
  signed-out identities. Rejected sessions stop cleanly after one refresh attempt.
- A failed account lookup after accepted sign-in offers **Retry session check**,
  which uses the existing cookies without resubmitting a password or Google code.
- Entitlements still require server verification. No failed lookup grants Pro or
  rewrites the account's plan. Cache clearing and account ownership checks remain.
- Backend account-lookup failures now emit a generic status warning without logging
  identity, cookie, token or account details.

## Verification

[Results](verification.json): build/typecheck and focused lint passed; 37 frontend
unit tests and 93 backend authentication/security tests passed. Browser checks cover
normal Free/Pro destinations, safe next URLs, initial lookup outage, accepted password
sign-in outage, Google return outage and refresh-provider failure. Separate Google
and signup suites verify callback/confirmation/cache isolation, mobile and WCAG
behavior. The full writing workspace regression also passed.

The account-security fixture now explicitly models a configured deployment when
asserting unauthenticated rejection, rather than depending on private local env vars.
The editor smoke test waits for the actual profile-save response before inspecting
its fixture; it previously asserted before asynchronous persistence completed.

No customer credentials were accessed. Browser identities/providers are synthetic;
production checks are read-only/public API and metadata checks. A real private
Google/password login remains a user-side confirmation after release.
