/** Two isolated browsers + real PostgreSQL migrations, with private HTTP fixtures.
 * No production account, writing, provider API, or billing operation is used. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./node_modules/playwright');
const root=process.env.PGLITE_ROOT||path.resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite'),{vector}=require(root+'/@electric-sql/pglite-pgvector');
const origin=process.env.WRITING_TEST_ORIGIN||'http://127.0.0.1:4177';
const plain=n=>n.type==='text'?n.text:(n.content||[]).map(plain).join(n.type==='doc'?'\n':'');
(async()=>{
 const db=new PGlite({extensions:{vector}});let browser;
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension vector with schema extensions;set search_path=public,extensions;`);
 await db.exec(fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,''));
 for(const f of ['20261023010000_writing_workspace.sql','20261023020000_writing_workspace_pro.sql','20261028010000_shared_ai_quota.sql','20261028040000_verified_streak_presentation.sql','20261029010000_session_pause_document_completion.sql','20261030010000_unified_account_writing_sync.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const owner=randomUUID(),other=randomUUID();await db.query('insert into auth.users values($1),($2)',[owner,other]);
 await db.query("insert into ai_entitlements(user_id,plan,status,daily_request_limit) values($1,'pro','active',10)",[owner]);
 await db.query('select writing_update_preferences($1,0,$2)',[owner,JSON.stringify({daily_goal:1000,timezone:'UTC',language:'en'})]);
 // Serialize request-role changes, mirroring separate PostgREST transactions.
 let queue=Promise.resolve();const sql=(who,fn)=>{const next=queue.then(async()=>{await db.exec('reset role');if(who){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);}return fn();});queue=next.catch(()=>{});return next;};
 const rpc=(name,args)=>db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args).then(r=>r.rows[0].r);
 const summary=()=>sql(null,()=>rpc('writing_account_summary',[owner,'UTC',null,true]));
 const errors=[];let aiCalls=0;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
 async function device(who=owner){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(20000);
  await context.route(origin+'/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),key=url.pathname.slice(4),body=req.postData()?JSON.parse(req.postData()):null,method=req.method();
   try{
    const value=await sql(null,async()=>{
     if(key==='/auth/me')return {id:who,email:'isolated@example.com',plan:who===owner?'pro':'free',ai_access:who===owner};
     if(key==='/onboarding')return {version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
     if(key==='/progress/preferences')return method==='GET'?rpc('writing_account_preferences',[who]):rpc('writing_update_preferences',[who,body.revision,JSON.stringify(body)]);
     if(key==='/progress/summary')return rpc('writing_account_summary',[who,url.searchParams.get('timezone')||'UTC',null,who===owner]);
     if(key==='/workspace/config')return {daily_goal:250,max_document_chars:200000,max_upload_bytes:5242880,ai_batch_size:3};
     if(key==='/ai/profile')return {user_id:who,primary_topics:['craft'],ai_preferences:{}};
     if(key==='/ai/usage/summary')return {user_id:who,daily_limit:10,remaining:10,used_today:0,pending_today:0,timezone:'UTC',daily_reset_at:new Date(Date.now()+86400000).toISOString(),monthly_reset_at:new Date(Date.now()+86400000*30).toISOString(),suggestions_monthly_limit:200,suggestions_monthly_used:0,suggestions_monthly_remaining:200,guidance_monthly_limit:30,guidance_monthly_used:0,guidance_monthly_remaining:30};
     if(key==='/workspace/sources')return [];
     if(key==='/workspace/assistant'){aiCalls++;throw Error('Unexpected AI call');}
     await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);
     if(key==='/workspace/activity'){
      if(method==='GET')return (await db.query("select * from writing_activity where user_id=$1 and source='editor' order by started_at desc,id limit 1000 offset $2",[who,Number(url.searchParams.get('offset')||0)])).rows;
      assert.equal(body.expected_user_id,who);return rpc('workspace_save_activity',[JSON.stringify(body)]);
     }
     if(key==='/workspace/documents')return (await db.query('select * from writing_documents where user_id=$1 order by updated_at desc limit 200 offset $2',[who,Number(url.searchParams.get('offset')||0)])).rows;
     if(key==='/workspace/folders')return (await db.query('select id,name from writing_folders where user_id=$1',[who])).rows;
     if(key.startsWith('/workspace/documents/')){
      const id=key.split('/')[3];
      if(method==='GET')return (await db.query('select * from writing_documents where id=$1 and user_id=$2',[id,who])).rows[0];
      assert.equal(body.expected_user_id,who);
      let data=body;
      if(key.endsWith('/completion'))data={...(await db.query('select * from writing_documents where id=$1 and user_id=$2',[id,who])).rows[0],completion_status:body.completion_status};
      else data={...body,plain_text:plain(body.content)};
      return rpc('workspace_save_document',[id,body.revision,body.mutation_id,JSON.stringify(data)]);
     }
     throw Error('Unhandled fixture '+method+' '+key);
    });
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
   }catch(error){errors.push(error.message);return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'fixture_error'})});}
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const baseline=Date.now()-3600000;await page.clock.install({time:baseline});
  await page.goto(origin+'/editor');return {page,context,baseline};
 }
 const a=await device(),b=await device();
 await b.page.getByRole('heading',{name:'Ready for Your Next Idea?',exact:true}).waitFor();
 const until=async check=>{for(let i=0;i<150;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for shared PostgreSQL state');};
 await a.page.getByRole('button',{name:'Start New Document',exact:true}).click();
 const canvas=a.page.getByRole('textbox',{name:'Document content'});
 await canvas.fill('A thoughtful beginning.');
 for(let i=0;i<10;i++){
  await a.page.clock.fastForward(120000);
  await canvas.press('End');await canvas.pressSequentially(' More ideas.');
  await a.page.clock.runFor(2500);
 }
 await a.page.getByRole('button',{name:'Pause Session',exact:true}).click();await a.page.clock.runFor(3000);
 await until(async()=>{const s=await summary();return s.dailyActiveWritingSeconds>=1200;});
 await until(async()=>(await summary()).sessions.some(row=>row.status==='paused'));
 let s=await summary();assert.ok(s.dailyActiveWritingSeconds>=1200&&s.dailyActiveWritingSeconds<1235);
 assert.equal(s.dailyGoal,1000);assert.equal(s.timezone,'UTC');
 const savedTime=s.dailyActiveWritingSeconds;
 await b.page.clock.runFor(16000);
 await b.page.locator('.uw-editor-document').first().waitFor();
 await b.page.locator('.uw-editor-document').first().click();
 await b.page.getByRole('textbox',{name:'Rename document'}).waitFor();
 assert.equal(await b.page.getByRole('button',{name:'Resume Session',exact:true}).count(),0,'Another device does not silently own the remote session');
 await b.page.waitForFunction(()=>document.querySelector('.uw-editor-stats').textContent.includes('00:20:'));
 await a.page.clock.fastForward(300000);await a.page.clock.runFor(2000);assert.equal((await summary()).dailyActiveWritingSeconds,savedTime,'Paused gap adds no writing time');
 // A completed status from A reaches B; B's current document is not auto-reopened.
 await a.page.getByRole('button',{name:'Mark Document as Complete',exact:true}).click();
 await a.page.getByRole('button',{name:'Complete & End Session',exact:true}).click();await a.page.clock.runFor(3000);
 await until(()=>sql(null,()=>db.query("select count(*)::int n from writing_documents where user_id=$1 and completion_status='completed'",[owner])).then(r=>r.rows[0].n===1));
 await b.page.clock.runFor(16000);
 await b.page.getByRole('heading',{name:'Ready for Your Next Idea?',exact:true}).waitFor();
 // Device B now contributes a distinct, later session and A receives it.
 await b.page.clock.setSystemTime(new Date(a.baseline+26*60000));
 await b.page.getByRole('button',{name:'Start New Document',exact:true}).click();
 await b.page.getByRole('textbox',{name:'Rename document'}).fill('A second device');
 const bCanvas=b.page.getByRole('textbox',{name:'Document content'});
 await bCanvas.fill('A different thought.');
 for(let i=0;i<5;i++){await b.page.clock.fastForward(120000);await bCanvas.press('End');await bCanvas.pressSequentially(' Another perspective.');await b.page.clock.runFor(2500);}
 await b.page.getByRole('button',{name:'Pause Session',exact:true}).click();await b.page.clock.runFor(3000);
 await until(async()=>{const result=await summary();return result.dailyActiveWritingSeconds>=1800&&result.sessions.some(row=>row.status==='paused');});
 const both=await summary();assert.ok(both.dailyActiveWritingSeconds<1850,'Distinct sessions add once');
 await a.page.clock.runFor(16000);
 await a.page.waitForFunction(()=>document.querySelector('.uw-editor-stats').textContent.includes('00:30:'));
 assert.ok((await a.page.locator('.uw-editor-stats').textContent()).includes('/1000'),'Goal is shared too');
 assert.equal((await sql(null,()=>db.query('select count(*)::int n from writing_activity where user_id=$1',[owner]))).rows[0].n,2);
 // Other account receives no writing or totals through the same public contract.
 const c=await device(other);await c.page.getByRole('heading',{name:'Unlock Your Writing Space'}).waitFor();
 assert.equal(await sql(null,()=>rpc('writing_account_summary',[other,'UTC',null,false])).then(v=>v.dailyActiveWritingSeconds),0);
 assert.equal(aiCalls,0);assert.deepEqual(errors,[]);
 if(process.env.WRITING_SCREENSHOTS){fs.mkdirSync(process.env.WRITING_SCREENSHOTS,{recursive:true});await b.page.screenshot({path:path.join(process.env.WRITING_SCREENSHOTS,'second-device-completion.png'),fullPage:true});}
 console.log('PASS two-browser editor + real PostgreSQL: 20 qualifying minutes appear on second device, remote active session never adopted, second-device 10 minutes returns to first device as 30 minutes total, paused five minutes excluded, document/completion cloud refresh, same account goal/timezone, Free ownership isolation, no AI/provider calls.');
 }finally{if(browser)await browser.close();await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
