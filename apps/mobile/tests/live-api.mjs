/** Opt-in disposable QA-account smoke check. No AI generation or billing calls.
 * Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * UNOWORD_TEST_USER_A_PASSWORD. Service key is used by this Node test only,
 * exclusively to remove the fixture document/activity it created. Never bundled.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const base =
  process.env.UNOWORD_TEST_API_URL || "https://unoword.vercel.app/api";
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY,
  service = process.env.SUPABASE_SERVICE_ROLE_KEY,
  password = process.env.UNOWORD_TEST_USER_A_PASSWORD;
if (!url || !key || !service || !password)
  throw new Error("QA settings missing. Never paste credentials into source.");
const auth = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await auth.auth.signInWithPassword({
  email: "unoword.e2e.a@example.com",
  password,
});
if (error || !data.session)
  throw new Error("Existing QA account could not authenticate.");
const owner = data.session.user.id,
  token = data.session.access_token,
  docId = randomUUID(),
  activityId = randomUUID(),
  device = "ios-qa-" + randomUUID();
let created = false;
async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error("QA API " + method + " " + path + " HTTP " + r.status);
  return value;
}
async function cleanup(table, id) {
  const r = await fetch(
    url + "/rest/v1/" + table + "?id=eq." + id + "&user_id=eq." + owner,
    {
      method: "DELETE",
      headers: { apikey: service, Authorization: "Bearer " + service },
    },
  );
  assert.ok(r.ok, "Fixture cleanup " + table);
}
let baseline;
try {
  const me = await api("GET", "/auth/me");
  assert.equal(me.id, owner);
  assert.equal(me.features.writing_editor, true);
  baseline = await api("GET", "/progress/summary");
  const content = {
    type: "doc",
    attrs: { subtitle: "Temporary mobile interoperability check" },
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "A fictional thought about noticing everyday creativity.",
            marks: [{ type: "bold" }],
          },
        ],
      },
    ],
  };
  const request = {
    expected_user_id: owner,
    revision: 0,
    mutation_id: randomUUID(),
    title: "[QA temporary] native mobile interoperability",
    content,
    folder_id: null,
    favorite: false,
    status: "active",
    completion_status: "draft",
    ai_allowed: false,
  };
  const saved = await api("PUT", "/workspace/documents/" + docId, request);
  created = true;
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.content, content);
  const replay = await api("PUT", "/workspace/documents/" + docId, request);
  assert.equal(replay.revision, 1);
  const read = await api("GET", "/workspace/documents/" + docId);
  assert.deepEqual(read.content, content);
  const now = Date.now(),
    start = now - 45000;
  const activity = {
    expected_user_id: owner,
    id: activityId,
    document_id: docId,
    started_at: new Date(start).toISOString(),
    typed_words: 7,
    pasted_words: 3,
    duration_seconds: 30,
    sequence: 1,
    device_id: device,
    active_intervals: [
      [start, start + 20000],
      [start + 30000, start + 40000],
    ],
    timer: {
      status: "paused",
      active_ms: 30000,
      paused_ms: 10000,
      changed_at: start + 40000,
    },
  };
  await api("PUT", "/workspace/activity", activity);
  await api("PUT", "/workspace/activity", activity);
  const rows = await api("GET", "/progress/activity");
  const matching = rows.filter((row) => row.id === activityId);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].typed_words, 7);
  assert.equal(matching[0].duration_seconds, 30);
  assert.equal(matching[0].device_id, device);
  const summary = await api("GET", "/progress/summary");
  assert.equal(summary.user_id, owner);
  assert.ok(
    summary.sessions.some(
      (s) =>
        s.id === activityId && s.status === "paused" && s.active_seconds === 30,
    ),
  );
  assert.equal(summary.dailyWordCount, baseline.dailyWordCount + 7);
  assert.ok(
    summary.dailyActiveWritingSeconds >= baseline.dailyActiveWritingSeconds,
  );
  const completed = await api(
    "POST",
    "/workspace/documents/" + docId + "/completion",
    {
      expected_user_id: owner,
      revision: 1,
      mutation_id: randomUUID(),
      completion_status: "completed",
    },
  );
  assert.equal(completed.completion_status, "completed");
  assert.ok(completed.completed_at);
  const final = await api("GET", "/workspace/documents/" + docId);
  assert.equal(final.completion_status, "completed");
  assert.deepEqual(final.content, content);
  console.log(
    "PASS: real Supabase email login, native bearer auth, same account summary, revision replay, rich document/subtitle round-trip, checkpoint visible before End, duplicate activity protection, completion timestamp.",
  );
} finally {
  if (created) {
    await cleanup("writing_activity", activityId);
    await cleanup("writing_documents", docId);
  }
  if (baseline) {
    const after = await api("GET", "/progress/summary");
    assert.equal(after.dailyWordCount, baseline.dailyWordCount);
    assert.equal(
      after.dailyActiveWritingSeconds,
      baseline.dailyActiveWritingSeconds,
    );
    assert.equal(
      after.lifetimeActiveWritingSeconds,
      baseline.lifetimeActiveWritingSeconds,
    );
    console.log(
      "QA fixture removed; prior account word/time totals preserved.",
    );
  }
  await auth.auth.signOut({ scope: "local" });
}
