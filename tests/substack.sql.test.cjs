/** Real PostgreSQL/RLS: independent grants and atomic linking, never live data. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=process.env.PGLITE_ROOT||path.resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite'),{vector}=require(root+'/@electric-sql/pglite-pgvector');
test('Substack grants preserve native billing, require approval and verified email, and obey RLS',async()=>{
 const db=new PGlite({extensions:{vector}});
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension vector with schema extensions;set search_path=public,extensions;`);
 await db.exec(fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,''));
 for(const file of ['20260930160000_link_sources.sql','20261001000000_knowledge_pipeline.sql','20261021010000_stripe_billing.sql','20261023010000_writing_workspace.sql','20261023020000_writing_workspace_pro.sql','20261028010000_shared_ai_quota.sql','20261028020000_durable_source_processing.sql','20261028030000_writing_coach_allowances.sql','20261028040000_verified_streak_presentation.sql','20261104020000_substack_pro_integration.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const call=async(name,...args)=>(await db.query('select substack_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows[0].r;
 const user=randomUUID(),other=randomUUID(),lifetime=randomUUID();await db.query('insert into auth.users values($1),($2),($3)',[user,other,lifetime]);
 await db.query("insert into ai_entitlements(user_id,plan,status) values($1,'free','active')",[user]);
 const account='acct_publication',policy='verified-policy';
 await call('observe',account,true,'https://unoword.substack.com',policy,JSON.stringify({ready:true}));
 const state={customer_id:'cus_reader',email_hash:'verified-email-hash',status:'active',eligible:true,paid_through:new Date(Date.now()+86400000).toISOString(),price_ids:['price_publication'],policy_hash:policy};
 async function snapshot(id,value=state){const token=randomUUID();assert.equal(await call('subscription_claim',account,true,id,token,policy),true);assert.equal(await call('subscription_claim',account,true,id,randomUUID(),policy),false);assert.equal(await call('subscription_commit',account,true,id,randomUUID(),JSON.stringify(value)),false);assert.equal(await call('subscription_commit',account,true,id,token,JSON.stringify(value)),true);}
 async function challenge(who,hash='verified-email-hash',code='correct'){const id=randomUUID();assert.equal((await call('verification','begin',who,id,JSON.stringify({account_id:account,livemode:true,email_hash:hash,email_ciphertext:'ciphertext',masked_email:'r…@example.com',code_hash:code}))).created,true);await call('verification','delivered',who,id,'{}');return id;}
 await snapshot('sub_one');const id=await challenge(user);
 assert.equal(await call('link',user,id,'sub_one'),false,'unverified email does not link');
 assert.equal((await call('verification','verify',user,id,JSON.stringify({code_hash:'wrong'}))).invalid,true);
 assert.equal((await call('verification','verify',user,id,JSON.stringify({code_hash:'correct'}))).status,'verified');
 assert.equal((await call('verification','verify',user,id,JSON.stringify({code_hash:'correct'}))).invalid,true,'email code is consumed once');
 assert.equal(await call('link',other,id,'sub_one'),false,'request is bound to its UnoWord account');
 assert.equal(await call('link',user,id,'sub_one'),true);
 assert.equal(await call('entitlement',user,account,true),null,'no source access before activation');
 assert.equal(await call('set_enabled',account,true,true,false,'admin'),false,'live activation needs approval');
 assert.equal(await call('set_enabled',account,true,true,true,'admin'),true);assert.equal((await call('entitlement',user,account,true)).billing_source,'substack_stripe');
 assert.equal(await call('entitlement',user,'acct_wrong',true),null);
 const otherRequest=await challenge(other);await call('verification','verify',other,otherRequest,JSON.stringify({code_hash:'correct'}));assert.equal(await call('link',other,otherRequest,'sub_one'),false,'one subscription has one active owner');
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);assert.equal((await db.query('select workspace_has_pro_access() access')).rows[0].access,true);
 for(const table of ['substack_links','substack_subscriptions','substack_email_verifications','substack_events','substack_integration','substack_csv_candidates','substack_admin_audit','ai_effective_entitlements'])await assert.rejects(()=>db.query('select * from '+table));
 await assert.rejects(()=>call('set_enabled',account,true,true,true,'forged'));await db.exec('reset role');
 // The same effective grant authorizes AI quota reservations and ingestion checks.
 const reserved=await db.query("select ai_coach_reserve($1,$2,'suggestion',repeat('a',64),'UTC',null) r",[user,randomUUID()]);assert.equal(reserved.rows[0].r.status,'reserved');
 const defs=(await db.query("select proname,pg_get_functiondef(oid) definition from pg_proc where proname in ('ai_ingest_claim','ai_ingest_publish','ai_coach_reserve')")).rows;assert.equal(defs.length,3);assert.ok(defs.every(r=>r.definition.includes('public.ai_effective_entitlements')));
 // Native monthly and lifetime grants are never rewritten by Substack updates.
 await db.query("insert into ai_entitlements(user_id,plan,status,daily_request_limit,billing_source,billing_livemode) values($1,'pro','active',10,'stripe_lifetime',false)",[lifetime]);
 const lifetimeBefore=(await db.query('select * from ai_entitlements where user_id=$1',[lifetime])).rows[0];
 await snapshot('sub_lifetime');const lifeRequest=await challenge(lifetime);await call('verification','verify',lifetime,lifeRequest,JSON.stringify({code_hash:'correct'}));assert.equal(await call('link',lifetime,lifeRequest,'sub_lifetime'),true);
 await snapshot('sub_lifetime',{...state,status:'canceled',eligible:false,paid_through:null});assert.deepEqual((await db.query('select * from ai_entitlements where user_id=$1',[lifetime])).rows[0],lifetimeBefore);
 assert.equal((await db.query('select billing_source from ai_effective_entitlements where user_id=$1',[lifetime])).rows[0].billing_source,'stripe_lifetime');
 await snapshot('sub_one',{...state,eligible:false,status:'past_due',paid_through:new Date(Date.now()-1000).toISOString()});assert.equal(await call('entitlement',user,account,true),null);assert.equal((await db.query('select count(*)::int n from substack_links where user_id=$1',[user])).rows[0].n,1);
 await snapshot('sub_one');await call('disconnect',user,account,true);assert.equal(await call('entitlement',user,account,true),null);assert.deepEqual((await db.query('select * from ai_entitlements where user_id=$1',[lifetime])).rows[0],lifetimeBefore);
 // Event leases: duplicate delivery is durable, stale workers cannot commit.
 const event={id:'evt_fixture',type:'customer.subscription.updated',api_version:'2026-09-30.endive',object_id:'sub_one',object_type:'subscription',body_hash:'one-body',created:1};
 await call('event_enqueue',account,true,JSON.stringify(event));await call('event_enqueue',account,true,JSON.stringify(event));assert.equal((await db.query('select count(*)::int n from substack_events')).rows[0].n,1);
 await assert.rejects(()=>call('event_enqueue',account,true,JSON.stringify({...event,body_hash:'other-body'})),/substack_event_conflict/);
 const token=randomUUID();assert.equal((await call('event_claim',account,true,token,event.id)).event_id,event.id);assert.equal(await call('event_claim',account,true,randomUUID(),event.id),null);assert.equal(await call('event_finish',account,true,event.id,randomUUID(),null),false);assert.equal(await call('event_finish',account,true,event.id,token,null),true);assert.equal(await call('event_claim',account,true,randomUUID(),event.id),null);
 await call('event_enqueue',account,true,JSON.stringify({...event,signing_key_hash:'rotated-secret-hash'}));assert.equal((await db.query('select signing_key_hash from substack_events')).rows[0].signing_key_hash,'rotated-secret-hash');assert.equal(await call('event_claim',account,true,randomUUID(),event.id),null,'secret rotation receipt never reprocesses a completed grant');
 // Native Monthly and Substack can both exist; expiration of either preserves the other.
 const monthly=randomUUID();await db.query('insert into auth.users values($1)',[monthly]);
 await db.query("insert into ai_entitlements(user_id,plan,status,daily_request_limit,billing_source,billing_livemode,valid_until) values($1,'pro','active',10,'stripe',false,now()+interval '1 month')",[monthly]);
 await snapshot('sub_monthly');const monthlyProof=await challenge(monthly);await call('verification','verify',monthly,monthlyProof,JSON.stringify({code_hash:'correct'}));assert.equal(await call('link',monthly,monthlyProof,'sub_monthly'),true);
 assert.equal((await db.query('select billing_source from ai_effective_entitlements where user_id=$1',[monthly])).rows[0].billing_source,'stripe');
 await db.query("update ai_entitlements set status='canceled',valid_until=now()-interval '1 second' where user_id=$1",[monthly]);
 assert.equal((await db.query('select billing_source from ai_effective_entitlements where user_id=$1',[monthly])).rows[0].billing_source,'substack_stripe');
 await snapshot('sub_monthly',{...state,status:'canceled',eligible:false,paid_through:null});assert.equal(await call('entitlement',monthly,account,true),null);
 await db.query("update ai_entitlements set status='active',valid_until=now()+interval '1 month' where user_id=$1",[monthly]);assert.equal((await db.query('select billing_source from ai_effective_entitlements where user_id=$1',[monthly])).rows[0].billing_source,'stripe');
 // Invalid/expired codes and canceled verification never alter an existing link.
 const proof=await challenge(other,'other-email-hash');for(let attempt=0;attempt<5;attempt++)assert.equal((await call('verification','verify',other,proof,JSON.stringify({code_hash:'wrong'}))).invalid,true);
 assert.equal((await call('verification','verify',other,proof,JSON.stringify({code_hash:'correct'}))).invalid,true);
 await db.query("update substack_email_verifications set expires_at=now()-interval '1 second' where id=$1",[proof]);assert.equal((await call('verification','read_verified',other,proof,'{}')).invalid,true);
 const cancelProof=await challenge(user,'cancel-email-hash');await call('verification','cancel',user,cancelProof,'{}');assert.equal((await call('verification','verify',user,cancelProof,JSON.stringify({code_hash:'correct'}))).invalid,true);
 const counts=await call('admin_counts',account,true);assert.equal(typeof counts.linked_subscribers,'number');
 // Definition/config policy changes require a new approval; old evidence is ineligible.
 await call('observe',account,true,'https://unoword.substack.com','changed-policy',JSON.stringify({ready:true}));assert.equal((await db.query('select enabled from substack_integration')).rows[0].enabled,false);
 await db.exec(fs.readFileSync('supabase/migrations/20261104020000_substack_pro_integration.sql','utf8'));assert.deepEqual((await db.query('select * from ai_entitlements where user_id=$1',[lifetime])).rows[0],lifetimeBefore);
 console.log('PASS real SQL/RLS: independent native/Lifetime protection, approval gating, email proof, owner uniqueness, shared editor/quota/worker access, expiry/disconnect, durable idempotent events, stale leases, config changes and migration replay.');
 }finally{await db.close();}
});
