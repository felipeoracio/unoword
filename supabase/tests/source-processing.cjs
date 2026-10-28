/** Actual PostgreSQL/pgvector execution; no cloud credentials or paid API calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const root=process.env.PGLITE_MODULE||'@electric-sql/pglite';
const {PGlite}=require(root);
const {vector}=require(process.env.PGLITE_VECTOR_MODULE||'@electric-sql/pglite-pgvector');
(async()=>{
 const db=new PGlite({extensions:{vector}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create schema extensions;create extension vector with schema extensions;
 create type ai_processing_status as enum('pending','processing','ready','failed');
 create table ai_entitlements(user_id uuid primary key,plan text,status text,valid_until timestamptz);
 create table ai_documents(id uuid primary key,user_id uuid references auth.users(id),source_kind text,document_title text,source_url text,
 enabled boolean default true,processing_status ai_processing_status default 'ready',processing_error text,summary text,word_count integer default 1,
 last_processed_at timestamptz,content_hash text,canonical_url text,author text,published_at text);
 create table ai_document_chunks(id uuid primary key,user_id uuid,document_id uuid references ai_documents(id) on delete cascade,chunk_index integer,
 content text not null,embedding extensions.vector(1536),metadata jsonb default '{}',created_at timestamptz not null default now(),embedding_model text,embedding_version text,unique(document_id,chunk_index));
 create table ai_memories(id uuid primary key,user_id uuid,source_id uuid,memory_type text,memory text not null,importance integer,
 embedding extensions.vector(1536),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),embedding_model text,embedding_version text);`);
 const a=randomUUID(),b=randomUUID();
 await db.query('insert into auth.users values($1),($2)',[a,b]);
 await db.query("insert into ai_entitlements values($1,'pro','active',null),($2,'pro','trialing',null)",[a,b]);
 const migration=fs.readFileSync('supabase/migrations/20261028020000_durable_source_processing.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 const one=async(sql,params)=>(await db.query(sql,params)).rows[0].value;
 const source=async(owner=a)=>{const id=randomUUID();await db.query("insert into ai_documents(id,user_id,source_kind,document_title,source_url) values($1,$2,'link','https://example.com/story','https://example.com/story')",[id,owner]);return id;};
 const enqueue=(id,owner=a,restart=false)=>one('select ai_ingest_enqueue($1,$2,$3) as value',[owner,id,restart]);
 const claim=(owner=a,token=randomUUID())=>one('select ai_ingest_claim($1,$2) as value',[owner,token]);
 const checkpoint=(job,rows,phase,cursor,total=1,payload=null,reset=false,release=true,token=job.lease_token)=>one('select ai_ingest_checkpoint($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9) as value',[job.id,token,JSON.stringify(rows),payload===null?null:JSON.stringify(payload),phase,cursor,total,reset,release]);
 const fail=(job,permanent=false)=>one('select ai_ingest_fail($1,$2,$3,$4) as value',[job.id,job.lease_token,'Temporary provider outage',permanent]);
 const publish=(job,memory,token=job.lease_token)=>one('select ai_ingest_publish($1,$2,$3::jsonb) as value',[job.id,token,JSON.stringify(memory)]);
 const src=await source(),jid=await enqueue(src);
 assert.equal(await enqueue(src),jid,'Duplicate enqueue is idempotent');
 await assert.rejects(enqueue(src,b),/source_not_found/);
 assert.equal(await claim(b),null);
 let job=await claim();assert.equal(job.id,jid);assert.equal(await claim(),null,'An active lease cannot be claimed twice');
 const originalToken=job.lease_token;
 await db.query("insert into ai_document_chunks(id,user_id,document_id,chunk_index,content) values(gen_random_uuid(),$1,$2,0,'ORIGINAL INDEX')",[a,src]);
 const row={id:randomUUID(),user_id:a,document_id:src,chunk_index:0,content:'NEW PRIVATE PASSAGE',created_at:new Date().toISOString(),metadata:{source:'link'}};
 const payload={excerpt:'NEW PRIVATE PASSAGE',word_count:3,title:'Fetched article',content_hash:'newhash'};
 assert.equal(await checkpoint(job,[row],'indexing',0,1,payload,true),true);
 assert.equal((await db.query('select content from ai_document_chunks where document_id=$1',[src])).rows[0].content,'ORIGINAL INDEX','Staging cannot erase the published index');
 job=await claim();assert.notEqual(job.lease_token,originalToken);
 assert.equal(await checkpoint(job,[row],'indexing',0,1,null,false,true,originalToken),false,'Old worker cannot checkpoint');
 const embedded={...row,embedding:Array.from({length:1536},(_,i)=>i===0?1:0),embedding_model:'test-model',embedding_version:'v1'};
 assert.equal(await checkpoint(job,[embedded],'summarizing',1),true);
 job=await claim();assert.equal(job.cursor,1);assert.equal(job.attempts,0,'Successful batches do not spend retry attempts');
 assert.equal(await checkpoint(job,[],'publishing',1,1,{...payload,summary:'A bounded source summary.'}),true);
 job=await claim();
 const memory={id:randomUUID(),user_id:a,source_id:src,memory_type:'theme',memory:'NEW MEMORY',importance:4,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),embedding:embedded.embedding};
 await assert.rejects(publish(job,{...memory,user_id:b}),/invalid_processing_owner/);
 await assert.rejects(publish(job,{...memory,embedding:[1.0]}),/dimensions/);
 assert.equal((await db.query('select content from ai_document_chunks where document_id=$1',[src])).rows[0].content,'ORIGINAL INDEX','Failed publication rolls back');
 assert.equal(await publish(job,memory),true);assert.equal(await publish(job,memory),false,'Late repeated completion cannot duplicate rows');
 const ready=(await db.query('select * from ai_documents where id=$1',[src])).rows[0];
 assert.equal(ready.processing_status,'ready');assert.equal(ready.processing_progress,100);assert.equal(ready.document_title,'Fetched article');
 assert.equal((await db.query('select count(*)::int as n from ai_ingest_chunks where job_id=$1',[jid])).rows[0].n,0);
 assert.equal((await db.query('select payload from ai_ingest_jobs where id=$1',[jid])).rows[0].payload,null,'Transient excerpts are cleared');
 assert.equal((await db.query('select content,extensions.vector_dims(embedding) as dimensions from ai_document_chunks where document_id=$1',[src])).rows[0].dimensions,1536);
 // Reclaimed leases, bounded retries, backoff and manual resume.
 await enqueue(src);job=await claim();const crashed=job;
 await db.query("update ai_ingest_jobs set lease_until=now()-interval '1 minute' where id=$1",[job.id]);
 job=await claim();assert.equal(job.attempts,1);assert.notEqual(job.lease_token,crashed.lease_token);
 assert.equal(await fail(crashed),false,'Expired worker cannot fail a reclaimed job');
 for(let i=0;i<4;i++){
  assert.equal(await fail(job),true);
  assert.equal(await claim(),null,'Retry backoff is respected');
  await db.query("update ai_ingest_jobs set available_at=now()-interval '1 second' where id=$1",[job.id]);
  if(i<3)job=await claim();
 }
 assert.equal((await db.query('select state from ai_ingest_jobs where id=$1',[job.id])).rows[0].state,'failed');
 assert.equal((await db.query('select content from ai_document_chunks where document_id=$1',[src])).rows[0].content,'NEW PRIVATE PASSAGE','Failures preserve previous content');
 assert.equal(await enqueue(src),job.id,'Manual retry resumes the saved job');
 await db.query('update ai_documents set enabled=false where id=$1',[src]);assert.equal(await claim(),null,'Disabled sources are not sent to a provider');
 await db.query('update ai_documents set enabled=true where id=$1',[src]);job=await claim();
 await db.query('update ai_documents set enabled=false where id=$1',[src]);assert.equal(await checkpoint(job,[row],'indexing',0,1,payload,true),false,'Disabling during work fences the checkpoint');
 await db.query('delete from ai_documents where id=$1',[src]);
 assert.equal(await publish(job,memory),false);assert.equal(await checkpoint(job,[row],'indexing',0),false);
 assert.equal((await db.query('select count(*)::int as n from ai_memories where source_id=$1',[src])).rows[0].n,0,'Deletion removes memories even after publication races');
 const paused=await source();await enqueue(paused);
 await db.query("update ai_entitlements set plan='free' where user_id=$1",[a]);assert.equal(await claim(),null,'Downgrade pauses queued work');
 await db.query("update ai_entitlements set plan='pro',valid_until=now()-interval '1 day' where user_id=$1",[a]);assert.equal(await claim(),null,'Expired trials pause queued work');
 await db.query('update ai_entitlements set valid_until=null where user_id=$1',[a]);assert.ok(await claim());
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(enqueue(paused),/permission denied/);
  await assert.rejects(claim(),/permission denied/);
  await assert.rejects(db.query('select * from ai_ingest_jobs'),/permission denied/);
  await assert.rejects(db.query('select * from ai_ingest_chunks'),/permission denied/);
  await db.exec('reset role');
 }
 // Scheduler setup uses a Vault lookup, never a secret literal in cron commands.
 await db.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
 create schema cron;create table cron.job(jobid bigint generated always as identity primary key,jobname text,command text);
 create function cron.unschedule(bigint) returns boolean language sql as $$with gone as(delete from cron.job where jobid=$1 returning 1)select exists(select 1 from gone)$$;
 create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,command) values($1,$3) returning jobid$$;
 create schema net;create table net.test_calls(url text,headers jsonb,timeout_milliseconds integer);
 create function net.http_get(url text,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$with saved as(insert into net.test_calls values(url,headers,timeout_milliseconds))select 1::bigint$$;`);
 const setup=fs.readFileSync('supabase/setup/ingestion-cron.sql','utf8');
 await assert.rejects(db.exec(setup),/Vault secret first/);
 const secret='random-fixture-value-at-least-thirty-two-characters';
 await db.query('insert into vault.decrypted_secrets values($1,$2)',['unoword_ingestion_token',secret]);
 await db.exec(setup);await db.exec(setup);
 const schedules=(await db.query('select * from cron.job')).rows;
 assert.equal(schedules.length,1);assert.ok(!schedules[0].command.includes(secret));
 await db.exec(schedules[0].command);
 const scheduled=(await db.query('select * from net.test_calls')).rows[0];
 assert.equal(scheduled.url,'https://unoword.vercel.app/api/internal/ingestion');
 assert.equal(scheduled.headers.Authorization,'Bearer '+secret);assert.equal(scheduled.timeout_milliseconds,60000);
 await db.close();
 console.log('PASS: actual SQL/pgvector migration + reapply; owner isolation; duplicate enqueue; leases and crash recovery; batch checkpoints; atomic publication/rollback; retries/backoff/resume; consent/revocation; delete cleanup; downgrade/expiry; private tables/RPCs.');
})().catch(error=>{console.error(error);process.exitCode=1;});
