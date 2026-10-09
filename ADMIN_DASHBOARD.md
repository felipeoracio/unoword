# UnoWord Admin Dashboard

A secure, server-side admin dashboard, fully separate from end-user (Supabase) auth.
The Chrome extension and all existing user flows are unchanged.

## Access
- URL: `<frontend-origin>/admin/login` (e.g. the preview/prod domain + `/admin/login`).
- Sign in with the administrator email + password (see env below). On success you land on `/admin`.
- Sign out from the sidebar (clears the session cookie server-side).

## Environment variables (server-side only — never commit real values)
| Variable | Required | Purpose |
|----------|----------|---------|
| `ADMIN_EMAIL` | yes | Administrator login email. Bootstraps the single admin row on first boot. |
| `ADMIN_INITIAL_PASSWORD` | yes (first boot) | Initial password; used only to seed the admin if it doesn't exist. Hashed with bcrypt; never stored in plaintext. Rotate afterwards via the dashboard. |
| `ADMIN_JWT_SECRET` | optional | Signing secret for the admin session cookie. If unset, a stable secret is derived server-side from `SUPABASE_SERVICE_ROLE_KEY` (never exposed to clients). Set this explicitly in production. |

Reuses existing server env: `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`.

### Setting the initial password securely
1. Set `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` in the hosting platform's secret manager (or `backend/.env` locally — do not commit).
2. Restart the backend; the admin row is created once (bcrypt hash).
3. Sign in, then go to **Admin Settings → Change password** to rotate to a private password. After rotation `ADMIN_INITIAL_PASSWORD` is no longer used (seed only creates when missing).

## Security
- Passwords hashed with bcrypt; only hashes stored (`admin_users` table, RLS-enabled, reachable only by the backend).
- Session is a signed JWT in an **HttpOnly, Secure, SameSite=None** cookie (`uno_admin`), 8h expiry.
- Every `/api/admin/*` route except `/login` is guarded server-side by `require_admin`.
- Brute force: 5 failed logins per email → 15-minute lockout (429).
- Audit log (`admin_audit_log`): login success/failure/lockout, logout, password changes. No secrets, tokens, passwords, or user writing content are ever logged.
- Privacy: the dashboard never exposes user writing/drafts/document contents — only aggregate counts and account metadata.

## Database migration
`supabase/migrations/20260930120000_admin_dashboard.sql` — creates `admin_users` and `admin_audit_log` (RLS on, no policies). No existing tables modified.

## API (all under `/api/admin`, all require the admin session except login)
`POST /login`, `POST /logout`, `GET /me`, `POST /change-password`,
`GET /overview`, `GET /users`, `GET /users/{id}`, `GET /subscriptions`,
`GET /writing-activity`, `GET /feedback`, `GET /system-health`, `GET /audit-log`.

## Unavailable metrics (clearly labeled, not faked)
- Revenue / billing renewal data: no payment provider is connected.
- Feedback `app_version` / `browser` / `delivery_status`: not collected by the current feedback model.
