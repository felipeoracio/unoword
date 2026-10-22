// Session boundary: auth is an httpOnly cookie the backend owns; the frontend's one
// duty is wiping the react-query cache so one account's data never renders for the next.
import { queryClient } from "./queryClient";
import { apiPost } from "./api";

// Call after every successful login/signup.
export function beginSession(): void {
  localStorage.removeItem("uno-writing-identity");
  queryClient.clear();
}

// Call from every sign-out control; the hard redirect resets all in-memory state.
export async function endSession(redirectTo: string = "/login"): Promise<void> {
  localStorage.removeItem("uno-writing-identity");
  try {
    await apiPost("/auth/logout");
  } finally {
    queryClient.clear();
    window.location.assign(redirectTo);
  }
}
