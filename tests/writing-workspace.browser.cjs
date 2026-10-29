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
  let signedIn=false,pro=true,offline=false,failSave=false,failFolders=false,conflictNext=false,currentOwner=owner,aiUsed=0,aiPending=0;
  const documents=new Map(),activity=new Map(),folders=[];const requests=[],errors=[];
  const profile={id:'profile',user_id:owner,writing_goal:'Essays about craft and community',primary_topics:['craft','community'],favorite_subjects:['attention'],current_projects:[],avoid_topics:[],writing_style:'Reflective and clear',audience:'Curious readers',personal_context:'',ai_preferences:{prompt_themes:['ideas']}};
  const sources=[{id:'00000000-0000-4000-8000-000000000009',document_title:'Notes on building a garden',enabled:true,source_kind:'file'}];
  await context.route(origin+'/api/**',async route=>{
   if(offline)return route.abort('internetdisconnected');
   const req=route.request(),url=new URL(req.url()),key=url.pathname.replace('/api',''),method=req.method();
   const body=req.postData()?JSON.parse(req.postData()):null;requests.push({key,method,body});let status=200,value;
   if(!signedIn){status=401;value={detail:'Authentication required'};}
   else if(key==='/auth/me')value={id:currentOwner,email:currentOwner===owner?'writer@example.com':'other@example.com',plan:pro?'pro':'free',ai_access:pro};
   else if(key==='/auth/refresh')value={authenticated:true};
   else if(key==='/progress/streak')value={user_id:currentOwner,displayedStreak:pro?15:7,hasUnlimitedStreakAccess:pro,streakLimitReached:!pro,journeyContinues:!pro,timezone:'America/Chicago',asOf:new Date().toISOString()};
   else if(key==='/ai/profile'&&method==='GET')value=profile;
   else if(key==='/ai/usage/summary')value={version_id:'v2',version_name:'Coach',legacy_shared:false,timezone:'America/Chicago',daily_reset_at:new Date(Date.now()+86400000).toISOString(),monthly_reset_at:new Date(Date.now()+30*86400000).toISOString(),suggestions_monthly_limit:200,suggestions_monthly_used:aiUsed,suggestions_monthly_remaining:200-aiUsed,guidance_monthly_limit:30,guidance_monthly_used:0,guidance_monthly_remaining:30,warning_percent:80,user_id:currentOwner,date:new Date().toISOString().slice(0,10),daily_limit:100,used_today:aiUsed,pending_today:aiPending,remaining:Math.max(0,100-aiUsed-aiPending)};
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
    }else{value={...body,content:sorted(body.content),id,user_id:currentOwner,plain_text:plain(body.content),revision:(existing?.revision||0)+1,created_at:existing?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};delete value.expected_user_id;documents.set(id,structuredClone(value));}
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
   else if(key==='/workspace/activity'){assert.ok(Object.keys(body).every(k=>['id','document_id','expected_user_id','started_at','typed_words','pasted_words','duration_seconds','sequence','timer'].includes(k)),'Restored sessions strip database-only fields');const prev=activity.get(body.id);if(!prev||prev.sequence<body.sequence)activity.set(body.id,body);value=activity.get(body.id);}
   else if(key==='/workspace/sources')value=sources;
   else if(key==='/processing/run'){
    assert.equal(pro,true);Object.assign(sources[0],{processing_status:'ready',processing_phase:'complete',processing_progress:100});status=202;value={accepted:true};
   }
   else if(key.startsWith('/workspace/sources/')){Object.assign(sources[0],body);value=sources[0];}
   else if(key==='/workspace/assistant'){
    assert.equal(pro,true);assert.equal(body.consent,true);assert.equal(body.expected_user_id,currentOwner);
    aiUsed++;
    value={items:Array.from({length:body.action==='guidance'?1:3},(_,i)=>({title:['The quiet value of practice','How small gardens teach patience','What we learn by paying attention'][i],text:'Consider a detail grounded in your interests in craft and community. What could you explore next?'}))};
    for(const [index,item] of value.items.entries()){
     const p=body.writing_progress,remaining=Math.max(0,p.daily_goal-p.words_written_today),target=Math.min(2000,remaining);
     const sizes=[10,25,25,25].map(percent=>Math.floor(target*percent/100));sizes.push(target-sizes.reduce((a,b)=>a+b,0));
     item.id='task-'+requests.filter(r=>r.key==='/workspace/assistant').length+'-'+index;
     item.writing_task={...p,remaining_words:remaining,target_words:target,goal_reached:remaining===0,outline:target>=750?['Opening','Observation','Questions','Perspective','Conclusion'].map((title,i)=>({title,words:sizes[i]})):[]};
    }
   }else throw Error('Unexpected fixture endpoint '+method+' '+key);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  });
  const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
  await page.goto(origin+'/editor');await page.getByRole('heading',{name:'Sign in to write'}).waitFor();
  assert.equal(await page.locator('[contenteditable=true]').count(),0,'Signed-out users cannot write');
  signedIn=true;await page.reload();await page.getByRole('button',{name:'Start New Document',exact:true}).click();
  await page.getByRole('textbox',{name:'Rename document'}).fill('The practice of paying attention');
  const canvas=page.getByRole('textbox',{name:'Document content'});
  await canvas.fill('One small moment can become a meaningful story.');
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved')).catch(async error=>{console.error('Save state:',await page.locator('.uw-editor-save').textContent(),'Notices:',await page.locator('.uw-editor-notice').allTextContents(),'Recent calls:',requests.slice(-8), 'DBs:', await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('uno-word-writing',1);r.onsuccess=()=>{const q=r.result.transaction('records').objectStore('records').getAll();q.onsuccess=()=>resolve(q.result.map(e=>({key:e.key,updated:e.value.updated_at,mutation:e.value.mutation_id,title:e.value.title,text:e.value.plain_text})))}})));throw error;});
  let saved=[...documents.values()][0];assert.ok(saved.plain_text.includes('meaningful story'));
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
   await page.locator('.uw-editor-document').filter({hasText:'The practice of paying attention'}).click();
   await canvas.waitFor();assert.equal(await canvas.getAttribute('contenteditable'),'false');
   assert.equal(await page.getByRole('button',{name:'Mark as Draft',exact:true}).count(),1);
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
  await canvas.fill('');await page.waitForFunction(()=>document.querySelector('.uw-editor-stats').textContent.includes('0 Session words'));
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
  await page.getByRole('button',{name:'My Writing Profile',exact:true}).click();
  const profileDialog=page.getByRole('dialog');await profileDialog.getByLabel('What do you want to write?').fill('An edit that should be canceled');
  await profileDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'My Writing Profile',exact:true}).click();
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
  await page.locator('input[type=file]').setInputFiles({name:'Imported thoughts.md',mimeType:'text/markdown',buffer:Buffer.from('# A fresh start\n\n**Bold ideas** and careful words.\n<script>window.compromised=true</script>\n[unsafe](javascript:alert(1))')});
  await page.waitForFunction(()=>document.querySelector('.uw-editor-title').value==='Imported thoughts');
  assert.equal(await page.locator('.uw-writing-canvas h1').count(),1);assert.equal(await page.locator('.uw-writing-canvas strong').count(),1);
  assert.equal(await page.evaluate(()=>window.compromised),undefined);assert.equal(await page.locator('.uw-writing-canvas a[href^="javascript"]').count(),0);
  // Focus, light/dark, mobile/tablet, localization and basic accessibility.
  await page.getByRole('button',{name:'Enter focus mode',exact:true}).click();assert.equal(await page.locator('.uw-editor-library').count(),0);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.uw-editor-library').count(),1);
  async function accessibility(label){
   if(!process.env.AXE_SCRIPT)return;
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
  await secondCanvas.fill('Offline draft from the second tab.');
  await second.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));
  offline=false;await context.setOffline(false);
  const conflicted=await Promise.race([page,second].map(tab=>tab.locator('.uw-editor-conflict').waitFor({state:'visible'}).then(()=>tab)));
  const conflictedText=await conflicted.getByRole('textbox',{name:'Document content'}).textContent();
  assert.equal(await conflicted.evaluate(text=>new Promise(resolve=>{const open=indexedDB.open('uno-word-writing',1);open.onsuccess=()=>{const request=open.result.transaction('records').objectStore('records').getAll();request.onsuccess=()=>{resolve(request.result.some(record=>record.kind==='draft'&&record.value.dirty&&record.value.plain_text.trim()===text.trim()));open.result.close();};};}),conflictedText),true,'The losing tab retains a durable offline draft before conflict resolution');
  await conflicted.getByRole('button',{name:'Keep both copies',exact:true}).click();
  await conflicted.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
  assert.ok([...documents.values()].some(d=>d.plain_text.trim()==='Offline draft from the first tab.'));
  assert.ok([...documents.values()].some(d=>d.plain_text.trim()==='Offline draft from the second tab.'));
  await second.close();
  // Downgrade hides both editor and library without deleting local writing.
  pro=false;const downgradeCalls=requests.length;await page.reload();
  await page.getByRole('heading',{name:'Unlock Your Writing Space'}).waitFor();
  assert.equal(await page.locator('[contenteditable=true]').count(),0);
  assert.equal(await page.locator('.uw-editor-document').count(),0);
  assert.equal(requests.slice(downgradeCalls).some(r=>r.key.startsWith('/workspace/')),false,'Free must not fetch private workspace data');
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
