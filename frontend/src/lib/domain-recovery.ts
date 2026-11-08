// An explicit old-origin workspace keeps unsynced browser drafts recoverable.
export const LEGACY_ORIGINS = ["https://unoword.vercel.app", "https://www.unoword.app"];
export function legacyRecovery() {
  return typeof window !== "undefined" && LEGACY_ORIGINS.includes(window.location.origin)
    && new URLSearchParams(window.location.search).get("domain_recovery") === "1";
}
export function recoveryPath(path: string) {
  if (!legacyRecovery()) return path;
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin) return path;
  url.searchParams.set("domain_recovery", "1");
  return url.pathname + url.search + url.hash;
}
