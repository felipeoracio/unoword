/** Chromium popup regression with actual background.js, isolated Chrome/HTTP fixtures. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../../tests/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const userId='00000000-0000-4000-8000-000000000001';
// Native Chrome popups need intrinsic width; embedded previews must not force it.
for(const [protocol,embedded,expected] of [['chrome-extension:',false,true],['chrome-extension:',true,false],['http:',false,false],['http:',true,false]]){
 const hostWindow={};hostWindow.top=embedded?{}:hostWindow;
 const document={documentElement:{dataset:{}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'popup/viewport.js'),'utf8'),{location:{protocol},window:hostWindow,document});
 assert.equal(document.documentElement.dataset.popupWindow==='true',expected,`${protocol} embedded=${embedded}`);
}
const now=Date.now();
const article='Observation before action: how a neighborhood watches the tide and shares what it learns';
const longTitle=article+' — '+article+' — lessons in community, patience and practical responsibility';
const ready={id:'ready',document_title:longTitle,source_url:'https://example.com/essays/observation-before-action',enabled:true,source_kind:'link',processing_status:'ready',word_count:748,chunk_count:3,embedded_chunk_count:3,indexing_status:'indexed',last_successful_processed_at:new Date(now-60000).toISOString()};
let links=[ready,{...ready,id:'failed',document_title:'A page that needs your attention',source_url:'https://example.com/restricted',processing_status:'failed',processing_error:'This website requires sign-in. Try a public article or upload a document you can share.',chunk_count:0,indexing_status:'not_indexed',word_count:0,last_successful_processed_at:null},{...ready,id:'disabled',document_title:'Earlier notes, paused for now',enabled:false},{...ready,id:'missing',document_title:'Saved URL awaiting a complete index',chunk_count:0,indexing_status:'not_indexed'}];
const docs=[{id:'document',document_title:longTitle,source_kind:'file',processing_status:'ready',word_count:842,enabled:true,document_type:'reference'}];
const suggestion={id:'idea',user_id:userId,mode:'connect_dots',title:'What careful observation makes possible',suggestion:'Begin with the moment a ferry pilot measures the tide twice before leaving the harbor. Set this beside a potter checking witness cones in a kiln: both choose evidence over a hurried schedule. Explore how small pauses can become a form of responsibility to people who depend on the work. Let each scene carry the argument, then ask where the comparison breaks down.',reason:'Your shared notes return to observation, craft and community.',questions:['What does each person notice that a clock cannot tell them?','Who benefits when they choose to wait?','When does patience become avoidance instead of care?'],inspired_by:[{source_id:'ready',title:article,kind:'link'},{source_id:'document',title:'Blue Bowl clay workshop',kind:'file'}],related_topics:[],source_ids:['ready','document']};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:420,height:600},timezoneId:'UTC',colorScheme:'light'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const requests=[];let freeAccount=false,unsafePreview=false;
  const storage={wc_settings:{langChosen:true,plan:'pro',language:'en',wordGoal:1000,themes:['ideas'],profile:{timezone:'America/Chicago'},aiSuggestionMode:'connect_dots'},wc_state:{active:true,typedWords:438,pastedWords:500,startedAt:now-42*60000-15000,sessionGoal:1000},wc_account:{authenticated:true,userId,email:'qa@example.com',aiAccess:true,plan:'pro',online:true},wc_history:Array.from({length:5},(_,i)=>({id:i,typedWords:i===0?310:242,pastedWords:100,startedAt:now-(i*86400000)-120000,endedAt:now-i*86400000-60000}))};
  let listener;
  const chrome={storage:{local:{get:async k=>({[k]:storage[k]}),set:async v=>Object.assign(storage,v)}},runtime:{onInstalled:{addListener(){}},onMessage:{addListener:l=>listener=l},sendMessage:async m=>page.evaluate(m=>(window.backgroundListeners||[]).forEach(l=>l(m)),m).catch(()=>{})},tabs:{query:async()=>[{id:7}],sendMessage:(_id,_msg,cb)=>cb({ok:true,text:'An actual draft.'})}};
  async function fixture(url,options={}){
   const route=new URL(url).pathname.replace('/api',''),method=options.method||'GET',payload=options.body?JSON.parse(options.body):null;
   requests.push({route,method,payload});let body,status=200;
   if(route==='/auth/me')body={id:userId,email:'qa@example.com',plan:freeAccount?'free':'pro',ai_access:!freeAccount};
   else if(route==='/ai/profile')body={id:'profile',user_id:userId,ai_preferences:{prompt_themes:['ideas']}};
   else if(route==='/documents')body=docs;
   else if(route==='/links'&&method==='GET')body=links;
   else if(route==='/links'&&method==='POST'){body={...ready,id:'added',source_url:payload.url,document_title:payload.title};links.unshift(body);}
   else if(/^\/links\/[^/]+\/content$/.test(route)){const id=route.split('/')[2];body=id==='failed'?{detail:'Refresh this source to extract readable text.'}:{content:(unsafePreview?'Readable article text. <script>window.injected=true</script>':'Readable article text.')+'\nThe pilot measures the tide twice before making a decision.\n'+('Observation is a promise to the community. '.repeat(30)),truncated:false};if(id==='failed')status=409;}
   else if(/^\/links\/[^/]+\/refresh$/.test(route)){body=links.find(l=>l.id===route.split('/')[2]);Object.assign(body,{processing_status:'ready',chunk_count:3,indexing_status:'indexed',word_count:748,processing_error:null});}
   else if(/^\/links\/[^/]+$/.test(route)){const id=route.split('/')[2];if(method==='PATCH'){body=links.find(l=>l.id===id);Object.assign(body,payload.title?{document_title:payload.title}:payload);}else if(method==='DELETE'){links=links.filter(l=>l.id!==id);body={ok:true};}}
   else if(route==='/ai/memories')body=[{id:'memory',memory_type:'interest',memory:'I enjoy stories about how observation changes a decision.'}];
   else if(route==='/ai/ideas')body=[suggestion];
   else if(route==='/ai/idea-options')body=[...docs,...links].filter(l=>l.enabled).map(l=>({id:l.id,title:l.document_title,kind:l.source_kind}));
   else if(route==='/ai/suggestion')body=suggestion;
   else throw Error(`Unexpected ${method} ${route}`);
   return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  }
  const worker=vm.createContext({chrome,crypto:webcrypto,fetch:fixture,AbortController,FormData,TextEncoder,TextDecoder,URL,Date,Intl,console,setTimeout,clearTimeout});worker.self=worker;
  worker.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),worker,{filename:file}));
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),worker,{filename:'background.js'});
  const message=msg=>new Promise(resolve=>listener(msg,{},resolve));
  await page.exposeFunction('backgroundMessage',message);
  await page.addInitScript(()=>{window.backgroundListeners=[];window.chrome={runtime:{onMessage:{addListener:l=>window.backgroundListeners.push(l)},getManifest:()=>({version:'test'}),sendMessage:(m,cb)=>window.backgroundMessage(m).then(cb)}};});
  await page.route('http://popup.test/**',async r=>{const file=path.join(root,new URL(r.request().url()).pathname);await r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});});
  await page.route('https://unoword.vercel.app/api/**',async r=>{const response=await fixture(r.request().url(),{method:r.request().method(),body:r.request().postData()});await r.fulfill({status:response.status,body:await response.text(),contentType:'application/json',headers:{'access-control-allow-origin':'http://popup.test','access-control-allow-credentials':'true'}});});
  async function layout(label){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' horizontal overflow');}
  async function capture(name){await layout(name);await page.evaluate(()=>scrollTo(0,0));if(process.env.DASHBOARD_SCREENSHOTS){fs.mkdirSync(process.env.DASHBOARD_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.DASHBOARD_SCREENSHOTS,name+'.png'),fullPage:true});}}
  await page.goto('http://popup.test/popup/popup.html');
  await page.waitForFunction(()=>document.querySelector('#daily-word-count').textContent==='748');
  assert.equal(await page.locator('#daily-goal-percent').textContent(),'75%');
  assert.equal(await page.locator('#dashboard-streak').textContent(),'5 days');
  assert.equal(requests.filter(r=>r.route==='/ai/suggestion').length,0);
  await capture('write');
  await page.click('#nav-ideas');await page.click('#suggestion-generate');
  await page.waitForFunction(()=>!document.querySelector('#prompt-ai-card').hidden);
  assert.equal(await page.locator('#suggestion-questions li').count(),3);
  assert.ok((await page.locator('#prompt-ai-card').boundingBox()).width>350);
  await capture('ideas');
  await page.click('#nav-progress');await page.waitForFunction(()=>!document.querySelector('#progress-panel').hidden);
  await capture('progress');
  const stats=await message({type:'GET_STATS',range:'today'});assert.equal(stats.stats.totalWords,310,'Pasted words excluded from completed statistics');
  await page.click('#nav-library');await page.locator('[data-library-filter="links"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#link-list article').length===4);
  assert.equal(await page.locator('.wc__source-status[data-status="ready"]').count(),1);
  for(const state of ['failed','disabled','not_indexed'])assert.equal(await page.locator(`.wc__source-status[data-status="${state}"]`).count(),1);
  await page.locator('[data-testid="link-item-ready"] summary').click();
  for(const action of ['open','view','toggle','edit','refresh','delete'])assert.ok(await page.locator(`[data-testid="link-${action}-ready"]`).isVisible(),action+' action visible');
  assert.ok((await page.locator('[data-testid="link-title-ready"]').boundingBox()).width>330,'Title uses the whole card width');
  await capture('library');
  await page.click('[data-testid="link-view-ready"]');await page.waitForFunction(()=>document.querySelector('#link-content-text').textContent.includes('pilot'));
  assert.equal(await page.evaluate(()=>window.injected),undefined,'Preview text never executes source markup');
  const dialog=await page.locator('#link-content-dialog').boundingBox();assert.ok(dialog.x>=0&&dialog.x+dialog.width<=420);
  await capture('extracted-content');await page.click('#link-content-close');
  unsafePreview=true;await page.click('[data-testid="link-view-ready"]');
  await page.waitForFunction(()=>document.querySelector('#link-content-text').textContent.includes('<script>'));
  assert.equal(await page.evaluate(()=>window.injected),undefined,'Untrusted preview markup is inert text');
  await page.click('#link-content-close');unsafePreview=false;
  await page.click('[data-testid="link-edit-ready"]');await page.fill('#link-edit-title','A clearer title for the observation essay');await page.click('#link-edit-save');
  await page.waitForFunction(()=>!document.querySelector('#link-edit-dialog').open);
  assert.equal(await page.locator('[data-testid="link-title-ready"]').textContent(),'A clearer title for the observation essay');
  await page.locator('[data-testid="link-item-ready"] summary').click();await page.click('[data-testid="link-toggle-ready"]');
  await page.waitForFunction(()=>document.querySelectorAll('.wc__source-status[data-status="disabled"]').length===2);
  await page.locator('[data-testid="link-item-failed"] summary').click();await page.click('[data-testid="link-view-failed"]');await page.waitForFunction(()=>!document.querySelector('#link-content-error').hidden);
  await page.click('#link-content-close');await page.click('[data-testid="link-refresh-failed"]');await page.waitForFunction(()=>!document.querySelector('[data-testid="link-processing-error-failed"]'));
  await page.locator('[data-testid="link-item-missing"] summary').click();
  await page.click('[data-testid="link-delete-missing"]');await page.click('#confirm-ok');
  await page.waitForFunction(()=>!document.querySelector('[data-testid="link-item-missing"]'));
  assert.ok(requests.some(r=>r.method==='DELETE'&&r.route==='/links/missing'));
  // Deliberately stress every form and title at each practical width, in both languages.
  links[0].source_url='https://example.com/'+('long-url-segment/'.repeat(80));links[0].document_title=longTitle;
  for(const width of [320,360,420]){
   await page.setViewportSize({width,height:600});
   for(const lang of ['en','es']){
    await page.evaluate(async({lang,links})=>{settings.language=lang;WCi18n.setLang(lang);WCi18n.applyI18n(document);}, {lang,links});
    await page.evaluate(async items=>{links=items;renderLinks();},links);
    await page.waitForFunction(()=>document.querySelector('#library-panel').getAttribute('aria-busy')==='false');
    await layout(`links ${width} ${lang}`);
    assert.ok((await page.locator('[data-testid="link-title-ready"]').boundingBox()).width>width-95);
    for(const id of ['link-url','link-title','link-category']){const r=await page.locator('#'+id).boundingBox();assert.ok(r.width>width-70&&r.x+r.width<=width,id+' full width');}
    await page.click('#nav-ideas');await layout(`ideas ${width} ${lang}`);
    await page.evaluate(()=>{$('prompt-ai-suggestion').textContent=('A thoughtful writing direction with natural sentence spacing. ').repeat(80);});await layout(`long AI ${width} ${lang}`);
    await page.click('#nav-progress');await layout(`progress ${width} ${lang}`);
    await page.click('#nav-write');await layout(`write ${width} ${lang}`);
    if(width===320&&lang==='es')await capture('write-spanish-320');
    await page.click('#nav-library');await page.locator('[data-library-filter="links"]').click();
   }
  }
  // The screenshot regression: narrow hosts must reflow instead of colliding.
  async function assertNoCollisions(label){
   const problems=await page.evaluate(()=>{
    const failures=[];
    function separate(selectors,name){
     const boxes=selectors.map(selector=>typeof selector==='string'?document.querySelector(selector):selector).filter(el=>el&&el.getClientRects().length).map(el=>el.getBoundingClientRect());
     for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)failures.push(name+' overlaps');
     }
    }
    separate(['.wc__brand','#settings-btn'],'header');
    separate([...document.querySelectorAll('.wc__daily-hero > div')],'count and ring');
    separate([...document.querySelectorAll('.wc__daily-metrics > *')],'metrics');
    for(const button of document.querySelectorAll('.wc__main-nav button')){
     const range=document.createRange();range.selectNodeContents(button);const bounds=button.getBoundingClientRect();
     for(const rect of range.getClientRects())if(rect.left<bounds.left-1||rect.right>bounds.right+1)failures.push('navigation text spills');
    }
    const count=document.querySelector('#daily-word-count');const range=document.createRange();range.selectNodeContents(count);const column=count.parentElement.getBoundingClientRect();
    if(range.getBoundingClientRect().right>column.right+1)failures.push('word count spills into ring');
    return failures;
   });assert.deepEqual(problems,[],label);
  }
  await page.setViewportSize({width:194,height:600});
  await page.evaluate(()=>{document.documentElement.dataset.popupWindow='true';});
  assert.equal(await page.evaluate(()=>document.documentElement.getBoundingClientRect().width),420,'Native popup keeps intrinsic width even during Chrome initial narrow layout');
  await page.setViewportSize({width:420,height:600});
  await page.click('#nav-write');
  await page.evaluate(()=>{settings.language='en';WCi18n.setLang('en');WCi18n.applyI18n(document);renderSession();});
  await assertNoCollisions('native 420px popup');await capture('write-native-420');
  await page.evaluate(()=>{delete document.documentElement.dataset.popupWindow;});
  for(const width of [180,194,240,280,320,420]){
   await page.setViewportSize({width,height:600});
   for(const lang of ['en','es']){
    await page.evaluate(lang=>{settings.language=lang;WCi18n.setLang(lang);WCi18n.applyI18n(document);renderSession();showPanel('session');},lang);
    await layout(`narrow Write ${width} ${lang}`);await assertNoCollisions(`narrow Write ${width} ${lang}`);
    if(width===194&&lang==='en')await capture('write-194');
    await page.click('#nav-ideas');await layout(`narrow Ideas ${width} ${lang}`);
    await page.click('#nav-progress');await layout(`narrow Progress ${width} ${lang}`);
    await page.click('#nav-library');await page.locator('[data-library-filter="links"]').click();await layout(`narrow Library ${width} ${lang}`);
   }
  }
  await page.setViewportSize({width:420,height:600});await page.click('#nav-library');
  await page.locator('[data-library-filter="documents"]').click();await layout('long document title');
  await page.locator('[data-library-filter="memory"]').click();assert.ok((await page.locator('#library-memory-list').textContent()).includes('observation'));
  await page.locator('[data-library-filter="saved"]').click();assert.equal(await page.locator('#suggestion-saved-list button').count(),1);
  freeAccount=true;
  await message({type:'SET_SETTINGS',settings:{plan:'free'}});
  await page.evaluate(()=>{settings.plan='free';renderSession();});
  await page.click('#nav-ideas');assert.ok(await page.locator('label:has(input[value="original"])').isVisible());
  assert.equal(await page.locator('.wc__mode-option:visible').count(),1);
  assert.ok(await page.locator('#prompt-text').isVisible());
  await page.click('#nav-library');
  assert.ok(await page.locator('#library-access').isVisible());
  // Real embedded host at the screenshot's width, with a zero-word Free account.
  storage.wc_state={active:false,typedWords:0,pastedWords:0};storage.wc_history=[];
  await page.route('http://popup.test/sizing-host',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0;background:#edf2f9"><iframe title="Uno Word preview" src="/popup/popup.html" width="194" height="600" style="display:block;border:0;background:white"></iframe></body></html>'}));
  await page.goto('http://popup.test/sizing-host');
  const frame=page.frameLocator('iframe');await frame.locator('#nav-write').click();
  await frame.locator('#primary-btn').waitFor({state:'visible'});
  assert.equal(await frame.locator('#daily-word-count').textContent(),'0');
  assert.ok(await frame.locator('html').evaluate(el=>el.scrollWidth<=innerWidth),'Embedded preview has no horizontal overflow');
  assert.equal(await frame.locator('html').getAttribute('data-popup-window'),null,'Embedded host stays responsive');
  if(process.env.DASHBOARD_SCREENSHOTS)await page.locator('iframe').screenshot({path:path.join(process.env.DASHBOARD_SCREENSHOTS,'preview-194-free.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: four views; real session statistics; 180–420px; native intrinsic width; embedded 194px Free preview; English/Spanish; long text; all website actions; safe extracted preview; edit/toggle/refresh; library resources; Free access panels.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
