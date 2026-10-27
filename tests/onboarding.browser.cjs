/** Production bundle with private HTTP fixtures. No real user or paid AI calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const origin=process.env.WRITING_TEST_ORIGIN||'http://localhost:4175';
const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const empty={type:'doc',content:[{type:'paragraph'}]};
const plain=n=>n.type==='text'?n.text:(n.content||[]).map(plain).join(['doc','listItem','bulletList','orderedList'].includes(n.type)?'\n':'');
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,sorted(v)])):value;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});context.setDefaultTimeout(15000);
  let signedIn=true,pro=true,offline=false,failSave=false,failFolders=false,conflictNext=false,currentOwner=owner;
  let tour={version:1,status:'not_started',current_step:'welcome',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
  const documents=new Map(),activity=new Map(),folders=[];const requests=[],errors=[];
  const profile={id:'profile',user_id:owner,writing_goal:'Essays about craft and community',primary_topics:['craft','community'],favorite_subjects:['attention'],current_projects:[],avoid_topics:[],writing_style:'Reflective and clear',audience:'Curious readers',personal_context:'',ai_preferences:{prompt_themes:['ideas']}};
  const sources=[{id:'00000000-0000-4000-8000-000000000009',document_title:'Notes on building a garden',enabled:true,source_kind:'file'}];
  await context.route(origin+'/api/**',async route=>{
   if(offline)return route.abort('internetdisconnected');
   const req=route.request(),url=new URL(req.url()),key=url.pathname.replace('/api',''),method=req.method();
   const body=req.postData()?JSON.parse(req.postData()):null;requests.push({key,method,body});let status=200,value;
   if(!signedIn){status=401;value={detail:'Authentication required'};}
   else if(key==='/auth/me')value={id:currentOwner,email:currentOwner===owner?'writer@example.com':'other@example.com',plan:pro?'pro':'free',ai_access:pro};
   else if(key==='/subscription')value={user_id:currentOwner,billing_available:false,status:'inactive',trial_eligible:true};
   else if(key==='/product')value={name:'UnoWord',billing_available:false,chrome_store_url:null,plans:[],features:[]};
   else if(key==='/auth/google')value={enabled:false};
   else if(key==='/auth/refresh')value={authenticated:true};
   else if(key==='/ai/profile'&&method==='GET')value=profile;
   else if(key==='/ai/profile'&&method==='PUT'){assert.equal(body.expected_user_id,currentOwner);Object.assign(profile,body);value=profile;}
   else if(key==='/onboarding'){if(method==='PUT'){const {expected_user_id,...next}=body;tour={...next,completed_actions:{...tour.completed_actions,...next.completed_actions}};}value=tour;}
   else if(key==='/workspace/config')value={daily_goal:250,max_document_chars:200000,max_upload_bytes:5242880,ai_batch_size:3};
   else if(key==='/workspace/documents')value=[...documents.values()].filter(d=>d.user_id===currentOwner && (!url.searchParams.get('q') || (d.title+' '+d.plain_text).toLowerCase().includes(url.searchParams.get('q').toLowerCase()))).slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+200).map(({content,plain_text,...metadata})=>metadata);
   else if(/^\/workspace\/documents\/[^/]+$/.test(key)){
    const id=key.split('/').pop(),existing=documents.get(id);
    if(method==='GET'){value=existing?.user_id===currentOwner?existing:{detail:'not_found'};if(!existing)status=404;}
    else if(failSave){status=503;value={detail:'workspace_storage_unavailable'};}
    else if(body.expected_user_id!==currentOwner){status=409;value={detail:'account_changed'};}
    else if(existing?.mutation_id===body.mutation_id)value=existing;
    else if(conflictNext||existing&&existing.revision!==body.revision){
     if(conflictNext){existing.revision++;existing.title='Cloud title';existing.content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'A newer thought saved in another tab.'}]}]};existing.plain_text=plain(existing.content);conflictNext=false;}
     status=409;value={detail:'revision_conflict'};
    }else{value={...body,content:sorted(body.content),id,user_id:currentOwner,plain_text:plain(body.content),revision:(existing?.revision||0)+1,created_at:existing?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};delete value.expected_user_id;documents.set(id,structuredClone(value));}
   }else if(key==='/workspace/folders'&&method==='GET')value=folders;
   else if(key==='/workspace/folders'){value={id:crypto.randomUUID(),name:body.name};folders.push(value);}
   else if(key.startsWith('/workspace/folders/')){
    if(failFolders){status=503;value={detail:'workspace_storage_unavailable'};}
    else{const id=key.split('/').pop();value=folders.find(f=>f.id===id)||{id,name:body.name};if(!folders.some(f=>f.id===id))folders.push(value);}
   }
   else if(key==='/workspace/activity'&&method==='GET')value=[...activity.values()];
   else if(key==='/workspace/activity'){const prev=activity.get(body.id);if(!prev||prev.sequence<body.sequence)activity.set(body.id,body);value=activity.get(body.id);}
   else if(key==='/workspace/sources')value=sources;
   else if(key.startsWith('/workspace/sources/')){Object.assign(sources[0],body);value=sources[0];}
   else if(key==='/workspace/assistant'){
    assert.equal(pro,true);assert.equal(body.consent,true);assert.equal(body.expected_user_id,currentOwner);
    value={items:body.action==='improve'?[{title:'A clearer passage',text:'Keeps your thought and simplifies its rhythm.',replacement:'A careful first step makes room for a better idea.'}]:Array.from({length:3},(_,i)=>({title:['The quiet value of practice','How small gardens teach patience','What we learn by paying attention'][i],text:'An angle grounded in your interests in craft and community.',replacement:null}))};
   }else throw Error('Unexpected fixture endpoint '+method+' '+key);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  });

  let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/editor');
  let panel=page.getByRole('complementary',{name:'UnoWord guided writing tour'});
  await panel.getByRole('heading',{name:'Every Great Story Starts Somewhere'}).waitFor();
  await panel.getByRole('button',{name:'Write My First Sentence'}).click();
  const canvas=page.getByRole('textbox',{name:'Document content'});await canvas.waitFor();
  await panel.getByRole('heading',{name:'It Starts with One Sentence'}).waitFor();
  // A paste is not the first-sentence achievement.
  await canvas.click();await canvas.evaluate(el=>{el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertFromPaste',bubbles:true}));document.execCommand('insertText',false,'A pasted sentence is not typed.');});
  assert.equal(await panel.getByRole('heading',{name:'You Did It. You Started.'}).count(),0);
  await canvas.fill('');await canvas.pressSequentially('Today I begin a new story',{delay:15});
  await panel.getByRole('heading',{name:'You Did It. You Started.'}).waitFor();
  assert.equal(await canvas.evaluate(el=>el.contains(document.activeElement)||el===document.activeElement),true,'Achievement does not steal typing focus');
  const draft=await canvas.textContent();assert.ok(draft.includes('Today I begin'));
  if(process.env.ONBOARDING_SCREENSHOTS){fs.mkdirSync(process.env.ONBOARDING_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.ONBOARDING_SCREENSHOTS,'tour-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.ONBOARDING_SCREENSHOTS,'tour-mobile.png')});await page.setViewportSize({width:1440,height:1000});}

  await page.reload();await panel.getByRole('heading',{name:'You Did It. You Started.'}).waitFor();assert.ok((await canvas.textContent()).includes('Today I begin'));
  await panel.getByRole('button',{name:'Keep Going',exact:true}).click();
  await canvas.click();await canvas.press('ControlOrMeta+End');await canvas.pressSequentially(' with curiosity');
  await panel.getByText(/building momentum/).waitFor();
  await panel.getByRole('button',{name:'Next',exact:true}).click();
  await panel.getByText('Your writing session is already active—no duplicate session is needed.').waitFor();
  await panel.getByRole('button',{name:'Next',exact:true}).click();
  await panel.getByRole('button',{name:'100',exact:true}).click();
  await panel.getByText('Your goal is set. Every word brings you closer.').waitFor();
  assert.equal(await page.getByLabel('Daily goal',{exact:true}).inputValue(),'100');
  await panel.getByRole('button',{name:'Next',exact:true}).click();
  await panel.getByRole('button',{name:'Next',exact:true}).click();
  await panel.getByRole('button',{name:'Reveal a writing suggestion'}).click();
  assert.ok((await page.locator('.uw-editor-prompt').textContent()).length>35);
  await panel.getByRole('button',{name:'Next',exact:true}).click();
  await panel.getByRole('button',{name:'Open My Writing Profile'}).click();
  await page.getByRole('dialog',{name:'My Writing Profile'}).waitFor();await page.getByRole('dialog',{name:'My Writing Profile'}).getByRole('button',{name:'Cancel',exact:true}).click();
  await panel.getByRole('button',{name:'Next',exact:true}).click();
  await panel.getByRole('button',{name:'Skip this step',exact:true}).click();
  await panel.getByRole('heading',{name:'One Sentence Down. Endless Possibilities Ahead.'}).waitFor();
  await panel.getByText('First sentence written',{exact:true}).waitFor();
  assert.equal(await panel.getByText('Extension instructions explored',{exact:true}).count(),0);
  assert.equal(requests.some(r=>r.key==='/workspace/assistant'),false,'Tour never sends writing to AI');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);}
  await page.setViewportSize({width:1440,height:1000});
  if(process.env.AXE_SCRIPT){await page.addScriptTag({path:process.env.AXE_SCRIPT});const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);}
  await panel.getByRole('button',{name:'Continue Writing',exact:true}).click();assert.equal(await panel.count(),0);
  await page.getByRole('button',{name:'Take the UnoWord Tour',exact:true}).click();
  await panel.getByRole('button',{name:'Use my current document'}).click();
  await panel.getByRole('heading',{name:'You Did It. You Started.'}).waitFor();
  await panel.getByRole('button',{name:'Pause tour'}).click();assert.equal(await panel.count(),0);
  await page.reload();assert.equal(await panel.count(),0);await page.getByRole('button',{name:'Resume UnoWord Tour'}).click();
  await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
  // Dismiss the floating launcher with the keyboard; keep the saved step and draft.
  await page.setViewportSize({width:320,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  const hide=page.getByRole('button',{name:'Hide tutorial tour',exact:true});
  assert.ok((await hide.boundingBox()).width>=40);
  await hide.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('.uw-tour-launch').count(),0);
  await page.reload();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.uw-tour-launch').count(),0);
  assert.equal(await panel.count(),0);
  assert.ok((await canvas.textContent()).includes('Today I begin'));
  // Existing account navigation explicitly restores the tutorial, without resetting it.
  await page.goto(origin+'/account');
  await page.getByRole('region',{name:'UnoWord onboarding'}).getByRole('link',{name:'Resume UnoWord Tour'}).click();
  await panel.getByRole('heading',{name:'You Did It. You Started.'}).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('tour'),false);
  await panel.getByRole('button',{name:'Hide tutorial tour',exact:true}).click();
  await page.reload();await page.waitForLoadState('networkidle');
  assert.equal(await panel.count(),0);assert.equal(await page.locator('.uw-tour-launch').count(),0);
  await page.setViewportSize({width:1440,height:1000});
  // A fresh tour may skip every action without fabricating any achievements.
  await page.close();currentOwner=other;
  tour={version:1,status:'not_started',current_step:'welcome',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  panel=page.getByRole('complementary',{name:'UnoWord guided writing tour'});
  await page.goto(origin+'/editor');await panel.getByRole('button',{name:'Write My First Sentence'}).click();
  await panel.getByRole('heading',{name:'It Starts with One Sentence'}).waitFor();
  await panel.getByRole('button',{name:'Skip this step',exact:true}).click();
  for(let i=0;i<7;i++)await panel.getByRole('button',{name:'Skip this step',exact:true}).click();
  await panel.getByRole('heading',{name:'One Sentence Down. Endless Possibilities Ahead.'}).waitFor();
  assert.equal(await panel.getByText('First sentence written',{exact:true}).count(),0);
  assert.ok([...documents.values()].some(d=>d.plain_text.includes('Today I begin')),'Original writing survives replay/new drafts');
  // Offline refresh resumes from the local cache, without paid model requests.
  await page.waitForFunction(async()=>Boolean(await caches.match(location.origin+'/editor')));
  offline=true;await context.setOffline(true);await page.reload();
  await panel.getByRole('heading',{name:'One Sentence Down. Endless Possibilities Ahead.'}).waitFor();
  offline=false;await context.setOffline(false);
  pro=false;await page.reload();await page.getByRole('heading',{name:'Your writing workspace is a Pro feature'}).waitFor();assert.equal(await panel.count(),0);
  await page.goto(origin+'/account');await page.getByRole('region',{name:'UnoWord onboarding'}).getByText('The full writing editor is a Pro feature.',{exact:false}).waitFor();
  pro=true;await page.reload();await page.getByRole('region',{name:'UnoWord onboarding'}).getByRole('link',{name:/Write My First Sentence|Resume UnoWord Tour|Take the UnoWord Tour/}).click();
  await panel.getByRole('heading',{name:'One Sentence Down. Endless Possibilities Ahead.'}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS onboarding: real typing without punctuation; paste exclusion; no focus theft; refresh/resume; counter/session/goal/prompt/profile actions; real achievements; skipped steps; replay; 320–1440px; WCAG; Free restriction; dismiss launcher/card, keyboard access, refresh persistence, account restore, account isolation; no AI calls.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
