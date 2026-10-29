-- Versioned writing-coach allowances. Preserves writing, billing and historical
-- usage. Existing paid accounts keep their legacy shared daily pool.
-- Run the complete transaction. The trigger replacements and runtime cleanup
-- definitions may prompt a generic destructive-operation warning; this migration
-- does not drop data tables or delete writing, user, or subscription records.
begin;
create table if not exists public.ai_allowance_versions (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 suggestions_daily integer check(suggestions_daily between 1 and 100000),
 suggestions_monthly integer check(suggestions_monthly between 1 and 1000000),
 guidance_monthly integer check(guidance_monthly between 1 and 1000000),
 legacy_shared_daily boolean not null default false,
 cost_target numeric(10,2) not null default 2 check(cost_target>0 and cost_target<=10000),
 warning_percent integer not null default 80 check(warning_percent between 1 and 100),
 created_at timestamptz not null default now(), created_by text not null,
 check(legacy_shared_daily or (suggestions_daily is not null and suggestions_monthly is not null and guidance_monthly is not null))
);
-- Backend-only: explicit protection for Supabase security review.
alter table public.ai_allowance_versions enable row level security;
revoke all on public.ai_allowance_versions from public,anon,authenticated;
grant all on public.ai_allowance_versions to service_role;
insert into public.ai_allowance_versions(id,name,suggestions_daily,legacy_shared_daily,created_by)
 values('00000000-0000-4000-8000-000000000001','Protected legacy shared allowance',100,true,'migration') on conflict do nothing;
insert into public.ai_allowance_versions(id,name,suggestions_daily,suggestions_monthly,guidance_monthly,created_by)
 values('00000000-0000-4000-8000-000000000002','Writing Coach v2',10,200,30,'migration') on conflict do nothing;
create table if not exists public.ai_allowance_releases (
 id uuid primary key default gen_random_uuid(), version_id uuid not null references public.ai_allowance_versions,
 effective_at timestamptz not null unique, published_at timestamptz not null default now(), published_by text not null
);
-- Backend-only: explicit protection for Supabase security review.
alter table public.ai_allowance_releases enable row level security;
revoke all on public.ai_allowance_releases from public,anon,authenticated;
grant all on public.ai_allowance_releases to service_role;
insert into public.ai_allowance_releases(id,version_id,effective_at,published_by)
 values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',now(),'migration') on conflict(id) do nothing;
create table if not exists public.ai_allowance_assignments (
 user_id uuid primary key references auth.users on delete cascade,
 version_id uuid not null references public.ai_allowance_versions,
 legacy_daily integer check(legacy_daily>0), timezone text,
 timezone_set_at timestamptz, created_at timestamptz not null default now()
);
-- Backend-only: explicit protection for Supabase security review.
alter table public.ai_allowance_assignments enable row level security;
revoke all on public.ai_allowance_assignments from public,anon,authenticated;
grant all on public.ai_allowance_assignments to service_role;
insert into public.ai_allowance_assignments(user_id,version_id,legacy_daily)
 select user_id,'00000000-0000-4000-8000-000000000001',greatest(daily_request_limit,100)
 from public.ai_entitlements where plan in ('pro','premium')
 on conflict(user_id) do nothing;
-- Preserve quotes already issued by pre-update Checkout flows as well as paid
-- accounts. No Stripe price, customer or subscription field is modified.
insert into public.ai_allowance_assignments(user_id,version_id,legacy_daily)
 select user_id,'00000000-0000-4000-8000-000000000001',100 from public.billing_accounts where customer_id is not null
 on conflict(user_id) do nothing;
insert into public.ai_allowance_assignments(user_id,version_id,legacy_daily)
 select user_id,'00000000-0000-4000-8000-000000000001',100 from public.lifetime_orders
 on conflict(user_id) do nothing;
create or replace function public.ai_protect_legacy_checkout_quote() returns trigger
 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (tg_table_name='billing_accounts' and new.customer_id is not null) or tg_table_name='lifetime_orders' then
 insert into public.ai_allowance_assignments(user_id,version_id,legacy_daily)
 values(new.user_id,'00000000-0000-4000-8000-000000000001',100) on conflict(user_id) do nothing;
 end if;
 return new;
