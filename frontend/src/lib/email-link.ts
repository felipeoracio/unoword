// A provider email returns to the public Site URL. Read only known auth fields;
// never accept access/refresh tokens from URL fragments or provider error text.
export function emailConfirmationRequest(location?: {
  pathname: string;
  search: string;
  hash: string;
}) {
  const source =
    location || (typeof window === "undefined" ? undefined : window.location);
  if (!source || source.pathname !== "/") return { code: "", invalid: false };
  const query = new URLSearchParams(source.search);
  const fragment = new URLSearchParams(source.hash.slice(1));
  return {
    code: query.get("code") || "",
    invalid:
      query.has("error") ||
      query.has("error_code") ||
      query.has("access_token") ||
      query.has("refresh_token") ||
      fragment.has("error") ||
      fragment.has("error_code") ||
      fragment.has("access_token") ||
      fragment.has("refresh_token"),
  };
}
