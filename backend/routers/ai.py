"""RLS-backed AI profile, memory, suggestion, feedback, and usage routes.

Phase 11 turns the suggestion path into a real per-user RAG pipeline:
embeddings on ingest for saved writing chunks and memories, private retrieval
via `match_user_chunks`, and an OpenAI-backed provider with a Phase-13 basic
fallback if retrieval or the model fails.
"""

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from lib.ai_provider import (
    MockSuggestionProvider,
    SuggestionProviderResponse,
    get_suggestion_provider,
)
from lib.ai_access import get_entitlement, require_ai_user
from lib.auth import AuthenticatedUser, auth_is_configured
from lib import knowledge
from lib.dates import today_iso
from lib.embeddings import get_embeddings_service
from lib.prompts import UNO_WORD_COACH_SYSTEM_PROMPT
from lib.retrieval import RetrievedChunk, retrieve_user_chunks
from lib.supabase_client import SupabaseAPIError, raise_http, service_rest, user_rest
from lib.supabase_config import supabase_is_configured
from lib.writing_context import library_overview
from lib.suggestion_details import encode_details, evidence_catalog, attributed_sources
from lib.suggestion_knowledge import selected_idea_text, diverse_passages
from models.ai import (
    AIFeedback,
    AIMemory,
    AIMemoryCreate,
    AIOnboardingAnswer,
    AIOnboardingAnswerUpsert,
    AIProfile,
    AIProfileUpdate,
    AIStatus,
    AISuggestion,
    AISuggestionFeedbackCreate,
    AISuggestionRequest,
    AIUsageEvent,
    AIUsageSummary,
    AIWritingChunk,
    AIWritingSession,
    AIWritingSessionCreate,
)

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)


async def _user_rows(
    table: str,
    user: AuthenticatedUser,
    *,
    extra: dict[str, str] | None = None,
) -> list[dict]:
    params = {"select": "*", "user_id": f"eq.{user.id}", **(extra or {})}
    try:
        return await user_rest("GET", table, user.access_token, params=params)
    except SupabaseAPIError as error:
        raise_http(error)


async def _entitlement(user_id: str) -> dict:
    entitlement = await get_entitlement(user_id)
    if not entitlement:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="An eligible UnoWord AI plan is required",
        )
    return entitlement


# --- Phase 15 cost controls -------------------------------------------------
# Send a bounded overview of the library alongside relevant passages. Reserve
# space for interests and recent suggestions so passages cannot crowd them out.
MAX_DRAFT_CHARS = int(os.environ.get("AI_MAX_DRAFT_CHARS", "2000"))
MAX_CONTEXT_CHARS = int(os.environ.get("AI_MAX_CONTEXT_CHARS", "6000"))
MAX_CHUNK_CHARS = int(os.environ.get("AI_MAX_CHUNK_CHARS", "900"))


def _resolve_daily_limit(entitlement: dict) -> int:
    """Effective per-user daily suggestion cap. An env cap (>0) is authoritative
    and, combined with a per-user entitlement limit, the stricter (lower) wins."""
    env_cap = int(os.environ.get("AI_DAILY_REQUEST_LIMIT", "0") or 0)
    ent = int(entitlement.get("daily_request_limit") or 0)
    if env_cap and ent:
        return min(env_cap, ent)
    return env_cap or ent


