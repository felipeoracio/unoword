"""Index truth, refresh repair, private previews and safe bounded extraction."""
import gzip
from types import SimpleNamespace
from uuid import uuid4
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from lib import link_ingest
from lib.auth import AuthenticatedUser
from routers import links

USER,LINK=str(uuid4()),str(uuid4())
TEXT='The fictional orchard keeper records frost at dawn before deciding when to open the irrigation gates.'

@pytest.fixture
def library(monkeypatch):
    state={'ai_documents':[dict(id=LINK,user_id=USER,source_kind='link',filename='example.com',file_type='text/html',document_title='Frost notebook',source_url='https://example.com/article',enabled=True,processing_status='ready',word_count=18,content_hash='unchanged',last_processed_at='2026-10-20T12:00:00Z')], 'ai_document_chunks':[],'ai_memories':[],'indexed':0}
    async def rest(method,table,token,params=None,json=None,prefer=None):
        assert token=='user-token'
        assert (params or {}).get('user_id',f'eq.{USER}')==f'eq.{USER}'
        rows=list(state[table])
        for key,value in (params or {}).items():
            if key in ['select','order','limit','offset']:continue
            if value.startswith('eq.'):rows=[r for r in rows if str(r.get(key)).lower()==value[3:].lower()]
            elif value.startswith('in.('):rows=[r for r in rows if str(r.get(key)) in value[4:-1].split(',')]
            elif value=='not.is.null':rows=[r for r in rows if r.get(key) is not None]
        if method=='GET':
            offset=int((params or {}).get('offset',0));return rows[offset:offset+int((params or {}).get('limit',1000))]
        if method=='POST':
            state[table].append(json)
            return [json]
        if method=='PATCH':
            for row in rows:row.update(json)
            return rows
        raise AssertionError(method)
    async def fetch(url):return dict(text=TEXT,title='Fetched title',word_count=18,content_hash='unchanged',canonical_url=url)
    async def index(user_id,token,source_id,text,metadata):
        assert text==TEXT
        state['indexed']+=1
        state['ai_document_chunks']=[dict(id=str(uuid4()),document_id=source_id,user_id=USER,content=text,embedding=[0.1])]
        return 1,1
    async def memory(*args,**kwargs):
        assert kwargs['text']==TEXT
        state['ai_memories']=[dict(id=str(uuid4()),user_id=USER,source_id=LINK)]
    state['queued']=[]
    async def enqueue(user_id,source_id,**kwargs):
        assert user_id==USER
        state['queued'].append((source_id,kwargs))
        for row in state['ai_documents']:
            if row['id']==source_id:row.update(processing_status='pending',processing_phase='queued')
        return str(uuid4())
    async def drain(*args,**kwargs):return 0
    monkeypatch.setattr(links.source_processing,'enqueue',enqueue)
    monkeypatch.setattr(links.source_processing,'drain',drain)
    monkeypatch.setattr(links,'user_rest',rest)
    monkeypatch.setattr(links,'fetch_and_extract',fetch)
    monkeypatch.setattr(links.knowledge,'index_source',index)
    monkeypatch.setattr(links.knowledge,'rebuild_source_memory',memory)
    app=FastAPI();app.include_router(links.router,prefix='/api')
    app.dependency_overrides[links.require_ai_user]=lambda:AuthenticatedUser(id=USER,plan='pro',access_token='user-token')
    with TestClient(app, headers={'Origin':'https://unoword.vercel.app'}) as client:yield SimpleNamespace(client=client,state=state)

@pytest.mark.parametrize('total,embedded,status',[(0,0,'not_indexed'),(2,0,'not_indexed'),(2,1,'partial'),(2,2,'indexed')])
def test_index_evidence(library,total,embedded,status):
    library.state['ai_document_chunks']=[dict(id=str(i),document_id=LINK,user_id=USER,embedding=[0.1] if i<embedded else None) for i in range(total)]
    response=library.client.get('/api/links');assert response.status_code==200,response.text
    row=response.json()[0]
    assert (row['chunk_count'],row['embedded_chunk_count'],row['indexing_status'])==(total,embedded,status)

