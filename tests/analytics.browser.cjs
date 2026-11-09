/** Production bundle on virtual hosts. Google collection is intercepted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const dist=path.resolve('frontend/dist'),primary='https://unoword.app',id='G-H6H51HNY32';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try {
  async function fixture(host=primary,signal){
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
   const loads=[],errors=[];
   if(signal)await context.addInitScript(value=>Object.defineProperty(navigator,value,{get:()=>value==='doNotTrack'?'1':true}),signal);
   await context.route('**/*',route=>route.abort());
   await context.route('https://www.googletagmanager.com/gtag/js?*',route=>{
    loads.push(route.request().url());return route.fulfill({contentType:'text/javascript',body:'/* intercepted Google tag: never sends analytics */'});
   });
   await context.route(host+'/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/')){
     const key=url.pathname.slice(4);
     if(key==='/product')return route.fulfill({json:{name:'UnoWord',billing_available:false,plans:[],features:[]}});
     if(key==='/auth/google')return route.fulfill({json:{enabled:false}});
     if(key.startsWith('/auth/'))return route.fulfill({status:401,json:{detail:'Authentication required'}});
     return route.fulfill({json:{}});
    }
    const file=path.join(dist,url.pathname==='/'?'index.html':url.pathname.slice(1));
    const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(dist,'index.html');
    const type={'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[path.extname(target)]||'text/html';
    return route.fulfill({body:fs.readFileSync(target),contentType:type});
   });
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.name));
   return {context,page,loads,errors};
  }
  const f=await fixture();
  await f.page.goto(primary+'/?utm_source=newsletter#features');
  const events=()=>f.page.evaluate(()=>Array.from(window.dataLayer||[],args=>Array.from(args)));
  await f.page.waitForFunction(()=>window.dataLayer?.length>=3);
  let data=await events();
  assert.equal(f.loads.length,1);
  const config=data.find(args=>args[0]==='config');
  assert.deepEqual(data.find(args=>args[0]==='consent'), ['consent','default',{
   ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',
  }]);
  assert.equal(config[1],id);assert.equal(config[2].send_page_view,false);
  assert.equal(config[2].allow_google_signals,false);
  assert.equal(config[2].allow_ad_personalization_signals,false);
  assert.equal(config[2].page_location,primary+'/');
  assert.equal(data.filter(args=>args[0]==='event').length,1);
  await f.page.locator('footer a[href="/support"]').click();
  await f.page.waitForFunction(()=>Array.from(window.dataLayer||[]).filter(args=>args[0]==='event').length===2);
  data=await events();assert.equal(data.at(-1)[2].page_location,primary+'/support');
  await f.page.locator('header a[href="/"]').first().click();
  await f.page.waitForFunction(()=>Array.from(window.dataLayer||[]).filter(args=>args[0]==='event').length===3);
  await f.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Features',exact:true}).click();
  await f.page.waitForTimeout(100);
  assert.equal((await events()).filter(args=>args[0]==='event').length,3,'anchor navigation is not a new page');
  await f.page.locator('.lp-header-actions a[href="/account?mode=signin"]').click();
  await f.page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  assert.equal(await f.page.evaluate(key=>window['ga-disable-'+key],id),true);
  assert.equal((await events()).filter(args=>args[0]==='event').length,3,'no private account event');
  await f.page.goBack();
  await f.page.waitForFunction(()=>Array.from(window.dataLayer||[]).filter(args=>args[0]==='event').length===4);
  assert.equal(f.loads.length,1,'same Google tag survives public navigation');
  assert.equal(await f.page.evaluate(key=>{history.pushState({},'', '/editor?document=private-sentinel');return window['ga-disable-'+key]},id),true,'guard disables collection synchronously before private history changes');
  assert.ok(!JSON.stringify(await events()).includes('private-sentinel'));
  assert.deepEqual(f.errors,[]);await f.context.close();
  for(const pathname of ['/editor?document=private-sentinel','/account?billing=success','/account/security?token_hash=private-sentinel','/rewards','/admin','/missing','/?code=private-sentinel','/?email=private-sentinel','/#access_token=private-sentinel']){
   const current=await fixture();await current.page.goto(primary+pathname);await current.page.waitForTimeout(150);
   assert.equal(current.loads.length,0,'no tag on '+pathname);
   assert.equal(await current.page.evaluate(()=>window.dataLayer?.length||0),0);
   await current.context.close();
  }
  for(const host of ['https://preview-example.vercel.app','https://unoword.vercel.app','http://localhost:4192']){
   const current=await fixture(host);await current.page.goto(host+'/');await current.page.getByRole('heading',{level:1}).waitFor();
   assert.equal(current.loads.length,0,'no analytics on '+host);await current.context.close();
  }
  for(const signal of ['doNotTrack','globalPrivacyControl']){
   const current=await fixture(primary,signal);await current.page.goto(primary+'/');await current.page.getByRole('heading',{level:1}).waitFor();
   assert.equal(current.loads.length,0,'respects '+signal);await current.context.close();
  }
  console.log('PASS GA4: correct property; one public SPA pageview per navigation; anchors/back; single async tag; private/auth/admin routes and URL parameters excluded; synchronous history guard; Preview/local/legacy suppression; DNT/GPC respected. Google collection intercepted.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
