-- Test-mode-only lifetime offer: 25 places, one purchase per account.
-- No browser role can reserve inventory, attach Stripe IDs, or grant access.
begin;
create table if not exists public.lifetime_orders (
 user_id uuid primary key references auth.users(id) on delete cascade,
 slot integer unique not null check(slot between 1 and 25),
 attempt uuid unique not null,
 customer_id text not null,
 price_id text not null,
 checkout_id text unique,
 payment_intent_id text unique,
 status text not null default 'reserved' check(status in ('reserved','paid','refunded','disputed')),
 paid_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.lifetime_sold_slots (
 slot integer primary key check(slot between 1 and 25),
 payment_intent_id text unique not null
);
alter table public.lifetime_sold_slots enable row level security;
revoke all on public.lifetime_sold_slots from anon,authenticated;
grant all on public.lifetime_sold_slots to service_role;
alter table public.lifetime_orders enable row level security;
revoke all on public.lifetime_orders from anon,authenticated;
grant all on public.lifetime_orders to service_role;

create or replace function public.lifetime_reserve(p_user_id uuid,p_attempt uuid,p_customer text,p_price text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.lifetime_orders; chosen integer;
begin
 perform pg_advisory_xact_lock(2601000025);
 select * into item from public.lifetime_orders where user_id=p_user_id;
 if found then return to_jsonb(item); end if;
 select candidate into chosen from generate_series(1,25) candidate
 where not exists(select 1 from public.lifetime_orders o where o.slot=candidate)
 and not exists(select 1 from public.lifetime_sold_slots s where s.slot=candidate) order by candidate limit 1;
 if chosen is null then raise exception 'lifetime_capacity_unavailable'; end if;
 insert into public.lifetime_orders(user_id,slot,attempt,customer_id,price_id)
 values(p_user_id,chosen,p_attempt,p_customer,p_price) returning * into item;
 return to_jsonb(item);
end $$;
create or replace function public.lifetime_attach(p_user_id uuid,p_attempt uuid,p_checkout text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.lifetime_orders set checkout_id=p_checkout,updated_at=now()
 where user_id=p_user_id and attempt=p_attempt and status='reserved' and (checkout_id is null or checkout_id=p_checkout);
 return found;
end $$;
-- Release only after backend verification that Stripe says this exact session expired.
create or replace function public.lifetime_release(p_user_id uuid,p_attempt uuid,p_checkout text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(2601000025);
 delete from public.lifetime_orders where user_id=p_user_id and attempt=p_attempt and checkout_id=p_checkout and status='reserved';
 return found;
end $$;
create or replace function public.lifetime_finalize(p_user_id uuid,p_attempt uuid,p_checkout text,p_payment_intent text,p_status text,p_event text,p_paid_at timestamptz default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.lifetime_orders;
begin
 perform pg_advisory_xact_lock(2601000025);
 if p_status not in ('paid','refunded','disputed') then raise exception 'invalid_lifetime_status'; end if;
 select * into item from public.lifetime_orders where user_id=p_user_id for update;
 if not found or item.attempt<>p_attempt or item.checkout_id is distinct from p_checkout or (item.payment_intent_id is not null and item.payment_intent_id<>p_payment_intent)
 then raise exception 'lifetime_owner_mismatch'; end if;
 insert into public.billing_events(event_id,user_id) values(p_event,p_user_id) on conflict do nothing;
 if not found then return false; end if;
 insert into public.lifetime_sold_slots(slot,payment_intent_id) values(item.slot,p_payment_intent) on conflict do nothing;
 update public.lifetime_orders set status=p_status,payment_intent_id=p_payment_intent,paid_at=coalesce(paid_at,p_paid_at,now()),updated_at=now() where user_id=p_user_id;
 if p_status='paid' then
  insert into public.ai_entitlements(user_id,plan,status,daily_request_limit,valid_until,billing_source,billing_livemode)
  values(p_user_id,'pro','active',100,null,'stripe_lifetime',false)
  on conflict(user_id) do update set plan='pro',status='active',valid_until=null,
    daily_request_limit=greatest(public.ai_entitlements.daily_request_limit,100),billing_source='stripe_lifetime',billing_livemode=false,updated_at=now();
 else
  update public.ai_entitlements set status='inactive',updated_at=now()
  where user_id=p_user_id and billing_source='stripe_lifetime' and billing_livemode=false;
 end if;
 return true;
end $$;
revoke all on function public.lifetime_reserve(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.lifetime_attach(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.lifetime_release(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.lifetime_finalize(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.lifetime_reserve(uuid,uuid,text,text) to service_role;
grant execute on function public.lifetime_attach(uuid,uuid,text) to service_role;
grant execute on function public.lifetime_release(uuid,uuid,text) to service_role;
grant execute on function public.lifetime_finalize(uuid,uuid,text,text,text,text,timestamptz) to service_role;
commit;
notify pgrst, 'reload schema';
