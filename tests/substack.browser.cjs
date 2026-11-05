/** Production bundle, synthetic HTTP/email fixtures. No mail, charges or live changes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const origin=process.env.WRITING_TEST_ORIGIN||'http://127.0.0.1:4186';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});context.setDefaultTimeout(15000);
 let currentOwner=owner,connected=false,active=false,nativeLifetime=false,pending=null,failVerifyOnce=true,emails=[],writes=[],csvStaged=false;
 const errors=[];
 await context.route(origin+'/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),key=url.pathname.slice(4),method=req.method(),body=req.postData()?JSON.parse(req.postData()):null;
  try{
   let value;
   if(key==='/auth/me')value={id:currentOwner,email:'login@example.com',plan:active||nativeLifetime?'pro':'free',ai_access:active||nativeLifetime};
   else if(key==='/product')value={name:'UnoWord',billing_available:false,chrome_store_url:null,plans:[{id:'pro',features:{writing_editor:true,new_topic:true}}],features:[]};
   else if(key==='/subscription')value={user_id:currentOwner,plan:active||nativeLifetime?'pro':'free',status:active||nativeLifetime?'active':'inactive',billing_available:false,managed_by_stripe:false,trial_eligible:false,access_source:nativeLifetime?'stripe_lifetime':active?'substack_stripe':null};
   else if(key==='/rewards')value={user_id:currentOwner,enabled:false,language:'en',preferences:{user_id:currentOwner,enabled:false,celebrations:false,widget:false,showcase:[],revision:0},achievements:[]};
   else if(key==='/progress/streak')value={user_id:currentOwner,displayedStreak:0,hasUnlimitedStreakAccess:active||nativeLifetime,streakLimitReached:false,timezone:'UTC',asOf:new Date().toISOString()};
   else if(key==='/onboarding')value={version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
   else if(key==='/ai/usage/summary')return route.fulfill({status:503,json:{detail:'fixture_not_using_ai'}});
   else if(key==='/subscription/substack')value={user_id:currentOwner,configured:true,available:true,connected,active,access_enabled:true,subscriptions:connected?[{masked_email:'s…@example.com',status:'active',active,paid_through:'2030-01-01T00:00:00Z',cancel_at_period_end:false,verified_at:new Date().toISOString()}]:[],pending_request:pending};
   else if(key.startsWith('/subscription/substack/')){
    writes.push([key,body]);if(body.expected_user_id!==currentOwner)return route.fulfill({status:409,json:{detail:'account_changed'}});
    if(key.endsWith('/connect')){assert.equal(body.email,'substack.reader@example.com');pending={id:'00000000-0000-4000-8000-000000000003',status:'pending',expires_at:new Date(Date.now()+600000).toISOString(),masked_email:'s…@example.com'};emails.push({recipient:body.email,code:'12345678'});value={request_id:pending.id,status:'verification_sent'};}
    else if(key.endsWith('/verify')){if(body.code!=='12345678')return route.fulfill({status:400,json:{detail:'substack_verification_invalid'}});pending.status='verified';if(failVerifyOnce){failVerifyOnce=false;return route.fulfill({status:502,json:{detail:'substack_stripe_unavailable'}});}connected=active=true;pending=null;value={connected:true};}
    else if(key.endsWith('/finish')){assert.equal(pending.status,'verified');connected=active=true;pending=null;value={connected:true};}
    else if(key.endsWith('/cancel')){pending=null;value={canceled:true};}
    else if(key.endsWith('/disconnect')){connected=active=false;pending=null;value={connected:false,other_subscriptions_preserved:true};}
    else if(key.endsWith('/reverify'))value={connected,active};
    else throw Error('Unknown linking action');
   }else if(key==='/admin/me')value={email:'admin-fixture@example.com'};
   else if(key==='/admin/overview')return route.fulfill({status:503,json:{detail:'isolated_fixture'}});
   else if(key==='/admin/integrations/substack')value={configured:true,enabled:false,live_approval:false,mode:'live',account_id:'acct_publication',publication_url:'https://unoword.substack.com',email_configured:true,connection:{ready:false,account_verified:true,webhook_destination_verified:true,webhook_delivery_verified:false},last_successful_sync:null,linked_subscribers:0,active_entitlements:0,pending_verifications:pending?1:0,failed_events:[],required_events:[],csv_review:csvStaged?[{row_hash:'a'.repeat(64),masked_email:'s…@example.com',claimed_status:'paid',review_status:'needs_verification'}]:[]};
   else if(key==='/admin/integrations/substack/reconcile')value={ready:false,grants_created:0};
   else if(key==='/admin/integrations/substack/csv'){csvStaged=true;value={staged:1,grants_created:0};}
   else throw Error('Unhandled fixture '+method+' '+key);
   return route.fulfill({json:value});
  }catch(e){errors.push(e.message);return route.fulfill({status:503,json:{detail:'fixture_error'}});}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/account');const card=page.locator('.uw-substack');await card.getByRole('button',{name:'Connect Subscription',exact:true}).waitFor();assert.match(await page.locator('.uw-account-plan').textContent(),/Free/);
 await card.getByLabel('Substack payment email',{exact:true}).fill('substack.reader@example.com');await card.getByRole('button',{name:'Connect Subscription',exact:true}).click();await card.getByLabel('Eight-digit verification code').waitFor();assert.equal(emails.length,1);assert.equal(active,false,'email request/matching never grants Pro');
 await card.getByLabel('Eight-digit verification code').fill('00000000');await card.getByRole('button',{name:'Verify Email',exact:true}).click();await card.getByRole('alert').getByText(/code is invalid/).waitFor();assert.equal(active,false);
 await card.getByLabel('Eight-digit verification code').fill('12345678');await card.getByRole('button',{name:'Verify Email',exact:true}).click();await card.getByRole('button',{name:'Retry Connection',exact:true}).waitFor();assert.equal(emails.length,1,'provider retries reuse proof instead of emailing again');
 await card.getByRole('button',{name:'Retry Connection',exact:true}).click();await card.getByText('Active Pro Access',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.uw-account-plan').textContent.includes('Pro'));assert.equal(emails.length,1);
 const out=process.env.SUBSTACK_SCREENSHOTS||path.resolve('tests/artifacts/substack');fs.mkdirSync(out,{recursive:true});
 for(const width of [1440,768,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await card.screenshot({path:path.join(out,'connect-'+width+'.png')});}
 if(process.env.AXE_SCRIPT){await page.addScriptTag({path:process.env.AXE_SCRIPT});assert.deepEqual(await page.evaluate(async()=>(await axe.run(document.querySelector('.uw-substack'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)),[]);}
 // Canceling a new proof must not disconnect an existing linked subscription.
 await card.getByLabel('Substack payment email',{exact:true}).fill('substack.reader@example.com');await card.getByRole('button',{name:'Connect Subscription',exact:true}).click();await card.getByRole('button',{name:'Cancel verification',exact:true}).click();await card.getByRole('button',{name:'Connect Subscription',exact:true}).waitFor();assert.equal(connected,true);assert.equal(writes.at(-1)[0],'/subscription/substack/cancel');
 // Disconnecting Substack preserves an independent Lifetime subscription.
 nativeLifetime=true;await page.reload();await card.getByRole('button',{name:'Disconnect Subscription',exact:true}).click();await card.getByRole('button',{name:'Connect Subscription',exact:true}).waitFor();assert.equal(connected,false);assert.match(await page.locator('.uw-account-plan').textContent(),/Pro/);
 currentOwner=other;nativeLifetime=false;await page.reload();await card.getByRole('button',{name:'Connect Subscription',exact:true}).waitFor();assert.equal(await card.getByText('Subscription Connected',{exact:true}).count(),0);
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/admin');await page.getByTestId('nav-integrations').click();await page.getByRole('heading',{name:'Integrations · Substack',exact:true}).waitFor();await page.getByRole('checkbox',{name:'I confirm this integration access change.'}).check();assert.equal(await page.getByRole('button',{name:'Enable verified access',exact:true}).isDisabled(),true,'live activation cannot be enabled without approval');
 await page.getByLabel('Import Substack CSV',{exact:false}).setInputFiles({name:'subscribers.csv',mimeType:'text/csv',buffer:Buffer.from('email,status\nsubstack.reader@example.com,paid\n')});await page.getByRole('button',{name:'Verify with Stripe',exact:true}).waitFor();assert.equal(active,false);assert.match(await page.getByRole('status').textContent(),/grants_created/);
 await page.getByTestId('admin-lang-toggle').click();await page.getByRole('heading',{name:'Integraciones · Substack',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Activar acceso verificado',exact:true}).isDisabled(),true);
 assert.deepEqual(errors,[]);console.log('PASS production bundle with synthetic fixtures: different billing/login email, email is not Pro, invalid code, verified-proof recovery without resend, active Pro refresh, expiry display, cancel-vs-disconnect, Lifetime preservation, account switching, 1440/768/320px, WCAG, disabled live activation, CSV staging and Spanish admin.');
}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
