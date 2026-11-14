-- Review proposal only. Not applied to production by the editor regression run.
-- The migration ledger is infrastructure metadata; browser roles need no access.
begin;
revoke all privileges on table public.unoword_schema_migrations from public, anon, authenticated;
alter table public.unoword_schema_migrations enable row level security;
commit;
