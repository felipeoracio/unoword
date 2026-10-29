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
    let accountPlan = 'pro', generationGate = null;
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
      if (route==='/auth/me') {body={id:userId,email:'qa@example.com',plan:accountPlan,ai_access:accountPlan==='pro'};if(accountPlan==='signed_out') {status=401;body={detail:'Authentication required'};}}
      else if (['/documents','/links','/ai/memories'].includes(route)) body=[];
      else if (route==='/ai/ideas') body=saved;
      else if (route==='/ai/idea-options') body=[{id:sourceId,title:'Solar ferry notes',kind:'file'}];
      else if(route.startsWith('/progress/streak'))body={user_id:userId,displayedStreak:1,hasUnlimitedStreakAccess:accountPlan==='pro',streakLimitReached:false,timezone:'UTC',asOf:new Date().toISOString()};
      else if(route==='/progress/sessions')body={synced:1};
      else if(route==='/progress/clear')body={cleared:true};
      else if (route.startsWith('/ai/usage/summary')) body={version_id:'v2',legacy_shared:false,timezone:'America/Chicago',daily_reset_at:new Date(Date.now()+86400000).toISOString(),monthly_reset_at:new Date(Date.now()+30*86400000).toISOString(),suggestions_monthly_used:suggestions.length,suggestions_monthly_limit:200,suggestions_monthly_remaining:200-suggestions.length,guidance_monthly_used:0,guidance_monthly_limit:30,guidance_monthly_remaining:30,user_id:userId,date:new Date().toISOString().slice(0,10),daily_limit:100,used_today:suggestions.length,pending_today:0,remaining:100-suggestions.length};
      else if (route==='/ai/suggestion') {
        if(generationGate)await generationGate;
        status=generationStatus;
        if(status===403)accountPlan='free';
        const es=payload.language==='es';
        body=status===200 ? {
          id:`00000000-0000-4000-8000-${String(suggestions.length+10).padStart(12,'0')}`,
          user_id:userId,mode:payload.mode,title:es?'Observa antes de decidir':`A direction for ${payload.mode}`,
          suggestion:es?'Explora cómo observar cambia una decisión.':'Explore how observation changes a decision.',reason:'Based on your material.',
          questions:es?['¿Qué observas?','¿Qué cambia?','¿Por qué importa?']:['What do you observe?','What changes?','Why does it matter?'],
          inspired_by:[{source_id:sourceId,title:'Solar ferry notes',kind:'file'}],related_topics:[],source_ids:[sourceId],
        } : {detail:'Daily AI suggestion limit reached'};
        if (status===200) suggestions.push(body);
        if (status===200 && payload.writing_progress) {
          const p=payload.writing_progress,remaining=Math.max(0,(p.daily_goal||250)-p.words_written_today),target=Math.min(2000,remaining);
          body.writing_task={daily_goal:p.daily_goal,words_written_today:p.words_written_today,remaining_words:remaining,target_words:target,goal_reached:remaining===0,timezone:p.timezone,date:p.date,
            outline:target>=750?['Introduction','A first lesson','A second lesson','A third lesson','Conclusion'].map((title,i)=>({title,words:[200,500,500,500,300][i]*target/2000})):[]};
        }
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
      window.chrome={runtime:{onMessage:{addListener:listener=>window.backgroundListeners.push(listener)},getManifest:()=>({version:'test'}),sendMessage:(msg,callback)=>window.backgroundMessage(msg).then(response=>{callback(response);if(msg.type==='GET_AI_SUGGESTION')window.completedAI=(window.completedAI||0)+1;})}};
    });
    await page.route('http://popup.test/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      const file=path.join(root,pathname);
      const contentType=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';
      await route.fulfill({body:fs.readFileSync(file),contentType});
    });
    await page.route('https://unoword.vercel.app/api/**',async route=>{
      const response=await fetchFixture(route.request().url(),{method:route.request().method(),body:route.request().postData()});
      await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json',headers:{'access-control-allow-origin':'http://popup.test','access-control-allow-credentials':'true'}});
    });
    async function capture(name){
      if(!process.env.SUGGESTION_SCREENSHOTS)return;
      fs.mkdirSync(process.env.SUGGESTION_SCREENSHOTS,{recursive:true});
      const viewport=page.viewportSize();await page.setViewportSize({width:420,height:600});await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:path.join(process.env.SUGGESTION_SCREENSHOTS,name+'.png'),fullPage:true});await page.setViewportSize(viewport);
    }
    await page.goto('http://popup.test/popup/popup.html');
    await page.click('#nav-ideas');
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
    assert.ok((await page.locator('#suggestion-writing-task').textContent()).includes('About 250 words'));
    await page.waitForFunction(()=>document.querySelector('#ai-usage-meta').textContent.includes('1 of 100 AI requests used'));
    assert.ok((await page.locator('#ai-usage-meta').textContent()).includes('Shared with the editor'));
    await message({type:'SET_SETTINGS',settings:{wordGoal:1000}});
    storage.wc_history=[{id:'today',startedAt:Date.now()-1000,typedWords:750,pastedWords:500}];
    await generate('new_topic');
    const progressPayload=requests.filter(r=>r.route==='/ai/suggestion').at(-1).payload.writing_progress;
    assert.equal(progressPayload.daily_goal,1000);assert.equal(progressPayload.words_written_today,750,'Pasted words are excluded');
    assert.equal(suggestions.at(-1).writing_task.target_words,250);
    await message({type:'SET_SETTINGS',settings:{wordGoal:2000}});storage.wc_history=[];
    await generate('new_topic');
    assert.equal(await page.locator('#suggestion-writing-task input[type=checkbox]').count(),5);
    await page.locator('#suggestion-writing-task input').first().check();
    const generated=suggestions.length;
    storage.wc_history=[{id:'new-progress',startedAt:Date.now()-1000,typedWords:1000}];
    await page.evaluate(()=>refreshProgress());
    assert.equal(suggestions.length,generated,'Progress updates do not call AI or replace the active task');
    assert.equal(suggestions.at(-1).writing_task.target_words,2000,'Task snapshot remains fixed while writing');
    await capture('goal-task-2000');
    await page.click('#prompt-ai-again');
    await page.waitForFunction(()=>!document.querySelector('#prompt-ai-again').disabled);
    assert.equal(suggestions.at(-1).mode,'new_topic');
    await page.locator('#suggestion-writing-task input').first().check();
    await page.click('#suggestion-save');
    await page.waitForFunction(()=>document.querySelector('#suggestion-save').textContent==='Saved');
    await page.reload();
    await page.click('#nav-library');
    await page.locator('[data-library-filter="saved"]').click();
    await page.locator('#suggestion-saved-list button').first().click();
    assert.equal(await page.locator('#suggestion-save').textContent(),'Saved');
    assert.equal(await page.locator('#suggestion-writing-task input').first().isChecked(),true,'Saved task checklist survives reopen');
    await message({type:'SET_SETTINGS',settings:{wordGoal:1000}});
    await generate('new_topic');
    assert.ok((await page.locator('#suggestion-writing-task').textContent()).includes('Goal complete'));
    assert.equal(await page.locator('#suggestion-writing-task input').count(),0);
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
    await page.evaluate(async()=>{state.active=false;await renderPrompt();showPanel('ideas');});
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
    // A subscription expiring between preflight and POST must switch to Original.
    generationStatus=403;
    await page.evaluate(async()=>{await renderPrompt();showPanel('ideas');});
    await choose('new_topic');await page.click('#suggestion-generate');
    await page.waitForFunction(()=>document.querySelectorAll('.wc__mode-option:not([hidden])').length===1&&!document.querySelector('#prompt-text').hidden);
    assert.equal(await page.locator('input[value="original"]').isChecked(),true);
    accountPlan='pro';
    // Both plans reuse the same cache, picker and history; Original never calls AI.
    generationStatus=200;
    await message({type:'SET_SETTINGS',settings:{language:'en'}});
    await page.evaluate(async()=>{settings.language='en';WCi18n.setLang('en');WCi18n.applyI18n(document);await renderPrompt();showPanel('ideas');});
    assert.equal(await page.locator('.wc__mode-option:visible').count(),4);
    const paidCalls=requests.filter(r=>r.route==='/ai/suggestion').length;
    await choose('original');await page.waitForFunction(()=>!document.querySelector('#prompt-text').hidden);
    assert.equal(await page.locator('#suggestion-generate').isHidden(),true);
    const cached=JSON.parse(JSON.stringify(storage.wc_prompt));
    assert.equal(await page.locator('#prompt-text').textContent(),cached.text);
    await capture('pro-original');
    await page.reload();await page.click('#nav-ideas');
    assert.equal(await page.locator('input[value="original"]').isChecked(),true);
    assert.equal(await page.locator('#prompt-text').textContent(),cached.text,'Reopening retains the same daily Original prompt');
    vm.runInContext('Math.random=()=>0.25',worker);
    await page.click('#prompt-another');await page.waitForFunction(()=>!document.querySelector('#prompt-another').disabled);
    const proAnother=JSON.parse(JSON.stringify(storage.wc_prompt));assert.notEqual(proAnother.promptId,cached.promptId);
    accountPlan='free';storage.wc_prompt=JSON.parse(JSON.stringify(cached));
    // Even a stale local Pro setting cannot override the authenticated entitlement.
    await page.evaluate(async()=>{await renderPrompt();showPanel('ideas');});
    assert.equal(await page.locator('.wc__mode-option:visible').count(),1);
    assert.equal(await page.locator('input[value="original"]').isChecked(),true);
    assert.equal(await page.locator('#prompt-text').textContent(),cached.text);
    await page.click('#prompt-another');await page.waitForFunction(()=>!document.querySelector('#prompt-another').disabled);
    assert.deepEqual(JSON.parse(JSON.stringify(storage.wc_prompt)),proAnother,'Original uses identical selection, history and limits on Free and Pro');
    await page.evaluate(async()=>{await selectSuggestionMode('new_topic');await refreshAiSuggestion();});
    assert.equal(await page.locator('.wc__mode-option:visible').count(),1,'Free cannot programmatically select an AI mode');
    const denied=await message({type:'GET_AI_SUGGESTION',mode:'new_topic'});assert.equal(denied.reason,'plan_required');
    assert.equal(requests.filter(r=>r.route==='/ai/suggestion').length,paidCalls,'Original and Free gating never spend AI allowance');
    accountPlan='signed_out';storage.wc_settings.plan='free';
    await page.evaluate(async()=>{settings.plan='free';await renderPrompt();showPanel('ideas');});
    assert.equal(await page.locator('.wc__mode-option:visible').count(),1);
    assert.ok(await page.locator('#prompt-text').isVisible(),'Original does not require authentication');
    await capture('free-original');
    accountPlan='pro';await page.evaluate(async()=>{await renderPrompt();showPanel('ideas');});
    assert.equal(await page.locator('.wc__mode-option:visible').count(),4,'Server upgrade restores all four despite a stale local Free setting');
    await choose('new_topic');
    let release;generationGate=new Promise(resolve=>release=resolve);
    const previousRequests=requests.filter(r=>r.route==='/ai/suggestion').length;
    const completedBefore=await page.evaluate(()=>window.completedAI||0);
    await page.click('#suggestion-generate');
    for(let attempt=0;requests.filter(r=>r.route==='/ai/suggestion').length===previousRequests;attempt++){
      assert.ok(attempt<100,'Pending generation reached HTTP boundary');await new Promise(resolve=>setTimeout(resolve,10));
    }
    accountPlan='free';await page.evaluate(async()=>{await renderPrompt();showPanel('ideas');});
    release();generationGate=null;await page.waitForFunction(before=>(window.completedAI||0)>before,completedBefore);
    assert.equal(await page.locator('.wc__mode-option:visible').count(),1,'Late AI response cannot restore expired Pro access');
    assert.ok(await page.locator('#prompt-ai-card').isHidden());assert.ok(await page.locator('#prompt-text').isVisible());
    const endingCalls=requests.filter(r=>r.route==='/ai/suggestion').length;
    for(const lang of ['en','es']){
      await message({type:'SET_SETTINGS',settings:{language:lang}});
      await page.evaluate(async lang=>{settings.language=lang;WCi18n.setLang(lang);WCi18n.applyI18n(document);await renderPrompt();showPanel('ideas');},lang);
      assert.equal(await page.locator('.wc__mode-option:visible').count(),1);
      assert.ok((await page.locator('#prompt-text').textContent()).trim().length>0);
      assert.ok(storage.wc_prompt.promptId.startsWith(lang+':'));
    }
    assert.equal(requests.filter(r=>r.route==='/ai/suggestion').length,endingCalls);
    for(const width of [180,194,320,420]){
      await page.setViewportSize({width,height:600});
      for(const lang of ['en','es']){
        await message({type:'SET_SETTINGS',settings:{language:lang}});
        await page.evaluate(async lang=>{settings.language=lang;WCi18n.setLang(lang);WCi18n.applyI18n(document);await renderPrompt();showPanel('ideas');},lang);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Free Original ${width} ${lang} has no horizontal overflow`);
        assert.equal(await page.locator('.wc__mode-option:visible').count(),1);
      }
    }
    accountPlan='pro';await page.evaluate(async()=>{await renderPrompt();showPanel('ideas');});
    for(const width of [180,194,320,420]){
      await page.setViewportSize({width,height:600});
      for(const lang of ['en','es']){
        await message({type:'SET_SETTINGS',settings:{language:lang}});
        await page.evaluate(async lang=>{settings.language=lang;WCi18n.setLang(lang);WCi18n.applyI18n(document);await renderPrompt();showPanel('ideas');},lang);
        assert.equal(await page.locator('.wc__mode-option:visible').count(),4);
        for(const mode of ['original','new_topic','expand_idea','connect_dots']){
          await choose(mode);
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Pro ${mode} ${width} ${lang} has no horizontal overflow`);
        }
      }
    }
    await choose('original');
    const beforeOffline=requests.length;
    await page.evaluate(async()=>{account.online=false;await renderPrompt();showPanel('ideas');});
    assert.ok(await page.locator('#prompt-text').isVisible(),'Original works offline on Pro');
    assert.equal(requests.length,beforeOffline,'Offline Original needs no network request');

    assert.ok(requests.filter(r=>r.route==='/ai/suggestion').every(r=>['new_topic','expand_idea','connect_dots'].includes(r.payload.mode)),'Original is never forwarded to the AI endpoint');
    assert.deepEqual(errors,[]);
    console.log('PASS: Original on Free/Pro; identical cache/history/rotation; no AI charge; signed out; upgrade/downgrade; late-response guard; all AI modes; real popup/background code; all modes; alternatives; Save/reload; current/selected/tab ideas; Spanish; Start/Stop; typed/pasted counts; daily-cap UI; no horizontal overflow.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
