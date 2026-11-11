# Modern Writing Studio — marketing redesign audit and review

## Audit and implementation decision

The public landing route `/` is `frontend/src/pages/Home.tsx` in the same React/
Vite application as `/app`, `/editor`, `/ideas`, `/progress` and `/library`.
`entry-marketing.tsx` and `scripts/prerender.mjs` deliver public HTML before
JavaScript; `PageMetadata.tsx` maintains SPA metadata. No new package is needed.

The application foundation currently lives in `styles/studio.css`: Inter Variable,
Georgia, the approved navy/blue/sky/cream/white palette, semantic light/dark
colors, spacing and surface tokens. `StudioPrimitives.tsx` wraps the existing
Base UI Button, shadcn Card, router Link and Lucide icons. Marketing currently
defines separate colors/buttons in `marketing.css`/`landing.css` and uses Geist.
Account/registration uses the marketing styles; authenticated Settings uses
the studio shell. The shared application breakpoint is 900px, with narrow editor
rules at 360px; existing marketing uses several independent breakpoints.

Lightweight refactor, documented before implementation: extract the existing
studio tokens/font-face and generic primitive styles into shared CSS imported
once by `index.css`. Keep the application shell layout in `studio.css`. Make
marketing and registration consume these tokens and existing StudioLink,
StudioButton and StudioCard components. Add only missing generic container,
section-heading, responsive-image and accordion primitives in the shared studio
component location. Dedicated hero/showcase/pricing are compositions, not new
generic button/card libraries. No dependencies or backend architecture changes.

Authentication routes remain `/account?mode=signup`, `/account?mode=signin`,
`/account?plan=pro` and the existing provider callbacks. The separately requested
login fix sends ordinary verified password/Google sign-ins to `/app`, retaining
explicit editor, account, Settings and billing tasks. Signup verification and
subscription confirmation remain authoritative.

`GET /api/product` supplies prices, trial eligibility display configuration,
store destination and per-plan flags from backend billing/entitlement code.
Free supports extension tracking, goals, recent history and non-AI Quick Prompt;
the built-in editor, private library/projects, full analytics and personalized AI
require verified paid access. The reference image's Free-editor claim will not
be published. No price or trial is invented when product data is unavailable.

Existing GA4 (`lib/analytics.ts`) suppresses private routes, previews, DNT/GPC and
credential URLs. Only allowlisted public CTA names/locations will extend it;
no private/signup/billing events are introduced without an existing supported
privacy boundary. No new vendor. Social links are omitted unless verified.

## Assets available — no new artwork required

- Official logo: `frontend/public/brand/unoword.svg`, used unchanged.
- Approved hero: `assets/studio/landscape-master.webp` and mobile landscape.
- All six approved covers exist: Mountain Sunrise, Forest Path, Lakeside
  Reflection, Open Notebook, Reading Corner and Tree and Horizon.
- Genuine Home, Editor, Ideas, Progress, Library and guidance captures are
  available from the shipped application browser fixtures. Public derivatives
  will use fictional sample writing, with provenance and no real account data.
  Captures illustrate actual UI, not invented controls or customer results.

The supplied visual reference guides composition and art direction. Its mock
product icons, logo approximation and unverified pricing claims are not reused.
Additional assets would only be needed for a different illustration or verified
social profile URLs; the redesign does not depend on either.

## Reusable creative prompt

> Design UnoWord's public landing page as the entrance to its existing Modern
> Writing Studio. Use the real application's shared Inter/Georgia typography,
> navy #102B55, primary blue #086BFF, sky #5DA9F6, cream #F8F2E8, soft white
> #F6F8FC and white surfaces through its semantic tokens and shared components.
> Preserve the official supplied logo exactly. Compose a generous editorial
> hero with the approved mountain sunrise, the headline “Your ideas deserve a
> place to grow.” and a visible Start Writing Free CTA. Follow the supplied
> section copy and visual reference with a forest-path story, calm tool cards,
> actual product screenshots, three simple steps, four illustrated audiences,
> authoritative Free/Pro pricing, privacy links, ten accessible FAQs and a
> spacious illustrated closing CTA. Keep authored writing distinct from AI
> guidance. Label sample screenshots honestly; never invent product UI or Free
> entitlements. Use 900px navigation and 1440/1024/768/390/320px review sizes.
> Preserve registration, billing, analytics privacy and all user data. Create a
> reviewable preview only; production deployment requires explicit approval.

