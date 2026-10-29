# Writing coach, protected AI allowances, and streak visibility

## Final plan matrix

The latest plan specification controls access. The editor, formatting, document library/folders, personalized Writing Profile, and AI coaching are paid features. Existing account data remains intact. This supersedes the earlier brief that placed the editor on Free; no intermediate Free-editor implementation was deployed.

| Capability | Free | Pro Monthly | Lifetime |
| --- | --- | --- | --- |
| Supported Chrome word tracking, daily goals, basic statistics | Yes | Yes | Yes |
| Prewritten non-AI Quick Prompts and goal adjustments | Unlimited | Unlimited | Unlimited |
| Visible current streak | Up to 7 days | Actual qualifying streak | Actual qualifying streak |
| Record qualifying activity beyond Day 7 | Yes | Yes | Yes |
| Full available synced streak history / premium milestones | Locked | Yes | Yes |
| Built-in editor and rich-text formatting | No | Yes | Yes |
| Document library and folders | No | Yes | Yes |
| Personalized Writing Profile and authorized knowledge | No | Yes | Yes |
| Personalized suggestions / Writing Guidance / usage dashboard | No | Yes | Yes |
| Retrieve existing cloud documents after downgrade | Download only | Yes | Yes |

`lib.plans.FEATURES` is the central capability definition; `/auth/me` returns sanitized, verified features. Active/trialing, expiry, Stripe mode, paid-through cancellation, and existing Lifetime entitlement checks remain in `ai_access`. Lifetime remains a Pro entitlement with `billing_source=stripe_lifetime`, independent of a recurring subscription. Stripe prices, products, trial terms, live approval flags, and offer capacity/refund rules are unchanged.

## Coaching behavior

`coach_policy.COACH_POLICY` is shared by every author-facing model call. It permits topics, questions, outlines, structural suggestions, and constructive feedback. It forbids prose, sentence completions, replacements, and rewrites. The provider and workspace boundaries also reject obvious narrative/replacement outputs, excessive text, and invalid headings. These checks are defense in depth, not a universal natural-language classifier.

The editor removes text improvement, selection replacements, and every AI insertion/application button. `guidance` is exposed as **Help Me Continue**; old `continue` requests map to guidance for compatibility. Old `improve` requests fail validation. Internal source-processing calls produce topic notes for private personalization; they do not create author-facing draft prose.

Existing three suggestion modes, consent, enabled-source filtering, latest Writing Profile preferences, feedback, goal/remaining-word plans, outlines, and checklists remain in place. No progress update automatically generates or replaces a suggestion.

## Protected AI configurations

New-subscriber defaults are stored in SQL, not frontend constants:

- Suggestions: 10 per local day and 200 per local calendar month.
- Writing Guidance: 30 per local calendar month, no additional daily cap.
- Each generation/regeneration is one response, including a response with three alternative ideas.
- Viewing saved responses is uncharged; failed/fallback requests release reservations.
- No rollover; Monthly Pro and Lifetime resolve the same applicable configuration.

Existing paid entitlement rows and pre-update Checkout quotes are assigned the protected legacy version during migration. Their existing positive account daily allowance is retained, with a conservative floor of the previously published 100 shared requests/day. Legacy guidance remains in that existing shared daily pool; new monthly restrictions are not silently imposed. Historical usage remains intact and is counted through timestamps. This is an intentional grandfathering difference, not a lower Lifetime allowance.

Versions are immutable through the API. Admin → **AI Management → Usage Limits** can preview a proposal, save a draft, review old versions, schedule publication, inspect assignments/audit history, set warning thresholds and internal cost targets, and add verified model pricing. Publishing never updates existing assignments. Public marketing terms and new assignments resolve the same effective release. Checkout binds an allowance before creating a Stripe customer or redirect. Compatibility triggers preserve quotes issued by old workers during rollout without changing any Stripe fields. New workers bind the current version first, so the compatibility trigger cannot overwrite it. Checkout binds an allowance without granting Pro access; verified billing events still determine access.

The old `AI_DAILY_REQUEST_LIMIT` variable is no longer the authority for these versioned writing-coach requests. An administrator changes future terms through the versioned screen. Existing account overrides are preserved by assignment; no new frontend value can raise a server limit.

## Atomic requests and idempotency

The existing `workspace_ai_requests` and `ai_usage` records are extended. Service-only RPCs serialize reservations with the existing per-user advisory lock, count pending and completed daily/monthly feature usage, and enforce the applicable version. A request UUID and canonical payload hash identify retries. Reusing a key with different content/account/feature fails; completed retries replay a private cached response without another model call or credit.

A separate lease token prevents a crashed/replaced worker from completing or releasing a newer request. A 120-second application deadline is shorter than the five-minute lease. Suggestions, usage, and replay data commit together. Cache bodies expire after 24 hours and are purged on later reservations; durable usage/idempotency markers remain. Old worker quota RPCs delegate to the new limits during rollout. Existing saved suggestions are untouched.

Quota timezone is established from validated client configuration. Before the first newly charged request, an initial device-timezone read can be corrected by the actual configured request timezone. Once usage/reservations commit, timezone changes take effect at the next calendar-month boundary, preventing repeated resets by switching zones. The API/UI reports the active and pending zone and exact daily/monthly reset timestamps. Calendar boundaries use Postgres timezone rules, including DST.

## Streak architecture

