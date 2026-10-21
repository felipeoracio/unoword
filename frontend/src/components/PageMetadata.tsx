import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const titles: Record<string, string> = {
  "/": "UnoWord — AI Writing Companion & Word Counter",
  "/account": "Your account — UnoWord",
  "/account/security": "Account & Security — UnoWord",
  "/privacy": "Privacy & data — UnoWord",
  "/terms": "Terms of service — UnoWord",
  "/support": "Support — UnoWord",
};
export default function PageMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title =
      titles[pathname] ||
      (pathname.startsWith("/admin")
        ? "Admin — UnoWord"
        : "Page not found — UnoWord");
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
