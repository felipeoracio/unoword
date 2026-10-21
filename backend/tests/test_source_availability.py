"""Saved-idea provenance must not reintroduce disabled/deleted source text."""
from types import SimpleNamespace
import pytest
from lib import suggestion_knowledge as subject

@pytest.mark.asyncio
async def test_saved_ideas_respect_transitive_provenance_without_deleting_the_collection(monkeypatch):
    user=SimpleNamespace(id='owner',access_token='private-token')
    memories=[{'id':'personal','memory_type':'interest','memory':'Birds'},
              *[{'id':name,'source_id':name,'memory_type':'unfinished_idea','memory':name}
                for name in ['good','disabled','deleted','unknown','child-good','child-bad']]]
    origins=[{'id':name,'source_ids':sources} for name,sources in [
        ('good',['available']),('disabled',['disabled-document']),('deleted',['deleted-chunk']),
        ('child-good',['good']),('child-bad',['disabled'])]]
    async def rest(method,table,token,*,params):
        assert (method,table,token)==('GET','ai_suggestions','private-token')
        assert params['user_id']=='eq.owner'
        return origins
    monkeypatch.setattr(subject,'user_rest',rest)
    filtered,unavailable=await subject.available_saved_memories(user,memories,[],{'available','personal',*[m['id'] for m in memories]})
    assert {m['id'] for m in filtered}=={'personal','good','child-good'}
    assert unavailable=={'disabled','deleted','unknown','child-bad'}
    assert len(memories)==7,'The visible saved collection must not be mutated'

@pytest.mark.asyncio
async def test_recent_provenance_avoids_an_extra_read(monkeypatch):
    async def unexpected(*a,**kw):raise AssertionError('No database call needed')
    monkeypatch.setattr(subject,'user_rest',unexpected)
    memories=[{'id':'saved','source_id':'saved','memory_type':'unfinished_idea'}]
    result,excluded=await subject.available_saved_memories(SimpleNamespace(),memories,[{'id':'saved','source_ids':['present']}],{'present','saved'})
    assert result==memories and excluded==set()
