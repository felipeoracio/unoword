import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from models.guided_writing import GuidedSession
from lib.guided_writing import session_budget, session_instruction, validated_direction

@pytest.mark.parametrize('goal',[1,100,250,500,750,1000,1500,10000])
def test_valid_session_goals(goal):
    assert session_budget(GuidedSession(goal=goal))==goal

@pytest.mark.parametrize('goal',[0,-1,1.5,True,'500',10001])
def test_invalid_session_goals(goal):
    with pytest.raises(ValidationError): GuidedSession(goal=goal)

def test_scopes_meaningfully_differ_and_do_not_change_daily_goals():
    small=session_instruction(GuidedSession(goal=100),True,False);large=session_instruction(GuidedSession(goal=1000),False,False)
    assert 'One concrete detail' in small and 'starting direction' in small
    assert 'tensions, perspectives and reflection' in large and 'recent authorized draft' in large
    assert small!=large

def test_remaining_budget_and_allocations_are_validated():
    s=GuidedSession(goal=500,written_words=350,intention='continue');assert session_budget(s)==150
    assert validated_direction({'outline':['Outcome','Meaning'],'word_allocations':[100,50]},s)['target_words']==150
    for invalid in [[100,40],[150,0],[100.0,50],[True,149],[-1,151]]:
        with pytest.raises(ValueError):validated_direction({'outline':['Outcome','Meaning'],'word_allocations':invalid},s)
    with pytest.raises(HTTPException):session_budget(GuidedSession(goal=100,written_words=100))

def test_regeneration_rejects_an_identical_direction():
    s=GuidedSession(goal=100,original_direction='Explore a meaningful detail.')
    with pytest.raises(ValueError):
        validated_direction({'text':'Explore a meaningful detail.','outline':['Detail','Meaning'],'word_allocations':[60,40]},s)
