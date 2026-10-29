-- Additive completion state and timestamp-based session timers.
-- Existing documents stay drafts; existing archive/trash, content and history remain intact.
-- Apply after 20261028040000_verified_streak_presentation.sql. Transactional and repeatable.
begin;
alter table public.writing_documents add column if not exists completion_status text not null default 'draft'
  check(completion_status in ('draft','completed'));
alter table public.writing_documents add column if not exists completed_at timestamptz;
alter table public.writing_activity add column if not exists timer jsonb
  check(timer is null or (
    jsonb_typeof(timer)='object' and timer ?& array['status','active_ms','paused_ms','changed_at']
    and timer - array['status','active_ms','paused_ms','changed_at']='{}'::jsonb
    and jsonb_typeof(timer->'status')='string' and timer->>'status' in ('active','paused','ended')
    and jsonb_typeof(timer->'active_ms')='number' and (timer->>'active_ms')::numeric between 0 and 315360000000
    and jsonb_typeof(timer->'paused_ms')='number' and (timer->>'paused_ms')::numeric between 0 and 315360000000
    and jsonb_typeof(timer->'changed_at')='number' and (timer->>'changed_at')::numeric between 0 and 9999999999999
  ));
create index if not exists writing_documents_owner_completion
 on public.writing_documents(user_id,completion_status,updated_at desc);
create index if not exists writing_activity_document_owner
 on public.writing_activity(document_id,user_id) where document_id is not null;
-- Database time is authoritative. A repeated save never moves a completion date.
create or replace function public.workspace_completion_timestamp()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.completion_status='draft' then new.completed_at:=null;
 elsif tg_op='INSERT' then new.completed_at:=clock_timestamp();
 elsif old.completion_status is distinct from new.completion_status then new.completed_at:=clock_timestamp();
 else new.completed_at:=old.completed_at;
 end if;
 return new;
end $$;
drop trigger if exists writing_document_completion_timestamp on public.writing_documents;
create trigger writing_document_completion_timestamp before insert or update on public.writing_documents
 for each row execute function public.workspace_completion_timestamp();
revoke all on function public.workspace_completion_timestamp() from public,anon,authenticated;
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
      completion_status=coalesce(p_data->>'completion_status',existing.completion_status),
      status=p_data->>'status',ai_allowed=(p_data->>'ai_allowed')::boolean,
      mutation_id=p_mutation,revision=revision+1,updated_at=clock_timestamp()
      where id=p_id and user_id=auth.uid() returning * into saved;
  else
    if p_revision<>0 then raise exception 'document_not_found' using errcode='P0002'; end if;
    insert into public.writing_documents(id,user_id,title,content,plain_text,folder_id,favorite,status,ai_allowed,mutation_id,completion_status)
    values(p_id,auth.uid(),p_data->>'title',p_data->'content',p_data->>'plain_text',(p_data->>'folder_id')::uuid,
      (p_data->>'favorite')::boolean,p_data->>'status',(p_data->>'ai_allowed')::boolean,p_mutation,coalesce(p_data->>'completion_status','draft'))
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
  insert into public.writing_activity(id,user_id,document_id,started_at,typed_words,pasted_words,duration_seconds,sequence,timer)
  values((p_data->>'id')::uuid,auth.uid(),(p_data->>'document_id')::uuid,(p_data->>'started_at')::timestamptz,
    (p_data->>'typed_words')::integer,(p_data->>'pasted_words')::integer,(p_data->>'duration_seconds')::integer,(p_data->>'sequence')::bigint,p_data->'timer')
  on conflict(id) do update set typed_words=excluded.typed_words,pasted_words=excluded.pasted_words,
    duration_seconds=excluded.duration_seconds,timer=coalesce(excluded.timer,writing_activity.timer),sequence=excluded.sequence,updated_at=clock_timestamp()
    where writing_activity.user_id=auth.uid() and writing_activity.document_id=excluded.document_id
      and writing_activity.started_at=excluded.started_at and writing_activity.sequence<excluded.sequence
  returning * into saved;
  if saved.id is null then select * into saved from public.writing_activity where id=(p_data->>'id')::uuid and user_id=auth.uid(); end if;
  return to_jsonb(saved);
end $$;
revoke all on function public.workspace_save_document(uuid,integer,uuid,jsonb),public.workspace_save_activity(jsonb) from public,anon;
grant execute on function public.workspace_save_document(uuid,integer,uuid,jsonb),public.workspace_save_activity(jsonb) to authenticated;
-- Empty only the explicitly confirmed Trash snapshot. A concurrent restore or
-- edit changes its revision and is skipped. Missing rows make retries safe.
create or replace function public.workspace_empty_trash(p_documents jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare deleted uuid[]; removed uuid[]; activity_ids uuid[]; ended_time bigint;
begin
 if auth.uid() is null or not public.workspace_has_pro_access() then
  raise exception 'writing_workspace_pro_required' using errcode='42501';
 end if;
 if p_documents is null or jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents) not between 1 and 1000 then
  raise exception 'invalid_trash_snapshot' using errcode='22023';
 end if;
 select array_agg(id) into deleted from (
  select d.id from public.writing_documents d
  where d.user_id=auth.uid() and d.status='trashed'
   and exists(select 1 from jsonb_array_elements(p_documents) p where (p->>'id')::uuid=d.id and (p->>'revision')::integer=d.revision)
  for update
 ) locked;
 select array_agg(id) into activity_ids from public.writing_activity where user_id=auth.uid() and document_id=any(coalesce(deleted,array[]::uuid[])) and timer->>'status' in ('active','paused');
 ended_time:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 -- Freeze only sessions belonging to the removed documents; other sessions keep running.
 update public.writing_activity set
  duration_seconds=least(86400,floor(((timer->>'active_ms')::numeric + case when timer->>'status'='active' then greatest(0,ended_time-(timer->>'changed_at')::numeric) else 0 end)/1000))::integer,
  timer=jsonb_build_object('status','ended','active_ms',(timer->>'active_ms')::numeric+case when timer->>'status'='active' then greatest(0,ended_time-(timer->>'changed_at')::numeric) else 0 end,
    'paused_ms',(timer->>'paused_ms')::numeric+case when timer->>'status'='paused' then greatest(0,ended_time-(timer->>'changed_at')::numeric) else 0 end,'changed_at',ended_time),
  sequence=sequence+1,updated_at=clock_timestamp()
 where user_id=auth.uid() and id=any(coalesce(activity_ids,array[]::uuid[])) and timer->>'status' in ('active','paused');
 delete from public.writing_documents where user_id=auth.uid() and id=any(coalesce(deleted,array[]::uuid[])) and status='trashed';
 select array_agg(distinct (p->>'id')::uuid) into removed from jsonb_array_elements(p_documents) p
 where not exists(select 1 from public.writing_documents d where d.id=(p->>'id')::uuid and d.user_id=auth.uid());
 return jsonb_build_object('deleted_ids',coalesce(to_jsonb(deleted),'[]'::jsonb),'removed_ids',coalesce(to_jsonb(removed),'[]'::jsonb),
   'activities',coalesce((select jsonb_agg(to_jsonb(a)) from public.writing_activity a where a.user_id=auth.uid() and a.id=any(coalesce(activity_ids,array[]::uuid[]))),'[]'::jsonb));
end $$;
revoke all on function public.workspace_empty_trash(jsonb) from public,anon;
grant execute on function public.workspace_empty_trash(jsonb) to authenticated;
-- Existing owner and restrictive Pro RLS policies continue covering all new fields.
notify pgrst, 'reload schema';
commit;
