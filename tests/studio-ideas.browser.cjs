/** Synthetic accounts only. Static prompts never call paid AI or production APIs. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const origin=process.env.WRITING_TEST_ORIGIN||'http://localhost:4175';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const stamp=()=>new Date().toISOString(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}});context.setDefaultTimeout(15000);
  await context.addInitScript(()=>{localStorage.setItem('uno-writing-theme','light');localStorage.setItem('uno-writing-language','en');});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
  let owner=A,paid=false,signed=false,prefsFailed=false,badIdeaOwner=false;
  const requests=[],errors=[],documents=new Map();
  const initial={id:'00000000-0000-4000-8000-000000000101',user_id:A,title:'My existing draft',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'My own writing stays here.'}]}]},plain_text:'My own writing stays here.',status:'active',completion_status:'draft',folder_id:null,favorite:false,ai_allowed:false,revision:1,mutation_id:crypto.randomUUID(),created_at:stamp(),updated_at:stamp()};documents.set(initial.id,initial);
  const projects=require('./helpers/project-fixture.cjs').projectsFixture(()=>owner,()=>[...documents.values()]);
  await context.route(origin+'/api/**',async route=>{
   const req=route.request(),key=new URL(req.url()).pathname.replace('/api',''),method=req.method(),body=req.postData()?JSON.parse(req.postData()):null;requests.push({key,method,body});let status=200,value={};
   if(key==='/product')value={name:'UnoWord',billing_available:false,chrome_store_url:null,plans:[],features:[]};
   else if(!signed){status=401;value={detail:'Authentication required'};}
   else if(key==='/auth/me')value={id:owner,email:'writer@example.com',plan:paid?'pro':'free',ai_access:paid};
   else if(key==='/auth/refresh')value={authenticated:true};
   else if(key==='/ai/ideas'){
    assert.equal(paid,true,'Free accounts must not query saved AI ideas');
    const identity=badIdeaOwner?B:owner;
    value=[{id:'00000000-0000-4000-8000-000000000301',user_id:identity,title:identity===A?'A private saved direction':'B private saved direction',suggestion:'Consider what a familiar place can teach you.',reason:'A reflective direction',context_summary:'Only authorized context',questions:['What detail would you explore?'],inspired_by:[],mode:'expand_idea',status:'accepted',created_at:stamp(),related_topics:[],source_ids:[]}];
   }
   else if(key==='/progress/preferences'){if(prefsFailed){status=503;value={detail:'unavailable'};}else value={user_id:owner,revision:1,daily_goal:500,timezone:'America/Chicago',language:'en',themes:['nature']};}
   else if(key==='/progress/summary')value={user_id:owner,reportingDate:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date()),timezone:'America/Chicago',dailyWordCount:42,dailyActiveWritingSeconds:120,lifetimeActiveWritingSeconds:1200,lifetimeWordCount:1000,dailyGoal:500,displayedStreak:paid?10:7,sessions:[],updatedAt:stamp()};
   else if(key==='/progress/streak')value={user_id:owner,displayedStreak:paid?10:7,hasUnlimitedStreakAccess:paid,streakLimitReached:!paid,journeyContinues:!paid,timezone:'America/Chicago',asOf:stamp()};
   else if(key.startsWith('/workspace')&&!paid){status=403;value={detail:'writing_workspace_pro_required'};}
   else if(key.startsWith('/workspace/projects')){const r=projects(key,method,body);status=r.status;value=r.value;}
   else if(key==='/workspace/documents')value=[...documents.values()].filter(d=>d.user_id===owner).map(({content,plain_text,...metadata})=>metadata);
   else if(key.startsWith('/workspace/documents/')){
    const id=key.split('/').pop(),old=documents.get(id);
    if(method==='GET')value=old;
    else{assert.equal(body.expected_user_id,owner);value={...body,id,user_id:owner,revision:(old?.revision||0)+1,plain_text:'',created_at:old?.created_at||stamp(),updated_at:stamp()};documents.set(id,value);}
   }
   else if(key==='/workspace/config')value={daily_goal:500,max_document_chars:200000,max_upload_bytes:5242880,ai_batch_size:3};
   else if(['/workspace/activity','/workspace/folders','/workspace/sources','/ai/onboarding'].includes(key))value=[];
   else if(key==='/ai/profile')value={id:'profile',user_id:owner,primary_topics:[],favorite_subjects:[],current_projects:[],avoid_topics:[],ai_preferences:{}};
   else if(key==='/onboarding')value={version:1,status:'completed',current_step:'done',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
   else if(key==='/ai/usage/summary')value={user_id:owner,daily_limit:10,used_today:0,remaining:10,suggestions_monthly_limit:200,suggestions_monthly_used:0,suggestions_monthly_remaining:200,guidance_monthly_limit:30,guidance_monthly_used:0,guidance_monthly_remaining:30};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/ideas');await page.getByRole('link',{name:'Sign in',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Sign in',exact:true}).getAttribute('href'),'/account?next=%2Fideas');
  signed=true;await page.reload();await page.getByTestId('studio-ideas').waitFor();
  const cards=page.locator('.uw-ideas-prompt-card');await cards.first().waitFor();assert.equal(await cards.count(),4,'Existing selected nature themes are used');
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
  assert.equal(requests.some(r=>r.key.startsWith('/workspace')||r.key.startsWith('/ai/')),false,'Opening Ideas fetches no workspace or AI data');
  assert.equal(requests.some(r=>r.method!=='GET'&&r.key!=='/auth/refresh'),false,'Opening Ideas writes no preferences or activity');
  await page.getByRole('button',{name:'View saved ideas',exact:true}).click();await page.getByRole('heading',{name:'Keep your next direction close.',exact:true}).waitFor();assert.equal(requests.some(r=>r.key==='/ai/ideas'),false);await page.getByRole('button',{name:'Hide saved ideas',exact:true}).click();
  const daily=await page.locator('.uw-home-prompt-text').textContent();await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Home',exact:true}).click();await page.waitForFunction(text=>document.querySelector('.uw-home-prompt-text')?.textContent===text,daily);
  await page.getByRole('link',{name:'Get Ideas',exact:true}).click();await page.getByTestId('studio-ideas').waitFor();assert.equal(await page.locator('.uw-home-prompt-text').textContent(),daily,'Home and Ideas share the daily prompt');
  await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('fiction');await page.waitForFunction(()=>[...document.querySelectorAll('[data-prompt-id]')].every(el=>el.dataset.promptId.startsWith('en:fiction:')));
  const first=cards.first(),text=await first.locator('h3').textContent(),id=await first.getAttribute('data-prompt-id');
  await first.getByRole('button',{name:'Copy prompt',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),text);await first.getByRole('button',{name:'Copied',exact:true}).waitFor();
  await first.getByRole('button',{name:'Save prompt: '+text,exact:true}).click();await page.getByRole('button',{name:'Saved prompts (1)',exact:true}).click();assert.equal(await cards.count(),1);assert.equal(await cards.first().getAttribute('data-prompt-id'),id);
  await page.reload();await page.getByRole('button',{name:'Saved prompts (1)',exact:true}).click();await cards.first().waitFor();assert.equal(await cards.count(),1,'Browser saves survive refresh');
  // Another tab's latest saves are retained when this tab edits its collection.
  const other='en:nature:0';await page.evaluate(([owner,id])=>{localStorage.setItem('uno-saved-prompts:'+owner,JSON.stringify([id]));window.dispatchEvent(new StorageEvent('storage',{key:'uno-saved-prompts:'+owner}));},[A,other]);
  await page.waitForFunction(id=>document.querySelector('[data-prompt-id]')?.dataset.promptId===id,other);
  await cards.first().getByRole('button',{name:'Unsave prompt:',exact:false}).click();await page.getByRole('heading',{name:'Keep an idea for another day.',exact:true}).waitFor();
  await page.getByRole('button',{name:'Explore all prompts',exact:true}).click();assert.equal(await cards.count(),9);await page.getByRole('button',{name:'Show more prompts',exact:true}).click();assert.equal(await cards.count(),18);
  await page.getByRole('searchbox',{name:'Search prompts',exact:true}).fill('unfindable-little-idea');await page.getByRole('heading',{name:'Try a different word or theme.',exact:true}).waitFor();
  await page.waitForFunction(()=>{const image=document.querySelector('.uw-home-empty img');return image?.complete&&image.naturalWidth>0;});
  await page.getByRole('button',{name:'Explore all prompts',exact:true}).click();
  const artifact=path.join(__dirname,'artifacts','ideas');fs.mkdirSync(artifact,{recursive:true});
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:1100});await page.evaluate(()=>window.scrollTo(0,0));await wait(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No overflow at '+width);if([390,1440].includes(width))await page.screenshot({path:path.join(artifact,`ideas-${width}-light.png`),fullPage:true});}
  await page.getByRole('button',{name:'Use dark theme',exact:true}).click();await page.screenshot({path:path.join(artifact,'ideas-1440-dark.png'),fullPage:true});
  await page.getByRole('combobox',{name:'Interface language',exact:true}).selectOption('es');await page.getByRole('heading',{name:'Sigue tu curiosidad.',exact:true}).waitFor();await page.getByRole('combobox',{name:'Tema',exact:true}).selectOption('nature');assert.ok((await cards.first().getAttribute('data-prompt-id')).startsWith('es:nature:'));
  await page.setViewportSize({width:320,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Spanish fits mobile');await page.getByRole('combobox',{name:'Idioma de la interfaz',exact:true}).selectOption('en');await page.setViewportSize({width:1440,height:1100});
  await context.setOffline(true);await page.getByText('Offline · Quick Prompts',{exact:false}).waitFor();await page.getByRole('button',{name:'Another Quick Prompt',exact:true}).click();await cards.first().getByRole('button',{name:'Save prompt:',exact:false}).click();await page.getByRole('button',{name:'Saved prompts (1)',exact:true}).click();assert.equal(await cards.count(),1);await context.setOffline(false);
  // Save state and messages belong only to the currently verified account.
  owner=B;await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'uno-writing-identity',newValue:null})));await page.getByRole('button',{name:'Saved prompts (0)',exact:true}).waitFor();await page.getByRole('button',{name:'Saved prompts (0)',exact:true}).click();await page.getByRole('heading',{name:'Keep an idea for another day.',exact:true}).waitFor();
  // Failed browser writes remain usable for this visit without discarding earlier session saves.
  await page.getByRole('button',{name:'Explore all prompts',exact:true}).click();
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreIdeaStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith('uno-saved-prompts:'))throw new DOMException('Full','QuotaExceededError');return original.call(this,key,value);};});
  await cards.nth(0).getByRole('button',{name:'Save prompt:',exact:false}).click();await page.getByText('Saves will last for this visit only.',{exact:false}).waitFor();await cards.nth(1).getByRole('button',{name:'Save prompt:',exact:false}).click();await page.getByRole('button',{name:'Saved prompts (2)',exact:true}).click();assert.equal(await cards.count(),2);await page.evaluate(()=>window.restoreIdeaStorage());
  prefsFailed=true;await page.reload();await page.getByText('Your theme preferences are unavailable.',{exact:false}).waitFor();await page.locator('.uw-home-prompt-text').filter({hasText:/\S/}).waitFor();prefsFailed=false;
  owner=A;paid=true;await page.reload();await page.getByRole('link',{name:'Open writing coach',exact:true}).waitFor();await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('fiction');await cards.first().waitFor();
  const ideaCount=documents.size;await page.getByRole('button',{name:'View saved ideas',exact:true}).click();await page.getByRole('heading',{name:'A private saved direction',exact:true}).waitFor();
  await page.getByRole('button',{name:'Copy idea',exact:true}).click();assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes('What detail would you explore?'));assert.equal(documents.size,ideaCount,'Viewing/copying saved guidance never creates authored writing');
  await page.getByRole('searchbox',{name:'Search saved AI ideas',exact:true}).fill('unfindable');await page.getByRole('heading',{name:'Try another search.',exact:true}).waitFor();await page.getByRole('searchbox',{name:'Search saved AI ideas',exact:true}).fill('');
  await context.setOffline(true);await page.getByText('Offline · last loaded saved ideas',{exact:true}).waitFor();await context.setOffline(false);
  badIdeaOwner=true;await page.getByRole('button',{name:'Hide saved ideas',exact:true}).click();await page.getByRole('button',{name:'View saved ideas',exact:true}).click();await page.getByText('Saved ideas could not be loaded.',{exact:false}).waitFor();assert.equal(await page.getByRole('heading',{name:'B private saved direction',exact:true}).count(),0,'Mismatched-owner results are never displayed');badIdeaOwner=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('heading',{name:'A private saved direction',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifact,'saved-guidance-390.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});
  await page.getByRole('button',{name:'Hide saved ideas',exact:true}).click();
  const before=documents.size,useTitle=await cards.first().locator('h3').textContent();await cards.first().getByRole('button',{name:'Start a draft',exact:true}).click();await page.waitForURL(url=>url.pathname==='/editor'&&url.searchParams.has('document'));
  await page.waitForFunction(title=>document.querySelector('[aria-label="Rename document"]')?.value===title,useTitle);await page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('All changes saved'));
  assert.equal(documents.size,before+1);assert.equal((await page.getByRole('textbox',{name:'Document content',exact:true}).textContent()).trim(),'');assert.equal(initial.plain_text,'My own writing stays here.');
  assert.equal(requests.some(r=>r.key==='/workspace/assistant'||r.key==='/ai/suggestion'||r.key.includes('checkout')),false);assert.deepEqual(errors,[]);
  console.log('PASS Ideas: verified private route, shared daily prompt, existing themes, search/pagination/empty artwork, account-bound browser saves and refresh/tab sync, offline exploration, Free copying, Pro empty-draft handoff without lost writing, EN/ES themes and 320–1440px, no automatic workspace writes, paid AI or checkout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
