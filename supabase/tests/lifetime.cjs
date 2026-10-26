const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
(async()=>{const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table ai_entitlements(user_id uuid primary key references auth.users(id) on delete cascade,plan text,status text,daily_request_limit integer,valid_until timestamptz,updated_at timestamptz default now());`);
await db.exec(fs.readFileSync('supabase/migrations/20261021010000_stripe_billing.sql','utf8'));
const sql=fs.readFileSync('supabase/migrations/20261026010000_lifetime_offer.sql','utf8');await db.exec(sql);await db.exec(sql);
const ids=Array.from({length:28},()=>crypto.randomUUID()),attempts=ids.map(()=>crypto.randomUUID());for(const id of ids)await db.query('insert into auth.users values($1)',[id]);
const reserve=i=>db.query('select lifetime_reserve($1,$2,$3,$4) as item',[ids[i],attempts[i],'cus_'+i,'price_test']);
const all=await Promise.all(Array.from({length:25},(_,i)=>reserve(i)));assert.equal(new Set(all.map(r=>r.rows[0].item.slot)).size,25);
await assert.rejects(reserve(25),/lifetime_capacity_unavailable/);assert.equal((await reserve(0)).rows[0].item.slot,1);
await db.query('select lifetime_attach($1,$2,$3)',[ids[0],attempts[0],'cs_0']);
const finalize=(status,event)=>db.query('select lifetime_finalize($1,$2,$3,$4,$5,$6) as ok',[ids[0],attempts[0],'cs_0','pi_0',status,event]);
assert.equal((await finalize('paid','evt_paid')).rows[0].ok,true);assert.equal((await finalize('paid','evt_paid')).rows[0].ok,false);
let ent=(await db.query('select * from ai_entitlements where user_id=$1',[ids[0]])).rows[0];assert.equal(ent.status,'active');assert.equal(ent.valid_until,null);assert.equal(ent.billing_source,'stripe_lifetime');assert.equal(ent.billing_livemode,false);assert.equal(ent.daily_request_limit,100);
// Old monthly cancellation cannot revoke lifetime Pro.
const lease=crypto.randomUUID(),state=(await db.query('select billing_lock($1,$2) as state',[ids[0],lease])).rows[0].state;
await db.query('select billing_commit($1,$2,$3::jsonb,$4::jsonb,$5)',[ids[0],lease,JSON.stringify(state),JSON.stringify({status:'canceled',valid_until:new Date().toISOString()}),'evt_old_monthly']);
assert.equal((await db.query('select status from ai_entitlements where user_id=$1',[ids[0]])).rows[0].status,'active');
await db.query('select lifetime_attach($1,$2,$3)',[ids[1],attempts[1],'cs_1']);
assert.equal((await db.query('select lifetime_release($1,$2,$3) as ok',[ids[1],attempts[1],'wrong'])).rows[0].ok,false);
assert.equal((await db.query('select lifetime_release($1,$2,$3) as ok',[ids[1],attempts[1],'cs_1'])).rows[0].ok,true);await reserve(25);
await finalize('refunded','evt_refund');assert.equal((await db.query('select status from ai_entitlements where user_id=$1',[ids[0]])).rows[0].status,'inactive');
await db.query('delete from auth.users where id=$1',[ids[0]]);assert.equal((await db.query('select count(*)::int as n from lifetime_sold_slots')).rows[0].n,1);await assert.rejects(reserve(26),/lifetime_capacity_unavailable/);
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from lifetime_orders'),/permission denied/);await assert.rejects(db.query('select * from lifetime_sold_slots'),/permission denied/);await assert.rejects(reserve(27),/permission denied/);await db.exec('reset role');}
await db.close();console.log('PASS lifetime SQL: migration/reapply, 25-slot capacity, retries, expiration CAS, paid/refund idempotency, lifetime entitlement, old monthly cancellation protection, deleted-account capacity retention, browser-role denial.');})().catch(e=>{console.error(e);process.exitCode=1});