def _compose_prompt_context(
    payload: AISuggestionRequest,
    profile: list[dict],
    answers: list[dict],
    memories: list[dict],
    previous: list[dict],
    retrieved: list[RetrievedChunk],
    sources: list[dict] | None = None,
) -> tuple[str, list[str]]:
    """Balance breadth, focused evidence, and novelty within the context budget."""
    parts: list[str] = []
    source_ids: list[str] = []

    def section(heading: str, items: list[tuple[str, list[str]]], budget: int, count: int) -> None:
        items = items[:count]
        if not items:
            return
        remaining = min(budget, MAX_CONTEXT_CHARS - sum(len(p) + 1 for p in parts))
        per_item = (remaining - len(heading) - 1) // len(items) - 3
        if per_item < 30:
            return
        lines = [heading]
        for text, ids in items:
            text = text.strip()
            if not text:
                continue
            # Only label IDs actually sent, so output references can be checked.
            prefix = f"[{ids[0]}] " if ids else ""
            text_budget = max(1, per_item - len(prefix))
            lines.append("- " + prefix + (text if len(text) <= text_budget else text[:text_budget - 1] + "…"))
            source_ids.extend(ids[:1])
        parts.append("\n".join(lines))

    if payload.current_writing:
        parts.append(f"Current writing draft [current_writing]:\n{payload.current_writing[:MAX_DRAFT_CHARS]}")
    if payload.current_project:
        parts.append(f"Current project focus: {payload.current_project[:300]}")
    available = max(0, MAX_CONTEXT_CHARS - sum(len(p) + 1 for p in parts))
    if profile:
        item = profile[0]
        fields = [
            (f"{name}: {item[name]}", [item["id"]])
            for name in (
                "avoid_topics",
                "writing_goal",
                "primary_topics",
                "favorite_subjects",
                "current_projects",
                "personal_context",
                "writing_style",
                "audience",
            )
            if item.get(name)
        ]
        section("Writer profile and interests:", fields, int(available * 0.17), 8)
    section("Onboarding answers:", [
        (f'{a.get("question")}: {a.get("answer")}', [a["id"]]) for a in answers
    ], int(available * 0.08), 4)
    section("Recent suggestions — choose a different topic or angle:", [
        (f'({s.get("status")}) {s.get("title") or ""}: {s.get("suggestion") or ""}', [])
        for s in previous
    ], int(available * 0.18), 5)
    section("Broader shared context — interests, saved writing, documents and links:",
            library_overview(sources or [], memories, previous), int(available * 0.35), 12)
    passages = []
    for chunk in retrieved:
        label = chunk.source_type + (f' "{chunk.source_title}"' if chunk.source_title else "")
        passages.append((f"[{label}] {chunk.content[:MAX_CHUNK_CHARS]}", [chunk.source_id]))
    # Use remaining space for supporting detail after preserving the broader view.
    section("Matching passages (supporting evidence, not the only possible topics):",
            passages, MAX_CONTEXT_CHARS, 6)
    joined = "\n".join(parts)[:MAX_CONTEXT_CHARS]
    return joined or "No saved user context is available yet.", list(dict.fromkeys(source_ids))


async def _record_usage(
    user_id: str,
    *,
    request_type: str,
    model: str,
    input_tokens: int | None,
    output_tokens: int | None,
    provider: str,
) -> None:
    body: dict = {
        "user_id": user_id,
        "date": today_iso(),
        "request_type": request_type,
    }
    if input_tokens is not None:
        body["input_tokens"] = input_tokens
    if output_tokens is not None:
        body["output_tokens"] = output_tokens
    if input_tokens is not None and output_tokens is not None:
        # Rough cost estimate for gpt-5.4-mini class models; kept as a small
        # heuristic. Not used for billing.
        body["estimated_cost"] = round(
            (input_tokens * 0.15 + output_tokens * 0.60) / 1_000_000,
            6,
        )
    try:
        await service_rest("POST", "ai_usage", json=body, prefer="return=minimal")
    except SupabaseAPIError as error:
        logger.warning(
            "usage_write_failed provider=%s model=%s status=%s detail=%s",
            provider,
            model,
            error.response_status,
            error.detail,
        )


@router.get("/status", response_model=AIStatus)
async def ai_status() -> AIStatus:
    provider = get_suggestion_provider()
    embeddings = get_embeddings_service()
    configured = supabase_is_configured()
    ready = configured and embeddings.enabled
    detail = "Supabase Auth, PostgREST, RLS, and pgvector are connected."
    if not configured:
        detail = "Supabase is not configured."
    elif not embeddings.enabled:
        detail = "OpenAI embeddings key is not configured; retrieval will fall back."
    return AIStatus(
        auth_configured=auth_is_configured(),
        database="supabase",
        database_configured=configured,
        provider=provider.name,
        model=provider.model,
        retrieval_ready=ready,
        message=detail,
    )


