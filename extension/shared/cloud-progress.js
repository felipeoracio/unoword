/** Metadata-only activity sync helpers. No writing content and no streak math. */
(function (root) {
  const clock=root.WCSessionClock || (typeof module!=='undefined'?require('./session-clock.js'):null);
  function session(row, now) {
    if (!row?.startedAt || !row.ownerId || row.source === "editor") return null;
    return {
      key: row.progressKey || "session:" + row.startedAt,
      ...(row.timer ? { timer: clock.checkpoint(row.timer,now), active_intervals: clock.intervals(row, now) } : {}),
      ...(row.deviceId ? { device_id: row.deviceId } : {}),
      started_at: new Date(row.startedAt).toISOString(),
      typed_words: Math.max(0, Math.floor(row.typedWords || 0)),
      pasted_words: Math.max(0, Math.floor(row.pastedWords || 0)),
      duration_seconds: Math.min(
        86400,
        Math.max(0, Math.floor((row.timer && clock ? clock.read(row.timer,now).active_ms : ((row.endedAt || now) - row.startedAt)) / 1000)),
      ),
      sequence: row.progressVersion || now,
    };
  }
  function cached(value, owner, paid, timezone, now) {
    if (
      !value ||
      value.user_id !== owner ||
      value.timezone !== timezone ||
      Date.parse(value.asOf) > now + 30000 ||
      now - Date.parse(value.asOf) > 86400000
    )
      return null;
    // Cached offline results never expose a previously paid streak to Free.
    const permitted = paid
      ? value.displayedStreak
      : Math.min(value.displayedStreak, 7);
    return {
      displayedStreak: permitted,
      hasUnlimitedStreakAccess: !!paid,
      streakLimitReached: !paid && permitted >= 7,
      journeyContinues: !paid && permitted >= 7,
      offline: true,
    };
  }
  function pendingWords(summary, state, history, owner, today) {
    if(!summary?.dailySessions)return 0;
    const saved=new Map(summary.dailySessions.filter(row=>row.source==='extension').map(row=>[row.client_key,row]));
    const local=new Map();
    for(const row of [...(history||[]),...(state?.active?[state]:[])]){
      if(row.cloudActivityId || row.source==='editor' || row.ownerId!==owner || !today(row.startedAt))continue;
      local.set(row.progressKey||'session:'+row.startedAt,row);
    }
    let delta=0;
    for(const [key,row] of local){const previous=saved.get(key);if(!previous || (row.progressVersion||0)>previous.sequence)delta+=(row.typedWords||0)-(previous?.typed_words||0);}
    return delta;
  }
  const api = { session, cached, pendingWords };
  root.WCCloudProgress = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
