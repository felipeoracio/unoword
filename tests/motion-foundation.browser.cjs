/** Real shared controls in a preview build. No account, AI or billing APIs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || './node_modules/playwright');
const output = path.resolve('tests/artifacts/motion');
const percentile = (values, fraction) => [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*fraction)];

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = process.env.MOTION_TEST_ORIGIN ? null : await require('./helpers/production-fixture-server.cjs').start();
  const origin = process.env.MOTION_TEST_ORIGIN || server.origin;
  const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE, args:['--no-sandbox'] });
  const errors=[], apiCalls=[];
  const httpsOptions={ignoreHTTPSErrors:process.env.MOTION_TEST_IGNORE_HTTPS_ERRORS==='1'};
  try {
    const context = await browser.newContext({ ...httpsOptions, viewport:{width:1440,height:1000}, reducedMotion:'no-preference',
      recordVideo:process.env.MOTION_RECORD_VIDEO==='1' ? {dir:path.join(output,'video'),size:{width:1440,height:1000}} : undefined });
    context.setDefaultTimeout(10000);
    await context.route('**/api/**', route=>{apiCalls.push(route.request().url());return route.fulfill({status:503,json:{detail:'No API expected in this component review'}});});
    const page = await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/motion-preview');
    await page.getByRole('heading',{name:'A quieter kind of motion.'}).waitFor();
    const axePath=process.env.AXE_SCRIPT || require.resolve('axe-core/axe.min.js');
    async function audit(label) {
      if(!await page.evaluate(()=>!!window.axe)) await page.addScriptTag({path:axePath});
      // Base UI's empty, aria-hidden keyboard sentinels are intentional focus
      // guards. Exclude only these library-owned nodes, never real controls.
      const violations=await page.evaluate(async()=> (await axe.run({exclude:[['[data-base-ui-focus-guard]']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
      assert.deepEqual(violations,[],label);
    }
    const settle = selector => page.locator(selector).evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
    const gone = async selector => {
      // Base UI Select intentionally retains a hidden item registry after close.
      try { await page.waitForFunction(s=>[...document.querySelectorAll(s)].every(el=>el.getClientRects().length===0),selector,{timeout:5000}); }
      catch(error) {
        console.error('Unclosed control:',await page.locator(selector).evaluateAll(nodes=>nodes.map(el=>({html:el.outerHTML.slice(0,1800),style:{opacity:getComputedStyle(el).opacity,transition:getComputedStyle(el).transition},animations:el.getAnimations().map(a=>({state:a.playState,currentTime:a.currentTime}))}))));
        throw error;
      }
    };
    const feedback=page.getByRole('button',{name:'Try feedback',exact:true});
    await feedback.focus();await page.keyboard.press('Space');
    await page.getByText('Actions: 1',{exact:true}).waitFor();
    await page.keyboard.press('Enter');
    await page.getByText('Actions: 2',{exact:true}).waitFor();
    const controlStyle=await feedback.evaluate(el=>({duration:getComputedStyle(el).transitionDuration,properties:getComputedStyle(el).transitionProperty}));
    assert.equal(controlStyle.duration,'0.12s');assert.ok(!controlStyle.properties.split(', ').includes('all'));
    await page.getByRole('button',{name:'Unavailable action',exact:true}).evaluate(el=>el.click());
    assert.equal(await page.getByRole('status').textContent(),'Actions: 2');
    await audit('Page');
    console.log('PASS control feedback and base accessibility.');

    const menu=page.getByRole('button',{name:'Open sample menu',exact:true});
    await menu.focus();await page.keyboard.press('ArrowDown');
    await page.getByRole('menuitem',{name:'Count an action',exact:true}).waitFor();
    assert.equal(await page.locator('[data-slot="dropdown-menu-content"]').evaluate(el=>!!el.closest('.uw-design-system')),false,'Menu is portaled outside studio root');
    assert.equal(await page.locator('[data-slot="dropdown-menu-content"]').evaluate(el=>getComputedStyle(el).transitionDuration),'0.18s');
    await audit('Open menu');
    await page.keyboard.press('Home');await page.keyboard.press('Enter');
    await page.getByText('Actions: 3',{exact:true}).waitFor();
    await gone('[data-slot="dropdown-menu-content"]');
    assert.equal(await menu.evaluate(el=>el===document.activeElement),true);
    await menu.click();
    await page.getByRole('menuitem',{name:'More actions',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await page.getByRole('menuitem',{name:'Count another action',exact:true}).waitFor();
    await page.waitForFunction(()=>document.activeElement?.textContent==='Count another action',{},{timeout:5000});
    await page.keyboard.press('Enter');
    await page.getByText('Actions: 4',{exact:true}).waitFor();
    await gone('[data-slot="dropdown-menu-content"]');
    console.log('PASS keyboard menus/submenus and focus return.');

    const select=page.getByRole('combobox',{name:'Sample writing time'});
    await select.click();
    const selectPopup=page.locator('[data-slot="select-content"]');
    await settle('[data-slot="select-content"]');
    assert.equal(await selectPopup.evaluate(el=>getComputedStyle(el).transform),'none','Aligned item never slides');
    await audit('Open select');
    await page.getByRole('option',{name:'Evening',exact:true}).click();
    await gone('[data-slot="select-content"]');
    await page.getByText('Selected: Evening',{exact:true}).waitFor();
    assert.equal(await select.evaluate(el=>el===document.activeElement),true);

    const popover=page.getByRole('button',{name:'Open sample popover',exact:true});
    await popover.click();await page.getByText('Writing reminder',{exact:true}).waitFor();
    await audit('Open popover');await page.keyboard.press('Escape');
    await gone('[data-slot="popover-content"]');
    assert.equal(await popover.evaluate(el=>el===document.activeElement),true);
    console.log('PASS aligned select and popover lifecycle.');

    const dialogTrigger=page.getByRole('button',{name:'Open sample dialog',exact:true});
    await dialogTrigger.click();
    const dialog=page.getByRole('dialog',{name:'A moment to begin'});
    await dialog.waitFor();
    await settle('[data-slot="dialog-content"]');
    const bounds=await dialog.boundingBox();assert.ok(Math.abs(bounds.x+bounds.width/2-720)<2,'Dialog stays centered; positioning translation is preserved');
    await page.getByPlaceholder('One small beginning…').fill('A non-sensitive temporary sample.');
    for(let i=0;i<8;i++){
      await page.keyboard.press(i%2?'Shift+Tab':'Tab');
      assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,'Dialog keeps keyboard focus contained');
    }
    await audit('Open dialog');
    await page.screenshot({path:path.join(output,'dialog-desktop.png')});
    await page.keyboard.press('Escape');
    await gone('[data-slot="dialog-content"]');
    assert.equal(await dialogTrigger.evaluate(el=>el===document.activeElement),true);
    await dialogTrigger.click();await dialog.waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();
    await gone('[data-slot="dialog-content"]');

    for(const width of [1440,1024,768,390,320]){
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No overflow '+width);
      await dialogTrigger.click();await dialog.waitFor();await settle('[data-slot="dialog-content"]');
      const box=await dialog.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width+1,'Dialog fits '+width);
      await page.keyboard.press('Escape');await gone('[data-slot="dialog-content"]');
      if([1440,390].includes(width))await page.screenshot({path:path.join(output,'foundation-'+width+'.png'),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>document.documentElement.style.zoom='2');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% CSS magnification fits');
    await page.evaluate(()=>document.documentElement.style.zoom='');
    await page.getByRole('button',{name:'Toggle sample theme',exact:true}).click();
    await page.locator('.uw-motion-preview').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});
    await audit('Dark sample surface');

    // Change the preference while a portaled dialog is open, not only at startup.
    await dialogTrigger.click();await dialog.waitFor();
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const selector of ['.uw-motion-dialog','.uw-motion-overlay','.uw-motion-control'])
      assert.equal(await page.locator(selector).first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s',selector+' reduced motion');
    await page.keyboard.press('Escape');await gone('[data-slot="dialog-content"]');
    await menu.click();
    assert.equal(await page.locator('[data-slot="dropdown-menu-content"]').evaluate(el=>({duration:getComputedStyle(el).transitionDuration,transform:getComputedStyle(el).transform})).then(s=>s.duration==='0s'&&s.transform==='none'),true);
    await page.keyboard.press('Escape');await gone('[data-slot="dropdown-menu-content"]');
    await select.click();assert.equal(await selectPopup.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    await page.keyboard.press('Escape');await gone('[data-slot="select-content"]');
    await popover.click();assert.equal(await page.locator('[data-slot="popover-content"]').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    await page.keyboard.press('Escape');await gone('[data-slot="popover-content"]');
    await audit('Reduced-motion surface');
    await context.close();

    // Separate unrecorded context: rAF intervals, React action latency, heap and
    // long tasks are lab observations, not GPU FPS, INP or device measurements.
    const lab=await browser.newContext({...httpsOptions,viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
    const lp=await lab.newPage(),cdp=await lab.newCDPSession(lp);
    lp.on('pageerror',e=>errors.push(e.message));
    await lp.goto(origin+'/motion-preview');await lp.getByRole('heading',{name:'A quieter kind of motion.'}).waitFor();
    for(let i=0;i<3;i++){
      await lp.getByRole('button',{name:'Open sample menu',exact:true}).click();
      await lp.getByRole('menuitem',{name:'Count an action',exact:true}).click();
      await lp.waitForFunction(()=>!document.querySelector('[data-slot="dropdown-menu-content"]'));
    }
    await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage');
    const heap=async()=> (await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value;
    const heapBefore=await heap();
    await lp.evaluate(()=>{
      window.__motionLab={frames:[],tasks:[],shifts:0,running:true};
      let last=performance.now();
      function tick(now){if(!window.__motionLab.running)return;window.__motionLab.frames.push(now-last);last=now;requestAnimationFrame(tick);}
      requestAnimationFrame(tick);
      for(const type of ['longtask','layout-shift'])if(PerformanceObserver.supportedEntryTypes.includes(type))new PerformanceObserver(list=>{
        for(const e of list.getEntries())if(type==='longtask')window.__motionLab.tasks.push(e.duration);else if(!e.hadRecentInput)window.__motionLab.shifts+=e.value;
      }).observe({type});
    });
    const latencies=[];
    for(let i=0;i<12;i++){
      await lp.getByRole('button',{name:'Open sample menu',exact:true}).click();
      await lp.getByRole('menuitem',{name:'Count an action',exact:true}).click();
      await lp.waitForFunction(()=>!document.querySelector('[data-slot="dropdown-menu-content"]'));
      latencies.push(await lp.evaluate(()=>new Promise(resolve=>{
        const status=document.querySelector('[role="status"]'),before=status.textContent,start=performance.now();
        const observer=new MutationObserver(()=>{if(status.textContent!==before){observer.disconnect();resolve(performance.now()-start);}});
        observer.observe(status,{childList:true,subtree:true,characterData:true});
        [...document.querySelectorAll('button')].find(b=>b.textContent==='Try feedback').click();
      })));
    }
    const stats=await lp.evaluate(()=>{window.__motionLab.running=false;return window.__motionLab;});
    assert.equal(await lp.locator('.uw-motion-popup,.uw-motion-dialog,.uw-motion-overlay').count(),0,'All closed portals unmount after repeated interactions');
    await cdp.send('HeapProfiler.collectGarbage');const heapAfter=await heap();
    const report={scope:'Local Chromium preview production bundle, unthrottled desktop, no video in measured context. Three warm-up cycles, then twelve measured cycles. rAF intervals are scheduler observations, not GPU FPS. Synthetic clicks to React text update are not INP. Heap snapshots after forced GC do not prove absence of leaks.',frameSamples:stats.frames.length,frameIntervalP50Ms:percentile(stats.frames,.5),frameIntervalP95Ms:percentile(stats.frames,.95),actionToCommitP50Ms:percentile(latencies,.5),actionToCommitP95Ms:percentile(latencies,.95),layoutShift:stats.shifts,longTasksMs:stats.tasks,heapBeforeBytes:heapBefore,heapAfterBytes:heapAfter,heapDeltaBytes:heapAfter-heapBefore};
    fs.writeFileSync(path.join(output,'foundation-performance.json'),JSON.stringify(report,null,2)+'\n');
    assert.deepEqual(errors,[]);assert.deepEqual(apiCalls,[],'Preview controls never access private APIs');
    console.log('PASS motion foundation: shared buttons, portaled menu/submenu/select/popover/dialog lifecycle, keyboard focus/Escape, disabled actions, live reduced-motion change, light/dark axe, 320–1440px and 200% CSS magnification, repeated cleanup, no API calls.');
    console.log(JSON.stringify(report));
    await lab.close();
  } finally { await browser.close();if(server)await server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
