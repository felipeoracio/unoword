begin;
CREATE OR REPLACE FUNCTION public.workspace_assign_resource(p_kind text, p_id uuid, p_projects uuid[], p_revision bigint, p_mutation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare u uuid:=public.workspace_project_owner(); current writing_resource_versions; saved writing_resource_versions; target uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,991));
 case p_kind
 when 'document' then perform 1 from writing_documents where user_id=u and id=p_id for key share;
 when 'source' then perform 1 from ai_documents where user_id=u and id=p_id for key share;
 when 'memory' then perform 1 from ai_memories where user_id=u and id=p_id for key share;
 when 'writing_session' then perform 1 from ai_writing_sessions where user_id=u and id=p_id for key share;
 else raise exception 'invalid_resource_kind' using errcode='22023';end case;
 if not found then raise exception 'resource_not_found' using errcode='P0002';end if;
 select * into current from writing_resource_versions where user_id=u and resource_kind=p_kind and resource_id=p_id for update;
 if found and current.mutation_id=p_mutation then
  return to_jsonb(current)||jsonb_build_object('project_ids',(select coalesce(jsonb_agg(project_id order by project_id),'[]') from writing_project_resources where user_id=u and resource_kind=p_kind and resource_id=p_id));
 end if;
 if coalesce(current.revision,0)<>p_revision then raise exception 'resource_revision_conflict' using errcode='40001';end if;
 foreach target in array coalesce(p_projects,array[]::uuid[]) loop
  perform 1 from writing_projects where id=target and user_id=u for update;
  if not found then raise exception 'project_not_found' using errcode='P0002';end if;
 end loop;
 delete from writing_project_resources where user_id=u and resource_kind=p_kind and resource_id=p_id;
 insert into writing_project_resources(user_id,project_id,resource_kind,resource_id)
  select u,id,p_kind,p_id from (select distinct unnest(coalesce(p_projects,array[]::uuid[])) id) selected;
 insert into writing_resource_versions(user_id,resource_kind,resource_id,mutation_id)
  values(u,p_kind,p_id,p_mutation) on conflict(user_id,resource_kind,resource_id) do update
  set revision=writing_resource_versions.revision+1,mutation_id=excluded.mutation_id,updated_at=clock_timestamp() returning * into saved;
 return to_jsonb(saved)||jsonb_build_object('project_ids',to_jsonb(coalesce(p_projects,array[]::uuid[])));
end $function$;

CREATE OR REPLACE FUNCTION public.workspace_save_profile_answer(p_question text, p_title text, p_answer jsonb, p_revision bigint, p_mutation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare u uuid:=public.workspace_project_owner(); current ai_onboarding_answers; saved ai_onboarding_answers; parsed jsonb:='{}'; next_answer jsonb;
begin
 if p_question not in ('types','goals','style','challenges','motivations','audience','assistance','experience','tone','frequency')
  or jsonb_typeof(p_answer)<>'object' or octet_length(p_answer::text)>12000 then raise exception 'invalid_profile_answer' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_question,994));
 select * into current from ai_onboarding_answers where user_id=u and question_id='setup:'||p_question for update;
 if found then
  begin parsed:=current.answer::jsonb;exception when invalid_text_representation then parsed:='{}';end;
  if parsed->>'mutation_id'=p_mutation::text then return to_jsonb(current);end if;
 end if;
 if coalesce((parsed->>'revision')::bigint,0)<>p_revision then raise exception 'profile_answer_conflict' using errcode='40001';end if;
 next_answer:=p_answer||jsonb_build_object('version',1,'revision',p_revision+1,'mutation_id',p_mutation);
 if current.id is not null and parsed->>'version' is distinct from '1' then
  next_answer:=next_answer||jsonb_build_object('legacy_answer',current.answer);
 elsif parsed ? 'legacy_answer' then next_answer:=next_answer||jsonb_build_object('legacy_answer',parsed->>'legacy_answer');end if;
 insert into ai_onboarding_answers(user_id,question_id,question,answer)
  values(u,'setup:'||p_question,p_title,next_answer::text) on conflict(user_id,question_id) do update
  set question=excluded.question,answer=excluded.answer,updated_at=clock_timestamp() returning * into saved;
 return to_jsonb(saved);
end $function$;