@router.get("/profile", response_model=AIProfile)
async def get_profile(user: AuthenticatedUser = Depends(require_ai_user)) -> AIProfile:
    rows = await _user_rows("ai_profiles", user, extra={"limit": "1"})
    if rows:
        return AIProfile(**rows[0])
    try:
        created = await user_rest(
            "POST",
            "ai_profiles",
            user.access_token,
            json={"user_id": user.id},
            prefer="return=representation",
        )
    except SupabaseAPIError as error:
        raise_http(error)
    return AIProfile(**created[0])


@router.put("/profile", response_model=AIProfile)
async def update_profile(
    payload: AIProfileUpdate,
    user: AuthenticatedUser = Depends(require_ai_user),
) -> AIProfile:
    body = {"user_id": user.id, **payload.model_dump()}
    try:
        rows = await user_rest(
            "POST",
            "ai_profiles",
            user.access_token,
            params={"on_conflict": "user_id"},
            json=body,
            prefer="resolution=merge-duplicates,return=representation",
        )
    except SupabaseAPIError as error:
        raise_http(error)
    return AIProfile(**rows[0])


@router.get("/onboarding", response_model=list[AIOnboardingAnswer])
async def list_onboarding(
    user: AuthenticatedUser = Depends(require_ai_user),
) -> list[AIOnboardingAnswer]:
    rows = await _user_rows(
        "ai_onboarding_answers",
        user,
        extra={"order": "updated_at.desc", "limit": "100"},
    )
    return [AIOnboardingAnswer(**row) for row in rows]


@router.put("/onboarding", response_model=AIOnboardingAnswer)
async def upsert_onboarding(
    payload: AIOnboardingAnswerUpsert,
    user: AuthenticatedUser = Depends(require_ai_user),
) -> AIOnboardingAnswer:
    try:
        rows = await user_rest(
            "POST",
            "ai_onboarding_answers",
            user.access_token,
            params={"on_conflict": "user_id,question_id"},
            json={"user_id": user.id, **payload.model_dump()},
            prefer="resolution=merge-duplicates,return=representation",
        )
    except SupabaseAPIError as error:
        raise_http(error)
    return AIOnboardingAnswer(**rows[0])


@router.get("/memories", response_model=list[AIMemory])
async def list_memories(user: AuthenticatedUser = Depends(require_ai_user)) -> list[AIMemory]:
    rows = await _user_rows(
        "ai_memories",
        user,
        extra={"order": "updated_at.desc", "limit": "200"},
    )
    return [AIMemory(**row) for row in rows]


@router.post("/memories", response_model=AIMemory, status_code=status.HTTP_201_CREATED)
async def create_memory(
    payload: AIMemoryCreate,
    user: AuthenticatedUser = Depends(require_ai_user),
) -> AIMemory:
    body: dict = {"user_id": user.id, **payload.model_dump()}
    embeddings = get_embeddings_service()
    if embeddings.enabled:
        embedded = await embeddings.embed(payload.memory)
        if embedded:
            body["embedding"] = embedded.embedding
            body["embedding_model"] = embedded.model
            body["embedding_version"] = embedded.version
    try:
        rows = await user_rest(
            "POST",
            "ai_memories",
            user.access_token,
            json=body,
            prefer="return=representation",
        )
    except SupabaseAPIError as error:
        raise_http(error)
    return AIMemory(**rows[0])


@router.delete("/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: str,
    user: AuthenticatedUser = Depends(require_ai_user),
) -> None:
    try:
        rows = await user_rest(
            "DELETE",
            "ai_memories",
            user.access_token,
            params={"id": f"eq.{memory_id}", "user_id": f"eq.{user.id}"},
            prefer="return=representation",
        )
    except SupabaseAPIError as error:
        raise_http(error)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory not found")


