/** Local Chromium lab observation, not field Web Vitals or physical-device data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({page,canvas,documents,requests,errors})=>{
 const navigation=await page.evaluate(()=>{
  const n=performance.getEntriesByType('navigation')[0];
  const resources=performance.getEntriesByType('resource').filter(r=>!r.name.includes('/api/'));
  return {domContentLoadedMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd,
   transferredBytes:resources.reduce((s,r)=>s+r.transferSize,0),...window.__studioLab};
 });
 const text='A patient writer notices the world around them. '.repeat(1100);
 await canvas.fill(text);
 const addition=' Observing small details.';
 await canvas.evaluate(el=>{
  el.__paintSamples=[];
  el.addEventListener('input',()=>{
   const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>el.__paintSamples.push(performance.now()-start)));
  });
 });
 const samples=[];
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  await canvas.evaluate(el=>{el.__paintSamples=[];});
  await canvas.press('ControlOrMeta+End');await canvas.pressSequentially(addition);
  await page.waitForFunction(n=>document.querySelector('.uw-writing-canvas').__paintSamples.length>=n,addition.length);
  const timings=await canvas.evaluate(el=>el.__paintSamples.slice().sort((a,b)=>a-b));
  samples.push({width,characters:timings.length,p50Ms:timings[Math.floor(timings.length*.5)],p95Ms:timings[Math.floor(timings.length*.95)]});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('All changes saved'));
 const expected=text+addition+addition;
 assert.equal(await canvas.textContent(),expected);
 assert.equal([...documents.values()][0].plain_text.trim(),expected.trim(),'Large draft and final keystrokes are durably saved');
 assert.equal(requests.some(r=>r.key==='/workspace/assistant'),false);assert.deepEqual(errors,[]);
 const report={scope:'Local Chromium production bundle; synthetic API responses. 4x CPU slowdown; 150ms network latency, 1.6Mbps download; cache disabled. Input event to second animation frame, not INP or physical iPad data.',navigation,documentCharacters:expected.length,inputToFrame:samples};
 const directory=path.resolve('tests/artifacts/phase8');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'performance.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS large-draft save/typing integrity and responsive layout under lab throttling. Measurements: '+JSON.stringify(report));
};
