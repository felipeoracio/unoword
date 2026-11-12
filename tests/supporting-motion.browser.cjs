/** Actual production UI, isolated non-sensitive profile/progress/reward/billing responses. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const owner='00000000-0000-4000-8000-000000000001';
exports.fixture=async(context,origin)=>{
 const state={calls:[],answers:new Map(),paid:true,words:742,failProfile:false,holdProfile:false,releaseProfile:null,claimable:null,claims:0,
  preferences:{user_id:owner,revision:1,enabled:true,celebrations:false,widget:true,showcase:[]},connected:false,active:false,pending:null,holdVerify:false,releaseVerify:null};
 const achievement={id:'first',name:'First Words',description:'A meaningful beginning.',category:'words',metric:'words',tier:'bronze',badge_image:null,requirement:100,progress:100,unlocked:true,earned_on:'2026-11-10',awarded_at:'2026-11-10T12:00:00Z',active:true};
 const projects=require('./helpers/project-fixture.cjs').projectsFixture(()=>owner,()=>[]);
 const questions=[{id:'types',title:'What do you enjoy writing?',title_es:'¿Qué te gusta escribir?',multiple:true,options:[{id:'memoir',label:'Memoir',label_es:'Memorias'},{id:'fiction',label:'Fiction',label_es:'Ficción'}]},
  {id:'rhythm',title:'When do you like to write?',title_es:'¿Cuándo te gusta escribir?',multiple:false,options:[{id:'morning',label:'Morning',label_es:'Por la mañana'}]}];
 await context.route(origin+'/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),key=url.pathname.slice(4),method=request.method(),body=request.postData()?JSON.parse(request.postData()):null;
  state.calls.push({key,method,body});let value,status=200;
  if(key==='/auth/me')value={id:owner,email:'writer@example.com',plan:state.paid?'pro':'free',ai_access:state.paid};
  else if(key==='/auth/refresh')value={authenticated:true};
  else if(key==='/product')value={name:'UnoWord',billing_available:false,plans:[],features:[],chrome_store_url:null};
  else if(key==='/onboarding')value={version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
  else if(key==='/subscription')value={user_id:owner,plan:state.paid?'pro':'free',status:'active',managed_by_stripe:true,billing_available:false,trial_eligible:false,period_end:'2026-12-10T00:00:00Z',cancel_at_period_end:false};
  else if(key==='/subscription/substack')value={user_id:owner,configured:true,available:true,connected:state.connected,active:state.active,access_enabled:true,subscriptions:state.connected?[{masked_email:'w…@example.com',status:'active',active:true,paid_through:'2026-12-10T00:00:00Z',cancel_at_period_end:false,verified_at:'2026-11-10T12:00:00Z'}]:[],pending_request:state.pending};
  else if(key.startsWith('/subscription/substack/')){
   assert.equal(body.expected_user_id,owner);
   if(key.endsWith('/connect')){state.pending={id:'proof',status:'pending',expires_at:'2026-11-13T00:00:00Z',masked_email:'w…@example.com'};value={request_id:'proof'};}
   else if(key.endsWith('/verify')){
    if(state.holdVerify)await new Promise(resolve=>state.releaseVerify=resolve);
    if(body.code!=='12345678'){status=400;value={detail:'substack_verification_invalid'};}
    else{state.connected=state.active=true;state.pending=null;value={connected:true};}
   }else if(key.endsWith('/disconnect')){state.connected=state.active=false;value={connected:false,other_subscriptions_preserved:true};}
   else if(key.endsWith('/cancel')){state.pending=null;value={canceled:true};}
   else throw Error('Unexpected Substack write '+key);
  }else if(key==='/rewards')value={user_id:owner,enabled:state.preferences.enabled,language:url.searchParams.get('language')==='es'?'es':'en',preferences:state.preferences,achievements:[achievement,{...achievement,id:'next',name:'A thousand words',unlocked:false,progress:state.words,requirement:1000}],totals:{words:state.words,sessions:2,seconds:1200,goals:0,streak:2},journey:{first_writing_day:'2026-11-10',first_goal_day:null,first_document_day:null},personal_milestones:[]};
  else if(key==='/rewards/preferences'){assert.equal(body.expected_user_id,owner);assert.equal(body.revision,state.preferences.revision);Object.assign(state.preferences,body,{revision:body.revision+1});value=state.preferences;}
  else if(key==='/rewards/celebrations/claim'){assert.equal(body.expected_user_id,owner);state.claims++;value={achievement_id:state.claimable};state.claimable=null;}
  else if(key==='/workspace/projects/profile/questions')value=questions;
  else if(key==='/workspace/projects/profile/answers')value=[...state.answers.values()];
  else if(key.startsWith('/workspace/projects/profile/answers/')){
   assert.equal(body.expected_user_id,owner);
   if(state.holdProfile)await new Promise(resolve=>state.releaseProfile=resolve);
   if(state.failProfile){status=503;value={detail:'unavailable'};}
   else{value={...body,question_id:key.split('/').pop(),revision:body.revision+1};state.answers.set(value.question_id,value);}
  }else if(key.startsWith('/workspace/projects')){const response=projects(key,method,body);value=response.value;status=response.status;}
  else if(key==='/progress/preferences')value={user_id:owner,revision:1,daily_goal:1000,timezone:'America/Chicago',language:'en',themes:['nature']};
  else if(key==='/progress/summary')value={user_id:owner,reportingDate:'2026-11-10',timezone:'America/Chicago',dailyWordCount:state.words,dailyGoal:1000,dailyActiveWritingSeconds:1200,lifetimeActiveWritingSeconds:7200,lifetimeWordCount:12860,displayedStreak:20,updatedAt:'2026-11-10T12:00:00Z',sessions:[{id:'session',source:'editor',status:'paused',active_seconds:900}]};
  else if(key==='/progress/streak')value={user_id:owner,displayedStreak:20,hasUnlimitedStreakAccess:state.paid,timezone:'America/Chicago',asOf:'2026-11-10T12:00:00Z'};
  else if(key==='/progress/statistics'){
   const range=url.searchParams.get('range'),keys=range==='today'?['2026-11-10']:range==='year'?['2026-10-01','2026-11-01']:['2026-11-08','2026-11-09','2026-11-10'];
   value={user_id:owner,range,timezone:'America/Chicago',longestSessionWords:500,totalWords:state.words+100,activeWritingSeconds:1800,sessionCount:3,buckets:keys.map((key,i)=>({key,label:key,words:i===keys.length-1?state.words:50,activeWritingSeconds:i===keys.length-1?1200:300,sessions:1}))};
  }else if(key==='/ai/usage/summary')value={user_id:owner,version_id:'v2',version_name:'Pro',remaining:10,daily_limit:10,used_today:0,pending_today:0,timezone:'America/Chicago',date:'2026-11-10',daily_reset_at:'2026-11-11T06:00:00Z',monthly_reset_at:'2026-12-01T06:00:00Z',warning_percent:80,legacy_shared:false,suggestions_monthly_limit:200,suggestions_monthly_used:0,suggestions_monthly_pending:0,suggestions_monthly_remaining:200,guidance_monthly_limit:30,guidance_monthly_used:0,guidance_monthly_pending:0,guidance_monthly_remaining:30};
  else throw Error('Unexpected supporting request '+method+' '+key);
  await route.fulfill({status,json:value});
 });
 return state;
};
exports.instrument=()=>{
 window.__cues=[];
 const original=Element.prototype.animate;
 Element.prototype.animate=function(frames,options){const animation=original.call(this,frames,options);window.__cues.push({element:this,animation,frames,options});return animation;};
};
async function main(){
 const out=path.resolve('tests/artifacts/supporting-motion');fs.mkdirSync(out,{recursive:true});
 const server=await require('./helpers/production-fixture-server.cjs').start();
 const browser=await chromium.launch({headless:process.env.SUPPORT_HEADED!=='1',executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100},hasTouch:true,reducedMotion:'no-preference',recordVideo:process.env.SUPPORT_RECORD_VIDEO==='1'?{dir:path.join(out,'video'),size:{width:1440,height:1100}}:undefined});
  await context.addInitScript(exports.instrument);await context.addInitScript(()=>{if(!localStorage.getItem('uno-writing-theme'))localStorage.setItem('uno-writing-theme','light');if(!localStorage.getItem('uno-writing-language'))localStorage.setItem('uno-writing-language','en');});
  const fixture=await exports.fixture(context,server.origin),page=await context.newPage(),errors=[],results=[];
  page.on('pageerror',error=>errors.push(error.message));const pass=name=>{results.push({name,result:'passed'});console.log('PASS '+name);};
  const cues=selector=>page.locator(selector).evaluate(el=>window.__cues.filter(row=>row.element===el).length);
  const idle=()=>page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
  const refetch=async endpoint=>{await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api'+endpoint&&response.request().method()==='GET'),page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')))]);};
  const rewardSetting=async(label,checked)=>{
   const control=page.getByLabel(label,{exact:true});
   if(await control.isChecked()!==checked)await control.click();
   await page.waitForFunction(([text,value])=>[...document.querySelectorAll('.reward-toggle')].find(label=>label.textContent.trim()===text)?.querySelector('input').checked===value,[label,checked]);
  };
  await page.goto(server.origin+'/library?view=profile');const profile=page.getByRole('region',{name:'Guided Writing Profile'});
  await profile.getByText('What do you enjoy writing?',{exact:true}).waitFor();await idle();
  await profile.getByLabel('Other / Write my own answer',{exact:true}).waitFor();
  const custom=profile.locator('textarea').first();await custom.evaluate(el=>window.__profileInput=el);
  assert.ok((await profile.getByRole('button',{name:'Save & continue',exact:true}).boundingBox()).height>=44);
  const firstCount=await cues('.uw-guided-question');await profile.getByLabel('Memoir',{exact:true}).check();await custom.pressSequentially('Travel reflections');
  assert.equal(await custom.evaluate(el=>el===window.__profileInput),true);assert.equal(await cues('.uw-guided-question'),firstCount);
  assert.equal(await custom.inputValue(),'Travel reflections');assert.equal(await profile.getByRole('checkbox',{name:'Memoir',exact:true}).isChecked(),true);
  fixture.holdProfile=true;await profile.getByRole('button',{name:'Save & continue',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.uw-guided-profile button:last-child')?.disabled);
  assert.equal(await profile.getByText('What do you enjoy writing?',{exact:true}).count(),1);assert.equal(await profile.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);
  await page.waitForTimeout(300);assert.ok(fixture.releaseProfile);fixture.holdProfile=false;fixture.releaseProfile();
  await profile.getByText('When do you like to write?',{exact:true}).waitFor();assert.ok(await cues('.uw-guided-question')>firstCount);
  assert.equal(fixture.answers.get('types').custom_answer,'Travel reflections');await profile.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await custom.inputValue(),'Travel reflections');
  await profile.getByRole('button',{name:'Skip',exact:true}).click();await profile.getByRole('radio',{name:'Morning',exact:true}).check();
  await custom.fill('Late evenings');assert.equal(await profile.getByRole('radio',{name:'Morning',exact:true}).isChecked(),false);
  await context.setOffline(true);await profile.getByLabel('Additional notes (optional)',{exact:true}).fill('A private local note');await profile.getByRole('button',{name:'Save & continue',exact:true}).click();
  await profile.getByRole('heading',{name:'Your Writing Profile is ready',exact:true}).waitFor();await profile.getByText('Saved on this device; synchronizing with your account.',{exact:true}).waitFor();
  await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine);await profile.getByRole('button',{name:'Edit my answers',exact:true}).click();await profile.getByRole('button',{name:'Skip',exact:true}).click();assert.equal(await custom.inputValue(),'Late evenings');
  await profile.getByRole('button',{name:'Save & continue',exact:true}).click();await profile.getByRole('heading',{name:'Your Writing Profile is ready',exact:true}).waitFor();
  assert.equal(fixture.answers.get('rhythm').notes,'A private local note');await page.reload();await profile.getByRole('button',{name:'Skip',exact:true}).click();assert.equal(await custom.inputValue(),'Late evenings');
  await profile.screenshot({path:path.join(out,'profile-desktop.png')});
  pass('Actual profile choices/text stay mounted while typing; held save, Back, offline queue/reconnect and reload preserve both answers');

  await page.goto(server.origin+'/progress');await page.getByRole('combobox',{name:'Chart measure',exact:true}).waitFor();await idle();
  const trendCount=await cues('.uw-progress-trend-card'),chartCount=await cues('.uw-progress-chart');
  await page.getByRole('combobox',{name:'Chart measure',exact:true}).selectOption('time');assert.ok(await cues('.uw-progress-chart')>chartCount);
  fixture.words=800;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.uw-progress-goal-total strong')?.textContent==='800');
  assert.equal(await cues('.uw-progress-trend-card'),trendCount);assert.equal(await page.getByRole('combobox',{name:'Chart measure',exact:true}).inputValue(),'time');
  assert.equal(await page.locator('.uw-progress-goal-bar span').evaluate(el=>el.getAnimations().length),0);
  assert.equal(await page.getByTestId('daily-writing-time').textContent(),'00:20:00');assert.equal(await page.getByTestId('lifetime-writing-time').textContent(),'02:00:00');
  await page.getByRole('button',{name:'This month',exact:true}).click();await page.getByRole('heading',{name:'This month',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.uw-progress-trend-card')?.getAnimations().length>0);
  await page.getByText('View chart data table',{exact:true}).click();assert.equal(await page.locator('.uw-progress-data table').count(),1);assert.equal(fixture.claims,0);
  await page.locator('.uw-progress-history').screenshot({path:path.join(out,'progress-desktop.png')});
  pass('Real chart/range choices cue confirmed data; refresh keeps metrics immediate and does not replay or claim rewards');

  await page.goto(server.origin+'/rewards');await page.locator('.reward-card').first().waitFor();assert.equal(await page.locator('.reward-celebration').count(),0);
  fixture.claimable='first';await rewardSetting('Achievement Celebrations',true);const toast=page.locator('.reward-celebration');await toast.waitFor();
  assert.equal(await toast.locator('.reward-badge').evaluate(el=>getComputedStyle(el).animationDuration),'0.65s');
  const dismiss=toast.getByRole('button',{name:'Close',exact:true});const box=await dismiss.boundingBox();assert.ok(box.width>=44&&box.height>=44);
  const claimCount=fixture.claims;await dismiss.click();await toast.waitFor({state:'hidden'});assert.equal(fixture.claims,claimCount);
  await refetch('/rewards');assert.equal(await toast.count(),0,'Polling does not replay a consumed celebration');
  await rewardSetting('Enable Writing Rewards',false);await page.getByText('Your achievements stay saved while rewards are off.',{exact:true}).waitFor();assert.equal(await page.locator('.reward-card').count(),0);
  await rewardSetting('Enable Writing Rewards',true);await page.locator('.reward-card').first().waitFor();assert.equal(await toast.count(),0);
  pass('Only claimed earned rewards celebrate; dismissal, polling, disabled rewards and native preferences preserve quiet history');

  await page.goto(server.origin+'/settings');const substack=page.getByRole('region',{name:'Subscription · Connect Substack',exact:true});await substack.getByLabel('Substack payment email',{exact:true}).waitFor();await idle();
  const codeBefore=await cues('.uw-substack');await substack.getByLabel('Substack payment email',{exact:true}).fill('writer@example.com');assert.equal(await cues('.uw-substack'),codeBefore);
  await substack.getByRole('button',{name:'Connect Subscription',exact:true}).click();const code=substack.getByLabel('Eight-digit verification code',{exact:true});await code.waitFor();
  assert.ok(await cues('.uw-substack')>codeBefore);await idle();const pendingCues=await cues('.uw-substack');await code.fill('00000000');await substack.getByRole('button',{name:'Verify Email',exact:true}).click();
  await substack.getByRole('alert').getByText(/invalid/).waitFor();assert.equal(await cues('.uw-substack'),pendingCues);assert.equal(fixture.active,false);
  fixture.holdVerify=true;await code.fill('12345678');await substack.getByRole('button',{name:'Verify Email',exact:true}).click();await page.waitForTimeout(300);
  assert.equal(await substack.getByText('Subscription Connected',{exact:true}).count(),0);assert.equal(fixture.active,false);fixture.holdVerify=false;fixture.releaseVerify();
  await substack.getByRole('heading',{name:'Subscription Connected',exact:true}).waitFor();assert.ok(await cues('.uw-substack')>pendingCues);await idle();const connectedCues=await cues('.uw-substack');
  await refetch('/subscription/substack');assert.equal(await cues('.uw-substack'),connectedCues);
  assert.equal(await page.getByRole('button',{name:'Manage subscription',exact:true}).isDisabled(),true);
  await substack.screenshot({path:path.join(out,'subscription-desktop.png')});
  pass('Connection states stay truthful through invalid code/held verification; typing and polling do not replay; Stripe confirmation remains explicit');

  async function audit(){if(!process.env.AXE_SCRIPT)throw Error('AXE_SCRIPT required');if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:process.env.AXE_SCRIPT});const violations=await page.evaluate(async()=>(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(row=>({id:row.id,nodes:row.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})));assert.deepEqual(violations,[]);}
  for(const [route,selector] of [['/library?view=profile','.uw-guided-profile legend'],['/progress','.uw-progress-chart'],['/rewards','.reward-card'],['/settings','.uw-substack-status']]){
   await page.goto(server.origin+route);await page.locator(selector).first().waitFor();
   for(const width of [1440,1024,768,390,320]){
    await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await audit();
   }
  }
  await page.getByRole('button',{name:'Use dark theme',exact:true}).click();await page.getByRole('combobox',{name:'Interface language',exact:true}).selectOption('es');await page.getByRole('heading',{name:'Tus ajustes',exact:true}).waitFor();await audit();
  await page.screenshot({path:path.join(out,'settings-mobile-dark-es.png')});
  await page.getByRole('combobox',{name:'Idioma de la interfaz',exact:true}).selectOption('en');
  for(const [route,selector] of [['/library?view=profile','.uw-guided-profile legend'],['/progress','.uw-progress-chart'],['/rewards','.reward-card']]){
   await page.goto(server.origin+route);await page.locator(selector).first().waitFor();await audit();
  }
  fixture.claimable='first';await rewardSetting('Achievement Celebrations',false);await rewardSetting('Achievement Celebrations',true);await toast.waitFor();await audit();await toast.screenshot({path:path.join(out,'reward-dark-mobile.png')});await toast.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(server.origin+'/library?view=profile',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__cues.some(row=>row.element.classList.contains('uw-guided-question')&&row.animation.playState==='running'));
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.uw-guided-question').evaluate(el=>el.getAnimations().length),0);
  await profile.getByRole('button',{name:'Skip',exact:true}).click();assert.equal(await page.locator('.uw-guided-question').evaluate(el=>el.getAnimations().length),0);
  await page.goto(server.origin+'/progress');await page.getByRole('combobox',{name:'Chart measure',exact:true}).selectOption('time');assert.equal(await page.locator('.uw-progress-chart').evaluate(el=>el.getAnimations().length),0);
  await page.goto(server.origin+'/rewards');await page.locator('.reward-card').first().waitFor();fixture.claimable='first';await rewardSetting('Achievement Celebrations',false);await rewardSetting('Achievement Celebrations',true);await toast.waitFor();assert.equal(await toast.locator('.reward-badge').evaluate(el=>el.getAnimations().length),0);await toast.getByRole('button',{name:'Close',exact:true}).click();
  pass('Five widths, dark/Spanish settings, axe, touch-sized dismissal and reduced-motion profile/chart/celebration remain functional');
  assert.equal(fixture.calls.some(row=>row.key==='/workspace/activity'||row.key==='/workspace/assistant'||row.key==='/subscription/portal'||row.key==='/subscription/change'||row.key==='/ai/profile'&&row.method!=='GET'),false);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'functional.json'),JSON.stringify({scope:'Actual production React UI, native inputs, IndexedDB and isolated synthetic profile/progress/reward/verification APIs. Not live Supabase/providers, earning evaluation, email, billing or devices.',results},null,2)+'\n');
  if(process.env.SUPPORT_PAUSE==='1'){
   await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1100});
   await page.goto(server.origin+'/library?view=profile');await page.pause();
  }
  await context.close();
 }finally{await browser.close();await server.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
