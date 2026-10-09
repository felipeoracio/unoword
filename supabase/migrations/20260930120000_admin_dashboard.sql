-- Admin dashboard: a self-contained admin identity + audit trail, fully
-- separate from end-user (Supabase) auth. No existing tables are modified.
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  password_changed_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text,
  action text not null,
  record_id text,
  detail text,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- These tables are reached ONLY by the trusted backend via the service-role /
-- pooler connection. Enable RLS with no policies so neither anon nor
-- authenticated end users can ever read them through PostgREST.
alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;
