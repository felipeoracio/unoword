const { test } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("../shared/cloud-progress.js");
test("Activity sync contains metadata only and ignores imported editor rows", () => {
  const row = {
    ownerId: "a",
    progressKey: "device-session",
    startedAt: Date.parse("2026-10-28T10:00:00Z"),
    endedAt: Date.parse("2026-10-28T10:01:00Z"),
    typedWords: 5,
    pastedWords: 20,
    content: "PRIVATE WRITING",
    progressVersion: 42,
  };
  const data = helpers.session(row, Date.now());
  assert.deepEqual(Object.keys(data).sort(), [
    "duration_seconds",
    "key",
    "pasted_words",
    "sequence",
    "started_at",
    "typed_words",
  ]);
  assert.equal(data.typed_words, 5);
  assert.equal(data.sequence, 42);
  assert.equal(helpers.session({ ...row, source: "editor" }, Date.now()), null);
  assert.equal(helpers.session({ ...row, ownerId: null }, Date.now()), null);
});
test("A cached paid streak never leaks through a Free offline response", () => {
  const now = Date.now(),
    cache = {
      user_id: "a",
      timezone: "America/Chicago",
      displayedStreak: 25,
      asOf: new Date(now).toISOString(),
    };
  const free = helpers.cached(cache, "a", false, "America/Chicago", now);
  assert.equal(free.displayedStreak, 7);
  assert.equal(free.hasUnlimitedStreakAccess, false);
  assert.ok(!("actualStreak" in free));
  assert.equal(helpers.cached(cache, "b", true, "America/Chicago", now), null);
  assert.equal(helpers.cached(cache, "a", true, "Asia/Tokyo", now), null);
  assert.equal(
    helpers.cached(cache, "a", true, "America/Chicago", now + 2 * 86400000),
    null,
  );
  assert.equal(
    helpers.cached(cache, "a", true, "America/Chicago", now).displayedStreak,
    25,
  );
});
