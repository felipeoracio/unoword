# Session outage recurrence — 2026-11-16

## Diagnosis and mitigation

The managed Supabase Data API again returned PGRST003 pool acquisition timeouts.
The project status still said ACTIVE_HEALTHY. Direct SQL worked, with 23 of 60
connections occupied and low logged API volume. These observations do not prove
compute saturation or establish that a paid upgrade would solve the fault.

Session access now uses the existing transaction pooler for fixed, owner-bound,
read-only entitlement queries. Authentication, entitlement expiry, native and
Substack grant precedence, and live/test rules remain enforced. Connections,
concurrency and query waits are bounded. An unavailable pooler falls back to the
existing Data API path; failure of both paths does not grant access.

This change protects session checks from a Data API outage. Document cloud
synchronization still depends on the Data API, and provider uptime is not
guaranteed by this mitigation. No customer documents, statistics, subscription
prices, billing configuration, or schema were changed by this release.

## Verification

- 109 session, authentication, Google, browser-security and account-security tests passed.
- 138 workspace, AI context, quota and Substack policy tests passed.
- Both runs emitted two existing Starlette/httpx deprecation warnings.
- Python compilation, branding checks and whitespace checks passed.
- Before restarting Supabase, the deployed preview returned HTTP 503 from the
  readiness route with session_database=ok and data_api=error. This validates the
  actual configured pooler path against the real Data API outage.
- Production deployment: dpl_HnGdQHhhxTnfExk5SgkmQsWpAMvJ, READY, commit
  a2b86899628512518c4d3e1fe35bd0c3a893a011.
- The existing Supabase project was restarted for service recovery. Production
  dependency verification is recorded separately after recovery.

## Preventing and detecting recurrence

GET https://unoword.app/api/health/ready checks both actual dependencies concurrently.
It returns 200 only when both work, otherwise 503, without account data or provider
error details. Responses are not cached; requests are rate limited to 30/minute
per client. Use an independent monitor at approximately one-minute intervals,
with consecutive-failure alerting and recovery notifications. External monitoring
and alert delivery have **not** been configured by this change.

Supabase should investigate the recurring managed PostgREST pool fault. Suggested
support context: project jvcbpnmtnjhftpukgppw; Postgres 17.6.1.166, PostgREST 14.5;
PGRST003 while direct SQL and the transaction pooler work; project status healthy;
low observed request volume and spare database connections; restart previously
restored the API but the fault recurred. Ask for managed API pool and upstream
connection investigation. No support ticket has been sent.

Avoid treating a restart or a successful static API root response as a permanent
fix. Evaluate support/availability options with the provider before changing
billing; no evidence currently establishes that a compute upgrade fixes this fault.

## Production recovery results

Supabase returned ACTIVE_HEALTHY after the restart. Public probes on 2026-11-16
confirmed readiness HTTP 200 with both checks OK (0.57s), public allowance data
available (0.52s), and Google authentication enabled (0.46s). An unauthenticated
session request and one intentionally invalid diagnostic password login both
returned the expected HTTP 401. See production-probes.json for the sanitized
responses. No real customer credentials or live customer account were used.

The migration ledger still has nine records and fingerprint
bb6dbee9ab25fff747d97a9669e79b82. RLS remains enabled, with anon and authenticated
browser roles still denied table privileges. This is a targeted metadata check,
not a full comparison of every customer document.
