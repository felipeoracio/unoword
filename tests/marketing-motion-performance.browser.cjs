/** Matched production-bundle lab; single trials, not field Web Vitals or GPU FPS. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const fixture=require('./marketing-motion.browser.cjs');
(async()=>{
 const server=await require('./helpers/production-fixture-server.cjs').start({dist:process.env.MARKETING_LAB_DIST});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox']});
 const rows=[],cpu=Number(process.env.MARKETING_CPU_RATE||1);
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'no-preference'}),calls=[];
   await fixture.routes(context,server.origin,calls);
   await context.addInitScript(()=>{
    const lab=window.__lab={lcp:0,shifts:0,longTasks:[],frames:[],frameLast:0,frameActive:true};
    for(const [type,read] of [
     ['largest-contentful-paint',rows=>{lab.lcp=rows.at(-1)?.startTime||0;}],
     ['layout-shift',rows=>{for(const row of rows)if(!row.hadRecentInput)lab.shifts+=row.value;}],
     ['longtask',rows=>lab.longTasks.push(...rows.map(row=>row.duration))],
    ])if(PerformanceObserver.supportedEntryTypes.includes(type))new PerformanceObserver(list=>read(list.getEntries())).observe({type,buffered:true});
    const sample=now=>{if(!lab.frameActive)return;if(lab.frameLast)lab.frames.push(now-lab.frameLast);lab.frameLast=now;requestAnimationFrame(sample);};requestAnimationFrame(sample);
   });
   const page=await context.newPage(),cdp=await context.newCDPSession(page);
   await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});
   await page.goto(server.origin,{waitUntil:'networkidle',timeout:60000});await page.locator('.lp-hero-preview img').evaluate(img=>img.decode());
   await page.waitForFunction(()=>document.querySelector('.lp-site').getAnimations({subtree:true}).length===0);
   const initial=await page.evaluate(()=>({lcp:window.__lab.lcp,shifts:window.__lab.shifts,longTasks:[...window.__lab.longTasks],paint:performance.getEntriesByType('paint').map(e=>({name:e.name,ms:e.startTime})),transferredBytes:performance.getEntriesByType('resource').reduce((sum,row)=>sum+row.transferSize,0)}));
   await cdp.send('HeapProfiler.collectGarbage');const heapBefore=(await cdp.send('Runtime.getHeapUsage')).usedSize;
   await page.evaluate(()=>{window.__lab.frames=[];window.__lab.frameLast=0;window.__lab.longTasks=[];window.__lab.shifts=0;});
   for(let cycle=0;cycle<2;cycle++){
    for(const selector of ['.lp-feature-story:first-child','.lp-showcase','.lp-pricing','.lp-faq','.lp-final-cta','.lp-hero']){
     await page.locator(selector).scrollIntoViewIfNeeded();
     await page.waitForFunction(()=>document.querySelector('.lp-site').getAnimations({subtree:true}).length===0);
    }
   }
   await cdp.send('HeapProfiler.collectGarbage');const heapAfter=(await cdp.send('Runtime.getHeapUsage')).usedSize;
   const scroll=await page.evaluate(()=>{const lab=window.__lab;lab.frameActive=false;const frames=lab.frames.sort((a,b)=>a-b);return {frameIntervalP95Ms:frames[Math.floor(frames.length*.95)]||0,frameSamples:frames.length,longTasks:lab.longTasks,shifts:lab.shifts};});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.equal(calls.some(row=>row.method!=='GET'&&!row.endpoint.startsWith('/api/auth/')),false);
   rows.push({width,initial,scroll,heapBeforeBytes:heapBefore,heapAfterBytes:heapAfter});
   await context.close();
  }
  const report={scope:'Sequential local Chromium production trials; synthetic product API; cold cache, 150ms latency / 1.6Mbps download; no reduced motion. Initial LCP/FCP before scrolling. Two repeated scroll cycles. rAF intervals are not GPU FPS; snapshots do not prove leak absence. Not field metrics, live providers or physical devices.',cpuRate:cpu,rows};
  const out=path.resolve('tests/artifacts/marketing-motion');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,(process.env.MARKETING_LAB_LABEL||'after')+'-'+cpu+'x.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS marketing motion lab '+JSON.stringify(report));
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
