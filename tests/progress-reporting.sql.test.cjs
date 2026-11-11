/** Real migration functions in embedded PostgreSQL; no production data or APIs. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=process.env.PGLITE_ROOT||path.resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite'),{vector}=require(root+'/@electric-sql/pglite-pgvector');
test('reporting dates, DST, midnight splits and overlapping session time retain server semantics',async()=>{
 const db=new PGlite({extensions:{vector}});
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
  create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension vector with schema extensions;set search_path=public,extensions;`);
  await db.exec(fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,''));
  for(const file of ['20261023010000_writing_workspace.sql','20261023020000_writing_workspace_pro.sql','20261028010000_shared_ai_quota.sql','20261028040000_verified_streak_presentation.sql','20261029010000_session_pause_document_completion.sql','20261030010000_unified_account_writing_sync.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  const owner=randomUUID(),other=randomUUID();await db.query('insert into auth.users values($1),($2)',[owner,other]);
  const rpc=async(name,args)=>(await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;
  await rpc('writing_update_preferences',[owner,0,JSON.stringify({timezone:'America/Chicago',daily_goal:1000})]);
  for(const [start,end,words] of [
   ['2026-10-31T23:50:00-05:00','2026-11-01T00:10:00-05:00',50],
   ['2026-11-01T06:30:00Z','2026-11-01T07:30:00Z',100],
   ['2026-11-01T07:00:00Z','2026-11-01T08:00:00Z',200],
   ['2026-03-08T07:30:00Z','2026-03-08T08:30:00Z',150],
  ]){
   const duration=(Date.parse(end)-Date.parse(start))/1000;
   await db.query(`insert into writing_activity(id,user_id,source,started_at,typed_words,pasted_words,duration_seconds,sequence,timer,active_intervals)
   values($1,$2,'extension',$3,$4,999,$5,1,$6::jsonb,$7::jsonb)`,[randomUUID(),owner,start,words,duration,JSON.stringify({status:'ended',active_ms:duration*1000,paused_ms:0,changed_at:Date.parse(end)}),JSON.stringify([[Date.parse(start),Date.parse(end)]])]);
  }
  const before=await rpc('writing_account_summary',[owner,'UTC','2026-10-31',true]);
  const fall=await rpc('writing_account_summary',[owner,'UTC','2026-11-01',true]);
  const spring=await rpc('writing_account_summary',[owner,'UTC','2026-03-08',true]);
  assert.equal(fall.timezone,'America/Chicago','Account preference wins over browser/request timezone');
  assert.equal(before.dailyWordCount,50);assert.equal(before.dailyActiveWritingSeconds,600);
  assert.equal(fall.dailyWordCount,300,'Words belong to the session start day');assert.equal(fall.dailyActiveWritingSeconds,6000,'Midnight-clipped time plus the union of the fall-back overlap');
  assert.equal(spring.dailyActiveWritingSeconds,3600,'Spring-forward wall-clock jump does not add elapsed time');
  assert.equal(fall.lifetimeActiveWritingSeconds,10200,'Account time deduplicates simultaneous sessions');assert.equal(fall.lifetimeWordCount,500,'Pasted words do not inflate typed totals');
  assert.equal(fall.dailySessionCount,2,'A session crossing midnight is counted on its start day');
  const history=await rpc('writing_progress_history',[owner,'UTC',0]);
  assert.equal(history.find(day=>day.date==='2026-11-01').duration_seconds,6000);
  const month=await rpc('writing_account_statistics',[owner,'month','UTC']);
  assert.equal(month.timezone,'America/Chicago');assert.ok(month.buckets.length>=28&&month.buckets.length<=31);assert.ok(month.buckets.every(bucket=>typeof bucket.activeWritingSeconds==='number'));
  const zero=await rpc('writing_account_summary',[other,'UTC','2026-11-01',true]);assert.equal(zero.lifetimeWordCount,0);assert.equal(zero.lifetimeActiveWritingSeconds,0);
  await rpc('writing_update_preferences',[owner,1,JSON.stringify({timezone:'Pacific/Kiritimati'})]);
  const shifted=await rpc('writing_account_summary',[owner,'America/Chicago','2026-11-01',true]);
  assert.equal(shifted.timezone,'Pacific/Kiritimati');assert.equal(shifted.dailyWordCount,350);assert.equal(shifted.dailyActiveWritingSeconds,6600);assert.equal(shifted.lifetimeActiveWritingSeconds,10200,'Changing reporting timezone never changes recorded lifetime time');
 }finally{await db.close();}
});
