/** Execute the real migration and authorization boundaries in PostgreSQL WASM. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
(async () => {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key);
 create table public.ai_entitlements(user_id uuid primary key references auth.users(id), plan text not null default 'free', status text not null default 'inactive', daily_request_limit int not null default 0, valid_until timestamptz, updated_at timestamptz default now());
 insert into auth.users values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');`);
 const sql = fs.readFileSync('supabase/migrations/20261021010000_stripe_billing.sql','utf8');
 await db.exec(sql); await db.exec(sql); // Reapplying is safe.
 const user='00000000-0000-4000-8000-000000000001', lease='00000000-0000-4000-8000-000000000003';
 const other='00000000-0000-4000-8000-000000000002';
 const rpc = async (name, args, placeholders) => (await db.query(`select public.${name}(${placeholders}) as result`,args)).rows[0].result;
 const lock = (id=user,l=lease) => rpc('billing_lock',[id,l],'$1::uuid,$2::uuid');
 const commit = (state,entitlement,event) => rpc('billing_commit',[user,lease,JSON.stringify(state),entitlement&&JSON.stringify(entitlement),event],'$1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::text');
 let state=await lock();
 await assert.rejects(lock(), /billing_busy/);
 state.customer_id='cus_fixture'; state.subscription_id='sub_fixture'; state.subscription_created=100;
 state.status='trialing'; state.trial_used=true;
 const end=new Date(Date.now()+86400000).toISOString();
 assert.equal(await commit(state,{status:'trialing',valid_until:end},'evt_first'),true);
 let row=(await db.query('select * from public.ai_entitlements where user_id=$1',[user])).rows[0];
 assert.equal(row.billing_source,'stripe'); assert.equal(row.daily_request_limit,100); assert.equal(row.status,'trialing');
 assert.equal(await commit({...state,status:'canceled'},{status:'canceled',valid_until:end},'evt_first'),false);
 assert.equal((await db.query('select status from public.ai_entitlements where user_id=$1',[user])).rows[0].status,'trialing');
 assert.equal(await commit({...state,status:'active'},{status:'active',valid_until:end},'evt_renew'),true);
 await db.query(`update public.ai_entitlements set daily_request_limit=250 where user_id=$1`,[user]);
 await commit(state,{status:'past_due',valid_until:end},'evt_failed');
 row=(await db.query('select * from public.ai_entitlements where user_id=$1',[user])).rows[0];
 assert.equal(row.status,'past_due'); assert.equal(row.daily_request_limit,250);
 assert.equal((await db.query('select count(*)::int as n from public.ai_entitlements where user_id=$1',[other])).rows[0].n,0);
 await db.query("update public.billing_accounts set lease_until=now()-interval '1 second' where user_id=$1",[user]);
 await assert.rejects(commit(state,{status:'active',valid_until:end},'evt_expired'),/billing_lease_expired/);
 assert.equal((await db.query("select count(*)::int as n from public.billing_events where event_id='evt_expired'")).rows[0].n,0);
 state=await lock();
 // A canceled billing account must not overwrite independently granted Pro.
 await db.query("update public.ai_entitlements set billing_source=null, status='active', valid_until=null where user_id=$1",[user]);
 await commit(state,{status:'canceled',valid_until:end},'evt_manual');
 row=(await db.query('select * from public.ai_entitlements where user_id=$1',[user])).rows[0];
 assert.equal(row.billing_source,null); assert.equal(row.status,'active');
 // JSON mutations plus entitlement/event receipt roll back together on failure.
 await assert.rejects(commit({...state,checkout_attempt:'bad-uuid'},{status:'inactive'},'evt_atomic'),/invalid input/);
 assert.equal((await db.query("select count(*)::int as n from public.billing_events where event_id='evt_atomic'")).rows[0].n,0);
 for (const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select * from public.billing_accounts'),/permission denied/);
  await assert.rejects(db.query('select * from public.billing_events'),/permission denied/);
  await assert.rejects(lock(),/permission denied/);
  await assert.rejects(commit(state,null,null),/permission denied/);
  await assert.rejects(rpc('billing_unlock',[user,lease],'$1::uuid,$2::uuid'),/permission denied/);
  await db.exec('reset role');
 }
 await db.close(); console.log('PASS: real PostgreSQL migration/reapply; durable lock/expiry; atomic event+entitlement+state; webhook replay; 100 requests and existing quotas; renewal/payment failure; manual grants preserved; account isolation; anon/authenticated table and RPC denial.');
})().catch(e=>{console.error(e);process.exitCode=1});
