-- AI Knowledge Pipeline repair:
-- 1. match_user_chunks also excludes memories derived from DISABLED sources.
-- 2. search_user_chunks_text: keyword fallback when vectors are missing/weak.
-- 3. Re-revoke direct execution from `authenticated` (regressed in link_sources).

create index if not exists ai_memories_user_source_idx on public.ai_memories (user_id, source_id);

create or replace function public.match_user_chunks(
  p_user_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_threshold float default 0.25,
  p_match_count integer default 8
)
returns table (source_type text, source_id uuid, parent_id uuid, content text, similarity float)
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
    select 'memory'::text, m.id, m.source_id,
      m.memory, 1 - (m.embedding <=> p_query_embedding)
    from public.ai_memories m
    left join public.ai_documents d on d.id = m.source_id
    where m.user_id = p_user_id and m.embedding is not null and (d.id is null or d.enabled = true)
  ) matched
  where matched.similarity >= p_match_threshold
  order by matched.similarity desc
  limit greatest(1, least(p_match_count, 20));
$$;

create or replace function public.search_user_chunks_text(
  p_user_id uuid,
  p_terms text[],
  p_match_count integer default 8
)
returns table (source_type text, source_id uuid, parent_id uuid, content text, similarity float)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select string_agg(plainto_tsquery('simple', t)::text, ' | ')::tsquery as tsq
    from unnest(p_terms) t
    where plainto_tsquery('simple', t)::text <> ''
  )
  select matched.source_type, matched.source_id, matched.parent_id, matched.content, matched.similarity
  from q, lateral (
    select 'document_chunk'::text as source_type, c.id as source_id, c.document_id as parent_id,
      c.content, ts_rank_cd(to_tsvector('simple', c.content), q.tsq)::float as similarity
    from public.ai_document_chunks c
    join public.ai_documents d on d.id = c.document_id
    where c.user_id = p_user_id and d.enabled = true
      and to_tsvector('simple', c.content) @@ q.tsq
    union all
    select 'writing_chunk'::text, w.id, w.writing_session_id,
      w.content, ts_rank_cd(to_tsvector('simple', w.content), q.tsq)::float
    from public.ai_writing_chunks w
    where w.user_id = p_user_id and to_tsvector('simple', w.content) @@ q.tsq
    union all
    select 'memory'::text, m.id, m.source_id,
      m.memory, ts_rank_cd(to_tsvector('simple', m.memory), q.tsq)::float
    from public.ai_memories m
    left join public.ai_documents d on d.id = m.source_id
    where m.user_id = p_user_id and (d.id is null or d.enabled = true)
      and to_tsvector('simple', m.memory) @@ q.tsq
  ) matched
  where q.tsq is not null
  order by matched.similarity desc
  limit greatest(1, least(p_match_count, 20));
$$;

revoke execute on function public.match_user_chunks(uuid, extensions.vector, float, integer) from public;
revoke execute on function public.match_user_chunks(uuid, extensions.vector, float, integer) from anon;
revoke execute on function public.match_user_chunks(uuid, extensions.vector, float, integer) from authenticated;
grant execute on function public.match_user_chunks(uuid, extensions.vector, float, integer) to service_role;

revoke execute on function public.search_user_chunks_text(uuid, text[], integer) from public;
revoke execute on function public.search_user_chunks_text(uuid, text[], integer) from anon;
revoke execute on function public.search_user_chunks_text(uuid, text[], integer) from authenticated;
grant execute on function public.search_user_chunks_text(uuid, text[], integer) to service_role;
