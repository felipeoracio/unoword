-- Reuse the existing writing activity ledger for extension metadata. The
-- calculation has no plan branch; only the service-only presentation RPC caps it.
begin;
alter table public.writing_activity alter column document_id drop not null;
alter table public.writing_activity alter column sequence type bigint;
alter table public.writing_activity add column if not exists source text not null default 'editor' check(source in ('editor','extension'));
alter table public.writing_activity add column if not exists client_key text;
create unique index if not exists writing_activity_extension_key on public.writing_activity(user_id,client_key) where source='extension';
-- A deliberate document deletion must not erase earned writing days.
alter table public.writing_activity drop constraint if exists writing_activity_document_id_fkey;
alter table public.writing_activity add constraint writing_activity_document_id_fkey foreign key(document_id) references public.writing_documents(id) on delete set null;
create table if not exists public.writing_progress_preferences (
 user_id uuid primary key references auth.users on delete cascade, cleared_before timestamptz, keep_extension_key text, updated_at timestamptz not null default now()
);
alter table public.writing_progress_preferences enable row level security;
revoke all on public.writing_progress_preferences from public,anon,authenticated;
grant all on public.writing_progress_preferences to service_role;

-- Keep the original owner restrictions and the existing Pro document policies.
drop policy if exists writing_activity_owner on public.writing_activity;
create policy writing_activity_owner on public.writing_activity for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid() and (
 (source='extension' and document_id is null) or (source='editor' and exists(select 1 from public.writing_documents d where d.id=document_id and d.user_id=auth.uid()))));
drop policy if exists writing_activity_pro_insert on public.writing_activity;
create policy writing_activity_pro_insert on public.writing_activity as restrictive for insert to authenticated
 with check(source='extension' or public.workspace_has_pro_access());
drop policy if exists writing_activity_pro_update on public.writing_activity;
create policy writing_activity_pro_update on public.writing_activity as restrictive for update to authenticated
 using(source='extension' or public.workspace_has_pro_access()) with check(source='extension' or public.workspace_has_pro_access());
drop policy if exists writing_activity_pro_delete on public.writing_activity;
create policy writing_activity_pro_delete on public.writing_activity as restrictive for delete to authenticated
 using(source='extension' or public.workspace_has_pro_access());
drop policy if exists writing_activity_history_visibility on public.writing_activity;
create policy writing_activity_history_visibility on public.writing_activity as restrictive for select to authenticated
 using(public.workspace_has_pro_access() or started_at>=now()-interval '24 hours');
-- Prevent hiding paid editor activity as a Free extension row through raw REST.
create or replace function public.protect_activity_identity() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.user_id is distinct from old.user_id or new.source is distinct from old.source
 or new.started_at is distinct from old.started_at or new.client_key is distinct from old.client_key then
 raise exception 'activity_identity_immutable' using errcode='42501'; end if;
 return new;
end $$;
drop trigger if exists protect_activity_identity on public.writing_activity;
create trigger protect_activity_identity before update on public.writing_activity for each row execute function public.protect_activity_identity();

-- Existing profile data is retained on downgrades; personalized profile editing
-- and reading now use the same paid boundary as other personalization features.
drop policy if exists ai_profile_pro on public.ai_profiles;
create policy ai_profile_pro on public.ai_profiles as restrictive for all to authenticated
 using(public.workspace_has_pro_access()) with check(public.workspace_has_pro_access());

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
 insert into public.writing_activity(id,user_id,document_id,started_at,typed_words,pasted_words,duration_seconds,sequence,source,client_key)
 values(sid,p_user,null,(item->>'started_at')::timestamptz,(item->>'typed_words')::integer,(item->>'pasted_words')::integer,
 (item->>'duration_seconds')::integer,(item->>'sequence')::bigint,'extension',item->>'key')
 on conflict(id) do update set typed_words=excluded.typed_words,pasted_words=excluded.pasted_words,duration_seconds=excluded.duration_seconds,
 sequence=excluded.sequence,updated_at=clock_timestamp()
 where writing_activity.user_id=p_user and writing_activity.source='extension' and writing_activity.sequence<excluded.sequence;
 n:=n+1;
 end loop;
 return n;
end $$;

-- The same existing rule: at least one TYPED word per calendar day, today or
-- yesterday to keep a current streak, then consecutive previous days. Never
-- branches on tier, truncates at seven, or changes stored records.
create or replace function public.writing_actual_streak(p_user uuid,p_timezone text,p_now timestamptz default now())
returns integer language plpgsql stable security definer set search_path=public,pg_temp as $$
declare days date[]; today date; cursor_day date; streak integer:=0;
begin
 today:=(p_now at time zone p_timezone)::date;
 select array_agg(distinct (started_at at time zone p_timezone)::date) into days
 from public.writing_activity where user_id=p_user and typed_words>0 and started_at<=p_now;
 cursor_day:=today;
 if not (cursor_day=any(coalesce(days,'{}'))) then cursor_day:=cursor_day-1; end if;
 while cursor_day=any(coalesce(days,'{}')) loop streak:=streak+1;cursor_day:=cursor_day-1;end loop;
 return streak;
end $$;

-- Past earned milestones are derived from the same qualifying calendar days;
-- they survive a missed day without reviving an unearned CURRENT streak.
create or replace function public.writing_historical_streak(p_user uuid,p_timezone text)
returns integer language sql stable security definer set search_path=public,pg_temp as $$
 with days as (select distinct (started_at at time zone p_timezone)::date as day
 from public.writing_activity where user_id=p_user and typed_words>0 and started_at<=now()),
 islands as (select day-(row_number() over(order by day))::integer as group_key from days)
 select coalesce(max(n),0)::integer from (select count(*) as n from islands group by group_key) streaks;
$$;
create or replace function public.writing_streak_presentation(p_user uuid,p_timezone text,p_unlimited boolean,p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actual integer; history integer; result jsonb;
begin
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
create or replace function public.writing_clear_progress(p_user uuid,p_before timestamptz,p_keep_key text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_before>now()+interval '5 minutes' then raise exception 'invalid_clear_time'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,784));
 insert into public.writing_progress_preferences(user_id,cleared_before,keep_extension_key) values(p_user,p_before,p_keep_key)
 on conflict(user_id) do update set cleared_before=greatest(writing_progress_preferences.cleared_before,excluded.cleared_before),keep_extension_key=excluded.keep_extension_key,updated_at=now();
 -- This operation is only for explicit user-requested history clearing. No
 -- subscription transition or quota configuration calls it.
 delete from public.writing_activity where user_id=p_user and started_at<=p_before and (p_keep_key is null or client_key is distinct from p_keep_key);
end $$;
do $$ declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
 ('writing_sync_extension','writing_actual_streak','writing_historical_streak','writing_streak_presentation','writing_clear_progress') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
create or replace function public.writing_progress_history(p_user uuid,p_timezone text,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from (
 select (started_at at time zone p_timezone)::date as date,sum(typed_words) as typed_words,
 count(*) as sessions,sum(duration_seconds) as duration_seconds
 from public.writing_activity where user_id=p_user group by 1 having sum(typed_words)>0 order by 1 desc limit 100 offset greatest(0,p_offset)
 ) d;
$$;
revoke all on function public.writing_progress_history(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.writing_progress_history(uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