@router.post(
    "/writing-sessions",
    response_model=AIWritingSession,
    status_code=status.HTTP_201_CREATED,
)
async def save_writing_session(
    payload: AIWritingSessionCreate,
    user: AuthenticatedUser = Depends(require_ai_user),
) -> AIWritingSession:
    session: AIWritingSession | None = None
    if payload.existing_session_ref:
        existing = await _user_rows(
            "ai_writing_sessions",
            user,
            extra={
                "existing_session_ref": f"eq.{payload.existing_session_ref}",
                "limit": "1",
            },
        )
        if existing:
            session = AIWritingSession(**existing[0])
    try:
        if session is None:
            session_body = {**payload.model_dump(), "user_id": user.id}
            if not payload.save_to_memory:
                session_body["content"] = None
            sessions = await user_rest(
                "POST",
                "ai_writing_sessions",
                user.access_token,
                json=session_body,
                prefer="return=representation",
            )
            session = AIWritingSession(**sessions[0])
        if payload.save_to_memory and payload.content:
            embeddings = get_embeddings_service()
            chunks: list[dict] = []
            for index, content in enumerate(knowledge.split(payload.content)):
                row = AIWritingChunk(
                    user_id=user.id,
                    writing_session_id=session.id,
                    chunk_index=index,
                    content=content,
                ).model_dump(mode="json")
                if embeddings.enabled:
                    embedded = await embeddings.embed(content)
                    if embedded:
                        row["embedding"] = embedded.embedding
                        row["embedding_model"] = embedded.model
                        row["embedding_version"] = embedded.version
                chunks.append(row)
            await user_rest(
                "POST",
                "ai_writing_chunks",
                user.access_token,
                params={"on_conflict": "writing_session_id,chunk_index"},
                json=chunks,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            await knowledge.rebuild_source_memory(
                user.id, user.access_token, session.id,
                title=f"{session.created_at:%Y-%m-%d}", text=payload.content,
                kind="writing session", memory_type="experience",
            )
    except SupabaseAPIError as error:
        raise_http(error)
    return session


@router.post("/suggestion", response_model=AISuggestion)
async def create_suggestion(
    payload: AISuggestionRequest,
    user: AuthenticatedUser = Depends(require_ai_user),
) -> AISuggestion:
    entitlement = await _entitlement(user.id)
    date_key = today_iso()
    daily_limit = _resolve_daily_limit(entitlement)
    if daily_limit:
        try:
            used = await service_rest(
                "GET",
                "ai_usage",
                params={
                    "select": "id",
                    "user_id": f"eq.{user.id}",
                    "date": f"eq.{date_key}",
                    "request_type": "eq.suggestion",
                },
            )
        except SupabaseAPIError as error:
            raise_http(error)
        if len(used) >= daily_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily AI suggestion limit reached",
            )

    if payload.mode == "expand_idea":
        if payload.idea_source_id:
            try:
                idea_text = await selected_idea_text(user, payload.idea_source_id)
            except SupabaseAPIError as error:
                raise_http(error)
            text = idea_text + (f"\nWriter's focus: {payload.current_writing}" if payload.current_writing else "")
            payload = payload.model_copy(update={"current_writing": text[:MAX_DRAFT_CHARS]})
        elif not (payload.current_writing or "").strip():
            raise HTTPException(422, "idea_required")

    profile = await _user_rows("ai_profiles", user, extra={"limit": "1"})
    answers = await _user_rows(
        "ai_onboarding_answers",
        user,
        extra={"order": "updated_at.desc", "limit": "20"},
    )
    memories = await _user_rows(
        "ai_memories",
        user,
        extra={
            "select": "id,source_id,memory_type,memory,importance",
            "order": "importance.desc,updated_at.desc",
            "limit": "200",
        },
    )
    sources = await _user_rows(
        "ai_documents", user,
        extra={
            "select": "id,document_title,source_kind,summary,description",
            "enabled": "eq.true", "processing_status": "eq.ready",
            "order": "updated_at.desc", "limit": "200",
        },
    )
    try:
        disabled = await knowledge.disabled_source_ids(user.id, user.access_token)
    except SupabaseAPIError as error:
        raise_http(error)
    memories = [m for m in memories if str(m.get("source_id")) not in disabled]
    previous = await _user_rows(
        "ai_suggestions",
        user,
        extra={"order": "created_at.desc", "limit": "15"},
    )

    query_parts = [
        payload.current_writing or "",
        payload.current_project or "",
    ]
    if not any(query_parts):
        # Seed retrieval with the user's stated goal so a first-time suggestion
        # still surfaces relevant private context.
        if profile:
            query_parts.append(profile[0].get("writing_goal") or "")
            query_parts.extend(profile[0].get("primary_topics") or [])
            query_parts.extend(profile[0].get("favorite_subjects") or [])
        # Include less recently surfaced interests beyond the same goal/nearest
        # source on every request. All summaries remain user-scoped.
        query_parts.extend(text[:350] for text, _ in library_overview(sources, memories, previous)[:3])
    query = "\n".join(part for part in query_parts if part).strip()[:MAX_DRAFT_CHARS]
    await knowledge.heal_missing_embeddings(user.id)
    retrieved = await retrieve_user_chunks(user.id, query) if query else []
    retrieved = await diverse_passages(user, retrieved, sources, mode=payload.mode, selected_id=payload.idea_source_id)
    logger.info(
        "suggestion_context user=%s retrieved=%d vector=%d memories=%d",
        user.id, len(retrieved), sum(c.match == "vector" for c in retrieved), len(memories),
    )

    context, source_ids = _compose_prompt_context(
        payload, profile, answers, memories, previous, retrieved, sources
    )
    catalog = evidence_catalog(payload, profile, answers, memories, sources, retrieved)
    allowed_ids = set(source_ids) | ({"current_writing"} if payload.current_writing else set())
    _, available_parents = attributed_sources(allowed_ids, allowed_ids, catalog)

    # Phase-13 cold-start seam: if the user's private knowledge base is empty
    # (no profile fields, no onboarding answers, no memories, no retrieval
    # results) skip the model call entirely and return a friendly basic
    # suggestion. This saves tokens and gives a better first-time experience
    # than a hallucinated "personalized" response.
    knowledge_empty = not allowed_ids and not (payload.current_writing or payload.current_project)

    provider = get_suggestion_provider()
    response: SuggestionProviderResponse
    used_fallback = False
    fallback_reason: str | None = None
    if knowledge_empty or (payload.mode == "connect_dots" and len(available_parents) < 2):
        response = await MockSuggestionProvider(provider.model).generate_suggestion(context, mode=payload.mode, language=payload.language)
        used_fallback = True
        fallback_reason = "insufficient_context" if payload.mode == "connect_dots" else "cold_start"
    else:
        try:
            response = await provider.generate_suggestion(context, mode=payload.mode, language=payload.language)
            if provider.name == "mock":
                used_fallback, fallback_reason = True, "unconfigured"
        except Exception as error:  # noqa: BLE001 - explicit fallback surface
            logger.warning(
                "suggestion_provider_failed provider=%s model=%s error=%s",
                provider.name,
                provider.model,
                error,
            )
            # Phase-13 basic fallback: never let the endpoint 5xx for the extension.
            response = await MockSuggestionProvider(provider.model).generate_suggestion(context, mode=payload.mode, language=payload.language)
            used_fallback = True
            fallback_reason = "provider_error"

    inspirations, cited_parents = attributed_sources(response.result.source_ids, allowed_ids, catalog)
    if payload.mode == "connect_dots" and not used_fallback and len(cited_parents) < 2:
        # A model response cannot turn one source into a claimed relationship.
        basic = await MockSuggestionProvider(provider.model).generate_suggestion(context, mode=payload.mode, language=payload.language)
        response.result = basic.result
        inspirations = []
    source_ids = [item.source_id for item in inspirations if item.source_id != "current_writing"]

    try:
        rows = await user_rest(
            "POST",
            "ai_suggestions",
            user.access_token,
            json={
                "user_id": user.id,
                "title": response.result.title,
                "suggestion": response.result.suggestion,
                "reason": response.result.why,
                "context_summary": encode_details(context, payload.mode, response.result.questions, inspirations),
                "related_topics": response.result.related_topics,
                "source_ids": source_ids,
                "status": "shown",
            },
            prefer="return=representation",
        )
    except SupabaseAPIError as error:
        raise_http(error)

    if used_fallback:
        request_type = f"suggestion_fallback_{fallback_reason}" if fallback_reason else "suggestion_fallback"
    else:
        request_type = "suggestion"
    await _record_usage(
        user.id,
        request_type=request_type,
        model=provider.model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        provider="mock" if used_fallback else provider.name,
    )
    return AISuggestion(**rows[0])


