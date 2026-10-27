// A provider email returns to the public Site URL. Read only known auth fields;
// never accept access/refresh tokens from URL fragments or provider error text.
export function emailConfirmationRequest() {
  if (typeof window === "undefined" || window.location.pathname !== "/")
    return { code: "", invalid: false };
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.slice(1));
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
