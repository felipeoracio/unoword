import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const titles: Record<string, string> = {
  "/lifetime": "UnoWord Pro — $100 Lifetime Deal",
  "/": "UnoWord — Your Words. Your Voice. Your Story.",
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
          ? "Build better writing habits with UnoWord. Track daily goals for free, unlock unlimited streaks, and overcome writer's block with personalized AI guidance in Pro."
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
        if (meta) meta.content = pathname === "/" ? "Your Words. Your Voice. Your Story. | UnoWord" : titles[pathname];
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
