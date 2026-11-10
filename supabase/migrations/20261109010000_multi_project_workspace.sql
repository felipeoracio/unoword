-- Additive projects and context boundaries. Existing writing/files/history stay put.
begin;
create table if not exists public.writing_projects (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 150),
 description text not null default '' check(length(description)<=4000),
 project_type text not null default 'other' check(length(project_type) between 1 and 100),
 status text not null default 'planning' check(status in ('planning','in_progress','paused','completed','archived')),
 goals jsonb not null default '{}' check(jsonb_typeof(goals)='object' and octet_length(goals::text)<=4000),
 preferences jsonb not null default '{}' check(jsonb_typeof(preferences)='object' and octet_length(preferences::text)<=12000),
 target_date date, revision bigint not null default 1 check(revision>0), mutation_id uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,id)
);
create index if not exists writing_projects_owner_updated on public.writing_projects(user_id,updated_at desc);
create table if not exists public.writing_project_resources (
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null, resource_kind text not null check(resource_kind in ('document','source','memory','writing_session')),
 resource_id uuid not null, created_at timestamptz not null default now(),
 primary key(project_id,resource_kind,resource_id),
 foreign key(user_id,project_id) references public.writing_projects(user_id,id) on delete cascade
);
create index if not exists writing_project_resources_owner_resource on public.writing_project_resources(user_id,resource_kind,resource_id);
create table if not exists public.writing_resource_versions (
 user_id uuid not null references auth.users(id) on delete cascade,
 resource_kind text not null check(resource_kind in ('document','source','memory','writing_session')),
 resource_id uuid not null, revision bigint not null default 1, mutation_id uuid not null,
 updated_at timestamptz not null default now(), primary key(user_id,resource_kind,resource_id)
);
create table if not exists public.writing_workspace_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 active_project_id uuid references public.writing_projects(id) on delete set null,
 last_documents jsonb not null default '{}' check(jsonb_typeof(last_documents)='object' and octet_length(last_documents::text)<=65536),
 revision bigint not null default 1, mutation_id uuid not null, updated_at timestamptz not null default now()
);
alter table public.ai_suggestions add column if not exists project_id uuid references public.writing_projects(id) on delete set null;
create index if not exists ai_suggestions_owner_project on public.ai_suggestions(user_id,project_id,created_at desc);

-- Existing quota RPCs insert a fixed column list. Carry the project reference
-- through their existing context JSON and materialize it in the same transaction.
create or replace function public.workspace_suggestion_project(p_context text)
returns uuid language plpgsql immutable set search_path=public,pg_temp as $$
begin return (p_context::jsonb->>'project_id')::uuid;
exception when invalid_text_representation then return null;end $$;
create or replace function public.workspace_bind_suggestion_project()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then new.project_id:=coalesce(new.project_id,workspace_suggestion_project(new.context_summary));end if;
 if new.project_id is not null and not exists(select 1 from writing_projects where id=new.project_id and user_id=new.user_id) then
  raise exception 'project_not_found' using errcode='42501';end if;
 return new;
end $$;
drop trigger if exists bind_suggestion_project on public.ai_suggestions;
create trigger bind_suggestion_project before insert or update of project_id,user_id on public.ai_suggestions for each row execute function public.workspace_bind_suggestion_project();

-- Reads are owner-scoped. Mutations go through validated, revisioned RPCs only.
-- Keep these statements explicit so schema/security inspection sees RLS before commit.
alter table public.writing_projects enable row level security;
alter table public.writing_project_resources enable row level security;
alter table public.writing_resource_versions enable row level security;
alter table public.writing_workspace_preferences enable row level security;
do $$ declare name text; begin
 foreach name in array array['writing_projects','writing_project_resources','writing_resource_versions','writing_workspace_preferences'] loop
  execute format('drop policy if exists project_owner on public.%I',name);
  execute format('create policy project_owner on public.%I for select to authenticated using(user_id=auth.uid() and public.workspace_has_pro_access())',name);
  execute format('revoke all on public.%I from public,anon,authenticated',name);
  execute format('grant select on public.%I to authenticated',name);
 end loop;
