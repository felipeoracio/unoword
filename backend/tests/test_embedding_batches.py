from types import SimpleNamespace
import pytest
from lib.embeddings import EmbeddingsService


@pytest.fixture
def service():
    service=EmbeddingsService(api_key=None,model="test-model",cache_size=2)
    calls=[]
    async def create(**kwargs):
        calls.append(kwargs["input"])
        return SimpleNamespace(data=[SimpleNamespace(index=i,embedding=[float(i+1)]*1536) for i in reversed(range(len(kwargs["input"])))])
    service._client=SimpleNamespace(embeddings=SimpleNamespace(create=create))
    return service,calls


async def test_one_batch_deduplicates_preserves_order_and_reuses_cache(service):
    client,calls=service
    result=await client.embed_many(["First passage","Second passage","First passage",""])
    assert calls==[["First passage","Second passage"]]
    assert result[0].embedding==result[2].embedding and result[1].embedding[0]==2
    assert result[3] is None
    await client.embed_many(["First passage"])
    assert len(calls)==1
    await client.embed_many(["Third passage","Fourth passage"])
    assert len(client._cache)==2


async def test_batch_size_is_bounded_before_provider_call(service):
    client,calls=service
    with pytest.raises(ValueError):await client.embed_many(["a"]*33)
    assert calls==[]


async def test_invalid_provider_vectors_are_not_stored(service):
    client,_=service
    async def invalid(**kwargs):return SimpleNamespace(data=[SimpleNamespace(index=0,embedding=[1.0])])
    client._client.embeddings.create=invalid
    assert await client.embed_many(["A passage"])==[None]
    assert not client._cache


async def test_disabled_provider_never_calls_network():
    client=EmbeddingsService(api_key=None,model="test-model")
    assert await client.embed_many(["A passage",""])==[None,None]
