/** Retired offer and existing-purchase management; synthetic API only. */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const origin=process.env.LIFETIME_TEST_ORIGIN||'http://localhost:4175',owner='00000000-0000-4000-8000-000000000001';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  let signed=false,state='none',canRefund=false,refundRequests=0;
  const requests=[],errors=[];
  await context.route(origin+'/api/**',async route=>{
   const req=route.request(),key=new URL(req.url()).pathname;
   requests.push([key,req.method()]);
   if(key==='/api/auth/google')return route.fulfill({json:{enabled:false}});
   if(key==='/api/product')return route.fulfill({json:{name:'UnoWord',billing_available:true,plans:[],features:[]}});
   if(!signed)return route.fulfill({status:401,json:{detail:'Authentication required'}});
   const paid=state==='paid';
   if(key==='/api/auth/me')return route.fulfill({json:{id:owner,email:'fixture@example.com',plan:paid?'pro':'free',ai_access:paid}});
   if(key==='/api/subscription')return route.fulfill({json:{user_id:owner,plan:paid?'pro':'free',status:paid?'active':'inactive',billing_available:true,managed_by_stripe:false,access_source:paid?'stripe_lifetime':null}});
   if(key==='/api/subscription/substack')return route.fulfill({json:{user_id:owner,configured:false,available:false,connected:false,active:false,subscriptions:[],pending_request:null}});
   if(key==='/api/subscription/lifetime'&&req.method()==='GET')return route.fulfill({json:{user_id:owner,status:state,can_checkout:true,can_refund:canRefund}});
   if(key==='/api/subscription/lifetime/refund'){
    refundRequests++;assert.deepEqual(req.postDataJSON(),{expected_user_id:owner,confirmed:true});state='refunded';canRefund=false;
    return route.fulfill({json:{status:'refund_requested'}});
   }
   if(key==='/api/progress/streak')return route.fulfill({json:{user_id:owner,displayedStreak:0,hasUnlimitedStreakAccess:paid,streakLimitReached:false,timezone:'UTC',asOf:new Date().toISOString()}});
   if(key==='/api/progress/summary')return route.fulfill({json:{user_id:owner,reportingDate:'2026-11-09',timezone:'UTC',dailyWordCount:0,dailyActiveWritingSeconds:0,lifetimeActiveWritingSeconds:0,dailyGoal:250,dailyGoalProgress:0,displayedStreak:0,updatedAt:new Date().toISOString(),sessions:[]}});
   if(key==='/api/progress/preferences')return route.fulfill({json:{user_id:owner,revision:1,daily_goal:250,timezone:'UTC',language:'en',themes:[]}});
   if(key.startsWith('/api/rewards')||key==='/api/ai/usage/summary')return route.fulfill({status:503,json:{detail:'isolated_fixture'}});
   if(key==='/api/onboarding')return route.fulfill({json:{version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[]}});
   throw Error('Unexpected fixture request '+key);
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.name));
  // Local preview has no Vercel edge: this exercises the SPA fallback too.
  for(const pathname of ['/lifetime','/lifetime/','/lifetime/index.html?source=old']){
   await page.goto(origin+pathname);await page.waitForURL(origin+'/#pricing');
   await page.getByRole('heading',{name:'Start free. Grow at your own pace.'}).waitFor();
   assert.ok(!(await page.locator('main').innerText()).includes('$100'));
  }
  await page.goto(origin+'/account?offer=lifetime&billing=success');
  await page.getByText('Sign in to manage an existing lifetime purchase.',{exact:false}).waitFor();
  signed=true;await page.reload();
  const section=page.getByRole('region',{name:'Lifetime purchase',exact:true});
  await section.getByRole('heading',{name:'Your lifetime purchase'}).waitFor();
  assert.ok((await section.innerText()).includes('closed to new purchases'));
  assert.equal(await section.getByRole('checkbox').count(),0,'old success redirect and stale can_checkout cannot create a purchase');
  assert.equal(await section.getByRole('button',{name:/Checkout|Purchase/}).count(),0);
  state='paid';canRefund=true;await page.reload();
  await section.getByText('Your lifetime payment is verified.',{exact:false}).waitFor();
  assert.ok((await page.locator('.uw-account-plan').innerText()).includes('Pro'));
  const refund=section.getByRole('button',{name:'Request 14-Day Test Refund'});
  assert.equal(await refund.isDisabled(),true);
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+'px layout');
  }
  await section.getByRole('checkbox').check();await refund.click();
  await section.getByText('Your lifetime purchase is refunded.',{exact:false}).waitFor();
  assert.equal(refundRequests,1);
  assert.equal(requests.some(([key,method])=>method==='POST'&&(key==='/api/subscription/lifetime'||key==='/api/subscription/change')),false);
  assert.equal(requests.some(([key])=>key==='/api/subscription/lifetime/offer'),false,'management does not promote or fetch new offers');
  await section.getByRole('link',{name:'Lifetime purchase terms'}).click();
  await page.getByRole('heading',{name:'Existing lifetime purchases'}).waitFor();
  assert.equal(await page.locator('a[href^="/lifetime"]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS retired lifetime: SPA deep-link redirects; closed offer with no purchase UI/requests despite stale availability and success URL; verified Pro retained; eligible refund confirmation preserved; purchase terms; 320–1440px. No real charges or refunds.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