Optional prompt for a future **additional** illustration, not needed here:

> Create a text-free watercolor illustration matching the supplied UnoWord
> mountain/forest/notebook art: textured warm cream paper, layered soft blue
> landscape, deep navy detail, gentle morning light, restrained golden accents.
> Keep the composition calm with ample cream negative space for interface copy.
> No logo, typography, interface, badge or photorealistic elements. Preserve the
> approved illustration family and deliver wide and portrait compositions.

## Review scope

Implementation, screenshots, CTA/SEO/analytics checks and the shared-token
regression results are recorded below. The redesign is not approved for
production deployment. Existing private writing and live payment/provider flows
will not be used as test data.

## Implemented foundation and components

`styles/studio-tokens.css` is the single color, semantic, font, spacing, radius,
shadow and typography source for `.uw-studio`, `.uw-site` and shared scopes.
It is imported once through `index.css`; the shell stylesheet retains layout.
`studio-primitives.css` supplies the common button/card/focus/skip-link rules.
Legacy `--uw-*` variables alias studio tokens so registration and information
pages share the foundation without replacing their handlers. Registration's
submit control now uses the existing StudioButton. Light/dark tokens remain
shared; the landing defaults to warm light and honors an explicitly saved dark
preference after hydration.

Reused: StudioButton, StudioLink, StudioCard, underlying Base UI Button and Card,
Brand (official SVG), Lucide icons, Product API hook, signup/Pro destination
constants, metadata/prerender pipeline and existing GA4 infrastructure.

New generic primitives in `StudioPrimitives.tsx`: StudioContainer,
StudioSectionHeading, StudioImage and StudioAccordion. There was no generic
accordion in the existing UI directory; native details/summary provides keyboard
and screen-reader behavior without another dependency. StudioShowcase and its
capture frames are marketing-specific compositions. No application dependency,
database migration, billing handler or entitlement definition was added.

All six approved illustration originals and the official SVG remain unchanged.
The six actual product captures have recorded provenance in
`assets/marketing/screenshots/provenance.json`. Only viewport cropping,
responsive resizing and WebP encoding were used. Captioned sample data is
fictional; no interface element was generated or composited. Responsive screenshot
sources use 640/960/1440px versions, approved artwork has smaller variants, and
below-fold images use lazy loading and lower fetch priority.

## CTA destinations and claims

| Action | Destination / behavior |
| --- | --- |
| Start Writing Free / Get Started Free | `/account?mode=signup`, including when a Chrome listing is configured |
| Explore Pro | `/account?plan=pro`; account confirmation and server billing remain authoritative |
| Sign In | `/account?mode=signin`; ordinary verified password/Google sign-in opens `/app` |
| Explore UnoWord | `#showcase` |
| Header sections | `#features`, `#how-it-works`, `#who-its-for`, `#pricing`, `#faq` |
| Feature shortcuts | Existing `#feature-0` through `#feature-5` sections |
| Privacy / Terms / Contact & Support | `/privacy`, `/terms`, `/support` |
| Full product capture | Fingerprinted full screenshot asset in a new tab, explicitly labeled |
| Chrome Web Store | Only the verified destination supplied by `/api/product`, in the footer |

No social profile URLs were verified in the repository, so none are invented.
Free does not advertise the built-in editor or private library. Pro prices,
trials, allowances and feature lists come from the existing product response.
The fixtures verify a changed currency/amount, unavailable billing, absent store
listing and failed product API; the page does not invent fallback benefits or
start any purchase. Features and FAQ distinguish non-AI Quick Prompt, paid
guidance, document permissions and authored writing. Published privacy links
remain authoritative; the page does not promise unsupported confidentiality or
universal editor compatibility.

## SEO and analytics

Title: **UnoWord | Build Your Writing Habit & Discover New Ideas**.

Description: **Meet UnoWord, your personal writing companion. Track your writing
progress, build consistency, and discover new ideas with thoughtful AI guidance.**

The requested keyword metadata, canonical `https://unoword.app/`, existing social
card, Open Graph/Twitter metadata and SoftwareApplication structured data remain
in the delivered HTML. No unverified price offers or testimonials are added to
structured data. The prerendered hero is present without JavaScript; SPA metadata
uses the same public title/description constants. Preview noindex and private
route exclusions are preserved.

