/** Google/Supabase callback fixtures; no real identity, consent, payment or token. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const origin=process.env.GOOGLE_TEST_ORIGIN||'http://localhost:4175',owner='00000000-0000-4000-8000-000000000001';
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox']});try{
 const c=await b.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});let enabled=true,signed=false,cancel=false,startFails=false,intent='account';const calls=[],errors=[];
 await c.route(origin+'/api/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname;calls.push([p,req.method()]);
 if(p==='/api/auth/google')return route.fulfill({json:{enabled}});
 if(p==='/api/auth/google/start'){
  if(startFails)return route.fulfill({status:503,json:{detail:'google_oauth_not_configured'}});
  intent=req.postDataJSON().intent;assert.ok(['account','pro','lifetime','editor'].includes(intent));
  return route.fulfill({json:{url:'https://project.supabase.co/auth/v1/authorize?provider=google&code_challenge=fixture&redirect_to='+encodeURIComponent(origin+'/api/auth/google/callback?flow=fixture')}});
 }
 if(p==='/api/auth/google/callback'){
  if(!cancel)signed=true;
  const next=intent==='lifetime'?'/account?offer=lifetime':intent==='pro'?'/account?plan=pro':intent==='editor'?'/account?next=%2Feditor':'/account';
  return route.fulfill({status:303,headers:{location:origin+next+(next.includes('?')?'&':'?')+'oauth='+(cancel?'canceled':'success')},body:''});
 }
 if(p==='/api/product')return route.fulfill({json:{name:'UnoWord',billing_available:true,chrome_store_url:null,plans:[],features:[]}});
 if(p==='/api/auth/me'||p==='/api/auth/refresh')return route.fulfill({status:signed?200:401,json:signed?{id:owner,email:'google@example.com',plan:'free',ai_access:false}:{detail:'Authentication required'}});
 if(p==='/api/subscription')return route.fulfill({json:{user_id:owner,status:'inactive',billing_available:true,managed_by_stripe:false,trial_eligible:true}});
 if(p==='/api/subscription/lifetime/offer')return route.fulfill({json:{amount:10000,currency:'usd',capacity:25,remaining:null,available:null,purchased:null,reserved:null,test_mode:true,checkout_available:false,refund_days:14,daily_ai_limit:100}});
 if(p==='/api/subscription/lifetime')return route.fulfill({json:{user_id:owner,status:'none',can_checkout:false,can_refund:false}});
 if(p==='/api/onboarding')return route.fulfill({json:{version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[],draft_id:null,words:0}});
 throw Error('Unexpected request '+p);
 });
 await c.route('https://project.supabase.co/auth/v1/authorize**',route=>{const params=new URL(route.request().url()).searchParams;assert.equal(params.get('provider'),'google');return route.fulfill({contentType:'text/html',body:'<a href="'+params.get('redirect_to')+'&amp;code=one-time-fixture-code">Complete Google sign-in</a>'});});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const [query,expected] of [['?mode=signin','account'],['?mode=signup&plan=pro','pro'],['?offer=lifetime','lifetime']]){
  signed=false;await p.goto(origin+'/account'+query);await p.getByRole('button',{name:'Continue with Google',exact:true}).waitFor();
  await p.evaluate(()=>localStorage.setItem('uno-writing-identity',JSON.stringify({id:'old-account'})));
  await p.getByRole('button',{name:'Continue with Google',exact:true}).click();await p.getByRole('link',{name:'Complete Google sign-in'}).click();await p.getByText('Signed in as',{exact:false}).waitFor();
  assert.equal(intent,expected);assert.equal(await p.evaluate(()=>localStorage.getItem('uno-writing-identity')),null,'New identity clears the previous cache boundary');assert.ok(!p.url().includes('oauth=')&&!p.url().includes('code='));assert.ok((await p.locator('.uw-account-plan').innerText()).includes('Free'),'Google sign-in does not grant Pro');
  if(expected==='lifetime')assert.ok(new URL(p.url()).searchParams.get('offer')==='lifetime');
  if(expected==='pro'){assert.equal(new URL(p.url()).searchParams.get('plan'),'pro');assert.equal(await p.getByRole('button',{name:'Confirm plan request'}).isDisabled(),true);}
 }
 signed=false;await p.goto(origin+'/account?next=%2Feditor');await p.getByRole('button',{name:'Continue with Google',exact:true}).click();await p.getByRole('link',{name:'Complete Google sign-in'}).click();await p.getByRole('heading',{name:'Your writing workspace is a Pro feature'}).waitFor();assert.equal(intent,'editor');assert.equal(new URL(p.url()).pathname,'/editor');assert.equal(JSON.parse(await p.evaluate(()=>localStorage.getItem('uno-writing-identity'))).id,owner);
 assert.equal(calls.some(([p,method])=>method==='POST'&&(p==='/api/subscription/change'||p==='/api/subscription/lifetime')),false,'OAuth never starts a payment automatically');
 signed=false;cancel=true;await p.goto(origin+'/account?offer=lifetime');await p.getByRole('button',{name:'Continue with Google',exact:true}).click();await p.getByRole('link',{name:'Complete Google sign-in'}).click();await p.getByRole('status').filter({hasText:'Google sign-in was canceled.'}).waitFor();assert.equal(new URL(p.url()).searchParams.get('offer'),'lifetime');assert.ok(!p.url().includes('oauth='));cancel=false;
 startFails=true;await p.getByRole('button',{name:'Continue with Google',exact:true}).click();await p.getByText('Google sign-in is not available yet. Please use email and password.',{exact:true}).waitFor();assert.equal(await p.locator('input[type=password]').isEnabled(),true);startFails=false;
 enabled=false;await p.reload();await p.getByText('Google sign-in isn’t available yet. Email sign-in is available below.').waitFor();assert.equal(await p.getByRole('button',{name:'Continue with Google',exact:true}).isDisabled(),true);
 await p.goto(origin+'/account?mode=recovery');assert.equal(await p.getByRole('button',{name:'Continue with Google',exact:true}).count(),0);
 enabled=true;await p.goto(origin+'/account?plan=pro');await p.getByRole('button',{name:'Continue with Google',exact:true}).waitFor();
 if(process.env.GOOGLE_SCREENSHOTS)fs.mkdirSync(process.env.GOOGLE_SCREENSHOTS,{recursive:true});
 for(const width of [320,390,768,1440]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);if(process.env.GOOGLE_SCREENSHOTS)await p.screenshot({path:path.join(process.env.GOOGLE_SCREENSHOTS,'google-'+width+'.png'),fullPage:true});}
 if(process.env.AXE_SCRIPT){await p.addScriptTag({path:process.env.AXE_SCRIPT});const v=await p.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(v,[]);}
 assert.deepEqual(errors,[]);console.log('PASS Google OAuth browser fixtures: signup/signin, monthly/lifetime/editor intent, successful callback and cache reset, no automatic purchases/Pro grant, canceled provider, unavailable/recovery/email fallback, URL cleanup, 320–1440px, WCAG, no browser errors.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
