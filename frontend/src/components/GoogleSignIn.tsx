import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api";
export default function GoogleSignIn({
  intent,
  busy,
  setBusy,
  onError,
}: {
  intent: "account" | "pro" | "lifetime" | "editor";
  busy: boolean;
  setBusy: (value: boolean) => void;
  onError: (message: string) => void;
}) {
  const provider = useQuery({
    queryKey: ["google-oauth-configuration"],
    queryFn: () => apiGet<{ enabled: boolean }>("/auth/google"),
    staleTime: 30000,
    retry: 1,
  });
  async function start() {
    if (busy || !provider.data?.enabled) return;
    setBusy(true);
    onError("");
    try {
      const result = await apiPost<{ url: string }>("/auth/google/start", {
        intent,
      });
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        !url.pathname.endsWith("/auth/v1/authorize") ||
        url.searchParams.get("provider") !== "google"
      )
        throw new Error("Invalid Google authorization URL");
      window.location.assign(url.href);
    } catch (error) {
      onError(
        error instanceof ApiError && error.status === 429
          ? "Too many sign-in attempts. Please wait a minute and retry."
          : error instanceof ApiError &&
              (error.body as { detail?: string })?.detail ===
                "google_oauth_not_configured"
            ? "Google sign-in is not available yet. Please use email and password."
            : "Google sign-in could not be opened. Please retry or use email and password.",
      );
      setBusy(false);
    }
  }
  return (
    <div className="uw-google-signin">
      <button
        type="button"
        className="uw-google-button"
        disabled={busy || !provider.data?.enabled}
        onClick={() => void start()}
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.86 46.98 24.55Z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.94 7.53 2.56 10.78l7.97-6.19Z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
          />
        </svg>
        Continue with Google
      </button>
      {provider.isLoading ? (
        <p className="uw-google-status" role="status">
          Checking Google sign-in…
        </p>
      ) : !provider.data?.enabled ? (
        <p className="uw-google-status">
          Google sign-in isn’t available yet. Email sign-in is available below.
        </p>
      ) : (
        <p className="uw-google-status">
          Use Google to sign in or create your UnoWord account.
        </p>
      )}
      <div className="uw-auth-divider">
        <span>or continue with email</span>
      </div>
    </div>
  );
}
