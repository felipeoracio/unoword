-- Separate Substack authority. Native Monthly/Lifetime rows are never overwritten.
-- Apply after workspace, billing, durable processing and writing-coach allowances.
begin;
do $$ begin
 if to_regclass('public.ai_entitlements') is null or to_regclass('public.writing_documents') is null
 or to_regclass('public.ai_allowance_assignments') is null or to_regclass('public.ai_ingest_jobs') is null
 or (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('ai_coach_reserve','ai_ingest_claim','ai_ingest_publish'))<>3 then
 raise exception 'Apply the existing UnoWord writing workspace, shared AI allowance and durable source-processing migrations before Substack integration.';
 end if;
end $$;
create table if not exists public.substack_integration (
 account_id text not null,livemode boolean not null,publication_url text not null,policy_hash text not null,
 enabled boolean not null default false,live_approved boolean not null default false,
 last_worker_at timestamptz,verified_at timestamptz,verification jsonb not null default '{}',last_sync_at timestamptz,
 import_cursor text,last_import_completed_at timestamptz,updated_at timestamptz not null default now(),
 primary key(account_id,livemode)
);
alter table public.substack_integration enable row level security;
create table if not exists public.substack_subscriptions (
 account_id text not null,livemode boolean not null,subscription_id text not null,
 customer_id text,email_hash text,status text not null default 'unknown',eligible boolean not null default false,
 paid_through timestamptz,cancel_at_period_end boolean not null default false,policy_hash text not null,
 price_ids jsonb not null default '[]',verified_at timestamptz,last_error text,
 lease_token uuid,lease_until timestamptz,updated_at timestamptz not null default now(),
 primary key(account_id,livemode,subscription_id),
 foreign key(account_id,livemode) references public.substack_integration(account_id,livemode)
);
alter table public.substack_subscriptions enable row level security;
create index if not exists substack_subscription_email on public.substack_subscriptions(account_id,livemode,email_hash);
create table if not exists public.substack_links (
 user_id uuid not null references auth.users on delete cascade,account_id text not null,livemode boolean not null,
 subscription_id text not null,verified_email_hash text not null,masked_email text not null,
 linked_at timestamptz not null default now(),disconnected_at timestamptz,
 primary key(user_id,account_id,livemode,subscription_id),
 foreign key(account_id,livemode,subscription_id) references public.substack_subscriptions(account_id,livemode,subscription_id)
);
alter table public.substack_links enable row level security;
create unique index if not exists substack_one_linked_owner on public.substack_links(account_id,livemode,subscription_id) where disconnected_at is null;
create table if not exists public.substack_email_verifications (
 id uuid primary key,user_id uuid not null references auth.users on delete cascade,account_id text not null,livemode boolean not null,
 email_hash text not null,delivery_rate_hash text not null,email_ciphertext text not null,masked_email text not null,code_hash text not null,
 status text not null default 'sending' check(status in ('sending','pending','verified','linked','expired','failed')),
 attempts integer not null default 0,created_at timestamptz not null default now(),expires_at timestamptz not null,
 verified_at timestamptz,consumed_at timestamptz
);
alter table public.substack_email_verifications enable row level security;
create index if not exists substack_verification_user on public.substack_email_verifications(user_id,created_at);
create index if not exists substack_verification_email on public.substack_email_verifications(email_hash,created_at);
create index if not exists substack_verification_delivery on public.substack_email_verifications(delivery_rate_hash,created_at);
create table if not exists public.substack_events (
 account_id text not null,livemode boolean not null,event_id text not null,event_type text not null,api_version text,
 object_id text not null,object_type text not null,body_hash text not null,signing_key_hash text not null default '',created_epoch bigint not null,
 state text not null default 'queued' check(state in ('queued','running','done','failed')),attempts integer not null default 0,
 lease_token uuid,lease_until timestamptz,available_at timestamptz not null default now(),received_at timestamptz not null default now(),last_received_at timestamptz not null default now(),
 processed_at timestamptz,last_error text,primary key(account_id,livemode,event_id)
);
alter table public.substack_events enable row level security;
create index if not exists substack_events_pending on public.substack_events(state,available_at);
create table if not exists public.substack_csv_candidates (
 account_id text not null,livemode boolean not null,row_hash text not null,email_hash text not null,
 email_ciphertext text not null,masked_email text not null,subscription_id text,claimed_paid_through timestamptz,
 claimed_status text,review_status text not null default 'needs_verification',imported_at timestamptz not null default now(),
 primary key(account_id,livemode,row_hash)
);
alter table public.substack_csv_candidates enable row level security;
create table if not exists public.substack_admin_audit (
 id bigint generated always as identity primary key,admin_id text not null,action text not null,
 detail jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table public.substack_admin_audit enable row level security;
do $$ declare t text;begin
 foreach t in array array['substack_integration','substack_subscriptions','substack_links','substack_email_verifications','substack_events','substack_csv_candidates','substack_admin_audit'] loop
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
revoke all on sequence public.substack_admin_audit_id_seq from public,anon,authenticated;
grant all on sequence public.substack_admin_audit_id_seq to service_role;

-- Read native and external grants independently. No second authoritative billing system.
create or replace view public.ai_effective_entitlements as
 select distinct on(user_id) user_id,plan,status,daily_request_limit,valid_until,updated_at,billing_source,billing_livemode from (
 select user_id,plan,status,daily_request_limit,valid_until,updated_at,billing_source,billing_livemode from public.ai_entitlements
 union all
 select l.user_id,'pro'::text,'active'::text,0::integer,s.paid_through,s.updated_at,'substack_stripe'::text,s.livemode
 from public.substack_links l join public.substack_subscriptions s using(account_id,livemode,subscription_id)
 join public.substack_integration c using(account_id,livemode)
 where l.disconnected_at is null and l.verified_email_hash=s.email_hash and s.eligible and s.paid_through>now()
 and s.policy_hash=c.policy_hash and c.enabled and (not c.livemode or c.live_approved)
 ) candidates order by user_id,
 case when plan in ('pro','premium') and status in ('active','trialing') and (valid_until is null or valid_until>=now()) then 0 else 1 end,
 case when billing_source='substack_stripe' then 1 else 0 end,valid_until desc nulls first;
revoke all on public.ai_effective_entitlements from public,anon,authenticated;
grant select on public.ai_effective_entitlements to service_role;
create or replace function public.substack_entitlement(p_user uuid,p_account text,p_live boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('user_id',l.user_id,'plan','pro','status','active','daily_request_limit',0,'valid_until',s.paid_through,
 'billing_source','substack_stripe','billing_livemode',s.livemode,'updated_at',s.updated_at)
 from public.substack_links l join public.substack_subscriptions s using(account_id,livemode,subscription_id)
 join public.substack_integration c using(account_id,livemode)
 where l.user_id=p_user and l.account_id=p_account and l.livemode=p_live and l.disconnected_at is null
 and l.verified_email_hash=s.email_hash and s.eligible and s.paid_through>now() and s.policy_hash=c.policy_hash
 and c.enabled and (not c.livemode or c.live_approved) order by s.paid_through desc limit 1;
$$;
create or replace function public.workspace_has_pro_access()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.ai_effective_entitlements e where e.user_id=auth.uid() and e.plan in ('pro','premium')
 and e.status in ('active','trialing') and (e.valid_until is null or e.valid_until>=now()));
$$;
revoke all on function public.workspace_has_pro_access() from public,anon;
grant execute on function public.workspace_has_pro_access() to authenticated;
-- Only these existing trusted READ checks are extended. Grant writers and native
-- Stripe/Lifetime commit functions continue targeting their original table.
do $$ declare f record; definition text;begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('ai_coach_reserve','ai_ingest_claim','ai_ingest_publish') loop
 definition:=pg_get_functiondef(f.oid);
 if position('public.ai_entitlements' in definition)>0 then
 execute replace(definition,'public.ai_entitlements','public.ai_effective_entitlements');
 end if;
 end loop;
end $$;

create or replace function public.substack_observe(p_account text,p_live boolean,p_url text,p_policy text,p_report jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.substack_integration(account_id,livemode,publication_url,policy_hash,verified_at,verification)
 values(p_account,p_live,p_url,p_policy,now(),p_report)
 on conflict(account_id,livemode) do update set publication_url=excluded.publication_url,policy_hash=excluded.policy_hash,
 enabled=case when substack_integration.policy_hash=excluded.policy_hash then substack_integration.enabled else false end,
 last_import_completed_at=case when substack_integration.policy_hash=excluded.policy_hash then substack_integration.last_import_completed_at else null end,
 import_cursor=case when substack_integration.policy_hash=excluded.policy_hash then substack_integration.import_cursor else null end,
 verified_at=now(),verification=excluded.verification,updated_at=now();
end $$;
create or replace function public.substack_set_enabled(p_account text,p_live boolean,p_enabled boolean,p_approved boolean,p_admin text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(789,1);
 if p_enabled and not exists(select 1 from public.substack_integration where account_id=p_account and livemode=p_live
 and verified_at>now()-interval '15 minutes' and (verification->>'ready')::boolean and (not p_live or p_approved)) then return false;end if;
 if p_enabled then update public.substack_integration set enabled=false where account_id<>p_account or livemode<>p_live;end if;
 update public.substack_integration set enabled=p_enabled,live_approved=p_live and p_approved,updated_at=now() where account_id=p_account and livemode=p_live;
 if not found then return false;end if;
 insert into public.substack_admin_audit(admin_id,action,detail) values(p_admin,case when p_enabled then 'enable' else 'disable' end,jsonb_build_object('account',p_account,'livemode',p_live));
 return true;
end $$;

create or replace function public.substack_subscription_claim(p_account text,p_live boolean,p_subscription text,p_token uuid,p_policy text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.substack_subscriptions(account_id,livemode,subscription_id,policy_hash) values(p_account,p_live,p_subscription,p_policy) on conflict do nothing;
 update public.substack_subscriptions set lease_token=p_token,lease_until=now()+interval '3 minutes' where account_id=p_account and livemode=p_live and subscription_id=p_subscription
 and (lease_until is null or lease_until<=now());return found;
end $$;
create or replace function public.substack_subscription_commit(p_account text,p_live boolean,p_subscription text,p_token uuid,p_state jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.substack_subscriptions set customer_id=p_state->>'customer_id',email_hash=p_state->>'email_hash',status=p_state->>'status',
 eligible=coalesce((p_state->>'eligible')::boolean,false),paid_through=(p_state->>'paid_through')::timestamptz,cancel_at_period_end=coalesce((p_state->>'cancel_at_period_end')::boolean,false),
 price_ids=coalesce(p_state->'price_ids','[]'),policy_hash=p_state->>'policy_hash',verified_at=now(),last_error=null,lease_token=null,lease_until=null,updated_at=now()
 where account_id=p_account and livemode=p_live and subscription_id=p_subscription and lease_token=p_token and lease_until>now()
 and exists(select 1 from public.substack_integration c where c.account_id=p_account and c.livemode=p_live and c.policy_hash=p_state->>'policy_hash');
 if found then update public.substack_integration set last_sync_at=now() where account_id=p_account and livemode=p_live;return true;end if;return false;
end $$;
create or replace function public.substack_subscription_release(p_account text,p_live boolean,p_subscription text,p_token uuid,p_error text)
returns void language sql security definer set search_path=public,pg_temp as $$
 update public.substack_subscriptions set lease_token=null,lease_until=null,last_error=left(p_error,80) where account_id=p_account and livemode=p_live and subscription_id=p_subscription and lease_token=p_token;
$$;

create or replace function public.substack_verification(p_action text,p_user uuid,p_id uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare row public.substack_email_verifications;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,790));
 if p_action='begin' then
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_data->>'delivery_rate_hash',p_data->>'email_hash'),791));
 if (select count(*) from public.substack_email_verifications where created_at>now()-interval '1 hour' and user_id=p_user)>=3
 or (select count(*) from public.substack_email_verifications where created_at>now()-interval '1 hour' and delivery_rate_hash=coalesce(p_data->>'delivery_rate_hash',p_data->>'email_hash'))>=5 then return jsonb_build_object('limited',true);end if;
 update public.substack_email_verifications set status='expired',email_ciphertext='' where user_id=p_user and status in ('sending','pending','verified');
 insert into public.substack_email_verifications(id,user_id,account_id,livemode,email_hash,delivery_rate_hash,email_ciphertext,masked_email,code_hash,expires_at)
 values(p_id,p_user,p_data->>'account_id',(p_data->>'livemode')::boolean,p_data->>'email_hash',coalesce(p_data->>'delivery_rate_hash',p_data->>'email_hash'),p_data->>'email_ciphertext',p_data->>'masked_email',p_data->>'code_hash',now()+interval '10 minutes');
 return jsonb_build_object('created',true);
 end if;
 select * into row from public.substack_email_verifications where id=p_id and user_id=p_user for update;
 if not found then return jsonb_build_object('invalid',true);end if;
 if p_action='cancel' then
 update public.substack_email_verifications set status='expired',email_ciphertext='',code_hash='' where id=p_id;return '{}';
 elsif p_action='delivered' then
 update public.substack_email_verifications set status='pending' where id=p_id and status='sending';return jsonb_build_object('delivered',found);
 elsif p_action='delivery_failed' then
 update public.substack_email_verifications set status='failed',email_ciphertext='' where id=p_id;return '{}';
 end if;
 if row.expires_at<=now() or row.attempts>=5 then
 update public.substack_email_verifications set status='expired',email_ciphertext='' where id=p_id;return jsonb_build_object('invalid',true);end if;
 if p_action='verify' then
 if row.status<>'pending' then return jsonb_build_object('invalid',true);end if;
 if row.code_hash<>p_data->>'code_hash' then update public.substack_email_verifications set attempts=attempts+1 where id=p_id;return jsonb_build_object('invalid',true);end if;
 update public.substack_email_verifications set status='verified',verified_at=now(),code_hash='' where id=p_id returning * into row;
 elsif p_action='read_verified' and row.status<>'verified' then return jsonb_build_object('invalid',true);
 end if;
 return to_jsonb(row);
end $$;
create or replace function public.substack_link(p_user uuid,p_request uuid,p_subscription text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.substack_email_verifications;s public.substack_subscriptions;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,790));
 select * into v from public.substack_email_verifications where id=p_request and user_id=p_user for update;
 if not found or v.status<>'verified' or v.expires_at<=now() then return false;end if;
 select * into s from public.substack_subscriptions where account_id=v.account_id and livemode=v.livemode and subscription_id=p_subscription for update;
 if not found or s.email_hash<>v.email_hash or not s.eligible or s.paid_through<=now() or s.verified_at<now()-interval '2 minutes' then return false;end if;
 -- UNIQUE partial index resolves races across two unrelated user accounts.
 if exists(select 1 from public.substack_links where account_id=v.account_id and livemode=v.livemode and subscription_id=p_subscription and disconnected_at is null and user_id<>p_user) then return false;end if;
 insert into public.substack_links(user_id,account_id,livemode,subscription_id,verified_email_hash,masked_email)
 values(p_user,v.account_id,v.livemode,p_subscription,v.email_hash,v.masked_email)
 on conflict(user_id,account_id,livemode,subscription_id) do update set verified_email_hash=excluded.verified_email_hash,masked_email=excluded.masked_email,disconnected_at=null,linked_at=now();
 update public.substack_email_verifications set status='linked',consumed_at=now(),email_ciphertext='' where id=p_request;
 -- Existing versioned allowances are retained, never replaced or doubled.
 if to_regprocedure('public.ai_assign_allowance(uuid)') is not null then perform public.ai_assign_allowance(p_user);end if;
 return true;
