/** Execute scheduler SQL in isolated PostgreSQL with local Cron/net stand-ins. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.PGLITE_ROOT||path.resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite');
test('Substack schedule is repeatable, preserves other jobs and uses Vault only in headers',async()=>{
 const db=new PGlite();
 const sql=fs.readFileSync('supabase/setup/substack-cron.sql','utf8');
 try{
  await db.exec(`create schema vault;create schema cron;create schema net;
   create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
   create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);
   create table net.requests(id bigserial primary key,url text,headers jsonb,timeout_ms integer);
   create function cron.unschedule(p_id bigint) returns boolean language plpgsql as $$begin delete from cron.job where jobid=p_id;return found;end$$;
   create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language plpgsql as $$declare result bigint;begin insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command) returning jobid into result;return result;end$$;
   create function net.http_get(url text,headers jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare result bigint;begin insert into net.requests(url,headers,timeout_ms) values(url,headers,timeout_milliseconds) returning id into result;return result;end$$;
   insert into cron.job(jobname,schedule,command) values('unoword-source-processing','* * * * *','unchanged source job'),('unoword-substack-sync','0 * * * *','previous schedule');`);
  const before=(await db.query('select * from cron.job order by jobid')).rows;
  await assert.rejects(()=>db.exec(sql),/Vault secret first/);
  assert.deepEqual((await db.query('select * from cron.job order by jobid')).rows,before,'missing credentials never remove existing jobs');
  const token='synthetic-worker-token-with-more-than-32-characters';
  await db.query('insert into vault.decrypted_secrets values($1,$2)',['unoword_ingestion_token',token]);
  await db.exec(sql);await db.exec(sql);
  const jobs=(await db.query('select * from cron.job order by jobid')).rows;
  assert.equal(jobs.length,2);assert.deepEqual(jobs[0],before[0],'existing source-processing schedule survives');
  const scheduled=jobs.find(j=>j.jobname==='unoword-substack-sync');
  assert.equal(scheduled.schedule,'*/5 * * * *');assert.equal(scheduled.active,true);
  assert.ok(!scheduled.command.includes(token),'no literal token is stored in the scheduled command');
  await db.exec(scheduled.command);
  const request=(await db.query('select * from net.requests')).rows[0];
  assert.equal(request.url,'https://unoword.vercel.app/api/internal/substack-sync');
  assert.deepEqual(request.headers,{Authorization:'Bearer '+token});assert.equal(request.timeout_ms,60000);
  await db.query('insert into cron.job(jobname,schedule,command) values($1,$2,$3)',['existing-custom-substack-job','*/5 * * * *',scheduled.command]);
  const unchanged=(await db.query('select * from cron.job order by jobid')).rows;
  await assert.rejects(()=>db.exec(sql),/different active job already schedules/);
  assert.deepEqual((await db.query('select * from cron.job order by jobid')).rows,unchanged,'another schedule is never silently duplicated or changed');
 }finally{await db.close()}
});
