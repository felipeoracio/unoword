# UnoWord marketing website

The official landing page is `/` in **felipeoracio/unoword**, the current repository connected to `https://unoword.vercel.app`. The older `felipeoracio/app` copy was inspected; the user explicitly chose the current repository.

## Routes and components

- `/`: `frontend/src/pages/Home.tsx`. Sticky responsive navigation, hero/product illustration, problem/solution, six features, four-mode interactive example, personalization flow, three setup steps, six audiences, live capability comparison, FAQ, final CTA, footer.
- `/account`: `frontend/src/pages/Account.tsx`. A web adapter to the existing Supabase-backed `/api/auth/login`, `/signup`, `/me`, `/refresh`, `/logout`, and `/recovery` APIs. Free signup leads to extension installation. `?plan=pro` retains the intended Pro request through sign-in, requires explicit account-specific confirmation, checks the current account again, and calls the existing `/api/subscription/change`. No local entitlement is granted.
- `/privacy`, `/terms`, `/support`: `frontend/src/pages/Information.tsx`. Verified data-handling information, honest legal-publication status, installation/editor-support instructions, and the verified public project's GitHub issues destination. No contact address or legal contract is invented.
- `/account/security`, `/admin/login`, and `/admin`: existing behavior is preserved. Account and admin pages are lazy-loaded and marked noindex. Unknown paths have a real fallback screen.
- `ProductPreview.tsx` reuses the canonical UnoWord brand and dashboard design as a clearly labeled illustration with fictional metrics. All four marketing examples are fictional static content; selecting a mode never calls a paid model.
- `marketing.css` and `account.css` scope the blue/navy/white design to these website pages. They do not change extension CSS. Keyboard tabs, menu disclosure/Escape, FAQ expansion, focus styles, skip navigation, readable layouts, and reduced motion are supported.

## Application facts and pricing

`GET /api/product` is public and sanitized. `backend/lib/plans.py` supplies the feature policy used by both the public comparison and existing paid entitlement enforcement. Active/trial status and expiry checks are unchanged. `backend/routers/subscriptions.py` shares the billing availability flag. No amounts, billing periods, unlimited usage, or account-specific quotas are advertised.

One correction to the proposed copy: the existing backend allows Free accounts to edit their Writing Profile. The comparison accurately includes that feature on both plans. The three AI modes, source knowledge, goals, and extended history require eligible Pro access. Free recent history covers the past 24 hours. Typed and pasted counts remain separate; Google Docs' canvas-based main editor is not advertised as supported.

Billing is still unavailable by the user's earlier choice. Both signed-out and signed-in Pro CTAs lead to the current account flow; confirmed requests return the existing billing-unavailable response without changing entitlements. There is no new payment system.

## Installation and configuration

No verified Chrome Web Store listing exists in the repository. Free CTAs therefore lead to signup and a working developer-release download. The ZIP in `frontend/public/downloads/` contains only distributable files from extension v0.13.0; its checksum/version are in `release.json`. The installation instructions explicitly explain Developer mode, “Load unpacked,” managed-browser limitations, and manual updates.

Regenerate the ZIP whenever distributing an updated extension:

```sh
python frontend/scripts/package-extension.py
```

`PUBLIC_APP_URL` configures the canonical origin, social-image URL, and structured data at build time; the existing production default is `https://unoword.vercel.app`. It also configures trusted origins in the existing backend. When using a different site, configure the variable for both services.

Once an actual store listing is published and verified, set `PUBLIC_CHROME_STORE_URL` in the backend deployment and redeploy. The public endpoint accepts only HTTPS links on `chromewebstore.google.com/detail/...`; the primary CTAs then use the configured listing. Do not enter a guessed listing URL.

Formal Terms of Service, the owner's legal privacy/contact details, and a future payment-provider integration remain owner configuration/publication work. The current Terms page clearly states this status. The previous Supabase email/SMTP setup requirement still applies to email changes and recovery; this task does not enable it.

## SEO and delivery

The Vite build produces the normal browser assets plus build-time public HTML through `entry-marketing.tsx` and `scripts/prerender.mjs`. The landing page hydrates that HTML; other routes render normally. This requires no persistent SSR server, private API calls, or model calls. The delivered HTML already contains the landing text and headings before JavaScript runs.

Metadata includes the requested title/description, canonical URL, Open Graph tags, a local 1200×630 PNG social card, Twitter card, and accurate `SoftwareApplication` structured data with no invented offers/reviews. Preview deployments are noindex; account/admin routes and unpublished terms are excluded from indexing. Admin JavaScript is split away from the initial landing bundle.

Vercel's existing API rewrites and SPA routes are unchanged. The website uses relative `/api` URLs and secure existing session cookies. No service-role key, model credential, account token, or private user data is embedded in the marketing content or package.

## Validation and screenshots

Build and lint:

```sh
cd frontend
yarn build
yarn lint
```

Install test dependencies in `tests/` for Playwright and axe-core. Browser binaries must also be available. Run from the repository root:

```sh
node frontend/tests/marketing.browser.cjs
node frontend/tests/account-security.browser.cjs
node extension/tests/dashboard.browser.cjs
node --test extension/tests/*.test.js
python -m pytest backend/tests/test_product.py backend/tests/test_account_security.py backend/tests/test_profile_personalization.py backend/tests/test_suggestion_modes.py backend/tests/test_suggestion_breadth.py backend/tests/test_phase15_cost.py backend/tests/test_source_availability.py backend/tests/test_link_library.py
```

`PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, and `AXE_MODULE` can select existing installations. Set `MARKETING_SCREENSHOTS` to a directory to save desktop/mobile, hero, and installation screenshots.

Verified during implementation:

- **104 backend tests passed**, including anonymous catalog, no provider resolution/secrets, current feature policy, expiry and Pro authorization, auth/profile security, and suggestion regressions.
- The built marketing browser suite passed at **320, 360, 390, 768, 1024, and 1440px**. It checks overflow, menus/anchors, all four keyboard-operated examples, FAQ, Free/Pro feature display, API failure state, signup/install/download/logout, authenticated plan confirmation, account-switch protection, recovery setup message, footer routes, SEO, and no AI calls.
- **axe WCAG 2 A/AA and 2.1 AA audits passed** on desktop/mobile, the example UI, signup, and the Pro account flow. Automated checks supplement, rather than replace, manual accessibility review.
- Existing extension unit suites and callback browser regressions passed. The dashboard browser regression also passed against files extracted from the actual downloadable ZIP, including EN/ES and 180–420px preview layouts. Native extension execution remains subject to the environment's managed-browser policy.
- ZIP contents match the extension runtime source, manifest version and SHA-256. Tests/tools/credentials are excluded.
- Build and lint pass. The four remaining lint warnings belong to pre-existing UI exports and the admin effect; no new lint warnings were introduced.

The older shared-account live pipeline suite is not used for marketing tests because it mutates shared QA usage/settings. Live deployment checks use disposable accounts and clean them up; no real customer's profile, quota, or subscription is changed.
