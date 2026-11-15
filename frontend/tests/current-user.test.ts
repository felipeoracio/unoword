import { afterEach, expect, it, vi } from "vitest";
import { currentUser } from "../src/lib/current-user";
import { ApiError, apiGet } from "../src/lib/api";

const user = { id: "verified-owner", email: "writer@example.com", plan: "pro", ai_access: true };
const response = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("keeps a verified paid identity without rotating tokens", async () => {
  const fetch = vi.fn().mockResolvedValue(response(200, user)); vi.stubGlobal("fetch", fetch);
  expect(await currentUser()).toEqual(user); expect(fetch).toHaveBeenCalledTimes(1);
});
it("refreshes an expired access token and verifies the resulting identity", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(200, user)); vi.stubGlobal("fetch", fetch);
  expect(await currentUser()).toEqual(user);
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["/api/auth/me", "/api/auth/refresh", "/api/auth/me"]);
});
it("treats rejection after a successful refresh as signed out without looping", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(401)); vi.stubGlobal("fetch", fetch);
  expect(await currentUser()).toBeNull(); expect(fetch).toHaveBeenCalledTimes(3);
});
it.each([400, 401, 403])("treats refresh rejection %i as signed out", async status => {
  const fetch = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(status)); vi.stubGlobal("fetch", fetch);
  expect(await currentUser()).toBeNull(); expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([502, 503, 504])("preserves refresh outage %i as a service error, not a signed-out identity", async status => {
  const fetch = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(status, { detail: "temporarily_unavailable" })); vi.stubGlobal("fetch", fetch);
  await expect(currentUser()).rejects.toMatchObject({ status }); expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not rotate refresh tokens when account lookup has a database outage", async () => {
  const fetch = vi.fn().mockResolvedValue(response(502)); vi.stubGlobal("fetch", fetch);
  await expect(currentUser()).rejects.toBeInstanceOf(ApiError); expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps network failures retryable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));
  await expect(currentUser()).rejects.toBeInstanceOf(TypeError);
});
it("shares one refresh between simultaneous account and protected-API checks", async () => {
  let valid = false, release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const fetch = vi.fn(async (url: string) => {
    if (url === "/api/auth/refresh") { await held; valid = true; return response(200); }
    if (!valid) return response(401);
    return response(200, url === "/api/auth/me" ? user : { private: "verified" });
  }); vi.stubGlobal("fetch", fetch);
  const all = Promise.all([currentUser(), currentUser(), apiGet("/workspace/documents")]);
  await vi.waitFor(() => expect(fetch.mock.calls.filter(call => call[0] === "/api/auth/refresh")).toHaveLength(1));
  release(); expect(await all).toEqual([user, user, { private: "verified" }]);
  expect(fetch.mock.calls.filter(call => call[0] === "/api/auth/refresh")).toHaveLength(1);
});
