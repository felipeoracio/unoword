-- Durable private source processing. No existing source, history, quota or
-- billing rows are rewritten. Apply after the existing knowledge migrations.
begin;
alter table public.ai_documents add column if not exists processing_phase text;
alter table public.ai_documents add column if not exists processing_progress integer not null default 0
  check(processing_progress between 0 and 100);

create table if not exists public.ai_ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique references public.ai_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'queued' check(state in ('queued','running','done','failed')),
  phase text not null default 'extracting' check(phase in ('extracting','indexing','summarizing','publishing','complete')),
  cursor integer not null default 0 check(cursor>=0), total integer not null default 0 check(total>=0),
  attempts integer not null default 0 check(attempts>=0),
  available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
  payload jsonb, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists ai_ingest_jobs_due on public.ai_ingest_jobs(available_at,updated_at)
  where state in ('queued','running');
create table if not exists public.ai_ingest_chunks (
  job_id uuid not null references public.ai_ingest_jobs(id) on delete cascade,
  chunk_index integer not null check(chunk_index>=0), payload jsonb not null,
  primary key(job_id,chunk_index)
);
alter table public.ai_ingest_jobs enable row level security;
alter table public.ai_ingest_chunks enable row level security;
revoke all on public.ai_ingest_jobs,public.ai_ingest_chunks from public,anon,authenticated;
grant all on public.ai_ingest_jobs,public.ai_ingest_chunks to service_role;

create or replace function public.ai_ingest_enqueue(p_user uuid,p_source uuid,p_restart boolean default false)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare source public.ai_documents; job public.ai_ingest_jobs; job_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,784));
  select * into source from public.ai_documents where id=p_source and user_id=p_user for update;
  if not found then raise exception 'source_not_found' using errcode='P0002'; end if;
  select * into job from public.ai_ingest_jobs where source_id=p_source and user_id=p_user for update;
  if found and job.state in ('queued','running') then return job.id; end if;
  if (select count(*) from public.ai_ingest_jobs where user_id=p_user and state in ('queued','running'))>=10 then
    raise exception 'processing_queue_full' using errcode='P0001';
  end if;
  if job.id is not null and job.state='failed' and not p_restart then
    update public.ai_ingest_jobs set state='queued',attempts=0,available_at=clock_timestamp(),
      lease_token=null,lease_until=null,last_error=null,updated_at=clock_timestamp() where id=job.id;
    job_id:=job.id;
  else
    delete from public.ai_ingest_jobs where source_id=p_source and user_id=p_user;
    insert into public.ai_ingest_jobs(source_id,user_id) values(p_source,p_user) returning id into job_id;
  end if;
  update public.ai_documents set processing_status='pending',processing_phase='queued',
    processing_error=null,processing_progress=0 where id=p_source and user_id=p_user;
  return job_id;
end $$;

