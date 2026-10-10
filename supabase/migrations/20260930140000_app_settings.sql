-- Server-only application settings (e.g. the encrypted project-wide OpenAI API key).
-- No RLS policies are defined: the table is reachable only by server-side code using
-- the service role / direct DB connection, never by the anon/authenticated client.
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

comment on table public.app_settings is
  'Server-only app configuration (encrypted OpenAI key, last test time, key hint). RLS enabled with NO policies: never client-accessible.';
