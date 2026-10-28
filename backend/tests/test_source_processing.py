"""Resumable worker boundary tests without storage, cloud or model charges."""
import copy
from types import SimpleNamespace
from uuid import uuid4
import pytest
from lib import source_processing as worker
from lib.embeddings import EmbeddingResult
from lib.link_ingest import LinkIngestError
from lib.supabase_client import SupabaseAPIError


@pytest.fixture
def system(monkeypatch):
    owner, source_id, job_id = [str(uuid4()) for _ in range(3)]
    state = SimpleNamespace(
        source=dict(id=source_id,user_id=owner,source_kind="file",filename="notes.txt",file_type="text/plain",
                    document_title="Garden notes",storage_path=f"{owner}/{source_id}/notes.txt",enabled=True),
        job=dict(id=job_id,source_id=source_id,user_id=owner,state="queued",phase="extracting",cursor=0,total=0,attempts=0,payload=None),
        staged={},published=[],old=[],old_memories=[],calls=[],vectors=[],downloads=0,fetches=0,fail_embeddings=False,plan="pro",reject_checkpoint=False,
        text="A fictional garden keeper records a frost and learns to wait before planting. " * 400,
    )
    async def rest(method,path,**kwargs):
        state.calls.append((method,path,copy.deepcopy(kwargs)))
        body=kwargs.get("json",{})
        if path=="rpc/ai_ingest_claim":
            assert body["p_user"] in {None,owner}
            if state.job["state"]!="queued":return None
            state.job.update(state="running",lease_token=body["p_token"])
            return copy.deepcopy(state.job)
        if path=="ai_documents":
            assert kwargs["params"]["user_id"]==f"eq.{owner}"
            return [copy.deepcopy(state.source)] if state.source else []
        if path=="ai_document_chunks":
            assert kwargs["params"]["user_id"]==f"eq.{owner}" and kwargs["params"]["document_id"]==f"eq.{source_id}"
            return copy.deepcopy(state.old)
        if path=="ai_memories":
            assert kwargs["params"]["user_id"]==f"eq.{owner}" and kwargs["params"]["source_id"]==f"eq.{source_id}"
            return copy.deepcopy(state.old_memories)
        if path=="ai_ingest_chunks":
            assert kwargs["params"]["job_id"]==f"eq.{job_id}"
            start=int(kwargs["params"]["chunk_index"][4:])
            return [{"payload":copy.deepcopy(state.staged[index])} for index in sorted(state.staged) if index>=start][:worker.BATCH_SIZE]
        if path=="rpc/ai_ingest_checkpoint":
            if state.reject_checkpoint:return False
            assert body["p_job"]==job_id and body["p_token"]==state.job["lease_token"]
            if body["p_reset"]:state.staged.clear()
            state.staged.update({row["chunk_index"]:copy.deepcopy(row) for row in body["p_rows"]})
            if body["p_payload"] is not None:state.job["payload"]=copy.deepcopy(body["p_payload"])
            state.job.update(phase=body["p_phase"],cursor=body["p_cursor"],total=body["p_total"],state="queued" if body["p_release"] else "running")
            return True
        if path=="rpc/ai_ingest_publish":
            assert body["p_memory"]["user_id"]==owner and body["p_memory"]["source_id"]==source_id
            state.published.append(dict(chunks=copy.deepcopy(state.staged),memory=body["p_memory"],payload=state.job["payload"]))
            state.job.update(state="done",payload=None)
            state.staged.clear()
            return True
        if path=="rpc/ai_ingest_fail":
            assert body["p_job"]==job_id
            state.job.update(state="failed" if body["p_permanent"] else "queued",attempts=state.job["attempts"]+1,last_error=body["p_error"])
            return True
        raise AssertionError((method,path,kwargs))
    async def entitlement(_):return dict(plan=state.plan,status="active")
    async def download(user_id,path,max_bytes):
        assert user_id==owner and path.startswith(owner+"/") and max_bytes==5*1024*1024
        state.downloads+=1
        return state.text.encode()
    async def fetch(url):
        state.fetches+=1
        assert url=="https://example.com/story"
        return dict(text=state.text,title="Garden weather",word_count=len(state.text.split()),content_hash="hash",canonical_url=url)
    class Embeddings:
        enabled=True
        model="test-model"
        version="v1"
        async def embed_many(self,texts):
            state.vectors.append(texts)
            if not self.enabled:return [None]*len(texts)
            if state.fail_embeddings:return [None]*len(texts)
            return [EmbeddingResult([1.0]*1536,self.model,self.version) for _ in texts]
    embeddings=Embeddings()
    async def summary(title,text):
        assert len(text)<=worker.knowledge.SUMMARY_INPUT_CHARS
        return "A fictional gardener observes frost before planting."
    monkeypatch.setattr(worker,"service_rest",rest)
    monkeypatch.setattr(worker,"get_entitlement",entitlement)
    monkeypatch.setattr(worker,"source_storage_download",download)
    monkeypatch.setattr(worker,"fetch_and_extract",fetch)
    monkeypatch.setattr(worker,"get_embeddings_service",lambda:embeddings)
    monkeypatch.setattr(worker.knowledge,"summarize",summary)
    state.embeddings=embeddings
    return state


