/** Actual service worker and persistent outbox; local fake network only. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "..");
(async () => {
  const user = "00000000-0000-4000-8000-000000000001",
    other = "00000000-0000-4000-8000-000000000002";
  let paid = false,
    offline = false;
  const storage = {
    wc_account: {
      authenticated: true,
      userId: user,
      aiAccess: false,
      online: true,
    },
    wc_settings: {
      langChosen: true,
      language: "en",
      profile: { timezone: "America/Chicago" },
      wordGoal: 250,
      themes: ["ideas"],
    },
    wc_history: [],
  };
  const server = new Map(),
    requests = [];
  let listener;
  const chrome = {
    storage: {
      local: {
        get: async (keys) =>
          Object.fromEntries(
            (typeof keys === "string" ? [keys] : keys)
              .filter((k) => k in storage)
              .map((k) => [k, structuredClone(storage[k])]),
          ),
        set: async (data) => Object.assign(storage, structuredClone(data)),
      },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
      sendMessage: async () => {},
    },
    tabs: {
      query: async () => [],
      create: async () => {},
      sendMessage: async () => {},
    },
  };
  let workerNow=null;
  class WorkerDate extends Date { constructor(...args){super(...(args.length?args:[workerNow??Date.now()]));} static now(){return workerNow??Date.now();} }
  const worker = vm.createContext({
    chrome,
    crypto: webcrypto,
    Date:WorkerDate,
    Intl,
    URL,
    AbortController,
    FormData,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    Response,
    fetch: async (url, options = {}) => {
      if (offline) throw new TypeError("offline");
      const key = new URL(url).pathname,
        body = options.body ? JSON.parse(options.body) : null;
      requests.push({ key, body });
      let result = {};
      if (key === "/api/auth/me")
        result = {
          id: storage.wc_account.userId,
          plan: paid ? "pro" : "free",
          ai_access: paid,
        };
      else if (key === "/api/progress/sessions") {
        assert.equal(body.expected_user_id, storage.wc_account.userId);
        for (const row of body.sessions) {
          assert.ok(!("content" in row));
          const id = body.expected_user_id + ":" + row.key;
          const previous = server.get(id);
          if (!previous || previous.sequence < row.sequence)
            server.set(id, { ...row, owner: body.expected_user_id });
        }
        result = { synced: body.sessions.length };
      } else if (key === "/api/progress/streak") {
        const rows = [...server.values()]
          .filter((r) => r.owner === storage.wc_account.userId)
          .map((r) => ({
            startedAt: Date.parse(r.started_at),
            typedWords: r.typed_words,
          }));
        const history = require("../shared/history.js");
        const actual = history.computeStreak(rows, "America/Chicago");
        result = {
          user_id: storage.wc_account.userId,
          displayedStreak: paid ? actual : Math.min(actual, 7),
          hasUnlimitedStreakAccess: paid,
          streakLimitReached: !paid && actual >= 7,
          journeyContinues: !paid && actual > 7,
          timezone: "America/Chicago",
          asOf: new Date().toISOString(),
        };
      } else if (key === "/api/progress/clear") {
        for (const [id, row] of server)
          if (
            row.owner === body.expected_user_id &&
            Date.parse(row.started_at) <= Date.parse(body.before) &&
            row.key !== body.keep_extension_key
          )
            server.delete(id);
        result = { cleared: true };
      } else if (key === "/api/workspace/activity") result = [];
      else if (key === "/api/ai/profile") result = { ai_preferences: {} };
      else throw new Error("Unexpected endpoint " + key);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  worker.self = worker;
  worker.importScripts = (...files) =>
    files.forEach((file) =>
      vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), worker, {
        filename: file,
      }),
    );
  vm.runInContext(
    fs.readFileSync(path.join(root, "background.js"), "utf8"),
    worker,
  );
  const evaluate = (code) =>
    vm.runInContext("(async()=>(" + code + "))()", worker);
  // Existing unknown-owner history stays local until the explicit import action.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const base = Date.parse(today + "T12:00:00Z");
  storage.wc_history = Array.from({ length: 15 }, (_, i) => ({
    id: base - i * 86400000,
    startedAt: base - i * 86400000,
    endedAt: base - i * 86400000 + 60000,
    typedWords: 20,
    pastedWords: 99,
  }));
  await evaluate("verifiedWritingStreak(true)");
  assert.equal(server.size, 0, "Legacy history is never silently assigned");
  await evaluate("adoptDeviceWritingHistory()");
  let view = await evaluate("verifiedWritingStreak(true)");
  assert.equal(server.size, 15);
  assert.equal(view.displayedStreak, 7);
  assert.ok(!("actualStreak" in view));
  paid = true;
  await evaluate("refreshAccount()");
  view = await evaluate("verifiedWritingStreak(true)");
  assert.equal(view.displayedStreak, 15);
  paid = false;
  await evaluate("refreshAccount()");
  view = await evaluate("verifiedWritingStreak(true)");
  assert.equal(view.displayedStreak, 7);
  assert.equal(server.size, 15);
  // Every plan records the next typed session. Offline queue survives until online.
  offline = true;
  await evaluate("startSession()");
  await evaluate(
    "setState({...await getState(),typedWords:12,pastedWords:50})",
  );
  await evaluate("stopSession()");
  await evaluate("flushWritingMetadata()");
  assert.ok(Object.keys(storage.wc_progress_outbox[user]).length > 0);
  offline = false;
  await evaluate("flushWritingMetadata()");
  assert.equal(Object.keys(storage.wc_progress_outbox[user]).length, 0);
  assert.equal(server.size, 16);
  const calls = requests.filter(
    (r) => r.key === "/api/progress/sessions",
  ).length;
  await evaluate("verifiedWritingStreak(true)");
  await evaluate("flushWritingMetadata()");
  assert.equal(
    requests.filter((r) => r.key === "/api/progress/sessions").length,
    calls,
    "Acknowledged snapshots are not continuously re-uploaded",
  );
  // Switching accounts never uploads the former owner's pending metadata.
  offline = true;
  await evaluate("startSession()");
  await evaluate("setState({...await getState(),typedWords:5})");
  await evaluate("stopSession()");
  storage.wc_account = {
    authenticated: true,
    userId: other,
    aiAccess: false,
    online: true,
  };
  offline = false;
  await evaluate("flushWritingMetadata()");
  assert.ok(Object.keys(storage.wc_progress_outbox[user]).length > 0);
  assert.ok(![...server.values()].some((r) => r.owner === other));
  // A borrowed account cannot claim scoped history from the first writer.
  await evaluate("adoptDeviceWritingHistory()");
  assert.ok(![...server.values()].some((r) => r.owner === other));
  assert.ok(
    requests.every(
      (r) => !r.key.includes("/ai/suggestion") && !r.key.includes("/assistant"),
    ),
  );
  console.log(
    "PASS worker: explicit historical import; Day 15 Free=7/Pro=15; downgrade preserves rows; offline persistent outbox; metadata-only sync; deterministic IDs; midnight rollover; acknowledgements; account-switch isolation; no model calls.",
  );
  // A continuing session crosses writer-local midnight without assigning
  // yesterday's words to today or creating writing on intervening missed days.
  storage.wc_account={authenticated:true,userId:other,aiAccess:false,online:true};
  workerNow=Date.parse('2026-03-08T05:59:00Z');
  await evaluate('startSession()');await evaluate('applyDelta({kind:"typed",words:7})');
  const beforeMidnight=storage.wc_state.startedAt;
  workerNow=Date.parse('2026-03-08T06:01:00Z');await evaluate('applyDelta({kind:"typed",words:3})');
  assert.equal(storage.wc_state.typedWords,3);assert.notEqual(storage.wc_state.startedAt,beforeMidnight);
  assert.ok(storage.wc_history.some(row=>row.startedAt===beforeMidnight&&row.typedWords===7));
  await evaluate('stopSession()');workerNow=null;
  await evaluate('flushWritingMetadata()');
  const dayRows=[...server.values()].filter(row=>row.owner===other);
  assert.equal(dayRows.length,2);assert.equal(dayRows.reduce((n,row)=>n+row.typed_words,0),10,'Midnight rollover never duplicates words');
  // Persistent pause/resume uses the same session on Free; duplicate start is safe.
  workerNow=Date.parse('2026-10-28T15:00:00Z');
  await evaluate('startSession()');const sessionStart=storage.wc_state.startedAt;
  await evaluate('applyDelta({kind:"typed",words:12})');
  workerNow+=25*60000;await evaluate('pauseOrResumeSession("paused")');
  assert.equal(storage.wc_state.timer.status,'paused');
  const pausedSnapshot=structuredClone(storage.wc_state);
  workerNow+=10*60000;await evaluate('applyDelta({kind:"typed",words:500})');
  assert.equal(storage.wc_state.typedWords,12,'Paused input never accumulates tracked words');
  storage.wc_state=structuredClone(pausedSnapshot); // persisted worker/browser restoration
  await evaluate('startSession()');assert.equal(storage.wc_state.startedAt,sessionStart);
  assert.equal(storage.wc_state.timer.status,'paused','Duplicate start never resumes a paused session');
  await evaluate('pauseOrResumeSession("active")');workerNow+=20*60000;
  await evaluate('stopSession()');const result=storage.wc_state.lastResult;
  assert.equal(result.startedAt,sessionStart);assert.equal(result.timer.active_ms,45*60000);
  assert.equal(result.timer.paused_ms,10*60000);
  const historyCount=storage.wc_history.length;await evaluate('stopSession()');
  assert.equal(storage.wc_history.length,historyCount,'Ending twice never duplicates history');
  await evaluate('startSession()');workerNow+=60000;await evaluate('pauseOrResumeSession("paused")');
  workerNow+=5*60000;await evaluate('stopSession()');
  assert.equal(storage.wc_state.lastResult.timer.active_ms,60000,'End while paused excludes the break');
  workerNow=null;
  console.log('PASS persistent worker sessions: Free pause/resume, 45 active/10 paused/55 elapsed, input suppression, restored pause, duplicate-start/stop protection, same session identity.');
  // Clear pending debounce timers after this standalone worker test.
  vm.runInContext(
    "if(writingMetadataTimer)clearTimeout(writingMetadataTimer)",
    worker,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
