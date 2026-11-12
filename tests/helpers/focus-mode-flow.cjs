const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.resolve('tests/artifacts/focus');
const p=(values,f)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*f)];
module.exports=async({page,canvas,context,documents,activity,requests,errors,setOffline,setFailSave})=>{
 fs.mkdirSync(output,{recursive:true});
 const scenarios=[];
 await page.evaluate(()=>{window.__escapeEvents=[];window.addEventListener('keydown',e=>{if(e.key==='Escape')window.__escapeEvents.push({prevented:e.defaultPrevented,focus:!!document.querySelector('.uw-editor-focus'),target:e.target.tagName});});});
 const pass=name=>{scenarios.push({name,result:'passed'});console.log('PASS '+name);};
 const until=async(predicate,label)=>{for(let i=0;i<160;i++){if(predicate())return;await page.waitForTimeout(50);}throw Error('Persistence did not settle: '+label);};
 const focused=()=>page.locator('.uw-editor-focus');
 const settle=()=>page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
 const saved=()=>page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('All changes saved'));
 const doc=()=>[...documents.values()].find(d=>d.title=== 'Focus — long sample') || [...documents.values()][0];
 const editorText=()=>canvas.evaluate(el=>{const d=el.editor.view.state.doc;return d.textBetween(0,d.content.size,'\n');});
 const snapshot=()=>canvas.evaluate(el=>{
  const view=el.editor.view,scroll=el.closest('.uw-editor-paper-scroll'),paper=el.closest('.uw-editor-paper'),selection=getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  const box=range?.getBoundingClientRect();
  return {text:el.textContent,from:view.state.selection.from,to:view.state.selection.to,selected:selection?.toString(),scrollTop:scroll.scrollTop,
   paperWidth:paper.getBoundingClientRect().width,rangeTop:box?.top,rangeLines:range?.getClientRects().length};
 });
 async function toggle(){await page.getByRole('button',{name:await focused().count()?'Exit focus mode':'Enter focus mode',exact:true}).click();}
 async function selectVisible(){
  await canvas.evaluate(el=>{
   el.focus({preventScroll:true});
   const scroll=el.closest('.uw-editor-paper-scroll').getBoundingClientRect();
   const paragraphs=[...el.querySelectorAll('p')].filter(p=>p.textContent.length>=18);
   const target=paragraphs.find(p=>{const b=p.getBoundingClientRect();return b.top>=scroll.top+60&&b.bottom<scroll.bottom-30;})||paragraphs[0];
   const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT),node=walker.nextNode();
   const range=document.createRange();range.setStart(node,2);range.setEnd(node,Math.min(node.length,18));
   const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  await page.waitForFunction(()=>{const el=document.querySelector('.uw-writing-canvas');return el.editor.view.state.selection.to>el.editor.view.state.selection.from;});
 }
 async function preserveCycle(label){
  await selectVisible();const before=await snapshot();
  await canvas.evaluate(el=>{window.__focusDOM=el;window.__focusView=el.editor.view;window.__focusDoc=el.editor.view.state.doc;window.__focusFrames=[];window.__observeFocus=true;
   const tick=()=>{if(!window.__observeFocus)return;const r=getSelection()?.rangeCount?getSelection().getRangeAt(0).getBoundingClientRect():null;window.__focusFrames.push({top:r?.top,width:el.closest('.uw-editor-paper').getBoundingClientRect().width});requestAnimationFrame(tick);};requestAnimationFrame(tick);
  });
  const ids=[...activity.keys()],words=[...activity.values()].reduce((n,a)=>n+a.typed_words,0),content=JSON.stringify(doc().content);
  await toggle();await settle();
  const during=await snapshot();
  for(const key of ['from','to','selected','rangeLines','text'])assert.equal(during[key],before[key],label+' keeps '+key);
  assert.ok(Math.abs(during.rangeTop-before.rangeTop)<=1,label+' vertical selection position');
  assert.ok(Math.abs(during.paperWidth-before.paperWidth)<=1,label+' reading measure');
  assert.equal(await canvas.evaluate(el=>el===window.__focusDOM&&el.editor.view===window.__focusView&&el.editor.view.state.doc===window.__focusDoc),true,label+' no editor remount or document reset');
  await page.keyboard.press('Escape');await settle();
  try { await page.waitForFunction(()=>!document.querySelector('.uw-editor-focus'),{},{timeout:3000}); }
  catch(error){console.error('Focus exit diagnostic',await page.evaluate(()=>({events:window.__escapeEvents,active:document.activeElement?.outerHTML.slice(0,300),dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.getAttribute('aria-label')),buttons:[...document.querySelectorAll('button')].filter(b=>b.getAttribute('aria-label')?.includes('focus mode')).map(b=>b.outerHTML)})));throw error;}
  const after=await snapshot();
  for(const key of ['from','to','selected','rangeLines','text'])assert.equal(after[key],before[key],label+' exit keeps '+key);
  assert.ok(Math.abs(after.rangeTop-before.rangeTop)<=1,label+' exit vertical position');
  const frames=await page.evaluate(()=>{window.__observeFocus=false;return window.__focusFrames;});
  assert.ok(frames.every(f=>Math.abs(f.top-before.rangeTop)<=1),label+' no vertical jump during animation');
  assert.ok(frames.every(f=>Math.abs(f.width-before.paperWidth)<=1),label+' no reflow during animation');
  assert.deepEqual([...activity.keys()],ids,label+' no session creation');
  assert.equal([...activity.values()].reduce((n,a)=>n+a.typed_words,0),words,label+' no added tracked words');
  assert.equal(JSON.stringify(doc().content),content,label+' no content mutation');
  pass(label);
 }
 async function importLong(){
  const body=Array.from({length:360},(_,i)=>`Paragraph ${i+1}. A patient writer notices the morning light, keeps a steady rhythm, and lets each idea find its own words.`).join('\n\n');
  await page.getByTestId('document-import').setInputFiles({name:'Focus — long sample.txt',mimeType:'text/plain',buffer:Buffer.from(body)});
  await page.waitForFunction(()=>document.querySelector('.uw-editor-title')?.value==='Focus — long sample');await saved();
  assert.ok((await canvas.textContent()).includes('Paragraph 360.'));
 }
 async function lab(){
  await importLong();
  const cpuRate=Number(process.env.FOCUS_CPU_RATE||4);
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage');
  const heap=async()=> (await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value;
  const heapBefore=await heap();
  const rows=[];
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1000});
   await page.keyboard.press('Escape');
   for(const entering of [true,false]){
    await canvas.press('ControlOrMeta+End');
    await canvas.evaluate(el=>{window.__focusLab={input:[],frames:[],tasks:[],shifts:0,running:true};let previous=performance.now();
     const tick=now=>{if(!window.__focusLab.running)return;window.__focusLab.frames.push(now-previous);previous=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
     el.__labListener=()=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__focusLab.input.push(performance.now()-start)));};el.addEventListener('input',el.__labListener);
     window.__focusObservers=['longtask','layout-shift'].filter(type=>PerformanceObserver.supportedEntryTypes.includes(type)).map(type=>{const o=new PerformanceObserver(list=>{for(const e of list.getEntries())if(type==='longtask')window.__focusLab.tasks.push(e.duration);else if(!e.hadRecentInput)window.__focusLab.shifts+=e.value;});o.observe({type});return o;});
    });
    const before=await canvas.textContent(),text=' one two three four five ';
    await toggle();await canvas.focus();await page.keyboard.type(text,{delay:12});await settle();
    await page.waitForFunction(n=>window.__focusLab.input.length>=n,text.length);
    const sample=await canvas.evaluate(el=>{window.__focusLab.running=false;window.__focusObservers.forEach(o=>o.disconnect());el.removeEventListener('input',el.__labListener);return window.__focusLab;});
    assert.equal(await canvas.textContent(),before+text,'Lab keystrokes preserved');
    rows.push({width,direction:entering?'enter':'exit',inputSamples:sample.input.length,inputToSecondFrameP50Ms:p(sample.input,.5),inputToSecondFrameP95Ms:p(sample.input,.95),frameSamples:sample.frames.length,frameIntervalP95Ms:p(sample.frames,.95),longTasksMs:sample.tasks,layoutShiftExcludingRecentInput:sample.shifts});
   }
  }
  await saved();assert.equal(doc().plain_text.trim(),(await editorText()).trim());assert.deepEqual(doc().content,await canvas.evaluate(el=>el.editor.view.state.doc.toJSON()));assert.deepEqual(errors,[]);
  await cdp.send('HeapProfiler.collectGarbage');
  const report={scope:'Actual production Tiptap editor, non-sensitive imported test document, isolated API persistence. Local Chromium; 12ms per injected keystroke while entering/exiting Focus Mode. Input event to second rAF is not INP; frame interval is not GPU FPS. Short forced-GC heap observations do not prove absence of leaks. Not physical devices.',cpuRate,heapBeforeBytes:heapBefore,heapAfterBytes:await heap(),rows};
  fs.writeFileSync(path.join(output,process.env.FOCUS_BASELINE==='1'?'before-transitions.json':'after-transitions.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS focus typing/performance sample and full persisted draft. '+JSON.stringify(report));
 }
 if(process.env.FOCUS_LAB_ONLY==='1'){await lab();return;}

 // Short document; text selection, same Tiptap view/doc and frame-by-frame position.
 await preserveCycle('Short document selection, cursor, stable text/view and enter/exit');
 const activeBefore=[...activity.values()].find(a=>a.timer?.status==='active');
 await canvas.press('ControlOrMeta+End');
 await toggle();
 assert.equal(await page.locator('.uw-editor-paper').evaluate(el=>el.getAnimations().find(a=>a.playState==='running')?.effect.getTiming().duration),420,'Production CSS time units preserve the full Focus transition');
 await canvas.evaluate(el=>{window.__typedDuringFocus=0;el.__focusInput=()=>{if(document.getAnimations().some(a=>a.playState==='running'))window.__typedDuringFocus++;};el.addEventListener('input',el.__focusInput);});
 const textBefore=await canvas.textContent(),addition=' one two three four five ';
 // No locator focus call: the Focus button must leave typing in the editor.
 assert.equal(await canvas.evaluate(el=>el===document.activeElement),true);
 await page.keyboard.type(addition,{delay:12});await settle();
 assert.equal(await canvas.textContent(),textBefore+addition);
 assert.ok(await page.evaluate(()=>window.__typedDuringFocus)>0,'Typed during actual animation');
 await canvas.evaluate(el=>el.removeEventListener('input',el.__focusInput));
 await saved();assert.ok(doc().plain_text.endsWith(addition.trimEnd())||doc().plain_text.endsWith(addition));
 if(activeBefore){assert.equal(activity.get(activeBefore.id).timer.status,'active');assert.equal(activity.get(activeBefore.id).typed_words,activeBefore.typed_words+5);}
 await page.keyboard.press('Escape');await settle();
 pass('Typing during transition: all characters saved, five legitimate words, same active session');

 await importLong();
 await page.locator('.uw-editor-paper-scroll').evaluate(el=>el.scrollTop=el.scrollHeight/2);
 await preserveCycle('Long document at middle: selection/scroll stable throughout every frame');

 // Paused session identity/time are immutable under presentation and paused typing.
 const pause=page.getByRole('button',{name:'Pause Session',exact:true});
 if(await page.getByRole('button',{name:'Start Session',exact:true}).isVisible())await page.getByRole('button',{name:'Start Session',exact:true}).click();
 if(await page.getByRole('button',{name:'Resume Session',exact:true}).isVisible())await page.getByRole('button',{name:'Resume Session',exact:true}).click();
 await pause.click();await page.getByRole('button',{name:'Resume Session',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
 await until(()=>[...activity.values()].some(a=>a.document_id===doc().id&&a.timer?.status==='paused'),'paused session');
 const paused=[...activity.values()].find(a=>a.document_id===doc().id&&a.timer?.status==='paused');assert.ok(paused);
 const pausedIds=[...activity.keys()],pausedWords=paused.typed_words,pausedTime=paused.timer.active_ms;
 await preserveCycle('Paused session: enter/exit preserves content and selection');
 await canvas.press('ControlOrMeta+End');await toggle();await page.keyboard.type(' Paused words remain in my draft.',{delay:10});await saved();
 assert.deepEqual([...activity.keys()],pausedIds);assert.equal(activity.get(paused.id).typed_words,pausedWords);assert.equal(activity.get(paused.id).timer.active_ms,pausedTime);assert.equal(activity.get(paused.id).timer.status,'paused');
 await page.keyboard.press('Escape');await settle();
 pass('Paused typing saved without adding session words/time or restarting the session');

 await page.getByRole('button',{name:'Resume Session',exact:true}).click();
 await until(()=>activity.get(paused.id)?.timer?.status==='active','resumed session');
 const start=Date.now(),initialActive=activity.get(paused.id).timer.active_ms,requestStart=requests.length;
 await preserveCycle('Active session: Focus never pauses, ends or duplicates activity');
 assert.equal(activity.get(paused.id).timer.status,'active');
 assert.ok(requests.slice(requestStart).filter(r=>r.key==='/workspace/activity'&&r.method==='POST').every(r=>r.body.timer.status==='active'));
 await pause.click();await saved();
 await until(()=>activity.get(paused.id)?.timer?.status==='paused','active-time checkpoint');
 const elapsed=Date.now()-start,delta=activity.get(paused.id).timer.active_ms-initialActive;
 assert.ok(delta>=Math.max(0,elapsed-2000)&&delta<=elapsed+1000,'Active time follows elapsed wall time, not animation count');
 pass('Active time stays within wall-clock tolerance; no duplicate or misattributed sessions');

 // Both sidebars restore their previous states, with no assistant requests.
 await page.setViewportSize({width:1440,height:1000});
 if(await page.getByRole('button',{name:'Open library',exact:true}).getAttribute('aria-expanded')!=='true')await page.getByRole('button',{name:'Open library',exact:true}).click();
 await page.getByRole('button',{name:'Writing assistant',exact:true}).click();
 await toggle();await settle();assert.equal(await page.locator('#editor-library').getAttribute('inert'),'');assert.equal(await page.locator('#editor-assistant').getAttribute('inert'),'');
 await page.keyboard.press('Escape');await settle();
 assert.equal(await page.getByRole('button',{name:'Open library',exact:true}).getAttribute('aria-expanded'),'true');assert.equal(await page.getByRole('button',{name:'Writing assistant',exact:true}).getAttribute('aria-expanded'),'true');
 await page.getByRole('button',{name:'Close assistant',exact:true}).click();
 pass('Sidebars fade and become inert; original open state restored without AI requests');

 const axePath=process.env.AXE_SCRIPT;
 async function audit(){if(!axePath)return;if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:axePath});const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('.uw-studio'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);}
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:1000});
  await page.keyboard.press('Escape');await settle();
  await page.locator('.uw-editor-paper-scroll').evaluate(el=>el.scrollTop=el.scrollHeight/2);
  await preserveCycle('Responsive selection/position '+width+'px');
  const trigger=page.getByRole('button',{name:'Enter focus mode',exact:true});await trigger.focus();await page.keyboard.press('Enter');await settle();
  assert.equal(await canvas.evaluate(el=>el===document.activeElement),true,'Keyboard activation returns to the same caret');
  assert.equal(await page.getByRole('button',{name:'Exit focus mode',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.uw-editor-save').isVisible(),true);assert.equal(await page.locator('.uw-editor-session-controls').isVisible(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await audit();
  if([1440,390].includes(width))await page.screenshot({path:path.join(output,'focus-'+width+'.png')});
  await page.keyboard.press('Escape');await settle();
 }
 pass('Keyboard Enter/Escape, persistent save/session controls and WCAG checks at five widths');

 await page.setViewportSize({width:390,height:1000});await canvas.focus();
 await page.getByRole('button',{name:'Enter focus mode',exact:true}).tap();await settle();
 assert.equal(await canvas.evaluate(el=>el===document.activeElement),true,'Touch activation leaves editing focus intact');
 await canvas.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,isComposing:true})));
 assert.equal(await focused().count(),1,'IME Escape does not exit Focus');
 await page.getByRole('button',{name:'Exit focus mode',exact:true}).tap();await settle();
 await page.getByRole('button',{name:'Dark theme',exact:true}).click();await preserveCycle('Dark theme selection and position');await toggle();await settle();await audit();
 await page.screenshot({path:path.join(output,'focus-mobile-dark.png')});await page.keyboard.press('Escape');await settle();await page.getByRole('button',{name:'Light theme',exact:true}).click();
 await page.getByLabel('Language',{exact:true}).selectOption('es');await page.getByRole('button',{name:'Activar modo concentración',exact:true}).click();await settle();
 await page.getByRole('button',{name:'Salir del modo concentración',exact:true}).waitFor();await page.keyboard.press('Escape');await settle();await page.getByLabel('Idioma',{exact:true}).selectOption('en');
 pass('Touch activation, IME Escape, dark mode and Spanish focus controls');

 await page.emulateMedia({reducedMotion:'reduce'});await preserveCycle('Reduced motion: selection, content, session and scroll preserved');
 await toggle();assert.equal(await page.locator('.uw-editor-toolbar').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 assert.equal(await page.locator('.uw-editor-paper').evaluate(el=>el.getAnimations().length),0);
 await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'no-preference'});
 await toggle();await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.uw-editor-paper').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length),0);await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'no-preference'});
 pass('Reduced motion at activation and preference change during transition');

 await canvas.press('ControlOrMeta+End');await toggle();await page.locator('.uw-editor-paper-scroll').evaluate(el=>el.scrollTop-=80);
 const chosenScroll=await page.locator('.uw-editor-paper-scroll').evaluate(el=>el.scrollTop);await settle();assert.equal(await page.locator('.uw-editor-paper-scroll').evaluate(el=>el.scrollTop),chosenScroll,'Completion never restores stale scroll');
 await toggle();await toggle();await toggle();await settle();await page.keyboard.press('Escape');await settle();
 pass('Intentional scrolling and rapid reversals remain under writer control');

 setFailSave(true);await canvas.press('ControlOrMeta+End');await page.keyboard.type(' Save retry keeps this sentence.');await toggle();await settle();
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent!=='All changes saved');
 assert.ok(!(await page.locator('.uw-editor-save').innerText()).includes('All changes saved'));
 setFailSave(false);await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();await saved();await page.keyboard.press('Escape');await settle();
 pass('Failed save never shown as saved; retry persists the intact draft');

 setOffline(true);await context.setOffline(true);await canvas.press('ControlOrMeta+End');await page.keyboard.type(' An offline thought stays safe.');await toggle();await settle();
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.toLowerCase().includes('offline'));
 await page.keyboard.press('Escape');await settle();setOffline(false);await context.setOffline(false);await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();await saved();
 const finalText=await canvas.textContent();assert.equal(doc().plain_text.trim(),(await editorText()).trim());assert.deepEqual(doc().content,await canvas.evaluate(el=>el.editor.view.state.doc.toJSON()));
 const finalIds=[...activity.keys()],finalWords=[...activity.values()].reduce((n,a)=>n+a.typed_words,0);
 await page.reload();await canvas.waitFor();await saved();assert.equal(await canvas.textContent(),finalText);
 assert.deepEqual([...activity.keys()],finalIds);assert.equal([...activity.values()].reduce((n,a)=>n+a.typed_words,0),finalWords);
 assert.equal(requests.filter(r=>r.key==='/workspace/assistant').length,0);assert.deepEqual(errors,[]);
 pass('Offline local save, reconnect, full reload/persistence, unchanged sessions and no AI calls');
 const report={scope:'Actual production Tiptap editor; non-sensitive short/long documents, real browser typing/selection/scroll and IndexedDB, isolated API persistence/session endpoints. Not a live Supabase/provider or physical-device test.',scenarios,documentCharacters:finalText.length,sessionIds:finalIds,trackedWords:finalWords};
 fs.writeFileSync(path.join(output,'functional.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS Phase 2 actual-editor functional suite: '+scenarios.length+' scenarios.');
};
