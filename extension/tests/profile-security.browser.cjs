/** Real popup and worker, isolated Chrome/HTTP fixtures (no email or paid model calls). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../tests/node_modules/playwright');
const root = path.resolve(__dirname, '..');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:420,height:600}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let current='writer-a',pro=true,signedIn=true,failSave=false,profileGate=null,billingEnabled=false;const openedUrls=[];
  const profiles={
   'writer-a':{id:'profile-a',user_id:'writer-a',writing_goal:'Educational urban gardening posts',writing_style:'encouraging',audience:'apartment gardeners',primary_topics:['gardening'],current_projects:[],favorite_subjects:[],avoid_topics:[],personal_context:'A private memory',ai_preferences:{prompt_themes:['nature','ideas']}},
   'writer-b':{id:'profile-b',user_id:'writer-b',writing_goal:'Science fiction stories',ai_preferences:{prompt_themes:['science']}},
  };
  const storage={wc_settings:{langChosen:true,language:'en',plan:'pro',themes:['ideas']},wc_state:{active:false,typedWords:0,pastedWords:0},wc_history:[],wc_account:{authenticated:true,userId:current,email:'writer-a@example.com',aiAccess:true,plan:'pro',online:true}};
  const requests=[];let listener;
  const chrome={storage:{local:{get:async k=>({[k]:storage[k]}),set:async v=>Object.assign(storage,v)}},runtime:{onInstalled:{addListener(){}},onMessage:{addListener:l=>listener=l},sendMessage:async()=>{}},tabs:{query:async()=>[],create:async tab=>{openedUrls.push(tab.url);return {id:10};}}};
  async function fixture(url,options={}){
   const route=new URL(url).pathname.replace('/api',''),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
   requests.push({route,method,body});let result,status=200;
   if(route==='/auth/me'){result=signedIn?{id:current,email:current+'@example.com',plan:pro?'pro':'free',ai_access:pro}:{detail:'Authentication required'};if(!signedIn)status=401;}
   else if(route==='/auth/refresh'){status=401;result={detail:'No refresh'};}
   else if(route==='/auth/login'){signedIn=true;result={authenticated:true,user:{id:current,email:current+'@example.com'}};}
   else if(route==='/auth/logout'){signedIn=false;result={};}
   else if(route==='/auth/security')result={user_id:current,email:current+'@example.com',email_verified:true,password_identity:true,pending_email:null};
   else if(route==='/auth/password/change')result={status:'password_updated',other_sessions_revoked:true};
   else if(route==='/auth/email/change')result={status:'verification_required'};
   else if(route==='/auth/recovery')result={status:'if_account_exists_check_email'};
   else if(route==='/subscription/change'){if(billingEnabled){result=body.target_plan==='free'?{url:'https://billing.stripe.com/p/session/fixture',destination:'portal'}:{url:'https://checkout.stripe.com/c/pay/fixture',destination:'checkout'};}else{status=503;result={detail:'billing_unavailable'};}}
   else if(route==='/ai/profile'){
    const owner=current;
    if(method==='PUT'){
     if(failSave){status=502;result={detail:'unavailable'};}else{assert.equal(body.expected_user_id,owner);Object.assign(profiles[owner],body);result=profiles[owner];}
    }else{const snapshot=structuredClone(profiles[owner]);if(profileGate)await profileGate;result=snapshot;}
   }
   else if(['/documents','/links','/ai/ideas','/ai/idea-options','/ai/memories'].includes(route))result=[];
   else if(route==='/ai/usage/summary')result={daily_requests:0,daily_request_limit:100};
   else throw Error('Unexpected route '+method+' '+route);
   return new Response(JSON.stringify(result),{status,headers:{'content-type':'application/json'}});
  }
  const worker=vm.createContext({chrome,crypto:webcrypto,fetch:fixture,AbortController,FormData,TextEncoder,TextDecoder,URL,Date,Intl,console,setTimeout,clearTimeout});worker.self=worker;
  worker.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),worker,{filename:file}));
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),worker);
  const message=msg=>new Promise(resolve=>listener(msg,{},resolve));
  await page.exposeFunction('backgroundMessage',message);
  await page.addInitScript(()=>{window.chrome={runtime:{onMessage:{addListener(){}},getManifest:()=>({version:'test'}),sendMessage:(msg,cb)=>window.backgroundMessage(msg).then(cb)}};});
  await page.route('http://popup.test/**',async r=>{const file=path.join(root,new URL(r.request().url()).pathname);await r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});});
  await page.route('https://unoword.vercel.app/api/**',async r=>{const response=await fixture(r.request().url(),{method:r.request().method(),body:r.request().postData()});await r.fulfill({status:response.status,body:await response.text(),contentType:'application/json',headers:{'access-control-allow-origin':'http://popup.test','access-control-allow-credentials':'true'}});});
  await page.goto('http://popup.test/popup/popup.html');await page.click('#nav-library');
  await page.waitForFunction(()=>!document.querySelector('#writing-profile-form').hidden);
  assert.equal(await page.locator('#writing-profile-goal').inputValue(),'Educational urban gardening posts');
  assert.equal(await page.locator('#writing-profile-fields input,#writing-profile-fields textarea').count(),8);
  assert.equal(await page.locator('#writing-profile-themes input:checked').count(),2);
  await page.fill('#writing-profile-goal','Cancelled edit');await page.click('#writing-profile-cancel');
  assert.equal(await page.locator('#writing-profile-goal').inputValue(),'Educational urban gardening posts');
  await page.fill('#writing-profile-goal','Astronomy for young adults');await page.fill('#writing-profile-topics','astronomy, science fiction');
  await page.fill('#writing-profile-context','');await page.locator('#writing-profile-themes input[value="nature"]').uncheck();
  await page.locator('#writing-profile-themes input[value="science"]').check();
  await page.click('#writing-profile-save');await page.waitForFunction(()=>document.querySelector('#writing-profile-status').textContent.includes('Profile saved'));
  assert.equal(profiles['writer-a'].personal_context,null,'Explicit clear reaches canonical API');
  assert.deepEqual(profiles['writer-a'].primary_topics,['astronomy','science fiction']);
  assert.deepEqual(profiles['writer-a'].ai_preferences.prompt_themes,['ideas','science']);
  await page.reload();await page.click('#nav-library');await page.waitForFunction(()=>!document.querySelector('#writing-profile-form').hidden);
  assert.equal(await page.locator('#writing-profile-goal').inputValue(),'Astronomy for young adults');
  assert.equal(await page.locator('#writing-profile-context').inputValue(),'');
  failSave=true;await page.fill('#writing-profile-goal','Unsaved draft retained');await page.click('#writing-profile-save');
  await page.waitForFunction(()=>document.querySelector('#writing-profile-status').textContent.includes('could not be saved'));
  assert.equal(await page.locator('#writing-profile-goal').inputValue(),'Unsaved draft retained');failSave=false;
  await page.click('#writing-profile-cancel');
  // Account swaps clear cached answers and late responses cannot overwrite B.
  let release;profileGate=new Promise(resolve=>release=resolve);
  const pending=message({type:'LOAD_MY_PROFILE',expectedUserId:'writer-a'});
  await page.waitForTimeout(30);current='writer-b';await page.evaluate(async()=>{const r=await sendMessage({type:'GET_ACCOUNT'});updateSuggestionAccount(r.account);});
  release();profileGate=null;assert.equal((await pending).ok,false);
  const swapped=await message({type:'GET_SETTINGS'});assert.equal(swapped.settings.aiProfileDraft.writingGoal,'');
  await page.evaluate(()=>openLibrary('profile'));await page.waitForFunction(()=>!document.querySelector('#writing-profile-form').hidden);
  assert.equal(await page.locator('#writing-profile-goal').inputValue(),'Science fiction stories');
  assert.ok(!JSON.stringify(storage).includes('Astronomy for young adults'));
  // Responsive EN/ES profile and credential forms, at actual popup and narrow previews.
  for(const width of [180,194,320,420])for(const lang of ['en','es']){
   await page.setViewportSize({width,height:600});
   await page.evaluate(lang=>{settings.language=lang;WCi18n.setLang(lang);WCi18n.applyI18n(document);},lang);
   await page.evaluate(()=>openLibrary('profile'));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Profile ${width} ${lang}`);
   await page.evaluate(()=>openSettings());await page.click('#security-change-password');
   await page.fill('#security-current-password','current-password-fixture');await page.fill('#security-new-password','new-password-fixture');await page.fill('#security-confirm-password','new-password-fixture');
   await page.check('#security-show-password');assert.equal(await page.locator('#security-new-password').getAttribute('type'),'text');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Security ${width} ${lang}`);
   await page.click('#security-cancel');assert.equal(await page.locator('#security-current-password').inputValue(),'');
  }
  await page.setViewportSize({width:420,height:600});await page.evaluate(()=>{WCi18n.setLang('en');WCi18n.applyI18n(document);});
  await page.click('#security-change-password');await page.fill('#security-current-password','current-password-fixture');await page.fill('#security-new-password','new-password-fixture');await page.fill('#security-confirm-password','different-password');
  await page.click('#security-submit');assert.equal(requests.filter(r=>r.route==='/auth/password/change').length,0);
  await page.fill('#security-confirm-password','new-password-fixture');await page.click('#security-submit');
  await page.waitForFunction(()=>document.querySelector('#security-status').textContent.includes('Password updated'));
  assert.equal(await page.locator('#security-new-password').inputValue(),'');assert.ok(!JSON.stringify(storage).includes('password-fixture'));
  await page.click('#security-change-email');await page.fill('#security-new-email','changed@example.com');await page.fill('#security-current-password','current-password-fixture');await page.click('#security-submit');
  await page.waitForFunction(()=>document.querySelector('#security-status').textContent.includes('Check both email'));
  assert.equal(await page.locator('#security-email').textContent(),'writer-b@example.com','Pending email does not replace current verified address');
  // Frontend plan flags cannot grant access; server plan changes stay unavailable.
  pro=false;await message({type:'GET_ACCOUNT'});const changed=await message({type:'SET_SETTINGS',settings:{plan:'pro'}});assert.equal(changed.settings.plan,'free');
  await page.evaluate(async()=>{const r=await sendMessage({type:'GET_ACCOUNT'});updateSuggestionAccount(r.account);await openLibrary('profile');});
  assert.ok(await page.locator('#writing-profile-form').isVisible(),'Free profile stays editable');
  assert.equal(await page.locator('#writing-profile-themes input:not(:disabled)').count(),0);
  await page.evaluate(()=>openSettings());await page.click('#account-action');
  await page.evaluate(()=>beginPlanChange('pro'));assert.ok(await page.locator('#account-editor').isVisible());
  await page.fill('#account-email','writer-b@example.com');await page.fill('#account-password','sign-in-fixture');await page.click('#account-sign-in');
  await page.waitForFunction(()=>!document.querySelector('#dialog-confirm').hidden);
  assert.ok((await page.locator('#confirm-body').textContent()).includes('writer-b@example.com'));
  await page.click('#confirm-ok');await page.waitForFunction(()=>document.querySelector('#plan-error').textContent.includes('Billing is currently unavailable'));
  assert.ok(requests.some(r=>r.route==='/subscription/change'&&r.body.expected_user_id==='writer-b'&&r.body.confirmed));
  const final=await message({type:'GET_SETTINGS'});assert.equal(final.settings.plan,'free');
  billingEnabled=true;
  for (const [target, host] of [['pro','checkout.stripe.com'],['free','billing.stripe.com']]) {
   await page.evaluate(target=>beginPlanChange(target),target);
   await page.click('#confirm-ok');
   await page.waitForFunction(()=>document.querySelector('#plan-error').textContent.includes('Stripe opened'));
   assert.equal(new URL(openedUrls.at(-1)).hostname,host);
   assert.equal((await message({type:'GET_SETTINGS'})).settings.plan,'free','Opening Stripe cannot grant Pro locally');
  }
  for (const width of [180,194,320,420]) for (const lang of ['en','es']) {
   await page.setViewportSize({width,height:600});
   await page.evaluate(lang=>{WCi18n.setLang(lang);WCi18n.applyI18n(document);},lang);
   await page.evaluate(()=>beginPlanChange('pro'));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Billing confirmation ${width} ${lang}`);
   await page.evaluate(()=>closeDialogs());
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: canonical profile load/edit/clear/reload/Cancel/error retention; late account-swap protection; Free permissions; secure plan sign-in/confirmation/unavailable; password validation/visibility/clearing; pending email; no credential persistence; EN/ES 180–420px.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
