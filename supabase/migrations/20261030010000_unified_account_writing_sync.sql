-- Unified account statistics. Additive; never resets history, streaks or billing.
-- Apply after 20261029010000_session_pause_document_completion.sql.
begin;
alter table public.writing_activity add column if not exists active_intervals jsonb;
alter table public.writing_activity add column if not exists device_id text check(length(device_id)<=100);
alter table public.writing_progress_preferences add column if not exists daily_goal integer not null default 250 check(daily_goal between 1 and 1000000);
alter table public.writing_progress_preferences add column if not exists timezone text;
alter table public.writing_progress_preferences add column if not exists language text not null default 'en' check(language in ('en','es'));
alter table public.writing_progress_preferences add column if not exists themes jsonb;
alter table public.writing_progress_preferences add column if not exists revision bigint not null default 0;
-- Validate even direct authenticated REST writes, not just the API.
create or replace function public.writing_validate_intervals() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare pair jsonb; a bigint; b bigint; last_end bigint:=0; total bigint:=0;
begin
 if new.active_intervals is null then return new; end if;
 if jsonb_typeof(new.active_intervals)<>'array' or jsonb_array_length(new.active_intervals)>2000 then
 raise exception 'invalid_active_intervals' using errcode='22023'; end if;
 for pair in select * from jsonb_array_elements(new.active_intervals) loop
  if jsonb_typeof(pair)<>'array' or jsonb_array_length(pair)<>2
    or jsonb_typeof(pair->0)<>'number' or jsonb_typeof(pair->1)<>'number' then
    raise exception 'invalid_active_intervals' using errcode='22023'; end if;
  a:=(pair->>0)::bigint;b:=(pair->>1)::bigint;
  if a<extract(epoch from new.started_at)*1000 or a<last_end or b<=a or b>extract(epoch from clock_timestamp())*1000+300000 then
   raise exception 'invalid_active_intervals' using errcode='22023'; end if;
  total:=total+b-a;last_end:=b;
 end loop;
 if total>86400000 or abs(total/1000.0-new.duration_seconds)>=2 then
 raise exception 'inconsistent_active_duration' using errcode='22023'; end if;
 return new;
end $$;
drop trigger if exists writing_validate_intervals on public.writing_activity;
create trigger writing_validate_intervals before insert or update of active_intervals,duration_seconds on public.writing_activity
 for each row execute function public.writing_validate_intervals();
revoke all on function public.writing_validate_intervals() from public,anon,authenticated;
create or replace function public.workspace_save_activity(p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved public.writing_activity;
begin
  insert into public.writing_activity(id,user_id,document_id,started_at,typed_words,pasted_words,duration_seconds,sequence,timer,active_intervals,device_id)
  values((p_data->>'id')::uuid,auth.uid(),(p_data->>'document_id')::uuid,(p_data->>'started_at')::timestamptz,
    (p_data->>'typed_words')::integer,(p_data->>'pasted_words')::integer,(p_data->>'duration_seconds')::integer,(p_data->>'sequence')::bigint,p_data->'timer',p_data->'active_intervals',p_data->>'device_id')
  on conflict(id) do update set typed_words=excluded.typed_words,pasted_words=excluded.pasted_words,
    duration_seconds=excluded.duration_seconds,timer=coalesce(excluded.timer,writing_activity.timer),active_intervals=excluded.active_intervals,device_id=coalesce(writing_activity.device_id,excluded.device_id),sequence=excluded.sequence,updated_at=clock_timestamp()
    where writing_activity.user_id=auth.uid() and writing_activity.document_id=excluded.document_id
      and writing_activity.started_at=excluded.started_at and writing_activity.sequence<excluded.sequence
  returning * into saved;
  if saved.id is null then select * into saved from public.writing_activity where id=(p_data->>'id')::uuid and user_id=auth.uid(); end if;
  return to_jsonb(saved);
end $$;
create or replace function public.writing_sync_extension(p_user uuid,p_sessions jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; cutoff timestamptz; keep_key text; sid uuid; n integer:=0;
begin
 if jsonb_array_length(p_sessions)>500 then raise exception 'too_many_activity_rows'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,784));
 select cleared_before,keep_extension_key into cutoff,keep_key from public.writing_progress_preferences where user_id=p_user;
 for item in select * from jsonb_array_elements(p_sessions) loop
 if length(item->>'key')>100 or (item->>'started_at')::timestamptz>now()+interval '5 minutes'
 or (item->>'started_at')::timestamptz<'2000-01-01'::timestamptz then raise exception 'invalid_activity_time'; end if;
 if cutoff is not null and (item->>'started_at')::timestamptz<=cutoff and (item->>'key') is distinct from keep_key then continue; end if;
 sid:=md5(p_user::text||':extension:'||(item->>'key'))::uuid;
 insert into public.writing_activity(id,user_id,document_id,started_at,typed_words,pasted_words,duration_seconds,sequence,source,client_key,timer,active_intervals,device_id)
 values(sid,p_user,null,(item->>'started_at')::timestamptz,(item->>'typed_words')::integer,(item->>'pasted_words')::integer,
 (item->>'duration_seconds')::integer,(item->>'sequence')::bigint,'extension',item->>'key',item->'timer',item->'active_intervals',item->>'device_id')
 on conflict(id) do update set typed_words=excluded.typed_words,pasted_words=excluded.pasted_words,duration_seconds=excluded.duration_seconds,
 timer=coalesce(excluded.timer,writing_activity.timer),active_intervals=excluded.active_intervals,device_id=coalesce(writing_activity.device_id,excluded.device_id),sequence=excluded.sequence,updated_at=clock_timestamp()
 where writing_activity.user_id=p_user and writing_activity.source='extension' and writing_activity.sequence<excluded.sequence;
 n:=n+1;
 end loop;
 return n;
