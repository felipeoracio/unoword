"""Calculate task scope before AI, using the dashboard's current progress snapshot."""
import json
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from models.writing_goal import WritingProgress, WritingTask, WritingMilestone


def task_budget(progress: WritingProgress | None, *, now=None) -> WritingTask:
    now = now or datetime.now(timezone.utc)
    goal, written, zone = None, 0, "UTC"
    if progress is not None:
        zone = progress.timezone
        age = (now - progress.captured_at).total_seconds()
        if (not -30 <= age <= 300 or progress.date != now.astimezone(ZoneInfo(zone)).date()
                or progress.captured_at.astimezone(ZoneInfo(zone)).date() != progress.date):
            raise HTTPException(409, "writing_progress_stale")
        goal, written = progress.daily_goal or None, progress.words_written_today
    remaining = max(0, goal - written) if goal else None
    try:
        default = max(1, int(os.getenv("WRITING_DEFAULT_DAILY_GOAL", "250")))
        maximum = max(1, int(os.getenv("AI_MAX_TASK_WORDS", "2000")))
    except ValueError:
        raise HTTPException(503, "writing_goal_not_configured") from None
    return WritingTask(daily_goal=goal, words_written_today=written, remaining_words=remaining,
                       target_words=min(remaining if remaining is not None else default, maximum),
                       goal_reached=remaining == 0, timezone=zone,
                       date=now.astimezone(ZoneInfo(zone)).date().isoformat())


def budget_context(task: WritingTask) -> str:
    if task.goal_reached:
        scope = "Daily goal achieved. Offer only optional, low-pressure inspiration. Explicitly say continuing is optional. No word target or required outline."
    elif task.target_words <= 100:
        scope = "One brief reflection, moment or paragraph; one concrete focus."
    elif task.target_words <= 250:
        scope = "Explore one idea in two or three short paragraphs."
    elif task.target_words <= 500:
        scope = "A short article or personal story with a clear beginning and ending."
    elif task.target_words < 750:
        scope = "A short article or personal story exploring one main idea with concrete examples."
    else:
        scope = "A detailed article, chapter segment or several sections. Offer five manageable, topic-specific outline headings."
    return ("\nWriting-task budget (planning data; not a request to generate the whole piece):\n"
            + json.dumps(task.model_dump(exclude={"outline"}), ensure_ascii=False)
            + "\nTask scope: " + scope
            + "\nSize the author's task to target_words, not the full daily_goal. Keep your suggestion concise, preserve personalization and author voice. "
              "When remaining_words exceeds target_words, propose this as a manageable first part. "
              "Do not inflate the response itself to the word target. No deadlines or pressure.")


def with_outline(task: WritingTask, titles=None, language="en") -> WritingTask:
    if task.target_words < 750:
        return task.model_copy(update={"outline": []})
    defaults = (["Introducción", "Primera sección", "Segunda sección", "Tercera sección", "Conclusión"]
                if language == "es" else ["Introduction", "First section", "Second section", "Third section", "Conclusion"])
    if not isinstance(titles, list) or len(titles) != 5 or any(not isinstance(t, str) or not t.strip() for t in titles):
        titles = defaults
    sizes = [task.target_words * n // 100 for n in (10, 25, 25, 25)]
    sizes.append(task.target_words - sum(sizes))
    return task.model_copy(update={"outline": [WritingMilestone(title=title.strip()[:100], words=words)
                                             for title, words in zip(titles, sizes)]})
