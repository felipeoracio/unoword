import { ApiError, apiGet, refreshSession } from "./api";
import type { AuthUser } from "./auth-types";

/** Only an authentication rejection means signed out. Outages remain retryable. */
export async function currentUser(): Promise<AuthUser | null> {
  try {
    return await apiGet<AuthUser>("/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  // Share token rotation with concurrent account/editor/API checks.
  if (!(await refreshSession())) return null;
  try {
    return await apiGet<AuthUser>("/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
