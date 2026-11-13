/** Production bundle with private HTTP fixtures. No real user or paid AI calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const origin=process.env.WRITING_TEST_ORIGIN||'http://localhost:4175';
const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const empty={type:'doc',content:[{type:'paragraph'}]};
const plain=n=>n.type==='text'?n.text:(n.content||[]).map(plain).join(['doc','listItem','bulletList','orderedList','taskList','taskItem','table','tableRow','tableCell','tableHeader'].includes(n.type)?'\n':'');
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,sorted(v)])):value;
(async()=>{
 const browser=await chromium.launch({headless:process.env.FOCUS_HEADED!=='1'&&process.env.PROJECT_HEADED!=='1'&&process.env.POLISH_HEADED!=='1',executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,hasTouch:process.env.FOCUS_MODE_ONLY==='1'||process.env.PROJECT_SWITCH_ONLY==='1'||process.env.EDITOR_POLISH_ONLY==='1',
   recordVideo:process.env.NAV_GUARD_VIDEO==='1'?{dir:path.resolve('tests/artifacts/navigation-motion/guard-video'),size:{width:1440,height:1000}}:process.env.POLISH_RECORD_VIDEO==='1'?{dir:path.resolve('tests/artifacts/editor-polish/video'),size:{width:1440,height:1000}}:process.env.PROJECT_RECORD_VIDEO==='1'?{dir:path.resolve('tests/artifacts/project-motion/video'),size:{width:1440,height:1000}}:process.env.FOCUS_RECORD_VIDEO==='1'&&process.env.FOCUS_LAB_ONLY!=='1'?{dir:path.resolve('tests/artifacts/focus/video'),size:{width:1440,height:1000}}:undefined});context.setDefaultTimeout(15000);
  let signedIn=false,pro=true,offline=false,failSave=false,failFolders=false,conflictNext=false,currentOwner=owner,aiUsed=0,aiPending=0,guidanceRemaining=30,monthlyRemaining=200,legacy=false,failIdeaSave=false;
  const savedCoachIdeas=new Map();
  const documents=new Map(),activity=new Map(),folders=[];let preferenceState={user_id:owner,revision:1,daily_goal:250,timezone:'America/Chicago',language:'en',themes:['ideas']};const requests=[],errors=[];
  const profile={id:'profile',user_id:owner,writing_goal:'Essays about craft and community',primary_topics:['craft','community'],favorite_subjects:['attention'],current_projects:[],avoid_topics:[],writing_style:'Reflective and clear',audience:'Curious readers',personal_context:'',ai_preferences:{prompt_themes:['ideas']}};
  const sources=[{id:'00000000-0000-4000-8000-000000000009',document_title:'Notes on building a garden',enabled:true,source_kind:'file'}];
  const projectNetwork={saveGate:null,readGate:null,selectionGate:null,failRead:false,failSelection:false};
  const polishNetwork={aiGate:null,failAI:false,evidence:false};
  const projectFixture=require('./helpers/project-fixture.cjs').projectsFixture(()=>currentOwner,()=>[...documents.values()]);
  await context.route(origin+'/api/**',async route=>{
   if(offline)return route.abort('internetdisconnected');
   const req=route.request(),url=new URL(req.url()),key=url.pathname.replace('/api',''),method=req.method();
   const body=req.postData()?JSON.parse(req.postData()):null;requests.push({key,method,body});let status=200,value;
   if(key==='/workspace/assistant'){
    if(polishNetwork.aiGate)await polishNetwork.aiGate;
    if(polishNetwork.failAI)return route.fulfill({status:503,json:{detail:'synthetic_guidance_unavailable'}});
   }
   if(/^\/workspace\/documents\/[^/]+$/.test(key)){
    if(method==='PUT'&&projectNetwork.saveGate)await projectNetwork.saveGate;
    if(method==='GET'&&projectNetwork.readGate)await projectNetwork.readGate;
    if(method==='GET'&&projectNetwork.failRead)return route.fulfill({status:503,json:{detail:'synthetic_document_unavailable'}});
   }
   if(key==='/workspace/projects/active'&&method==='PUT'){
    if(projectNetwork.selectionGate)await projectNetwork.selectionGate;
    if(projectNetwork.failSelection)return route.fulfill({status:503,json:{detail:'synthetic_project_unavailable'}});
   }

   if(!signedIn){status=401;value={detail:'Authentication required'};}
   else if(key.startsWith('/workspace/projects')){const result=projectFixture(key,method,body);status=result.status;value=result.value;}
   else if(key==='/subscription/substack'){value={user_id:currentOwner,configured:false,available:false,connected:false,active:false,subscriptions:[],pending_request:null};}
   else if(key==='/rewards'){status=503;value={detail:'rewards_setup_required'};}
   else if(key==='/auth/me')value={id:currentOwner,email:currentOwner===owner?'writer@example.com':'other@example.com',plan:pro?'pro':'free',ai_access:pro};
   else if(key==='/auth/refresh')value={authenticated:true};
   else if(key==='/progress/preferences'){
    if(method==='PUT')preferenceState={...preferenceState,...body,revision:preferenceState.revision+1};
    value={...preferenceState,user_id:currentOwner};
   }
   else if(key==='/progress/summary')value={user_id:currentOwner,reportingDate:new Date().toISOString().slice(0,10),timezone:'America/Chicago',dailyWordCount:[...activity.values()].reduce((n,a)=>n+a.typed_words,0),dailyActiveWritingSeconds:[...activity.values()].reduce((n,a)=>n+a.duration_seconds,0),lifetimeActiveWritingSeconds:[...activity.values()].reduce((n,a)=>n+a.duration_seconds,0),dailyGoal:preferenceState.daily_goal,displayedStreak:pro?15:7,updatedAt:new Date().toISOString(),sessions:[]};
   else if(key==='/progress/streak')value={user_id:currentOwner,displayedStreak:pro?15:7,hasUnlimitedStreakAccess:pro,streakLimitReached:!pro,journeyContinues:!pro,timezone:'America/Chicago',asOf:new Date().toISOString()};
   else if(key==='/ai/profile'&&method==='GET')value=profile;
   else if(key==='/ai/usage/summary')value={version_id:'v2',version_name:'Coach',legacy_shared:legacy,timezone:'America/Chicago',daily_reset_at:new Date(Date.now()+86400000).toISOString(),monthly_reset_at:new Date(Date.now()+30*86400000).toISOString(),suggestions_monthly_limit:200,suggestions_monthly_used:200-monthlyRemaining,suggestions_monthly_remaining:monthlyRemaining,guidance_monthly_limit:30,guidance_monthly_used:30-guidanceRemaining,guidance_monthly_remaining:guidanceRemaining,warning_percent:80,user_id:currentOwner,date:new Date().toISOString().slice(0,10),daily_limit:100,used_today:aiUsed,pending_today:aiPending,remaining:Math.max(0,100-aiUsed-aiPending)};
   else if(key==='/ai/profile'&&method==='PUT'){assert.equal(body.expected_user_id,currentOwner);Object.assign(profile,body);value=profile;}
   else if(key==='/onboarding')value={version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
   else if(key==='/workspace/config')value={daily_goal:250,max_document_chars:200000,max_upload_bytes:5242880,ai_batch_size:3};
   else if(key==='/workspace/documents')value=[...documents.values()].filter(d=>d.user_id===currentOwner && (!url.searchParams.get('q') || (d.title+' '+d.plain_text).toLowerCase().includes(url.searchParams.get('q').toLowerCase()))).slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+200).map(({content,plain_text,...metadata})=>metadata);
   else if(/^\/workspace\/documents\/[^/]+\/completion$/.test(key)){
    const existing=documents.get(key.split('/')[3]);
    if(!pro){status=403;value={detail:'writing_workspace_pro_required'};}
    else if(failSave){status=503;value={detail:'workspace_storage_unavailable'};}
    else if(!existing||existing.user_id!==currentOwner){status=404;value={detail:'not_found'};}
    else if(existing.mutation_id===body.mutation_id)value=existing;
    else if(existing.revision!==body.revision){status=409;value={detail:'revision_conflict'};}
    else{value={...existing,completion_status:body.completion_status,completed_at:body.completion_status==='completed'?new Date().toISOString():null,revision:existing.revision+1,mutation_id:body.mutation_id};documents.set(existing.id,structuredClone(value));}
   }
   else if(/^\/workspace\/documents\/[^/]+$/.test(key)){
    const id=key.split('/').pop(),existing=documents.get(id);
    if(method==='GET'){value=existing?.user_id===currentOwner?existing:{detail:'not_found'};if(!existing)status=404;}
    else if(failSave){status=503;value={detail:'workspace_storage_unavailable'};}
    else if(body.expected_user_id!==currentOwner){status=409;value={detail:'account_changed'};}
    else if(existing?.mutation_id===body.mutation_id)value=existing;
    else if(conflictNext||existing&&existing.revision!==body.revision){
     if(conflictNext){existing.revision++;existing.title='Cloud title';existing.content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'A newer thought saved in another tab.'}]}]};existing.plain_text=plain(existing.content);conflictNext=false;}
     status=409;value={detail:'revision_conflict'};
    }else{
     let content=body.content;
     if((process.env.EDITOR_FORMATTING_ONLY==='1'||process.env.EDITOR_MEDIA_ONLY==='1') && process.env.FORMATTING_PYTHON){
      const result=require('node:child_process').spawnSync(process.env.FORMATTING_PYTHON,['-c','import sys,json;from lib.writing_document import clean_document;print(json.dumps(clean_document(json.load(sys.stdin))))'],{input:JSON.stringify(content),encoding:'utf8',env:{...process.env,PYTHONPATH:path.resolve('backend')}});
      assert.equal(result.status,0,result.stderr);content=JSON.parse(result.stdout);
     }
     value={...body,content:sorted(content),id,user_id:currentOwner,plain_text:plain(content),revision:(existing?.revision||0)+1,created_at:existing?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};delete value.expected_user_id;documents.set(id,structuredClone(value));}
   }else if(key==='/workspace/folders'&&method==='GET')value=folders;
   else if(key==='/workspace/folders'){value={id:crypto.randomUUID(),name:body.name};folders.push(value);}
   else if(key.startsWith('/workspace/folders/')){
    if(failFolders){status=503;value={detail:'workspace_storage_unavailable'};}
    else{const id=key.split('/').pop();value=folders.find(f=>f.id===id)||{id,name:body.name};if(!folders.some(f=>f.id===id))folders.push(value);}
   }
   else if(key==='/workspace/trash/empty'){
    if(!pro||!body.confirm){status=403;value={detail:'forbidden'};}
    else if(failSave){status=503;value={detail:'workspace_storage_unavailable'};}
    else{
     const removed=[],deleted=[],changed=[];
     for(const item of body.documents){const d=documents.get(item.id);if(d?.user_id===currentOwner&&d.status==='trashed'&&d.revision===item.revision){documents.delete(d.id);deleted.push(d.id);for(const [id,a] of activity)if(a.document_id===d.id){const next={...a,document_id:null,timer:a.timer?{...a.timer,status:'ended'}:undefined};activity.set(id,next);changed.push(next);}}if(!documents.has(item.id))removed.push(item.id);}
     value={deleted_ids:deleted,removed_ids:removed,activities:changed};
    }
   }
   else if(key==='/workspace/activity'&&method==='GET')value=[...activity.values()].map(a=>({...a,user_id:currentOwner,source:'editor',updated_at:new Date().toISOString()}));
   else if(key==='/workspace/activity'){assert.ok(Object.keys(body).every(k=>['id','document_id','expected_user_id','started_at','typed_words','pasted_words','duration_seconds','sequence','timer','device_id','active_intervals'].includes(k)),'Restored sessions strip database-only fields');const prev=activity.get(body.id);if(!prev||prev.sequence<body.sequence)activity.set(body.id,body);value=activity.get(body.id);}
   else if(key==='/workspace/sources')value=sources;
   else if(key==='/processing/run'){
    assert.equal(pro,true);Object.assign(sources[0],{processing_status:'ready',processing_phase:'complete',processing_progress:100});status=202;value={accepted:true};
   }
   else if(key.startsWith('/workspace/sources/')){Object.assign(sources[0],body);value=sources[0];}
   else if(key.startsWith('/ai/suggestions/')&&key.endsWith('/save')){
    assert.equal(pro,true);if(failIdeaSave){status=503;value={detail:'unavailable'};}else{const id=key.split('/')[3];value={id,user_id:currentOwner,title:'Saved coaching direction'};savedCoachIdeas.set(id,value);}
   }
   else if(key==='/workspace/assistant'){
    assert.equal(pro,true);assert.equal(body.consent,true);assert.equal(body.expected_user_id,currentOwner);
    const guidance=['guidance','organization','research','feedback'].includes(body.action);if(guidance&&!legacy)guidanceRemaining--;else{aiUsed++;monthlyRemaining--;}
    value={items:Array.from({length:guidance?1:3},(_,i)=>({title:['The quiet value of practice','How small gardens teach patience','What we learn by paying attention'][i],text:'Consider a detail grounded in your interests in craft and community. What could you explore next?'}))};
    for(const [index,item] of value.items.entries()){
     const p=body.writing_progress,remaining=Math.max(0,p.daily_goal-p.words_written_today),target=Math.min(2000,remaining);
     const sizes=[10,25,25,25].map(percent=>Math.floor(target*percent/100));sizes.push(target-sizes.reduce((a,b)=>a+b,0));
     item.id='task-'+requests.filter(r=>r.key==='/workspace/assistant').length+'-'+index;
     if(polishNetwork.evidence&&body.current_text)item.inspired_by=[{kind:'editor_document',source_id:body.document_id,title:'Sample reference'}];
     item.writing_task={...p,remaining_words:remaining,target_words:target,goal_reached:remaining===0,outline:target>=750?['Opening','Observation','Questions','Perspective','Conclusion'].map((title,i)=>({title,words:sizes[i]})):[]};
    }
   }else throw Error('Unexpected fixture endpoint '+method+' '+key);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  });
  if(process.env.WRITING_IMAGES_ONLY==='1')await context.addInitScript(owner=>localStorage.setItem('uno-tour-launch-hidden:'+owner,'1'),owner);
  const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
  if(process.env.WRITING_PERFORMANCE_ONLY==='1'){
   context.setDefaultTimeout(30000);
   const cdp=await context.newCDPSession(page);
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});
   await page.addInitScript(()=>{
    window.__studioLab={lcp:0,longTasks:[],layoutShift:0};
    for(const [type,callback] of [
     ['largest-contentful-paint',entries=>{window.__studioLab.lcp=entries.at(-1)?.startTime||0;}],
     ['longtask',entries=>window.__studioLab.longTasks.push(...entries.map(e=>e.duration))],
     ['layout-shift',entries=>{for(const e of entries)if(!e.hadRecentInput)window.__studioLab.layoutShift+=e.value;}],
    ])if(PerformanceObserver.supportedEntryTypes.includes(type))new PerformanceObserver(list=>callback(list.getEntries())).observe({type,buffered:true});
   });
  }
  if(process.env.EDITOR_MEDIA_ONLY==='1'){
   await require('./helpers/editor-media-flow.cjs')({page,context,origin,documents,activity,requests,errors,setSignedIn:v=>signedIn=v,setOffline:v=>offline=v,setFailSave:v=>failSave=v});
   return;
  }
  if(process.env.EDITOR_FORMATTING_ONLY==='1'){
   await require('./helpers/editor-formatting-flow.cjs')({page,context,origin,documents,activity,requests,errors,setSignedIn:v=>signedIn=v,setOffline:v=>offline=v,setFailSave:v=>failSave=v});
   return;
  }
  if(process.env.EDITOR_CANVAS_ONLY==='1'){
   await require('./helpers/editor-canvas-flow.cjs')({page,context,origin,documents,activity,requests,errors,setSignedIn:v=>signedIn=v});
   return;
  }
  if(process.env.EDITOR_POLISH_ONLY==='1'){
   await require('./helpers/editor-polish-flow.cjs')({page,context,origin,documents,activity,requests,errors,network:polishNetwork,projectNetwork,setSignedIn:v=>signedIn=v,setOffline:v=>offline=v,setFailSave:v=>failSave=v});
   if(process.env.POLISH_PAUSE==='1')await page.pause();
   return;
  }
  if(process.env.PROJECT_SWITCH_ONLY==='1'){
   await require('./helpers/project-switch-flow.cjs')({page,context,origin,documents,activity,requests,fixture:projectFixture,setSignedIn:v=>signedIn=v,setFailSave:v=>failSave=v,setOffline:v=>offline=v,network:projectNetwork,errors});
   if(process.env.PROJECT_PAUSE==='1')await page.pause();
   return;
  }
  if(process.env.PROJECTS_ONLY==='1'){await require('./helpers/project-browser-flow.cjs')({page,context,origin,documents,requests,fixture:projectFixture,setSignedIn:v=>signedIn=v,setFailSave:v=>failSave=v,setOffline:v=>offline=v,errors});await context.close();return;}
  await page.goto(origin+'/editor');await page.getByRole('heading',{name:'Sign in to write'}).waitFor();
  assert.equal(await page.locator('[contenteditable=true]').count(),0,'Signed-out users cannot write');
  signedIn=true;await page.reload();await page.getByRole('button',{name:'Start New Document',exact:true}).click();
  await page.getByRole('textbox',{name:'Rename document'}).fill('The practice of paying attention');
  const canvas=page.getByRole('textbox',{name:'Document content'});
  await canvas.fill('One small moment can become a meaningful story.');
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved')).catch(async error=>{console.error('Save state:',await page.locator('.uw-editor-save').textContent(),'Notices:',await page.locator('.uw-editor-notice').allTextContents(),'Recent calls:',requests.slice(-8), 'DBs:', await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('uno-word-writing',1);r.onsuccess=()=>{const q=r.result.transaction('records').objectStore('records').getAll();q.onsuccess=()=>resolve(q.result.map(e=>({key:e.key,updated:e.value.updated_at,mutation:e.value.mutation_id,title:e.value.title,text:e.value.plain_text})))}})));throw error;});
  let saved=[...documents.values()][0];assert.ok(saved.plain_text.includes('meaningful story'));
  if(process.env.NAVIGATION_GUARD_ONLY==='1'){
   await require('./helpers/navigation-guard-flow.cjs')({page,canvas,documents,activity,requests,errors,projectNetwork,setFailSave:value=>failSave=value});return;
  }
  if(process.env.FOCUS_MODE_ONLY==='1'){
   await require('./helpers/focus-mode-flow.cjs')({page,canvas,context,documents,activity,requests,errors,setOffline:v=>offline=v,setFailSave:v=>failSave=v});
   if(process.env.FOCUS_PAUSE==='1')await page.pause();
   return;
  }
  if(process.env.WRITING_PERFORMANCE_ONLY==='1'){
   await require('./helpers/studio-performance-flow.cjs')({page,canvas,documents,requests,errors});return;
  }
  if(process.env.WRITING_COACH_ONLY==='1'){
   const calls=()=>requests.filter(r=>r.key==='/workspace/assistant');
   const content=await canvas.textContent(),sessions=activity.size;
   const capture=async name=>{if(process.env.WRITING_SCREENSHOTS){fs.mkdirSync(process.env.WRITING_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS,name+'.png')});}};
   await page.getByRole('button',{name:'Writing assistant',exact:true}).click();
   const generate=page.getByRole('button',{name:'Generate',exact:true}),mode=page.getByLabel('AI writing tool',{exact:true});
   assert.equal(await generate.isDisabled(),true,'Consent is still required');
   const summary=page.getByRole('region',{name:'Context for this request',exact:true});await summary.getByText('Shared only when you request',{exact:true}).waitFor();
   for(let i=0;i<3;i++)await page.getByRole('button',{name:'Another prompt',exact:true}).click();assert.equal(calls().length,0,'Quick Prompt never calls AI');
   await page.getByLabel('AI Context',{exact:true}).selectOption('none');await summary.getByText('Excluded by this scope',{exact:true}).waitFor();await page.getByLabel('Allow this AI request with the selected context.',{exact:true}).check();
   await generate.click();await page.locator('.uw-editor-ai-results article').nth(2).waitFor();assert.equal(calls().at(-1).body.current_text,'');assert.equal(calls().at(-1).body.context_scope,'none');assert.equal(calls().at(-1).body.consent,true);assert.equal(await canvas.textContent(),content);
   const first=page.locator('.uw-editor-ai-results article').first();failIdeaSave=true;await first.getByRole('button',{name:'Save idea',exact:true}).click();await first.getByText('The idea could not be saved.',{exact:false}).waitFor();failIdeaSave=false;await first.getByRole('button',{name:'Save idea',exact:true}).click();await first.getByRole('button',{name:'Idea saved',exact:true}).waitFor();assert.equal(savedCoachIdeas.size,1);assert.equal(calls().length,1,'Saving a result does not generate again');await capture('coach-results');
   await page.getByLabel('AI Context',{exact:true}).selectOption('profile_only');assert.equal(await generate.isDisabled(),true,'Context changes reset consent');await page.getByLabel('Allow this AI request with the selected context.',{exact:true}).check();await generate.click();await page.locator('.uw-editor-ai-results article').nth(2).waitFor();assert.equal(calls().at(-1).body.current_text,'');assert.equal(calls().at(-1).body.context_scope,'profile_only');
   await page.getByLabel('AI Context',{exact:true}).selectOption('selected_resources');const picker=page.getByRole('dialog',{name:'Choose AI resources',exact:true});await picker.waitFor();await picker.getByRole('checkbox').first().check();await picker.getByRole('button',{name:'Apply selection',exact:true}).click();await picker.waitFor({state:'hidden'});await summary.getByText('Shared only when you request',{exact:true}).waitFor();await page.getByLabel('Share this draft for this AI request.',{exact:true}).check();await generate.click();await page.locator('.uw-editor-ai-results article').nth(2).waitFor();const selected=calls().at(-1).body;assert.equal(selected.current_text,content);assert.deepEqual(selected.selected_resources,[{kind:'document',id:saved.id}]);assert.equal(documents.get(saved.id).ai_allowed,false,'One-request consent never enables persistent document permissions');
   await page.getByLabel('AI Context',{exact:true}).selectOption('current_project');await page.getByLabel('Share this draft for this AI request.',{exact:true}).check();
   guidanceRemaining=0;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('.uw-ai-usage').textContent.includes('30 / 30'));
   const count=calls().length;
   for(const action of ['guidance','organization','research','feedback']){await mode.selectOption(action);assert.equal(await generate.isDisabled(),true,action+' honors the existing guidance allowance');}
   for(const action of ['next','block','brainstorm']){await mode.selectOption(action);assert.equal(await generate.isEnabled(),true,action+' uses the separate suggestion allowance');}
   assert.equal(calls().length,count,'Mode selection makes no request');
   guidanceRemaining=5;monthlyRemaining=0;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('.uw-ai-usage').textContent.includes('200 / 200'));await mode.selectOption('brainstorm');assert.equal(await generate.isDisabled(),true);await mode.selectOption('feedback');assert.equal(await generate.isEnabled(),true,'Guidance remains available independently');await generate.click();await page.locator('.uw-editor-ai-results article').first().waitFor();assert.equal(calls().at(-1).body.action,'feedback');assert.equal(await page.locator('.uw-editor-ai-results article').count(),1);
   legacy=true;aiUsed=0;aiPending=100;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('.uw-ai-usage').textContent.includes('100 pending'));
   for(const action of ['next','guidance','organization','research','feedback']){await mode.selectOption(action);assert.equal(await generate.isDisabled(),true,'Protected pending reservation blocks '+action);}
   assert.equal(await canvas.textContent(),content);assert.equal(activity.size,sessions,'Coaching creates no writing sessions');assert.equal(await page.getByRole('button',{name:/Add to document|Apply to selection/}).count(),0);
   legacy=false;aiUsed=0;aiPending=0;monthlyRemaining=200;guidanceRemaining=30;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('.uw-ai-usage').textContent.includes('100 left today'));await mode.selectOption('guidance');
   await page.locator('.uw-editor-assistant').evaluate(el=>el.scrollTop=0);await capture('coach-desktop-light');await page.getByRole('button',{name:'Dark theme',exact:true}).click();await capture('coach-desktop-dark');await page.getByRole('button',{name:'Light theme',exact:true}).click();
   await page.setViewportSize({width:320,height:1000});await page.getByRole('dialog',{name:'Writing assistant',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await capture('coach-mobile');await summary.getByRole('button',{name:'Review',exact:true}).click();await page.getByRole('dialog',{name:'Writing assistant',exact:true}).waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='AI Context');
   await page.getByLabel('Language').selectOption('es');await page.getByRole('button',{name:'Asistente de escritura',exact:true}).click();await page.getByRole('region',{name:'Contexto de esta solicitud',exact:true}).waitFor();await capture('coach-mobile-es');await page.keyboard.press('Escape');await page.getByLabel('Idioma').selectOption('en');
   assert.deepEqual(errors,[]);console.log('PASS coaching: non-AI prompts, explicit scope/consent and unchanged payloads, private document permission preserved, saved result retry without generation or insertion, all guidance/suggestion and protected pending quota gates, stable author content/session count, compact usage, responsive context review, EN/ES and dark mode.');return;
  }
  if(process.env.WRITING_STUDIO_ONLY==='1'){
   const until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Studio fixture did not settle');};
   const capture=async name=>{if(process.env.WRITING_SCREENSHOTS){fs.mkdirSync(process.env.WRITING_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS,name+'.png')});}};
   const originalText=await canvas.textContent(),sessionIds=[...activity.keys()],words=[...activity.values()].reduce((n,a)=>n+a.typed_words,0);
   await canvas.evaluate(el=>{window.studioCanvas=el;const node=[...el.querySelectorAll('p')][0].firstChild,range=document.createRange();range.setStart(node,4);range.setEnd(node,16);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);el.focus();});
   await page.getByRole('button',{name:'Bold (Ctrl/⌘ B)',exact:true}).click();assert.equal(await canvas.locator('strong').textContent(),'small moment','Toolbar preserves the exact text selection');
   const subtitle=page.getByRole('textbox',{name:'Subtitle',exact:true});await subtitle.fill('A quieter space for a long subtitle that stays readable when the library is collapsed and the page becomes wider.');
   await page.getByRole('button',{name:'Open library',exact:true}).click();assert.equal(await page.locator('.uw-editor-library').isVisible(),false,'Desktop library can collapse');await page.getByRole('button',{name:'Open library',exact:true}).click();await page.locator('.uw-editor-library').waitFor();
   await page.getByRole('button',{name:'Writing assistant',exact:true}).click();await capture('desktop-panels-light');await page.getByRole('button',{name:'Close assistant',exact:true}).click();
   await page.getByRole('button',{name:'Open library',exact:true}).click();await capture('desktop-paper-light');
   await page.getByRole('button',{name:'Dark theme',exact:true}).click();await capture('desktop-paper-dark');await page.getByRole('button',{name:'Light theme',exact:true}).click();
   const unchanged=async()=>{assert.equal(await canvas.evaluate(el=>el===window.studioCanvas),true,'Layout keeps the same editor DOM');assert.equal(await canvas.textContent(),originalText);assert.deepEqual([...activity.keys()],sessionIds,'Layout creates no duplicate sessions');assert.equal([...activity.values()].reduce((n,a)=>n+a.typed_words,0),words,'Formatting and presentation do not count as typed words');};
   for(const width of [1440,1199,1024,768,390,320]){
    await page.setViewportSize({width,height:900});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Page fits '+width);
    const status=page.locator('.uw-editor-save');assert.equal(await status.isVisible(),true,'Save status visible at '+width);const bounds=await status.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=150,'Save status stays in the header');
    assert.ok(await subtitle.evaluate(el=>el.scrollHeight<=el.clientHeight+2),'Subtitle resizes with paper width');await unchanged();
    if(width<=1199){
     await page.getByRole('button',{name:'Open library',exact:true}).click();const panel=page.getByRole('dialog',{name:'Library',exact:true});await panel.waitFor();await page.getByRole('button',{name:'Close library',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),true,'Library contains keyboard focus');await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Open library',exact:true}).evaluate(el=>el===document.activeElement),true,'Library restores its trigger');
     await page.getByRole('button',{name:'Writing assistant',exact:true}).click();const assistant=page.getByRole('dialog',{name:'Writing assistant',exact:true});await assistant.waitFor();await capture('assistant-'+width);await page.getByRole('button',{name:'Close side panel',exact:true}).click({position:{x:5,y:5}});await assistant.waitFor({state:'hidden'});
     const toolbar=page.getByRole('toolbar',{name:'Text formatting',exact:true});await toolbar.getByRole('button',{name:'Bold (Ctrl/⌘ B)',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('button',{name:'Italic (Ctrl/⌘ I)',exact:true}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('End');assert.equal(await page.getByRole('button',{name:'Redo (Ctrl/⌘ Shift Z)',exact:true}).evaluate(el=>el===document.activeElement),true,'Overflowing toolbar remains keyboard reachable');
     await page.getByRole('button',{name:'Enter focus mode',exact:true}).click();await page.locator('.uw-project-controls').waitFor({state:'hidden'});assert.equal(await page.getByRole('toolbar').count(),0);assert.equal(await status.isVisible(),true);await capture('focus-'+width);await unchanged();await page.keyboard.press('Escape');
     if(width===390)await capture('mobile-paper-light');
    }
   }
   await page.setViewportSize({width:390,height:900});await page.getByLabel('Language').selectOption('es');assert.equal(await page.locator('.uw-editor-save').isVisible(),true);await page.getByRole('button',{name:'Abrir biblioteca',exact:true}).click();await page.getByRole('dialog',{name:'Biblioteca',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByLabel('Idioma').selectOption('en');
   offline=true;await context.setOffline(true);await canvas.fill('A quiet offline draft remains safe through the new layout.');await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));assert.equal(await page.locator('.uw-editor-save').isVisible(),true);await capture('mobile-offline');offline=false;await context.setOffline(false);await until(()=>documents.get(saved.id)?.plain_text.includes('quiet offline draft'));
   assert.equal(requests.filter(r=>r.key==='/workspace/assistant').length,0);assert.deepEqual(errors,[]);
   console.log('PASS writing studio: exact formatting selection, stable editor DOM, no duplicated sessions/words, resizable title/subtitle paper, persistent mobile/focus/offline save status, desktop library toggle, responsive modal panels and keyboard/focus return, scrollable toolbar keyboard access, focus mode, EN/ES/dark and 320–1440px, offline sync.');return;
  }
  if(process.env.WRITING_IMAGES_ONLY==='1'){
   const until=async fn=>{for(let i=0;i<180;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for image save');};
   const imgCount=n=>(n.type==='image'?1:0)+(n.content||[]).reduce((sum,c)=>sum+imgCount(c),0);
   const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2048;c.height=1024;const ctx=c.getContext('2d');ctx.fillStyle='#eff6ff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#0866ff';ctx.fillRect(100,100,1200,600);return c.toDataURL('image/png').split(',')[1];}),'base64');
   await page.getByRole('button',{name:'Pause Session',exact:true}).click();await until(()=>[...activity.values()].some(a=>a.timer?.status==='paused'));
   const wordTotal=[...activity.values()].reduce((sum,a)=>sum+a.typed_words,0),sessionCount=activity.size;
   const before=await canvas.textContent();await canvas.click();await canvas.press('ControlOrMeta+End');
   const insert=async()=>{await page.getByRole('button',{name:'Add image',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add image',exact:true});await dialog.getByLabel('Image file',{exact:true}).setInputFiles({name:'private-garden.png',mimeType:'image/png',buffer:png});await dialog.getByLabel('Image description (alt text)',{exact:true}).fill('Blue garden illustration');await dialog.getByRole('button',{name:'Insert image',exact:true}).click();await dialog.waitFor({state:'hidden'});};
   await insert();await canvas.locator('img[alt="Blue garden illustration"]').waitFor();
   await until(()=>imgCount(documents.get(saved.id).content)===1);
   const image=documents.get(saved.id).content.content.find(n=>n.type==='image');assert.ok(image.attrs.src.startsWith('data:image/webp;base64,'));assert.equal(image.attrs.width,1600);assert.equal(image.attrs.height,800);
   assert.equal(await canvas.textContent(),before,'Inserting an image does not replace writing');assert.equal(activity.size,sessionCount);assert.equal([...activity.values()].reduce((sum,a)=>sum+a.typed_words,0),wordTotal);
   await page.reload();await canvas.locator('img').waitFor();assert.equal(await canvas.locator('img').evaluate(e=>e.complete&&e.naturalWidth>0),true);
   await canvas.locator('img').click();await page.keyboard.press('Backspace');await until(()=>imgCount(documents.get(saved.id).content)===0);await page.keyboard.press('ControlOrMeta+z');await canvas.locator('img').waitFor();await until(()=>imgCount(documents.get(saved.id).content)===1);
   await page.getByRole('button',{name:'Add image',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Add image',exact:true});
   await dialog.getByLabel('Image file',{exact:true}).setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg onload="alert(1)"></svg>')});await dialog.getByRole('button',{name:'Insert image',exact:true}).click();await dialog.getByRole('alert').getByText('Choose a PNG, JPEG or WebP image.',{exact:true}).waitFor();
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(imgCount(documents.get(saved.id).content),1);
   await page.getByRole('button',{name:'Add image',exact:true}).click();dialog=page.getByRole('dialog',{name:'Add image',exact:true});await dialog.getByLabel('Image file',{exact:true}).setInputFiles({name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(10*1024*1024+1)});await dialog.getByRole('button',{name:'Insert image',exact:true}).click();await dialog.getByRole('alert').getByText('Choose an image smaller than 10 MB.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
   // Insert privately while offline, reload the shell, then retry the same save.
   await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));offline=true;await context.setOffline(true);await canvas.click();await canvas.press('ControlOrMeta+End');await insert();await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));assert.equal(await canvas.locator('img').count(),2);
   await page.reload({waitUntil:'domcontentloaded'});await canvas.locator('img').first().waitFor();assert.equal(await canvas.locator('img').count(),2);assert.ok(await canvas.locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0)));
   offline=false;await context.setOffline(false);await until(()=>imgCount(documents.get(saved.id).content)===2);
   await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});await page.getByRole('button',{name:'Copy body',exact:true}).click();await page.getByText('Body copied',{exact:true}).waitFor();const html=await page.evaluate(async()=>{for(const item of await navigator.clipboard.read())if(item.types.includes('text/html'))return (await item.getType('text/html')).text();return '';});assert.ok(html.includes('data:image/webp;base64,'));
   await page.locator('.uw-editor-export summary').click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'MD',exact:true}).click();const md=fs.readFileSync(await (await downloading).path(),'utf8');assert.ok(md.includes('![Blue garden illustration](data:image/webp;base64,'));
   for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await canvas.locator('img').first().evaluate(img=>img.getBoundingClientRect().width<=img.closest('.uw-writing-canvas').getBoundingClientRect().width+1));if(process.env.WRITING_SCREENSHOTS&&[1440,390].includes(width)){fs.mkdirSync(process.env.WRITING_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS,'editor-images-'+width+'.png'),fullPage:true});}}
   await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Dark theme',exact:true}).click();
   if(process.env.AXE_SCRIPT){await page.addScriptTag({path:process.env.AXE_SCRIPT});assert.deepEqual(await page.evaluate(async()=>(await axe.run(document.querySelector('.uw-editor'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)),[]);}
   await page.getByLabel('Language').selectOption('es');await page.getByRole('button',{name:'Añadir imagen',exact:true}).click();await page.getByRole('dialog',{name:'Añadir imagen',exact:true}).getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByLabel('Idioma').selectOption('en');
   // An image-only document creates no writing activity or word count inflation.
   await page.getByRole('button',{name:'New document',exact:true}).click();await insert();const second=()=>[...documents.values()].find(d=>d.id!==saved.id);await until(()=>second()&&imgCount(second().content)===1);
   assert.equal(activity.size,sessionCount);await page.getByRole('button',{name:'Start Session',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Copy body',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Copy body',exact:true}).click();await page.getByText('Body copied',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Mark Document as Complete',exact:true}).click();await page.getByRole('heading',{name:'Document Completed!'}).waitFor();await page.locator('.uw-editor-document').filter({hasText:'Untitled'}).click();await canvas.locator('img').waitFor();assert.equal(await page.getByRole('button',{name:'Add image',exact:true}).isDisabled(),true);
   let externalImages=0;await page.route('https://unoword-tracker.invalid/**',route=>{externalImages++;return route.abort();});
   await page.getByTestId('document-import').setInputFiles({name:'Image roundtrip.md',mimeType:'text/markdown',buffer:Buffer.from(md+'\n\n![remote](https://unoword-tracker.invalid/pixel)\n<img src="https://unoword-tracker.invalid/raw">')});
   await page.waitForFunction(()=>document.querySelector('.uw-editor-title').value==='Image roundtrip');await until(()=>[...documents.values()].some(d=>d.title==='Image roundtrip'&&imgCount(d.content)===2));assert.equal(await canvas.locator('img').count(),2);assert.equal(externalImages,0,'Markdown import never loads remote image URLs');
   assert.deepEqual(errors,[]);assert.equal(requests.some(r=>r.key==='/workspace/assistant'),false);
   console.log('PASS document images: upload, alt text, resize/compression, private embedded save/reopen, removal/undo, SVG/oversize rejection, offline insert/reload/reconnect, rich clipboard and Markdown export, image-only no new activity, completed read-only gate, EN/ES, dark/accessibility and 320–1440px layouts.');return;
  }
  if(process.env.WRITING_SUBTITLE_COPY_ONLY==='1'){
   await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
   const until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for subtitle save '+JSON.stringify({attrs:documents.get(saved.id)?.content.attrs,lastSaves:requests.filter(r=>r.key.startsWith('/workspace/documents/')&&r.method==='PUT').slice(-3).map(r=>r.body.content.attrs)}));};
   const subtitle=page.getByRole('textbox',{name:'Subtitle',exact:true});
   assert.equal(await subtitle.inputValue(),'');assert.equal(await page.getByRole('button',{name:'Copy subtitle',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Pause Session',exact:true}).click();
   await until(()=>[...activity.values()].some(a=>a.timer?.status==='paused'));
   const words=[...activity.values()].reduce((n,a)=>n+a.typed_words,0),sessions=activity.size;
   const heading='A subtitle about small details and meaningful stories';
   let body=await canvas.textContent();
   await subtitle.fill(heading);
   await until(()=>documents.get(saved.id)?.content.attrs?.subtitle===heading);
   assert.equal(activity.size,sessions);assert.equal([...activity.values()].reduce((n,a)=>n+a.typed_words,0),words,'Subtitle edits do not change tracked words');
   assert.equal(await canvas.textContent(),body);
   const copied=async(label,expected)=>{await page.getByRole('button',{name:label,exact:true}).click();await page.getByText({'Copy title':'Title copied','Copy subtitle':'Subtitle copied','Copy body':'Body copied'}[label],{exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expected);};
   await copied('Copy title','The practice of paying attention');await copied('Copy subtitle',heading);await copied('Copy body',body);
   const rich=await page.evaluate(async()=>{const data=await navigator.clipboard.read();return data.flatMap(item=>item.types);});assert.ok(rich.includes('text/html')&&rich.includes('text/plain'));
   await page.reload();await subtitle.waitFor();assert.equal(await subtitle.inputValue(),heading);
   await copied('Copy subtitle',heading);
   await canvas.click();await canvas.press('ControlOrMeta+End');await canvas.pressSequentially(' Fresh after reopening.');body=await canvas.textContent();
   await until(()=>documents.get(saved.id)?.plain_text.includes('Fresh after reopening.'));assert.equal(documents.get(saved.id).content.attrs.subtitle,heading,'Body edits after reload preserve the subtitle');
   await subtitle.fill('');await until(()=>documents.get(saved.id)?.content.attrs?.subtitle===null);assert.equal(await page.getByRole('button',{name:'Copy subtitle',exact:true}).isDisabled(),true);
   // Simulate a browser refusing both rich and plain copying; never claim success.
   await page.evaluate(()=>{navigator.clipboard.write=async()=>{throw Error('denied')};navigator.clipboard.writeText=async()=>{throw Error('denied')};});
   await page.getByRole('button',{name:'Copy body',exact:true}).click();await page.getByText('Could not copy. Select the text and copy it manually.',{exact:true}).waitFor();
   await page.reload();await subtitle.waitFor();
   await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
   const offlineSubtitle='Offline subtitle: private notes, safely saved';
   offline=true;await context.setOffline(true);await subtitle.fill(offlineSubtitle);
   await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));
   await copied('Copy subtitle',offlineSubtitle);await copied('Copy title','The practice of paying attention');await copied('Copy body',body);
   await page.reload({waitUntil:'domcontentloaded'});await subtitle.waitFor();assert.equal(await subtitle.inputValue(),offlineSubtitle);
   offline=false;await context.setOffline(false);await until(()=>documents.get(saved.id)?.content.attrs?.subtitle===offlineSubtitle);
   // All export formats retain subtitle metadata; browser TXT/MD are fully local.
   for(const format of ['TXT','MD']){await page.locator('.uw-editor-export summary').click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:format,exact:true}).click();const download=await downloading;assert.ok(fs.readFileSync(await download.path(),'utf8').startsWith(offlineSubtitle+'\n\n'));}
   for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await subtitle.evaluate(e=>e.scrollHeight<=e.clientHeight+2),'Subtitle is not clipped');
    for(const name of ['Copy title','Copy subtitle','Copy body'])assert.equal(await page.getByRole('button',{name,exact:true}).isVisible(),true);
    if(process.env.WRITING_SCREENSHOTS && [1440,390].includes(width)){fs.mkdirSync(process.env.WRITING_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS,'subtitle-copy-'+width+'.png'),fullPage:true});}
   }
   await page.setViewportSize({width:1440,height:1000});
   await page.getByRole('button',{name:'Dark theme',exact:true}).click();
   if(process.env.AXE_SCRIPT){await page.addScriptTag({path:process.env.AXE_SCRIPT});const violations=await page.evaluate(async()=>(await axe.run(document.querySelector('.uw-editor'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id));assert.deepEqual(violations,[]);}
   await page.getByRole('button',{name:'Light theme',exact:true}).click();
   await page.getByRole('button',{name:'Enter focus mode',exact:true}).click();await copied('Copy subtitle',offlineSubtitle);assert.equal(await subtitle.isVisible(),true);await page.keyboard.press('Escape');
   await page.getByLabel('Language').selectOption('es');await page.getByRole('textbox',{name:'Subtítulo',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Copiar título',exact:true}).isVisible(),true);await page.getByRole('button',{name:'Copiar subtítulo',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),offlineSubtitle);
   await page.getByLabel('Idioma').selectOption('en');
   await page.getByRole('button',{name:'Mark Document as Complete',exact:true}).click();await page.getByRole('button',{name:'Complete & End Session',exact:true}).click();await page.getByRole('heading',{name:'Document Completed!'}).waitFor();
   await page.locator('.uw-editor-document').filter({hasText:'The practice of paying attention'}).click();await subtitle.waitFor();assert.equal(await subtitle.getAttribute('readonly'),'');await copied('Copy subtitle',offlineSubtitle);await copied('Copy title','The practice of paying attention');await copied('Copy body',body);
   assert.deepEqual(errors,[]);assert.equal(requests.some(r=>r.key==='/workspace/assistant'),false);
   console.log('PASS subtitle/copy: metadata autosave/reopen/clear, separate exact title/subtitle/body clipboard and rich body formats, permission failure, offline editing/copy/reload/reconnect, no word/session inflation, TXT/MD exports, completed read-only copying, focus/dark/EN/ES and 320–1440px accessibility.');return;
  }
  if(process.env.WRITING_SESSION_COMPLETION_ONLY==='1'){
   const snap=async name=>{if(process.env.WRITING_SCREENSHOTS){fs.mkdirSync(process.env.WRITING_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS,name+'.png'),fullPage:true});}};
   const checkA11y=async()=>{if(process.env.AXE_SCRIPT){await page.addScriptTag({path:process.env.AXE_SCRIPT});const result=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(result.violations.map(v=>v.id),[]);}};

   const until=async(check)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out waiting for fixture persistence');};
   await page.getByRole('button',{name:'Pause Session',exact:true}).click();
   await page.getByRole('button',{name:'Resume Session',exact:true}).waitFor();
   await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
   await until(()=>[...activity.values()].some(a=>a.timer?.status==='paused'));
   const paused=[...activity.values()].find(a=>a.timer?.status==='paused');assert.ok(paused);
   const sessionId=paused.id,activeMs=paused.timer.active_ms,typed=paused.typed_words;await snap('session-paused-desktop');await checkA11y();
   await page.reload();await page.getByRole('button',{name:'Resume Session',exact:true}).waitFor();
   assert.equal([...activity.values()].find(a=>a.id===sessionId).timer.active_ms,activeMs,'Refresh does not restart paused time');
   // The project restoration gate deliberately keeps the loaded editor read-only
   // until its workspace is ready, even when the paused-session label is visible.
   await page.waitForFunction(()=>document.querySelector('.uw-writing-canvas')?.getAttribute('contenteditable')==='true');
   await canvas.fill('Words added while paused stay in the document but not session progress.');
   await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
   assert.equal(activity.get(sessionId).typed_words,typed);
   const reopened=await context.newPage();await reopened.goto(origin+'/editor');
   await reopened.getByRole('button',{name:'Resume Session',exact:true}).waitFor();
   assert.equal(await reopened.getByRole('textbox',{name:'Rename document'}).inputValue(),'The practice of paying attention');
   await reopened.close();
   await page.getByRole('button',{name:'Resume Session',exact:true}).click();
   await page.getByRole('button',{name:'Pause Session',exact:true}).waitFor();
   await page.getByRole('button',{name:'Pause Session',exact:true}).click();
   await page.getByRole('button',{name:'End Session',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
   await until(()=>activity.get(sessionId)?.timer?.status==='ended');
   assert.equal(activity.get(sessionId).timer.status,'ended');assert.equal(activity.size,1);
   // Ending a session never completes a document.
   assert.notEqual(documents.get(saved.id).completion_status,'completed');
   await page.getByRole('button',{name:'Start Session',exact:true}).click();
   await page.getByRole('button',{name:'Mark Document as Complete',exact:true}).click();
   await page.getByRole('dialog',{name:'Mark Document as Complete'}).waitFor();
   await page.getByRole('button',{name:'Keep Writing',exact:true}).click();
   // Fail the pending save: completion must not be confirmed or end the session.
   failSave=true;await canvas.fill('The newest unsaved words must be preserved before completion.');
   await page.getByRole('button',{name:'Mark Document as Complete',exact:true}).click();
   await page.getByRole('button',{name:'Complete & End Session',exact:true}).click();
   await page.locator('.uw-editor-notice').waitFor();
   assert.notEqual(documents.get(saved.id).completion_status,'completed');
   assert.equal(await page.getByRole('heading',{name:'Document Completed!'}).count(),0);
   failSave=false;await page.getByRole('button',{name:'Complete & End Session',exact:true}).click();
   await page.getByRole('heading',{name:'Document Completed!'}).waitFor();await snap('document-completed-desktop');await checkA11y();
   let completed=documents.get(saved.id);assert.equal(completed.completion_status,'completed');assert.ok(completed.completed_at);
   assert.equal(completed.status,'active');assert.ok(completed.plain_text.includes('newest unsaved words'));
   await until(()=>[...activity.values()].every(a=>a.timer?.status==='ended'));
   assert.ok([...activity.values()].every(a=>a.timer?.status==='ended'));
   await page.reload();await page.getByRole('heading',{name:'Ready for Your Next Idea?',exact:true}).waitFor();
   assert.equal(await page.getByRole('textbox',{name:'Document content'}).count(),0,'A completed last document never automatically reopens');
   await page.getByLabel('Completion status',{exact:true}).selectOption('completed');
   assert.equal(await page.locator('.uw-editor-document').count(),1);
   assert.equal(await page.getByRole('button',{name:/Mark as Draft/}).count(),0,'Mark as Draft is unavailable until a completed document is opened');
   await page.locator('.uw-editor-document').filter({hasText:'The practice of paying attention'}).click();
   await canvas.waitFor();assert.equal(await canvas.getAttribute('contenteditable'),'false');
   assert.equal(await page.getByRole('button',{name:'Mark as Draft',exact:true}).count(),1);
   assert.equal(await page.locator('.uw-editor-document-list').getByRole('button',{name:/Mark as Draft/}).count(),0,'The library has no completion mutation controls');
   for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Completed view fits ${width}`);}await page.setViewportSize({width:1440,height:1000});
   await page.getByRole('button',{name:'Mark as Draft',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[aria-label="Document content"]')?.getAttribute('contenteditable')==='true');
   assert.equal(documents.get(saved.id).completion_status,'draft');assert.equal(documents.get(saved.id).completed_at,null);
   await page.getByLabel('Completion status',{exact:true}).selectOption('draft');
   assert.equal(await page.locator('.uw-editor-document').count(),1);
   await page.reload();await canvas.waitFor();assert.ok((await canvas.textContent()).includes('newest unsaved words'));
   // Empty Trash preserves unrelated writing and divergent offline drafts.
   const unsavedTab=await context.newPage();await unsavedTab.goto(origin+'/editor');
   await unsavedTab.getByRole('textbox',{name:'Document content'}).waitFor();
   await unsavedTab.route(origin+'/api/**',route=>route.abort('internetdisconnected'));
   await unsavedTab.getByRole('textbox',{name:'Document content'}).fill('Unsaved words from another tab must survive Empty Trash.');
   await unsavedTab.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('sync paused'));
   page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Move to trash',exact:true}).click();
   await until(()=>documents.get(saved.id)?.status==='trashed');
   await page.getByRole('button',{name:'New document',exact:true}).click();
   await page.getByRole('textbox',{name:'Rename document'}).fill('Keep this active document');
   await canvas.fill('This active writing should remain safe.');
   await until(()=>[...documents.values()].some(d=>d.title==='Keep this active document'));
   const keeper=[...documents.values()].find(d=>d.title==='Keep this active document');
   await page.getByRole('button',{name:/^Trash/}).click();
   const empty=page.getByRole('button',{name:'Empty Trash',exact:true});await empty.click();
   const trashDialog=page.getByRole('dialog',{name:'Empty Trash',exact:true});
   await trashDialog.getByText('Permanently delete 1 document(s)?',{exact:true}).waitFor();await snap('empty-trash-desktop');await checkA11y();await page.setViewportSize({width:390,height:900});await snap('empty-trash-mobile');await checkA11y();await page.setViewportSize({width:1440,height:1000});
   await trashDialog.getByRole('button',{name:'Cancel',exact:true}).click();
   assert.ok(documents.has(saved.id),'Cancel never deletes documents');
   offline=true;await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('.uw-editor-empty-trash').disabled);assert.equal(await empty.isEnabled(),false);
   offline=false;await context.setOffline(false);
   await empty.click();await trashDialog.getByRole('button',{name:'Permanently Delete',exact:true}).click();
   await page.getByText('Trash emptied.',{exact:true}).waitFor();
   assert.ok(!documents.has(saved.id));assert.ok(documents.has(keeper.id));
   assert.ok([...activity.values()].some(a=>a.document_id===null),'Writing history survives permanent deletion');
   await unsavedTab.unroute(origin+'/api/**');await unsavedTab.reload();
   await unsavedTab.getByText(/Recovered drafts/).waitFor();
   const recovery=await unsavedTab.evaluate(()=>new Promise(resolve=>{const q=indexedDB.open('uno-word-writing',1);q.onsuccess=()=>{const r=q.result.transaction('records').objectStore('records').getAll();r.onsuccess=()=>resolve(r.result.some(e=>e.kind==='draft'&&e.value.plain_text.includes('Unsaved words from another tab')));};}));
   assert.equal(recovery,true,'Divergent unsaved writing becomes a recovery copy');
   await unsavedTab.locator('.uw-editor-recovery summary').click();
   await unsavedTab.getByRole('button',{name:/Recover as a new document/}).click();
   await until(()=>[...documents.values()].some(d=>d.plain_text.includes('Unsaved words from another tab')));
   assert.ok(!documents.has(saved.id),'Recovery creates a new ID instead of resurrecting deleted cloud content');
   await unsavedTab.close();
   // Fresh-document behavior and responsive controls do not consume AI credits.
   for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No overflow at ${width}`);}
   assert.equal(requests.filter(r=>r.key==='/workspace/assistant').length,0);
   assert.deepEqual(errors,[]);
   console.log('PASS editor sessions/completion: persistent pause, new-tab restore, same identity, paused input excluded, end while paused, independent document lifecycle, pending-save failure/retry, confirmed completion, fresh reopening, manual read-only reopen/revert, status filters, preserved content, responsive 320–1440px; Empty Trash confirmation/cancel/offline guard; unrelated documents/history preserved; divergent offline draft recovery; no AI calls.');
   return;
  }

  const originalId=saved.id;
  assert.equal([...activity.values()].reduce((s,a)=>s+a.typed_words,0),8);
  await canvas.fill('');await page.waitForFunction(()=>document.querySelector('.uw-editor-stats').textContent.includes('0 Session words')).catch(async error=>{console.error('Deletion state:',await canvas.evaluate(el=>({text:el.textContent,editable:el.getAttribute('contenteditable'),stats:document.querySelector('.uw-editor-stats')?.textContent,session:document.querySelector('.uw-editor-session-controls')?.textContent})),[...activity.values()].map(row=>({id:row.id,words:row.typed_words,timer:row.timer})));throw error;});
  await canvas.pressSequentially('A quiet practice makes room for new ideas.');
  await canvas.press('ControlOrMeta+a');await page.getByRole('button',{name:'Bold (Ctrl/⌘ B)',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.uw-writing-canvas strong'));
  await page.getByLabel('Heading level').selectOption('2');assert.equal(await page.locator('.uw-writing-canvas h2').count(),1);
  await page.getByLabel('Heading level').selectOption('paragraph');
  await canvas.click();await canvas.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
  assert.equal([...activity.values()].reduce((s,a)=>s+a.typed_words,0),8,'Formatting does not add words');
  await page.reload();await canvas.waitFor();assert.ok((await canvas.textContent()).includes('quiet practice'),'Reopen saved document');
  // Paste/imported text contributes to document size, not typed progress.
  await canvas.click();await canvas.press('ControlOrMeta+End');
  await canvas.evaluate(element=>{element.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertFromPaste',bubbles:true}));document.execCommand('insertText',false,' Pasted reference words.');});
  await page.waitForTimeout(1300);
  assert.equal([...activity.values()].reduce((s,a)=>s+a.typed_words,0),8);
  // Folder organization, duplication, favorites, archive/trash/restore and search.
  await page.getByRole('button',{name:'New folder',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'Name',exact:true}).fill('Field notes');await page.getByRole('dialog').getByRole('button',{name:'New folder',exact:true}).click();
  await page.getByLabel('Document folder').getByRole('option',{name:'Field notes',exact:true}).waitFor({state:'attached'});
  await page.getByLabel('Document folder').selectOption({label:'Field notes'});
  // Invalid names are explained inside the modal, without closing it.
  await page.getByRole('button',{name:'New folder',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'Name',exact:true}).fill('   ');
  await page.getByRole('dialog').getByRole('button',{name:'New folder',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').getByText('Enter a folder name.').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  // Cloud failures cannot prevent local organization or lose folders on reload.
  failFolders=true;
  await page.getByRole('button',{name:'New folder',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'Name',exact:true}).fill('Local only');
  await page.getByRole('dialog').getByRole('button',{name:'New folder',exact:true}).click();
  await page.getByLabel('Document folder').selectOption({label:'Local only'});
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('sync paused'));
  await page.reload();await canvas.waitFor();
  await page.getByLabel('Document folder').getByRole('option',{name:'Local only',exact:true}).waitFor({state:'attached'});
  failFolders=false;await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
  assert.equal(folders.filter(f=>f.name==='Local only').length,1);
  assert.ok([...documents.values()].some(d=>d.folder_id===folders.find(f=>f.name==='Local only').id));

  await page.getByRole('button',{name:'Favorites',exact:true}).last().click();
  await page.getByRole('button',{name:'Duplicate document',exact:true}).click();
  await page.getByRole('textbox',{name:'Rename document'}).fill('A second draft');
  await page.getByRole('button',{name:'Move to archive',exact:true}).click();
  await page.getByRole('button',{name:'Archive',exact:false}).first().click();
  await page.getByRole('button',{name:'Restore document',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Move to trash',exact:true}).click();
  await page.getByRole('button',{name:'Restore document',exact:true}).click();
  await page.getByRole('textbox',{name:'Search your writing'}).fill('quiet practice');
  assert.ok(await page.locator('.uw-editor-document').count()>0);
  await page.getByRole('textbox',{name:'Search your writing'}).fill('');
  // Deliberate server conflict: keep both without overwriting either version.
  await page.locator('.uw-editor-document').filter({hasText:'The practice of paying attention'}).click();
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
  conflictNext=true;await canvas.fill('My offline thought must be preserved.');
  await page.getByRole('heading',{name:'Different versions found'}).waitFor();
  assert.ok((await page.locator('.uw-editor-conflict').textContent()).includes('newer thought'));
  await page.getByRole('button',{name:'Keep both copies',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
  assert.ok([...documents.values()].some(d=>d.plain_text==='My offline thought must be preserved.'));
  assert.equal(documents.get(originalId).plain_text,'A newer thought saved in another tab.');
  // AI is opt-in and does not edit the document until explicit application.
  await page.getByRole('button',{name:'Writing assistant',exact:true}).click();
  const generate=page.getByRole('button',{name:'Generate',exact:true});assert.equal(await generate.isEnabled(),false);
  await page.getByLabel('Share this draft for this AI request.').check();
  const before=await canvas.textContent();await generate.click();await page.locator('.uw-editor-ai-results article').nth(2).waitFor();
  assert.equal(await canvas.textContent(),before,'AI generation never overwrites writing');
  assert.equal(requests.filter(r=>r.key==='/workspace/assistant').length,1);
  await page.waitForFunction(()=>document.querySelector('.uw-ai-usage').textContent.includes('1 / 100'));
  const progress=requests.find(r=>r.key==='/workspace/assistant').body.writing_progress;
  assert.equal(progress.daily_goal,250);assert.ok(progress.words_written_today>0);
  assert.ok((await page.locator('.uw-writing-task').first().textContent()).includes('words'));
  const aiCalls=requests.filter(r=>r.key==='/workspace/assistant').length;
  await page.locator('.uw-editor-goal input').fill('2000');
  assert.equal(requests.filter(r=>r.key==='/workspace/assistant').length,aiCalls,'Goal edits do not call AI');
  await generate.click();await page.waitForFunction(()=>document.querySelector('.uw-writing-task-sections input'));
  assert.equal(await page.locator('.uw-writing-task-sections').first().locator('input').count(),5);
  await page.locator('.uw-writing-task-sections input').first().check();
  await accessibility('goal-based task and checklist');
  for(const width of [390,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Task checklist fits mobile');}
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.uw-editor-goal input').fill('250');
  // A request from the extension is reflected when returning to the editor.
  aiUsed=99;aiPending=1;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('.uw-ai-usage').textContent.includes('99 / 100'));
  assert.ok((await page.locator('.uw-ai-usage').textContent()).includes('1 pending'));
  assert.equal(await generate.isEnabled(),false,'Pending requests reserve the last shared slot');
  aiPending=0;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('.uw-ai-usage').textContent.includes('1 left'));
  aiUsed=1;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('.uw-ai-usage').textContent.includes('99 left'));
  const authoredText=await canvas.textContent();
  assert.equal(await page.getByRole('button',{name:/Add to document|Apply to selection/}).count(),0,'AI cannot insert or replace author text');
  assert.equal(await page.getByLabel('AI writing tool').locator('option[value="improve"]').count(),0,'Rewriting option removed');
  await page.getByLabel('AI writing tool').selectOption('guidance');await generate.click();
  await page.locator('.uw-editor-ai-results article').first().waitFor();
  assert.equal(await page.locator('.uw-editor-ai-results article').count(),1);
  assert.equal(await canvas.textContent(),authoredText,'Guidance never changes the document');
  await page.locator('[data-tour=profile]').click();
  const profileDialog=page.getByRole('dialog');await profileDialog.getByLabel('What do you want to write?').fill('An edit that should be canceled');
  await profileDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('[data-tour=profile]').click();
  assert.equal(await profileDialog.getByLabel('What do you want to write?').inputValue(),'Essays about craft and community');
  await profileDialog.getByLabel('What do you want to write?').fill('Patient observation and practical craft');
  await profileDialog.getByRole('button',{name:'Save profile',exact:true}).click();assert.equal(profile.writing_goal,'Patient observation and practical craft');
  Object.assign(sources[0],{processing_status:'processing',processing_phase:'indexing',processing_progress:50});
  await page.getByRole('button',{name:'Writing knowledge',exact:true}).click();
  await page.getByText('Processing · 50%',{exact:true}).waitFor();
  await page.getByText('Processing · 50%',{exact:true}).waitFor({state:'hidden',timeout:20000});
  assert.ok(requests.some(r=>r.key==='/processing/run'),'Pending knowledge refreshes through the authenticated worker');
  await page.getByLabel('Notes on building a garden').uncheck();
  assert.equal(sources[0].enabled,false);
  await page.getByLabel('Use this document for future AI personalization').check();
  await page.getByRole('button',{name:'Another prompt',exact:true}).click();assert.ok((await page.locator('.uw-editor-prompt').textContent()).length>35);
  // Export current unsynced text locally and import Markdown safely.
  await page.getByRole('button',{name:'Close assistant',exact:true}).click();
  await page.locator('.uw-editor-export summary').click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'TXT',exact:true}).click();
  const download=await downloading;assert.ok(download.suggestedFilename().endsWith('.txt'));
  await page.getByTestId('document-import').setInputFiles({name:'Imported thoughts.md',mimeType:'text/markdown',buffer:Buffer.from('# A fresh start\n\n**Bold ideas** and careful words.\n<script>window.compromised=true</script>\n[unsafe](javascript:alert(1))')});
  await page.waitForFunction(()=>document.querySelector('.uw-editor-title').value==='Imported thoughts');
  assert.equal(await page.locator('.uw-writing-canvas h1').count(),1);assert.equal(await page.locator('.uw-writing-canvas strong').count(),1);
  assert.equal(await page.evaluate(()=>window.compromised),undefined);assert.equal(await page.locator('.uw-writing-canvas a[href^="javascript"]').count(),0);
  // Focus, light/dark, mobile/tablet, localization and basic accessibility.
  await page.getByRole('button',{name:'Enter focus mode',exact:true}).click();assert.equal(await page.locator('.uw-editor-library').getAttribute('inert'),'');await page.locator('.uw-editor-library').waitFor({state:'hidden'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.uw-editor-library').count(),1);
  async function accessibility(label){
   if(!process.env.AXE_SCRIPT)return;
   await page.locator('.uw-editor').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});
   await page.addScriptTag({path:process.env.AXE_SCRIPT});
   const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('.uw-editor'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,description:v.description,nodes:v.nodes.map(n=>n.target)})));
   assert.deepEqual(violations,[],label+' accessibility');
  }
  await page.getByRole('button',{name:'Dark theme',exact:true}).click();assert.equal(await page.locator('.uw-editor').getAttribute('data-theme'),'dark');await accessibility('dark desktop');
  await page.getByRole('button',{name:'Light theme',exact:true}).click();
  const capture=async name=>{if(process.env.WRITING_SCREENSHOTS){fs.mkdirSync(process.env.WRITING_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS,name+'.png'),fullPage:true});}};
  await page.getByRole('button',{name:'Writing assistant',exact:true}).click();await capture('editor-desktop');
  await accessibility('light desktop with assistant');
  await page.getByRole('button',{name:'Close assistant',exact:true}).click();
  for(const width of [768,390,320]){
   await page.setViewportSize({width,height:900});
   for(const lang of ['en','es']){
    await page.getByLabel(/Language|Idioma/).selectOption(lang);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${lang} no horizontal overflow`);
    await capture(`editor-${width}-${lang}`);
    if(width===390&&lang==='es')await accessibility('Spanish mobile');
   }
  }
  await page.getByLabel('Idioma').selectOption('en');await page.setViewportSize({width:1440,height:1000});
  // Wait for the static editor shell to cache, then reload and edit fully offline.
  await page.waitForFunction(async()=>Boolean(await caches.match(location.origin+'/editor')));
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
  offline=true;await context.setOffline(true);await canvas.fill('Written offline and safely kept on this device.');
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));
  await page.reload();await canvas.waitFor();
  await page.waitForFunction(()=>document.querySelector('.uw-writing-canvas')?.textContent.includes('Written offline'));
  await page.getByRole('button',{name:'New folder',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'Name',exact:true}).fill('Offline folder');
  await page.getByRole('dialog').getByRole('button',{name:'New folder',exact:true}).click();
  await page.getByLabel('Document folder').selectOption({label:'Offline folder'});
  // New documents also save durably offline before any cloud record exists.
  await page.getByRole('button',{name:'New document',exact:true}).click();
  await canvas.fill('A new document created entirely offline.');
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));
  await page.reload();await canvas.waitFor();
  await page.waitForFunction(()=>document.querySelector('.uw-writing-canvas')?.textContent.includes('A new document created entirely offline.'));
  offline=false;await context.setOffline(false);
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
  assert.ok([...documents.values()].some(d=>d.plain_text.includes('Written offline')));
  assert.ok([...documents.values()].some(d=>d.plain_text.includes('A new document created entirely offline.')));
  assert.equal(folders.filter(f=>f.name==='Offline folder').length,1);
  // Two actual tabs can edit the same document offline without overwriting
  // one another's IndexedDB drafts, then resolve the real server CAS conflict.
  offline=true;await context.setOffline(true);
  await canvas.fill('Offline draft from the first tab.');
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));
  const clonedStorage=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage)));
  const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));
  await second.addInitScript(values=>Object.entries(values).forEach(([key,value])=>sessionStorage.setItem(key,value)),clonedStorage);
  await second.goto(origin+'/editor');
  const secondCanvas=second.getByRole('textbox',{name:'Document content'});await secondCanvas.waitFor();
  await second.waitForFunction(()=>document.querySelector('.uw-writing-canvas')?.textContent.includes('Offline draft from the first tab.'));
  assert.notEqual(await second.evaluate(()=>sessionStorage.getItem('uno-writing-tab')),clonedStorage['uno-writing-tab'],'Duplicated tabs get independent draft identities');
  // Restoring the account's workspace briefly locks editing while the durable
  // draft and project selection hydrate; wait for the real editable canvas.
  await second.locator('[aria-label="Document content"][contenteditable="true"]').waitFor();
  await secondCanvas.fill('Offline draft from the second tab.');
  await second.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));
  offline=false;await context.setOffline(false);
  const conflicted=await Promise.race([page,second].map(tab=>tab.locator('.uw-editor-conflict').waitFor({state:'visible'}).then(()=>tab)));
  const conflictedText=await conflicted.getByRole('textbox',{name:'Document content'}).textContent();
  assert.equal(await conflicted.evaluate(text=>new Promise(resolve=>{const open=indexedDB.open('uno-word-writing',1);open.onsuccess=()=>{const request=open.result.transaction('records').objectStore('records').getAll();request.onsuccess=()=>{resolve(request.result.some(record=>record.kind==='draft'&&record.value.dirty&&record.value.plain_text.trim()===text.trim()));open.result.close();};};}),conflictedText),true,'The losing tab retains a durable offline draft before conflict resolution');
  await conflicted.getByRole('button',{name:'Keep both copies',exact:true}).click();
  await conflicted.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved')).catch(async error=>{console.error('Conflict recovery diagnostics:',{status:await conflicted.locator('.uw-editor-save').textContent(),notices:await conflicted.locator('.uw-editor-notice').allTextContents(),conflicts:await conflicted.locator('.uw-editor-conflict').allTextContents(),calls:requests.slice(-10).map(r=>[r.method,r.key]),documents:[...documents.values()].map(d=>({id:d.id,revision:d.revision,text:d.plain_text}))});throw error;});
  assert.ok([...documents.values()].some(d=>d.plain_text.trim()==='Offline draft from the first tab.'));
  assert.ok([...documents.values()].some(d=>d.plain_text.trim()==='Offline draft from the second tab.'));
  await second.close();
  // Downgrade hides both editor and library without deleting local writing.
  pro=false;const downgradeCalls=requests.length;await page.reload();
  await page.getByRole('heading',{name:'Unlock Your Writing Space'}).waitFor();
  assert.equal(await page.locator('[contenteditable=true]').count(),0);
  assert.equal(await page.locator('.uw-editor-document').count(),0);
  const downgradePrivate=requests.slice(downgradeCalls).filter(r=>r.key.startsWith('/workspace/'));
  if(downgradePrivate.length)console.error('Downgrade requests:',downgradePrivate.map(r=>({method:r.method,key:r.key})));
  assert.equal(downgradePrivate.length,0,'Free must not fetch private workspace data');
  assert.equal(await page.evaluate(()=>new Promise(resolve=>{const open=indexedDB.open('uno-word-writing',1);open.onsuccess=()=>{const request=open.result.transaction('records').objectStore('records').getAll();request.onsuccess=()=>{resolve(request.result.some(r=>r.kind==='document'||r.kind==='draft'));open.result.close();};};})),true,'Existing writing survives downgrade');
  // Cached Free identities cannot bypass the gate by reloading offline.
  await context.setOffline(true);await page.reload();
  await page.getByRole('heading',{name:'Unlock Your Writing Space'}).waitFor();
  assert.equal(await page.locator('[contenteditable=true]').count(),0);
  pro=true;await context.setOffline(false);await canvas.waitFor();
  await page.waitForFunction(()=>document.querySelector('.uw-writing-canvas')?.textContent.includes('Offline draft from the'));
  // Revocation in an already open tab is detected when focus returns.
  pro=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('heading',{name:'Unlock Your Writing Space'}).waitFor();
  pro=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await canvas.waitFor();
  // A fresh device cache still opens private cloud metadata on demand.
  await page.evaluate(()=>new Promise(resolve=>{const open=indexedDB.open('uno-word-writing',1);open.onsuccess=()=>{const tx=open.result.transaction('records','readwrite');tx.objectStore('records').clear();tx.oncomplete=()=>{open.result.close();resolve();};};}));
  await page.reload();await canvas.waitFor();
  await page.waitForFunction(()=>document.querySelector('.uw-writing-canvas')?.textContent.includes('Offline draft from the'));
  // A different account never sees cached documents or recovery drafts.
  currentOwner=other;await page.evaluate(()=>window.postMessage({type:'UNO_WORD_ACCOUNT_CHANGED'},location.origin));
  await page.getByRole('heading',{name:'Sign in to write',exact:true}).waitFor();
  assert.equal(await page.locator('[contenteditable=true]').count(),0,'Extension account changes evict the previous account writing view');
  await page.reload();await page.getByRole('button',{name:'Start New Document',exact:true}).waitFor();
  assert.equal(await page.locator('.uw-editor-document').count(),0);
  assert.equal(await page.locator('.uw-editor-recovery').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: production editor; auth isolation; autosave/reopen; formatting; typed/pasted counts; library/folders/trash; conflicts; consent and coaching without insertion; profile and sources; import/export; focus/themes; 320/390/768/1440px EN/ES; offline create/edit/reload/reconnect; Free editor denial and preserved drafts; verified Pro and Lifetime access.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
