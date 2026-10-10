// Admin API client. Session rides the HttpOnly `uno_admin` cookie (credentials:include).
const BASE = "/api/admin";

export class AdminError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`admin request failed with ${status}`);
    this.name = "AdminError";
    this.status = status;
    this.body = body;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => null);
    throw new AdminError(res.status, b);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const adminGet = <T>(path: string) => req<T>("GET", path);
export const adminPost = <T>(path: string, body?: unknown) => req<T>("POST", path, body ?? null);
export const adminDelete = <T>(path: string) => req<T>("DELETE", path);

export function errorText(e: unknown): string {
  if (e instanceof AdminError) {
    const d = (e.body as { detail?: unknown } | null)?.detail;
    if (typeof d === "string") return d;
  }
  return "Something went wrong. Please try again.";
}