exception when unique_violation then return false;
end $$;
create or replace function public.substack_disconnect(p_user uuid,p_account text,p_live boolean)
returns void language sql security definer set search_path=public,pg_temp as $$
 update public.substack_links set disconnected_at=now() where user_id=p_user and account_id=p_account and livemode=p_live and disconnected_at is null;
 update public.substack_email_verifications set status='expired',email_ciphertext='' where user_id=p_user and status in ('sending','pending','verified');
$$;

create or replace function public.substack_event_enqueue(p_account text,p_live boolean,p_event jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.substack_events(account_id,livemode,event_id,event_type,api_version,object_id,object_type,body_hash,signing_key_hash,created_epoch)
 values(p_account,p_live,p_event->>'id',p_event->>'type',p_event->>'api_version',p_event->>'object_id',p_event->>'object_type',p_event->>'body_hash',coalesce(p_event->>'signing_key_hash',''),(p_event->>'created')::bigint) on conflict do nothing;
 if not found then
 update public.substack_events set signing_key_hash=coalesce(p_event->>'signing_key_hash',''),last_received_at=now()
 where account_id=p_account and livemode=p_live and event_id=p_event->>'id' and body_hash=p_event->>'body_hash';
 if not found then raise exception 'substack_event_conflict';end if;
 end if;
 return true;
end $$;
create or replace function public.substack_event_claim(p_account text,p_live boolean,p_token uuid,p_event text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare row public.substack_events;
begin
 select * into row from public.substack_events where account_id=p_account and livemode=p_live and (p_event is null or event_id=p_event)
 and ((state='queued' and available_at<=now()) or(state='running' and lease_until<=now())) order by received_at limit 1 for update skip locked;
 if not found then return null;end if;
 update public.substack_events set state='running',attempts=attempts+1,lease_token=p_token,lease_until=now()+interval '3 minutes'
 where account_id=p_account and livemode=p_live and event_id=row.event_id returning * into row;return to_jsonb(row);
end $$;
create or replace function public.substack_event_finish(p_account text,p_live boolean,p_event text,p_token uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.substack_events set state=case when p_error is null then 'done' when attempts>=8 then 'failed' else 'queued' end,
 processed_at=case when p_error is null then now() else null end,last_error=left(p_error,80),lease_token=null,lease_until=null,
 available_at=now()+make_interval(secs=>least(3600,15*power(2,least(attempts,8)))::integer)
 where account_id=p_account and livemode=p_live and event_id=p_event and lease_token=p_token and lease_until>now();return found;
end $$;
create or replace function public.substack_retry_events(p_account text,p_live boolean) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare count integer;
begin
 update public.substack_events set state='queued',attempts=0,available_at=now(),last_error=null
 where account_id=p_account and livemode=p_live and state in ('failed','queued') and last_error is not null;
 get diagnostics count=row_count;return count;
end $$;
create or replace function public.substack_due_subscriptions(p_account text,p_live boolean,p_limit integer default 10)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(subscription_id),'[]') from (
 select s.subscription_id from public.substack_subscriptions s where s.account_id=p_account and s.livemode=p_live
 and s.status not in ('canceled','incomplete_expired') and exists(select 1 from public.substack_links l where l.account_id=s.account_id and l.livemode=s.livemode and l.subscription_id=s.subscription_id and l.disconnected_at is null)
 order by s.verified_at asc nulls first,s.subscription_id limit least(25,greatest(1,p_limit))) due;
$$;
create or replace function public.substack_admin_counts(p_account text,p_live boolean) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'linked_subscribers',(select count(distinct user_id) from public.substack_links where account_id=p_account and livemode=p_live and disconnected_at is null),
 'active_entitlements',(select count(distinct l.user_id) from public.substack_links l join public.substack_subscriptions s using(account_id,livemode,subscription_id) join public.substack_integration c using(account_id,livemode)
 where l.account_id=p_account and l.livemode=p_live and l.disconnected_at is null and l.verified_email_hash=s.email_hash and s.eligible and s.paid_through>now() and s.policy_hash=c.policy_hash and c.enabled and (not c.livemode or c.live_approved)),
 'pending_verifications',(select count(*) from public.substack_email_verifications where account_id=p_account and livemode=p_live and status in ('pending','verified') and expires_at>now()),
 'failed_event_count',(select count(*) from public.substack_events where account_id=p_account and livemode=p_live and last_error is not null),
 'last_webhook_received',(select max(received_at) from public.substack_events where account_id=p_account and livemode=p_live));
$$;
-- All operations above bind account, identity and provider mode in the backend.
do $$ declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'substack_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