end $$;

create or replace function public.workspace_project_owner()
returns uuid language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.workspace_has_pro_access() then
  raise exception 'writing_workspace_pro_required' using errcode='42501';
 end if;
 return auth.uid();
end $$;

create or replace function public.workspace_resource_owned(p_user uuid,p_kind text,p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case p_kind
 when 'document' then exists(select 1 from writing_documents where user_id=p_user and id=p_id)
 when 'source' then exists(select 1 from ai_documents where user_id=p_user and id=p_id)
 when 'memory' then exists(select 1 from ai_memories where user_id=p_user and id=p_id)
 when 'writing_session' then exists(select 1 from ai_writing_sessions where user_id=p_user and id=p_id)
 else false end;
$$;

create or replace function public.workspace_save_project(p_id uuid,p_revision bigint,p_mutation uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;

create or replace function public.workspace_assign_resource(p_kind text,p_id uuid,p_projects uuid[],p_revision bigint,p_mutation uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;

create or replace function public.workspace_select_project(p_project uuid,p_revision bigint,p_mutation uuid,p_last_documents jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;

create or replace function public.workspace_delete_project(p_id uuid,p_revision bigint,p_name text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;

create or replace function public.workspace_project_state()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u uuid:=public.workspace_project_owner(); prefs jsonb;
begin
 select to_jsonb(p) into prefs from writing_workspace_preferences p where user_id=u;
 return jsonb_build_object('user_id',u,
  'projects',(select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc),'[]') from writing_projects p where p.user_id=u),
  'associations',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from writing_project_resources r where r.user_id=u),
  'resource_versions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from writing_resource_versions r where r.user_id=u),
  'preferences',coalesce(prefs,jsonb_build_object('user_id',u,'active_project_id',null,'last_documents','{}'::jsonb,'revision',0)),
  'updated_at',now());
end $$;

-- Resource deletion removes only obsolete associations. Existing ingestion owns
-- file/chunk/vector cleanup; project assignment never copies or deletes a file.
create or replace function public.workspace_project_resource_deleted()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 delete from writing_project_resources where resource_kind=tg_argv[0] and resource_id=old.id;
 delete from writing_resource_versions where resource_kind=tg_argv[0] and resource_id=old.id;
 return old;
end $$;
do $$ declare item record; begin
 for item in select * from (values('writing_documents','document'),('ai_documents','source'),('ai_memories','memory'),('ai_writing_sessions','writing_session')) names(tab,kind) loop
  execute format('drop trigger if exists project_resource_cleanup on public.%I',item.tab);
  execute format('create trigger project_resource_cleanup after delete on public.%I for each row execute function public.workspace_project_resource_deleted(%L)',item.tab,item.kind);
 end loop;
end $$;

create or replace function public.workspace_resource_catalog()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u uuid:=public.workspace_project_owner(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc),'[]') into result from (
  select 'document'::text resource_kind,id,title,ai_allowed allowed,status::text state,updated_at from writing_documents where user_id=u and status<>'trashed'
  union all select 'source',id,document_title,enabled and processing_status='ready',processing_status::text,updated_at from ai_documents where user_id=u
  union all select 'memory',id,memory_type::text||': '||left(memory,80),true,'ready',updated_at from ai_memories where user_id=u and source_id is null
  union all select 'writing_session',id,'Saved writing · '||created_at::date,save_to_memory,'ready',created_at from ai_writing_sessions where user_id=u
 ) r;
 return result;
end $$;

-- Content requests use JSON bodies (not enormous URL in-filters). Both ownership
-- and current source consent are enforced before text is selected.
create or replace function public.workspace_context_rows(p_kind text,p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u uuid:=public.workspace_project_owner(); result jsonb;
begin
 case p_kind
 when 'memory' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (
   select m.id,m.source_id,m.memory_type,m.memory,m.importance from ai_memories m where m.user_id=u and m.id=any(p_ids)
    and (m.source_id is null or exists(select 1 from ai_documents d where d.user_id=u and d.id=m.source_id and d.enabled and d.processing_status='ready')
     or exists(select 1 from ai_writing_sessions w where w.user_id=u and w.id=m.source_id and w.save_to_memory))
    order by m.importance desc,m.updated_at desc limit 200) r;
 when 'source' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (
   select id,document_title,source_kind,summary,description,source_url from ai_documents where user_id=u and id=any(p_ids) and enabled and processing_status='ready'
    order by updated_at desc limit 200) r;
 when 'suggestion' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select * from ai_suggestions where user_id=u and id=any(p_ids) order by created_at desc limit 15) r;
 when 'feedback' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select id,helpful,reason,note from ai_feedback where user_id=u and id=any(p_ids) order by created_at desc limit 10) r;
 else raise exception 'invalid_resource_kind' using errcode='22023';
 end case;
 return result;