@router.get("/idea-options")
async def idea_options(user: AuthenticatedUser = Depends(require_ai_user)) -> list[dict]:
    """Private, usable choices for expansion; generation reloads their actual text."""
    sources = await _user_rows("ai_documents", user, extra={
        "select": "id,document_title,source_kind,summary", "enabled": "eq.true",
        "processing_status": "eq.ready", "order": "updated_at.desc", "limit": "100",
    })
    memories = await _user_rows("ai_memories", user, extra={
        "select": "id,memory,source_id", "order": "importance.desc,updated_at.desc", "limit": "100",
    })
    try:
        disabled = await knowledge.disabled_source_ids(user.id, user.access_token)
    except SupabaseAPIError as error:
        raise_http(error)
    source_ids = {str(s["id"]) for s in sources} | disabled
    return ([{"id": s["id"], "title": s["document_title"], "kind": s["source_kind"]} for s in sources] +
            [{"id": m["id"], "title": m["memory"][:100], "kind": "memory"}
             for m in memories if str(m.get("source_id")) not in source_ids])[:100]


@router.get("/ideas", response_model=list[AISuggestion])
async def saved_ideas(user: AuthenticatedUser = Depends(require_ai_user)) -> list[AISuggestion]:
    memories = await _user_rows("ai_memories", user, extra={
        "select": "source_id", "memory_type": "eq.unfinished_idea", "source_id": "not.is.null",
        "order": "updated_at.desc", "limit": "100",
    })
    ids = list(dict.fromkeys(str(m["source_id"]) for m in memories))
    if not ids:
        return []
    rows = await _user_rows("ai_suggestions", user, extra={"id": f"in.({','.join(ids)})", "limit": "100"})
    by_id = {str(row["id"]): row for row in rows}
    return [AISuggestion(**by_id[sid]) for sid in ids if sid in by_id]


