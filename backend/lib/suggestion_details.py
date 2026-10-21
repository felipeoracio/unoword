"""Persist rich suggestion details in the existing context column, compatibly."""

import json

from models.ai import AISuggestionRequest, SuggestionInspiration


def encode_details(context: str, mode: str, questions: list[str], inspired_by: list[SuggestionInspiration]) -> str:
    return json.dumps({
        "unoword_suggestion_version": 1, "context": context[:2000], "mode": mode,
        "questions": questions, "inspired_by": [source.model_dump() for source in inspired_by],
    }, ensure_ascii=False)


def evidence_catalog(payload: AISuggestionRequest, profile, answers, memories, sources, retrieved):
    """Map evidence IDs to server-owned labels and canonical source identities."""
    es = payload.language == "es"
    catalog = {}

    def add(source_id, title, kind, canonical=None):
        catalog[str(source_id)] = (SuggestionInspiration(source_id=str(source_id), title=title, kind=kind), str(canonical or source_id))

    if payload.current_writing:
        add("current_writing", "Tu idea o escritura actual" if es else "Your current idea or writing", "current_writing")
    for item in profile:
        add(item["id"], "Tu perfil de escritura" if es else "Your writing profile", "profile")
    for item in answers:
        add(item["id"], item.get("question") or ("Tus respuestas" if es else "Your answers"), "onboarding")
    source_map = {str(s["id"]): s for s in sources}
    for item in sources:
        add(item["id"], item.get("document_title") or ("Fuente compartida" if es else "Shared source"), item.get("source_kind") or "file")
    for item in memories:
        parent = str(item.get("source_id") or item["id"])
        source = source_map.get(parent)
        title = source.get("document_title") if source else (item.get("memory") or "")[:90]
        add(item["id"], title or ("Memoria de escritura" if es else "Writing memory"), "memory", parent)
    for chunk in retrieved:
        parent = str(chunk.parent_id or chunk.source_id)
        if chunk.source_id in catalog:
            continue
        title = chunk.source_title or ("Escritura guardada" if es else "Saved writing")
        add(chunk.source_id, title, chunk.source_type, parent)
    return catalog


def attributed_sources(claimed_ids, allowed_ids, catalog):
    """Reject fabricated/unseen IDs and collapse a document and its own memory."""
    result, canonical_ids = [], set()
    for source_id in claimed_ids:
        if source_id not in allowed_ids or source_id not in catalog:
            continue
        source, canonical = catalog[source_id]
        if canonical not in canonical_ids:
            result.append(source)
            canonical_ids.add(canonical)
    return result, canonical_ids
