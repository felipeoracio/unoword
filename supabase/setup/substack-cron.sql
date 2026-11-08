-- Run in Supabase SQL Editor after the Substack migration and backend deploy.
-- Requires Supabase Cron/pg_cron, pg_net, and the existing Vault secret
-- `unoword_ingestion_token` matching Production's CRON_SECRET (32+ chars).
-- Contains no credentials. Changes only `unoword-substack-sync` and preserves
-- the source-processing schedule. Scheduling never enables Pro/live access.
do $$
declare existing bigint;
begin
  if not exists(select 1 from vault.decrypted_secrets
    where name='unoword_ingestion_token' and length(decrypted_secret)>=32) then
    raise exception 'Create the matching unoword_ingestion_token Vault secret first';
  end if;
  if exists(select 1 from cron.job where active and jobname<>'unoword-substack-sync'
    and (position('https://unoword.app/api/internal/substack-sync' in command)>0
      or position('https://unoword.vercel.app/api/internal/substack-sync' in command)>0)) then
    raise exception 'A different active job already schedules Substack sync; review that job before adding another';
  end if;
  select jobid into existing from cron.job where jobname='unoword-substack-sync';
  if found then perform cron.unschedule(existing); end if;
  perform cron.schedule('unoword-substack-sync','*/5 * * * *',
    $schedule$
      select net.http_get(
        url:='https://unoword.app/api/internal/substack-sync',
        headers:=jsonb_build_object('Authorization','Bearer '||(
          select decrypted_secret from vault.decrypted_secrets
          where name='unoword_ingestion_token' limit 1)),
        timeout_milliseconds:=60000
      );
    $schedule$);
end $$;

-- Safe confirmation: returns schedule metadata, never headers or secret values.
select jobname,schedule,active from cron.job where jobname='unoword-substack-sync';
