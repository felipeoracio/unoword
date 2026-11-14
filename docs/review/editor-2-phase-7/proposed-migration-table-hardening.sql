-- Approved and applied to production as Supabase migration
-- 20261114195333_restrict_unoword_migration_history_access.
-- The migration ledger is infrastructure metadata; browser roles need no access.
begin;
revoke all privileges on table public.unoword_schema_migrations from public, anon, authenticated;
alter table public.unoword_schema_migrations enable row level security;
commit;