async def _owned_suggestion(suggestion_id: str, user: AuthenticatedUser) -> AISuggestion:
    rows = await _user_rows("ai_suggestions", user, extra={"id": f"eq.{suggestion_id}", "limit": "1"})
    if not rows:
        raise HTTPException(404, "Suggestion not found")
    return AISuggestion(**rows[0])


@router.put("/suggestions/{suggestion_id}/save", response_model=AISuggestion)
async def save_idea(suggestion_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> AISuggestion:
    suggestion = await _owned_suggestion(suggestion_id, user)
    existing = await _user_rows("ai_memories", user, extra={"id": f"eq.{suggestion.id}", "limit": "1"})
    if existing:
        return suggestion
    body = {"id": suggestion.id, "user_id": user.id, "source_id": suggestion.id,
            "memory_type": "unfinished_idea", "importance": 4,
            "memory": ("Saved idea (not completed writing): " + suggestion.title + "\n" + suggestion.suggestion +
                       "\n" + "\n".join(suggestion.questions))[:5000]}
    embeddings = get_embeddings_service()
    if embeddings.enabled:
        embedded = await embeddings.embed(body["memory"])
        if embedded:
            body.update(embedding=embedded.embedding, embedding_model=embedded.model, embedding_version=embedded.version)
    try:
        await user_rest("POST", "ai_memories", user.access_token, params={"on_conflict": "id"}, json=body,
                        prefer="resolution=merge-duplicates,return=minimal")
        await create_feedback(AISuggestionFeedbackCreate(suggestion_id=suggestion.id, helpful=True, note="Saved idea"), user)
    except SupabaseAPIError as error:
        raise_http(error)
    return suggestion


@router.post("/suggestions/{suggestion_id}/use", response_model=AISuggestion)
async def use_idea(suggestion_id: str, user: AuthenticatedUser = Depends(require_ai_user)) -> AISuggestion:
    suggestion = await _owned_suggestion(suggestion_id, user)
    try:
        await create_feedback(AISuggestionFeedbackCreate(suggestion_id=suggestion.id, helpful=True, note="Started writing"), user)
        await user_rest("PATCH", "ai_suggestions", user.access_token,
                        params={"id": f"eq.{suggestion.id}", "user_id": f"eq.{user.id}"},
                        json={"status": "written"}, prefer="return=minimal")
    except SupabaseAPIError as error:
        raise_http(error)
    return suggestion.model_copy(update={"status": "written"})


@router.post("/feedback", response_model=AIFeedback, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    payload: AISuggestionFeedbackCreate,
    user: AuthenticatedUser = Depends(require_ai_user),
) -> AIFeedback:
    owned = await _user_rows(
        "ai_suggestions",
        user,
        extra={"id": f"eq.{payload.suggestion_id}", "limit": "1"},
    )
    if not owned:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suggestion not found")
    try:
        rows = await user_rest(
            "POST",
            "ai_feedback",
            user.access_token,
            json={"user_id": user.id, **payload.model_dump()},
            prefer="return=representation",
        )
        await user_rest(
            "PATCH",
            "ai_suggestions",
            user.access_token,
            params={
                "id": f"eq.{payload.suggestion_id}",
                "user_id": f"eq.{user.id}",
            },
            json={"status": "accepted" if payload.helpful else "rejected"},
            prefer="return=minimal",
        )
    except SupabaseAPIError as error:
        raise_http(error)
    return AIFeedback(**rows[0])


@router.get("/usage", response_model=list[AIUsageEvent])
async def list_usage(
    user: AuthenticatedUser = Depends(require_ai_user),
) -> list[AIUsageEvent]:
    rows = await _user_rows(
        "ai_usage",
        user,
        extra={"order": "created_at.desc", "limit": "200"},
    )
    return [AIUsageEvent(**row) for row in rows]


@router.get("/usage/summary", response_model=AIUsageSummary)
async def usage_summary(
    user: AuthenticatedUser = Depends(require_ai_user),
) -> AIUsageSummary:
    entitlement = await _entitlement(user.id)
    date_key = today_iso()
    try:
        rows = await service_rest(
            "GET",
            "ai_usage",
            params={
                "select": "request_type",
                "user_id": f"eq.{user.id}",
                "date": f"eq.{date_key}",
            },
        )
    except SupabaseAPIError as error:
        raise_http(error)
    rows = rows or []
    # Only real (non-fallback) suggestions count against the daily limit, matching
    # the enforcement in create_suggestion.
    used_today = sum(1 for row in rows if row.get("request_type") == "suggestion")
    daily_limit = _resolve_daily_limit(entitlement)
    remaining = max(0, daily_limit - used_today) if daily_limit else None
    return AIUsageSummary(
        date=date_key,
        plan=entitlement.get("plan") or "free",
        daily_limit=daily_limit,
        used_today=used_today,
        total_today=len(rows),
        remaining=remaining,
    )
