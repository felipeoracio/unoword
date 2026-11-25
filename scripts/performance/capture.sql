-- Read-only, bounded snapshot. Do not reset cumulative statistics.
-- Capture before/after under comparable workload; once per minute at most.
select jsonb_build_object(
 'captured_at',now(),
 'stats_reset',(select stats_reset from pg_stat_statements_info),
 'database_bytes',pg_database_size(current_database()),
 'max_connections',current_setting('max_connections'),
 'database',(select to_jsonb(s) from (
  select numbackends,xact_commit,xact_rollback,blks_hit,blks_read,temp_bytes,deadlocks
  from pg_stat_database where datname=current_database())s),
 'active_api_workers',(select count(*) from pg_stat_activity where application_name like 'PostgREST%' and state='active'),
 'blocked_connections',(select count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid))>0),
 'statement_groups',(select jsonb_agg(s) from (
   select case when query like '%set_config%request.jwt.claims%' then 'postgrest_request_setup'
     when query like '%workspace_save_document%' then 'document_save'
     when query like '%ai_coach_state%' then 'ai_usage'
     when query like '%writing_rewards%' then 'rewards'
     when query like '%writing_account_summary%' then 'writing_summary'
     else 'other' end as operation,
    sum(calls) calls,sum(total_exec_time) total_exec_ms
   from extensions.pg_stat_statements group by 1)s)
) as snapshot;
