/** Production web bundle + real PostgreSQL reward evaluation in two browsers. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const root=process.env.PGLITE_ROOT||path.resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite'),{vector}=require(root+'/@electric-sql/pglite-pgvector');
const origin=process.env.WRITING_TEST_ORIGIN||'http://127.0.0.1:4186';
(async()=>{
 const db=new PGlite({extensions:{vector}});let browser;
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension vector with schema extensions;set search_path=public,extensions;`);
  await db.exec(fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,''));
  for(const f of ['20261023010000_writing_workspace.sql','20261023020000_writing_workspace_pro.sql','20261028010000_shared_ai_quota.sql','20261028040000_verified_streak_presentation.sql','20261029010000_session_pause_document_completion.sql','20261030010000_unified_account_writing_sync.sql','20261104010000_personal_writing_rewards.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  const owner=randomUUID(),other=randomUUID();await db.query('insert into auth.users values($1),($2)',[owner,other]);
  const rpc=async(name,...args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows[0].r;
  await rpc('writing_update_preferences',owner,0,JSON.stringify({daily_goal:250,timezone:'UTC',language:'en'}));
  for(let i=0;i<15;i++)await db.query(`insert into writing_activity(id,user_id,source,started_at,typed_words,duration_seconds,sequence,timer) values($1,$2,'extension',now()-($3||' days')::interval,400,0,1,jsonb_build_object('status','ended','active_ms',0,'paused_ms',0,'changed_at',extract(epoch from now())*1000))`,[randomUUID(),owner,i]);
  const errors=[];let paid=true;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
  async function device(who=owner,signed=true){
   const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
   await context.route(origin+'/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.postData()?JSON.parse(req.postData()):{},key=url.pathname.slice(4);
    try {
     if(!signed)return route.fulfill({status:401,contentType:'application/json',body:'{"detail":"unauthenticated"}'});
     let data;
     if(key==='/admin/me')data={email:'admin-fixture@example.com'};
     else if(key==='/admin/overview')return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"isolated_fixture"}'});
     else if(key==='/admin/achievements')data=await rpc('writing_reward_admin_catalog');
     else if(key==='/admin/achievements/backfill')data=await rpc('writing_reward_backfill',body.after,25);
     else if(key.startsWith('/admin/achievements/')){const {revision,...patch}=body;data=await rpc('writing_reward_admin_update',key.split('/').at(-1),revision,JSON.stringify(patch));}
     else if(key==='/auth/me')data={id:who,email:'isolated@example.com',plan:paid?'pro':'free'};
     else if(key==='/rewards')data=await rpc('writing_rewards',who,paid,url.searchParams.get('language')||'auto');
     else if(key==='/rewards/preferences'){assert.equal(body.expected_user_id,who);data=await rpc('writing_reward_settings',who,body.revision,JSON.stringify(body),paid);}
     else if(key==='/rewards/celebrations/claim'){assert.equal(body.expected_user_id,who);data={achievement_id:await rpc('writing_reward_claim',who,paid)};}
     else throw Error('Unhandled reward fixture '+key);
     return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    }catch(e){errors.push(e.message);return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"fixture_error"}'});}
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);await page.goto(origin+'/rewards');return {page,context};
  }
  const a=await device(),b=await device();
  await a.page.getByRole('heading',{name:'Your milestones',exact:true,level:1}).waitFor();await b.page.locator('.reward-card').first().waitFor();
  assert.equal(await a.page.locator('.reward-card').count(),53);assert.equal(await a.page.locator('.reward-celebration').count(),0,'historical backfill is quiet');
  const first=a.page.locator('.reward-card').filter({has:a.page.getByRole('heading',{name:'First Words',exact:true})});
  await first.getByRole('button',{name:'Favorite',exact:true}).click();await a.page.locator('.reward-showcase strong',{hasText:'First Words'}).waitFor();
  await a.page.getByLabel('Enable Writing Rewards',{exact:true}).click();
  await a.page.getByText('Your achievements stay saved while rewards are off.',{exact:true}).waitFor();assert.equal(await a.page.locator('.reward-card').count(),0);
  await b.page.getByText('Your achievements stay saved while rewards are off.',{exact:true}).waitFor();assert.equal(await b.page.locator('.reward-card').count(),0,'settings automatically reach the other browser');
  await a.page.getByLabel('Enable Writing Rewards',{exact:true}).click();await a.page.locator('.reward-showcase strong',{hasText:'First Words'}).waitFor();assert.equal(await a.page.locator('.reward-celebration').count(),0);
  const out=process.env.WRITING_SCREENSHOTS||path.resolve('tests/artifacts/rewards');fs.mkdirSync(out,{recursive:true});
  for(const width of [1440,768,320]){await a.page.setViewportSize({width,height:1000});await a.page.screenshot({path:path.join(out,'rewards-'+width+'.png'),fullPage:true});assert.ok(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scrolling at '+width);}
  if(process.env.AXE_MODULE){await a.page.addScriptTag({path:process.env.AXE_MODULE});const result=await a.page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({html:n.html,reason:n.failureSummary}))}));});assert.deepEqual(result,[]);}
  paid=false;await a.page.reload();await a.page.locator('.reward-card').first().waitFor();assert.equal(await a.page.getByRole('heading',{name:'Two Weeks of Dedication',exact:true}).count(),0);assert.equal(await a.page.getByRole('heading',{name:'Document Completion',exact:true}).count(),0);
  paid=true;await a.page.reload();await a.page.getByRole('heading',{name:'Two Weeks of Dedication',exact:true}).waitFor();
  const pref=await rpc('writing_account_preferences',owner);await rpc('writing_update_preferences',owner,pref.revision,JSON.stringify({language:'es'}));await a.page.reload();await a.page.getByRole('combobox',{name:'Interface language',exact:true}).selectOption('es');await a.page.getByRole('heading',{name:'Tus logros',exact:true,level:1}).waitFor();await a.page.screenshot({path:path.join(out,'rewards-es-320.png'),fullPage:true});assert.ok(await a.page.getByRole('heading',{name:'Primeras palabras',exact:true}).count());
  const c=await device(other);await c.page.locator('.reward-card').first().waitFor();assert.equal(await c.page.getByRole('button',{name:'Favorite',exact:true}).count(),0,'a different account receives no earned badges');
  const d=await device(other,false);await d.page.getByRole('link',{name:'Sign in to view your private writing rewards.'}).waitFor();assert.equal(await d.page.locator('.reward-card').count(),0);
  const admin=await device();await admin.page.goto(origin+'/admin');await admin.page.getByTestId('nav-achievements').click();
  await admin.page.getByRole('heading',{name:'Personal writing achievements',exact:true}).waitFor();assert.equal(await admin.page.locator('details').count(),53);
  const definition=admin.page.locator('details').filter({has:admin.page.locator('summary',{hasText:'First Words'})});await definition.locator('summary').click();await definition.locator('input[name="threshold"]').fill('200');
  await definition.locator('input[type="file"]').setInputFiles('extension/icons/icon128.png');await definition.locator('img[alt="Badge preview"]').waitFor();await Promise.all([admin.page.waitForResponse(r=>r.url().endsWith('/api/admin/achievements')&&r.request().method()==='GET'),definition.getByRole('button',{name:'Save definition',exact:true}).click()]);
  const saved=(await rpc('writing_reward_admin_catalog')).find(a=>a.id==='words_100');assert.equal(saved.threshold,200);assert.match(saved.badge_image,/^data:image\/webp;base64,/);assert.ok(saved.unlock_count>0);
  await admin.page.getByRole('button',{name:'Backfill verified history (25 accounts)',exact:true}).click();await admin.page.getByText('2 accounts reconciled. Backfill complete.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: two browsers with real PostgreSQL: 53 cards, favorites retained through disable/re-enable, automatic cross-device settings, quiet backfill, Free/paid filters and upgrade restoration, account isolation and sign-in, English/Spanish, reduced motion, 1440/768/320px, no horizontal scrolling, WCAG checks; admin catalog, threshold revision save, raster upload and batch backfill. Screenshots: '+out);
 } finally {if(browser)await browser.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
