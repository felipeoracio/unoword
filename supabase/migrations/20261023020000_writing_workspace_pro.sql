-- Pro-only writing workspace; preserve all existing writing and historical counts.
-- Run after 20261023010000_writing_workspace.sql. Safe to apply repeatedly.
begin;
create or replace function public.workspace_has_pro_access()
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.ai_entitlements e
    where e.user_id = auth.uid()
      and e.plan in ('pro', 'premium')
      and e.status in ('active', 'trialing')
      and (e.valid_until is null or e.valid_until >= now())
  );
$$;
revoke all on function public.workspace_has_pro_access() from public, anon;
grant execute on function public.workspace_has_pro_access() to authenticated;

-- Restrictive policies AND with the existing owner policies, including through RPCs.
drop policy if exists writing_document_pro on public.writing_documents;
create policy writing_document_pro on public.writing_documents as restrictive
  for all to authenticated using (public.workspace_has_pro_access())
  with check (public.workspace_has_pro_access());
drop policy if exists writing_folder_pro on public.writing_folders;
create policy writing_folder_pro on public.writing_folders as restrictive
  for all to authenticated using (public.workspace_has_pro_access())
  with check (public.workspace_has_pro_access());

-- A downgrade must not erase past statistics or hide them from the extension.
drop policy if exists writing_activity_pro_insert on public.writing_activity;
create policy writing_activity_pro_insert on public.writing_activity as restrictive
  for insert to authenticated with check (public.workspace_has_pro_access());
drop policy if exists writing_activity_pro_update on public.writing_activity;
create policy writing_activity_pro_update on public.writing_activity as restrictive
  for update to authenticated using (public.workspace_has_pro_access())
  with check (public.workspace_has_pro_access());
drop policy if exists writing_activity_pro_delete on public.writing_activity;
create policy writing_activity_pro_delete on public.writing_activity as restrictive
  for delete to authenticated using (public.workspace_has_pro_access());
commit;
