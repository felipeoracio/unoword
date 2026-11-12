/** Loaded MV3 in Chrome for Testing, real action popup, worker and content script.
 * Disposable guest profile; all remote DNS blocked. No mock chrome APIs. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
async function attachPopup(cdp,targetId){
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});let sequence=0;const pending=new Map();
 cdp.on('Target.receivedMessageFromTarget',event=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message);if(message.id&&pending.has(message.id)){const row=pending.get(message.id);clearTimeout(row.timer);pending.delete(message.id);message.error?row.reject(Error(message.error.message)):row.resolve(message.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Popup CDP timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});void cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 await send('Runtime.runIfWaitingForDebugger');
 // DOM activation avoids browser-UI popup resize races in CDP coordinates.
 // Content typing below still uses actual Playwright keyboard input.
 return {send,evaluate,click:selector=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled||el.hidden)throw Error('Control unavailable');el.scrollIntoView({block:'center'});el.click();})()`)};
}
(async()=>{
 const executable=process.env.EXTENSION_CHROME_EXECUTABLE;if(!executable)throw Error('Set EXTENSION_CHROME_EXECUTABLE to an extension-enabled Chrome for Testing binary');
 const extension=path.resolve(process.env.EXTENSION_ROOT||'extension'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'uno-mv3-')),out=path.resolve('tests/artifacts/cross-platform');fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><title>Local writing test</title><body><label>Test writing<textarea aria-label="Test writing" rows="8" cols="40"></textarea></label></body></html>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,viewport:{width:1024,height:768},args:['--no-sandbox','--disable-extensions-except='+extension,'--load-extension='+extension,'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});
 const results=[],pass=name=>{results.push({name,result:'passed'});console.log('PASS '+name);};
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{const {wc_settings={}}=await chrome.storage.local.get('wc_settings');await chrome.storage.local.set({wc_settings:{...wc_settings,langChosen:true,language:'en'}});});
  const page=context.pages()[0],cdp=await context.newCDPSession(page),version=await cdp.send('Browser.getVersion');
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
  async function popup(){const active=await worker.evaluate(async()=>!!(await chrome.storage.local.get('wc_state')).wc_state?.active);await worker.evaluate(()=>chrome.action.openPopup());let target;for(let i=0;i<20&&!target;i++){target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/popup/popup.html'));if(!target)await new Promise(r=>setTimeout(r,50));}assert.ok(target);const api=await attachPopup(cdp,target.targetId);let ready=false,info;for(let i=0;i<100&&!ready;i++){info=await api.evaluate(`({ready:!!document.querySelector('#primary-btn')&&document.querySelector('#session-panel')?.hidden===false&&document.querySelector('#pause-btn')?.hidden===${!active},first:document.querySelector('#firstlaunch-panel')?.hidden===false,text:document.body?.innerText.slice(0,250)})`);ready=info.ready;if(info.first)await api.click('[data-testid="first-lang-en"]');if(!ready)await new Promise(r=>setTimeout(r,50));}assert.ok(ready,JSON.stringify(info));return{...api,targetId:target.targetId};}
  let ui=await popup();const dimensions=await ui.evaluate(`({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,popup:chrome.extension.getViews({type:'popup'}).includes(window),constrained:document.documentElement.dataset.popupWindow})`);
  assert.equal(dimensions.popup,true);assert.equal(dimensions.constrained,'true');assert.ok(dimensions.width<=800&&dimensions.height<=600&&dimensions.scroll<=dimensions.width);
  fs.writeFileSync(path.join(out,'action-popup.png'),Buffer.from((await ui.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  pass('Actual Chrome action popup has native constrained dimensions and no horizontal overflow');
  await ui.click('#primary-btn');await page.waitForFunction(()=>document.querySelector('#wc-floating-host')?.shadowRoot?.querySelector('#num'));
  let current=await worker.evaluate(async()=>(await chrome.storage.local.get('wc_state')).wc_state);assert.equal(current.active,true);const started=current.startedAt;
  await cdp.send('Target.closeTarget',{targetId:ui.targetId});await page.bringToFront();
  const writing=page.getByRole('textbox',{name:'Test writing'});await writing.pressSequentially('One calm writing session ');
  await page.waitForFunction(()=>Number.parseInt(document.querySelector('#wc-floating-host')?.shadowRoot?.querySelector('#num')?.textContent)===4);
  current=await worker.evaluate(async()=>(await chrome.storage.local.get('wc_state')).wc_state);assert.equal(current.startedAt,started);assert.equal(current.typedWords,4);
  assert.ok(await page.locator('#wc-floating-host').evaluate(el=>getComputedStyle(el.shadowRoot.querySelector('#row')).transitionDuration.split(',').every(value=>value.trim()==='0.12s')));
  await page.screenshot({path:path.join(out,'live-counter.png')});
  pass('Closing native popup keeps the real background session; real content-script typing counts four words once');
  ui=await popup();await ui.click('#pause-btn');await page.waitForFunction(()=>document.querySelector('#wc-floating-host')?.shadowRoot?.querySelector('#card')?.dataset.paused==='true');
  current=await worker.evaluate(async()=>(await chrome.storage.local.get('wc_state')).wc_state);assert.equal(current.timer.status,'paused');
  await ui.click('#pause-btn');await page.waitForFunction(()=>document.querySelector('#wc-floating-host')?.shadowRoot?.querySelector('#card')?.dataset.paused==='false');current=await worker.evaluate(async()=>(await chrome.storage.local.get('wc_state')).wc_state);assert.equal(current.startedAt,started);
  await ui.click('#primary-btn');await page.waitForFunction(()=>!document.querySelector('#wc-floating-host')||document.querySelector('#wc-floating-host').shadowRoot.querySelector('#card').hidden);
  const storage=await worker.evaluate(()=>chrome.storage.local.get(['wc_state','wc_history']));assert.equal(storage.wc_state.active,false);assert.equal(storage.wc_history.filter(row=>row.startedAt===started).length,1);assert.equal(storage.wc_history.find(row=>row.startedAt===started).typedWords,4);
  pass('Pause/resume/end use existing worker state and preserve one session/history record');
  await ui.click('#primary-btn');await page.waitForFunction(()=>!!document.querySelector('#wc-floating-host'));
  await cdp.send('Target.closeTarget',{targetId:ui.targetId});
  await context.route('https://unoword.app/editor',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Isolated editor-origin suppression check</title><body><textarea aria-label="App-owned test writing"></textarea></body></html>'}));
  const appPage=await context.newPage();await appPage.goto('https://unoword.app/editor',{waitUntil:'networkidle'});
  await appPage.getByRole('textbox',{name:'App-owned test writing'}).pressSequentially('These words belong to the app ');
  assert.equal(await appPage.locator('#wc-floating-host').count(),0);
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('wc_state')).wc_state.typedWords),0);
  await appPage.close();await page.bringToFront();ui=await popup();await ui.click('#primary-btn');
  pass('Real content script suppresses counting/counter at the editor origin; isolated app-owned text is not double counted');
  await ui.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:'dark'}]});await ui.click('#settings-btn');
  assert.equal(await ui.evaluate('document.getAnimations().length'),0);
  await ui.click('#edit-language');await ui.click('#language-editor [data-lang="es"]');
  let spanish=false;
  for(let i=0;i<100&&!spanish;i++){
   spanish=await ui.evaluate(`document.documentElement.lang==='es'&&document.querySelector('#language-meta')?.textContent==='Español'`);
   if(!spanish)await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(spanish,true,'Actual language controls render Spanish before capture');
  assert.equal(await ui.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  fs.writeFileSync(path.join(out,'action-popup-dark-reduced-es.png'),Buffer.from((await ui.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  pass('Actual popup dark/reduced-motion/Spanish state remains usable with no running animations');
  const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));assert.deepEqual(manifest.permissions,['storage','activeTab','alarms']);
  fs.writeFileSync(path.join(out,'extension-runtime.json'),JSON.stringify({scope:'Actual loaded MV3 Chrome for Testing on Linux, native action popup, real service worker/storage/content script; disposable guest profile, remote DNS blocked. Editor-origin check uses a synthetic page, not the authenticated app. Not signed-in sync, Google Chrome end-user installation, Web Store publication or a physical device.',browser:version.product,extensionVersion:manifest.version,permissions:manifest.permissions,dimensions,results},null,2)+'\n');
 }finally{await context.close();await new Promise(r=>server.close(r));fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
