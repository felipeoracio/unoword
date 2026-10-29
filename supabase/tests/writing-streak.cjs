/** Real PostgreSQL, isolated in memory. Never touches live customers or quotas. */
const assert=require('node:assert/strict');const fs=require('node:fs');const {randomUUID}=require('node:crypto');
const root=process.env.PGLITE_ROOT || require('node:path').resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite');const {vector}=require(root+'/@electric-sql/pglite-pgvector');
(async()=>{
 const db=new PGlite({extensions:{vector}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension vector with schema extensions;`);
 // Foundation includes an unrelated storage bucket/policy; keep this harness focused.
 let foundation=fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,'');
 await db.exec('set search_path=public,extensions');await db.exec(foundation);
 await db.exec(fs.readFileSync('supabase/migrations/20261023010000_writing_workspace.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261023020000_writing_workspace_pro.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261028010000_shared_ai_quota.sql','utf8'));

 const migration=fs.readFileSync('supabase/migrations/20261028040000_verified_streak_presentation.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 const user=randomUUID(),other=randomUUID();await db.query('insert into auth.users values($1),($2)',[user,other]);
 const sync=rows=>db.query('select writing_sync_extension($1,$2) n',[user,JSON.stringify(rows)]);
 const present=(paid,now='2026-10-20T18:00:00Z',tz='America/Chicago')=>db.query('select writing_streak_presentation($1,$2,$3,$4) s',[user,tz,paid,now]).then(r=>r.rows[0].s);
 const actual=(now='2026-10-20T18:00:00Z',tz='America/Chicago')=>db.query('select writing_actual_streak($1,$2,$3) n',[user,tz,now]).then(r=>r.rows[0].n);
 const rows=[];
 for(let i=0;i<25;i++){
  const started=new Date(Date.parse('2026-10-20T17:00:00Z')-i*86400000).toISOString();
  rows.push({key:'day-'+i,started_at:started,typed_words:10,pasted_words:0,duration_seconds:30,sequence:1});
 }
 await sync(rows);await sync(rows);
 assert.equal((await db.query('select count(*)::int n from writing_activity where user_id=$1',[user])).rows[0].n,25,'Duplicate synchronization does not duplicate days or words');
 assert.equal(await actual(),25);
 for(const [day,expected] of [['2026-09-26T18:00:00Z',1],['2026-10-02T18:00:00Z',7],['2026-10-03T18:00:00Z',8],['2026-10-10T18:00:00Z',15],['2026-10-15T18:00:00Z',20],['2026-10-20T18:00:00Z',25]]){
  assert.equal(await actual(day),expected);const value=await present(false,day);assert.equal(value.displayedStreak,Math.min(expected,7));
  assert.ok(!('actualStreak' in value));assert.equal((await present(true,day)).displayedStreak,expected);
 }
 assert.equal((await present(true,'2026-10-10T18:00:00Z')).displayedStreak,15,'Upgrade on day 15 unlocks the real streak');
 assert.equal((await present(false,'2026-10-15T18:00:00Z')).displayedStreak,7,'Downgrade changes display only');
 assert.equal((await present(true)).displayedStreak,25,'Re-upgrade never needs historical rewrites');
 assert.equal(await actual('2026-10-22T18:00:00Z'),0,'Missing a required day breaks the current streak');
 const afterMiss=await present(true,'2026-10-22T18:00:00Z');assert.equal(afterMiss.longestStreak,25);assert.deepEqual(afterMiss.milestones,[7,14],'Past earned milestones survive a missed day');
 assert.ok(!('longestStreak' in await present(false)));assert.ok(!('milestones' in await present(false)));
 assert.equal((await db.query('select count(*)::int n from writing_activity where user_id=$1',[user])).rows[0].n,25,'Missed days and plan transitions preserve history');
 // Reconciliation can remove typed words, while pasted words never qualify.
 await sync([{...rows[0],typed_words:0,pasted_words:500,sequence:2}]);assert.equal(await actual(),24,'Yesterday remains a current streak when today has no typed words');
 await sync([{...rows[0],sequence:3}]);assert.equal(await actual(),25);
 // Different source IDs on the same day cannot inflate the streak.
 await sync([{...rows[0],key:'another-session',sequence:1}]);assert.equal(await actual(),25);
 // Server port matches the existing pure streak engine across timezone/DST fixtures.
 const history=require('../../extension/shared/history.js');
 for(const [now,tz,stamps] of [
 ['2026-03-09T18:00:00Z','America/Chicago',['2026-03-07T18:00:00Z','2026-03-08T17:00:00Z','2026-03-09T17:00:00Z']],
 ['2026-11-02T18:00:00Z','America/Chicago',['2026-10-31T17:00:00Z','2026-11-01T18:00:00Z','2026-11-02T17:00:00Z']],
 ['2026-10-21T02:00:00Z','Asia/Tokyo',['2026-10-19T23:30:00Z','2026-10-20T23:30:00Z']],
 ['2026-10-20T23:59:00Z','America/Los_Angeles',['2026-10-19T23:30:00Z','2026-10-20T00:30:00Z']],
 ]){
  // Direct fixture insertion permits future dates solely for testing the existing DST rule.
  await db.query('delete from writing_activity where user_id=$1',[user]);
  for(const stamp of stamps)await db.query("insert into writing_activity(id,user_id,started_at,typed_words,pasted_words,duration_seconds,sequence,source) values(gen_random_uuid(),$1,$2,1,0,1,1,'extension')",[user,stamp]);
  const expected=history.computeStreak(stamps.map(stamp=>({startedAt:Date.parse(stamp),typedWords:1})),tz,Date.parse(now));
  assert.equal(await actual(now,tz),expected,'DST and calendar-day behavior matches existing rules');
 }
 // Actual aggregates and long history are never available to Free tokens.
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await assert.rejects(actual(),/permission denied/);await assert.rejects(present(true),/permission denied/);
 assert.equal((await db.query('select * from writing_activity')).rows.length,0,'Free raw REST cannot request premium historical rows');
 await db.exec('reset role');
 await db.query("insert into ai_entitlements(user_id,plan,status,daily_request_limit) values($1,'pro','active',100)",[user]);
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 assert.ok((await db.query('select * from writing_activity')).rows.length>0,'Verified paid account can view its full available history');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal((await db.query('select * from writing_activity')).rows.length,0);
 await db.exec('reset role');
 // Explicit clear tombstone prevents old offline snapshots resurrecting deleted progress.
 await db.query('select writing_clear_progress($1,$2)',[user,'2026-10-20T23:59:00Z']);await sync(rows);
 assert.equal((await db.query('select count(*)::int n from writing_activity where user_id=$1',[user])).rows[0].n,0);
 await db.close();console.log('PASS streak SQL: 1/7/8/15/20/25 days, upgrade/downgrade/re-upgrade, unchanged history, duplicate sync, typed/pasted/deletion, missed days, Chicago DST, Tokyo/LA days, existing-engine parity, private aggregates, RLS, clear tombstones.');
})().catch(e=>{console.error(e.message,e.stack?.split('\n').slice(0,3).join('\n'));process.exitCode=1;});
