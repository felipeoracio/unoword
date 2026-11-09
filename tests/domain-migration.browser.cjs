/** Local multi-origin hosting fixture + real built UI. No real auth/mail/Stripe. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const {redirectFor}=require('./helpers/domain-hosting.cjs');
const primary='https://unoword.app',legacy='https://unoword.vercel.app',dist=path.resolve('frontend/dist');
const owner='00000000-0000-4000-8000-000000000001';
const user={id:owner,email:'synthetic@example.com',ai_access:true,plan:'pro'};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try{
  // Virtual HTTPS origins are fulfilled locally; real certificates are checked
  // separately by the live-domain probe, not by this intercepted fixture.
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block',ignoreHTTPSErrors:true});
  await context.route('**/*',route=>route.abort('blockedbyclient'));
  const sessions=new Map(),requests=[],errors=[];
  await context.route(/https:\/\/(unoword\.app|unoword\.vercel\.app|www\.unoword\.app)\//,async route=>{
   const req=route.request(),url=new URL(req.url()),redirect=redirectFor(req.url());
   if(redirect)return route.fulfill({status:redirect.status,headers:{location:redirect.location}});
   if(url.pathname.startsWith('/api/')){
    const key=url.pathname.slice(4),method=req.method();requests.push({origin:url.origin,key,method});
    let result={},status=200;
    if(key==='/auth/login'){sessions.set(url.origin,true);result={authenticated:true,user};}
    else if(key==='/auth/me'){status=sessions.get(url.origin)?200:401;result=status===200?user:{detail:'Authentication required'};}
    else if(key==='/auth/refresh'){status=401;result={detail:'No fixture refresh'};}
    else if(key==='/auth/google')result={enabled:false};
    else if(key==='/subscription')result={user_id:owner,status:'active',managed_by_stripe:false,trial_eligible:false,billing_available:false};
    else if(key==='/subscription/lifetime/offer')result={amount:10000,currency:'usd',capacity:25,test_mode:true,checkout_available:false,purchased:0,reserved:0,remaining:25,available:25,refund_days:14,daily_ai_limit:10};
    else if(key==='/subscription/substack')result={user_id:owner,configured:false,available:false,connected:false,active:false,subscriptions:[],pending_request:null};
    else if(key==='/product')result={name:'UnoWord',billing_available:false,features:[],plans:[],ai_allowance:{suggestions_daily:10,suggestions_monthly:200,guidance_monthly:30}};
    else if(key.startsWith('/workspace/')||key.startsWith('/rewards')||key.startsWith('/ai/')){status=503;result={detail:'isolated_fixture'};}
    return route.fulfill({status,json:result});
   }
   const publicRoute=['/privacy','/support','/terms','/lifetime'].find(p=>p===url.pathname.replace(/\/$/,''));
   const filepath=path.join(dist,publicRoute?publicRoute.slice(1)+'/index.html':url.pathname==='/'?'index.html':url.pathname.slice(1));
   const file=fs.existsSync(filepath)&&fs.statSync(filepath).isFile()?filepath:path.join(dist,'index.html');
   const ext=path.extname(file);const type={'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.xml':'application/xml','.txt':'text/plain'}[ext]||'text/html';
   return route.fulfill({body:fs.readFileSync(file),contentType:type});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  // Redirect transformation is checked by the companion compiler tests. Start
  // each virtual-origin navigation directly: Chromium can bypass interception
  // for a cross-origin HTTP redirect successor and reach the real deployment.
  const forwarded=redirectFor(legacy+'/editor?project=123&tag=one&tag=two');
  assert.deepEqual(forwarded,{status:301,location:primary+'/editor?project=123&tag=one&tag=two'});
  await page.goto(forwarded.location+'#draft');
  await page.getByRole('heading',{name:'Sign in to write',exact:true}).waitFor({timeout:10000}).catch(async error=>{
    console.error('Synthetic fixture diagnostic',JSON.stringify({url:page.url(),errors,requests,body:(await page.locator('body').innerText()).slice(0,800)}));throw error;
  });
  assert.equal(page.url(),primary+'/editor?project=123&tag=one&tag=two#draft');
  await page.goto(legacy+'/account?domain_recovery=1&next=%2Feditor');
  await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  assert.ok(await page.getByRole('status').filter({hasText:'Previous-domain recovery'}).count());
  await page.evaluate(()=>new Promise((resolve,reject)=>{
   const open=indexedDB.open('uno-word-writing',1);
   open.onupgradeneeded=()=>open.result.createObjectStore('records',{keyPath:'key'}).createIndex('owner','owner');
   open.onerror=()=>reject(Error('fixture database'));
   open.onsuccess=()=>{const tx=open.result.transaction('records','readwrite');tx.objectStore('records').put({key:'migration-marker',owner:'00000000-0000-4000-8000-000000000001',kind:'migration-proof',value:'synthetic unsynced draft'});tx.oncomplete=()=>{open.result.close();resolve()}};
  }));
  await page.locator('#launch-email').fill(user.email);await page.locator('#launch-password').fill('synthetic-test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(legacy+'/editor?domain_recovery=1');
  assert.ok(requests.some(r=>r.origin===legacy&&r.key==='/auth/login'&&r.method==='POST'),'recovery retains same-origin POST authentication');
  const saved=await page.evaluate(()=>new Promise(resolve=>{const open=indexedDB.open('uno-word-writing',1);open.onsuccess=()=>{const get=open.result.transaction('records').objectStore('records').get('migration-marker');get.onsuccess=()=>{resolve(get.result?.value);open.result.close()}}}));
  assert.equal(saved,'synthetic unsynced draft','origin migration does not delete the old writing store');
  const primaryPage=await context.newPage();primaryPage.on('pageerror',error=>errors.push(error.message));await primaryPage.goto(primary+'/editor');
  await primaryPage.getByRole('heading',{name:'Sign in to write',exact:true}).waitFor();
  assert.ok(requests.some(r=>r.origin===primary&&r.key==='/auth/me'),'primary has an independent sign-in session');
  await primaryPage.goto(primary+'/');
  for(const width of [1440,768,390]){
   await primaryPage.setViewportSize({width,height:1000});
   await primaryPage.getByRole('heading',{name:/Your Words/}).waitFor({timeout:10000}).catch(async error=>{console.error('Synthetic home diagnostic',JSON.stringify({url:primaryPage.url(),errors,headings:await primaryPage.getByRole('heading').allTextContents(),body:(await primaryPage.locator('body').innerText()).slice(0,500)}));throw error;});
   assert.ok(await primaryPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px overflow');
   assert.equal(await primaryPage.locator('link[rel=canonical]').getAttribute('href'),primary+'/');
   if(process.env.DOMAIN_SCREENSHOTS){fs.mkdirSync(process.env.DOMAIN_SCREENSHOTS,{recursive:true});await primaryPage.screenshot({path:path.join(process.env.DOMAIN_SCREENSHOTS,'domain-'+width+'.png'),fullPage:true});}
  }
  await primaryPage.goto(primary+'/support');await primaryPage.getByRole('link',{name:'Recover drafts from the previous Vercel address'}).waitFor();
  assert.equal(await primaryPage.locator('meta[property="og:url"]').getAttribute('content'),primary+'/support');
  await page.goto(legacy+'/?code=synthetic-in-flight-code');await page.getByRole('heading',{name:'Finish confirming your account'}).waitFor();
  assert.equal(new URL(page.url()).origin,legacy);assert.ok(!page.url().includes('synthetic-in-flight-code'),'confirmation removes the code from the address bar');
  assert.deepEqual(errors,[]);
  console.log('Domain browser checks passed: compiled redirects, app query/fragment, independent sessions, old-origin storage recovery, legacy confirmation, SEO and responsive layout.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
