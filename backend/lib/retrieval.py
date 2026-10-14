"""User-scoped retrieval over private embeddings with feedback-aware reranking.

Called from `/api/ai/suggestion`. Every call embeds the query, invokes the
`match_user_chunks` RPC with an explicit `p_user_id`, applies a bias built
from the user's accepted / rejected suggestion history (positive for accepted
`source_ids`, negative for rejected ones), deduplicates by parent, and
returns typed chunks. Retrieved content is treated as untrusted context
inside the suggestion prompt.
"""

from __future__ import annotations

import logging
import math
import os
from collections import defaultdict
from dataclasses import dataclass

from lib.embeddings import get_embeddings_service
from lib.knowledge import keyword_terms
from lib.supabase_client import SupabaseAPIError, service_rest

logger = logging.getLogger(__name__)

# How strongly feedback bends similarity. Kept small so a highly-relevant new
# chunk can still surface over a stale accepted one, but large enough that a
# rejected source visibly drops down the ranking.
FEEDBACK_WEIGHT = 0.12
# Parent-level bias (siblings in the same document or writing session)
# receives a softened share of the parent's signal.
PARENT_WEIGHT = 0.5
# Rejection is a stronger explicit signal than acceptance.
ACCEPT_INC = 1.0
REJECT_INC = -1.5
# Clamp per-source score before feeding into tanh so a few noisy rejections
# don't permanently blacklist a chunk.
BIAS_CLAMP = 3.0
# Drop candidates whose adjusted similarity is clearly below the retrieval
# threshold after bias — otherwise a rejected chunk with a slightly higher
# raw similarity would still slip in.
# text-embedding-3-small cosine scores for related text are typically 0.25-0.6.
MATCH_THRESHOLD = float(os.environ.get("AI_MATCH_THRESHOLD", "0.25"))
MIN_ADJUSTED_SIMILARITY = float(os.environ.get("AI_MIN_ADJUSTED_SIMILARITY", "0.2"))
# A long document can contribute a couple of distinct relevant passages.
MAX_PER_SOURCE = 2
# How many past accepted/rejected suggestions to consider.
FEEDBACK_LOOKBACK = 100


@dataclass(frozen=True)
class RetrievedChunk:
    source_type: str
    source_id: str
    parent_id: str | None
    content: str
    similarity: float
    source_title: str | None = None
    match: str = "vector"


async def _fetch_feedback_bias(user_id: str) -> tuple[dict[str, float], dict[str, float]]:
    """Return ({source_id: score}, {parent_id: score}) clamped to [-CLAMP, CLAMP]."""

    try:
        rows = await service_rest(
            "GET",
            "ai_suggestions",
            params={
                "select": "status,source_ids",
                "user_id": f"eq.{user_id}",
                "status": "in.(accepted,rejected)",
                "order": "created_at.desc",
                "limit": str(FEEDBACK_LOOKBACK),
            },
        )
    except SupabaseAPIError as error:
        logger.warning(
            "feedback_bias_fetch_failed status=%s detail=%s",
            error.response_status,
            error.detail,
        )
        return {}, {}
    source_score: dict[str, float] = defaultdict(float)
    for row in rows or []:
        inc = ACCEPT_INC if row.get("status") == "accepted" else REJECT_INC
        for sid in row.get("source_ids") or []:
            source_score[str(sid)] += inc
    # Parents inherit an averaged share of their children's scores; if the
    # `parent_id` is itself referenced directly it's already in source_score.
    parent_score: dict[str, float] = {}
    clamped_source = {
        sid: max(-BIAS_CLAMP, min(BIAS_CLAMP, score))
        for sid, score in source_score.items()
    }
    return clamped_source, parent_score


def _bias_for(
    source_id: str,
    parent_id: str | None,
    source_scores: dict[str, float],
    parent_scores: dict[str, float],
) -> float:
    direct = source_scores.get(source_id, 0.0)
    parent = source_scores.get(parent_id, 0.0) if parent_id else 0.0
    parent = parent or parent_scores.get(parent_id or "", 0.0)
    combined = direct + PARENT_WEIGHT * parent
    if combined == 0.0:
        return 0.0
    return FEEDBACK_WEIGHT * math.tanh(combined / BIAS_CLAMP)


