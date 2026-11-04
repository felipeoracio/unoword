import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { Repository } from "../src/core/repository";
import { ApiError, createTransport, bindOwner } from "../src/core/api";
import { seal, unseal } from "../src/core/encryption";
import {
  newActivity,
  checkpoint,
  transition,
  restoreActivity,
  applyInput,
  crossesDay,
} from "../src/core/session";
import { WriterSessions } from "../src/core/writer-sessions";
import { documentToReopen, bodyText, safeBody } from "../src/core/document";
import { words, prompts, clock } from "../src/core/engines";
import type { Store, Transport, Document, Activity } from "../src/core/types";
function store(): Store {
  const values = new Map<string, string>();
  return {
    async get<T>(key: string) {
      return values.has(key)
        ? JSON.parse(values.get(key)!)
        : (null as T | null);
    },
    async set(key, value) {
      values.set(key, JSON.stringify(value));
    },
    async remove(key) {
      values.delete(key);
    },
  };
}
function fixture() {
  const docs = new Map<string, Document>(),
    activities = new Map<string, Activity>(),
    folders = new Map<string, any>();
  let offline = false,
    paid = true;
  const owner = randomUUID();
  let prefs = {
    user_id: owner,
    revision: 0,
    daily_goal: 1000,
    timezone: "America/Chicago",
    themes: ["ideas"],
    language: "en",
  };
  const api: Transport = async (method, path, body: any) => {
    if (offline) throw new TypeError("offline");
    if (body?.expected_user_id && body.expected_user_id !== owner)
      throw new ApiError(409, "account_changed");
    if (path === "/progress/preferences") {
      if (method === "GET") return structuredClone(prefs) as any;
      if ("patch" in body) throw new ApiError(422, "extra_fields");
      if (body.revision !== prefs.revision)
        throw new ApiError(409, "preferences_changed");
      prefs = {
        ...prefs,
        ...body.patch,
        ...body,
        revision: prefs.revision + 1,
      };
      return structuredClone(prefs) as any;
    }
    if (path.startsWith("/progress/summary"))
      return {
        user_id: owner,
        dailyWordCount: [...activities.values()].reduce(
          (n, a) => n + a.typed_words,
          0,
        ),
        dailyActiveWritingSeconds: [...activities.values()].reduce(
          (n, a) => n + a.duration_seconds,
          0,
        ),
        dailyGoal: prefs.daily_goal,
        timezone: prefs.timezone,
        reportingDate: "2026-11-03",
        displayedStreak: paid ? 15 : 7,
        sessions: [],
        dailyGoalProgress: 0,
        lifetimeWordCount: 0,
        lifetimeActiveWritingSeconds: 0,
        updatedAt: new Date().toISOString(),
      } as any;
    if (path.startsWith("/workspace/")) {
      if (!paid) throw new ApiError(403, "writing_workspace_pro_required");
      if (path === "/workspace/activity") {
        const old = activities.get(body.id);
        if (!old || old.sequence < body.sequence)
          activities.set(body.id, structuredClone(body));
        return {} as any;
      }
      if (path === "/workspace/folders") return [...folders.values()] as any;
      if (path.startsWith("/workspace/folders/")) {
        const id = path.split("/").pop()!;
        folders.set(id, { id, name: body.name, user_id: owner });
        return folders.get(id);
      }
      if (path.startsWith("/workspace/documents?"))
        return [...docs.values()].map(
          ({ content, plain_text, ...meta }) => meta,
        ) as any;
      const id = path.split("/").pop()!;
      if (method === "GET") {
        if (!docs.has(id)) throw new ApiError(404, "document_not_found");
        return structuredClone(docs.get(id)) as any;
      }
      const old = docs.get(id);
      if (old?.mutation_id === body.mutation_id)
        return structuredClone(old) as any;
      if ((old?.revision || 0) !== body.revision)
        throw new ApiError(409, "revision_conflict");
      const value = {
        id,
        user_id: owner,
        created_at: old?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...body,
        revision: (old?.revision || 0) + 1,
        plain_text: bodyText(body.content),
      };
      docs.set(id, value);
      return structuredClone(value) as any;
    }
    throw Error("Unexpected route " + path);
  };
  const local = store();
  const repo = new Repository(owner, local, api, randomUUID);
  return {
    repo,
    api,
    local,
    owner,
    docs,
    activities,
    offline(value: boolean) {
      offline = value;
    },
    paid(value: boolean) {
      paid = value;
    },
    advanceGoal() {
      prefs = { ...prefs, revision: prefs.revision + 1, daily_goal: 500 };
    },
  };
}
const paragraph = (text: string) => ({
  type: "doc",
  attrs: { subtitle: "A subtitle" },
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text, marks: [{ type: "bold" }] }],
    },
  ],
});
test("native client reuses exact tokenizer, prompt bank, and paste protection", () => {
  assert.equal(words.countWords("I don’t well-known 25 !!!"), 4);
  const delta = words.classifyDelta("one", "one two three", "insertFromPaste");
  assert.equal(delta?.kind, "pasted");
  assert.ok(prompts.pickPrompt(["ideas"], "en", []).text);
  assert.ok(prompts.pickPrompt(["ideas"], "es", []).text);
});
test("twenty active + five paused + fifteen active preserves 35 session minutes", () => {
  const start = Date.UTC(2026, 10, 3, 10);
  let row = newActivity(randomUUID(), "ios-test", randomUUID, start);
  // Qualifying input keeps the existing five-minute grace alive.
  for (let i = 1; i <= 20; i++) {
    row = applyInput(row, "word", "word next", "insertText", start + i * 60000);
    row = checkpoint(row, start + i * 60000);
  }
  row = transition(row, "paused", start + 20 * 60000);
  row = transition(row, "active", start + 25 * 60000);
  for (let i = 26; i <= 40; i++) {
    row = applyInput(row, "word", "word next", "insertText", start + i * 60000);
    row = checkpoint(row, start + i * 60000);
  }
  row = transition(row, "ended", start + 40 * 60000);
  assert.equal(row.duration_seconds, 35 * 60);
  assert.equal(row.timer.paused_ms, 5 * 60000);
  assert.equal(row.active_intervals.length, 2);
  assert.equal(
    row.active_intervals.reduce((n, [a, b]) => n + b - a, 0),
    35 * 60000,
  );
});
test("idle and background gaps are excluded; a restored session starts paused", () => {
  const start = Date.UTC(2026, 10, 3, 10);
  let row = newActivity(randomUUID(), "ios-test", randomUUID, start);
  row = checkpoint(row, start + 600000);
  assert.equal(row.timer.status, "paused");
  assert.equal(row.duration_seconds, 300);
  const active = checkpoint(
    newActivity(randomUUID(), "ios-test", randomUUID, start),
    start + 60000,
  );
  const restored = restoreActivity(active);
  assert.equal(restored.timer.status, "paused");
  assert.equal(clock.read(restored.timer, start + 86400000).active_ms, 60000);
});
test("midnight and DST reporting use the existing timezone engine", () => {
  const row = newActivity(
    randomUUID(),
    "ios-test",
    randomUUID,
    Date.parse("2026-11-02T05:59:59Z"),
  );
  assert.equal(
    crossesDay(row, "America/Chicago", Date.parse("2026-11-02T06:00:01Z")),
    true,
  );
  const fallback = newActivity(
    randomUUID(),
    "ios-test",
    randomUUID,
    Date.parse("2026-11-01T06:30:00Z"),
  );
  assert.equal(
    crossesDay(fallback, "America/Chicago", Date.parse("2026-11-01T07:30:00Z")),
    false,
  );
});
test("image/subtitle/marks survive save and reopen; only body text counts", async () => {
  const f = fixture();
  await f.repo.load();
  const content = paragraph("A real writing draft");
  content.content.push({
    type: "image",
    attrs: {
      src: "data:image/png;base64,AAAA",
      alt: "Not counted",
      width: 1,
      height: 1,
    },
  } as any);
  const doc = await f.repo.create("Native doc", content);
  await f.repo.sync(true);
  const second = new Repository(f.owner, f.local, f.api, randomUUID);
  await second.load();
  const reopened = await second.open(doc.id);
  assert.deepEqual(reopened?.content, content);
  assert.equal(reopened?.plain_text, "A real writing draft\n");
  assert.equal(f.activities.size, 0);
  assert.equal(f.repo.status, "Synced");
});
test("offline document and folder survive restart and reconnect once", async () => {
  const f = fixture();
  await f.repo.load();
  f.offline(true);
  const folder = await f.repo.createFolder("My writing");
  const doc = await f.repo.create(
    "Offline",
    paragraph("Saved offline"),
    folder.id,
  );
  await f.repo.sync(true);
  assert.equal(f.repo.status, "Offline · Pending Sync");
  const restarted = new Repository(f.owner, f.local, f.api, randomUUID);
  await restarted.load();
  assert.equal(
    (await restarted.getDocument(doc.id))?.content.content?.[0].content?.[0]
      .text,
    "Saved offline",
  );
  f.offline(false);
  await restarted.sync(true);
  assert.equal(f.docs.size, 1);
  assert.equal(restarted.folders.length, 1);
  assert.equal(restarted.folders[0].dirty, undefined);
  await restarted.sync(true);
  assert.equal(f.docs.get(doc.id)?.revision, 1);
});
test("edits made during an in-flight save keep the new draft and advance its base revision", async () => {
  const f = fixture();
  await f.repo.load();
  const doc = await f.repo.create("First", paragraph("initial"));
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    start = new Promise<void>((r) => (entered = r));
  const wrapped: Transport = async (m, p, b) => {
    if (m === "PUT" && p.includes("/documents/")) {
      entered();
      await gate;
    }
    return f.api(m, p, b);
  };
  const repo = new Repository(f.owner, f.local, wrapped, randomUUID);
  await repo.load();
  const saving = repo.sync(true);
  await start;
  await repo.edit(doc.id, { content: paragraph("newer typing while saving") });
  release();
  await saving;
  const pending = await repo.getDocument(doc.id);
  assert.equal(pending?.dirty, true);
  assert.equal(pending?.revision, 1);
  assert.equal(pending?.plain_text, "newer typing while saving");
  await repo.sync(true);
  assert.equal(f.docs.get(doc.id)?.plain_text, "newer typing while saving");
  assert.equal(f.docs.get(doc.id)?.revision, 2);
});
test("lost save acknowledgement retries its mutation ID without an extra revision", async () => {
  const f = fixture();
  await f.repo.load();
  const doc = await f.repo.create("Retry", paragraph("Keep it"));
  let lost = true;
  const api: Transport = async (m, p, b) => {
    const result = await f.api(m, p, b);
    if (lost && m === "PUT" && p.includes("/documents/")) {
      lost = false;
      throw new TypeError("lost response");
    }
    return result;
  };
  const repo = new Repository(f.owner, f.local, api, randomUUID);
  await repo.load();
  await repo.sync(true);
  assert.equal((await repo.getDocument(doc.id))?.dirty, true);
  await repo.sync(true);
  assert.equal(f.docs.get(doc.id)?.revision, 1);
  assert.equal(repo.status, "Synced");
});
test("two devices never silently overwrite a newer cloud revision; recovery keeps both", async () => {
  const f = fixture();
  await f.repo.load();
  const doc = await f.repo.create("Shared", paragraph("Original"));
  await f.repo.sync(true);
  const b = new Repository(f.owner, store(), f.api, randomUUID);
  await b.load();
  await b.open(doc.id);
  await b.edit(doc.id, { content: paragraph("Device B") });
  await f.repo.edit(doc.id, { content: paragraph("Device A") });
  await f.repo.sync(true);
  await b.sync(true);
  assert.equal(b.status, "Sync conflict — both versions are preserved");
  assert.equal(f.docs.get(doc.id)?.plain_text, "Device A");
  assert.equal((await b.getDocument(doc.id))?.plain_text, "Device B");
  const recovered = await b.resolveConflict(doc.id);
  await b.sync(true);
  assert.equal(f.docs.size, 2);
  assert.equal(f.docs.get(recovered!.id)?.plain_text, "Device B");
  assert.equal(f.docs.get(doc.id)?.plain_text, "Device A");
});
test("completed documents stay in the library but are not automatically reopened", async () => {
  const f = fixture();
  await f.repo.load();
  const doc = await f.repo.create("Done", paragraph("Finished"));
  await f.repo.sync(true);
  await f.repo.edit(doc.id, { completion_status: "completed" });
  await f.repo.sync(true);
  assert.equal(documentToReopen(f.repo.index, doc.id), null);
  const b = new Repository(f.owner, store(), f.api, randomUUID);
  await b.load();
  const saved = await b.open(doc.id);
  assert.equal(saved?.completion_status, "completed");
});
test("Free sync never writes paid documents or activities, while activity history remains intact", async () => {
  const f = fixture();
  await f.repo.load();
  const doc = await f.repo.create("Retained", paragraph("Never delete"));
  f.paid(false);
  await f.repo.sync(false);
  assert.equal(f.docs.size, 0);
  assert.equal((await f.repo.getDocument(doc.id))?.dirty, true);
  assert.equal(f.repo.summary?.displayedStreak, 7);
  f.paid(true);
  await f.repo.sync(true);
  assert.equal(f.repo.summary?.displayedStreak, 15);
  assert.equal(f.docs.size, 1);
});
test("session checkpoints synchronize before End and retries do not duplicate activity", async () => {
  const f = fixture();
  await f.repo.load();
  const doc = await f.repo.create("Session");
  await f.repo.sync(true);
  const writer = new WriterSessions(f.repo, "ios-device", randomUUID);
  const now = Date.now() - 60000;
  await writer.start(doc.id, now);
  await writer.input(doc.id, "", "one two three", "insertText", now + 30000);
  await writer.tick(now + 45000);
  await f.repo.sync(true);
  assert.equal(f.activities.size, 1);
  assert.equal(f.repo.summary?.dailyWordCount, 3);
  assert.equal(f.repo.summary?.dailyActiveWritingSeconds, 45);
  await f.repo.sync(true);
  assert.equal(f.activities.size, 1);
  await writer.change("paused", now + 50000);
  await f.repo.sync(true);
  assert.equal(f.activities.get(writer.active!.id)?.timer.status, "paused");
});
test("a conflicting account preference adopts the latest value, never a stale overwrite", async () => {
  const f = fixture();
  await f.repo.load();
  await f.repo.sync(false);
  await f.repo.setPreferences({ daily_goal: 2000 });
  f.advanceGoal();
  await f.repo.sync(false);
  assert.equal(f.repo.preferences?.daily_goal, 500);
});
test("encrypted private caches reject tampering and cross-account/key access", () => {
  const key = randomBytes(32),
    nonce = randomBytes(24),
    context = "owner-a:document";
  const value = seal({ text: "private writing" }, key, nonce, context);
  assert.ok(!value.includes("private writing"));
  assert.deepEqual(unseal(value, key, context), { text: "private writing" });
  assert.throws(() => unseal(value, key, "owner-b:document"));
  assert.throws(() => unseal(value, randomBytes(32), context));
  const packet = JSON.parse(value);
  packet.ciphertext = packet.ciphertext.replace(
    /^../,
    packet.ciphertext.startsWith("ff") ? "00" : "ff",
  );
  assert.throws(() => unseal(JSON.stringify(packet), key, context));
});
test("bearer transport retries refreshed auth and rejects account changes mid-request", async () => {
  let identity = { id: "a", token: "old" },
    calls = 0;
  const api = createTransport(
    "https://api.test",
    () => identity,
    async () => {
      identity = { id: "a", token: "new" };
    },
    (async (_url, options) => {
      calls++;
      assert.equal(options.credentials, "omit");
      return calls === 1
        ? new Response("{}", { status: 401 })
        : new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch,
  );
  assert.deepEqual(await api("GET", "/progress/summary"), { ok: true });
  assert.equal(calls, 2);
  const switched = createTransport(
    "https://api.test",
    () => identity,
    async () => {},
    (async () => {
      identity = { id: "b", token: "other" };
      return new Response("{}");
    }) as typeof fetch,
  );
  await assert.rejects(
    () => switched("GET", "/progress/summary"),
    /account_changed/,
  );
});
test("bounded JSON protects the existing document limits", () => {
  assert.equal(safeBody(paragraph("a".repeat(200001))), false);
  assert.equal(safeBody(paragraph("A normal paragraph")), true);
});

test("AI retries preserve request UUID and exact original progress timestamp", async () => {
  const { RequestTicket } = await import("../src/core/request-ticket");
  const ticket = new RequestTicket(randomUUID);
  const first = ticket.prepare({
    mode: "new_topic",
    writing_progress: {
      daily_goal: 1000,
      words_written_today: 750,
      captured_at: "first",
    },
  });
  const retried = ticket.prepare({
    mode: "new_topic",
    writing_progress: {
      daily_goal: 1000,
      words_written_today: 750,
      captured_at: "later",
    },
  });
  assert.deepEqual(retried, first);
  assert.equal((retried.writing_progress as any).captured_at, "first");
  ticket.complete();
  assert.notEqual(
    ticket.prepare({ mode: "new_topic" }).request_id,
    first.request_id,
  );
});

test("rapid edits coalesce locally and a background flush persists the newest draft", async () => {
  const f = fixture();
  await f.repo.load();
  const doc = await f.repo.create("Rapid", paragraph("Before"));
  await Promise.all([
    f.repo.edit(doc.id, { title: "Updated title" }),
    f.repo.edit(doc.id, { content: paragraph("Latest body") }),
  ]);
  await f.repo.flush();
  const reopened = new Repository(f.owner, f.local, f.api, randomUUID);
  await reopened.load();
  const draft = await reopened.getDocument(doc.id);
  assert.equal(draft?.title, "Updated title");
  assert.equal(draft?.plain_text, "Latest body");
  assert.equal(draft?.dirty, true);
});

test("goal and timezone updates use the existing flat API contract", async () => {
  const f = fixture();
  await f.repo.load();
  await f.repo.sync(false);
  await f.repo.setPreferences({ daily_goal: 750, timezone: "Europe/Madrid" });
  await f.repo.sync(false);
  assert.equal(f.repo.preferences?.daily_goal, 750);
  assert.equal(f.repo.preferences?.timezone, "Europe/Madrid");
  assert.equal(f.repo.summary?.dailyGoal, 750);
});

test("an old owner-bound callback cannot send private data into a later login", async () => {
  let current = "a",
    calls = 0;
  const transport: Transport = async () => {
    calls++;
    return {} as any;
  };
  const original = bindOwner("a", () => current, transport);
  await original("GET", "/auth/me");
  current = "b";
  await assert.rejects(
    () =>
      original("POST", "/ai/suggestion", {
        current_writing: "private A draft",
      }),
    /account_changed/,
  );
  assert.equal(calls, 1);
});

test("secure session chunks persist Unicode metadata and logout removes the active generation", async () => {
  const { secureStorage } = await import("../src/core/secure-session");
  const map = new Map<string, string>();
  const storage = secureStorage(
    {
      get: async (k) => map.get(k) ?? null,
      set: async (k, v) => {
        assert.ok(Buffer.byteLength(v) <= 1500);
        map.set(k, v);
      },
      remove: async (k) => {
        map.delete(k);
      },
    },
    randomUUID,
  );
  const session = JSON.stringify({
    access_token: "a".repeat(3000),
    refresh_token: "b".repeat(500),
    user: { name: "日本語 ✍️".repeat(100) },
  });
  await storage.setItem("auth", session);
  assert.equal(await storage.getItem("auth"), session);
  assert.ok(map.size > 3);
  await storage.removeItem("auth");
  assert.equal(map.size, 0);
  assert.equal(await storage.getItem("auth"), null);
});
test("interrupted Keychain writes keep the prior complete generation readable", async () => {
  const { secureStorage } = await import("../src/core/secure-session");
  const map = new Map<string, string>();
  let fail = false;
  const storage = secureStorage(
    {
      get: async (k) => map.get(k) ?? null,
      set: async (k, v) => {
        if (fail) throw new Error("Keychain write failed");
        map.set(k, v);
      },
      remove: async (k) => {
        map.delete(k);
      },
    },
    randomUUID,
  );
  await storage.setItem("auth", "previous valid credentials");
  fail = true;
  await assert.rejects(
    () => storage.setItem("auth", "new credentials"),
    /Keychain write failed/,
  );
  assert.equal(await storage.getItem("auth"), "previous valid credentials");
});
