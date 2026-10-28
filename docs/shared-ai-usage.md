# Shared AI usage

The writing editor and Chrome extension use **one daily AI request allowance per
account**, enforced on the backend and serialized in PostgreSQL. Nothing changes
subscription prices, trial terms, entitlement grants or Free Quick Prompt.

The effective limit is the lower positive value of `AI_DAILY_REQUEST_LIMIT` and
the account's `ai_entitlements.daily_request_limit`. Either can supply the limit
when the other is zero/unset. An absent, malformed or negative limit never grants
unlimited generation. Existing account limits are preserved; no entitlement rows
are rewritten by this migration.

## Counting rules

- One successful extension AI suggestion consumes one request.
- One successful editor action consumes one request, even when it returns three
  directions. Continue, brainstorm and selected-text improvement share this pool.
- Free, local Quick Prompt does not call AI or use this allowance.
- Failed generation, invalid input, cold-start/basic fallbacks and insufficient
  evidence release their reservation. They do not consume the daily allowance.
- Requests reserve a slot **before retrieval or model work**. Concurrent calls on
  different devices or Vercel instances cannot each spend the last slot.
- Successful completion writes `ai_usage` and marks the reservation done in one
  transaction. Repeating completion for the same request UUID cannot charge twice.
- An application request has a 120-second deadline. If a worker crashes, its
  pending database reservation stops occupying a slot after five minutes. A late
  worker cannot complete an expired reservation.
- AI days start at **00:00 UTC**, independent of browser timezone and `APP_TZ`.
  A request that finishes after midnight is charged to the day it reserved.

`GET /api/ai/usage/summary` authenticates the user and checks Pro access. It returns
`user_id`, `date`, `daily_limit`, `used_today`, `pending_today`, `remaining`,
`total_today`, and `plan`. `used_today` counts completed requests; `remaining`
subtracts both completed and active pending requests. `total_today` also includes
fallback/other usage events. SQL aggregates avoid PostgREST's default row limit.

Both UI counters refresh after requests, on focus/reconnection and every 30
seconds while visible. They discard another account's response. The editor
disables generation when the current summary says no slots remain; the server is
always authoritative. Offline writing and free prompts remain available.

## Deployment order

1. Apply [the shared quota migration](../supabase/migrations/20261028010000_shared_ai_quota.sql)
   in the existing Supabase project's SQL Editor, after the workspace migrations.
   It is additive and safe to reapply. It preserves history and user documents.
2. Deploy the backend/frontend change, then update the extension to **0.16.4**.
   The migration retains the older editor reservation RPC during rollout.
3. Confirm the summary works for an eligible test account. No paid provider call
   is needed to check usage. All new RPCs are service-role only; browsers cannot
   reserve, complete or release another account's quota directly.

If the new RPCs are absent or unavailable, the new backend returns
`503 ai_usage_unavailable` **before AI provider work** rather than bypassing the
limit. Apply the migration before releasing the dependent backend.

## Verification

The isolated PostgreSQL suite executes the actual migration twice and checks
legacy counts, atomic/idempotent completion, transaction rollback, expiry, owner
boundaries, UTC rollover, >1,000 usage events, and private RPC permissions:

```sh
node supabase/tests/ai-quota.cjs
```

Backend tests exercise concurrent editor/extension requests, per-account limits,
pending/remaining counters, failures, cancellation, deadlines, provider fallbacks,
personalization and existing mode behavior. Browser suites test the production
editor and popup using HTTP fixtures, without private content or paid AI calls:

```sh
PYTHONPATH=backend python -m pytest backend/tests/test_ai_quota.py backend/tests/test_workspace_ai.py backend/tests/test_suggestion_modes.py backend/tests/test_suggestion_breadth.py backend/tests/test_profile_personalization.py
node tests/writing-workspace.browser.cjs
node extension/tests/suggestion-modes.browser.cjs
```
