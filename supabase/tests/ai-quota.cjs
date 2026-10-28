/** Execute real PostgreSQL functions locally. No credentials or provider calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  const a = randomUUID(), b = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table ai_usage(id uuid primary key default gen_random_uuid(),user_id uuid,date date,request_type text,
      input_tokens integer check(input_tokens>=0),output_tokens integer check(output_tokens>=0),estimated_cost numeric(12,6));
    create table workspace_ai_requests(id uuid primary key,user_id uuid references auth.users(id),date date default current_date,
      state text default 'pending' check(state in ('pending','done')),created_at timestamptz default now());
    alter table workspace_ai_requests enable row level security;
    revoke all on workspace_ai_requests from public,anon,authenticated;
    grant all on workspace_ai_requests,ai_usage to service_role;`);
  await db.query('insert into auth.users values($1),($2)', [a,b]);
  // Old editor completions have a separate usage row; do not charge them twice.
  await db.query("insert into ai_usage(user_id,date,request_type) values($1,(now() at time zone 'utc')::date,'workspace_assistant'),($1,(now() at time zone 'utc')::date,'suggestion'),($1,(now() at time zone 'utc')::date,'suggestion_fallback_provider_error')",[a]);
  await db.query("insert into workspace_ai_requests(id,user_id,state) values(gen_random_uuid(),$1,'done')",[a]);
  const sql = fs.readFileSync('supabase/migrations/20261028010000_shared_ai_quota.sql','utf8');
  await db.exec(sql); await db.exec(sql);
  const reserve = (owner,id,limit,type='suggestion') => db.query('select ai_reserve_request($1,$2,$3,$4) as ok',[owner,id,limit,type]).then(r=>r.rows[0].ok);
  const complete = (owner,id,input=20,output=30) => db.query('select ai_complete_request($1,$2,$3,$4) as ok',[owner,id,input,output]).then(r=>r.rows[0].ok);
  const release = (owner,id) => db.query('select ai_release_request($1,$2)',[owner,id]);
  const summary = owner => db.query('select ai_usage_summary($1) as value',[owner]).then(r=>r.rows[0].value);
  let usage = await summary(a);
  assert.deepEqual([usage.used_today,usage.pending_today,usage.total_today],[2,0,3]);
  const id = randomUUID();
  assert.equal(await reserve(a,id,3,'workspace_assistant'),true);
  assert.equal(await reserve(a,randomUUID(),3),false,'Both tools share last slot');
  assert.equal(await reserve(a,id,100),false,'A request cannot reserve twice');
  assert.equal((await summary(a)).pending_today,1);
  assert.equal(await complete(b,id),false,'Cannot settle another owner');
  await release(b,id);assert.equal((await summary(a)).pending_today,1);
  assert.equal(await complete(a,id),true);assert.equal(await complete(a,id),true);
  await release(a,id);usage=await summary(a);
  assert.deepEqual([usage.used_today,usage.pending_today,usage.total_today],[3,0,4]);
  assert.equal((await db.query('select count(*)::int as n from ai_usage where id=$1',[id])).rows[0].n,1);
  const next=randomUUID();assert.equal(await reserve(b,next,1),true);
  await assert.rejects(complete(b,next,-1),/check constraint/);
  assert.equal((await summary(b)).pending_today,1,'Failed transaction keeps its reservation');
  await release(b,next);assert.equal(await complete(b,next),false);
  const stale=randomUUID();assert.equal(await reserve(b,stale,1),true);
  await db.query("update workspace_ai_requests set created_at=now()-interval '6 minutes' where id=$1",[stale]);
  assert.equal((await summary(b)).pending_today,0);
  assert.equal(await complete(b,stale),false,'An expired worker cannot settle after its slot is reused');
  assert.equal(await reserve(b,randomUUID(),1),true);
  assert.equal(await reserve(b,randomUUID(),0),false);
  assert.equal(await reserve(b,randomUUID(),-1),false);
  assert.equal(await reserve(b,randomUUID(),100,'fake'),false);
  // UTC boundary: complete on the reservation day; app/database local time ignored.
  await db.exec("set timezone='Pacific/Honolulu'");
  const midnight=randomUUID();assert.equal(await reserve(a,midnight,4),true);
  await db.query("update workspace_ai_requests set date=(now() at time zone 'utc')::date-1 where id=$1",[midnight]);
  assert.equal(await complete(a,midnight),true);
  assert.equal((await summary(a)).used_today,3,'Cross-midnight result is charged to its starting day');
  // Summaries are SQL aggregates, unaffected by PostgREST's default 1000-row cap.
  await db.query("insert into ai_usage(user_id,date,request_type) select $1,(now() at time zone 'utc')::date,'suggestion' from generate_series(1,1100)",[a]);
  assert.equal((await summary(a)).used_today,1103);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(reserve(a,randomUUID(),5000),/permission denied/);
    await assert.rejects(complete(a,id),/permission denied/);
    await assert.rejects(release(a,id),/permission denied/);
    await assert.rejects(summary(a),/permission denied/);
    await assert.rejects(db.query('select * from workspace_ai_requests'),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');assert.equal((await summary(a)).used_today,1103);
  await db.close();
  console.log('PASS: shared quota migration/reapply; historical counts; pending slots; idempotent atomic settlement; rollback; owner isolation; expiry; UTC boundary; >1000 rows; private RPCs.');
})().catch(error=>{console.error(error);process.exitCode=1;});
