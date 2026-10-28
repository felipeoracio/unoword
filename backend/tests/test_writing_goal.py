from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from lib.writing_goal import task_budget, budget_context, with_outline
from models.writing_goal import WritingProgress
from models.ai import AISuggestion
from lib.suggestion_details import encode_details

NOW=datetime(2026,11,1,6,30,tzinfo=timezone.utc)


def progress(goal=1000,written=750,zone='America/Chicago',now=NOW):
    return WritingProgress(daily_goal=goal,words_written_today=written,timezone=zone,
                           date=now.astimezone(ZoneInfo(zone)).date(),captured_at=now)


@pytest.mark.parametrize('goal,written,target',[(100,0,100),(250,0,250),(500,0,500),(1000,0,1000),(2000,0,2000),(1000,750,250),(2000,1900,100),(1000,1000,0),(1000,1200,0),(10000,0,2000)])
def test_scope_uses_remaining_not_full_goal(goal,written,target):
    task=task_budget(progress(goal,written),now=NOW)
    assert task.remaining_words==max(0,goal-written)
    assert task.target_words==target and task.goal_reached==(written>=goal)


@pytest.mark.parametrize('goal',[None,0])
def test_no_configured_goal_has_a_reasonable_default(monkeypatch,goal):
    monkeypatch.setenv('WRITING_DEFAULT_DAILY_GOAL','250')
    task=task_budget(progress(goal,900),now=NOW)
    assert task.target_words==250 and task.remaining_words is None and not task.goal_reached


def test_old_clients_still_work_without_a_snapshot(monkeypatch):
    monkeypatch.setenv('WRITING_DEFAULT_DAILY_GOAL','250')
    assert task_budget(None,now=NOW).target_words==250


def test_completed_goal_is_optional_not_another_assignment():
    context=budget_context(task_budget(progress(100,100),now=NOW))
    assert 'optional' in context.lower() and 'No word target' in context


@pytest.mark.parametrize('words',[750,999,1000,1500,2000])
def test_manageable_milestones_add_up_exactly(words):
    task=with_outline(task_budget(progress(words,0),now=NOW),['Opening scene','The observation','The tension','A new direction','Closing reflection'])
    assert len(task.outline)==5 and sum(step.words for step in task.outline)==words
    assert task.outline[0].title=='Opening scene'
    if words==2000:assert [s.words for s in task.outline]==[200,500,500,500,300]


def test_small_target_has_no_enormous_outline():
    assert with_outline(task_budget(progress(1000,900),now=NOW),['a']*5).outline==[]


def test_malformed_model_outline_has_localized_safe_fallback():
    task=with_outline(task_budget(progress(1500,0),now=NOW),['Too short'],'es')
    assert task.outline[0].title=='Introducción'


@pytest.mark.parametrize('instant,zone',[
    ('2026-03-08T07:59:59+00:00','America/Chicago'),('2026-03-08T08:00:01+00:00','America/Chicago'),
    ('2026-11-01T06:59:59+00:00','America/Chicago'),('2026-11-01T07:00:01+00:00','America/Chicago'),
    ('2026-10-28T01:00:00+00:00','America/Los_Angeles'),('2026-10-28T01:00:00+00:00','Asia/Tokyo')])
def test_calendar_day_uses_writer_timezone_and_dst(instant,zone):
    now=datetime.fromisoformat(instant)
    task=task_budget(progress(zone=zone,now=now),now=now)
    assert task.date==now.astimezone(ZoneInfo(zone)).date().isoformat()


@pytest.mark.parametrize('offset',[-301,31])
def test_stale_or_future_snapshot_is_rejected_before_generation(offset):
    with pytest.raises(HTTPException) as error:
        task_budget(progress(now=NOW+timedelta(seconds=offset)),now=NOW)
    assert error.value.status_code==409


def test_midnight_rollover_rejects_yesterdays_progress():
    then=datetime(2026,10,28,4,59,59,tzinfo=timezone.utc)
    with pytest.raises(HTTPException):task_budget(progress(now=then),now=then+timedelta(seconds=2))


def test_bad_timezone_or_negative_counts_are_not_accepted():
    with pytest.raises(ValidationError):WritingProgress(**{**progress().model_dump(),'timezone':'Invalid/Zone'})
    with pytest.raises(ValidationError):progress(written=-1)


def test_task_snapshot_survives_save_and_reload_in_existing_details():
    task=with_outline(task_budget(progress(2000,0),now=NOW))
    encoded=encode_details('Private context','new_topic',[],[],task)
    item=AISuggestion(user_id='writer',title='A direction',suggestion='A brief description',reason='',context_summary=encoded)
    assert item.writing_task==task and len(item.writing_task.outline)==5
