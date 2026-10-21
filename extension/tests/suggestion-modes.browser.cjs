/** Real popup + background.js with Chrome APIs and HTTP fixtures; no model costs.
 * Run after installing tests/package.json and Playwright Chromium:
 *   node extension/tests/suggestion-modes.browser.cjs
 * PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE can select an existing installation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../tests/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const userId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000002';

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}), args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:340,height:820}});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    const requests = [], suggestions = [], saved = [];
    let generationStatus = 200;
    const storage = {
      wc_settings:{langChosen:true,plan:'pro',language:'en',wordGoal:250,themes:['ideas'],profile:{},aiSuggestionMode:'new_topic'},
      wc_state:{active:false,typedWords:0,pastedWords:0},
      wc_account:{authenticated:true,userId,email:'qa@example.com',aiAccess:true,plan:'pro',online:true},
    };
    let messageListener;
    const chrome = {
      storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)}},
      runtime:{onInstalled:{addListener(){}},onMessage:{addListener(listener){messageListener=listener;}},sendMessage:async msg=>{
        await page.evaluate(message=>(window.backgroundListeners||[]).forEach(listener=>listener(message)),msg).catch(()=>{});
      }},
      tabs:{query:async()=>[{id:7}],sendMessage:(_id,_msg,callback)=>callback({ok:true,text:'Actual tab draft about observing tides before making a decision.'})},
    };
    async function fetchFixture(url, options={}) {
      const route = new URL(url).pathname.replace('/api','');
      const method = options.method || 'GET';
      const payload = options.body ? JSON.parse(options.body) : null;
      requests.push({route,method,payload});
      let body, status=200;
      if (route==='/auth/me') body={id:userId,email:'qa@example.com',plan:'pro',ai_access:true};
      else if (route==='/ai/ideas') body=saved;
      else if (route==='/ai/idea-options') body=[{id:sourceId,title:'Solar ferry notes',kind:'file'}];
      else if (route==='/ai/suggestion') {
        status=generationStatus;
        const es=payload.language==='es';
        body=status===200 ? {
          id:`00000000-0000-4000-8000-${String(suggestions.length+10).padStart(12,'0')}`,
          user_id:userId,mode:payload.mode,title:es?'Observa antes de decidir':`A direction for ${payload.mode}`,
          suggestion:es?'Explora cómo observar cambia una decisión.':'Explore how observation changes a decision.',reason:'Based on your material.',
          questions:es?['¿Qué observas?','¿Qué cambia?','¿Por qué importa?']:['What do you observe?','What changes?','Why does it matter?'],
          inspired_by:[{source_id:sourceId,title:'Solar ferry notes',kind:'file'}],related_topics:[],source_ids:[sourceId],
        } : {detail:'Daily AI suggestion limit reached'};
        if (status===200) suggestions.push(body);
      } else if (/\/suggestions\/.+\/save$/.test(route)) {
        body=suggestions.find(s=>route.includes(s.id));
        if (!saved.some(s=>s.id===body.id)) saved.unshift(body);
      } else if (/\/suggestions\/.+\/use$/.test(route)) body={...suggestions.find(s=>route.includes(s.id)),status:'written'};
      else if (route==='/ai/feedback') body={id:'feedback'};
      else throw Error(`Unexpected HTTP request ${method} ${route}`);
      return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
    }
    const worker = vm.createContext({chrome,crypto:webcrypto,fetch:fetchFixture,AbortController,FormData,TextEncoder,TextDecoder,URL,Date,Intl,console,setTimeout,clearTimeout});
    worker.self=worker;
    worker.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),worker,{filename:file}));
    vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),worker,{filename:'background.js'});
    const message=msg=>new Promise(resolve=>messageListener(msg,{},resolve));
    await page.exposeFunction('backgroundMessage',message);
    await page.addInitScript(()=>{
      window.backgroundListeners=[];
      window.chrome={runtime:{onMessage:{addListener:listener=>window.backgroundListeners.push(listener)},getManifest:()=>({version:'test'}),sendMessage:(msg,callback)=>window.backgroundMessage(msg).then(callback)}};
    });
    await page.route('http://popup.test/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      const file=path.join(root,pathname);
      const contentType=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html';
      await route.fulfill({body:fs.readFileSync(file),contentType});
    });
    await page.goto('http://popup.test/popup/popup.html');
    await page.waitForFunction(()=>!document.querySelector('#suggestion-controls').hidden);
    assert.equal(suggestions.length,0,'Opening the popup must not spend AI allowance');
    async function choose(mode) {await page.locator(`label:has(input[value="${mode}"])`).click();}
    async function generate(mode) {
      const before=suggestions.length;
      await page.click('#suggestion-generate');
      await page.waitForFunction(()=>!document.querySelector('#prompt-ai-card').hidden && !document.querySelector('#suggestion-generate').disabled);
      assert.equal(suggestions.length,before+1);
      assert.equal(suggestions.at(-1).mode,mode);
      assert.equal(await page.locator('#suggestion-questions li').count(),3);
      assert.equal(await page.locator('#suggestion-inspirations li').count(),1);
    }
    await generate('new_topic');
    await page.click('#prompt-ai-again');
    await page.waitForFunction(()=>!document.querySelector('#prompt-ai-again').disabled);
    assert.equal(suggestions.at(-1).mode,'new_topic');
    await page.click('#suggestion-save');
    await page.waitForFunction(()=>document.querySelector('#suggestion-save').textContent==='Saved');
    await page.reload();
    await page.locator('#suggestion-saved summary').click();
    await page.locator('#suggestion-saved-list button').first().click();
    assert.equal(await page.locator('#suggestion-save').textContent(),'Saved');
    await choose('expand_idea');
    const before=suggestions.length;
    await page.click('#suggestion-generate');
    assert.equal(suggestions.length,before,'Missing idea must be validated before requesting AI');
    await page.fill('#suggestion-idea-text','My actual idea about patient observation.');
    await generate('expand_idea');
    assert.equal(requests.filter(r=>r.route==='/ai/suggestion').at(-1).payload.current_writing,'My actual idea about patient observation.');
    await page.click('#suggestion-use-tab');
    await page.waitForFunction(()=>document.querySelector('#suggestion-idea-text').value.startsWith('Actual tab draft'));
    assert.equal(suggestions.length,before+1,'Loading tab writing must not send it to AI');
    await page.fill('#suggestion-idea-text','');
    await page.selectOption('#suggestion-idea-source',sourceId);
    await generate('expand_idea');
    assert.equal(requests.filter(r=>r.route==='/ai/suggestion').at(-1).payload.idea_source_id,sourceId);
    await choose('connect_dots');
    await generate('connect_dots');
    await page.click('#prompt-ai-again');
    await page.waitForFunction(()=>!document.querySelector('#prompt-ai-again').disabled);
    assert.equal(suggestions.at(-1).mode,'connect_dots');
    await page.evaluate(()=>{settings.language='es';WCi18n.setLang('es');WCi18n.applyI18n(document);renderSession();});
    assert.equal(await page.locator('#suggestion-generate').textContent(),'Generar sugerencia');
    await generate('connect_dots');
    assert.equal(requests.filter(r=>r.route==='/ai/suggestion').at(-1).payload.language,'es');
    assert.equal(await page.locator('#prompt-ai-title').textContent(),'Observa antes de decidir');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No horizontal scrolling at popup width');
    if (process.env.POPUP_SCREENSHOT) await page.screenshot({path:process.env.POPUP_SCREENSHOT,fullPage:true});
    await page.click('#prompt-ai-write');
    await page.waitForFunction(()=>!document.querySelector('#session-idea').hidden);
    assert.equal((await message({type:'GET_STATE'})).payload.active,true);
    const delta=vm.runInContext("self.WCWordCount.classifyDelta('', 'One two three four five', 'insertText')",worker);
    await message({type:'DELTA',delta});
    const paste=vm.runInContext("self.WCWordCount.classifyDelta('One two three four five', 'One two three four five pasted extra words', 'insertFromPaste')",worker);
    await message({type:'DELTA',delta:paste});
    await page.click('#primary-btn');
    await page.waitForFunction(()=>document.querySelector('#primary-btn').dataset.variant!=='danger');
    const history=(await message({type:'GET_HISTORY'})).history;
    assert.equal(history[0].typedWords,5);
    assert.equal(history[0].pastedWords,3);
    assert.ok(history[0].idea.id,'The writing history keeps the chosen idea');
    await page.evaluate(async()=>{state.active=false;await renderPrompt();showPanel('session');});
    generationStatus=429;
    await page.click('#suggestion-generate');
    await page.waitForFunction(()=>document.querySelector('#prompt-ai-status').textContent.includes('cupo diario'));
    assert.equal(await page.locator('#suggestion-generate').isEnabled(),true);
    await page.evaluate(()=>{
      els.suggestionIdeaText.value='Private draft from the previous account';
      updateSuggestionAccount({authenticated:true,userId:'another-user',aiAccess:true,online:true});
    });
    assert.equal(await page.locator('#suggestion-idea-text').inputValue(),'');
    assert.equal(await page.locator('#suggestion-saved-list button').count(),0);
    assert.equal(await page.locator('#prompt-ai-card').isHidden(),true);
    const generations=requests.filter(r=>r.route==='/ai/suggestion').length;
    const changed=await message({type:'GET_AI_SUGGESTION',expectedUserId:'another-user',currentWriting:'Private old draft',mode:'expand_idea'});
    assert.equal(changed.reason,'account_changed');
    assert.equal(requests.filter(r=>r.route==='/ai/suggestion').length,generations,'An account change must prevent sending the previous account draft');
    assert.deepEqual(errors,[]);
    console.log('PASS: real popup/background code; all modes; alternatives; Save/reload; current/selected/tab ideas; Spanish; Start/Stop; typed/pasted counts; daily-cap UI; no horizontal overflow.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
