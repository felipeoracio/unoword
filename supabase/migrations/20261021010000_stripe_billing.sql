-- Billing mutations are available only to the trusted backend service role.
-- No card details, Stripe secrets, or raw webhook payloads are stored here.
alter table public.ai_entitlements add column if not exists billing_source text;
alter table public.ai_entitlements add column if not exists billing_livemode boolean;
create table if not exists public.billing_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 customer_id text unique,
 livemode boolean not null default false,
 subscription_id text unique,
 subscription_created bigint not null default 0,
 status text not null default 'inactive',
 trial_used boolean not null default false,
 period_end timestamptz,
 cancel_at_period_end boolean not null default false,
 checkout_id text,
 checkout_attempt uuid not null default gen_random_uuid(),
 lease_id uuid,
 lease_until timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists public.billing_events (
 event_id text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 processed_at timestamptz not null default now()
);
alter table public.billing_accounts enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.billing_accounts, public.billing_events from anon, authenticated;
grant all on public.billing_accounts, public.billing_events to service_role;

-- A durable lease serializes Stripe reads/writes for an account across Vercel instances.
-- Expired workers cannot commit. All RPCs are revoked from browser roles below.
create or replace function public.billing_lock(p_user_id uuid, p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.billing_accounts;
begin
 insert into public.billing_accounts(user_id) values(p_user_id) on conflict do nothing;
 select * into a from public.billing_accounts where user_id=p_user_id for update;
 if a.lease_until > now() then raise exception 'billing_busy'; end if;
 update public.billing_accounts set lease_id=p_lease_id, lease_until=now()+interval '5 minutes'
 where user_id=p_user_id returning * into a;
 return to_jsonb(a);
end $$;
create or replace function public.billing_unlock(p_user_id uuid, p_lease_id uuid)
returns void language sql security definer set search_path = public as $$
 update public.billing_accounts set lease_id=null, lease_until=null
 where user_id=p_user_id and lease_id=p_lease_id;
$$;

-- Commit provider state, webhook receipt and entitlement in one transaction.
create or replace function public.billing_commit(p_user_id uuid, p_lease_id uuid,
 p_state jsonb, p_entitlement jsonb default null, p_event_id text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.billing_accounts;
begin
 select * into a from public.billing_accounts where user_id=p_user_id for update;
 if not found or a.lease_id is distinct from p_lease_id or a.lease_until <= now()
 then raise exception 'billing_lease_expired'; end if;
 if p_event_id is not null then
   insert into public.billing_events(event_id,user_id) values(p_event_id,p_user_id) on conflict do nothing;
   if not found then return false; end if;
 end if;
 update public.billing_accounts set
  customer_id=p_state->>'customer_id', livemode=coalesce((p_state->>'livemode')::boolean,false), subscription_id=p_state->>'subscription_id',
  subscription_created=coalesce((p_state->>'subscription_created')::bigint,0),
  status=coalesce(p_state->>'status','inactive'),
  trial_used=coalesce((p_state->>'trial_used')::boolean,false),
  period_end=(p_state->>'period_end')::timestamptz,
  cancel_at_period_end=coalesce((p_state->>'cancel_at_period_end')::boolean,false),
  checkout_id=p_state->>'checkout_id',
  checkout_attempt=(p_state->>'checkout_attempt')::uuid, updated_at=now()
 where user_id=p_user_id;
 if p_entitlement is not null then
  insert into public.ai_entitlements(user_id,plan,status,daily_request_limit,valid_until,billing_source,billing_livemode)
  values(p_user_id,'pro',p_entitlement->>'status',100,(p_entitlement->>'valid_until')::timestamptz,'stripe',coalesce((p_state->>'livemode')::boolean,false))
  on conflict(user_id) do update set plan='pro', status=excluded.status,
    daily_request_limit=greatest(public.ai_entitlements.daily_request_limit,100),
    valid_until=excluded.valid_until, billing_source='stripe', billing_livemode=excluded.billing_livemode, updated_at=now()
  -- Preserve separately granted Pro accounts; Stripe only manages its own grant.
  where public.ai_entitlements.billing_source='stripe' or
    public.ai_entitlements.status not in ('active','trialing') or
    public.ai_entitlements.valid_until < now();
 end if;
 return true;
end $$;
revoke all on function public.billing_lock(uuid,uuid) from public, anon, authenticated;
revoke all on function public.billing_unlock(uuid,uuid) from public, anon, authenticated;
revoke all on function public.billing_commit(uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.billing_lock(uuid,uuid) to service_role;
grant execute on function public.billing_unlock(uuid,uuid) to service_role;
grant execute on function public.billing_commit(uuid,uuid,jsonb,jsonb,text) to service_role;