create or replace function public.ai_ingest_claim(p_user uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.ai_ingest_jobs;
begin
  -- Serialize only the short claim transaction; model work runs without locks.
  if p_token is null then return null; end if;
  perform pg_advisory_xact_lock(784,1);
  select j.* into job from public.ai_ingest_jobs j join public.ai_documents d on d.id=j.source_id and d.user_id=j.user_id
    join public.ai_entitlements e on e.user_id=j.user_id
    where (j.state='queued' or (j.state='running' and j.lease_until<=clock_timestamp()))
      and j.available_at<=clock_timestamp() and d.enabled=true
      and (p_user is null or j.user_id=p_user) and e.plan in ('pro','premium') and e.status in ('active','trialing')
      and (e.valid_until is null or e.valid_until>=clock_timestamp())
      and not exists(select 1 from public.ai_ingest_jobs other where other.user_id=j.user_id
        and other.state='running' and other.lease_until>clock_timestamp())
    order by j.available_at,j.updated_at limit 1;
  if not found then return null; end if;
  -- All writers lock source before job, matching source deletion/FK cascades.
  perform 1 from public.ai_documents where id=job.source_id and user_id=job.user_id for update;
  if not found then return null; end if;
  select * into job from public.ai_ingest_jobs where id=job.id for update;
  if not found then return null; end if;
  if job.state='running' then
    update public.ai_ingest_jobs set attempts=attempts+1 where id=job.id returning * into job;
    if job.attempts>=5 then
      update public.ai_ingest_jobs set state='failed',lease_token=null,lease_until=null,
        last_error='Processing was interrupted. Retry to continue.' where id=job.id;
      update public.ai_documents set processing_status='failed',processing_phase='failed',
        processing_error='Processing was interrupted. Retry to continue.' where id=job.source_id and user_id=job.user_id;
      return null;
    end if;
  end if;
  update public.ai_ingest_jobs set state='running',lease_token=p_token,lease_until=clock_timestamp()+interval '3 minutes',
    updated_at=clock_timestamp() where id=job.id returning * into job;
  update public.ai_documents set processing_status='processing',processing_phase=job.phase,processing_error=null
    where id=job.source_id and user_id=job.user_id;
  return to_jsonb(job);
end $$;

create or replace function public.ai_ingest_checkpoint(p_job uuid,p_token uuid,p_rows jsonb,
  p_payload jsonb,p_phase text,p_cursor integer,p_total integer,p_reset boolean,p_release boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.ai_ingest_jobs; item jsonb;
begin
  select * into job from public.ai_ingest_jobs where id=p_job;
  if not found then return false; end if;
  perform 1 from public.ai_documents where id=job.source_id and user_id=job.user_id for update;
  if not found then return false; end if;
  select * into job from public.ai_ingest_jobs where id=p_job for update;
  if not found or job.state<>'running' or job.lease_token is distinct from p_token or job.lease_until<=clock_timestamp() then return false; end if;
  -- Recheck consent under a row lock. A concurrent delete cannot be resurrected.
  perform 1 from public.ai_documents where id=job.source_id and user_id=job.user_id and enabled=true for update;
  if not found then return false; end if;
  if p_phase not in ('extracting','indexing','summarizing','publishing') or p_cursor<0 or p_total<0 or p_cursor>p_total then
    raise exception 'invalid_processing_checkpoint';
  end if;
  if p_reset then delete from public.ai_ingest_chunks where job_id=p_job; end if;
  for item in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    if (item->>'user_id')::uuid is distinct from job.user_id or (item->>'document_id')::uuid is distinct from job.source_id then
      raise exception 'invalid_processing_owner';
    end if;
    insert into public.ai_ingest_chunks(job_id,chunk_index,payload) values(p_job,(item->>'chunk_index')::integer,item)
      on conflict(job_id,chunk_index) do update set payload=excluded.payload;
  end loop;
  update public.ai_ingest_jobs set payload=coalesce(p_payload,payload),phase=p_phase,cursor=p_cursor,total=p_total,
    state=case when p_release then 'queued' else 'running' end,
    lease_token=case when p_release then null else lease_token end,
    lease_until=case when p_release then null else lease_until end,
    last_error=null,available_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_job;
  update public.ai_documents set processing_phase=p_phase,processing_progress=
    case when p_phase='extracting' then 5 when p_phase='indexing' then 10+least(75,75*p_cursor/greatest(1,p_total))
      when p_phase='summarizing' then 90 else 95 end where id=job.source_id and user_id=job.user_id;
  return true;
end $$;

create or replace function public.ai_ingest_fail(p_job uuid,p_token uuid,p_error text,p_permanent boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.ai_ingest_jobs; terminal boolean;
begin
  select * into job from public.ai_ingest_jobs where id=p_job;
  if not found then return false; end if;
  perform 1 from public.ai_documents where id=job.source_id and user_id=job.user_id for update;
  if not found then return false; end if;
  select * into job from public.ai_ingest_jobs where id=p_job for update;
  if not found or job.state<>'running' or job.lease_token is distinct from p_token or job.lease_until<=clock_timestamp() then return false; end if;
  terminal:=p_permanent or job.attempts>=4;
  update public.ai_ingest_jobs set attempts=attempts+1,state=case when terminal then 'failed' else 'queued' end,
    available_at=clock_timestamp()+make_interval(secs=>least(1800,30*power(4,least(attempts,3)))::integer),
    lease_token=null,lease_until=null,last_error=left(p_error,500),updated_at=clock_timestamp() where id=p_job;
  update public.ai_documents set processing_status=case when terminal then 'failed'::public.ai_processing_status else 'pending'::public.ai_processing_status end,
    processing_phase=case when terminal then 'failed' else 'retry' end,
    processing_error=left(p_error,500) where id=job.source_id and user_id=job.user_id;
  return true;
end $$;

create or replace function public.ai_ingest_publish(p_job uuid,p_token uuid,p_memory jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.ai_ingest_jobs; source public.ai_documents;
begin
  select * into job from public.ai_ingest_jobs where id=p_job;
  if not found then return false; end if;
  perform 1 from public.ai_documents where id=job.source_id and user_id=job.user_id for update;
  if not found then return false; end if;
  select * into job from public.ai_ingest_jobs where id=p_job for update;
  if not found or job.state<>'running' or job.lease_token is distinct from p_token or job.lease_until<=clock_timestamp() or job.phase<>'publishing' then return false; end if;
  select * into source from public.ai_documents where id=job.source_id and user_id=job.user_id for update;
  if not found or not source.enabled then return false; end if;
  if not exists(select 1 from public.ai_entitlements where user_id=job.user_id and plan in ('pro','premium')
    and status in ('active','trialing') and (valid_until is null or valid_until>=clock_timestamp())) then return false; end if;
  if job.total<=0 or job.cursor<>job.total or (select count(*) from public.ai_ingest_chunks where job_id=p_job)<>job.total then
    raise exception 'incomplete_processing_index';
  end if;
  if (p_memory->>'user_id')::uuid is distinct from job.user_id or (p_memory->>'source_id')::uuid is distinct from job.source_id
    or exists(select 1 from public.ai_ingest_chunks where job_id=p_job and
      ((payload->>'user_id')::uuid is distinct from job.user_id or (payload->>'document_id')::uuid is distinct from job.source_id)) then
    raise exception 'invalid_processing_owner';
  end if;
  delete from public.ai_document_chunks where document_id=job.source_id and user_id=job.user_id;
  insert into public.ai_document_chunks(id,user_id,document_id,chunk_index,content,embedding,metadata,embedding_model,embedding_version)
    select (payload->>'id')::uuid,job.user_id,job.source_id,chunk_index,payload->>'content',
      (payload->>'embedding')::extensions.vector,coalesce(payload->'metadata','{}'::jsonb),
      payload->>'embedding_model',payload->>'embedding_version'
    from public.ai_ingest_chunks where job_id=p_job;
  delete from public.ai_memories where user_id=job.user_id and source_id=job.source_id;
  insert into public.ai_memories(id,user_id,source_id,memory_type,memory,importance,embedding,embedding_model,embedding_version)
    values((p_memory->>'id')::uuid,job.user_id,job.source_id,'theme',p_memory->>'memory',4,
      (p_memory->>'embedding')::extensions.vector,p_memory->>'embedding_model',p_memory->>'embedding_version');
  update public.ai_documents set summary=left(job.payload->>'summary',2000),
    document_title=case when source_kind='link' and document_title=source_url
      then coalesce(nullif(job.payload->>'title',''),document_title) else document_title end,
    word_count=(job.payload->>'word_count')::integer,processing_status='ready',processing_phase='complete',processing_progress=100,
    processing_error=job.payload->>'index_note',last_processed_at=clock_timestamp(),
    content_hash=coalesce(job.payload->>'content_hash',content_hash),
    canonical_url=coalesce(job.payload->>'canonical_url',canonical_url),author=coalesce(job.payload->>'author',author),
    published_at=coalesce(job.payload->>'published_at',published_at)
    where id=job.source_id and user_id=job.user_id;
  delete from public.ai_ingest_chunks where job_id=p_job;
  update public.ai_ingest_jobs set state='done',phase='complete',payload=null,lease_token=null,lease_until=null,
    last_error=null,updated_at=clock_timestamp() where id=p_job;
  return true;
end $$;

-- Also covers deletion racing with a worker's final transaction.
create or replace function public.ai_source_cleanup_memory()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin delete from public.ai_memories where user_id=old.user_id and source_id=old.id; return old; end $$;
drop trigger if exists ai_source_cleanup_memory on public.ai_documents;
create trigger ai_source_cleanup_memory after delete on public.ai_documents for each row execute function public.ai_source_cleanup_memory();

revoke all on function public.ai_ingest_enqueue(uuid,uuid,boolean),public.ai_ingest_claim(uuid,uuid),
  public.ai_ingest_checkpoint(uuid,uuid,jsonb,jsonb,text,integer,integer,boolean,boolean),
  public.ai_ingest_fail(uuid,uuid,text,boolean),public.ai_ingest_publish(uuid,uuid,jsonb),
  public.ai_source_cleanup_memory() from public,anon,authenticated;
grant execute on function public.ai_ingest_enqueue(uuid,uuid,boolean),public.ai_ingest_claim(uuid,uuid),
  public.ai_ingest_checkpoint(uuid,uuid,jsonb,jsonb,text,integer,integer,boolean,boolean),
  public.ai_ingest_fail(uuid,uuid,text,boolean),public.ai_ingest_publish(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
