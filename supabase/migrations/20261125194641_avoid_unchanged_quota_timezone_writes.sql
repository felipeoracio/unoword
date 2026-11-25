-- Avoid validating and rewriting an already-validated, unchanged timezone on every usage read.
-- Quota locks, counters, pending reservations, entitlements and reset rules remain intact.
begin;
set local lock_timeout='2s';
CREATE OR REPLACE FUNCTION public.ai_coach_state(p_user uuid, p_timezone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare a public.ai_allowance_assignments; v public.ai_allowance_versions; tz text; day_start timestamptz; month_start timestamptz;
 day_end timestamptz; month_end timestamptz; ds bigint; ms bigint; mg bigint; pd bigint; pm bigint; pg bigint; legacy bigint; lp bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
 perform public.ai_assign_allowance(p_user);
 select * into a from public.ai_allowance_assignments where user_id=p_user for update;
 select * into v from public.ai_allowance_versions where id=a.version_id;
 if v.id is null then raise exception 'ai_allowance_not_configured'; end if;
 if p_timezone is not null and p_timezone is distinct from a.timezone and not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'invalid_quota_timezone'; end if;
 tz:=coalesce(a.timezone,p_timezone,'UTC');
 if p_timezone is not null and p_timezone is distinct from a.timezone and (a.timezone is null or
  (not exists(select 1 from public.ai_usage where user_id=p_user and created_at>=a.timezone_set_at)
   and not exists(select 1 from public.workspace_ai_requests where user_id=p_user and state='pending' and created_at>now()-interval '5 minutes')) or
  date_trunc('month',now() at time zone tz)>date_trunc('month',a.timezone_set_at at time zone tz)) then
  tz:=p_timezone;
  update public.ai_allowance_assignments set timezone=tz,timezone_set_at=now() where user_id=p_user;
 end if;
 day_start:=date_trunc('day',now() at time zone tz) at time zone tz;
 month_start:=date_trunc('month',now() at time zone tz) at time zone tz;
 day_end:=(date_trunc('day',now() at time zone tz)+interval '1 day') at time zone tz;
 month_end:=(date_trunc('month',now() at time zone tz)+interval '1 month') at time zone tz;
 select count(*) filter(where created_at>=day_start and coalesce(feature,'suggestion')='suggestion'),
 count(*) filter(where coalesce(feature,'suggestion')='suggestion'),count(*) filter(where feature='guidance'),
 count(*) filter(where created_at>=day_start and request_type in ('suggestion','workspace_assistant'))
 into ds,ms,mg,legacy from public.ai_usage where user_id=p_user and created_at>=month_start and request_type in ('suggestion','workspace_assistant');
 select count(*) filter(where created_at>=day_start and coalesce(feature,'suggestion')='suggestion'),
 count(*) filter(where coalesce(feature,'suggestion')='suggestion'),count(*) filter(where feature='guidance'),
 count(*) filter(where created_at>=day_start)
 into pd,pm,pg,lp from public.workspace_ai_requests where user_id=p_user and state='pending' and created_at>now()-interval '5 minutes';
 return jsonb_build_object('version_id',v.id,'version_name',v.name,'legacy_shared',v.legacy_shared_daily,
 'timezone',tz,'pending_timezone',case when p_timezone is distinct from tz then p_timezone end,
 'date',(now() at time zone tz)::date,'daily_reset_at',day_end,'monthly_reset_at',month_end,
 'daily_limit',case when v.legacy_shared_daily then a.legacy_daily else v.suggestions_daily end,
 'suggestions_monthly_limit',v.suggestions_monthly,'guidance_monthly_limit',v.guidance_monthly,
 'used_today',case when v.legacy_shared_daily then legacy else ds end,
 'pending_today',case when v.legacy_shared_daily then lp else pd end,'total_today',legacy,
 'suggestions_monthly_used',ms,'suggestions_monthly_pending',pm,'guidance_monthly_used',mg,'guidance_monthly_pending',pg,
 'remaining',greatest(0,case when v.legacy_shared_daily then a.legacy_daily-legacy-lp else v.suggestions_daily-ds-pd end),
 'suggestions_monthly_remaining',case when v.suggestions_monthly is not null then greatest(0,v.suggestions_monthly-ms-pm) end,
 'guidance_monthly_remaining',case when v.guidance_monthly is not null then greatest(0,v.guidance_monthly-mg-pg) end,
 'cost_target',v.cost_target,'warning_percent',v.warning_percent);
end $function$;
commit;

