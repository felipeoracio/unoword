import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const titles: Record<string, string> = {
  "/": "Uno Word — AI Writing Companion & Word Counter",
  "/account": "Your account — Uno Word",
  "/account/security": "Account & Security — Uno Word",
  "/editor": "Your writing space — Uno Word",
  "/privacy": "Privacy & data — Uno Word",
  "/terms": "Terms of service — Uno Word",
  "/support": "Support — Uno Word",
};
export default function PageMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title =
      titles[pathname] ||
      (pathname.startsWith("/admin")
        ? "Admin — Uno Word"
        : "Page not found — Uno Word");
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
