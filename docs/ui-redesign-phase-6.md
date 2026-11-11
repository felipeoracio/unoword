# Phase 6 — Library and Settings

This phase starts from deployed Phase 5. PR #26 is merged and Phase 6 is deployed
at `9c2754a450226838f384e47cf12731d4d35c6748`. Existing APIs, persistence queues, entitlements,
resource permissions and tracking remain authoritative.

## Production verification

Vercel reports a successful production deployment. Normal certificate-validating
HTTPS probes returned 200 for `/library`, `/settings`, `/projects`, `/api/` and
`/api/product`; anonymous document and project-resource APIs returned 401. The
live site serves `/assets/index-X8vsp95A.js` from this release.

The Library/Settings browser workflow and targeted axe checks also passed against
the production frontend with synthetic API responses and analytics disabled.
The browser required this environment's certificate override; the separate HTTPS
probes validated certificates normally. This verifies the deployed frontend, not
live authenticated storage or provider integrations. No real account data, mail,
payment or paid AI was used.

## Library

`/library` groups Writing, Projects, References, Memory, Ideas and Writing
Profile. `/projects` retains the Projects view for existing links. The studio
Library destination now opens `/library`; the editor's save-before-navigation
guard still runs before leaving writing.

The page verifies studio identity without mounting the writing/session hook.
Writing, reference and memory collections use the existing owner-bound project
catalog, title search, read-only project filters and incremental rendering.
Filtering or inspecting a project never selects it for writing, moves a document,
changes membership or grants AI permission. Opening a project deliberately uses
the existing selection/flush operation; membership edits stay in ProjectManager.

Authored documents, AI references, independent AI memories and saved writing
context have distinct labels. Active writing uses existing document deep links.
Archived writing, completed-state controls, folders and trash remain reachable
through the editor; the catalog excludes trashed writing by server policy.
Previews fetch text only when requested, validate the returned resource identity
and render plain text. Opening a preview grants no AI access.

Reference cards show processing and AI permission separately. Enabled sources
still need to finish processing before AI can use them. The existing source
metadata API supplies confirmed permissions; unavailable metadata does not become
an unchecked permission. Explicit changes use the existing source permission
endpoint with `expected_user_id`. Controls show pending confirmation and preserve
the confirmed state after failure. Offline controls are disabled. The existing
200-source metadata limit can leave later catalog rows without a permission
control; those rows say permission is not confirmed rather than guessing it.
Existing project controls add/rename references, and the extension retains its
processing retry controls.

Guided profile questions reuse the existing account-bound local drafts, answers
and sync queue. The free-text profile remains available through its existing
editor link. Browsing or saving guided answers does not overwrite those fields.
Ideas links to the existing prompt/bookmark/saved-guidance screen; it does not
generate or fetch AI suggestions automatically.

Owner and entitlement changes remove private collections. Free accounts retain
the Ideas shortcut and preservation explanation without requesting protected
catalog, source or profile APIs. An already-open offline page labels cached
metadata. Initial offline access offers the existing offline editor while asking
the writer to reconnect to verify Library identity.

## Settings

`/settings` reuses Account's authentication, billing and subscription handlers.
`/account`, plan/offer/billing queries, and existing `account-settings`,
`writing-progress`, `quick-prompt`, `install` and `subscription` anchors remain
available. Settings navigation groups account, plan/subscription, preferences,
security and Chrome setup into readable cards. Anchor navigation leaves the
existing forms mounted so entered values are preserved.

Shared language/theme controls apply to the layout. Substack, rewards, tour,
streak controls and AI usage receive the selected language. Existing trial, checkout, portal, lifetime,
rewards, tour and sign-out behavior remains with its original component/handler.
Confirmed owner checks and explicit plan confirmation remain required.

Security offers an explicit password-reset email action through the existing
recovery endpoint after rechecking current identity. Merely opening Settings
does not send mail. Recovery/email callback pages receive a readable presentation
and a Settings link while retaining their existing early token removal, one-use
POST submission, no-storage behavior and independent language control. They do
not mount account preferences before handling verification tokens.

The reused streak milestone label now has a group role and translated accessible
name; the plan heading uses the studio text color for contrast.

## Verification

Build, TypeScript and lint are checked; lint retains four existing warnings.

- `tests/studio-library-settings.browser.cjs` covers identity/Free gates,
  categorized metadata, pagination, archived discovery, project filtering without
  selection or membership changes, on-demand previews, permission confirmation,
  failure/offline states, guided profile preservation, old Projects links,
  settings focus anchors, recovery requests, reward controls and account changes.
  It checks EN/ES, both themes, 320/390/768/1024/1440px and targeted axe scans
  with reduced motion. Fixture screenshots live under ignored
  `tests/artifacts/phase6/`.
- Existing project/context, studio shell, coaching, Progress, onboarding, Google
  OAuth, Substack, rewards and secure callback browser regressions exercise preserved
  operations. `ACCOUNT_SETTINGS_ONLY=1` in the marketing browser runner covers
  signup/install/download/sign-out, plan confirmation and stale-owner rejection,
  safe Stripe destinations, verified billing returns, cancellation and recovery.
  Its HTTP fixtures now include the shared account consumers. The full marketing
  mode still has an older landing-copy assertion outside this phase's scope.
- Desktop light/dark and Spanish mobile fixture captures were visually reviewed.
- Embedded PostgreSQL project tests cover membership, scoped retrieval, profile
  answers, archived/deleted projects, account ownership and Free restrictions.
- Account-security, project-context and Substack backend suites pass 104 tests
  with provider boundaries mocked; two existing Starlette deprecation warnings
  remain. Test-only Python dependencies were installed in a temporary venv.

No production user writing, real email, charge or paid AI is used by these
checks. Physical Chrome/iPad and live authenticated infrastructure checks remain
separate Phase 8 work. Automated axe results are not accessibility certification.
