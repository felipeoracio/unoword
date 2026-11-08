export const PRIMARY_API_URL = "https://unoword.app/api";
const LEGACY_API_URLS = ["https://unoword.vercel.app/api", "https://www.unoword.app/api"];
export function apiBase(configured?: string) {
  const value = (configured || PRIMARY_API_URL).trim().replace(/\/+$/, "");
  return LEGACY_API_URLS.includes(value) ? PRIMARY_API_URL : value;
}
export async function cachedPublicConnection(api: string, read: (key: string) => Promise<string | null>) {
  const origins = api === PRIMARY_API_URL ? [api, ...LEGACY_API_URLS] : [api];
  for (const origin of origins) {
    const cached = await read("uno.mobile.public-config:" + origin);
    if (cached) return cached;
  }
  return null;
}
