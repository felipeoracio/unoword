/** Same actual profile/chart workflows on approved and candidate production bundles. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const fixture=require('./supporting-motion.browser.cjs');
(async()=>{
 const server=await require('./helpers/production-fixture-server.cjs').start({dist:process.env.SUPPORT_LAB_DIST});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 const cpu=Number(process.env.SUPPORT_CPU_RATE||1),rows=[];
 try{
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:1100},reducedMotion:'no-preference'});
   const state=await fixture.fixture(context,server.origin);
   await context.addInitScript(()=>{
    localStorage.setItem('uno-writing-theme','light');localStorage.setItem('uno-writing-language','en');
    const lab=window.__lab={inputs:[],choices:[],frames:[],frameLast:0,active:true,longTasks:[],shifts:0,lcp:0};
    const sample=now=>{if(!lab.active)return;if(lab.frameLast)lab.frames.push(now-lab.frameLast);lab.frameLast=now;requestAnimationFrame(sample);};requestAnimationFrame(sample);
    document.addEventListener('beforeinput',event=>{if(event.target.tagName!=='TEXTAREA')return;const now=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>lab.inputs.push(performance.now()-now)));},true);
    for(const [type,read] of [['longtask',entries=>lab.longTasks.push(...entries.map(row=>row.duration))],['layout-shift',entries=>{for(const row of entries)if(!row.hadRecentInput)lab.shifts+=row.value;}],['largest-contentful-paint',entries=>{lab.lcp=entries.at(-1)?.startTime||0;}]])if(PerformanceObserver.supportedEntryTypes.includes(type))new PerformanceObserver(list=>read(list.getEntries())).observe({type,buffered:true});
    window.__watchChoice=(eventName,selector,text)=>{
     const start=()=>{const began=performance.now();const observer=new MutationObserver(()=>{if(document.querySelector(selector)?.textContent===text){lab.choices.push(performance.now()-began);observer.disconnect();}});observer.observe(document.querySelector('.uw-guided-profile'),{subtree:true,childList:true,characterData:true});};
     document.querySelector('.uw-guided-profile').addEventListener(eventName,start,{once:true,capture:true});
    };
   });
   const page=await context.newPage(),cdp=await context.newCDPSession(page);
   await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});
   await page.goto(server.origin+'/library?view=profile',{waitUntil:'networkidle'});await page.getByText('What do you enjoy writing?',{exact:true}).waitFor();
   const profileLoad=await page.evaluate(()=>({lcp:window.__lab.lcp,longTasks:[...window.__lab.longTasks],shifts:window.__lab.shifts,paint:performance.getEntriesByType('paint').map(row=>({name:row.name,ms:row.startTime}))}));
   await cdp.send('HeapProfiler.collectGarbage');const heapBefore=(await cdp.send('Runtime.getHeapUsage')).usedSize;
   await page.evaluate(()=>{window.__lab.frames=[];window.__lab.frameLast=0;window.__lab.longTasks=[];window.__lab.shifts=0;});
   const input=page.locator('.uw-guided-profile textarea').first();await input.evaluate(el=>window.__input=el);await input.pressSequentially('A calm and personal voice.',{delay:25});
   assert.equal(await input.inputValue(),'A calm and personal voice.');
   for(let i=0;i<4;i++){
    await page.evaluate(()=>window.__watchChoice('click','.uw-guided-profile legend','When do you like to write?'));await page.getByRole('button',{name:'Skip',exact:true}).click();
    await page.evaluate(()=>window.__watchChoice('click','.uw-guided-profile legend','What do you enjoy writing?'));await page.getByRole('button',{name:'Back',exact:true}).click();
   }
   assert.equal(await input.evaluate(el=>el===window.__input),true);assert.equal(await input.inputValue(),'A calm and personal voice.');
   await page.waitForFunction(()=>window.__lab.inputs.length===26);
   await cdp.send('HeapProfiler.collectGarbage');const heapAfter=(await cdp.send('Runtime.getHeapUsage')).usedSize;
   const profile=await page.evaluate(()=>{const lab=window.__lab;lab.active=false;const p95=items=>[...items].sort((a,b)=>a-b)[Math.floor(items.length*.95)]||0;return {inputSamples:lab.inputs.length,beforeInputToSecondFrameP95Ms:p95(lab.inputs),questionReadyP95Ms:p95(lab.choices),questionSamples:lab.choices.length,frameIntervalP95Ms:p95(lab.frames),frameSamples:lab.frames.length,longTasks:lab.longTasks,shifts:lab.shifts};});
   await page.goto(server.origin+'/progress',{waitUntil:'networkidle'});await page.getByRole('combobox',{name:'Chart measure',exact:true}).waitFor();
   const progressLoad=await page.evaluate(()=>({lcp:window.__lab.lcp,longTasks:[...window.__lab.longTasks],shifts:window.__lab.shifts,paint:performance.getEntriesByType('paint').map(row=>({name:row.name,ms:row.startTime}))}));
   await page.evaluate(()=>{window.__chartLatencies=[];document.addEventListener('change',event=>{if(event.target.tagName!=='SELECT'||!event.target.closest('.uw-progress-chart-heading'))return;const start=performance.now(),expected=event.target.value==='time'?'Active writing time over time':'Typed words over time';const observer=new MutationObserver(()=>{if(document.querySelector('.uw-progress-chart')?.getAttribute('aria-label')===expected){window.__chartLatencies.push(performance.now()-start);observer.disconnect();}});observer.observe(document.querySelector('.uw-progress-trend-card'),{subtree:true,attributes:true});},true);});
   for(let i=0;i<4;i++){await page.getByRole('combobox',{name:'Chart measure',exact:true}).selectOption('time');await page.getByRole('combobox',{name:'Chart measure',exact:true}).selectOption('words');}
   const chart=await page.evaluate(()=>({choices:window.__chartLatencies,p95Ms:[...window.__chartLatencies].sort((a,b)=>a-b)[Math.floor(window.__chartLatencies.length*.95)],dailyTime:document.querySelector('[data-testid="daily-writing-time"]').textContent,lifetimeTime:document.querySelector('[data-testid="lifetime-writing-time"]').textContent}));
   assert.equal(chart.dailyTime,'00:20:00');assert.equal(chart.lifetimeTime,'02:00:00');assert.equal(state.calls.some(row=>row.method!=='GET'&&!row.key.startsWith('/auth/')),false);
   rows.push({width,profileLoad,profile,progressLoad,chart,heapBeforeBytes:heapBefore,heapAfterBytes:heapAfter});await context.close();
  }
  const report={scope:'Sequential local production Chromium with isolated synthetic APIs, cold cache, 150ms latency / 1.6Mbps download. 26 actual profile input events and eight real question/chart choices. Input timing is capture-phase beforeinput to second rAF, not INP; frame intervals are not GPU FPS. No live providers/devices or leak-absence proof.',cpuRate:cpu,rows};
  const out=path.resolve('tests/artifacts/supporting-motion');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,(process.env.SUPPORT_LAB_LABEL||'after')+'-'+cpu+'x.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS supporting lab '+JSON.stringify(report));
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
