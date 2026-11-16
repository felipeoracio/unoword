# Recurring session outage: bounded recovery and prevention

The Data API again returns pool timeouts while direct PostgreSQL works, request
volume is low, and the database has spare connections. A restart is recovery,
not a durable root-cause fix. No evidence yet supports a paid compute change.

1. Keep password/Google token validation unchanged. Resolve session-only account
   access through the existing Supavisor transaction pooler using fixed, bound,
   read-only SQL and the existing service-role authority. Preserve native and
   configured Substack grant precedence and existing live/test/expiry checks.
2. Bound connection/concurrency/query/lock waits and always close connections.
   Use the existing API path if no pooler is configured; fail closed if verified
   account access cannot be read. Do not grant cached or optimistic paid access.
3. Add a no-store readiness endpoint that checks both the session database path
   and the actual Data API, returning 503 for failures. No private data or secrets
   appear in its response. External alert delivery still needs a monitoring setup.
4. Test the pooled path while simulating Data API failure, expired/missing grants,
   bad identities, timeouts, connection saturation and provider/config failures.
5. Deploy and verify the pooled path against the real runtime before service
   recovery. Restart the existing project if the managed API remains stuck; retain
   data, project, billing and policies. No new database or subscription changes.
6. Preserve an incident report for Supabase support. A recurring managed API fault
   needs provider investigation; application resilience cannot guarantee its uptime.
