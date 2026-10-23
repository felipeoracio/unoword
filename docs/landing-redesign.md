# UnoWord landing page redesign

The public `/` route now follows the supplied editor-focused reference: a sticky
header, two-column hero with a prominent editor illustration, four benefits,
four feature cards, three onboarding steps, a connected personalization flow,
pricing alongside audiences and FAQs, and a blue wave CTA and footer.

## Implementation

- `frontend/src/pages/Home.tsx`: new page composition, reusable plan cards,
  existing signup/sign-in/editor links, native accessible FAQ, responsive menu.
- `frontend/src/components/marketing/ProductPreview.tsx`: an accurate illustrative
  editor and four small feature illustrations. Ideas / Improve / Continue are
  keyboard-accessible demonstration tabs; they never call AI or load user data.
- `frontend/src/styles/landing.css`: scoped responsive design using bright blue
  `#0866FF`, navy `#0B1B4D`, pale blue, rounded cards, and restrained shadows.
  Desktop retains the reference's compact horizontal composition. Tablet and
  mobile stack content rather than shrinking text or the entire editor image.
- `frontend/src/components/marketing/Brand.tsx`: an explicit joined wordmark
  variant used only by the landing page; existing application views keep their
  current rendering.
- `frontend/index.html`, `frontend/src/components/PageMetadata.tsx`: UnoWord
  title, description, Open Graph, Twitter, and structured application metadata.
  Canonical and social URLs still use the existing configured `PUBLIC_APP_URL`.
- `frontend/public/brand/social-card.svg` and `.png`: matching 1200×630 social
  artwork with the UnoWord wordmark and editor illustration.
- `tests/landing.browser.cjs`: browser regression and accessibility verification.

The page uses the existing Geist font, logo, React, Lucide, and shared product
query. No dependency, backend, database, editor, extension, or Stripe behavior
was added or changed.

## Product and billing accuracy

The production public catalog was checked before implementation. It reports
$20 USD monthly and a seven-day trial, with billing configured. The page derives
price, currency, billing interval, trial length, checkout availability, and
individual feature visibility from `/api/product`. It shows account links rather
than invented prices if the catalog is unavailable. It suppresses trial offers
when checkout or trials are unavailable. Trial eligibility and payment terms
are shown; AI is never described as unlimited.

Free includes the implemented editor and document library, session statistics,
recent history, and the original non-AI Quick Prompt. Pro tools use the existing
feature flags. Every paid CTA leads to `/account?plan=pro`, requiring sign-in and
the existing Stripe flow. Redirects never grant access. This change does not
activate live billing or modify sandbox settings.

The editor illustration uses fictional writing and progress and is explicitly
labeled. It omits unsupported collaboration/share actions. AI copy describes
opt-in draft sharing and the separate choice to use documents for future
personalization. The privacy answer links to the existing policy; support and
legal links use existing routes.

## Verification

Run against the production build served at `http://localhost:4175`:

```sh
cd frontend
yarn build
yarn lint
yarn vite preview --host 0.0.0.0 --port 4175
```

From the repository root, with Playwright, Chromium, and axe installed:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/path/to/chromium \
AXE_SCRIPT=/path/to/axe-core/axe.min.js \
LANDING_SCREENSHOTS=/tmp/unoword-landing \
node tests/landing.browser.cjs
```

Verified:

- Production build, TypeScript, and server-rendered public HTML pass.
- Lint passes with the four existing unrelated shared-UI/admin warnings.
- Landing browser suite passes at 320, 360, 390, 640, 641, 768, 960, 961,
  1024, 1200, 1201, 1312, 1440, and 1920px: no horizontal scrolling or clipped
  controls. Desktop, tablet, and mobile screenshots were captured and reviewed
  against the supplied reference. Small progress-illustration clipping found
  during review was fixed before the final run.
- WCAG A/AA checks pass at 1312, 390, and 320px. Demo tabs, FAQs, mobile-menu
  Escape/focus handling, and anchor navigation work with the keyboard.
- Branding checks cover visible text, image descriptions, accessibility labels,
  title, metadata, and structured data, including a legacy-name API response.
- Signup, Pro authentication gate, editor authentication gate, privacy, terms,
  support, and all page-link destinations pass. No paid API is called by demos
  or signed-out marketing CTAs.
- Changed backend price/trial/interval, removed feature flags, disabled billing,
  no-trial configuration, and product-API failure states pass.
- All 14 public-product backend tests pass.
- Full editor browser regression passes: authentication isolation, autosave and
  reopening, formatting, typed/pasted counts, folders/trash, conflict recovery,
  consent and AI approval, profile and sources, import/export, focus/themes,
  offline synchronization, Free/Pro, and English/Spanish responsive layouts.
- All 22 extension Node test files pass. Chrome popup browser regression passes
  at 180–420px, in English and Spanish, including live session statistics,
  progress refresh, library, and website actions.

Screenshots for this session are in
`/workspace/.onboarding/unoword/landing-redesign/`:
`landing-1312.png`, `landing-768.png`, `landing-390.png`, and corresponding
`-viewport.png` hero captures. This directory is an environment artifact rather
than bundled website content. The command above can regenerate them elsewhere.

## Configuration

No new configuration is required for the landing page. The existing configured
site URL, public product endpoint, authentication, and Stripe flow are reused.
The previous editor release's database activation is a separate prerequisite
for production cloud document saving; see `docs/writing-workspace.md` and
`supabase/migrations/20261023010000_writing_workspace.sql`. Local fixtures verify
editor behavior but do not establish that a production migration was applied.