end $$;
drop trigger if exists ai_protect_legacy_checkout on public.billing_accounts;
create trigger ai_protect_legacy_checkout after insert or update on public.billing_accounts for each row execute function public.ai_protect_legacy_checkout_quote();
drop trigger if exists ai_protect_legacy_lifetime on public.lifetime_orders;
create trigger ai_protect_legacy_lifetime after insert on public.lifetime_orders for each row execute function public.ai_protect_legacy_checkout_quote();
create table if not exists public.ai_allowance_audit (
 id bigint generated always as identity primary key, admin_id text not null, action text not null,
 version_id uuid references public.ai_allowance_versions, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
-- Backend-only: explicit protection for Supabase security review.
alter table public.ai_allowance_audit enable row level security;
revoke all on public.ai_allowance_audit from public,anon,authenticated;
grant all on public.ai_allowance_audit to service_role;
create table if not exists public.ai_model_prices (
 id uuid primary key default gen_random_uuid(), model text not null, input_per_million numeric(12,6) not null check(input_per_million>=0),
 cached_input_per_million numeric(12,6) not null check(cached_input_per_million>=0),
 output_per_million numeric(12,6) not null check(output_per_million>=0),
 effective_at timestamptz not null default now(), source_url text not null, created_by text not null,
 unique(model,effective_at)
);
-- Backend-only: explicit protection for Supabase security review.
alter table public.ai_model_prices enable row level security;
revoke all on public.ai_model_prices from public,anon,authenticated;
grant all on public.ai_model_prices to service_role;
-- Verified on the model's official pricing page, 2026-10-28. Unknown models are
-- reported as unpriced, never assigned an invented price or zero cost.
insert into public.ai_model_prices(id,model,input_per_million,cached_input_per_million,output_per_million,effective_at,source_url,created_by)
 values('00000000-0000-4000-8000-000000000054','gpt-5.4-mini',0.75,0.075,4.50,'2026-10-28T00:00:00Z',
 'https://developers.openai.com/api/docs/models/gpt-5.4-mini','migration') on conflict do nothing;
insert into public.ai_model_prices(id,model,input_per_million,cached_input_per_million,output_per_million,effective_at,source_url,created_by)
 values('00000000-0000-4000-8000-000000000003','text-embedding-3-small',0.02,0.02,0,'2026-10-28T00:00:00Z',
 'https://developers.openai.com/api/docs/models/text-embedding-3-small','migration') on conflict do nothing;
alter table public.ai_usage add column if not exists feature text;
alter table public.ai_usage add column if not exists model text;
alter table public.ai_usage add column if not exists cached_input_tokens integer;
alter table public.ai_usage add column if not exists allowance_version_id uuid references public.ai_allowance_versions;
alter table public.ai_usage add column if not exists price_id uuid references public.ai_model_prices;
alter table public.workspace_ai_requests add column if not exists feature text;
alter table public.workspace_ai_requests add column if not exists lease_token uuid;
alter table public.workspace_ai_requests add column if not exists fingerprint text;
alter table public.workspace_ai_requests add column if not exists allowance_version_id uuid references public.ai_allowance_versions;
alter table public.workspace_ai_requests add column if not exists quota_timezone text;
-- Private replay cache, separate from analytics. No prompts/draft content are
-- stored in cost events. Cached responses expire after 24 hours.
create table if not exists public.ai_response_cache (
 id uuid primary key references public.workspace_ai_requests on delete cascade,
 user_id uuid not null references auth.users on delete cascade, response jsonb not null,
 expires_at timestamptz not null default now()+interval '24 hours'
);
-- Backend-only: explicit protection for Supabase security review.
alter table public.ai_response_cache enable row level security;
revoke all on public.ai_response_cache from public,anon,authenticated;
grant all on public.ai_response_cache to service_role;
create index if not exists ai_response_cache_expiry on public.ai_response_cache(expires_at);
create table if not exists public.ai_cost_events (
 id uuid primary key default gen_random_uuid(), request_id uuid, user_id uuid not null references auth.users on delete cascade,
 feature text not null, model text, input_tokens integer, cached_input_tokens integer, output_tokens integer,
 estimated_cost numeric(16,8), price_id uuid references public.ai_model_prices,
 status text not null check(status in ('succeeded','failed','rejected','fallback','released')),
 created_at timestamptz not null default now()
);
-- Backend-only: explicit protection for Supabase security review.
alter table public.ai_cost_events enable row level security;
revoke all on public.ai_cost_events from public,anon,authenticated;
grant all on public.ai_cost_events to service_role;
create index if not exists ai_cost_events_month on public.ai_cost_events(created_at,user_id);
create index if not exists ai_usage_feature_time on public.ai_usage(user_id,created_at,feature);
create index if not exists ai_pending_feature_time on public.workspace_ai_requests(user_id,created_at,feature) where state='pending';

-- All seven new tables have explicit RLS and backend-only grants above.
grant usage, select on sequence public.ai_allowance_audit_id_seq to service_role;

create or replace function public.ai_public_allowance()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',v.id,'name',v.name,'suggestions_daily',v.suggestions_daily,
 'suggestions_monthly',v.suggestions_monthly,'guidance_monthly',v.guidance_monthly)
 from public.ai_allowance_releases r join public.ai_allowance_versions v on v.id=r.version_id
 where r.effective_at<=now() order by r.effective_at desc limit 1;