1. **Activity and calculation:** reuse `writing_activity`. Existing editor rows retain their IDs; extension metadata is owner-scoped and uses deterministic session keys. Imported editor sessions are never uploaded as extension activity. Repeated revisions update one row, and duplicate writing days count once. The SQL implementation preserves the existing `WCHistory.computeStreak` rule: at least one typed word qualifies a calendar day; pasted words do not qualify; the current streak must end today or yesterday; a missed required day breaks it. Tests compare the server calculation with the unchanged legacy pure engine around DST and timezone boundaries. Runtime surfaces now use the server result, not parallel plan-dependent calculations. A still-running extension session splits at the next observed edit after writer-local midnight, so yesterday’s recorded words stay on yesterday and new words qualify today; no intervening missed days are invented. An account switch ends the former account’s session before any new account can accumulate words into it.
2. **Entitlements:** existing verified paid access supplies `unlimited_writing_streaks`. Calculation never reads the plan and never stops at seven.
3. **Presentation:** service-only `writing_streak_presentation` returns the full value for paid accounts and a maximum of seven for Free. A Free response has no `actualStreak` or hidden full total. The longest historical run and earned milestones are derived from those same qualifying days and exposed only to paid accounts; a missed day clears the current streak normally without erasing earned historical milestones. Full-history UI is gated. Raw historical activity reads require paid access beyond the existing recent 24-hour Free window; actual-streak RPCs cannot be called with an ordinary user token.

Upgrades/downgrades never rewrite history. The next verified request changes display only. A 15-day Free streak becomes 15 after paid access; 20 becomes a display of 7 after downgrade; re-upgrading on an earned Day 25 reveals 25. Missing days still break the current streak.

### Extension synchronization and offline behavior

Signed-in sessions queue **metadata only**: stable key, start timestamp, typed/pasted counts, duration, revision. Text, URLs, draft content, and AI context are not part of this sync. The outbox is separate from the popup's bounded recent-history cache and persists across worker suspension/offline periods. A debounce, minute alarm, and progress reads retry it. Exact-revision acknowledgements preserve newer edits; account changes cannot upload one account's pending history into another.

The extension receives the backend's permitted streak, rather than calculating a hidden full value for a Free response. Offline responses may reuse a recent owner/timezone-matching display, filtered again when a known downgrade occurs. If no verified display exists, it shows an unavailable/sign-in state rather than inventing a streak. The minute retry uses Chrome's `alarms` permission in extension **0.18.0**.

Older unassigned device history is not silently attributed to whoever signs in. **Sync this device’s writing history** explicitly adopts available session metadata. This does not rewrite dates, add earned words, or restore missing days. Source imports retain their deterministic identities. Historical sessions that have already aged out of the old 500-row local cache and were never in the cloud cannot be recovered; this is a pre-existing history gap, and no streak days are invented.

Explicit history clearing is separate from subscription changes. A server cutoff prevents deleted extension metadata from being resurrected by older offline snapshots; the active extension session can be kept. Existing editor autosave/conflict preservation is unchanged. Documents are never removed by plan changes; downgraded accounts can use the read-only recovery/export route without regaining editing permission. Deliberate permanent document deletion now preserves its earned activity metadata via a nullable document reference.

## Cost monitoring

`ai_cost_events` stores user ID, feature, requested model, reported input/cached/output tokens, estimated USD API cost, price version, status, and timestamp. It stores no prompts, source excerpts, draft bodies, or model response text. Writer-facing requests, source processing, retrieval embeddings, and writing-memory model work are attributed through a request context. Cost telemetry is separate from subscriber credits; failure/rejection can retain real API cost while releasing the credit.

The migration seeds published standard GPT-5.4 mini prices ($0.75 input, $0.075 cached input, $4.50 output / million tokens) and text-embedding-3-small ($0.02 / million input), with official source URLs. Admin pricing updates are versioned and audited. Unknown models or calls with unavailable token counts are **unpriced**, never fabricated as zero. Historical heuristic estimates are excluded from the new cost dashboard. This dashboard is an estimate from observed calls, not an OpenAI invoice reconciliation system; a crash/failed call without reported tokens can remain unknown.

The $2/account/month target and 80% usage warning are configurable monitoring defaults. Exceeding the target never cuts promised benefits. Admin reports UTC calendar-month spending, cost by feature/model, high-usage account IDs, trends, status, and accounts exceeding their assigned target. Customer quota reset times are shown in their configured zone.

## Marketing and rollout

The landing page retains its design, navigation, real authentication/checkout links, and public-only demos. It now uses **Your Words. Your Voice. Your Story.**, three pricing cards, a 16-row responsive comparison, accurate Free streak messaging, explicit paid labels, coaching philosophy/FAQ, and updated SEO/Open Graph assets. Pricing, allowances, and Lifetime capacity use existing public backend configuration. `marketing/paid-social-briefs.md` contains four campaign copy sets and 4:5 / 1:1 / 9:16 creative specifications. No ads or live billing were activated. No existing Meta pixel was found in the tracked frontend, so no new tracker was invented.

Apply these migrations in order **before deploying this application build**:

1. `supabase/migrations/20261028030000_writing_coach_allowances.sql`
2. `supabase/migrations/20261028040000_verified_streak_presentation.sql`

Both are transactional and repeatable; earlier migrations must already exist. No new secret is required. The current cloud workspace's database connection cannot reach/authenticate through the supplied settings, so these SQL files must be run in the owner's Supabase SQL Editor or an approved migration runner. Do not deploy the new request paths before these functions/policies are present.

After applying: deploy the PR, reload/update the extension from the published 0.18.0 ZIP, sign in, synchronize available older device history explicitly, and check the account streak and Your AI Usage. Review the admin model-price rows for any non-default model in use. Keep Stripe sandbox/test with live approval off until separately approved. Run live smoke checks after migration/deployment; isolated tests do not prove live database rollout has happened.
