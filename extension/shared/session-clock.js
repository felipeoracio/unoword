/** Timestamp-based session clock shared by the extension and writing editor.
 * Intervals repaint the UI; they never determine elapsed writing time. */
(function (root) {
  const number = (value) => Math.max(0, Number(value) || 0);
  function start(now = Date.now()) {
    return { status: "active", active_ms: 0, paused_ms: 0, changed_at: now };
  }
  function read(timer, now = Date.now()) {
    if (!timer) return { active_ms: 0, paused_ms: 0, elapsed_ms: 0 };
    const delta = Math.max(0, now - number(timer.changed_at));
    const active_ms =
      number(timer.active_ms) + (timer.status === "active" ? delta : 0);
    const paused_ms =
      number(timer.paused_ms) + (timer.status === "paused" ? delta : 0);
    return { active_ms, paused_ms, elapsed_ms: active_ms + paused_ms };
  }
  function transition(timer, status, now = Date.now()) {
    if (!["active", "paused", "ended"].includes(status))
      throw new Error("invalid_session_status");
    if (!timer) return status === "active" ? start(now) : null;
    if (timer.status === status || timer.status === "ended") return timer;
    const elapsed = read(timer, now);
    return {
      active_ms: elapsed.active_ms,
      paused_ms: elapsed.paused_ms,
      status,
      changed_at: Math.max(number(timer.changed_at), now),
    };
  }
  function forSession(row, now = Date.now()) {
    if (row?.timer) return row.timer;
    const started = row?.startedAt || now;
    const ended = row?.endedAt || now;
    return row?.active
      ? { ...start(started) }
      : {
          status: "ended",
          active_ms: Math.max(0, ended - started),
          paused_ms: 0,
          changed_at: ended,
        };
  }
  const api = { start, read, transition, forSession };
  root.WCSessionClock = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