$$;
create or replace function public.ai_assign_allowance(p_user uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.ai_allowance_assignments(user_id,version_id)
 select p_user,version_id from public.ai_allowance_releases where effective_at<=now() order by effective_at desc limit 1
 on conflict(user_id) do nothing;
end $$;
create or replace function public.ai_assign_paid_allowance() returns trigger
 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.plan in ('pro','premium') and new.status in ('active','trialing') then perform public.ai_assign_allowance(new.user_id); end if;
 return new;
end $$;
drop trigger if exists ai_assign_paid_allowance on public.ai_entitlements;
create trigger ai_assign_paid_allowance after insert or update on public.ai_entitlements for each row execute function public.ai_assign_paid_allowance();

-- Canonical allowance + timezone resolution. Timezone changes are adopted only
-- at the next month boundary, preventing repeated resets by changing zones.
create or replace function public.ai_coach_state(p_user uuid,p_timezone text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.ai_allowance_assignments; v public.ai_allowance_versions; tz text; day_start timestamptz; month_start timestamptz;
 day_end timestamptz; month_end timestamptz; ds bigint; ms bigint; mg bigint; pd bigint; pm bigint; pg bigint; legacy bigint; lp bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
 perform public.ai_assign_allowance(p_user);
 select * into a from public.ai_allowance_assignments where user_id=p_user for update;
 select * into v from public.ai_allowance_versions where id=a.version_id;
 if v.id is null then raise exception 'ai_allowance_not_configured'; end if;
 if p_timezone is not null and not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'invalid_quota_timezone'; end if;
 tz:=coalesce(a.timezone,p_timezone,'UTC');
 if p_timezone is not null and (a.timezone is null or
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
end $$;

create or replace function public.ai_coach_reserve(p_user uuid,p_request uuid,p_feature text,p_fingerprint text,p_timezone text default null,p_lease uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; r public.workspace_ai_requests; cached jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
 if p_feature not in ('suggestion','guidance') or length(p_fingerprint)<>64 then raise exception 'invalid_ai_request'; end if;
 if not exists(select 1 from public.ai_entitlements where user_id=p_user and plan in ('pro','premium') and status in ('active','trialing') and (valid_until is null or valid_until>=now())) then
 return jsonb_build_object('status','forbidden'); end if;
 select * into r from public.workspace_ai_requests where id=p_request;
 if found then
 if r.user_id<>p_user or r.feature is distinct from p_feature or r.fingerprint is distinct from p_fingerprint then return jsonb_build_object('status','conflict'); end if;
 if r.state='done' then
 select response into cached from public.ai_response_cache where id=p_request and user_id=p_user and expires_at>now();
 return jsonb_build_object('status',case when cached is null then 'expired' else 'replay' end,'response',cached);
 end if;
 if r.created_at>now()-interval '5 minutes' then return jsonb_build_object('status','pending'); end if;
 delete from public.workspace_ai_requests where id=p_request and user_id=p_user;
 end if;
 s:=public.ai_coach_state(p_user,p_timezone);
 if (s->>'legacy_shared')::boolean then
 if (s->>'remaining')::integer<=0 then return jsonb_build_object('status','limited','reason','daily'); end if;
 elsif p_feature='suggestion' then
 if (s->>'remaining')::integer<=0 then return jsonb_build_object('status','limited','reason','daily'); end if;
 if (s->>'suggestions_monthly_remaining')::integer<=0 then return jsonb_build_object('status','limited','reason','suggestions_monthly'); end if;
 else
 if (s->>'guidance_monthly_remaining')::integer<=0 then return jsonb_build_object('status','limited','reason','guidance_monthly'); end if;
 end if;
 insert into public.workspace_ai_requests(id,user_id,date,request_type,feature,fingerprint,allowance_version_id,quota_timezone,lease_token,created_at)
 values(p_request,p_user,(s->>'date')::date,case when p_feature='suggestion' then 'suggestion' else 'workspace_assistant' end,p_feature,p_fingerprint,(s->>'version_id')::uuid,s->>'timezone',p_lease,clock_timestamp());
 -- Purge only expired response bodies; durable usage/idempotency records remain.
 delete from public.ai_response_cache where expires_at<now();
 return jsonb_build_object('status','reserved');
end $$;

create or replace function public.ai_coach_cost(p_user uuid,p_request uuid,p_feature text,p_model text,p_input integer,p_cached integer,p_output integer,p_status text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare price public.ai_model_prices; cost numeric;
begin
 select * into price from public.ai_model_prices where model=p_model and effective_at<=now() order by effective_at desc limit 1;
 if p_input is not null and p_output is not null and price.id is not null then
 cost:=round(((greatest(0,p_input-coalesce(p_cached,0))*price.input_per_million)+(least(p_input,coalesce(p_cached,0))*price.cached_input_per_million)+p_output*price.output_per_million)/1000000,8);
 end if;
 insert into public.ai_cost_events(request_id,user_id,feature,model,input_tokens,cached_input_tokens,output_tokens,estimated_cost,price_id,status)
 values(p_request,p_user,p_feature,p_model,p_input,p_cached,p_output,cost,price.id,p_status);
end $$;

create or replace function public.ai_coach_complete(p_user uuid,p_request uuid,p_model text,p_input integer,p_cached integer,p_output integer,p_response jsonb,p_suggestions jsonb,p_lease uuid default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.workspace_ai_requests; item jsonb; ev public.ai_cost_events;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
 select * into r from public.workspace_ai_requests where id=p_request and user_id=p_user for update;
 if not found or r.lease_token is distinct from p_lease then return false; end if;
 if r.state='done' then return exists(select 1 from public.ai_usage where id=p_request and user_id=p_user); end if;
 if r.created_at<=now()-interval '5 minutes' then return false; end if;
 if jsonb_array_length(p_suggestions)>3 then raise exception 'invalid_suggestions'; end if;
 for item in select * from jsonb_array_elements(p_suggestions) loop
 if (item->>'user_id')::uuid<>p_user then raise exception 'invalid_suggestion_owner'; end if;
 insert into public.ai_suggestions(id,user_id,title,suggestion,reason,context_summary,related_topics,source_ids,status)
 values((item->>'id')::uuid,p_user,item->>'title',item->>'suggestion',item->>'reason',item->>'context_summary',
 array(select jsonb_array_elements_text(item->'related_topics')),array(select jsonb_array_elements_text(item->'source_ids')::uuid),coalesce(item->>'status','shown')::public.ai_suggestion_status);
 end loop;
 select * into ev from public.ai_cost_events where request_id=p_request and status='succeeded' order by created_at desc limit 1;
 insert into public.ai_usage(id,user_id,date,request_type,feature,model,input_tokens,cached_input_tokens,output_tokens,estimated_cost,price_id,allowance_version_id,created_at)
 values(p_request,p_user,r.date,r.request_type,r.feature,p_model,p_input,p_cached,p_output,(select sum(estimated_cost) from public.ai_cost_events where request_id=p_request),ev.price_id,r.allowance_version_id,r.created_at);
 insert into public.ai_response_cache(id,user_id,response) values(p_request,p_user,p_response);
 update public.workspace_ai_requests set state='done' where id=p_request;
 return true;
end $$;


create or replace function public.ai_coach_release(p_user uuid,p_request uuid,p_lease uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
 delete from public.workspace_ai_requests where user_id=p_user and id=p_request and state='pending' and lease_token=p_lease;
end $$;
-- Compatibility releases may never delete a newer worker's leased request.
create or replace function public.ai_release_request(p_user uuid,p_request uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,783));
 delete from public.workspace_ai_requests where id=p_request and user_id=p_user and state='pending' and lease_token is null;
end $$;
create or replace function public.ai_coach_mark_request(p_user uuid,p_request uuid,p_status text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_status not in ('failed','rejected','fallback') then raise exception 'invalid_cost_status'; end if;
 update public.ai_cost_events set status=p_status where user_id=p_user and request_id=p_request and status='succeeded';
end $$;

-- Older deployed workers are also held to the new allowance. They cannot bypass
-- the new monthly pool while the server/extension rollout is in progress.
create or replace function public.ai_reserve_request(p_user uuid,p_request uuid,p_limit integer,p_type text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_limit<=0 then return false; end if;
 result:=public.ai_coach_reserve(p_user,p_request,'suggestion',repeat('0',64),'UTC');
 return result->>'status'='reserved';
end $$;
-- Older completion path remains compatible but stops recording invented prices.
create or replace function public.ai_complete_request(p_user uuid,p_request uuid,p_input_tokens integer,p_output_tokens integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return public.ai_coach_complete(p_user,p_request,null,p_input_tokens,null,p_output_tokens,'{}','[]');
end $$;

create or replace function public.ai_admin_create_version(p_admin text,p_name text,p_daily integer,p_monthly integer,p_guidance integer,p_target numeric,p_warning integer)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare vid uuid;
begin
 insert into public.ai_allowance_versions(name,suggestions_daily,suggestions_monthly,guidance_monthly,cost_target,warning_percent,created_by)
 values(p_name,p_daily,p_monthly,p_guidance,p_target,p_warning,p_admin) returning id into vid;
 insert into public.ai_allowance_audit(admin_id,action,version_id,detail) values(p_admin,'created',vid,jsonb_build_object('name',p_name,'daily',p_daily,'monthly',p_monthly,'guidance',p_guidance,'cost_target',p_target,'warning_percent',p_warning));
 return vid;
end $$;
create or replace function public.ai_admin_publish_version(p_admin text,p_version uuid,p_effective timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_effective<now()-interval '5 seconds' then raise exception 'cannot_publish_in_past'; end if;
 if not exists(select 1 from public.ai_allowance_versions where id=p_version and not legacy_shared_daily) then raise exception 'invalid_allowance_version'; end if;
 insert into public.ai_allowance_releases(version_id,effective_at,published_by) values(p_version,p_effective,p_admin);
 insert into public.ai_allowance_audit(admin_id,action,version_id,detail) values(p_admin,'published_for_future_subscribers',p_version,jsonb_build_object('effective_at',p_effective));
end $$;
-- No client may mutate versions, assignments, cost prices or admin history.
do $$ declare f regprocedure; begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
 ('ai_public_allowance','ai_assign_allowance','ai_assign_paid_allowance','ai_protect_legacy_checkout_quote','ai_coach_state','ai_coach_reserve','ai_coach_cost','ai_coach_complete','ai_coach_release','ai_coach_mark_request','ai_admin_create_version','ai_admin_publish_version') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