end $$;

-- Only IDs/metadata are resolved here; callers cannot retrieve another project's
-- text and then ask a model to ignore it. Matching RPCs below filter BEFORE content.
create or replace function public.workspace_resource_in_scope(p_user uuid,p_kind text,p_id uuid,p_scope text,p_project uuid,p_selected jsonb)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case
 when p_scope='all_projects' then true
 when p_scope='selected_resources' then exists(select 1 from jsonb_array_elements(p_selected) r where r->>'kind'=p_kind and (r->>'id')::uuid=p_id)
 when p_scope='current_project' and p_project is not null then exists(select 1 from writing_project_resources where user_id=p_user and project_id=p_project and resource_kind=p_kind and resource_id=p_id)
 when p_scope='current_project' then not exists(select 1 from writing_project_resources where user_id=p_user and resource_kind=p_kind and resource_id=p_id)
 else false end;
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
  and public.workspace_resource_in_scope(u,'document',id,p_scope,active_id,p_selected);
 select coalesce(array_agg(id),'{}') into request_docs from writing_documents where user_id=u and status='active'
  and public.workspace_resource_in_scope(u,'document',id,p_scope,active_id,p_selected);
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

-- Scoped pgvector/keyword query. IDs are obtained from the owner's resolver;
-- this RPC is service-only and never callable with anon/authenticated keys.
create or replace function public.match_project_chunks(p_user_id uuid,p_sources uuid[],p_memories uuid[],p_sessions uuid[],p_query_embedding extensions.vector(1536) default null,p_terms text[] default '{}',p_count integer default 12,p_threshold float default .25)
returns table(source_type text,source_id uuid,parent_id uuid,content text,similarity float)
language sql stable security definer set search_path=public,extensions,pg_temp as $$
 with q as (select websearch_to_tsquery('simple',array_to_string(p_terms,' ')) tsq), eligible as (
  select 'document_chunk'::text kind,c.id,c.document_id parent,c.content,c.embedding from ai_document_chunks c join ai_documents d on d.id=c.document_id
   where c.user_id=p_user_id and d.user_id=p_user_id and d.enabled and d.processing_status='ready' and c.document_id=any(p_sources)
  union all select 'writing_chunk',c.id,c.writing_session_id,c.content,c.embedding from ai_writing_chunks c join ai_writing_sessions s on s.id=c.writing_session_id
   where c.user_id=p_user_id and s.user_id=p_user_id and s.save_to_memory and s.id=any(p_sessions)
  union all select 'memory',m.id,m.source_id,m.memory,m.embedding from ai_memories m where m.user_id=p_user_id and m.id=any(p_memories) and (m.source_id is null
    or exists(select 1 from ai_documents d where d.id=m.source_id and d.user_id=p_user_id and d.enabled and d.processing_status='ready')
    or exists(select 1 from ai_writing_sessions w where w.id=m.source_id and w.user_id=p_user_id and w.save_to_memory))
 ), scored as (
  select e.*,case when p_query_embedding is not null then 1-(embedding<=>p_query_embedding)
   else ts_rank(to_tsvector('simple',content),q.tsq)::float end score from eligible e cross join q
  where (p_query_embedding is not null and embedding is not null) or (p_query_embedding is null and to_tsvector('simple',content)@@q.tsq)
 ) select kind,id,parent,content,score from scored where p_query_embedding is null or score>=p_threshold order by score desc limit greatest(1,least(p_count,20));