@pytest.mark.parametrize('existing',[[],[dict(id='partial',document_id=LINK,user_id=USER,embedding=None)]])
def test_refresh_queues_repair_without_changing_published_passages(library,existing):
    library.state['ai_document_chunks']=existing
    response=library.client.post(f'/api/links/{LINK}/refresh');assert response.status_code==200,response.text
    row=response.json()
    assert row['processing_status']=='pending' and library.state['indexed']==0
    assert library.state['ai_document_chunks']==existing and library.state['queued']
    assert row['id']==LINK and row['document_title']=='Frost notebook'
    assert len(library.state['ai_documents'])==1

def test_refresh_preserves_complete_index_until_worker_publication(library):
    library.state['ai_document_chunks']=[dict(id='good',document_id=LINK,user_id=USER,embedding=[0.1])]
    response=library.client.post(f'/api/links/{LINK}/refresh')
    assert response.status_code==200 and response.json()['indexing_status']=='indexed'
    assert library.state['indexed']==0 and library.state['queued']

def test_queued_refresh_keeps_previous_successful_read_time(library,monkeypatch):
    async def fail(url):raise link_ingest.LinkIngestError('blocked_by_site','This site requires sign-in.')
    monkeypatch.setattr(links,'fetch_and_extract',fail)
    row=library.client.post(f'/api/links/{LINK}/refresh').json()
    assert row['processing_status']=='pending' and row['processing_error'] is None
    assert row['last_processed_at'].startswith('2026-10-20T12:00:00')
    assert row['last_successful_processed_at'] is None

def test_queued_source_with_no_chunks_is_never_reported_ready(library,monkeypatch):
    async def empty(*args):return 0,0
    monkeypatch.setattr(links.knowledge,'index_source',empty)
    row=library.client.post(f'/api/links/{LINK}/refresh').json()
    assert row['processing_status']=='pending' and row['indexing_status']=='not_indexed'

def test_preview_joins_stored_text_and_keeps_ownership(library):
    library.state['ai_document_chunks']=[dict(document_id=LINK,user_id=USER,content='A story about careful observation.'),dict(document_id=LINK,user_id=USER,content='careful observation. A second idea.')]
    response=library.client.get(f'/api/links/{LINK}/content');assert response.status_code==200,response.text
    assert response.json()['content']=='A story about careful observation. A second idea.'
    assert not response.json()['truncated']
    assert library.client.get(f'/api/links/{uuid4()}/content').status_code==404

def test_empty_preview_explains_how_to_retry(library):
    response=library.client.get(f'/api/links/{LINK}/content')
    assert response.status_code==409 and 'Refresh' in response.json()['detail']

def test_preview_is_bounded(library):
    library.state['ai_document_chunks']=[dict(document_id=LINK,user_id=USER,content=f'{i} '+('text '*1000)) for i in range(20)]
    row=library.client.get(f'/api/links/{LINK}/content').json()
    assert row['truncated'] and len(row['content'])==40000

def test_preview_requires_authentication():
    app=FastAPI();app.include_router(links.router,prefix='/api')
    with TestClient(app, headers={'Origin':'https://unoword.vercel.app'}) as client:assert client.get(f'/api/links/{LINK}/content').status_code==401

def test_article_extraction_omits_scripts_and_navigation():
    html=f'<html><head><title>Frost records</title></head><body><nav>Menu advertising boilerplate</nav><main><article><h1>Frost records</h1><p>{" ".join([TEXT]*8)}</p></article></main><script>SECRET_SCRIPT_INSTRUCTION</script><footer>Subscribe cookie menu</footer></body></html>'
    result=link_ingest._extract(html,'https://example.com/story')
    assert 'orchard keeper' in result['text']
    assert 'SECRET_SCRIPT_INSTRUCTION' not in result['text'] and 'advertising boilerplate' not in result['text']