end $$;


-- Service-only, account-scoped preferences. This table already has RLS and no
-- anon/authenticated grants. Revision CAS prevents stale-device settings writes.
create or replace function public.writing_account_preferences(p_user uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('user_id',p_user,'daily_goal',coalesce(p.daily_goal,250),'timezone',p.timezone,
 'language',coalesce(p.language,'en'),'themes',p.themes,'revision',coalesce(p.revision,0))
 from (select 1) singleton left join public.writing_progress_preferences p on p.user_id=p_user;
$$;
create or replace function public.writing_update_preferences(p_user uuid,p_revision bigint,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare current jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,784));
 current:=public.writing_account_preferences(p_user);
 if (current->>'revision')::bigint<>p_revision then return jsonb_build_object('conflict',true,'current',current);end if;
 if p_patch ? 'timezone' and not exists(select 1 from pg_timezone_names where name=p_patch->>'timezone') then
 raise exception 'invalid_timezone';end if;
 insert into public.writing_progress_preferences(user_id) values(p_user) on conflict do nothing;
 update public.writing_progress_preferences set
 daily_goal=coalesce((p_patch->>'daily_goal')::integer,daily_goal),timezone=coalesce(p_patch->>'timezone',timezone),
 language=coalesce(p_patch->>'language',language),themes=coalesce(p_patch->'themes',themes),revision=revision+1,updated_at=clock_timestamp()
 where user_id=p_user;
 return public.writing_account_preferences(p_user);
end $$;

