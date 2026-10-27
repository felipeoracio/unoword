/** Verified signup UX against the production bundle, isolated provider fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const origin=process.env.SIGNUP_TEST_ORIGIN||'http://localhost:4175',owner='00000000-0000-4000-8000-000000000001';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});try{
 const c=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'});let signed=false,intent='account',fail=false;const calls=[],errors=[];
 await c.route(origin+'/api/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname;calls.push([p,req.method(),req.postData()]);
  if(p==='/api/auth/signup'){intent=req.postDataJSON().intent;return route.fulfill({status:201,json:{user:{id:'pending-confirmation',email:'writer@example.com',plan:null,ai_access:false},authenticated:false,message:'Check your email to confirm your account, then return to sign in. If you already have an account, sign in instead.'}});}
  if(p==='/api/auth/signup/complete'){
   assert.equal(typeof req.postDataJSON().code,'string');
   if(fail)return route.fulfill({status:400,json:{detail:'signup_verification_failed'}});
   signed=true;return route.fulfill({json:{redirect:intent==='lifetime'?'/account?offer=lifetime':intent==='pro'?'/account?plan=pro':intent==='editor'?'/account?next=%2Feditor':'/account'}});
  }
  if(p==='/api/auth/me'||p==='/api/auth/refresh')return route.fulfill({status:signed?200:401,json:signed?{id:owner,email:'writer@example.com',plan:'free',ai_access:false}:{detail:'Authentication required'}});
  if(p==='/api/auth/google')return route.fulfill({json:{enabled:true}});
  if(p==='/api/product')return route.fulfill({json:{name:'UnoWord',billing_available:true,chrome_store_url:null,plans:[],features:[]}});
  if(p==='/api/subscription')return route.fulfill({json:{user_id:owner,status:'inactive',billing_available:true,managed_by_stripe:false,trial_eligible:true}});
  if(p==='/api/subscription/lifetime/offer')return route.fulfill({json:{amount:10000,currency:'usd',capacity:25,remaining:null,available:null,purchased:null,reserved:null,test_mode:true,checkout_available:false,refund_days:14,daily_ai_limit:100}});
  if(p==='/api/subscription/lifetime')return route.fulfill({json:{user_id:owner,status:'none',can_checkout:false,can_refund:false}});
  if(p==='/api/onboarding')return route.fulfill({json:{version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[],draft_id:null,words:0}});
  throw Error('Unexpected fixture request '+p);
 });
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const [query,expected] of [['?mode=signup','account'],['?mode=signup&plan=pro','pro'],['?mode=signup&offer=lifetime','lifetime'],['?mode=signup&next=%2Feditor','editor']]){
  signed=false;await p.goto(origin+'/account'+query);await p.getByLabel('Email address',{exact:true}).fill('writer@example.com');await p.getByLabel('Password',{exact:true}).fill('fixture-not-a-real-password');await p.getByRole('button',{name:'Create free account',exact:true}).click();
  await p.getByRole('status').filter({hasText:'Check your email to confirm your account'}).waitFor();assert.equal(intent,expected);assert.equal(await p.getByLabel('Password',{exact:true}).inputValue(),'');assert.equal(await p.getByText('Signed in as',{exact:false}).count(),0);
  const before=calls.filter(([p])=>p==='/api/auth/signup/complete').length;
  await p.goto(origin+'/?code=one-use-fixture-code');await p.getByRole('heading',{name:'Finish confirming your account'}).waitFor();assert.ok(!p.url().includes('code='));assert.equal(calls.filter(([p])=>p==='/api/auth/signup/complete').length,before,'Opening the email does not consume the code automatically');
  await p.evaluate(()=>localStorage.setItem('uno-writing-identity','old-account'));
  await p.getByRole('button',{name:'Confirm email and continue'}).click();await p.getByText('Signed in as',{exact:false}).waitFor();assert.equal(await p.evaluate(()=>localStorage.getItem('uno-writing-identity')),null);assert.ok((await p.locator('.uw-account-plan').innerText()).includes('Free'));
  const url=new URL(p.url());assert.equal(url.searchParams.get('offer'),expected==='lifetime'?'lifetime':null);assert.equal(url.searchParams.get('plan'),expected==='pro'?'pro':null);assert.equal(url.searchParams.get('next'),expected==='editor'?'/editor':null);
 }
 assert.equal(calls.some(([p,method])=>method==='POST'&&p.startsWith('/api/subscription')),false,'Confirmation cannot start checkout or grant Pro');
 signed=false;fail=true;await p.goto(origin+'/?code=expired-fixture');await p.getByRole('button',{name:'Confirm email and continue'}).click();await p.getByRole('status').filter({hasText:'This confirmation could not be completed'}).waitFor();await p.getByRole('link',{name:'Sign in with email or Google'}).waitFor();assert.ok(!p.url().includes('code='));
 for(const width of [320,390,768,1440]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);}
 await p.getByRole('link',{name:'Sign in with email or Google'}).click();await p.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,'/account');
 await p.goto(origin+'/#error=access_denied&error_code=otp_expired&error_description=private-provider-details');await p.getByRole('status').filter({hasText:'This confirmation link is invalid or expired'}).waitFor();assert.ok(!p.url().includes('error'));assert.ok(!(await p.locator('main').innerText()).includes('private-provider-details'));assert.equal(await p.getByRole('button',{name:'Confirm email and continue'}).count(),0);
 await p.goto(origin+'/?access_token=fixture-url-token&refresh_token=fixture-refresh');await p.getByRole('status').filter({hasText:'This confirmation link is invalid or expired'}).waitFor();assert.ok(!p.url().includes('token'));assert.ok(!(await p.locator('main').innerText()).includes('fixture-url-token'));assert.equal(await p.getByRole('button',{name:'Confirm email and continue'}).count(),0);
 if(process.env.AXE_SCRIPT){await p.addScriptTag({path:process.env.AXE_SCRIPT});const violations=await p.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);}
 if(process.env.SIGNUP_SCREENSHOTS){fs.mkdirSync(process.env.SIGNUP_SCREENSHOTS,{recursive:true});await p.setViewportSize({width:390,height:1000});await p.screenshot({path:path.join(process.env.SIGNUP_SCREENSHOTS,'confirmation-mobile.png'),fullPage:true});}
 const es=await browser.newContext({locale:'es-ES',viewport:{width:320,height:900}});await es.route(origin+'/api/**',r=>r.fulfill({status:400,json:{detail:'signup_verification_failed'}}));const spanish=await es.newPage();await spanish.goto(origin+'/?code=spanish-fixture');await spanish.getByRole('heading',{name:'Completa la confirmación de tu cuenta'}).waitFor();await spanish.getByRole('button',{name:'Confirmar correo y continuar'}).click();await spanish.getByRole('status').filter({hasText:'No se pudo completar'}).waitFor();assert.equal(await spanish.evaluate(()=>document.documentElement.scrollWidth),320);assert.ok(!spanish.url().includes('code='));
 assert.deepEqual(errors,[]);console.log('PASS verified signup browser fixtures: pending/no session, explicit confirmation, code URL cleanup, cache reset, account/monthly/lifetime/editor intent, no automatic payment or Pro grant, expired/wrong-browser guidance, 320–1440px EN/ES, WCAG.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
