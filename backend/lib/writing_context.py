"""Select a varied overview of the writer's library, independently of similarity."""

from collections import defaultdict


def library_overview(
    sources: list[dict], memories: list[dict], previous: list[dict],
) -> list[tuple[str, list[str]]]:
    """Interleave source types and prefer material less present in recent context.

    Source summaries cover the library beyond the nearest vector matches.
    Memories derived from a document are folded into that source, so a file's
    summary and its memory cannot crowd out personal memories or saved writing.
    """
    exposure: dict[str, int] = defaultdict(int)
    for index, suggestion in enumerate(previous[:15]):
        for source_id in suggestion.get("source_ids") or []:
            exposure[str(source_id)] += 15 - index

    by_source = {str(m["source_id"]): m for m in memories if m.get("source_id")}
    groups: dict[str, list] = defaultdict(list)
    document_ids = {str(s["id"]) for s in sources}
    for source in sources:
        if source.get("enabled") is False or source.get("processing_status", "ready") != "ready":
            continue
        source_id = str(source["id"])
        memory = by_source.get(source_id)
        summary = source.get("summary") or (memory or {}).get("memory") or source.get("description") or ""
        if not summary.strip():
            # Names and URLs alone cannot substantiate a writing suggestion.
            continue
        kind = "link" if source.get("source_kind") == "link" else "file"
        ids = [source_id] + ([str(memory["id"])] if memory else [])
        text = f'{kind} "{source.get("document_title") or "Untitled"}": {summary}'
        groups[kind].append((sum(exposure[sid] for sid in ids), text, ids))
    for memory in memories:
        if str(memory.get("source_id")) in document_ids:
            continue
        ids = [str(memory["id"])]
        kind = "saved writing" if memory.get("source_id") else "memory"
        text = f'{kind} ({memory.get("memory_type") or "note"}): {memory.get("memory") or ""}'
        groups[kind].append((exposure[ids[0]], text, ids))
    for group in groups.values():
        group.sort(key=lambda item: item[0])

    result = []
    for index in range(max((len(group) for group in groups.values()), default=0)):
        for kind in ("memory", "saved writing", "file", "link"):
            if index < len(groups[kind]):
                _, text, ids = groups[kind][index]
                result.append((text, ids))
    return result