create or replace function public.writing_streak_presentation(p_user uuid,p_timezone text,p_unlimited boolean,p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actual integer; history integer; result jsonb;
begin
 p_timezone:=coalesce((select timezone from public.writing_progress_preferences where user_id=p_user),p_timezone);
 actual:=public.writing_actual_streak(p_user,p_timezone,p_now);
 result:=jsonb_build_object('displayedStreak',case when p_unlimited then actual else least(actual,7) end,
 'hasUnlimitedStreakAccess',p_unlimited,'streakLimitReached',not p_unlimited and actual>=7,
 'journeyContinues',not p_unlimited and actual>7,'timezone',p_timezone,'asOf',p_now);
 if p_unlimited then
 history:=public.writing_historical_streak(p_user,p_timezone);
 result:=result||jsonb_build_object('longestStreak',history,'milestones',(select coalesce(jsonb_agg(day),'[]') from unnest(array[7,14,30,60,100,365]) day where day<=history));
 end if;
 return result;
end $$;

-- Persisted, checkpointed intervals only. Never extrapolate abandoned timers
-- into overnight writing. Legacy rows have only a duration, so approximate their
-- active span at session start, bounded by saved duration (not wall-clock age).
-- One interval-union implementation feeds current totals and historical charts.
create or replace function public.writing_account_time_ranges(p_user uuid)
returns int8multirange language sql stable security definer set search_path=public,pg_temp as $$
 with spans as (
  select int8range((p->>0)::bigint,least((p->>1)::bigint,(extract(epoch from now())*1000)::bigint),'[)') span
  from public.writing_activity a cross join lateral jsonb_array_elements(
   coalesce(a.active_intervals,case when a.duration_seconds>0 then jsonb_build_array(jsonb_build_array(
    (extract(epoch from a.started_at)*1000)::bigint,
    (extract(epoch from a.started_at)*1000)::bigint+a.duration_seconds::bigint*1000)) else '[]'::jsonb end)) p
  where a.user_id=p_user and (p->>0)::bigint<(extract(epoch from now())*1000)::bigint
 )
 select coalesce(range_agg(span),'{}'::int8multirange) from spans;
$$;
create or replace function public.writing_account_summary(p_user uuid,p_timezone text default 'UTC',p_date date default null,p_unlimited boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare tz text; day date; day_start bigint; day_end bigint; daily_ms bigint; lifetime_ms bigint; words bigint; goal integer; prefs jsonb; sessions jsonb; result jsonb;
begin
 prefs:=public.writing_account_preferences(p_user);
 tz:=coalesce(prefs->>'timezone',p_timezone,'UTC');
 day:=coalesce(p_date,(now() at time zone tz)::date);
 if not p_unlimited and day<>(now() at time zone tz)::date then raise exception 'writing_history_pro_required' using errcode='42501';end if;
 day_start:=extract(epoch from (day::timestamp at time zone tz))*1000;
 day_end:=extract(epoch from ((day+1)::timestamp at time zone tz))*1000;
 with merged as (select unnest(public.writing_account_time_ranges(p_user)) span)
 select coalesce(sum(upper(span)-lower(span)),0),
 coalesce(sum(case when span && int8range(day_start,day_end,'[)') then upper(span*int8range(day_start,day_end,'[)'))-lower(span*int8range(day_start,day_end,'[)')) else 0 end),0)
 into lifetime_ms,daily_ms from merged;
 select coalesce(sum(typed_words),0) into words from public.writing_activity
 where user_id=p_user and (started_at at time zone tz)::date=day and started_at<=now();
 -- Multiple open sessions remain separate; no arbitrary "one active session".
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'device_id',device_id,'document_id',document_id,
  'status',timer->>'status','started_at',started_at,'active_seconds',duration_seconds,
  'paused_seconds',coalesce((timer->>'paused_ms')::numeric/1000,0),'updated_at',updated_at)),'[]')
 into sessions from public.writing_activity where user_id=p_user and timer->>'status' in ('active','paused')
 and (p_unlimited or started_at>=now()-interval '24 hours');
 goal:=(prefs->>'daily_goal')::integer;
 result:=public.writing_streak_presentation(p_user,tz,p_unlimited);
 return result || jsonb_build_object('user_id',p_user,'reportingDate',day,'timezone',tz,'dailyWordCount',words,
  'dailyActiveWritingSeconds',daily_ms/1000,'lifetimeActiveWritingSeconds',lifetime_ms/1000,
  'lifetimeWordCount',coalesce((select sum(typed_words) from public.writing_activity where user_id=p_user and started_at<=now()),0),'dailySessionCount',(select count(*) from public.writing_activity where user_id=p_user and (started_at at time zone tz)::date=day),'dailyGoal',goal,'dailyGoalProgress',least(1,words::numeric/goal),'goalCompleted',words>=goal,
  'sessions',sessions,'dailySessions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'client_key',a.client_key,'typed_words',a.typed_words,'sequence',a.sequence,'source',a.source)) from public.writing_activity a where a.user_id=p_user and (a.started_at at time zone tz)::date=day),'[]'::jsonb),'preferencesRevision',(prefs->>'revision')::bigint,'updatedAt',now(),'timePolicy','union_of_checkpointed_active_intervals');
end $$;
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
  duration_seconds=case when active_intervals is not null then duration_seconds else least(86400,floor(((timer->>'active_ms')::numeric + case when timer->>'status'='active' and active_intervals is null then greatest(0,ended_time-(timer->>'changed_at')::numeric) else 0 end)/1000))::integer end,
  timer=jsonb_build_object('status','ended','active_ms',case when active_intervals is not null then duration_seconds::bigint*1000 else (timer->>'active_ms')::numeric+case when timer->>'status'='active' and active_intervals is null then greatest(0,ended_time-(timer->>'changed_at')::numeric) else 0 end end,
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


create or replace function public.writing_daily_activity(p_user uuid,p_timezone text)
returns table(reporting_date date,typed_words bigint,sessions bigint,duration_seconds bigint)
language sql stable security definer set search_path=public,pg_temp as $$
 with spans as (select unnest(public.writing_account_time_ranges(p_user)) span),
 portions as (
  select day::date d,span*int8range((extract(epoch from (day::date::timestamp at time zone p_timezone))*1000)::bigint,
  (extract(epoch from ((day::date+1)::timestamp at time zone p_timezone))*1000)::bigint,'[)') clipped
  from spans cross join lateral generate_series(
   (to_timestamp(lower(span)/1000.0) at time zone p_timezone)::date::timestamp,
   (to_timestamp((upper(span)-1)/1000.0) at time zone p_timezone)::date::timestamp,interval '1 day') day
 ), times as (select d,sum(upper(clipped)-lower(clipped))::bigint/1000 seconds from portions group by d),
 words as (select (started_at at time zone p_timezone)::date d,sum(typed_words)::bigint words,count(*) n
 from public.writing_activity where user_id=p_user and started_at<=now() group by 1)
 select coalesce(times.d,words.d),coalesce(words.words,0),coalesce(words.n,0),coalesce(times.seconds,0)
 from times full join words on words.d=times.d;
$$;
create or replace function public.writing_progress_history(p_user uuid,p_timezone text,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from (
 select reporting_date as date,typed_words,sessions,duration_seconds
 from public.writing_daily_activity(p_user,coalesce(public.writing_account_preferences(p_user)->>'timezone',p_timezone)) order by reporting_date desc limit 100 offset greatest(0,p_offset)) d;
$$;
create or replace function public.writing_account_statistics(p_user uuid,p_range text,p_timezone text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare tz text; today date; first_day date; last_day date; result jsonb;
begin
 tz:=coalesce(public.writing_account_preferences(p_user)->>'timezone',p_timezone,'UTC');today:=(now() at time zone tz)::date;
 first_day:=case p_range when 'today' then today when 'week' then date_trunc('week',today)::date
 when 'month' then date_trunc('month',today)::date when 'year' then date_trunc('year',today)::date else '2000-01-01'::date end;
 last_day:=case p_range when 'week' then first_day+7 when 'month' then (first_day+interval '1 month')::date when 'year' then (first_day+interval '1 year')::date else today+1 end;
 with days as (select * from public.writing_daily_activity(p_user,tz) where reporting_date>=first_day and reporting_date<last_day),
 bucket_values as (select case when p_range in ('year','all') then date_trunc('month',reporting_date)::date else reporting_date end d,
 sum(typed_words) words,sum(sessions) sessions,sum(duration_seconds) seconds from days group by 1),
 calendar as (
  select value::date d from generate_series(case when p_range='all' then null else first_day::timestamp end,(last_day-1)::timestamp,
   case when p_range='year' then interval '1 month' else interval '1 day' end) value where p_range<>'all'
  union select d from bucket_values where p_range='all'
 ), buckets as (
  select calendar.d,coalesce(words,0) words,coalesce(sessions,0) sessions,coalesce(seconds,0) seconds
  from calendar left join bucket_values using(d)
 )
 select jsonb_build_object('range',p_range,'timezone',tz,'totalWords',coalesce((select sum(typed_words) from days),0),
 'sessionCount',coalesce((select sum(sessions) from days),0),'activeWritingSeconds',coalesce((select sum(duration_seconds) from days),0),
 'buckets',coalesce((select jsonb_agg(jsonb_build_object('key',d,'label',d,'dayOfMonth',extract(day from d),'month',extract(month from d)-1,'dow',extract(isodow from d)-1,'words',words,'sessions',sessions,'activeWritingSeconds',seconds) order by d) from buckets),'[]'::jsonb)) into result;
 return result||jsonb_build_object('longestSessionWords',coalesce((select max(typed_words) from public.writing_activity where user_id=p_user and (started_at at time zone tz)::date>=first_day and (started_at at time zone tz)::date<last_day),0));
end $$;

-- Service-only summaries may read all owner history even after a downgrade.
-- Free responses contain only the capped streak presentation, never raw streaks.
do $$ declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
 ('writing_sync_extension','writing_account_preferences','writing_update_preferences','writing_account_summary','writing_account_time_ranges','writing_daily_activity','writing_account_statistics','writing_progress_history') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