$$;

-- Bounded passages from opted-in editor documents, never a whole-library read.
create or replace function public.workspace_document_passages(p_ids uuid[],p_query text default '')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u uuid:=public.workspace_project_owner(); result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'plain_text',substring(plain_text from greatest(1,strpos(lower(plain_text),lower(left(p_query,50)))-150) for 1000))),'[]') into result
 from (select id,title,plain_text from writing_documents where user_id=u and id=any(p_ids) and ai_allowed and status='active' order by updated_at desc limit 8) documents;
 return result;
end $$;

-- Project reports reuse each unique document's existing activity records.
-- Shared documents can appear in several projects, but account totals are never
-- formed by adding these overlapping views. No session/history row is copied.
create or replace function public.workspace_project_statistics(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u uuid:=public.workspace_project_owner(); tz text; today date; result jsonb;
begin
 if not exists(select 1 from writing_projects where id=p_project and user_id=u) then raise exception 'project_not_found' using errcode='P0002';end if;
 select coalesce(timezone,'UTC') into tz from writing_progress_preferences where user_id=u;
 tz:=coalesce(tz,'UTC');today:=(now() at time zone tz)::date;
 with docs as (select d.id,d.updated_at from writing_documents d join writing_project_resources r on r.resource_kind='document' and r.resource_id=d.id
  where r.project_id=p_project and r.user_id=u and d.user_id=u and d.status<>'trashed'),
 activity as (select a.* from writing_activity a where a.user_id=u and a.document_id in(select id from docs) and a.started_at<=now())
 select jsonb_build_object('project_id',p_project,'timezone',tz,'reporting_date',today,'document_count',(select count(*) from docs),
  'total_words',coalesce(sum(typed_words),0),
  'daily_words',coalesce(sum(typed_words) filter(where (started_at at time zone tz)::date=today),0),
  'weekly_words',coalesce(sum(typed_words) filter(where (started_at at time zone tz)::date>=date_trunc('week',today::timestamp)::date),0),
  'last_activity',greatest(max(updated_at),(select max(updated_at) from docs)),
  'word_policy','existing_typed_activity_for_unique_associated_documents') into result from activity;
 return result;
end $$;

-- Guided answers live in the existing canonical onboarding-answer store.
-- Structured JSON is versioned; legacy profile fields/answers are not migrated
-- or erased. Question-level CAS permits independent steps on separate devices.
create or replace function public.workspace_save_profile_answer(p_question text,p_title text,p_answer jsonb,p_revision bigint,p_mutation uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;

-- Explicit grants; definer helpers are not public APIs.
revoke all on function public.workspace_bind_suggestion_project(),public.workspace_suggestion_project(text),public.workspace_resource_owned(uuid,text,uuid),public.workspace_resource_in_scope(uuid,text,uuid,text,uuid,jsonb),public.workspace_project_resource_deleted() from public,anon,authenticated;
revoke all on function public.match_project_chunks(uuid,uuid[],uuid[],uuid[],extensions.vector,text[],integer,float) from public,anon,authenticated;
grant execute on function public.match_project_chunks(uuid,uuid[],uuid[],uuid[],extensions.vector,text[],integer,float) to service_role;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('workspace_project_owner','workspace_save_project','workspace_assign_resource','workspace_select_project','workspace_delete_project','workspace_project_state','workspace_resource_catalog','workspace_context_rows','workspace_ai_scope','workspace_document_passages','workspace_project_statistics','workspace_save_profile_answer') loop
  execute format('revoke all on function %s from public,anon',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
