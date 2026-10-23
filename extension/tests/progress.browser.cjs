/** Real popup, content script and worker; isolated storage and account fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../tests/node_modules/playwright');
const root = process.env.EXTENSION_ROOT || path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 420, height: 600 } });
    context.setDefaultTimeout(15000);
    const pages = new Set();
    const errors = [];
    let pro = true;
    let cloudActivity=[];
    const opened=[];
    const now = Date.now();
    const result = { startedAt: now - 71000, endedAt: now, typedWords: 10, pastedWords: 0, sessionGoal: 250 };
    const storage = {
      wc_settings: { langChosen: true, language: 'en', wordGoal: 250, themes: ['ideas'], profile: { timezone: 'UTC' }, aiSuggestionMode: 'original' },
      wc_account: { authenticated: true, userId: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.com', aiAccess: true, online: true },
      wc_state: { ...result, active: false, lastResult: result }, wc_history: [{ id: now - 71000, ...result }],
    };
    const clone = value => structuredClone(value);
    const notify = async (name, value) => Promise.all([...pages].map(page => page.evaluate(({ name, value }) => {
      for (const listener of window[name] || []) listener(...value);
    }, { name, value }).catch(() => {})));
    const local = {
      get: async keys => {
        if (typeof keys === 'string') keys = [keys];
        return Object.fromEntries(keys.filter(key => key in storage).map(key => [key, clone(storage[key])]));
      },
      set: async values => {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          if (JSON.stringify(storage[key]) !== JSON.stringify(value)) changes[key] = { oldValue: storage[key], newValue: value };
        }
        Object.assign(storage, clone(values));
        await notify('storageListeners', [changes, 'local']);
      },
    };
    let listener;
    const chrome = { storage: { local }, runtime: {
      onInstalled: { addListener() {} }, onMessage: { addListener: fn => listener = fn },
      sendMessage: async message => notify('backgroundListeners', [message]),
    }, tabs: { query: async () => [], sendMessage() {}, create: async item => opened.push(item) } };
    const worker = vm.createContext({ chrome, crypto: webcrypto, Date, Intl, URL, AbortController, FormData, TextEncoder, TextDecoder, console, setTimeout, clearTimeout,
      fetch: async url => {
        const route = new URL(url).pathname;
        const body = route === '/api/auth/me'
          ? { id: storage.wc_account.userId, email: 'fixture@example.com', plan: pro ? 'pro' : 'free', ai_access: pro }
          : route === '/api/workspace/activity' ? cloudActivity : route === '/api/ai/profile' ? { ai_preferences: { prompt_themes: ['ideas'] } } : [];
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      },
    });
    worker.self = worker;
    worker.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), worker, { filename: file }));
    vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), worker);
    const message = (msg,sender={}) => new Promise(resolve => listener(msg, sender, resolve));
    await context.exposeFunction('backgroundMessage', message);
    await context.exposeFunction('storageGet', local.get);
    await context.addInitScript(() => {
      window.backgroundListeners = []; window.storageListeners = [];
      window.chrome = {
        runtime: { onMessage: { addListener: fn => window.backgroundListeners.push(fn) },
          getManifest: () => ({ version: 'fixture' }), sendMessage: (msg, cb) => window.backgroundMessage(msg).then(cb) },
        storage: { onChanged: { addListener: fn => window.storageListeners.push(fn) },
          local: { get: (keys, cb) => window.storageGet(keys).then(cb) } },
      };
    });
    await context.route('http://progress.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/editor') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><textarea aria-label="Draft"></textarea><script src="/shared/wordcount.js"></script><script src="/content.js"></script>' });
      const file = path.join(root, pathname);
      await route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' });
    });
    const page = await context.newPage(); pages.add(page);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://progress.test/popup/popup.html');
    await page.waitForFunction(() => document.querySelector('#daily-word-count').textContent === '10');
    assert.equal(await page.locator('#dashboard-session-time').textContent(), '01:11');
    // Reproduce the screenshot: clearing must erase both history and lastResult.
    await page.click('#nav-progress'); await page.click('#prog-history'); await page.click('#history-clear'); await page.click('#confirm-ok');
    await page.click('#history-back');
    await page.waitForFunction(() => document.querySelector('#count-number').textContent === '0');
    assert.equal(await page.locator('#daily-word-count').textContent(), '0');
    assert.equal(await page.locator('#dashboard-session-time').textContent(), '00:00');
    assert.equal(await page.locator('#daily-goal-percent').textContent(), '0%');
    assert.equal(await page.locator('#dashboard-streak').textContent(), '0 days');
    assert.equal(storage.wc_state.lastResult, null);
    if (process.env.PROGRESS_SCREENSHOTS) {
      fs.mkdirSync(process.env.PROGRESS_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.PROGRESS_SCREENSHOTS, 'cleared-progress-420.png'), fullPage: true });
    }
    await page.reload(); await page.locator('#primary-btn').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#count-number').textContent(), '0', 'Cleared result stays cleared on reopen');

    // Real content.js input events must decrease the active session and goal ring.
    const editor = await context.newPage(); pages.add(editor);
    editor.on('pageerror', error => errors.push(error.message));
    await editor.goto('http://progress.test/editor');
    await page.click('#primary-btn');
    await editor.locator('textarea').pressSequentially('one two three four five');
    await page.waitForFunction(() => document.querySelector('#daily-word-count').textContent === '5');
    await editor.locator('textarea').fill('');
    await page.waitForFunction(() => document.querySelector('#count-number').textContent === '0');
    assert.equal(await page.locator('#daily-word-count').textContent(), '0');
    assert.equal(await page.locator('#daily-goal-percent').textContent(), '0%');
    // Concurrent delta messages must not overwrite each other; deletion wins in order.
    await Promise.all(Array.from({ length: 10 }, () => message({ type: 'DELTA', delta: { kind: 'typed', words: 1 } })));
    assert.equal((await message({ type: 'GET_STATE' })).payload.typedWords, 10);
    await message({ type: 'DELTA', delta: { kind: 'deleted', words: 10 } });
    await editor.locator('textarea').pressSequentially('fresh words here');
    await page.waitForFunction(() => document.querySelector('#daily-word-count').textContent === '3');
    // Clear completed history during active writing without discarding its words.
    await message({ type: 'CLEAR_HISTORY' });
    const active = (await message({ type: 'GET_STATE' })).payload;
    assert.equal(active.active, true); assert.equal(active.typedWords, 3);
    await page.click('#nav-progress');
    await message({ type: 'STOP_SESSION' });
    await page.waitForFunction(() => document.querySelector('#prog-primary').textContent === '3');
    assert.equal(await page.locator('#prog-sessions').textContent(), '1');
    await page.click('#nav-write');
    assert.equal(await page.locator('#daily-word-count').textContent(), '3', 'Stopping does not double-count');

    // Another open progress tab responds to the same history reset.
    const dashboard = await context.newPage(); pages.add(dashboard);
    dashboard.on('pageerror', error => errors.push(error.message));
    await dashboard.goto('http://progress.test/dashboard/dashboard.html');
    await dashboard.waitForFunction(() => document.querySelector('#hero-primary').textContent === '3');
    await message({ type: 'CLEAR_HISTORY' });
    await page.waitForFunction(() => document.querySelector('#count-number').textContent === '0');
    await dashboard.waitForFunction(() => document.querySelector('#hero-primary').textContent === '0');
    assert.equal(await dashboard.locator('#hero-streak').textContent(), '');
    await page.click('#nav-progress');
    await page.waitForFunction(() => document.querySelector('#prog-sessions').textContent === '0');

    // Import and replacement also refresh open progress, including current range.
    await page.click('[data-range="week"]');
    await message({ type: 'IMPORT_HISTORY', mode: 'merge', records: [{ ...result, id: 'imported', typedWords: 42 }] });
    await page.waitForFunction(() => document.querySelector('#prog-primary').textContent === '42');
    await message({ type: 'IMPORT_HISTORY', mode: 'replace', records: [] });
    await page.waitForFunction(() => document.querySelector('#prog-primary').textContent === '0');
    assert.equal((await message({ type: 'GET_STATE' })).payload.lastResult, null);

    // Explicit refresh recovers even if a storage notification was missed.
    storage.wc_history = [{ ...result, id: 'missed-event', typedWords: 8 }];
    await page.locator('#progress-panel [data-refresh-progress]').click();
    await page.waitForFunction(() => document.querySelector('#prog-primary').textContent === '8');
    assert.equal(await page.locator('#progress-refresh-status').textContent(), 'Progress is up to date.');
    await message({ type: 'CLEAR_HISTORY' });
    for (const width of [320, 420]) {
      await page.setViewportSize({ width, height: 600 });
      for (const lang of ['en', 'es']) {
        await page.evaluate(lang => { WCi18n.setLang(lang); WCi18n.applyI18n(document); }, lang);
        for (const nav of ['#nav-write', '#nav-progress']) {
          await page.click(nav);
          await page.locator('[data-refresh-progress]:visible').click();
          await page.waitForFunction(() => document.querySelector('#progress-refresh-status').textContent.length > 0);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${lang} overflow`);
          if (process.env.PROGRESS_SCREENSHOTS && width === 320 && nav === '#nav-write') {
            await page.screenshot({ path: path.join(process.env.PROGRESS_SCREENSHOTS, `cleared-progress-320-${lang}.png`), fullPage: true });
          }
        }
      }
    }
    // Free accounts keep their local tracking and refresh control.
    pro = false; await page.reload(); await page.locator('#primary-btn').waitFor({ state: 'visible' });
    await page.locator('#session-panel [data-refresh-progress]').click();
    assert.equal(await page.locator('#daily-word-count').textContent(), '0');
    assert.equal(storage.wc_history.length, 0);
    // Full-page editor owns its typing; the extension must never count it twice.
    await message({type:'OPEN_WRITING_EDITOR'});
    assert.equal(new URL(opened[0].url).pathname,'/editor');
    await message({type:'START_SESSION'});
    await message({type:'DELTA',delta:{kind:'typed',words:100}},{url:'https://unoword.vercel.app/editor'});
    assert.equal((await message({type:'GET_STATE'})).payload.typedWords,0);
    await message({type:'DELTA',delta:{kind:'typed',words:2}},{url:'https://example.com/draft'});
    await message({type:'STOP_SESSION'});
    cloudActivity=[{id:'editor-cloud-session',user_id:storage.wc_account.userId,started_at:new Date().toISOString(),typed_words:8,pasted_words:100,duration_seconds:40}];
    await message({type:'SYNC_EDITOR_ACTIVITY'});await message({type:'SYNC_EDITOR_ACTIVITY'});
    assert.equal((await message({type:'GET_STATS',range:'today'})).stats.totalWords,10,'Cloud activity appears once, excluding paste');
    const csvRoundTrip=worker.WCHistory.parseCSV(worker.WCHistory.toCSV(storage.wc_history));
    await local.set({wc_history:csvRoundTrip.records});
    assert.equal((await message({type:'GET_LOCAL_WRITING_PROGRESS'})).sessions.length,1,'CSV imports do not echo editor activity back to the web page');
    await message({type:'SYNC_EDITOR_ACTIVITY'});
    assert.equal((await message({type:'GET_STATS',range:'today'})).stats.totalWords,10,'Replacing history from an exported CSV cannot duplicate cloud activity on resync');
    assert.equal((await message({type:'GET_LOCAL_WRITING_PROGRESS'})).sessions.length,1,'Bridge excludes imported editor rows');
    cloudActivity[0].typed_words=0;await message({type:'SYNC_EDITOR_ACTIVITY'});
    assert.equal((await message({type:'GET_STATS',range:'today'})).stats.totalWords,2,'New editor snapshots can reduce progress');
    await message({type:'CLEAR_HISTORY'});await message({type:'SYNC_EDITOR_ACTIVITY'});
    assert.equal((await message({type:'GET_STATS',range:'today'})).stats.totalWords,0,'Clear is not undone by resync');
    assert.deepEqual(errors, []);
    console.log('PASS: clear/reopen; real editor deletion; ordered edits; active-session preservation; stop without duplication; popup and dashboard sync; imports; manual refresh; Free/Pro; EN/ES at 320/420px.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
