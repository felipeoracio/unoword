-- Additive writing workspace. No existing AI, billing or history rows are changed.
begin;
create table if not exists public.writing_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  unique(user_id,id)
);
create table if not exists public.writing_documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled' check (length(title) between 1 and 300),
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}',
  plain_text text not null default '' check (length(plain_text)<=200000),
  folder_id uuid,
  favorite boolean not null default false,
  status text not null default 'active' check (status in ('active','archived','trashed')),
  ai_allowed boolean not null default false,
  revision integer not null default 1 check (revision>0),
  mutation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(user_id,folder_id) references public.writing_folders(user_id,id),
  check (octet_length(content::text)<=1048576)
);
create index if not exists writing_documents_owner_updated on public.writing_documents(user_id,updated_at desc);
create table if not exists public.writing_activity (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.writing_documents(id) on delete cascade,
  started_at timestamptz not null,
  updated_at timestamptz not null default now(),
  typed_words integer not null check (typed_words between 0 and 1000000),
  pasted_words integer not null default 0 check (pasted_words between 0 and 1000000),
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  sequence integer not null check (sequence>=1)
);
create index if not exists writing_activity_owner_started on public.writing_activity(user_id,started_at desc);
alter table public.writing_folders enable row level security;
alter table public.writing_documents enable row level security;
alter table public.writing_activity enable row level security;
drop policy if exists writing_folder_owner on public.writing_folders;
create policy writing_folder_owner on public.writing_folders for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists writing_document_owner on public.writing_documents;
create policy writing_document_owner on public.writing_documents for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists writing_activity_owner on public.writing_activity;
create policy writing_activity_owner on public.writing_activity for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and exists(select 1 from public.writing_documents d where d.id=document_id and d.user_id=auth.uid()));
revoke all on public.writing_folders,public.writing_documents,public.writing_activity from anon;
grant select,insert,update,delete on public.writing_folders,public.writing_documents,public.writing_activity to authenticated;

-- Compare-and-swap plus a mutation UUID: retrying a lost response is idempotent.
create or replace function public.workspace_save_document(p_id uuid,p_revision integer,p_mutation uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare existing public.writing_documents; saved public.writing_documents;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into existing from public.writing_documents where id=p_id and user_id=auth.uid() for update;
  if found then
    if existing.mutation_id=p_mutation then return to_jsonb(existing); end if;
    if existing.revision<>p_revision then raise exception 'revision_conflict' using errcode='40001'; end if;
    update public.writing_documents set
      title=p_data->>'title',content=p_data->'content',plain_text=p_data->>'plain_text',
      folder_id=(p_data->>'folder_id')::uuid,favorite=(p_data->>'favorite')::boolean,
      status=p_data->>'status',ai_allowed=(p_data->>'ai_allowed')::boolean,
      mutation_id=p_mutation,revision=revision+1,updated_at=clock_timestamp()
      where id=p_id and user_id=auth.uid() returning * into saved;
  else
    if p_revision<>0 then raise exception 'document_not_found' using errcode='P0002'; end if;
    insert into public.writing_documents(id,user_id,title,content,plain_text,folder_id,favorite,status,ai_allowed,mutation_id)
    values(p_id,auth.uid(),p_data->>'title',p_data->'content',p_data->>'plain_text',(p_data->>'folder_id')::uuid,
      (p_data->>'favorite')::boolean,p_data->>'status',(p_data->>'ai_allowed')::boolean,p_mutation)
    returning * into saved;
  end if;
  return to_jsonb(saved);
exception when unique_violation then
  select * into existing from public.writing_documents where id=p_id and user_id=auth.uid();
  if found and existing.mutation_id=p_mutation then return to_jsonb(existing); end if;
  raise exception 'revision_conflict' using errcode='40001';
end $$;

create or replace function public.workspace_save_activity(p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved public.writing_activity;
begin
  insert into public.writing_activity(id,user_id,document_id,started_at,typed_words,pasted_words,duration_seconds,sequence)
  values((p_data->>'id')::uuid,auth.uid(),(p_data->>'document_id')::uuid,(p_data->>'started_at')::timestamptz,
    (p_data->>'typed_words')::integer,(p_data->>'pasted_words')::integer,(p_data->>'duration_seconds')::integer,(p_data->>'sequence')::integer)
  on conflict(id) do update set typed_words=excluded.typed_words,pasted_words=excluded.pasted_words,
    duration_seconds=excluded.duration_seconds,sequence=excluded.sequence,updated_at=clock_timestamp()
    where writing_activity.user_id=auth.uid() and writing_activity.document_id=excluded.document_id
      and writing_activity.started_at=excluded.started_at and writing_activity.sequence<excluded.sequence
  returning * into saved;
  if saved.id is null then select * into saved from public.writing_activity where id=(p_data->>'id')::uuid and user_id=auth.uid(); end if;
  return to_jsonb(saved);
end $$;
revoke all on function public.workspace_save_document(uuid,integer,uuid,jsonb),public.workspace_save_activity(jsonb) from public,anon;
grant execute on function public.workspace_save_document(uuid,integer,uuid,jsonb),public.workspace_save_activity(jsonb) to authenticated;

-- Reserve shared AI quota before a provider call; concurrent Vercel instances
-- cannot exceed the configured daily allowance. Existing usage remains counted.
create table if not exists public.workspace_ai_requests (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date, state text not null default 'pending' check(state in('pending','done')),
  created_at timestamptz not null default now()
);
alter table public.workspace_ai_requests enable row level security;
revoke all on public.workspace_ai_requests from public,anon,authenticated;
grant all on public.workspace_ai_requests to service_role;
create or replace function public.workspace_reserve_ai(p_user uuid,p_request uuid,p_limit integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
  if exists(select 1 from public.workspace_ai_requests where id=p_request) then return false; end if;
  select count(*) into used from public.ai_usage where user_id=p_user and date=(now() at time zone 'utc')::date and request_type='suggestion';
  used:=used+(select count(*) from public.workspace_ai_requests where user_id=p_user and date=(now() at time zone 'utc')::date and (state='done' or created_at>now()-interval '5 minutes'));
  if p_limit<=0 or used>=p_limit then return false; end if;
  insert into public.workspace_ai_requests(id,user_id,date) values(p_request,p_user,(now() at time zone 'utc')::date);
  return true;
end $$;
revoke all on function public.workspace_reserve_ai(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.workspace_reserve_ai(uuid,uuid,integer) to service_role;
commit;
