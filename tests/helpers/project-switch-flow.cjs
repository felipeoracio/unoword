const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chooseProject,projectValue,waitProject}=require('./project-picker.cjs');
const out=path.resolve('tests/artifacts/project-motion');
const percentile=(v,n)=>[...v].sort((a,b)=>a-b)[Math.floor((v.length-1)*n)];
module.exports=async({page,context,origin,documents,activity,requests,fixture,setSignedIn,setFailSave,setOffline,network,errors})=>{
 fs.mkdirSync(out,{recursive:true});setSignedIn(true);
 await context.addInitScript(()=>localStorage.setItem('uno-tour-launch-hidden:00000000-0000-4000-8000-000000000001','1'));
 const results=[],pass=name=>{results.push({name,result:'passed'});console.log('PASS '+name);};
 const until=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await page.waitForTimeout(50);}throw Error('Fixture persistence did not settle: '+label);};
 const state=()=>fixture('/workspace/projects','GET',null).state;
 const canvas=page.getByRole('textbox',{name:'Document content',exact:true});
 const saved=()=>page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('All changes saved'));
 const editable=()=>page.waitForFunction(()=>document.querySelector('.uw-writing-canvas')?.getAttribute('contenteditable')==='true');
 const settle=()=>page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
 const value=()=>projectValue(page);
 const editorJSON=()=>canvas.evaluate(el=>el.editor.getJSON());
 async function createProject(name,goal){
  await page.getByRole('button',{name:'Manage projects',exact:true}).click();
  const manager=page.locator('dialog[open] .uw-project-manager');
  await manager.getByRole('button',{name:'New Project',exact:true}).click();
  await manager.getByLabel('Project name',{exact:true}).fill(name);await manager.getByLabel('Daily words',{exact:true}).fill(String(goal));
  await manager.getByRole('button',{name:'Save project',exact:true}).click();
  await until(()=>state().projects.some(p=>p.name===name),'create '+name);
  await page.getByRole('button',{name:'Close projects',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.uw-project-controls > .uw-project-sync')?.textContent.includes('Projects synced'));
  return state().projects.find(p=>p.name===name);
 }
 async function newDoc(title,body,{afterCompletion=false}={}){
  const start=page.getByRole('button',{name:'Start New Document',exact:true});
  if(afterCompletion)await start.waitFor();
  if(await start.isVisible())await start.click();else await page.locator('#editor-library').getByRole('button',{name:'New document',exact:true}).click();
  await editable();await page.getByLabel('Rename document',{exact:true}).fill(title);await canvas.fill(body);await saved();
  await until(()=>[...documents.values()].some(d=>d.title===title),'save '+title);
  return [...documents.values()].find(d=>d.title===title);
 }
 async function switchTo(project,doc){
  await chooseProject(page,project.id);await editable();
  await page.waitForFunction(title=>document.querySelector('.uw-editor-title')?.value===title,doc.title);
  assert.deepEqual(await editorJSON(),documents.get(doc.id).content,'Ready project displays its saved document');
 }
 async function clearBodyCache(id){
  await page.evaluate(id=>new Promise((resolve,reject)=>{const r=indexedDB.open('uno-word-writing',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const tx=r.result.transaction('records','readwrite'),store=tx.objectStore('records'),q=store.getAll();q.onsuccess=()=>{for(const row of q.result)if(row.kind==='document'&&row.value.id===id)store.delete(row.key);};tx.oncomplete=()=>{r.result.close();resolve();};tx.onerror=()=>reject(tx.error);};}),id);
 }
 async function reload(){await page.reload();await waitProject(page,state().preferences.active_project_id||'');await editable();await saved();await canvas.evaluate(el=>{window.__projectView=el.editor.view;});}
 const gate=key=>{let release;network[key]=new Promise(resolve=>release=resolve);return()=>{network[key]=null;release();};};
 const noMoves=(before,from)=>{
  assert.deepEqual(state().associations,before,'Switch never moves documents or resources');
  assert.equal(requests.slice(from).some(r=>r.method!=='GET'&&r.key.includes('/resources/')),false,'No membership/permission mutation');
 };
 await page.goto(origin+'/editor');await waitProject(page,'');
 const a=await createProject('Motion Memoir',125),b=await createProject('Motion Novel',420);
 await chooseProject(page,a.id);const da=await newDoc('Memoir — non-sensitive sample','A clear memory begins with one small observation.');
 await chooseProject(page,b.id);const db=await newDoc('Novel — non-sensitive sample','A fictional path leads toward a quiet village.');
 await switchTo(a,da);await canvas.evaluate(el=>{window.__projectView=el.editor.view;});
 pass('Create two real test projects and distinct documents through editor controls');

 async function lab(){
  const cpuRate=Number(process.env.PROJECT_CPU_RATE||1),rows=[];
  // Long documents in both projects, typed through the normal editor path.
  await canvas.fill('Memoir sample. '+('A thoughtful writer keeps each remembered detail. '.repeat(900)));await saved();
  await switchTo(b,db);await canvas.fill('Novel sample. '+('A quiet traveller follows the path toward morning. '.repeat(900)));await saved();
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});await cdp.send('HeapProfiler.collectGarbage');
  const heap=async()=> (await cdp.send('Performance.getMetrics')).metrics.find(r=>r.name==='JSHeapUsedSize').value;
  const heapBefore=await heap();
  await page.evaluate(()=>{
   const mark=()=>{window.__choiceAt=performance.now();};
   document.addEventListener('change',e=>{if(e.target.getAttribute('aria-label')==='Active project')mark();},true);
   document.addEventListener('pointerdown',e=>{if(e.target.closest('[data-project-id]'))mark();},true);
  });
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1000});await page.keyboard.press('Escape');
   for(const [project,doc] of [[a,da],[b,db]]){
    await page.evaluate(({id,title})=>{
     window.__projectLab={frames:[],input:[],tasks:[],shifts:0,readyAt:0,running:true};
     let previous=performance.now();const tick=now=>{if(!window.__projectLab.running)return;window.__projectLab.frames.push(now-previous);previous=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
     window.__readyObserver=new MutationObserver(()=>{const picker=document.querySelector('[aria-label="Active project"]');if(!window.__projectLab.readyAt&&picker&&(picker.getAttribute('data-project-value')??picker.value)===id&&!picker.disabled&&document.querySelector('.uw-writing-canvas')?.getAttribute('contenteditable')==='true'&&document.querySelector('.uw-editor-title')?.value===title)window.__projectLab.readyAt=performance.now();});window.__readyObserver.observe(document.querySelector('.uw-editor'),{subtree:true,attributes:true,childList:true});
     window.__taskObserver=new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.entryType==='longtask')window.__projectLab.tasks.push(e.duration);else if(!e.hadRecentInput)window.__projectLab.shifts+=e.value;});window.__taskObserver.observe({entryTypes:['longtask','layout-shift']});
    },{id:project.id,title:doc.title});
    await switchTo(project,doc);
    const choiceToReadyMs=await page.evaluate(()=>window.__projectLab.readyAt-window.__choiceAt);assert.ok(choiceToReadyMs>0);
    await canvas.evaluate(el=>el.focus());await page.keyboard.press('ControlOrMeta+End');
    await canvas.evaluate(el=>{el.__projectInput=()=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__projectLab.input.push(performance.now()-start)));};el.addEventListener('input',el.__projectInput);});
    const text=' one two three four five ',before=await canvas.textContent();await page.keyboard.type(text,{delay:12});
    await page.waitForFunction(n=>window.__projectLab.input.length>=n,text.length);await settle();
    const samples=await canvas.evaluate(el=>{window.__projectLab.running=false;window.__taskObserver.disconnect();window.__readyObserver.disconnect();el.removeEventListener('input',el.__projectInput);return window.__projectLab;});
    assert.equal(await canvas.textContent(),before+text);await saved();assert.deepEqual(await editorJSON(),documents.get(doc.id).content);
    rows.push({width,project:project.name,choiceToReadyMs,inputToSecondFrameP95Ms:percentile(samples.input,.95),frameIntervalP95Ms:percentile(samples.frames,.95),frameSamples:samples.frames.length,longTasksMs:samples.tasks,layoutShiftExcludingRecentInput:samples.shifts});
   }
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const report={scope:'Actual production editor, two long non-sensitive documents, isolated APIs. Choice-event to ready includes persistence/rendering, excludes opening the picker. Input event to second rAF is not INP, rAF interval is not GPU FPS. Single matched trials, not physical devices or proof of leak absence.',cpuRate,heapBeforeBytes:heapBefore,heapAfterBytes:await heap(),rows};
  fs.writeFileSync(path.join(out,(process.env.PROJECT_BASELINE==='1'?'before':'after')+'-'+cpuRate+'x.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS project-switch lab with complete persisted documents. '+JSON.stringify(report));return;
 }
 if(process.env.PROJECT_LAB_ONLY==='1'){await lab();return;}

 // Immediate typing + pending save, with no fixed animation delay substituted for I/O.
 await page.getByRole('button',{name:'Resume Session',exact:true}).waitFor();
 if(await page.getByRole('button',{name:'Resume Session',exact:true}).isVisible())await page.getByRole('button',{name:'Resume Session',exact:true}).click();
 await until(()=>[...activity.values()].some(row=>row.document_id===da.id&&row.timer?.status==='active'),'active outgoing sample');
 const idsBefore=[...activity.keys()],associations=structuredClone(state().associations),callsBefore=requests.length;
 const outgoing=structuredClone([...activity.values()].find(row=>row.document_id===da.id&&row.timer?.status==='active'));assert.ok(outgoing);
 const releaseSave=gate('saveGate');await canvas.press('ControlOrMeta+End');const initial=await canvas.textContent(),addition=' one two three four five ';await page.keyboard.type(addition,{delay:10});
 await chooseProject(page,b.id,{wait:false});await until(()=>requests.some((r,i)=>i>=callsBefore&&r.method==='PUT'&&r.key.endsWith('/'+da.id)),'held save');
 assert.equal(await value(),a.id);assert.ok((await page.getByRole('combobox',{name:'Active project',exact:true}).innerText()).includes(a.name));assert.equal(await canvas.textContent(),initial+addition);
 assert.equal(await page.getByRole('combobox',{name:'Active project',exact:true}).isDisabled(),true);
 await page.waitForTimeout(700);assert.equal(await value(),a.id,'Still pending beyond animation duration');
 assert.equal(await canvas.getAttribute('contenteditable'),'false');
 assert.ok((await page.locator('.uw-project-controls > .uw-project-sync').innerText()).includes('Saving before opening Motion Novel'));
 releaseSave();await waitProject(page,b.id);await editable();await until(()=>documents.get(da.id).plain_text.includes(addition.trim()),'outgoing final characters');noMoves(associations,callsBefore);
 assert.deepEqual([...activity.keys()],idsBefore);assert.ok([...activity.values()].filter(x=>x.document_id===da.id).every(x=>x.timer.status!=='active'));
 assert.equal(activity.get(outgoing.id).typed_words,outgoing.typed_words+5,'Only the five legitimately typed words are added');
 await switchTo(a,da);assert.equal(await canvas.textContent(),initial+addition);
 pass('Immediate type/switch flushes final characters; slow save remains pending; current draft stays visible');

 // Existing rule: active outgoing session pauses; paused sessions never restart.
 if(await page.getByRole('button',{name:'Resume Session',exact:true}).isVisible())await page.getByRole('button',{name:'Resume Session',exact:true}).click();
 await until(()=>[...activity.values()].some(x=>x.document_id===da.id&&x.timer?.status==='active'),'active memoir session');
 const active=structuredClone([...activity.values()].find(x=>x.document_id===da.id&&x.timer?.status==='active')),activeIds=[...activity.keys()],activeStart=Date.now();
 await switchTo(b,db);assert.equal(activity.get(active.id).timer.status,'paused');assert.equal(activity.get(active.id).document_id,da.id);assert.deepEqual([...activity.keys()],activeIds);
 const activeDelta=activity.get(active.id).timer.active_ms-active.timer.active_ms;assert.ok(activeDelta>=0&&activeDelta<=Date.now()-activeStart+1500,'Switch accounts for actual elapsed time once');
 await switchTo(a,da);await page.getByRole('button',{name:'Resume Session',exact:true}).waitFor();const paused=structuredClone(activity.get(active.id));
 await switchTo(b,db);await switchTo(a,da);assert.equal(activity.get(active.id).timer.active_ms,paused.timer.active_ms);assert.equal(activity.get(active.id).typed_words,paused.typed_words);assert.equal(activity.get(active.id).timer.status,'paused');
 pass('Active/paused switches preserve session IDs, document attribution, counts and paused time');

 setFailSave(true);await canvas.press('ControlOrMeta+End');await page.keyboard.type(' Unsaved work is protected.');const pendingText=await canvas.textContent();await chooseProject(page,b.id,{wait:false});
 await page.getByRole('alert').filter({hasText:'Project was not switched'}).waitFor();assert.equal(await value(),a.id);assert.equal(await canvas.textContent(),pendingText);await editable();
 setFailSave(false);await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();await saved();await switchTo(b,db);
 pass('Failed autosave keeps the original project/body; retry persists it before switching');

 network.failSelection=true;await chooseProject(page,a.id,{wait:false});await page.getByRole('alert').filter({hasText:'Project was not switched'}).waitFor();assert.equal(await value(),b.id);await editable();assert.deepEqual(await editorJSON(),documents.get(db.id).content);
 network.failSelection=false;await switchTo(a,da);await page.waitForFunction(()=>document.querySelector('.uw-project-controls > .uw-project-sync')?.textContent.includes('Projects synced'));
 pass('Failed project metadata sync preserves the current document and retries the existing queue');

 // Cold target load: delete only this test account's clean cached body, not cloud data.
 await clearBodyCache(db.id);await reload();const beforeCold=await canvas.textContent(),coldCalls=requests.length,releaseRead=gate('readGate');
 await chooseProject(page,b.id,{wait:false});await until(()=>requests.slice(coldCalls).some(r=>r.method==='GET'&&r.key.endsWith('/'+db.id)),'cold target read');
 await page.waitForTimeout(700);assert.equal(await value(),a.id);assert.equal(await canvas.textContent(),beforeCold);assert.equal(requests.slice(coldCalls).some(r=>r.method==='PUT'&&r.key==='/workspace/projects/active'),false,'No preference commit before load');
 assert.ok((await page.locator('.uw-project-controls > .uw-project-sync').innerText()).includes('Opening Motion Novel'));
 await page.screenshot({path:path.join(out,'projects-pending-load.png')});
 await canvas.evaluate(el=>{window.__duringProjectFade=0;el.__fadeInput=()=>{if(el.closest('.uw-editor-paper').getAnimations().some(a=>a.playState==='running'))window.__duringProjectFade++;};el.addEventListener('beforeinput',el.__fadeInput,true);});
 releaseRead();await waitProject(page,b.id);await editable();
 assert.equal(await page.locator('.uw-editor-paper').evaluate(el=>el.getAnimations().find(a=>a.playState==='running')?.effect.getTiming().duration),360,'Built CSS token runs for 360ms, including minified seconds');
 // Focus the retained editable node and send real keyboard input immediately
 // after readiness so this interaction overlaps the ready reveal.
 await canvas.evaluate(el=>el.focus());await page.keyboard.press('ControlOrMeta+End');
 const incoming=await canvas.textContent();await page.keyboard.type(' Ready writing can continue.',{delay:12});await saved();assert.equal(await canvas.textContent(),incoming+' Ready writing can continue.');assert.ok(await page.evaluate(()=>window.__duringProjectFade)>0);assert.equal(await page.locator('.uw-editor-paper').evaluate(el=>el.getAnimations().length),0,'First real input settles the reveal before text mutation');await canvas.evaluate(el=>el.removeEventListener('beforeinput',el.__fadeInput,true));
 assert.equal(await canvas.evaluate(el=>el.editor.view===window.__projectView),true,'No new Tiptap view for project motion');
 pass('Slow cold load keeps the old label/body until ready; ready typing works during the fade');

 await switchTo(a,da);await clearBodyCache(db.id);await reload();network.failRead=true;const beforeFailure=structuredClone(state().preferences);
 await chooseProject(page,b.id,{wait:false});await page.getByRole('alert').filter({hasText:'Project was not switched'}).waitFor();assert.equal(await value(),a.id);assert.equal(state().preferences.active_project_id,beforeFailure.active_project_id);await editable();
 network.failRead=false;await switchTo(b,db);
 pass('Failed document load does not commit a new project; retry opens the intact target');

 await switchTo(a,da);await clearBodyCache(db.id);await reload();
 setOffline(true);await context.setOffline(true);const beforeUnavailable=await canvas.textContent();
 await chooseProject(page,b.id,{wait:false});await page.getByRole('alert').filter({hasText:'Project was not switched'}).waitFor();await editable();assert.equal(await value(),a.id);assert.equal(await canvas.textContent(),beforeUnavailable);
 setOffline(false);await context.setOffline(false);await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();await saved();await switchTo(b,db);
 pass('An uncached offline target cannot replace the current project or draft; online retry succeeds');

 // No broader context survives a project change implicitly; no AI auto-request.
 await page.getByRole('button',{name:'Writing assistant',exact:true}).click();
 await page.getByLabel('AI Context',{exact:true}).selectOption('all_projects');await switchTo(a,da);
 assert.equal(await page.getByLabel('AI Context',{exact:true}).inputValue(),'current_project');
 assert.equal(await page.getByLabel('Share this draft for this AI request.',{exact:true}).isChecked(),false);
 const contextRegion=page.getByRole('region',{name:'Context for this request',exact:true});await contextRegion.getByText('Motion Memoir',{exact:true}).waitFor();
 await page.getByLabel('Share this draft for this AI request.',{exact:true}).check();await page.getByRole('button',{name:'Generate',exact:true}).click();
 await until(()=>requests.some(r=>r.key==='/workspace/assistant'),'explicit AI request');const ai=requests.filter(r=>r.key==='/workspace/assistant').at(-1).body;
 assert.equal(ai.project_id,a.id);assert.equal(ai.context_scope,'current_project');assert.deepEqual(ai.selected_resources,[]);
 await switchTo(b,db);assert.equal(await page.getByLabel('AI Context',{exact:true}).inputValue(),'current_project');assert.equal(await page.getByLabel('Share this draft for this AI request.',{exact:true}).isChecked(),false);
 assert.equal(requests.filter(r=>r.key==='/workspace/assistant').length,1,'Only the explicit test request uses AI');
 assert.ok((await page.locator('.uw-project-current-progress').innerText()).includes('/ 420'));assert.equal(await page.locator('#editor-library .uw-editor-document').filter({hasText:da.title}).count(),0);
 await page.getByRole('button',{name:'Close assistant',exact:true}).click();
 pass('Switch defaults to Current Project, resets consent/results, updates goals/library, and sends only explicit scoped AI payload');

 setOffline(true);await context.setOffline(true);await switchTo(a,da);await canvas.press('ControlOrMeta+End');await page.keyboard.type(' An offline memoir thought.');
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.toLowerCase().includes('offline'));const offlineText=await canvas.textContent();await chooseProject(page,b.id);await editable();await chooseProject(page,a.id);await editable();assert.equal(await canvas.textContent(),offlineText);
 setOffline(false);await context.setOffline(false);await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();await saved();await page.waitForFunction(()=>document.querySelector('.uw-project-controls > .uw-project-sync')?.textContent.includes('Projects synced'));assert.deepEqual(await editorJSON(),documents.get(da.id).content);
 pass('Cached offline switching protects local edits and reconnect synchronizes documents/preferences');

 const rapidCalls=requests.length,releaseSelection=gate('selectionGate');await chooseProject(page,b.id,{wait:false});await until(()=>requests.slice(rapidCalls).some(r=>r.key==='/workspace/projects/active'&&r.method==='PUT'),'held metadata selection');
 await page.getByRole('combobox',{name:'Active project',exact:true}).click({force:true});await page.getByRole('listbox').waitFor({state:'hidden'});assert.equal(await page.locator('.uw-project-picker-popup:visible [role="option"]').count(),0,'Busy picker cannot accept another selection');releaseSelection();await waitProject(page,b.id);await editable();
 for(const target of [[a,da],[b,db],[a,da],[b,db]])await switchTo(...target);
 assert.equal(await value(),b.id);assert.equal(await canvas.evaluate(el=>el.editor.view===window.__projectView),true);noMoves(associations,callsBefore);
 pass('Rapid attempts are disabled while pending; successive committed switches are deterministic and never move documents');

 await canvas.fill('Novel sample. '+('A quiet traveller keeps writing with care. '.repeat(1000)));await saved();await switchTo(a,da);await canvas.fill('Memoir sample. '+('A patient writer remembers a calm morning. '.repeat(1000)));await saved();
 const axePath=process.env.AXE_SCRIPT;
 async function audit(){
  if(!axePath)return;
  if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:axePath});
  const violations=await page.evaluate(async()=> (await axe.run({include:[['.uw-studio'],['.uw-project-picker-popup']],exclude:[['[data-base-ui-focus-guard]']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
  assert.deepEqual(violations,[]);
 }
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:1000});await page.keyboard.press('Escape');
  if(width<1200&&await page.getByRole('button',{name:'Close side panel',exact:true}).isVisible())await page.getByRole('button',{name:'Close side panel',exact:true}).click({position:{x:5,y:5}});
  await switchTo(b,db);await switchTo(a,da);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const picker=page.getByRole('combobox',{name:'Active project',exact:true});await picker.focus();await page.keyboard.press('ArrowDown');await page.locator('.uw-project-picker-popup').getByRole('option',{name:b.name,exact:true}).waitFor();await settle();await audit();await page.keyboard.press('Escape');
  await page.getByRole('listbox').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement===document.querySelector('[aria-label="Active project"]'));
  if([1440,390].includes(width)){await page.locator('.uw-editor-paper-scroll').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,'projects-'+width+'.png')});}
 }
 pass('Long documents, 320–1440px layouts, picker keyboard navigation, focus return and axe WCAG checks');

 await page.setViewportSize({width:390,height:1000});
 await page.getByRole('button',{name:'Dark theme',exact:true}).click();
 await page.getByRole('combobox',{name:'Active project',exact:true}).tap();await settle();await audit();
 assert.equal(await page.locator('.uw-project-picker-popup').getAttribute('data-studio-theme'),'dark');
 assert.equal(await page.locator('.uw-project-picker-popup [role="option"][aria-selected="true"] > :first-child').first().evaluate(el=>getComputedStyle(el).color),await page.locator('.uw-project-picker-popup').evaluate(el=>getComputedStyle(el).color),'Focused portal text uses the studio dark foreground');
 assert.equal(await page.locator('.uw-project-picker-popup').getByRole('option',{name:a.name,exact:true}).getAttribute('aria-selected'),'true');
 await page.screenshot({path:path.join(out,'projects-mobile-dark-picker.png')});
 await page.locator('.uw-project-picker-popup').getByRole('option',{name:b.name,exact:true}).tap();await waitProject(page,b.id);await editable();assert.deepEqual(await editorJSON(),documents.get(db.id).content);
 await page.getByRole('button',{name:'Light theme',exact:true}).click();
 await page.getByLabel('Language',{exact:true}).selectOption('es');
 const spanishPicker=page.getByRole('combobox',{name:'Proyecto activo',exact:true});await spanishPicker.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Home');
 const targetIndex=await page.locator('.uw-project-picker-popup [role="option"]').evaluateAll((options,id)=>options.findIndex(option=>option.getAttribute('data-project-id')===id),a.id);assert.ok(targetIndex>=0);
 for(let index=0;index<targetIndex;index++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 try {await page.waitForFunction(id=>{const trigger=document.querySelector('[aria-label="Proyecto activo"]');return trigger?.getAttribute('data-project-value')===id&&!trigger.disabled;},a.id);}catch(error){console.log('Spanish selection diagnostic',await page.evaluate(()=>({picker:document.querySelector('[aria-label="Proyecto activo"]')?.outerHTML,options:[...document.querySelectorAll('.uw-project-picker-popup [role="option"]')].map(el=>({text:el.textContent,active:el.getAttribute('aria-selected'),highlighted:el.hasAttribute('data-highlighted')})),active:document.activeElement?.outerHTML.slice(0,200)})));throw error;}await editable();
 assert.equal(await page.getByLabel('Contexto de IA',{exact:true}).inputValue(),'current_project');assert.deepEqual(await editorJSON(),documents.get(da.id).content);
 await page.getByLabel('Idioma',{exact:true}).selectOption('en');
 pass('Mobile touch selection, dark portaled menu, active marker and Spanish keyboard selection');

 await page.emulateMedia({reducedMotion:'reduce'});await switchTo(b,db);assert.equal(await page.locator('.uw-editor-paper').evaluate(el=>el.getAnimations().length),0);
 await page.getByRole('combobox',{name:'Active project',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.uw-project-picker-popup')?.contains(document.activeElement));
 assert.equal(await page.locator('.uw-project-picker-popup').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await page.keyboard.press('Escape');await page.getByRole('listbox').waitFor({state:'hidden'});await page.emulateMedia({reducedMotion:'no-preference'});
 pass('Reduced-motion switching retains functionality without a document/picker animation');

 // Completed writing is never restored as the remembered unfinished document.
 if(await page.getByRole('button',{name:'End Session',exact:true}).isVisible())await page.getByRole('button',{name:'End Session',exact:true}).click();
 await page.getByRole('button',{name:'Mark Document as Complete',exact:true}).click();
 if(await page.getByRole('dialog',{name:'Mark Document as Complete',exact:true}).isVisible())await page.getByRole('button',{name:'Complete & End Session',exact:true}).click();
 await until(()=>documents.get(db.id).completion_status==='completed','completion');
 const unfinished=await newDoc('Novel — unfinished return','This unfinished scene is the place to return.',{afterCompletion:true});await switchTo(a,da);await switchTo(b,unfinished);assert.equal(documents.get(db.id).completion_status,'completed');
 const lastIds=[...activity.keys()],lastWords=[...activity.values()].reduce((n,a)=>n+a.typed_words,0);await reload();assert.equal(await value(),b.id);assert.equal(await page.getByLabel('Rename document',{exact:true}).inputValue(),unfinished.title);assert.deepEqual(await editorJSON(),documents.get(unfinished.id).content);assert.deepEqual([...activity.keys()],lastIds);assert.equal([...activity.values()].reduce((n,a)=>n+a.typed_words,0),lastWords);
 pass('Completed documents remain closed; reload restores the correct project, unfinished writing and session history');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'functional.json'),JSON.stringify({scope:'Actual production editor with synthetic test projects/documents, IndexedDB and isolated persistence/AI response APIs. No live provider, real account or physical device.',results,documents:documents.size,sessions:activity.size},null,2)+'\n');
 console.log('PASS Phase 3 actual-editor suite: '+results.length+' grouped scenarios.');
};
