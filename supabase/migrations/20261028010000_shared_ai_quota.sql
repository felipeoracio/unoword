-- One allowance for extension suggestions and editor tools. Additive: historical
-- usage, entitlement limits, billing and existing writing are preserved.
begin;
alter table public.workspace_ai_requests add column if not exists request_type text
  not null default 'workspace_assistant'
  check (request_type in ('suggestion','workspace_assistant'));
create index if not exists workspace_ai_requests_owner_date
  on public.workspace_ai_requests(user_id,date,created_at) where state='pending';

create or replace function public.ai_reserve_request(p_user uuid,p_request uuid,p_limit integer,p_type text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare used bigint; day_key date;
begin
  if p_limit is null or p_limit<=0 or p_type not in ('suggestion','workspace_assistant') or p_type is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
  day_key := (clock_timestamp() at time zone 'utc')::date;
  if exists(select 1 from public.workspace_ai_requests where id=p_request) then return false; end if;
  select count(*) into used from public.ai_usage where user_id=p_user and date=day_key
    and request_type in ('suggestion','workspace_assistant');
  -- Completed reservations are represented by ai_usage, never counted twice.
  used:=used+(select count(*) from public.workspace_ai_requests where user_id=p_user and date=day_key
    and state='pending' and created_at>clock_timestamp()-interval '5 minutes');
  if used>=p_limit then return false; end if;
  insert into public.workspace_ai_requests(id,user_id,date,request_type,created_at)
    values(p_request,p_user,day_key,p_type,clock_timestamp());
  return true;
end $$;

-- Compatibility for older editor instances during deployment.
create or replace function public.workspace_reserve_ai(p_user uuid,p_request uuid,p_limit integer)
returns boolean language sql security definer set search_path=public,pg_temp as $$
  select public.ai_reserve_request(p_user,p_request,p_limit,'workspace_assistant');
$$;

create or replace function public.ai_complete_request(p_user uuid,p_request uuid,p_input_tokens integer,p_output_tokens integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare reservation public.workspace_ai_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
  select * into reservation from public.workspace_ai_requests where id=p_request and user_id=p_user for update;
  if not found then return false; end if;
  -- Retrying a committed completion is safe, including after UTC midnight.
  if reservation.state='done' then
    return exists(select 1 from public.ai_usage where id=p_request and user_id=p_user);
  end if;
  if reservation.created_at<=clock_timestamp()-interval '5 minutes' then return false; end if;
  insert into public.ai_usage(id,user_id,date,request_type,input_tokens,output_tokens,estimated_cost)
    values(p_request,p_user,reservation.date,reservation.request_type,p_input_tokens,p_output_tokens,
      case when p_input_tokens is not null and p_output_tokens is not null
        then round((p_input_tokens::numeric*0.15+p_output_tokens::numeric*0.60)/1000000,6) else null end);
  update public.workspace_ai_requests set state='done' where id=p_request and user_id=p_user;
  return true;
end $$;

create or replace function public.ai_release_request(p_user uuid,p_request uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
  delete from public.workspace_ai_requests where id=p_request and user_id=p_user and state='pending';
end $$;

create or replace function public.ai_usage_summary(p_user uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('date',day_key,
    'used_today',(select count(*) from public.ai_usage where user_id=p_user and date=day_key
      and request_type in ('suggestion','workspace_assistant')),
    'total_today',(select count(*) from public.ai_usage where user_id=p_user and date=day_key),
    'pending_today',(select count(*) from public.workspace_ai_requests where user_id=p_user and date=day_key
      and state='pending' and created_at>now()-interval '5 minutes'))
  from (select (now() at time zone 'utc')::date as day_key) today;
$$;
revoke all on function public.ai_reserve_request(uuid,uuid,integer,text),
  public.workspace_reserve_ai(uuid,uuid,integer),public.ai_complete_request(uuid,uuid,integer,integer),
  public.ai_release_request(uuid,uuid),public.ai_usage_summary(uuid) from public,anon,authenticated;
grant execute on function public.ai_reserve_request(uuid,uuid,integer,text),
  public.workspace_reserve_ai(uuid,uuid,integer),public.ai_complete_request(uuid,uuid,integer,integer),
  public.ai_release_request(uuid,uuid),public.ai_usage_summary(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
