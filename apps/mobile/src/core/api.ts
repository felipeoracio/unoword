import type { Transport } from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : `Request failed (${status})`);
  }
}
export function createTransport(
  base: string,
  identity: () => { id: string; token: string } | null,
  refresh: () => Promise<void>,
  fetcher: typeof fetch = fetch,
): Transport {
  return async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const initial = identity();
    if (!initial) throw new ApiError(401, "Sign in to continue.");
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("Invalid API path");
    for (let retry = 0; retry < 2; retry++) {
      const current = identity();
      if (!current || current.id !== initial.id)
        throw new ApiError(409, "account_changed");
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        path === "/ai/suggestion" || path === "/workspace/assistant"
          ? 125000
          : 20000,
      );
      let response: Response;
      try {
        response = await fetcher(base + path, {
          method,
          signal: controller.signal,
          credentials: "omit",
          headers: {
            Authorization: "Bearer " + current.token,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } finally {
        clearTimeout(timeout);
      }
      if (identity()?.id !== initial.id)
        throw new ApiError(409, "account_changed");
      if (response.status === 401 && !retry) {
        await refresh();
        continue;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new ApiError(response.status, data?.detail);
      }
      return response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T);
    }
    throw new ApiError(401, "Sign in again. Your local writing is preserved.");
  };
}
export function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return "A newer version exists. Your local changes are preserved.";
    if (error.status === 401)
      return "Sign in again. Your local writing is preserved.";
    if (error.status === 403) return "This action requires current Pro access.";
    if (error.status === 429 || String(error.detail).startsWith("ai_limit_"))
      return "Your AI allowance is reached. Quick Prompt is still available.";
    if (error.status === 413)
      return "This document is too large to save. Your local copy is preserved.";
    if (error.status === 422)
      return "Check the request and try again. Your writing is preserved.";
  }
  return "Could not connect. Your changes remain on this device.";
}

/** An old screen/outbox must not send its data after another account signs in. */
export function bindOwner(
  owner: string | undefined,
  currentOwner: () => string | undefined,
  transport: Transport,
): Transport {
  return async (method, path, body) => {
    if (!owner || currentOwner() !== owner)
      throw new ApiError(409, "account_changed");
    return transport(method, path, body);
  };
}
