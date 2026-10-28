-- Optional scheduler setup, AFTER durable_source_processing.sql and deployment.
-- First enable Supabase Cron (pg_cron) and pg_net in the existing project.
-- In Supabase Vault create `unoword_ingestion_token` with the SAME random secret
-- configured as CRON_SECRET in Vercel. Never commit or paste that value in chat.
-- The SQL below contains no credential values. Running it twice replaces this
-- one schedule; it does not touch unrelated cron jobs.
do $$
declare existing bigint;
begin
  if not exists(select 1 from vault.decrypted_secrets where name='unoword_ingestion_token' and length(decrypted_secret)>=32) then
    raise exception 'Create the matching unoword_ingestion_token Vault secret first';
  end if;
  select jobid into existing from cron.job where jobname='unoword-source-processing';
  if found then perform cron.unschedule(existing); end if;
  perform cron.schedule('unoword-source-processing','* * * * *',
    $schedule$
      select net.http_get(
        url:='https://unoword.vercel.app/api/internal/ingestion',
        headers:=jsonb_build_object('Authorization','Bearer '||(
          select decrypted_secret from vault.decrypted_secrets where name='unoword_ingestion_token' limit 1)),
        timeout_milliseconds:=60000
      );
    $schedule$);
end $$;
