import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const titles: Record<string, string> = {
  "/lifetime": "UnoWord Pro — $100 Lifetime Deal",
  "/": "UnoWord — AI Writing Editor, Word Counter & Writing Companion",
  "/account": "Your account — UnoWord",
  "/account/security": "Account & Security — UnoWord",
  "/editor": "Your writing space — UnoWord",
  "/privacy": "Privacy & data — UnoWord",
  "/terms": "Terms of service — UnoWord",
  "/support": "Support — UnoWord",
};
export default function PageMetadata() {
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  useEffect(() => {
    document.title =
      titles[pathname] ||
      (pathname.startsWith("/admin")
        ? "Admin — UnoWord"
        : "Page not found — UnoWord");
    const publicDescription =
      pathname === "/lifetime"
        ? "Explore UnoWord Pro’s $100 USD lifetime offer for the first 25 purchasers. Includes Pro writing tools, daily AI limits, and a 14-day refund policy."
        : pathname === "/"
          ? "Write, track progress, and discover personalized AI ideas with UnoWord. Create documents, build writing habits, and stay inspired with our writing editor and Chrome extension."
          : null;
    if (publicDescription)
      for (const selector of [
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
      ]) {
        const meta = document.querySelector<HTMLMetaElement>(selector);
        if (meta) meta.content = publicDescription;
      }
    if (pathname === "/" || pathname === "/lifetime")
      for (const selector of [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]) {
        const meta = document.querySelector<HTMLMetaElement>(selector);
        if (meta) meta.content = titles[pathname];
      }
    const robots = document.querySelector<HTMLMetaElement>(
      'meta[name="robots"]',
    );
    // A preview deployment's noindex directive must survive client navigation.
    if (robots && !robots.dataset.deploymentPolicy)
      robots.dataset.deploymentPolicy = robots.content;
    if (robots)
      robots.content =
        robots.dataset.deploymentPolicy?.startsWith("noindex") ||
        pathname.startsWith("/account") ||
        pathname === "/editor" ||
        pathname.startsWith("/admin") ||
        pathname === "/terms" ||
        !titles[pathname]
          ? "noindex, nofollow"
          : "index, follow";
    const canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (canonical) canonical.href = new URL(pathname, canonical.href).href;
  }, [pathname]);
  return null;
}
