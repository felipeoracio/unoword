# Editor 2.0 — Phase 7 verification

Phase 7 is approved and deployed to **https://unoword.app**, commit `31cb4ef`.
Vercel production deployment `dpl_38MnPtZFDPqLQvzxz3u4SSQBQXJF` is READY;
its build took 63.97 seconds. Deployed editor JS/CSS match the tested build byte-for-byte.
The editor and public API health/catalog probes returned HTTP 200. No error/fatal
groups were returned in the deployment-scoped post-release log check.

The approved Supabase migration-history hardening is also applied and verified.
All nine existing ledger records retain the same fingerprint. Browser roles have
no ledger privileges; RLS is enabled and service/owner access remains intact.

[Phase 7 release](phase-7-release.json) · [Supabase release](supabase-release.json) ·
[Plan](../../editor-2-phase-7-plan.md). Earlier Phase 6 release evidence is preserved
in [deployment.json](deployment.json) and [production-smoke.json](production-smoke.json).

## Verification results

**All 14 browser jobs passed**, using the built production frontend against
synthetic HTTP/IndexedDB data. [Results and attempt history](browser-results.json).
The runner records per-job logs, exit codes and scoped timeouts; it does not use
live account data or paid model calls. Existing suites retain their historical
phase labels in raw output.

| Suite | Result | Seconds |
| --- | --- | --- |
| canvas | passed | 42.86 |
| formatting | passed | 87.85 |
| media | passed | 118.43 |
| writing-tools | passed | 74.53 |
| portability | passed | 33.29 |
| interactions | passed | 24.85 |
| focus | passed | 55.06 |
| projects | passed | 65.32 |
| feedback | passed | 34.16 |
| workspace | passed | 48.52 |
| session-completion | passed | 38.25 |
| typing-1x | passed | 20.25 |
| typing-4x | passed | 45.33 |
| typing-network-4x | passed | 33.2 |

The held-save test now observes the actual pending request and verifies that new
writing reaches the server before Saved appears; it accepts the truthful local-only
pending label during session ticks. The general accessibility wait polls current
animations with a timeout, avoiding stale `finished` promises for removed surfaces.
Initial failures/timeouts are retained in the attempt history. One genuine UI issue
was fixed locally: generic dialog opacity and primary-button hover reduced label
contrast. Dialogs now enter with the existing 6px movement at full opacity, with
a contrast-preserving hover ring. Affected suites were rerun on the local build.
The contrast fix was subsequently approved and deployed in the Phase 7 release.

[Foundation results](foundation-results.json): production build passed; 25 frontend
unit tests and 202 backend tests passed. Full frontend lint completed with four
existing warnings in AdminDashboard/shared UI; no editor errors. Backend tests
reported two Starlette/httpx deprecation warnings. The word-credit tests include
the original 2,000 + 100 − 50 scenario (2,050 document words, 100 session words),
paste separation, partial edits, repeated undo/redo and stored provenance.

[Project SQL](project-sql.log) verifies real RLS, entitlement/ownership checks,
revision/mutation conflicts, project assignment and all five AI scopes using a
disposable PostgreSQL engine. [Progress SQL](progress-sql.log) checks reporting
dates, DST, midnight splits and overlapping session time. These are local SQL
contracts, not production user-data writes.

## Typing observations

The 52,800-character draft was edited at desktop/mobile widths, idle and with an
AI response deliberately held. All typed characters persisted; no editing layout
shifts were observed in these samples. These are **beforeinput to second-frame**
lab timings, not field INP or a performance SLA.

| CPU slowdown | Viewport | Condition | Sample p95 |
| --- | --- | --- | --- |
| 1× | 1440px | idle | 43.4 ms |
| 1× | 390px | idle | 43.8 ms |
| 1× | 1440px | AI pending | 45.7 ms |
| 1× | 390px | AI pending | 41.8 ms |
| 4× | 1440px | idle | 260.6 ms |
| 4× | 390px | idle | 300.9 ms |
| 4× | 1440px | AI pending | 267.8 ms |
| 4× | 390px | AI pending | 279.4 ms |

[1× samples](typing-1x.json) · [4× samples](typing-4x.json).
The 4× results show slower typing on constrained CPU; physical-device profiling
and further optimization remain follow-up work before claiming low-end-device
performance. No speed threshold was silently treated as passed.

