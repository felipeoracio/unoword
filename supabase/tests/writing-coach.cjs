/** Real PostgreSQL, isolated in memory. Never touches live customers or quotas. */
const assert=require('node:assert/strict');const fs=require('node:fs');const {randomUUID}=require('node:crypto');
const root=process.env.PGLITE_ROOT || require('node:path').resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite');const {vector}=require(root+'/@electric-sql/pglite-pgvector');
(async()=>{
 const db=new PGlite({extensions:{vector}});const migration=fs.readFileSync('supabase/migrations/20261028030000_writing_coach_allowances.sql','utf8');
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension vector with schema extensions;`);
 // Foundation includes an unrelated storage bucket/policy; keep this harness focused.
 let foundation=fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,'');
 await db.exec('set search_path=public,extensions');await db.exec(foundation);
 await db.exec(fs.readFileSync('supabase/migrations/20261023010000_writing_workspace.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261023020000_writing_workspace_pro.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261028010000_shared_ai_quota.sql','utf8'));
 await db.exec('create table billing_accounts(user_id uuid primary key references auth.users,customer_id text);create table lifetime_orders(user_id uuid primary key references auth.users,customer_id text);');
 const old=randomUUID(), a=randomUUID(),b=randomUUID(),free=randomUUID();
 for(const user of [old,a,b,free])await db.query('insert into auth.users values($1)',[user]);
 await db.query("insert into ai_entitlements(user_id,plan,status,daily_request_limit) values($1,'pro','active',100)",[old]);
 await db.exec(migration);await db.exec(migration);
 const protectedTables=['ai_allowance_versions','ai_allowance_releases','ai_allowance_assignments','ai_allowance_audit','ai_model_prices','ai_response_cache','ai_cost_events'];
 for(const table of protectedTables){
  const catalog=await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table]);
  assert.equal(catalog.rows[0].relrowsecurity,true,table+' enables RLS');
  for(const role of ['anon','authenticated']){
   const acl=await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'public.'+table]);
   assert.equal(acl.rows[0].allowed,false,role+' cannot access '+table);
  }
  assert.equal((await db.query("select has_table_privilege('service_role',$1,'SELECT,INSERT,UPDATE,DELETE') allowed",['public.'+table])).rows[0].allowed,true);
 }

 for(const user of [a,b])await db.query("insert into ai_entitlements(user_id,plan,status,daily_request_limit) values($1,'pro','active',100)",[user]);
 const state=(u,tz='America/Chicago')=>db.query('select ai_coach_state($1,$2) s',[u,tz]).then(r=>r.rows[0].s);
 const reserve=(u,id=randomUUID(),feature='suggestion',hash='a'.repeat(64))=>db.query('select ai_coach_reserve($1,$2,$3,$4,$5) s',[u,id,feature,hash,'America/Chicago']).then(r=>r.rows[0].s);
 const release=(u,id)=>db.query('select ai_release_request($1,$2)',[u,id]);
 const complete=(u,id,items=[])=>db.query('select ai_coach_complete($1,$2,$3,$4,$5,$6,$7,$8) s',[u,id,'gpt-5.4-mini',100,20,50,JSON.stringify({items:['coaching']}),JSON.stringify(items)]).then(r=>r.rows[0].s);
 assert.equal((await state(old)).legacy_shared,true);assert.equal((await state(old)).daily_limit,100);
 assert.equal((await state(a)).legacy_shared,false);assert.equal((await state(a)).daily_limit,10);
 assert.equal((await reserve(free)).status,'forbidden');
 const ids=Array.from({length:20},randomUUID);const results=await Promise.all(ids.map(id=>reserve(a,id)));
 assert.equal(results.filter(r=>r.status==='reserved').length,10,'Concurrent requests cannot bypass daily cap');
 assert.equal((await state(a)).remaining,0);assert.equal((await reserve(a)).reason,'daily');
 const id=ids[0];assert.equal((await reserve(a,id)).status,'pending');assert.equal((await reserve(b,id)).status,'conflict');assert.equal((await reserve(a,id,'guidance')).status,'conflict');
 await assert.rejects(complete(a,id,[{id:randomUUID(),user_id:b,title:'x',suggestion:'Consider an example.',reason:'',context_summary:'',related_topics:[],source_ids:[],status:'shown'}]),/invalid_suggestion_owner/);
 assert.equal((await db.query('select count(*)::int n from ai_usage')).rows[0].n,0);
 await db.query('select ai_coach_cost($1,$2,$3,$4,$5,$6,$7,$8)',[a,id,'suggestion','gpt-5.4-mini',100,20,50,'succeeded']);
 assert.equal(await complete(a,id),true);assert.equal(await complete(a,id),true);assert.equal((await reserve(a,id)).status,'replay');
 assert.equal((await db.query('select count(*)::int n from ai_usage where id=$1',[id])).rows[0].n,1);
 assert.equal((await db.query('select estimated_cost::float c from ai_cost_events where request_id=$1',[id])).rows[0].c,0.0002865);
 for(const req of ids.slice(1,10))await release(a,req);
 assert.equal((await state(a)).remaining,9,'Failures release slots');
 // Guidance is a separate monthly allowance, not a second daily counter.
 const gids=Array.from({length:31},randomUUID);const guidance=await Promise.all(gids.map(id=>reserve(a,id,'guidance')));
 assert.equal(guidance.filter(r=>r.status==='reserved').length,30);assert.equal(guidance[30].reason,'guidance_monthly');
 assert.equal((await state(a)).remaining,9);
 for(const req of gids.slice(0,30))await release(a,req);
 // Use prior days in this month so the monthly boundary, not daily cap, blocks.
 await db.query("insert into ai_usage(user_id,date,request_type,feature,created_at) select $1,(now() at time zone 'America/Chicago')::date-1,'suggestion','suggestion',date_trunc('month',now() at time zone 'America/Chicago') at time zone 'America/Chicago' + interval '1 hour' from generate_series(1,199)",[a]);
 assert.equal((await reserve(a)).reason,'suggestions_monthly','201st monthly suggestion is blocked');
 // Completed guidance, not just reservations, enforces the 31st request.
 for(let i=0;i<30;i++){const gid=randomUUID();assert.equal((await reserve(b,gid,'guidance')).status,'reserved');assert.equal(await complete(b,gid),true);}
 assert.equal((await reserve(b,randomUUID(),'guidance')).reason,'guidance_monthly');
 // Quotes from old workers during a rolling deployment keep legacy terms.
 const rolling=randomUUID(),fresh=randomUUID();await db.query('insert into auth.users values($1),($2)',[rolling,fresh]);
 await db.query("insert into billing_accounts values($1,'cus_old_worker')",[rolling]);
 assert.equal((await state(rolling)).legacy_shared,true);
 await db.query('select ai_assign_allowance($1)',[fresh]);
 await db.query("insert into billing_accounts values($1,'cus_new_worker')",[fresh]);
 assert.equal((await state(fresh)).legacy_shared,false,'New workers bind current terms before customer creation');
 // No rollover; previous calendar-month rows do not count this month.
 await db.query("insert into ai_usage(user_id,date,request_type,feature,created_at) select $1,current_date-32,'suggestion','suggestion',now()-interval '32 days' from generate_series(1,250)",[b]);
 assert.equal((await state(b)).suggestions_monthly_used,0);
 const tz=await state(b,'Asia/Tokyo');assert.equal(tz.timezone,'America/Chicago');assert.equal(tz.pending_timezone,'Asia/Tokyo');
 // A reclaimed lease cannot be completed/released by an old worker.
 const leased=randomUUID(),oldLease=randomUUID(),newLease=randomUUID();
 const leasedReserve=lease=>db.query('select ai_coach_reserve($1,$2,$3,$4,$5,$6) s',[b,leased,'suggestion','b'.repeat(64),'America/Chicago',lease]).then(r=>r.rows[0].s);
 assert.equal((await leasedReserve(oldLease)).status,'reserved');
 await db.query("update workspace_ai_requests set created_at=now()-interval '6 minutes' where id=$1",[leased]);
 assert.equal((await leasedReserve(newLease)).status,'reserved');
 await db.query('select ai_coach_release($1,$2,$3)',[b,leased,oldLease]);
 assert.equal((await leasedReserve(newLease)).status,'pending');
 const staleComplete=await db.query("select ai_coach_complete($1,$2,null,null,null,null,'{}','[]',$3) ok",[b,leased,oldLease]);
 assert.equal(staleComplete.rows[0].ok,false);
 await db.query('select ai_coach_release($1,$2,$3)',[b,leased,newLease]);
 // Immutable drafts and publication never alter prior assignments.
 const version=(await db.query("select ai_admin_create_version('admin','Future',5,100,20,2,80) v")).rows[0].v;
 await db.query("select ai_admin_publish_version('admin',$1,now()+interval '1 second')",[version]);
 assert.equal((await state(a)).suggestions_monthly_limit,200);assert.equal((await state(old)).daily_limit,100);
 assert.equal((await db.query('select count(*)::int n from ai_allowance_audit')).rows[0].n,2);
 await db.query("update ai_allowance_releases set effective_at=now()-interval '1 second' where version_id=$1",[version]);
 await db.query("update ai_allowance_releases set effective_at=now()-interval '10 seconds' where version_id='00000000-0000-4000-8000-000000000002'");
 const newcomer=randomUUID();await db.query('insert into auth.users values($1)',[newcomer]);
 await db.query("insert into ai_entitlements(user_id,plan,status) values($1,'pro','trialing')",[newcomer]);
 assert.equal((await state(newcomer)).daily_limit,5);
 assert.equal((await state(b)).daily_limit,10);
 // Restored paid editor boundary retains owner isolation and all existing data.
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[free]);
 const doc=randomUUID();await assert.rejects(db.query("insert into writing_documents(id,user_id,title,content,plain_text,mutation_id) values($1,$2,'Free draft','{\"type\":\"doc\",\"content\":[]}','',gen_random_uuid())",[doc,free]),/row-level security/);
 for(const table of ['ai_allowance_versions','ai_allowance_assignments','ai_cost_events','ai_response_cache','ai_allowance_audit'])await assert.rejects(db.query('select * from '+table),/permission denied/);
 await assert.rejects(state(a),/permission denied/);await assert.rejects(reserve(a),/permission denied/);await db.exec('reset role');
 await db.close();console.log('PASS coach SQL: migration/reapply, protected legacy, Pro editor boundary, daily/monthly/guidance concurrency, exact model costs, atomic rollback, idempotency/replay, release, timezones, future releases, RLS.');
})().catch(e=>{console.error(e.message,e.stack?.split('\n').slice(0,3).join('\n'));process.exitCode=1;});