async def _vector_rows(user_id: str, query: str, fetch_count: int, threshold: float) -> list[dict]:
    embeddings = get_embeddings_service()
    if not embeddings.enabled:
        return []
    embedded = await embeddings.embed(query)
    if not embedded:
        return []
    try:
        return await service_rest(
            "POST",
            "rpc/match_user_chunks",
            json={
                "p_user_id": user_id,
                "p_query_embedding": embedded.embedding,
                "p_match_threshold": threshold,
                "p_match_count": fetch_count,
            },
        ) or []
    except SupabaseAPIError as error:
        logger.warning("retrieval_rpc_failed status=%s detail=%s", error.response_status, error.detail)
        return []


async def _keyword_rows(user_id: str, query: str, fetch_count: int) -> list[dict]:
    terms = keyword_terms(query)
    if not terms:
        return []
    try:
        return await service_rest(
            "POST",
            "rpc/search_user_chunks_text",
            json={"p_user_id": user_id, "p_terms": terms, "p_match_count": fetch_count},
        ) or []
    except SupabaseAPIError as error:
        logger.warning("keyword_rpc_failed status=%s detail=%s", error.response_status, error.detail)
        return []


async def _document_titles(user_id: str, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    try:
        rows = await service_rest(
            "GET",
            "ai_documents",
            params={"select": "id,document_title", "user_id": f"eq.{user_id}", "id": f"in.({','.join(ids)})"},
        )
    except SupabaseAPIError:
        return {}
    return {str(row["id"]): row.get("document_title") or "" for row in rows or []}


async def retrieve_user_chunks(
    user_id: str,
    query: str,
    *,
    match_count: int = 6,
    match_threshold: float | None = None,
) -> list[RetrievedChunk]:
    # Overfetch so feedback-driven reranking has room to drop losers.
    fetch_count = min(20, match_count * 2)
    threshold = MATCH_THRESHOLD if match_threshold is None else match_threshold
    rows = await _vector_rows(user_id, query, fetch_count, threshold)
    match_kind = "vector"
    if not rows:
        # Missing vectors, embedding outage, or no semantic hit: keyword fallback.
        rows = await _keyword_rows(user_id, query, fetch_count)
        match_kind = "keyword"
    if not rows:
        return []

    source_scores, parent_scores = await _fetch_feedback_bias(user_id)

    scored: list[tuple[float, float, dict]] = []
    for row in rows:
        source_id = str(row.get("source_id"))
        parent = row.get("parent_id")
        parent_id = str(parent) if parent else None
        bias = _bias_for(source_id, parent_id, source_scores, parent_scores)
        if match_kind == "keyword":
            base = MIN_ADJUSTED_SIMILARITY + min(0.2, float(row.get("similarity") or 0.0))
            if bias < 0 and base + bias < MIN_ADJUSTED_SIMILARITY:
                continue
        else:
            base = float(row.get("similarity") or 0.0)
            if base + bias < MIN_ADJUSTED_SIMILARITY:
                continue
        scored.append((base + bias, base, row))
    if not scored:
        return []
    scored.sort(key=lambda item: item[0], reverse=True)

    per_parent: dict[str, int] = defaultdict(int)
    picked: list[tuple[float, dict]] = []
    for adjusted, _base, row in scored:
        parent = row.get("parent_id")
        dedupe_key = str(parent) if parent else str(row.get("source_id"))
        if per_parent[dedupe_key] >= MAX_PER_SOURCE:
            continue
        per_parent[dedupe_key] += 1
        picked.append((adjusted, row))
        if len(picked) >= match_count:
            break
    titles = await _document_titles(
        user_id,
        {str(row["parent_id"]) for _, row in picked if row.get("parent_id") and row.get("source_type") != "writing_chunk"},
    )
    return [
        RetrievedChunk(
            source_type=str(row.get("source_type") or "unknown"),
            source_id=str(row.get("source_id")),
            parent_id=str(row["parent_id"]) if row.get("parent_id") else None,
            content=str(row.get("content") or ""),
            similarity=adjusted,
            source_title=titles.get(str(row.get("parent_id"))),
            match=match_kind,
        )
        for adjusted, row in picked
    ]
