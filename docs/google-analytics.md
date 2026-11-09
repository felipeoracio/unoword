# Google Analytics 4

Public production pages use measurement ID **G-H6H51HNY32**. This ID is public;
there is no Analytics secret in the browser or repository. Deployment supplies
the integration automatically; no Vercel setting is required for this property.

## Google Analytics dashboard setting

In Analytics → Admin → Data streams → UnoWord Web stream, turn **Enhanced
measurement off**. UnoWord sends explicit public page views for React navigation.
Disabling Google's automatic history, form, click and search tracking prevents
duplicate page views and avoids collecting uncontrolled URL/DOM values.
This dashboard setting is separate from code deployment and requires the
property owner's access. Do not add a second Google tag via Tag Manager or HTML.

Open Reports → Realtime, then visit https://unoword.app/ and navigate to Support.
Expect one page view per public-page navigation; section anchors and React
rerenders do not add page views. Tracking blockers and Do Not Track/Global
Privacy Control may suppress your test visit. Standard reports can take
24–48 hours to populate. No private Google reports are available to Codex.

## Collection boundaries

Only `/`, `/privacy`, `/terms`, and `/support` are allowlisted, with
fixed titles. Queries/fragments never appear in explicit page-view parameters.
Authentication callback/credential parameters suppress tracking. Referrers are
reduced to an external origin or an allowlisted internal path. Editor, account,
rewards, admin and unknown paths do not load the tag on a direct visit. A history
guard disables collection before a private route is entered, including back and
forward navigation; explicit page views resume on public pages.

No user IDs, document titles/content, emails, AI inputs/outputs, checkout session
IDs, subscription data or purchase events are sent. Google Signals and ad
personalization signals are disabled; ad storage, ad user data and ad
personalization consent defaults are denied. A successful billing redirect is never
recorded as a purchase. The extension and native application are unchanged.

The production build runs analytics only at `https://unoword.app`; localhost,
Preview and legacy hosts are excluded. `VITE_ANALYTICS_ENABLED=false` disables
the integration after rebuilding. `VITE_GA_MEASUREMENT_ID` can override the public
default (an empty value disables it). These are public build-time settings.