A separate cold-cache run used 4× CPU, 150ms latency and 1.6Mbps download.
Its 52,850-character draft and final keystrokes persisted at both widths;
input-event-to-second-frame p95 was 249ms desktop and 211.2ms mobile.
[Network-throttled results](typing-network-4x.json). That instrumentation starts
after `input`, unlike the `beforeinput` table, so the numbers are not directly
comparable. These tests assert editing/save integrity rather than a speed budget.

## Deployed dialog-contrast fix

The Empty Trash confirmation's primary label fell to **4.34:1** during its opacity
entrance, below WCAG AA's 4.5:1 threshold for this text. The brand blue itself is
4.61:1 against white; fading the whole dialog lightened that blue. Generic editor
dialogs now remain opaque and use the existing 6px/260ms entrance instead.
Primary dialog hover uses a subtle ring instead of a brightness filter that also
reduces contrast. Reduced-motion overrides and focus behavior remain intact.

The completion test scans immediately after opening, explicitly audits the
confirmation button while hovered, and checks mobile layout. This CSS-only fix was
approved and deployed in Phase 7.

[Original contrast finding](contrast-before.json) · [Fixed confirmation](confirmation-accessible.png).

## Compatible-application export check

The current browser-exported DOCX was opened by LibreOffice and rendered to PDF.
Independent pypdf checks confirm two A4 pages, the deliberate page break, Latin/
Greek/Cyrillic text, caption and latest unsaved writing. The first page was also
visually inspected for table/image containment and preserved formatting.

[Result](office-compatibility.json) · [Rendered first page](docx-render-page.png) ·
[LibreOffice-rendered PDF](docx-render.pdf). This is compatible-application evidence,
not a claim of perfect Microsoft Word compatibility.

## Supabase review and approved hardening

[Read-only Supabase findings](supabase-review.json). The existing project is
ACTIVE_HEALTHY and its health advisor returned no lints. All 14 inspected
`writing_*` tables have RLS enabled. Document/activity ownership policies combine
with restrictive entitlement policies. The project RPC owner helper rejects
missing identities and missing Pro access; scoped access is exercised locally.
No production documents, activity rows, statistics or Auth settings were changed.
The separately approved release changed only the migration-ledger permissions/RLS.

The initial audit found that `public.unoword_schema_migrations` had RLS disabled
and anonymous/authenticated SELECT, INSERT, UPDATE, DELETE and TRUNCATE privileges.
Its columns are migration version and timestamp, not authored documents, but
untrusted clients should not be able to tamper with migration history.

[Approved SQL](proposed-migration-table-hardening.sql) was applied through Supabase
as `20261114195333_restrict_unoword_migration_history_access`. It revokes browser-role
access and enables RLS, leaving migration-owner/service access intact.
[Local verification](hardening-sql.log) proves idempotence and role behavior;
[production verification](supabase-release.json) confirms unchanged ledger count and
fingerprint, revoked browser access, preserved service/owner privileges and RLS.
The RLS-disabled advisor finding is cleared. The new no-policy informational notice
is expected for service-only metadata. [Supabase remediation reference](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).

Other existing notices: [leaked-password protection is disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
12 authenticated SECURITY DEFINER project-RPC notices, 32 RLS tables with no
policies (31 before hardening) (including deliberately service-only tables), 18 RLS init-plan warnings,
17 unindexed foreign keys and five unused indexes. No blanket RPC revocation,
policy addition, subscription or index changes were made.

## Coverage limits

Browser tests use Chromium viewport/touch emulation, not physical phones/tablets
or Safari/Firefox. Native OS IME/virtual-keyboard behavior needs manual-device QA.
Synthetic persistence covers failed/offline/held responses and reloads; it cannot
prove live multi-device network behavior or integrity of every existing stored
record. Production checks were read-only. AI is an isolated provider fixture, not
a live model call. Export verification does not imply perfect Microsoft Word fidelity.

Typing timings are local lab observations, not field INP, GPU FPS or proof of leak
absence. Shared environment load can affect measurements. Broad user-content
inspection was intentionally avoided. Vercel's post-release error/fatal query
returned no groups in its checked window; no drains are configured, so this is a
point-in-time observation rather than continuous external monitoring.
