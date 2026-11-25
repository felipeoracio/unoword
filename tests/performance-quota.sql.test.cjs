/** Controlled local PostgreSQL benchmark. No production APIs or account data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=process.env.PGLITE_ROOT||path.resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite'),{vector}=require(root+'/@electric-sql/pglite-pgvector');
(async()=>{const db=new PGlite({extensions:{vector}});try{
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create extension vector with schema extensions;set search_path=public,extensions;`);
await db.exec(fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,''));
for(const file of ['20260930160000_link_sources.sql','20261001000000_knowledge_pipeline.sql','20261023010000_writing_workspace.sql','20261023020000_writing_workspace_pro.sql','20261028010000_shared_ai_quota.sql','20261028030000_writing_coach_allowances.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
const user=randomUUID();await db.query('insert into auth.users values($1)',[user]);await db.query("insert into ai_entitlements(user_id,plan,status) values($1,'pro','active')",[user]);
await db.exec(`create table public.test_timezone_writes(n integer);create function public.test_log_timezone_write() returns trigger language plpgsql as $$begin insert into public.test_timezone_writes values(1);return new;end$$;create trigger test_timezone_write after update on public.ai_allowance_assignments for each row execute function public.test_log_timezone_write();`);
const state=async(tz='America/Chicago')=>(await db.query('select public.ai_coach_state($1,$2) r',[user,tz])).rows[0].r;
await state();const initial=await state();
async function benchmark(){await db.exec('truncate public.test_timezone_writes');const start=performance.now();for(let i=0;i<100;i++)await state();return {calls:100,elapsedMs:Math.round((performance.now()-start)*100)/100,assignmentUpdates:(await db.query('select count(*)::int n from public.test_timezone_writes')).rows[0].n};}
const before=await benchmark();assert.equal(before.assignmentUpdates,100);
const metadata=async()=>(await db.query("select prosrc,prosecdef,proconfig,proacl::text privileges from pg_proc where oid='public.ai_coach_state(uuid,text)'::regprocedure")).rows[0];
const originalMetadata=await metadata();
const migration=fs.readFileSync('supabase/migrations/20261125194641_avoid_unchanged_quota_timezone_writes.sql','utf8');await db.exec(migration);await db.exec(migration);
const after=await benchmark();assert.equal(after.assignmentUpdates,0);
const final=await state();for(const key of ['daily_limit','remaining','suggestions_monthly_limit','suggestions_monthly_remaining','guidance_monthly_limit','guidance_monthly_remaining','daily_reset_at','monthly_reset_at','timezone'])assert.deepEqual(final[key],initial[key],key);
await assert.rejects(state('Not/A_Timezone'),/invalid_quota_timezone/);
await state('Europe/London');assert.equal((await state('Europe/London')).timezone,'Europe/London','unused account can still change timezone');
const request=randomUUID();await db.query("select public.ai_coach_reserve($1,$2,'suggestion',repeat('a',64),'Europe/London',null)",[user,request]);
const pending=await state('America/Chicago');assert.equal(pending.timezone,'Europe/London','pending credit prevents mid-period timezone change');assert.equal(pending.pending_timezone,'America/Chicago');assert.equal(pending.pending_today,1);
const fixedMetadata=await metadata();
const dataChecksum=async()=>(await db.query("select md5(jsonb_build_object('assignments',(select jsonb_agg(to_jsonb(a) order by user_id) from ai_allowance_assignments a),'usage',(select jsonb_agg(to_jsonb(u) order by id) from ai_usage u),'pending',(select jsonb_agg(to_jsonb(p) order by id) from workspace_ai_requests p))::text) checksum")).rows[0].checksum;
const beforeRestore=await dataChecksum();await db.exec(fs.readFileSync('docs/review/performance-audit/rollback-quota-timezone.sql','utf8'));
const restoredMetadata=await metadata();for(const key of Object.keys(originalMetadata))assert.deepEqual(typeof restoredMetadata[key]==='string'?restoredMetadata[key].replace(/\r\n/g,'\n'):restoredMetadata[key],typeof originalMetadata[key]==='string'?originalMetadata[key].replace(/\r\n/g,'\n'):originalMetadata[key],key);
assert.equal(await dataChecksum(),beforeRestore);await db.exec(migration);assert.deepEqual(await metadata(),fixedMetadata);assert.equal(await dataChecksum(),beforeRestore);
console.log('PASS quota scoped restore drill: original function/security restored, guard reapplied, assignment/usage/pending-record checksums unchanged.');
const report={environment:'local PGlite PostgreSQL, synthetic account, 100 identical reads before/after',before,after,assignmentWriteReductionPercent:100,productionCpuChange:'Not measured by this local benchmark'};
fs.mkdirSync('docs/review/performance-audit',{recursive:true});fs.writeFileSync('docs/review/performance-audit/quota-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log('PASS quota: unchanged timezone writes 100 -> 0; limits/resets preserved; invalid timezone rejected; real timezone changes preserved; pending credit blocks timezone switching.');console.log(JSON.stringify(report));
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
