/** Calendar ranges in the writer's timezone, including DST transitions. */
(function attach(scope) {
  function dayKey(time, timezone) {
    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    if (timezone) options.timeZone = timezone;
    try { return new Intl.DateTimeFormat('en-CA', options).format(new Date(time)); }
    catch (_error) { delete options.timeZone; return new Intl.DateTimeFormat('en-CA', options).format(new Date(time)); }
  }
  function midnight(key, timezone) {
    if (!timezone) return new Date(`${key}T00:00:00`).getTime();
    const target = Date.parse(`${key}T00:00:00Z`);
    let guess = target;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      for (let i = 0; i < 4; i++) {
        const p = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
        const correction = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
        guess += correction;
        if (!correction) return guess;
      }
      return guess;
    } catch (_error) { return new Date(`${key}T00:00:00`).getTime(); }
  }
  function rangeBounds(range, now, timezone) {
    if (!['today', 'week', 'month', 'year'].includes(range)) return { start: 0, end: now + 1 };
    const start = new Date(`${dayKey(now, timezone)}T00:00:00Z`);
    if (range === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    if (range === 'month') start.setUTCDate(1);
    if (range === 'year') start.setUTCMonth(0, 1);
    const end = new Date(start);
    if (range === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
    else if (range === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
    else end.setUTCDate(end.getUTCDate() + (range === 'week' ? 7 : 1));
    return { start: midnight(start.toISOString().slice(0, 10), timezone), end: midnight(end.toISOString().slice(0, 10), timezone) };
  }
  function dayKeysForRange(start, end, timezone) {
    const first = new Date(`${dayKey(start, timezone)}T00:00:00Z`);
    const last = dayKey(end, timezone);
    const result = [];
    while (first.toISOString().slice(0, 10) < last) {
      result.push(first.toISOString().slice(0, 10)); first.setUTCDate(first.getUTCDate() + 1);
    }
    return result;
  }
  const api = { dayKey, midnight, rangeBounds, dayKeysForRange };
  scope.WCDates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
