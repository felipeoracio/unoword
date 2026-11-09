// Only public, fixed page names belong in analytics; never use document.title.
const pages: Record<string, string> = {
  "/": "UnoWord — Your Words. Your Voice. Your Story.",
  "/lifetime": "UnoWord Pro — Lifetime Offer",
  "/privacy": "Privacy & data — UnoWord",
  "/terms": "Terms of service — UnoWord",
  "/support": "Support — UnoWord",
};
const origin = "https://unoword.app";
const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID ?? "G-H6H51HNY32";
const sensitive = /^(?:code|flow|token_hash|access_token|refresh_token|email|password|oauth|error|error_description|type)$/i;
type AnalyticsWindow = Window & {
  dataLayer?: IArguments[];
  gtag?: (...args: unknown[]) => void;
};
let installed = false;
let started = false;
let lastPage: string | null = null;

function disabled(value: boolean) {
  (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = value;
}
function enabled() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return import.meta.env.PROD && import.meta.env.VITE_ANALYTICS_ENABLED !== "false"
    && /^G-[A-Z0-9]+$/.test(measurementId) && window.location.origin === origin
    && nav.doNotTrack !== "1" && nav.globalPrivacyControl !== true;
}
function pageFor(url: URL) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (url.origin !== origin || !Object.hasOwn(pages, path)
    || [...url.searchParams.keys()].some(key => sensitive.test(key))
    || url.hash.includes("=")) return null;
  return path;
}
function safeReferrer() {
  try {
    const referrer = new URL(document.referrer);
    if (!/^https?:$/.test(referrer.protocol)) return "";
    if (referrer.origin !== origin) return referrer.origin + "/";
    const path = pageFor(referrer);
    return path ? origin + path : "";
  } catch { return ""; }
}

export function initializeAnalytics() {
  if (installed || !enabled()) return;
  installed = true;
  // Pause collection during history changes, before Google's history handlers
  // or React can expose a new URL. The route effect resumes public pages only.
  const guard = (url: URL) => {
    const privatePage = pageFor(url) === null;
    disabled(true);
    if (privatePage) lastPage = null;
  };
  guard(new URL(window.location.href));
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (data, unused, url) {
      if (url != null) guard(new URL(String(url), window.location.href));
      return original.call(this, data, unused, url);
    };
  }
  window.addEventListener("popstate", () => guard(new URL(window.location.href)), true);
  window.addEventListener("hashchange", () => guard(new URL(window.location.href)), true);
}

export function trackPublicPage() {
  if (!enabled()) { disabled(true); return; }
  initializeAnalytics();
  const path = pageFor(new URL(window.location.href));
  if (path === null) { disabled(true); lastPage = null; return; }
  disabled(false);
  if (lastPage === path) return; // StrictMode, rerenders and section anchors.
  const previous = lastPage;
  lastPage = path;
  const w = window as AnalyticsWindow;
  if (!started) {
    started = true;
    w.dataLayer = w.dataLayer || [];
    w.gtag = function () { w.dataLayer!.push(arguments); };
    w.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    w.gtag("set", {
      send_page_view: false,
      page_location: origin + path,
      page_title: pages[path],
      page_referrer: safeReferrer(),
    });
    w.gtag("js", new Date());
    w.gtag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: origin + path,
      page_title: pages[path],
      page_referrer: safeReferrer(),
      cookie_flags: "SameSite=Lax;Secure",
    });
    const script = document.createElement("script");
    script.id = "unoword-google-analytics";
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.append(script);
  }
  const page = {
    page_location: origin + path,
    page_title: pages[path],
    page_referrer: previous ? origin + previous : safeReferrer(),
  };
  w.gtag?.("set", page);
  w.gtag?.("event", "page_view", {
    send_to: measurementId,
    ...page,
  });
}
