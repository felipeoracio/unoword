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
  let signedIn=false,pro=true,offline=false,failSave=false,conflictNext=false,currentOwner=owner;
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
   else if(key==='/ai/profile'&&method==='GET')value=profile;
   else if(key==='/ai/profile'&&method==='PUT'){assert.equal(body.expected_user_id,currentOwner);Object.assign(profile,body);value=profile;}
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
  const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
  await page.goto(origin+'/editor');await page.getByRole('heading',{name:'Sign in to write'}).waitFor();
  assert.equal(await page.locator('[contenteditable=true]').count(),0,'Signed-out users cannot write');
  signedIn=true;await page.reload();await page.getByRole('button',{name:'Create a document',exact:true}).click();
  await page.getByRole('textbox',{name:'Rename document'}).fill('The practice of paying attention');
  const canvas=page.getByRole('textbox',{name:'Document content'});
  await canvas.fill('One small moment can become a meaningful story.');
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved')).catch(async error=>{console.error('Save state:',await page.locator('.uw-editor-save').textContent(),'Notices:',await page.locator('.uw-editor-notice').allTextContents(),'Recent calls:',requests.slice(-8), 'DBs:', await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('uno-word-writing',1);r.onsuccess=()=>{const q=r.result.transaction('records').objectStore('records').getAll();q.onsuccess=()=>resolve(q.result.map(e=>({key:e.key,updated:e.value.updated_at,mutation:e.value.mutation_id,title:e.value.title,text:e.value.plain_text})))}})));throw error;});
  let saved=[...documents.values()][0];assert.ok(saved.plain_text.includes('meaningful story'));
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
  await page.getByLabel('Document folder').selectOption(folders[0].id);
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
  await page.getByLabel('Share this draft and selected text for this AI request.').check();
  const before=await canvas.textContent();await generate.click();await page.locator('.uw-editor-ai-results article').nth(2).waitFor();
  assert.equal(await canvas.textContent(),before,'AI generation never overwrites writing');
  assert.equal(requests.filter(r=>r.key==='/workspace/assistant').length,1);
  await page.locator('.uw-editor-ai-results article button').first().click();
  assert.ok((await canvas.textContent()).includes('The quiet value of practice'));
  await canvas.click();await canvas.press('ControlOrMeta+a');
  await page.getByLabel('AI writing tool').selectOption('improve');await generate.click();
  await page.getByRole('button',{name:'Apply to selection',exact:true}).waitFor();
  await canvas.click();await canvas.press('ControlOrMeta+End');await canvas.pressSequentially(' A new thought.');
  const changedAfterSuggestion=await canvas.textContent();
  await page.getByRole('button',{name:'Apply to selection',exact:true}).click();
  assert.equal(await canvas.textContent(),changedAfterSuggestion,'A stale improvement never overwrites later edits');
  await canvas.click();await canvas.press('ControlOrMeta+a');await generate.click();
  await page.getByRole('button',{name:'Apply to selection',exact:true}).click();
  assert.ok((await canvas.textContent()).includes('A careful first step'));
  await page.getByRole('button',{name:'My Writing Profile',exact:true}).click();
  const profileDialog=page.getByRole('dialog');await profileDialog.getByLabel('What do you want to write?').fill('An edit that should be canceled');
  await profileDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'My Writing Profile',exact:true}).click();
  assert.equal(await profileDialog.getByLabel('What do you want to write?').inputValue(),'Essays about craft and community');
  await profileDialog.getByLabel('What do you want to write?').fill('Patient observation and practical craft');
  await profileDialog.getByRole('button',{name:'Save profile',exact:true}).click();assert.equal(profile.writing_goal,'Patient observation and practical craft');
  await page.getByRole('button',{name:'Writing knowledge',exact:true}).click();await page.getByLabel('Notes on building a garden').uncheck();
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
  offline=false;await context.setOffline(false);
  await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
  assert.ok([...documents.values()].some(d=>d.plain_text.includes('Written offline')));
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
  // Free retains editor + original prompt; personalized tools disappear.
  pro=false;await page.reload();await canvas.waitFor();await page.getByRole('button',{name:'Writing assistant',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Generate',exact:true}).count(),0);
  await page.getByRole('button',{name:'Another prompt',exact:true}).click();assert.ok(await canvas.isEditable());
  // A fresh device cache still opens private cloud metadata on demand.
  await page.evaluate(()=>new Promise(resolve=>{const open=indexedDB.open('uno-word-writing',1);open.onsuccess=()=>{const tx=open.result.transaction('records','readwrite');tx.objectStore('records').clear();tx.oncomplete=()=>{open.result.close();resolve();};};}));
  await page.reload();await canvas.waitFor();
  await page.waitForFunction(()=>document.querySelector('.uw-writing-canvas')?.textContent.includes('Offline draft from the'));
  // A different account never sees cached documents or recovery drafts.
  currentOwner=other;await page.evaluate(()=>window.postMessage({type:'UNO_WORD_ACCOUNT_CHANGED'},location.origin));
  await page.getByRole('heading',{name:'Sign in to write',exact:true}).waitFor();
  assert.equal(await page.locator('[contenteditable=true]').count(),0,'Extension account changes evict the previous account writing view');
  await page.reload();await page.getByRole('button',{name:'Create a document',exact:true}).waitFor();
  assert.equal(await page.locator('.uw-editor-document').count(),0);
  assert.equal(await page.locator('.uw-editor-recovery').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: production editor; auth isolation; autosave/reopen; formatting; typed/pasted counts; library/folders/trash; conflicts; consent and AI approval; profile and sources; import/export; focus/themes; 320/390/768/1440px EN/ES; offline reload/reconnect; Free/Pro.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
