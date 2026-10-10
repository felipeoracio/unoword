-- Website Links in Private Documents (Part 2): reuse ai_documents / ai_document_chunks
-- so linked articles flow through the SAME user-scoped RAG retrieval as uploaded files.
-- A link is an ai_documents row with source_kind='link' (no storage object). An
-- `enabled` flag lets the writer exclude a source from AI retrieval without deleting it.

alter table public.ai_documents
  add column if not exists source_kind text not null default 'file',
  add column if not exists source_url text,
  add column if not exists canonical_url text,
  add column if not exists author text,
  add column if not exists published_at text,
  add column if not exists description text,
  add column if not exists category text,
  add column if not exists enabled boolean not null default true,
  add column if not exists content_hash text,
  add column if not exists last_processed_at timestamptz;

-- Links have no uploaded file in Storage.
alter table public.ai_documents alter column storage_path drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_documents_source_kind_chk') then
    alter table public.ai_documents
      add constraint ai_documents_source_kind_chk check (source_kind in ('file', 'link'));
  end if;
end $$;

-- One saved link per URL per user (files keep NULL source_url and are excluded).
create unique index if not exists ai_documents_user_link_url_uidx
  on public.ai_documents (user_id, source_url)
  where source_kind = 'link';

-- Recreate the retrieval RPC so DISABLED documents/links are excluded from AI
-- context. Signature and grants are unchanged; only the document-chunk branch
-- now joins ai_documents and requires d.enabled = true.
create or replace function public.match_user_chunks(
  p_user_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_threshold float default 0.55,
  p_match_count integer default 8
)
returns table (
  source_type text,
  source_id uuid,
  parent_id uuid,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select matched.source_type, matched.source_id, matched.parent_id, matched.content, matched.similarity
  from (
    select 'document_chunk'::text as source_type, c.id as source_id, c.document_id as parent_id,
      c.content, 1 - (c.embedding <=> p_query_embedding) as similarity
    from public.ai_document_chunks c
    join public.ai_documents d on d.id = c.document_id
    where c.user_id = p_user_id and c.embedding is not null and d.enabled = true
    union all
    select 'writing_chunk'::text, w.id, w.writing_session_id,
      w.content, 1 - (w.embedding <=> p_query_embedding)
    from public.ai_writing_chunks w
    where w.user_id = p_user_id and w.embedding is not null
    union all
    select 'memory'::text, m.id, null::uuid,
      m.memory, 1 - (m.embedding <=> p_query_embedding)
    from public.ai_memories m
    where m.user_id = p_user_id and m.embedding is not null
  ) matched
  where matched.similarity >= p_match_threshold
  order by matched.similarity desc
  limit greatest(1, least(p_match_count, 20));
$$;

grant execute on function public.match_user_chunks(uuid, extensions.vector, float, integer) to authenticated;
grant execute on function public.match_user_chunks(uuid, extensions.vector, float, integer) to service_role;
