-- Additive, explicit AI-context permissions. Existing document memberships,
-- account/session statistics and opt-in decisions are preserved. NULL target
-- lists retain legacy project membership; [] explicitly means General writing.
begin;
alter table public.writing_documents add column if not exists ai_context_all_projects boolean not null default false;
alter table public.writing_documents add column if not exists ai_context_project_ids uuid[] check (cardinality(ai_context_project_ids) <= 200);

create or replace function public.workspace_save_document(p_id uuid,p_revision integer,p_mutation uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare existing public.writing_documents; saved public.writing_documents; target_ids uuid[];
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into existing from public.writing_documents where id=p_id and user_id=auth.uid() for update;
  if found then
    if existing.mutation_id=p_mutation then return to_jsonb(existing); end if;
    if existing.revision<>p_revision then raise exception 'revision_conflict' using errcode='40001'; end if;

    if p_data ? 'ai_context_project_ids' and p_data->'ai_context_project_ids' <> 'null'::jsonb then
      if jsonb_typeof(p_data->'ai_context_project_ids') <> 'array' or jsonb_array_length(p_data->'ai_context_project_ids') > 200 then
        raise exception 'invalid_ai_context_projects' using errcode='22023';
      end if;
      select coalesce(array_agg(distinct value::uuid),'{}') into target_ids from jsonb_array_elements_text(p_data->'ai_context_project_ids');
      if exists(select 1 from unnest(target_ids) target where not exists(
        select 1 from public.writing_projects project where project.id=target and project.user_id=auth.uid())
        and not target=any(coalesce(existing.ai_context_project_ids,'{}'))) then
        raise exception 'invalid_ai_context_projects' using errcode='22023';
      end if;
    else target_ids:=existing.ai_context_project_ids;
    end if;
    update public.writing_documents set
      title=p_data->>'title',content=p_data->'content',plain_text=p_data->>'plain_text',
      folder_id=(p_data->>'folder_id')::uuid,favorite=(p_data->>'favorite')::boolean,
      completion_status=coalesce(p_data->>'completion_status',existing.completion_status),
      status=p_data->>'status',ai_allowed=(p_data->>'ai_allowed')::boolean,
      ai_context_all_projects=coalesce((p_data->>'ai_context_all_projects')::boolean,existing.ai_context_all_projects),ai_context_project_ids=target_ids,
      mutation_id=p_mutation,revision=revision+1,updated_at=clock_timestamp()
      where id=p_id and user_id=auth.uid() returning * into saved;
  else
    if p_revision<>0 then raise exception 'document_not_found' using errcode='P0002'; end if;

    if p_data ? 'ai_context_project_ids' and p_data->'ai_context_project_ids' <> 'null'::jsonb then
      if jsonb_typeof(p_data->'ai_context_project_ids') <> 'array' or jsonb_array_length(p_data->'ai_context_project_ids') > 200 then
        raise exception 'invalid_ai_context_projects' using errcode='22023';
      end if;
      select coalesce(array_agg(distinct value::uuid),'{}') into target_ids from jsonb_array_elements_text(p_data->'ai_context_project_ids');
      if exists(select 1 from unnest(target_ids) target where not exists(
        select 1 from public.writing_projects project where project.id=target and project.user_id=auth.uid())
        and not target=any(coalesce(existing.ai_context_project_ids,'{}'))) then
        raise exception 'invalid_ai_context_projects' using errcode='22023';
      end if;
    else target_ids:=existing.ai_context_project_ids;
    end if;
    insert into public.writing_documents(id,user_id,title,content,plain_text,folder_id,favorite,status,ai_allowed,mutation_id,completion_status,ai_context_all_projects,ai_context_project_ids)
    values(p_id,auth.uid(),p_data->>'title',p_data->'content',p_data->>'plain_text',(p_data->>'folder_id')::uuid,
      (p_data->>'favorite')::boolean,p_data->>'status',(p_data->>'ai_allowed')::boolean,p_mutation,coalesce(p_data->>'completion_status','draft'),coalesce((p_data->>'ai_context_all_projects')::boolean,false),target_ids)
    returning * into saved;
  end if;
  return to_jsonb(saved);
exception when unique_violation then
  select * into existing from public.writing_documents where id=p_id and user_id=auth.uid();
  if found and existing.mutation_id=p_mutation then return to_jsonb(existing); end if;
  raise exception 'revision_conflict' using errcode='40001';
end $$;

create or replace function public.workspace_document_context_target(p_user uuid,p_document uuid,p_project uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select d.ai_context_all_projects or case
   when d.ai_context_project_ids is null then public.workspace_resource_in_scope(p_user,'document',p_document,'current_project',p_project,'[]')
   when p_project is null then cardinality(d.ai_context_project_ids)=0
   else p_project=any(d.ai_context_project_ids)
 end
 from public.writing_documents d where d.user_id=p_user and d.id=p_document;
$$;

create or replace function public.workspace_ai_scope(p_scope text default 'current_project',p_project uuid default null,p_use_active boolean default true,p_selected jsonb default '[]')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u uuid:=public.workspace_project_owner(); active_id uuid; project jsonb; r jsonb;
 refs uuid[]:='{}'; docs uuid[]:='{}'; request_docs uuid[]:='{}'; mems uuid[]:='{}'; sessions uuid[]:='{}'; evidence uuid[]:='{}'; suggestions uuid[]:='{}'; feedback uuid[]:='{}';
begin
 if p_scope not in ('current_project','selected_resources','all_projects','profile_only','none') then raise exception 'invalid_context_scope' using errcode='22023';end if;
 if jsonb_typeof(p_selected)<>'array' or jsonb_array_length(p_selected)>200 then raise exception 'invalid_resource_selection' using errcode='22023';end if;
 if p_use_active then select active_project_id into active_id from writing_workspace_preferences where user_id=u;else active_id:=p_project;end if;
 if active_id is not null then
  select to_jsonb(p) into project from writing_projects p where user_id=u and id=active_id and status<>'archived';
  if project is null then
   if not p_use_active then raise exception 'project_not_found' using errcode='P0002';end if;
   active_id:=null;
  end if;
 end if;
 if p_scope='selected_resources' then
  for r in select * from jsonb_array_elements(p_selected) loop
   if not public.workspace_resource_owned(u,r->>'kind',(r->>'id')::uuid) then raise exception 'resource_not_found' using errcode='P0002';end if;
  end loop;
 end if;
 select coalesce(array_agg(id),'{}') into refs from ai_documents where user_id=u and enabled and processing_status='ready'
  and public.workspace_resource_in_scope(u,'source',id,p_scope,active_id,p_selected);
 select coalesce(array_agg(id),'{}') into docs from writing_documents where user_id=u and ai_allowed and status='active'
  and public.workspace_document_context_target(u,id,active_id)
  and (p_scope in ('current_project','all_projects') or (p_scope='selected_resources' and public.workspace_resource_in_scope(u,'document',id,p_scope,active_id,p_selected)));
 select coalesce(array_agg(id),'{}') into request_docs from writing_documents where user_id=u and status='active'
  and public.workspace_document_context_target(u,id,active_id)
  and (p_scope in ('current_project','all_projects') or (p_scope='selected_resources' and public.workspace_resource_in_scope(u,'document',id,p_scope,active_id,p_selected)));
 select coalesce(array_agg(id),'{}') into sessions from ai_writing_sessions where user_id=u and save_to_memory
  and public.workspace_resource_in_scope(u,'writing_session',id,p_scope,active_id,p_selected);
 select coalesce(array_agg(m.id),'{}') into mems from ai_memories m where m.user_id=u and (
  (m.source_id is null and public.workspace_resource_in_scope(u,'memory',m.id,p_scope,active_id,p_selected))
  or m.source_id=any(refs||sessions)
 ) and p_scope not in ('none','profile_only');
 select refs||docs||mems||sessions||coalesce(array_agg(c.id),'{}') into evidence from ai_document_chunks c where c.user_id=u and c.document_id=any(refs);
 select evidence||coalesce(array_agg(c.id),'{}') into evidence from ai_writing_chunks c where c.user_id=u and c.writing_session_id=any(sessions);
 if p_scope not in ('none','profile_only') then
  select coalesce(array_agg(s.id),'{}') into suggestions from ai_suggestions s where s.user_id=u
   and (p_scope='all_projects' or coalesce(s.project_id,workspace_suggestion_project(s.context_summary)) is not distinct from active_id)
   and cardinality(s.source_ids)>0 and s.source_ids<@(evidence||coalesce((select array_agg(id) from ai_profiles where user_id=u),'{}'));
  select coalesce(array_agg(id),'{}') into feedback from ai_feedback where user_id=u and suggestion_id=any(suggestions);
 end if;
 return jsonb_build_object('scope',p_scope,'project_id',active_id,'project',case when p_scope in ('none','profile_only') then null else project end,
  'profile_enabled',p_scope<>'none','source_ids',refs,'document_ids',docs,'request_document_ids',request_docs,'memory_ids',mems,'session_ids',sessions,
  'suggestion_ids',suggestions,'feedback_ids',feedback,'resource_count',cardinality(refs)+cardinality(docs)+cardinality(mems)+cardinality(sessions));
end $$;

-- Keep revision-safe saves invoker-scoped and private helper execution internal.
revoke all on function public.workspace_save_document(uuid,integer,uuid,jsonb) from public,anon;
grant execute on function public.workspace_save_document(uuid,integer,uuid,jsonb) to authenticated;
revoke all on function public.workspace_document_context_target(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.workspace_ai_scope(text,uuid,boolean,jsonb) from public,anon;
grant execute on function public.workspace_ai_scope(text,uuid,boolean,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
