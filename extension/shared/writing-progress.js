/** Read the existing tracker; never store or award writing activity here. */
(function attach(scope) {
  const integer = n => Math.max(0, Math.floor(Number(n) || 0));
  function unique(sessions) {
    return [...new Map((sessions || []).map(row => [String(row.id ?? row.startedAt), row])).values()];
  }
  function total(sessions, now, timezone) {
    const today = scope.WCDates.dayKey(now, timezone);
    let words = 0;
    for (const row of unique(sessions)) {
      if (!Number.isFinite(row.startedAt) || scope.WCDates.dayKey(row.startedAt, timezone) !== today) continue;
      words += integer(row.typedWords);
    }
    return words;
  }
  function withActive(completed, active, timezone, now = Date.now()) {
    return integer(completed) + (active?.active && scope.WCDates.dayKey(active.startedAt, timezone) === scope.WCDates.dayKey(now, timezone)
      ? integer(active.typedWords) : 0);
  }
  function snapshot(goal, written, timezone, now = Date.now()) {
    timezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try { new Intl.DateTimeFormat('en', {timeZone: timezone}).format(now); }
    catch (_) { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    return { daily_goal: integer(goal) || null, words_written_today: integer(written), timezone,
      date: scope.WCDates.dayKey(now, timezone), captured_at: new Date(now).toISOString() };
  }
  const api = { total, withActive, snapshot, unique };
  scope.WCWritingProgress = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