CREATE OR REPLACE FUNCTION public.workspace_delete_project(p_id uuid, p_revision bigint, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare u uuid:=public.workspace_project_owner(); current writing_projects;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,991));
 select * into current from writing_projects where id=p_id and user_id=u for update;
 if not found then raise exception 'project_not_found' using errcode='P0002';end if;
 if current.revision<>p_revision then raise exception 'project_revision_conflict' using errcode='40001';end if;
 if current.name<>p_name then raise exception 'project_confirmation_required' using errcode='22023';end if;
 -- Only associations and project metadata are removed. No writing/file row is deleted.
 update writing_workspace_preferences set active_project_id=case when active_project_id=p_id then null else active_project_id end,
  last_documents=last_documents-p_id::text,revision=revision+1,updated_at=clock_timestamp()
  where user_id=u and (active_project_id=p_id or last_documents ? p_id::text);
 update writing_resource_versions set revision=revision+1,updated_at=clock_timestamp()
  where user_id=u and (resource_kind,resource_id) in (select resource_kind,resource_id from writing_project_resources where project_id=p_id);
 delete from writing_projects where user_id=u and id=p_id;
 return jsonb_build_object('deleted',p_id,'resources_preserved',true);
end $function$;

CREATE OR REPLACE FUNCTION public.workspace_save_project(p_id uuid, p_revision bigint, p_mutation uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare u uuid:=public.workspace_project_owner(); current writing_projects; saved writing_projects;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,991));
 select * into current from writing_projects where user_id=u and id=p_id for update;
 if found then
  if current.mutation_id=p_mutation then return to_jsonb(current); end if;
  if current.revision<>p_revision then raise exception 'project_revision_conflict' using errcode='40001';end if;
  update writing_projects set name=btrim(p_data->>'name'),description=coalesce(p_data->>'description',''),
   project_type=coalesce(p_data->>'project_type','other'),status=coalesce(p_data->>'status','planning'),
   goals=coalesce(p_data->'goals','{}'),preferences=coalesce(p_data->'preferences','{}'),target_date=(p_data->>'target_date')::date,
   revision=revision+1,mutation_id=p_mutation,updated_at=clock_timestamp()
   where id=p_id and user_id=u returning * into saved;
 else
  if p_revision<>0 then raise exception 'project_not_found' using errcode='P0002';end if;
  insert into writing_projects(id,user_id,name,description,project_type,status,goals,preferences,target_date,mutation_id)
   values(p_id,u,btrim(p_data->>'name'),coalesce(p_data->>'description',''),coalesce(p_data->>'project_type','other'),
   coalesce(p_data->>'status','planning'),coalesce(p_data->'goals','{}'),coalesce(p_data->'preferences','{}'),(p_data->>'target_date')::date,p_mutation)
   returning * into saved;
 end if;
 if saved.status='archived' then
  update writing_workspace_preferences set active_project_id=null,revision=revision+1,updated_at=clock_timestamp()
   where user_id=u and active_project_id=saved.id;
 end if;
 return to_jsonb(saved);
end $function$;

CREATE OR REPLACE FUNCTION public.workspace_select_project(p_project uuid, p_revision bigint, p_mutation uuid, p_last_documents jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare u uuid:=public.workspace_project_owner(); current writing_workspace_preferences; saved writing_workspace_preferences; entry record;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,991));
 select * into current from writing_workspace_preferences where user_id=u for update;
 if found and current.mutation_id=p_mutation then return to_jsonb(current);end if;
 if coalesce(current.revision,0)<>p_revision then raise exception 'workspace_preference_conflict' using errcode='40001';end if;
 if p_project is not null and not exists(select 1 from writing_projects where id=p_project and user_id=u and status<>'archived') then
  raise exception 'project_not_found' using errcode='P0002';end if;
 if jsonb_typeof(p_last_documents)<>'object' then raise exception 'invalid_last_documents' using errcode='22023';end if;
 for entry in select * from jsonb_each_text(p_last_documents) loop
  if entry.key<>'general' and not exists(select 1 from writing_projects where user_id=u and id=entry.key::uuid) then
   raise exception 'project_not_found' using errcode='P0002';end if;
  if entry.value is not null and not public.workspace_resource_owned(u,'document',entry.value::uuid) then
   raise exception 'document_not_found' using errcode='P0002';end if;
 end loop;
 insert into writing_workspace_preferences(user_id,active_project_id,last_documents,mutation_id)
  values(u,p_project,p_last_documents,p_mutation) on conflict(user_id) do update
  set active_project_id=excluded.active_project_id,last_documents=writing_workspace_preferences.last_documents||excluded.last_documents,
   revision=writing_workspace_preferences.revision+1,mutation_id=excluded.mutation_id,updated_at=clock_timestamp() returning * into saved;
 return to_jsonb(saved);
end $function$;

CREATE OR REPLACE FUNCTION public.workspace_save_document(p_id uuid, p_revision integer, p_mutation uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;
notify pgrst,'reload schema';
commit;
