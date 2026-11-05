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
    const rewards={user_id:'00000000-0000-4000-8000-000000000001',enabled:true,language:'en',preferences:{enabled:true,celebrations:true,widget:true,revision:0,showcase:[]},achievements:[{id:'words_1000',name:'Getting Started',description:'Write 1000 words',metric:'words',requirement:1000,progress:600,unlocked:false,active:true}]};
    let claimed=0;

    let cloudActivity=[];let preferenceRevision=1;
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
      fetch: async (url,options={}) => {
        const input=options.body?JSON.parse(options.body):null;
        const route = new URL(url).pathname;
        if(route==='/api/rewards')return new Response(JSON.stringify({...rewards,user_id:storage.wc_account.userId}),{headers:{'content-type':'application/json'}});
        if(route==='/api/rewards/preferences'){assert.equal(input.expected_user_id,storage.wc_account.userId);assert.equal(input.revision,rewards.preferences.revision);Object.assign(rewards.preferences,input);rewards.preferences.revision++;rewards.enabled=rewards.preferences.enabled;return new Response(JSON.stringify({updated:true}),{headers:{'content-type':'application/json'}});}
        if(route==='/api/rewards/celebrations/claim'){assert.equal(input.expected_user_id,storage.wc_account.userId);claimed++;return new Response(JSON.stringify({achievement_id:null}),{headers:{'content-type':'application/json'}});}
        if(route==='/api/progress/preferences'){
          if(input){if(input.daily_goal)storage.wc_settings.wordGoal=input.daily_goal;if(input.language)storage.wc_settings.language=input.language;preferenceRevision++;}
          return new Response(JSON.stringify({user_id:storage.wc_account.userId,revision:preferenceRevision,daily_goal:storage.wc_settings.wordGoal,timezone:storage.wc_settings.profile.timezone,language:storage.wc_settings.language||'en',themes:storage.wc_settings.themes}));
        }
        if(route==='/api/progress/summary'){
          const rows=storage.wc_history.filter(r=>!r.cloudActivityId && r.source!=='editor');
          const current=storage.wc_state;
          const localWords=rows.reduce((n,r)=>n+(r.typedWords||0),0)+(current.active?current.typedWords||0:0);
          const localTime=rows.reduce((n,r)=>n+(r.timer?worker.WCSessionClock.read(r.timer).active_ms:(r.endedAt||r.startedAt)-r.startedAt),0)+(current.active?worker.WCSessionClock.read(current.timer).active_ms:0);
          return new Response(JSON.stringify({user_id:storage.wc_account.userId,reportingDate:new Date().toISOString().slice(0,10),timezone:storage.wc_settings.profile.timezone,dailyWordCount:localWords+cloudActivity.reduce((n,r)=>n+r.typed_words,0),dailyActiveWritingSeconds:Math.floor(localTime/1000)+cloudActivity.reduce((n,r)=>n+r.duration_seconds,0),lifetimeActiveWritingSeconds:Math.floor(localTime/1000)+cloudActivity.reduce((n,r)=>n+r.duration_seconds,0),dailySessions:[...rows,...(current.active?[current]:[])].map(r=>({client_key:r.progressKey||'session:'+r.startedAt,source:'extension',typed_words:r.typedWords||0,sequence:r.progressVersion||0})),dailyGoal:storage.wc_settings.wordGoal,displayedStreak:localWords?1:0,updatedAt:new Date().toISOString(),sessions:[]}));
        }
        const body = route === '/api/auth/me'
          ? { id: storage.wc_account.userId, email: 'fixture@example.com', plan: pro ? 'pro' : 'free', ai_access: pro }
          : route === '/api/progress/streak' ? {user_id:storage.wc_account.userId,displayedStreak:storage.wc_history.some(r=>r.typedWords>0)||storage.wc_state.active&&storage.wc_state.typedWords>0?1:0,hasUnlimitedStreakAccess:pro,streakLimitReached:false,timezone:storage.wc_settings.profile.timezone,asOf:new Date().toISOString()} : route === '/api/progress/sessions' ? {synced:1} : route === '/api/progress/clear' ? {cleared:true} : route === '/api/progress/activity' ? cloudActivity : route === '/api/ai/profile' ? { ai_preferences: { prompt_themes: ['ideas'] } } : [];
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      },
    });
    worker.self = worker;
    worker.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), worker, { filename: file }));
    vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), worker);
    const message = (msg,sender={}) => new Promise(resolve => listener(msg, sender, resolve));
    await context.exposeFunction('backgroundMessage', message);
    await context.exposeFunction('openTab',async item=>{opened.push(item);});
    await context.exposeFunction('storageGet', local.get);
    await context.addInitScript(() => {
      window.backgroundListeners = []; window.storageListeners = [];
      window.chrome = {
        tabs:{create:item=>window.openTab(item)},
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
    await page.locator('.wc-reward-next').waitFor({state:'visible'});
    assert.match(await page.locator('.wc-reward-next').textContent(),/600 \/ 1,000/);
    for(const width of [420,320]){await page.setViewportSize({width,height:700});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    await page.click('#settings-btn');
    const enabled=page.locator('.wc-rewards-settings label').filter({hasText:'Enable Writing Rewards'}).locator('input');
    await enabled.uncheck();await page.getByText('Your achievements stay saved while rewards are off.',{exact:true}).waitFor();assert.equal(rewards.enabled,false);assert.ok(await page.locator('.wc-reward-next').isHidden());
    await enabled.check();await page.locator('.wc-rewards-settings').getByRole('button',{name:'View Rewards →'}).waitFor();assert.equal(rewards.enabled,true);
    await page.locator('.wc-rewards-settings').getByRole('button',{name:'View Rewards →'}).click();await page.waitForTimeout(100);assert.equal(opened.at(-1).url,'https://unoword.vercel.app/rewards');
    await page.locator('#settings-connect-substack').click();await page.waitForTimeout(100);assert.equal(opened.at(-1).url,'https://unoword.vercel.app/account#subscription');
    assert.equal((await message({type:'WRITING_REWARDS',action:'read',expectedUserId:'different-owner'})).ok,false);
    const original=storage.wc_account.userId;await local.set({wc_account:{...storage.wc_account,userId:'00000000-0000-4000-8000-000000000002'}});
    const changed=await message({type:'WRITING_REWARDS',action:'read',expectedUserId:original});assert.equal(changed.error,'account_changed');assert.ok(claimed>=0);
    assert.deepEqual(errors,[]);
    console.log('PASS: real popup/worker rewards, backend-owned progress, on/off persistence, retained settings, web-dashboard link, 320/420px, stale-owner requests rejected.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
