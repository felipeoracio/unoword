"""Editor tools using the existing model configuration and canonical personalization."""

import json
import logging
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

logger = logging.getLogger(__name__)

ACTIONS = {
    "next": "Return exactly three DISTINCT personalized writing directions, each grounded in the author’s interests. Do not repeat earlier ideas.",
    "guidance": "Offer one concise coaching direction with three guiding questions or structural steps for what the author could explore next. Never supply a sentence, paragraph, sample or replacement for their writing.",
    "block": "Offer three specific, open-ended questions or creative prompts that help this writer move forward.",
    "organization": "Offer structural questions about gaps, repeated ideas, section order and opportunities for reflection; do not supply prose.",
    "research": "Identify research questions and missing information in the authorized evidence. Do not claim inaccessible sources were read.",
    "feedback": "Offer constructive questions or concise feedback on clarity, organization, voice and audience alignment. Never rewrite the passage.",
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
            "guidance" if payload.action in {"guidance", "continue", "organization", "research", "feedback"} else "suggestion"
        ),
    ) as quota:
        if quota.replay is not None:
            return quota.replay
        return await _generate_assistance(payload, user, provider, quota)


async def _generate_assistance(payload, user, provider, quota):
    from routers.ai import _user_rows, _compose_prompt_context

    from lib.project_context import load_project_context, request_text
    from lib.projects import resolve_scope
    from lib.suggestion_details import evidence_catalog, attributed_sources
    scope = await resolve_scope(user, payload)
    current = request_text(scope, payload.document_id, payload.current_text)
    selected = request_text(scope, payload.document_id, payload.selected_text)
    query = (selected or current)[-2000:]
    data = await load_project_context(user, payload, query, scope)
    profile, answers, memories, previous, sources, retrieved, authorized, feedback = [data[key] for key in ('profile','answers','memories','previous','sources','retrieved','documents','feedback')]
    request = AISuggestionRequest(mode='new_topic', current_writing=query, language=payload.language)
    catalog = evidence_catalog(request, profile, answers, memories, sources, retrieved)
    if current:
        from models.ai import SuggestionInspiration
        catalog['current_writing'] = (SuggestionInspiration(source_id=str(payload.document_id), title='Tu documento actual' if payload.language=='es' else 'Your current document',kind='editor_document'),str(payload.document_id))
    available = set(catalog)
    previous = [s for s in previous if s.get('source_ids') and set(map(str,s['source_ids'])).issubset(available)]
    context, source_ids = _compose_prompt_context(request,profile,answers,memories,previous,retrieved,sources)
    context = data['project_context'] + '\n' + context
    context += '\nRecent authorized feedback:\n' + '\n'.join(f'Helpful: {f["helpful"]}; {f.get("reason") or ""}; {(f.get("note") or "")[:300]}' for f in feedback)
    if current: context += '\nCurrent document (one-request consent):\n' + current[-10000:]
    if selected: context += '\nSelected passage:\n' + selected
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
                            "title": {"type": "string", "maxLength": 100},
                            "text": {"type": "string", "maxLength": 1100},
                            "source_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
                            "outline": {
                                "type": "array",
                                "items": {"type": "string", "maxLength": 100},
                                "maxItems": 5,
                            },
                        },
                        "required": ["title", "text", "outline", "source_ids"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["items"],
            "additionalProperties": False,
        }
        instruction = (
            ACTIONS["guidance" if payload.action == "continue" else payload.action]
            + " For this editor request, use the supplied items schema instead of "
            "the single-suggestion field names. Each title and outline heading must "
            "be a short topic label of at most ten words and 100 characters. Each "
            "text must be coaching advice or questions, at most 70 words. Start "
            "with a direct question or coaching action such as Explore or Consider. "
            "Never include sample prose, quoted narration or replacement writing. Include source_ids only for labeled evidence actually used; use an empty list for general guidance."
        )
        # Structured JSON can still contain non-coaching prose or invalid topic
        # labels. Retry that boundary once before saving anything, within the
        # same reservation. Each actual provider call keeps its cost telemetry;
        # only a fully validated response consumes one subscriber credit.
        for attempt in range(2):
            result = await provider.generate_workspace(
                context, instruction, payload.language, schema
            )
            try:
                parsed = json.loads(result.choices[0].message.content or "{}")
                items = parsed.get("items", [])
                if not isinstance(items, list) or len(items) != count:
                    raise ValueError("invalid_assistant_response")
                for item in items:
                    if (
                        not isinstance(item, dict)
                        or not isinstance(item.get("title"), str)
                        or not isinstance(item.get("text"), str)
                        or not isinstance(item.get("outline", []), list)
                        or item.get("replacement")
                    ):
                        raise ValueError("invalid_assistant_response")
                    validate_heading(item["title"])
                    validate_coaching(item["text"])
                    for heading in item.get("outline", []):
                        validate_heading(heading)
            except (ValueError, TypeError, AttributeError) as error:
                reason = str(error)
                if reason not in {
                    "non_coaching_response", "non_coaching_heading",
                    "invalid_assistant_response",
                }:
                    reason = "invalid_assistant_response"
                logger.warning(
                    "workspace_coach_response_rejected request=%s attempt=%s reason=%s",
                    quota.id, attempt + 1, reason,
                )
                if attempt:
                    raise
                instruction += (
                    " The previous response did not satisfy the coaching-only "
                    "contract. Return fresh concise questions or structural advice, "
                    "with brief topic labels and no narrative examples."
                )
            else:
                break
        from lib.suggestion_details import encode_details

        # Reuse the existing suggestion/feedback records. Include the current
        # document as an evidence dependency: one-request consent must not turn
        # into permission to quote that document in future personalization.
        dependencies = list(
            dict.fromkeys(
                source_ids + ([str(payload.document_id)] if current else []) + [d["id"] for d in authorized]
            )
        )
        saved = []
        for item in items:
            citations, _ = attributed_sources(item.get('source_ids', []), set(source_ids) | ({'current_writing'} if current else set()), catalog)
            item['inspired_by'] = [citation.model_dump() for citation in citations]
            item.pop('source_ids', None)
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
                    "project_id": scope["project_id"],
                    "title": item["title"][:300],
                    "suggestion": item["text"][:12000],
                    "reason": "",
                    "context_summary": encode_details(
                        "",
                        "new_topic" if payload.action == "next" else "expand_idea",
                        [],
                        citations,
                        writing_task=item_task, project_id=scope["project_id"],
                    ),
                    "related_topics": [],
                    "source_ids": dependencies,
                    "status": "shown",
                }
            )
        usage = result.usage
        response = {"items": items, "request_id": quota.id, "context_scope": scope["scope"], "project_id": scope["project_id"], "resource_count": scope["resource_count"]}
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
