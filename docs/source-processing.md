# Durable document and website processing

Uploads and website saves now persist a job in the existing Supabase database.
The request validates the upload or URL, stores the private source, and returns
`pending`. Extraction, indexing and writing-memory generation run in a worker.
No new hosting service or message broker is needed. The existing storage bucket,
safe website fetcher, document processors, AI configuration, Writing Profile,
retrieval tables and Pro permissions are reused.

## What changes for writers

The extension Library shows the current stage and progress. Failed sources offer
**Retry processing**. Website **Refresh** schedules a new extraction after the
previous job finishes; repeated clicks cannot create competing jobs for the same
source. Jobs persist when the popup closes. The editor's Writing Knowledge list
also refreshes the status of pending sources.

The existing source ID, owner, title edits, enabled setting and previous
successfully published passages survive retries. A refresh keeps its previous
index until the replacement is fully prepared. Pending/failed sources are
excluded from AI personalization by the existing source-availability checks.

Supported formats and the 5 MB upload limit are unchanged. Unsupported formats,
bad signatures, unsafe DOCX archives and invalid text encoding are rejected
before storage. Errors that need full text extraction (for example, a scanned or
encrypted PDF) now appear as a failed Library source rather than a long-running
upload response. Websites retain DNS/private-address/redirect checks and bounded
plain-text extraction. No protected/paywalled-content bypass is added.

## Worker and data safety

- A database lease allows one active job per account. A stale lease is reclaimed
  after three minutes; its old token cannot checkpoint, fail or publish.
- Extraction persists private staging rows. AI indexing checkpoints batches of
  16 passages, using one batched embedding request. Unchanged source passages
  reuse vectors when model and version still match. Unchanged content also
  reuses its summary and memory ID so existing suggestion citations survive.
- Summaries are checkpointed separately from final memory embedding. Existing
  extractive summary fallback is retained.
- Publishing replaces passages, derived memory and source metadata in one
  transaction. A failure rolls it all back. Staging/excerpts are cleared on
  success and cascade away when the source is deleted.
- Source-before-job row locks match deletion ordering. A deletion trigger also
  removes derived memories, closing the race with worker publication.
- Disabled sources and inactive/expired Pro accounts cannot be newly claimed;
  the worker rechecks access before provider work and publication. A worker never
  enables a source or changes subscription state.
- Transient failures retry with backoff (30 seconds, 2 minutes, 8 minutes, then
  up to 30 minutes). Five failures stop automatic attempts; manual Retry resumes
  the saved checkpoint. Invalid/blocked sources fail without repeated fetches.
- Each invocation has a 50-second total budget. At most eight steps run per
  invocation. An interrupted worker can be resumed from the database.
- At most 10 unfinished jobs per account are accepted. Authenticated kicks and
  retries have server rate limits. This does not change subscription prices,
  suggestion quotas or existing AI usage accounting.

Queue and staging tables have RLS enabled and no browser-role grants. Only
service-role functions can mutate them. Client requests verify ownership; queued
jobs contain no access/refresh tokens, Stripe credentials or scheduler secrets.
Errors returned to writers omit internal provider/database details.

## Required rollout

1. Apply [the durable processing migration](../supabase/migrations/20261028020000_durable_source_processing.sql)
   in the existing Supabase project. It is additive and safe to reapply. Deploy
   the dependent backend only after this succeeds.
2. Set (or reuse) a random **CRON_SECRET**, at least 32 characters, in the Vercel backend
   production environment. Generate it in a password manager; keep it out of
   source control and chat. Keep all existing keys, prices and entitlement limits.
3. In Supabase Vault create a secret named **unoword_ingestion_token** using the
   same value. Enable **Cron/pg_cron** and **pg_net** in Supabase if necessary.
4. Run [the scheduler SQL](../supabase/setup/ingestion-cron.sql), then deploy the
   application once the migration and environment setting are ready. The schedule
   will use the new endpoint when that release goes live. It calls the existing
   backend once a minute using the Vault secret. It replaces
   only the `unoword-source-processing` schedule when reapplied. No paid Vercel
   cron tier is required by this setup.
5. Check Supabase Cron run history and `net._http_response`: the worker should
   return HTTP 200. A missing/short backend secret returns 503; a wrong secret
   returns 401. The public worker response contains only a processed-step count.
6. Update the installed extension to **0.16.5**. Save a small source, watch its
   status reach ready, then test closing the popup while another source processes.

Uploads start an immediate best-effort FastAPI background pass. While pending
sources are visible, the editor and extension also request bounded owner-only
work. **Reliable unattended recovery while the browser is closed requires the
scheduled worker above.** Browser polling and in-process background tasks alone
are not the durable delivery guarantee.

If the migration is absent, enqueue fails with `source_processing_unavailable`.
An already uploaded file is preserved as failed so the writer can retry later;
it is not silently discarded. Configure the scheduler before calling unattended
processing ready for production.

## Verification

`supabase/tests/source-processing.cjs` runs the actual migration twice in isolated
PostgreSQL with pgvector, and checks ownership, leases, checkpoints, atomic
publication and rollback, retries/backoff, deletion, consent, downgrade/expiry,
and private RPC/table permissions. Tests use the dev dependencies in
`tests/package.json`; pgvector uses the matching PGlite extension package.

Backend suites `test_source_processing.py`, `test_processing_routes.py`,
`test_embedding_batches.py`, `test_document_processing.py`, and
`test_link_library.py` exercise real worker/router boundaries using local fixtures.
They do not reset production usage or call paid AI APIs.
