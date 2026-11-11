/** Synthetic accounts and APIs only. No live users, payments, or paid AI. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const origin=process.env.WRITING_TEST_ORIGIN||'http://localhost:4175';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const NOVEL='00000000-0000-4000-8000-000000000010',MEMOIR='00000000-0000-4000-8000-000000000011';
const stamp=()=>new Date().toISOString(),plain=n=>(n.text||'')+(n.content||[]).map(plain).join(' ');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async f=>{for(let i=0;i<150;i++){if(f())return;await wait(100);}throw Error('Fixture state did not settle');};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}});context.setDefaultTimeout(15000);
  await context.addInitScript(()=>{localStorage.setItem('uno-writing-theme','light');localStorage.setItem('uno-writing-language','en');});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
  let owner=A,pro=true,signed=false,failedSummary=false,conflict=false,empty=false;
  const prefs={user_id:A,revision:3,daily_goal:1000,timezone:'America/Chicago',language:'en',themes:['nature']};
  const docs=new Map(),activity=new Map(),requests=[],errors=[];
  const make=(id,title,completion_status='draft',status='active',user_id=A)=>({id,user_id,title,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Original writing that must stay intact.'}]}]},plain_text:'Original writing that must stay intact.',completion_status,status,folder_id:null,favorite:false,ai_allowed:false,revision:1,mutation_id:crypto.randomUUID(),created_at:stamp(),updated_at:stamp()});
  const first=make('00000000-0000-4000-8000-000000000101','A small beginning'),second=make('00000000-0000-4000-8000-000000000102','Remembering the journey'),completed=make('00000000-0000-4000-8000-000000000103','A finished chapter','completed');
  for(const d of [first,second,completed,make('00000000-0000-4000-8000-000000000104','Trashed writing','draft','trashed'),make('00000000-0000-4000-8000-000000000105','Archived writing','draft','archived'),make('00000000-0000-4000-8000-000000000201','Another account’s writing','draft','active',B)])docs.set(d.id,d);
  const projects=require('./helpers/project-fixture.cjs').projectsFixture(()=>owner,()=>[...docs.values()]);
  for(const [id,name] of [[NOVEL,'My Novel'],[MEMOIR,'My Memoir']])projects('/workspace/projects/'+id,'PUT',{name,description:'Private project',project_type:'novel',status:'in_progress',goals:{},preferences:{},revision:0,mutation_id:crypto.randomUUID()});
  for(const [doc,project] of [[first,NOVEL],[second,MEMOIR],[completed,NOVEL]])projects('/workspace/projects/resources/document/'+doc.id,'PUT',{revision:0,project_ids:[project],mutation_id:crypto.randomUUID()});
  projects('/workspace/projects/active','PUT',{revision:0,project_id:MEMOIR,last_documents:{[MEMOIR]:second.id},mutation_id:crypto.randomUUID()});
  await context.route(origin+'/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),key=url.pathname.replace('/api',''),method=req.method(),body=req.postData()?JSON.parse(req.postData()):null;requests.push({key,method,body});
   let status=200,value={};
   if(key==='/product')value={name:'UnoWord',billing_available:false,chrome_store_url:null,plans:[],features:[]};
   else if(!signed){status=401;value={detail:'Authentication required'};}
   else if(key==='/auth/me')value={id:owner,email:'writer@example.com',plan:pro?'pro':'free',ai_access:pro};
   else if(key==='/auth/refresh')value={authenticated:true};
   else if(key==='/progress/preferences'){
    if(method==='PUT'){
     assert.equal(body.expected_user_id,owner);
     if(conflict){prefs.daily_goal=600;prefs.revision++;status=409;value={detail:{code:'preferences_changed',current:{...prefs,user_id:owner}}};conflict=false;}
     else{assert.equal(body.revision,prefs.revision);Object.assign(prefs,{daily_goal:body.daily_goal,revision:prefs.revision+1});}
    }
    if(status===200)value={...prefs,user_id:owner};
   }
   else if(key==='/progress/summary'){
    if(failedSummary){status=503;value={detail:'progress_sync_unavailable'};}
    else value={user_id:owner,reportingDate:new Intl.DateTimeFormat('en-CA',{timeZone:prefs.timezone}).format(new Date()),timezone:prefs.timezone,dailyWordCount:owner===A?742:24,dailyActiveWritingSeconds:1200,lifetimeActiveWritingSeconds:7200,lifetimeWordCount:12860,dailyGoal:prefs.daily_goal,displayedStreak:pro?15:7,sessions:[],updatedAt:stamp()};
   }
   else if(key==='/progress/streak')value={user_id:owner,displayedStreak:pro?15:7,hasUnlimitedStreakAccess:pro,streakLimitReached:!pro,journeyContinues:!pro,timezone:prefs.timezone,asOf:stamp()};
   else if(key.startsWith('/workspace')&&!pro){status=403;value={detail:'writing_workspace_pro_required'};}
   else if(key.startsWith('/workspace/projects')){const r=projects(key,method,body);status=r.status;value=r.value;}
   else if(key==='/workspace/documents')value=empty?[]:[...docs.values()].filter(d=>d.user_id===owner).map(({content,plain_text,...metadata})=>metadata);
   else if(/^\/workspace\/documents\/[^/]+$/.test(key)){
    const id=key.split('/').pop(),saved=docs.get(id);
    if(method==='GET'){value=saved;if(!saved||saved.user_id!==owner){status=404;value={detail:'document_not_found'};}}
    else{assert.equal(body.expected_user_id,owner);assert.ok(!saved||saved.user_id===owner);value={...body,id,user_id:owner,plain_text:plain(body.content),revision:(saved?.revision||0)+1,created_at:saved?.created_at||stamp(),updated_at:stamp()};docs.set(id,value);}
   }
   else if(key==='/workspace/activity'&&method==='GET')value=[...activity.values()];
   else if(key==='/workspace/activity'){activity.set(body.id,body);value=body;}
   else if(key==='/workspace/folders'||key==='/workspace/sources'||key==='/ai/onboarding')value=[];
   else if(key==='/workspace/config')value={daily_goal:1000,max_document_chars:200000,max_upload_bytes:5242880,ai_batch_size:3};
   else if(key==='/ai/profile')value={id:'profile',user_id:owner,primary_topics:[],favorite_subjects:[],current_projects:[],avoid_topics:[],ai_preferences:{prompt_themes:['nature']}};
   else if(key==='/ai/usage/summary')value={user_id:owner,legacy_shared:false,timezone:prefs.timezone,daily_reset_at:new Date(Date.now()+86400000).toISOString(),monthly_reset_at:new Date(Date.now()+2592000000).toISOString(),daily_limit:10,used_today:0,remaining:10,suggestions_monthly_limit:200,suggestions_monthly_used:0,suggestions_monthly_remaining:200,guidance_monthly_limit:30,guidance_monthly_used:0,guidance_monthly_remaining:30};
   else if(key==='/onboarding')value={version:1,status:'completed',current_step:'done',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
   else if(key==='/subscription')value={user_id:owner,billing_available:false,managed_by_stripe:false,status:'inactive',trial_eligible:true};
   else if(key==='/subscription/substack')value={user_id:owner,configured:false,available:false,connected:false,subscriptions:[]};
   else if(key==='/rewards'){status=503;value={detail:'rewards_setup_required'};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  });
  const page=await context.newPage();page.on('pageerror',error=>{errors.push(error.message);console.error(error);});
  await page.goto(origin+'/app');await page.getByRole('link',{name:'Sign in',exact:true}).waitFor();assert.equal(await page.getByTestId('studio-home').count(),0);
  signed=true;await page.reload();const home=page.getByTestId('studio-home');await home.waitFor();
  await page.getByRole('link',{name:'A small beginning',exact:false}).waitFor();
  const progress=page.getByRole('progressbar',{name:'Daily writing goal',exact:true});
  await page.waitForFunction(()=>document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')==='74');
  assert.equal(await progress.getAttribute('aria-valuenow'),'74');
  assert.ok((await home.textContent()).includes('00:20:00'));
  assert.ok((await home.textContent()).includes('15 days'));
  assert.equal(await page.getByRole('link',{name:'Trashed writing',exact:false}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Archived writing',exact:false}).count(),0);
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
  assert.equal(requests.some(r=>r.method!=='GET'&&r.key.startsWith('/workspace')),false,'Home never creates activity or documents');
  const prompt=page.locator('.uw-home-prompt-text'),originalPrompt=await prompt.textContent();
  const pool=require('../extension/shared/prompts.js');
  const nature=globalThis.WCPrompts.buildPool(['nature'],'en').map(p=>p.text);
  assert.ok(nature.includes(originalPrompt),'Uses existing selected-theme prompt library');
  await page.getByRole('button',{name:'Another Quick Prompt',exact:true}).click();assert.notEqual(await prompt.textContent(),originalPrompt);
  const currentPrompt=await prompt.textContent();await page.reload();await home.waitFor();await page.waitForFunction(text=>document.querySelector('.uw-home-prompt-text')?.textContent===text,currentPrompt);
  await page.getByRole('button',{name:'Edit daily goal',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Your daily writing goal',exact:true});await dialog.waitFor();
  await page.getByRole('button',{name:'Save goal',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Close goal settings',exact:true}).evaluate(el=>el===document.activeElement),true,'Goal dialog contains keyboard focus');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Edit daily goal',exact:true}).evaluate(el=>el===document.activeElement),true,'Escape restores the goal trigger');
  await page.getByRole('button',{name:'Edit daily goal',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Words per day',exact:true}).fill('500');await page.getByRole('button',{name:'Save goal',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(prefs.daily_goal,500);await page.waitForFunction(()=>document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')==='100');assert.equal(await prompt.textContent(),currentPrompt,'Goal changes do not replace the prompt');
  await page.getByText('You reached today’s goal.',{exact:false}).waitFor();
  conflict=true;await page.getByRole('button',{name:'Edit daily goal',exact:true}).click();await page.getByRole('spinbutton',{name:'Words per day',exact:true}).fill('800');await page.getByRole('button',{name:'Save goal',exact:true}).click();await page.getByRole('alert').filter({hasText:'another device'}).waitFor();assert.equal(prefs.daily_goal,600);await page.getByRole('button',{name:'Close goal settings',exact:true}).click();
  // The primary action restores existing writing without creating a new draft.
  const initialCount=docs.size;await page.getByRole('link',{name:'Start Writing',exact:true}).click();await page.waitForFunction(expected=>document.querySelector('[aria-label="Rename document"]')?.value===expected,second.title);assert.equal(docs.size,initialCount);
  await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Home',exact:true}).click();await home.waitFor();
  // Direct recent-document links select the correct project, including completed read-only documents.
  await page.getByRole('link',{name:'A small beginning',exact:false}).click();await page.getByRole('textbox',{name:'Rename document',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Rename document',exact:true}).inputValue(),first.title);
  await page.waitForFunction(expected=>document.querySelector('.uw-project-controls select')?.value===expected,NOVEL);
  await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Home',exact:true}).click();await home.waitFor();
  await page.getByRole('link',{name:'A finished chapter',exact:false}).click();await page.getByRole('textbox',{name:'Rename document',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Rename document',exact:true}).inputValue(),completed.title);
  await page.waitForFunction(()=>document.querySelector('.tiptap')?.getAttribute('contenteditable')==='false');
  await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Home',exact:true}).click();await home.waitFor();
  await page.waitForFunction(()=>!document.querySelector('.uw-home-prompt-content button')?.disabled);
  const before=docs.size;const useTitle=await prompt.textContent();await page.getByRole('button',{name:'Use This Prompt',exact:true}).click();
  try { await page.waitForURL(url=>url.pathname==='/editor'&&url.searchParams.has('document')); }
  catch(error) { console.error({url:page.url(),alerts:await page.locator('[role="alert"]').allTextContents(),notices:await page.locator('[role="status"]').allTextContents(),lastRequests:requests.slice(-12).map(r=>[r.key,r.method])});await page.screenshot({path:'/tmp/unoword-home-handoff-debug.png'});throw error; }
  await until(()=>docs.size===before+1);assert.equal(await page.getByRole('textbox',{name:'Rename document',exact:true}).inputValue(),useTitle);
  assert.equal((await page.getByRole('textbox',{name:'Document content',exact:true}).textContent()).trim(),'');
  assert.equal(first.plain_text,'Original writing that must stay intact.');
  const count=docs.size;await page.reload();await page.getByRole('textbox',{name:'Rename document',exact:true}).waitFor();assert.equal(docs.size,count,'Reload does not duplicate a prompt draft');
  await page.goto(origin+'/app');await home.waitFor();
  const artifact=path.join(__dirname,'artifacts','home');fs.mkdirSync(artifact,{recursive:true});
  for(const width of [320,390,768,1024,1440]){
   await page.setViewportSize({width,height:1100});await wait(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No overflow at '+width);
   if([390,1440].includes(width))await page.screenshot({path:path.join(artifact,`home-${width}-light.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Use dark theme',exact:true}).click();await page.screenshot({path:path.join(artifact,'home-1440-dark.png'),fullPage:true});
  await page.getByRole('combobox',{name:'Interface language',exact:true}).selectOption('es');await page.getByRole('button',{name:'Usar esta idea',exact:true}).waitFor();assert.equal(await page.getByTestId('studio-shell').getAttribute('lang'),'es');
  await page.setViewportSize({width:320,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Spanish fits mobile');
  await page.getByRole('combobox',{name:'Idioma de la interfaz',exact:true}).selectOption('en');await page.setViewportSize({width:1440,height:1100});
  await context.setOffline(true);await page.getByText('Offline · last confirmed totals',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Edit daily goal',exact:true}).isDisabled(),true);assert.ok((await home.textContent()).includes('00:20:00'),'Offline view keeps confirmed totals');
  await context.setOffline(false);await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Account progress updated',{exact:true}).waitFor();
  empty=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('heading',{name:'A little space for your next idea.',exact:true}).waitFor();await page.waitForFunction(()=>{const image=document.querySelector('.uw-home-empty img');return image?.complete&&image.naturalWidth>0;});empty=false;
  failedSummary=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Progress unavailable',{exact:false}).waitFor();assert.equal(await progress.getAttribute('aria-valuenow'),null,'Unknown progress never displays zero as a confirmed value');failedSummary=false;
  // Account switching clears private Home results before reloading another identity.
  owner=B;await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'uno-writing-identity',newValue:null})));await page.getByRole('link',{name:'Another account’s writing',exact:false}).waitFor();assert.equal(await page.getByRole('link',{name:'A small beginning',exact:false}).count(),0);
  pro=false;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Your writing habit starts here.',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Another account’s writing',exact:false}).count(),0);assert.equal(await page.getByRole('link',{name:'Start Writing',exact:true}).getAttribute('href'),'/account#install');
  assert.ok((await home.textContent()).includes('7 days'));await page.getByRole('button',{name:'Use This Prompt',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await prompt.textContent());
  assert.equal(requests.some(r=>r.key==='/workspace/assistant'||r.key==='/ai/suggestion'||r.key.includes('checkout')),false);
  assert.deepEqual(errors,[]);
  console.log('PASS Home: auth/private metadata, shared totals/time/streak, selected-theme Quick Prompts, no automatic writes/AI, goal save/conflict, completed/current-project deep links, one-use empty prompt draft, no lost writing, 320–1440px EN/ES/themes, errors, account switching and downgrade isolation, Free prompt copying and extension CTA.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
