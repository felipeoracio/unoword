/** Actual popup, content script and worker; Chrome/storage/HTTP boundaries are fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({context,page,pages,message,local,storage,errors})=>{
 const output=process.env.STUDIO_EXTENSION_SCREENSHOTS||path.resolve('tests/artifacts/phase7');fs.mkdirSync(output,{recursive:true});
 const wait=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Extension fixture did not settle');};
 async function audit(target,label,scope){
  if(!process.env.AXE_SCRIPT)return;
  await target.addScriptTag({path:process.env.AXE_SCRIPT});
  const violations=await target.evaluate(async selector=>{
   const result=await axe.run(selector?document.querySelector(selector):document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
   return result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
  },scope);assert.deepEqual(violations,[],label);
 }
 await page.setViewportSize({width:420,height:600});await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>{document.documentElement.dataset.popupWindow='true';});
 const controls=async label=>{
  await page.evaluate(()=>scrollTo(0,0));
  const bounds=await page.locator('#primary-btn').boundingBox();assert.ok(bounds&&bounds.y>=0&&bounds.y+bounds.height<=600,label+' primary session control stays in initial 600px');
  assert.equal(await page.evaluate(()=>document.documentElement.getBoundingClientRect().width),420,'Native intrinsic width contract');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=420),'Native width has no horizontal overflow');
 };
 await controls('Idle');await page.click('#primary-btn');await page.locator('#pause-btn').waitFor({state:'visible'});
 await controls('Active');const identity=(await message({type:'GET_STATE'})).payload.startedAt;
 const editor=await context.newPage();pages.add(editor);editor.on('pageerror',e=>errors.push(e.message));
 await editor.goto('http://progress.test/editor');
 const draft=editor.getByRole('textbox',{name:'Draft',exact:true});await draft.pressSequentially('one two three');
 await wait(async()=>(await message({type:'GET_STATE'})).payload.typedWords===3);
 const host=editor.locator('#wc-floating-host'),row=host.locator('#row'),card=host.locator('#card');await row.waitFor();
 assert.equal(await draft.evaluate(el=>el===document.activeElement),true,'Counter mounting never steals editor focus');
 const initialStyle=await draft.evaluate(el=>({font:getComputedStyle(el).font,color:getComputedStyle(el).color}));
 await editor.addStyleTag({content:'button{font-size:99px!important;background:magenta!important}'});
 assert.ok(await row.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)<20),'Host CSS cannot enter counter shadow root');
 assert.deepEqual(await draft.evaluate(el=>({font:getComputedStyle(el).font,color:getComputedStyle(el).color})),initialStyle,'Counter leaves host editor styles intact');
 assert.equal(await card.getAttribute('role'),'group');assert.ok((await row.getAttribute('aria-label')).includes('Session: 3 / 250 words'));
 await row.focus();await editor.keyboard.press('Enter');assert.equal(await row.getAttribute('aria-expanded'),'true');
 await audit(editor,'Expanded light counter','#wc-floating-host');
 const end=host.getByRole('button',{name:'End Session',exact:true});await end.waitFor();await end.focus();await editor.keyboard.press('Escape');
 assert.equal(await row.getAttribute('aria-expanded'),'false');assert.equal(await row.evaluate(el=>el.getRootNode().activeElement===el),true,'Escape restores toggle focus');
 await editor.keyboard.press('Space');assert.equal(await row.getAttribute('aria-expanded'),'true');await editor.keyboard.press('Escape');
 assert.equal((await message({type:'GET_STATE'})).payload.typedWords,3,'Counter interaction never counts words');
 await page.click('#pause-btn');await page.locator('#session-paused').waitFor({state:'visible'});await controls('Paused');
 await wait(async()=>await card.getAttribute('data-paused')==='true');
 await draft.pressSequentially(' paused input');assert.equal((await message({type:'GET_STATE'})).payload.typedWords,3);
 await page.close();pages.delete(page);
 page=await context.newPage();pages.add(page);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://progress.test/popup/popup.html');
 await page.locator('#session-paused').waitFor({state:'visible'});assert.equal((await message({type:'GET_STATE'})).payload.startedAt,identity,'Popup recreation retains the same background session');
 await page.click('#pause-btn');await draft.pressSequentially(' resumed words');await wait(async()=>(await message({type:'GET_STATE'})).payload.typedWords===5);
 await page.close();pages.delete(page);await draft.pressSequentially(' background');await wait(async()=>(await message({type:'GET_STATE'})).payload.typedWords===6);
 const workerWords=(await message({type:'GET_STATE'})).payload.typedWords;
 // Actual approved-domain bridge code must suppress ordinary counter/delta capture.
 await context.route('https://unoword.app/editor',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>UnoWord editor fixture</title><textarea aria-label="Web writing"></textarea>'}));
 const web=await context.newPage();pages.add(web);web.on('pageerror',e=>errors.push(e.message));await web.goto('https://unoword.app/editor');await web.addScriptTag({path:path.resolve(__dirname,'../../shared/wordcount.js')});await web.addScriptTag({path:path.resolve(__dirname,'../../content.js')});
 await web.getByRole('textbox',{name:'Web writing',exact:true}).pressSequentially('The web editor records its own activity.');
 assert.equal(await web.locator('#wc-floating-host').count(),0);assert.equal((await message({type:'GET_STATE'})).payload.typedWords,workerWords,'Web editor input never counts twice');await web.close();pages.delete(web);
 await local.set({wc_settings:{...storage.wc_settings,language:'es'}});
 await wait(async()=>(await row.getAttribute('aria-label')).includes('Sesión:')).catch(async error=>{console.error('Counter locale:',{label:await row.getAttribute('aria-label'),language:await card.getAttribute('lang'),settings:storage.wc_settings.language,errors});throw error;});
 assert.equal(await host.locator('#label').textContent(),'palabras');
 await row.click();await host.getByRole('button',{name:'Finalizar sesión',exact:true}).waitFor();
 await editor.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await audit(editor,'Expanded Spanish dark counter','#wc-floating-host');
 await card.screenshot({path:path.join(output,'counter-es-dark.png')});
 // Dragging retains the existing coordinate storage path, and resize clamps it.
 await editor.keyboard.press('Escape');const before=await card.boundingBox();
 await editor.mouse.move(before.x+12,before.y+12);await editor.mouse.down();await editor.mouse.move(60,80,{steps:8});await editor.mouse.up();
 await wait(()=>!!storage.wc_settings.counterPos);await editor.setViewportSize({width:240,height:180});
 const moved=await card.boundingBox();assert.ok(moved.x>=0&&moved.y>=0&&moved.x+moved.width<=240&&moved.y+moved.height<=180,'Counter stays inside resized viewport');
 await row.focus();await editor.keyboard.press('Enter');await host.getByRole('button',{name:'Finalizar sesión',exact:true}).focus();await editor.keyboard.press('Enter');
 await host.waitFor({state:'detached'});assert.equal((await message({type:'GET_STATE'})).payload.active,false,'End activates once from its native button');
 assert.equal(storage.wc_history.filter(s=>s.startedAt===identity).length,1,'Ending through counter saves one session');
 page=await context.newPage();pages.add(page);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://progress.test/popup/popup.html');
 await page.locator('#primary-btn').waitFor();
 for(const scheme of ['light','dark']){
  await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
  for(const lang of ['en','es']){
   await page.evaluate(lang=>{settings.language=lang;WCi18n.setLang(lang);WCi18n.applyI18n(document);renderSession();},lang);
   for(const width of [180,194,320,360,420]){
    await page.setViewportSize({width,height:600});
    await page.evaluate(()=>{delete document.documentElement.dataset.popupWindow;});
    for(const [nav,panel] of [['#nav-write','#session-panel'],['#nav-ideas','#prompt-panel'],['#nav-progress','#progress-panel']]){
     await page.click(nav);await page.locator(panel).waitFor({state:'visible'});
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${scheme} ${lang} ${width} reflows`);
    }
   }
   await page.setViewportSize({width:420,height:600});await page.click('#nav-write');await page.locator('#session-panel').waitFor({state:'visible'});
   await audit(page,`Popup Write ${scheme} ${lang}`);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,`write-${scheme}-${lang}-420.png`),fullPage:true});
   await page.click('#nav-ideas');await page.locator('#prompt-panel').waitFor({state:'visible'});await audit(page,`Popup Ideas ${scheme} ${lang}`);
   await page.click('#nav-progress');await page.locator('#progress-panel').waitFor({state:'visible'});await audit(page,`Popup Progress ${scheme} ${lang}`);
   await page.click('#settings-btn');await page.locator('#settings-panel').waitFor({state:'visible'});await audit(page,`Popup Settings ${scheme} ${lang}`);
  }
 }
 await page.click('#settings-back');await page.locator('#nav-write').focus();await page.keyboard.press('End');await page.locator('#library-panel').waitFor({state:'visible'});
 assert.equal(await page.locator('#nav-library').getAttribute('tabindex'),'0');assert.equal(await page.locator('#nav-write').getAttribute('tabindex'),'-1');
 await page.keyboard.press('Home');await page.locator('#session-panel').waitFor({state:'visible'});assert.equal(await page.locator('#nav-write').getAttribute('aria-selected'),'true');
 await page.click('#nav-progress');await page.locator('#progress-panel').waitFor({state:'visible'});
 const ranges=page.locator('.wc__range-tab');await ranges.first().focus();await page.keyboard.press('End');
 await wait(async()=>await ranges.last().getAttribute('aria-selected')==='true');assert.equal(await ranges.last().getAttribute('tabindex'),'0');
 await page.keyboard.press('Home');await wait(async()=>await ranges.first().getAttribute('aria-selected')==='true');
 await page.locator('#prog-chart [role="listitem"] .wc__sr-only').first().waitFor({state:'attached'});
 assert.match(await page.locator('#prog-chart [role="listitem"] .wc__sr-only').first().textContent(),/\d.*(words|palabras)/,'Chart exposes values as text');
 await page.click('#nav-library');await page.locator('#library-panel').waitFor({state:'visible'});
 const filters=page.locator('[data-library-filter]');await filters.first().focus();await page.keyboard.press('End');
 await wait(async()=>await filters.last().getAttribute('aria-selected')==='true');assert.equal(await filters.last().getAttribute('tabindex'),'0');
 await page.keyboard.press('Home');await wait(async()=>await filters.first().getAttribute('aria-selected')==='true');
 assert.deepEqual(errors,[]);console.log('PASS Phase 7 fixture: 420x600 intrinsic contract and reachable session controls; 180–420px EN/ES light/dark; actual worker/content scripts; pause/recreate/close preserves session and counting; counter keyboard/stop/drag/resize/localization/host isolation; web-editor input suppressed; targeted axe and roving navigation. Native Chrome action loading remains separately blocked by managed policy.');
};
