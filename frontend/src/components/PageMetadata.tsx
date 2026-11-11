import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPublicPage } from "@/lib/analytics";
import { LANDING_TITLE, LANDING_DESCRIPTION } from "@/lib/public-metadata";

const titles: Record<string, string> = {
  "/": LANDING_TITLE,
  "/account": "Your account — UnoWord",
  "/app": "Your writing studio — UnoWord",
  "/ideas": "Writing ideas — UnoWord",
  "/progress": "Writing progress — UnoWord",
  "/account/security": "Account & Security — UnoWord",
  "/editor": "Your writing space — UnoWord",
  "/projects": "Your projects — UnoWord",
  "/library": "Your library — UnoWord",
  "/settings": "Settings — UnoWord",
  "/rewards": "Writing rewards — UnoWord",
  "/privacy": "Privacy & data — UnoWord",
  "/terms": "Terms of service — UnoWord",
  "/support": "Support — UnoWord",
};
export default function PageMetadata() {
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  useEffect(() => { trackPublicPage(); }, [location.key]);
  useEffect(() => {
    document.title =
      titles[pathname] ||
      (pathname.startsWith("/admin")
        ? "Admin — UnoWord"
        : "Page not found — UnoWord");
    const publicDescription =
      pathname === "/"
          ? LANDING_DESCRIPTION
          : pathname === "/privacy"
            ? "Privacy and data practices for UnoWord writing, accounts, and cloud features."
            : pathname === "/support"
              ? "Installation, account help, and recovery of offline writing for UnoWord."
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
    if (titles[pathname])
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
        pathname === "/app" ||
        pathname === "/ideas" ||
        pathname === "/progress" ||
        pathname === "/editor" ||
        pathname === "/projects" ||
        pathname === "/library" ||
        pathname === "/settings" ||
        pathname === "/rewards" ||
        pathname.startsWith("/admin") ||
        pathname === "/terms" ||
        !titles[pathname]
          ? "noindex, nofollow"
          : "index, follow";
    const canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (canonical) canonical.href = new URL(pathname, canonical.href).href;
    const socialUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (socialUrl && canonical) socialUrl.content = canonical.href;
  }, [pathname]);
  return null;
}