async def test_file_resumes_batched_index_and_publishes_once(system):
    assert await worker.process_one(system.job["user_id"])
    assert system.job["phase"]=="indexing" and system.downloads==1 and not system.published
    total=system.job["total"]
    assert total>16
    assert await worker.process_one(system.job["user_id"])
    assert system.job["cursor"]==16 and not system.published
    # Invoke again as a new worker would: all state comes back from the DB.
    await worker.drain(system.job["user_id"],max_steps=20)
    assert system.job["state"]=="done" and len(system.published)==1 and system.downloads==1
    assert len(system.published[0]["chunks"])==total
    assert all(len(batch)<=16 for batch in system.vectors)
    assert system.job["attempts"]==0
    assert not await worker.process_one(system.job["user_id"])
    assert not any(path=="ai_usage" for _,path,_ in system.calls)


async def test_link_uses_existing_safe_fetch_and_does_not_download_storage(system):
    system.text="A short fictional source about careful observation."
    system.source.update(source_kind="link",source_url="https://example.com/story",document_title="https://example.com/story")
    await worker.drain(system.job["user_id"])
    assert system.fetches==1 and system.downloads==0
    assert "Garden weather" in system.published[0]["memory"]["memory"]


async def test_embedding_outage_keeps_checkpoint_and_retries_only_unfinished_batch(system):
    await worker.process_one(system.job["user_id"])
    await worker.process_one(system.job["user_id"])
    completed=system.job["cursor"]
    system.fail_embeddings=True
    await worker.process_one(system.job["user_id"])
    assert system.job["attempts"]==1 and system.job["cursor"]==completed
    assert not system.published
    system.fail_embeddings=False
    await worker.drain(system.job["user_id"],max_steps=20)
    assert system.published and system.downloads==1


async def test_complete_unchanged_passage_reuses_its_persisted_vector(system):
    system.text="An unchanged fictional garden note."
    system.old=[dict(chunk_index=0,content=system.text,embedding=[1.0]*1536,embedding_model="test-model",embedding_version="v1")]
    await worker.drain(system.job["user_id"])
    assert system.vectors[0]==[],"No provider request is needed for an unchanged passage"
    assert len(system.vectors[-1])==1,"The separately stored memory is embedded"


async def test_unchanged_refresh_preserves_summary_memory_id_and_vectors(system,monkeypatch):
    import hashlib
    system.text="An unchanged fictional garden note."
    system.source.update(content_hash=hashlib.sha256(system.text.encode()).hexdigest(),summary="An existing private summary.")
    system.old=[dict(chunk_index=0,content=system.text,embedding=[1.0]*1536,embedding_model="test-model",embedding_version="v1")]
    memory_id=str(uuid4())
    system.old_memories=[dict(id=memory_id,memory='From your document "Garden notes": An existing private summary.',embedding=[1.0]*1536,embedding_model='test-model',embedding_version='v1')]
    async def no_summary(*args):pytest.fail('Unchanged content must reuse its existing summary')
    monkeypatch.setattr(worker.knowledge,'summarize',no_summary)
    await worker.drain(system.job['user_id'])
    assert system.published[0]['memory']['id']==memory_id,'Existing suggestion citations remain valid'
    assert all(not batch for batch in system.vectors),'No model calls are needed for unchanged content'


@pytest.mark.parametrize("change",["disabled","deleted","free"])
async def test_revoked_access_or_deleted_source_never_reaches_provider(system,change):
    if change=="disabled":system.source["enabled"]=False
    if change=="deleted":system.source=None
    if change=="free":system.plan="free"
    await worker.process_one(system.job["user_id"])
    assert not system.vectors and system.downloads==0 and not system.published


async def test_lost_lease_stops_without_overwriting_a_newer_job(system):
    system.reject_checkpoint=True
    await worker.process_one(system.job["user_id"])
    assert not system.staged and not system.published
    assert not any(path=="rpc/ai_ingest_fail" for _,path,_ in system.calls)


@pytest.mark.parametrize("reason,permanent",[("blocked",True),("not_found",True),("unreachable",False),("timeout",False)])
async def test_permanent_and_transient_website_failures(system,monkeypatch,reason,permanent):
    system.source.update(source_kind="link",source_url="https://example.com/story")
    async def fetch(_):raise LinkIngestError(reason,"A safe user-facing error")
    monkeypatch.setattr(worker,"fetch_and_extract",fetch)
    await worker.process_one(system.job["user_id"])
    assert system.job["state"]==("failed" if permanent else "queued")
    assert system.job["last_error"]=="A safe user-facing error"


async def test_bad_private_storage_path_is_terminal_without_leaking_details(system,monkeypatch):
    async def download(*_):raise SupabaseAPIError(403,"PRIVATE INTERNAL DETAIL")
    monkeypatch.setattr(worker,"source_storage_download",download)
    await worker.process_one(system.job["user_id"])
    assert system.job["state"]=="failed" and "PRIVATE" not in system.job["last_error"]


async def test_unconfigured_embeddings_preserve_keyword_content(system):
    system.text="An offline-configured fictional reference."
    system.embeddings.enabled=False
    await worker.drain(system.job["user_id"])
    assert system.published and "keyword" in system.published[0]["payload"]["index_note"]


async def test_invocation_deadline_preserves_the_leased_job_for_crash_recovery(system,monkeypatch):
    import asyncio
    original=asyncio.timeout
    monkeypatch.setattr(worker.asyncio,'timeout',lambda _:original(0.01))
    async def interrupted(*args):await asyncio.Event().wait()
    monkeypatch.setattr(worker,'source_storage_download',interrupted)
    assert await worker.drain(system.job['user_id'])==0
    assert system.job['state']=='running' and not system.published