@pytest.mark.parametrize('url',['file:///etc/passwd','ftp://example.com/a','https://name:password@example.com'])
def test_unsafe_url_formats(url):
    with pytest.raises(link_ingest.LinkIngestError):link_ingest.validate_url(url)

@pytest.mark.asyncio
async def test_redirect_to_private_address_is_blocked(monkeypatch):
    original=httpx.AsyncClient;calls=[]
    def respond(request):calls.append(str(request.url));return httpx.Response(302,headers={'location':'http://127.0.0.1/secret'})
    monkeypatch.setattr(link_ingest.socket,'getaddrinfo',lambda *args:[(2,1,6,'',('93.184.216.34',443))])
    monkeypatch.setattr(link_ingest.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(respond),**kwargs))
    with pytest.raises(link_ingest.LinkIngestError,match='private/internal'):await link_ingest._fetch('https://example.com/start')
    assert len(calls)==1

@pytest.mark.asyncio
async def test_stream_size_guard_and_single_gzip_decoding(monkeypatch):
    original=httpx.AsyncClient
    monkeypatch.setattr(link_ingest.socket,'getaddrinfo',lambda *args:[(2,1,6,'',('93.184.216.34',443))])
    def respond(request):return httpx.Response(200,content=gzip.compress(b'hello readable page'),headers={'content-type':'text/html','content-encoding':'gzip'})
    monkeypatch.setattr(link_ingest.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(respond),**kwargs))
    response,_=await link_ingest._fetch('https://example.com')
    assert response.text=='hello readable page'
    monkeypatch.setattr(link_ingest,'MAX_BYTES',5)
    with pytest.raises(link_ingest.LinkIngestError,match='too large'):await link_ingest._fetch('https://example.com')


def test_repeated_reads_and_other_users_do_not_lose_the_same_article():
    # A process-global dedup cache can silently suppress a later refresh (or
    # another user's read). Each extraction must be independent and repeatable.
    paragraph = ('A civic archivist measures rainfall in a copper basin each morning. '
                 'The public record helps neighbors decide when their shared garden needs water. ')
    html = f'<html><head><title>Independent rainfall records</title></head><body><article><h1>Rainfall records</h1><p>{paragraph * 5}</p></article></body></html>'
    results = [link_ingest._extract(html, f'https://example.com/rainfall?reader={i % 2}') for i in range(6)]
    assert all('copper basin' in result['text'] for result in results)
    assert len({result['content_hash'] for result in results}) == 1


@pytest.mark.parametrize('failure', [OSError('resolver unavailable'), RuntimeError('runtime DNS wrapper'), None, []])
def test_resolver_failures_are_closed_and_actionable(monkeypatch, failure):
    def resolve(*args):
        if isinstance(failure, Exception):
            raise failure
        return failure
    monkeypatch.setattr(link_ingest.socket, 'getaddrinfo', resolve)
    with pytest.raises(link_ingest.LinkIngestError, match="Could not resolve") as error:
        link_ingest._check_host_not_internal('unreachable.example')
    assert error.value.reason == 'unreachable'


def test_unreachable_link_is_saved_for_durable_worker_retry(library, monkeypatch):
    def fail_host(host):
        raise link_ingest.LinkIngestError('unreachable', "Could not resolve that website's address.")
    async def fail_fetch(url):
        fail_host('unreachable.example')
    monkeypatch.setattr(links, '_check_host_not_internal', fail_host)
    monkeypatch.setattr(links, 'fetch_and_extract', fail_fetch)
    response = library.client.post('/api/links', json={'url': 'https://unreachable.example/story'})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body['processing_status'] == 'pending' and body['indexing_status'] == 'not_indexed'
    assert library.state['queued']
    retry = library.client.post(f"/api/links/{body['id']}/refresh")
    assert retry.status_code == 200 and retry.json()['processing_status'] == 'pending'
