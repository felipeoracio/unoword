"""Editor tools using the existing model configuration and canonical personalization."""

import json
from uuid import uuid4
from fastapi import HTTPException
from lib.ai_access import get_entitlement
from lib.ai_quota import AIRequest
from lib.ai_provider import get_suggestion_provider, MockSuggestionProvider
from lib.personalization import effective_profile, contextual_answers
from lib.supabase_client import user_rest
from lib.retrieval import retrieve_user_chunks
from lib import knowledge
from models.ai import AISuggestionRequest
from lib.writing_goal import task_budget, budget_context, with_outline
from lib.coach_policy import validate_coaching, validate_heading

ACTIONS = {
    "next": "Return exactly three DISTINCT personalized writing directions, each grounded in the author’s interests. Do not repeat earlier ideas.",
    "guidance": "Offer one concise coaching direction with three guiding questions or structural steps for what the author could explore next. Never supply a sentence, paragraph, sample or replacement for their writing.",
    "block": "Offer three specific, open-ended questions or creative prompts that help this writer move forward.",
    "brainstorm": "Offer three distinct angles, each with a compact outline. Develop the author’s ideas instead of replacing them.",
}


async def generate_assistance(payload, user):
    if payload.action not in ACTIONS and payload.action != "continue":
        raise HTTPException(422, "unsupported_coach_action")
    task_budget(getattr(payload, "writing_progress", None))
    provider = get_suggestion_provider()
    if isinstance(provider, MockSuggestionProvider):
        raise HTTPException(503, "ai_provider_unavailable")
    async with AIRequest(
        user.id,
        request_type="workspace_assistant",
        payload=payload,
        feature=(
            "guidance" if payload.action in {"guidance", "continue"} else "suggestion"
        ),
    ) as quota:
        if quota.replay is not None:
            return quota.replay
        return await _generate_assistance(payload, user, provider, quota)


async def _generate_assistance(payload, user, provider, quota):
    from routers.ai import _user_rows, _compose_prompt_context

    profile = await _user_rows("ai_profiles", user, extra={"limit": "1"})
    answers = await _user_rows(
        "ai_onboarding_answers", user, extra={"limit": "20", "order": "updated_at.desc"}
    )
    if profile:
        profile = [effective_profile(profile[0], answers)]
        answers = contextual_answers(profile[0], answers)
    disabled = await knowledge.disabled_source_ids(user.id, user.access_token)
    memories = await _user_rows(
        "ai_memories",
        user,
        extra={"limit": "100", "order": "importance.desc,updated_at.desc"},
    )
    memories = [m for m in memories if str(m.get("source_id")) not in disabled]
    previous = await _user_rows(
        "ai_suggestions", user, extra={"limit": "10", "order": "created_at.desc"}
    )
    feedback = await _user_rows(
        "ai_feedback",
        user,
        extra={
            "limit": "10",
            "order": "created_at.desc",
            "select": "helpful,reason,note",
        },
    )
    sources = await _user_rows(
        "ai_documents",
        user,
        extra={"enabled": "eq.true", "processing_status": "eq.ready", "limit": "100"},
    )
    query = (payload.selected_text or payload.current_text)[-2000:]
    retrieved = await retrieve_user_chunks(user.id, query) if query else []
    retrieved = [
        c
        for c in retrieved
        if str(c.parent_id) not in disabled and str(c.source_id) not in disabled
    ]
    authorized = await _user_rows(
        "writing_documents",
        user,
        extra={
            "ai_allowed": "eq.true",
            "status": "eq.active",
            "select": "id,title,plain_text",
            "order": "updated_at.desc",
            "limit": "8",
        },
    )
    available = {
        str(row["id"])
        for row in profile + answers + memories + sources + authorized
        if row.get("id")
    } | {str(c.source_id) for c in retrieved}
    # A previous suggestion can quote a deleted or disabled source. Only reuse
    # history whose complete evidence is still authorized on this request.
    previous = [
        s
        for s in previous
        if s.get("source_ids") and set(map(str, s["source_ids"])).issubset(available)
    ]
    context, source_ids = _compose_prompt_context(
        AISuggestionRequest(
            mode="new_topic", current_writing=query, language=payload.language
        ),
        profile,
        answers,
        memories,
        previous,
        retrieved,
        sources,
    )
    context += "\nRecent feedback (respect these preferences):\n" + "\n".join(
        f'Helpful: {f["helpful"]}; {f.get("reason") or ""}; {(f.get("note") or "")[:300]}'
        for f in feedback
    )
    context += (
        "\nPreviously written documents explicitly authorized for personalization:\n"
        + "\n".join(f'{d["title"]}: {d["plain_text"][:700]}' for d in authorized)
    )
    context += (
        "\nCurrent document (one-request consent):\n" + payload.current_text[-10000:]
    )
    if payload.selected_text:
        context += "\nSelected passage:\n" + payload.selected_text
    count = 3 if payload.action in {"next", "brainstorm", "block"} else 1
    task = task_budget(getattr(payload, "writing_progress", None))
    if task is not None:
        context += budget_context(task)
    # One provider request returns three directions and consumes one shared AI
    # request, matching the plan's request-based usage allowance.
    try:
        schema = {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "minItems": count,
                    "maxItems": count,
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "text": {"type": "string", "maxLength": 1100},
                            "outline": {
                                "type": "array",
                                "items": {"type": "string"},
                                "maxItems": 5,
                            },
                        },
                        "required": ["title", "text", "outline"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["items"],
            "additionalProperties": False,
        }
        result = await provider.generate_workspace(
            context,
            ACTIONS["guidance" if payload.action == "continue" else payload.action],
            payload.language,
            schema,
        )
        parsed = json.loads(result.choices[0].message.content or "{}")
        items = parsed.get("items", [])
        if len(items) != count:
            raise ValueError("invalid_assistant_response")
        for item in items:
            if not isinstance(item.get("title"), str) or item.get("replacement"):
                raise ValueError("invalid_assistant_response")
            validate_heading(item["title"])
            validate_coaching(item["text"])
            for heading in item.get("outline", []):
                validate_heading(heading)
        from lib.suggestion_details import encode_details

        # Reuse the existing suggestion/feedback records. Include the current
        # document as an evidence dependency: one-request consent must not turn
        # into permission to quote that document in future personalization.
        dependencies = list(
            dict.fromkeys(
                source_ids + [str(payload.document_id)] + [d["id"] for d in authorized]
            )
        )
        saved = []
        for item in items:
            item["id"] = str(uuid4())
            item_task = (
                with_outline(task, item.get("outline"), payload.language)
                if task is not None
                else None
            )
            if item_task is not None:
                item["writing_task"] = item_task.model_dump()
            saved.append(
                {
                    "id": item["id"],
                    "user_id": user.id,
                    "title": item["title"][:300],
                    "suggestion": item["text"][:12000],
                    "reason": "",
                    "context_summary": encode_details(
                        "",
                        "new_topic" if payload.action == "next" else "expand_idea",
                        [],
                        [],
                        writing_task=item_task,
                    ),
                    "related_topics": [],
                    "source_ids": dependencies,
                    "status": "shown",
                }
            )
        usage = result.usage
        response = {"items": items, "request_id": quota.id}
        await quota.complete(
            getattr(usage, "prompt_tokens", None),
            getattr(usage, "completion_tokens", None),
            model=provider.model,
            response=response,
            suggestions=saved,
        )
        return response
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(502, "ai_assistance_unavailable") from error