Public GA4 `marketing_interaction` events contain only fixed `action`, `placement`
and `send_to` fields. Actions cover free CTAs, explore-product, Pro, screenshot
tabs and configured extension installation. Origin, DNT/GPC, sensitive URL and
private-route restrictions remain. No writing, account identifier, input value,
URL parameter or free-text label is sent. Signup-completion and paid-conversion
events were not introduced: the existing infrastructure deliberately suppresses
private auth/billing routes and has no verified conversion-event bridge. No new
analytics vendor or private-page collection is enabled.

## Validation and review

The production build/TypeScript checks pass. Lint retains four existing warnings.
The brand checker permits only the owner-approved campaign slogan spelling;
the product wordmark remains UnoWord everywhere else. No application dependency
or lockfile change was required; a temporary external formatter was used only
as a development tool.

Browser regressions cover the landing, shared shell/Home/Ideas/Progress/Library/
Settings, full writing workspace, password destinations, Google callbacks,
verified email signup, account/billing confirmation, secure callbacks, canonical
domain recovery and analytics privacy. The legacy combined marketing test now
delegates public assertions to the updated landing suite and retains its actual
account, legal/support and missing-page checks, replacing obsolete mock-demo
assertions. Extension archive and canonical-domain contract checks also pass.

Landing checks cover 1440/1024/768/390/320px, no horizontal overflow, first-viewport
hero CTAs, mobile menu closure/Escape/focus, tab arrow/Home/End navigation, real
screenshot loading, native FAQ keyboard behavior, current plan data and failure
states. Targeted axe WCAG A/AA scans pass in light/dark. Screenshots are reviewed
separately from those automated results; automated axe is not certification.

Local lab measurements use the production bundle at 390×844, 4× CPU slowdown,
150ms/1.6Mbps networking, a cold browser cache and a synthetic product API.
The fixture server serves uncompressed assets; these are not production field
Web Vitals. After responsive-image optimization, an isolated sample measured
LCP/FCP at **2.72 seconds**, no observed layout shift, and **681,574 transferred
bytes**. Before those changes, samples ranged from 3.3–4.9 seconds and about
885KB while other tests were running; the figures are not a controlled field
comparison. Responsive sources reduce actual image transfer and preserve
the full-resolution originals for viewing. Raw observations are in ignored
`tests/artifacts/marketing/performance.json`. Physical Safari/iPad behavior, real
registration mail, live Stripe transactions and actual GA4 conversion ingestion
were not tested or claimed. Existing authenticated regression fixtures never
operate on production user data.

Review locally from this branch:

```sh
cd frontend
npm ci
npm run build
npm run preview -- --host 0.0.0.0
```

Open the preview URL, inspect `/` at the five requested widths, use the menu,
showcase and FAQs, and follow signup/Pro links. Use fictional data; real account
and payment actions are not needed to review the design. The shared application
pages remain available at `/app`, `/editor`, `/ideas`, `/progress` and `/library`.

With Playwright/Chromium and the test dependencies installed, automated commands
include `node tests/run-redesign-regression.cjs web landing,login-redirect,google-oauth,email-signup,account-billing,analytics,domain-migration`,
`node tests/run-redesign-regression.cjs editor workspace` and
`node tests/marketing-performance.browser.cjs`. Runtime path overrides follow
the Phase 8 documentation. Set `AXE_SCRIPT` for the optional axe checks.

Production deployment remains explicitly unapproved, including the accompanying
login-to-Home fix. Review the branch/PR and screenshots before requesting deployment.

Committed review captures: [desktop](review/marketing/desktop.webp) and
[mobile](review/marketing/mobile.webp). The screenshots use the isolated public
product fixture, not a production account or a live payment. Full-page captures
wait for lazy images so the artwork appears as it does after scrolling.

Principal files changed: `Home.tsx`, `StudioShowcase.tsx`, `Account.tsx`,
`StudioPrimitives.tsx`, `studio-tokens.css`, `studio-primitives.css`, `studio.css`,
`marketing.css`, `landing.css`, `account.css`, `index.css`, `index.html`,
`PageMetadata.tsx`, `public-metadata.ts`, `product-screens.ts`, `analytics.ts`,
the brand checker, browser regressions and the approved-art/screenshot derivatives.
The PR’s Files changed view provides the exact manifest. Backend/provider handlers,
entitlement/price configuration, official logo and the 0.24.2 extension archive
are unchanged.
