/** Shipped sign-in UI with synthetic account APIs; no real login or billing. */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const owner='00000000-0000-4000-8000-000000000001';
(async()=>{
 const server=await require('./helpers/production-fixture-server.cjs').start();
 const origin=server.origin;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try{
  const context=await browser.newContext();context.setDefaultTimeout(15000);
  let signed=false,paid=false,rejected=false,unverified=false;
  const requests=[],errors=[];
  await context.route(origin+'/api/**',async route=>{
   const req=route.request(),key=new URL(req.url()).pathname.slice(4);requests.push({key,method:req.method()});
   let status=200,value={};
   if(key==='/product')value={name:'UnoWord',billing_available:false,chrome_store_url:null,plans:[],features:[]};
   else if(key==='/auth/google')value={enabled:false};
   else if(key==='/auth/login'){
    assert.equal(req.method(),'POST');assert.equal(req.postDataJSON().email,'writer@example.com');
    if(rejected){status=401;value={detail:'invalid_login_credentials'};}
    else{signed=!unverified;value={authenticated:true,user:{id:owner,email:'writer@example.com',plan:paid?'pro':'free',ai_access:paid}};}
   }else if(!signed){status=401;value={detail:'Authentication required'};}
   else if(key==='/auth/me')value={id:owner,email:'writer@example.com',plan:paid?'pro':'free',ai_access:paid};
   else if(key==='/progress/preferences')value={user_id:owner,revision:1,daily_goal:250,timezone:'UTC',language:'en',themes:[]};
   else if(key==='/progress/summary')value={user_id:owner,reportingDate:new Date().toISOString().slice(0,10),timezone:'UTC',dailyWordCount:0,dailyActiveWritingSeconds:0,lifetimeActiveWritingSeconds:0,lifetimeWordCount:0,dailyGoal:250,displayedStreak:0,updatedAt:new Date().toISOString(),sessions:[]};
   else if(key==='/progress/streak')value={user_id:owner,displayedStreak:0,hasUnlimitedStreakAccess:paid,streakLimitReached:false,timezone:'UTC',asOf:new Date().toISOString()};
   else if(key==='/workspace/documents')value=[];
   else if(key==='/subscription')value={user_id:owner,status:'inactive',billing_available:false,managed_by_stripe:false,trial_eligible:true};
   else if(key==='/subscription/substack')value={user_id:owner,configured:false,available:false,connected:false,active:false,subscriptions:[],pending_request:null};
   else if(key==='/onboarding')value={version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
   else if(key==='/subscription/lifetime')value={user_id:owner,status:'none',can_checkout:false,can_refund:false};
   else if(key==='/subscription/lifetime/offer')value={amount:10000,currency:'usd',capacity:25,remaining:null,available:null,purchased:null,reserved:null,test_mode:true,checkout_available:false,refund_days:14,daily_ai_limit:100};
   else if(key.startsWith('/rewards')||key==='/ai/usage/summary'){status=503;value={detail:'isolated_fixture'};}
   else throw Error('Unexpected fixture '+req.method()+' '+key);
   await route.fulfill({status,json:value});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  async function login(path){
   signed=false;await page.goto(origin+path);
   await page.getByLabel('Email address',{exact:true}).fill('writer@example.com');
   await page.getByLabel('Password',{exact:true}).fill('fixture-password-only');
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
  }
  for(const access of [false,true]){
   paid=access;await login('/account?mode=signin');await page.getByTestId('studio-home').waitFor();
   assert.equal(new URL(page.url()).pathname,'/app');
  }
  for(const next of ['https://outside.example','//outside.example','/unknown']){
   paid=false;await login('/account?next='+encodeURIComponent(next));await page.getByTestId('studio-home').waitFor();assert.equal(new URL(page.url()).pathname,'/app');
  }
  for(const path of ['/account?plan=pro','/account?offer=lifetime','/account?billing=return','/account#install','/settings#account-settings','/account?next=%2Fsettings']){
   await login(path);await page.getByText('Signed in as',{exact:false}).waitFor();
   assert.equal(new URL(page.url()).pathname,path.includes('settings')?'/settings':'/account');
  }
  // A verified session visiting Settings directly must stay there.
  await page.goto(origin+'/account');await page.getByText('Signed in as',{exact:false}).waitFor();assert.equal(new URL(page.url()).pathname,'/account');
  rejected=true;await login('/account');await page.getByRole('status').filter({hasText:'That sign-in was not accepted'}).waitFor();assert.equal(new URL(page.url()).pathname,'/account');
  rejected=false;unverified=true;await login('/account');await page.getByRole('status').filter({hasText:'Please sign in again'}).waitFor();assert.equal(new URL(page.url()).pathname,'/account');
  assert.equal(requests.some(r=>r.method==='POST'&&r.key.startsWith('/subscription')),false);assert.deepEqual(errors,[]);
  console.log('PASS sign-in destinations: verified Free/Pro password login opens Home; unsafe next falls back to Home; Settings/install/billing/plan links remain intentional; existing Settings visit, failed login and unverified sessions stay put; no plan mutation.');
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
