"""Resolve permissions before fetching personal text, shared by both AI surfaces."""
from fastapi import HTTPException
from lib.projects import resolve_scope, scoped_rows, project_rpc, project_context
from lib.personalization import effective_profile, contextual_answers, prompt_themes
from lib.retrieval import RetrievedChunk, retrieve_user_chunks
from lib.supabase_client import user_rest

async def load_project_context(user, payload, text='', scope=None):
    scope = await resolve_scope(user, payload) if scope is None else scope
    profile, answers = [], []
    if scope['profile_enabled']:
        common = {'user_id': f'eq.{user.id}'}
        profile = await user_rest('GET','ai_profiles',user.access_token,params={**common,'limit':'1'})
        answers = await user_rest('GET','ai_onboarding_answers',user.access_token,params={**common,'order':'updated_at.desc','limit':'100'})
        if profile: profile = [effective_profile(profile[0],answers)]
        answers = contextual_answers(profile[0] if profile else {}, answers)
    memories = await scoped_rows('ai_memories',user,scope,'memory_ids',order='importance.desc,updated_at.desc',limit='200')
    sources = await scoped_rows('ai_documents',user,scope,'source_ids',select='id,document_title,source_kind,summary,description',enabled='eq.true',processing_status='eq.ready',order='updated_at.desc',limit='200')
    previous = await scoped_rows('ai_suggestions',user,scope,'suggestion_ids',order='created_at.desc',limit='15')
    feedback = await scoped_rows('ai_feedback',user,scope,'feedback_ids',select='id,helpful,reason,note',order='created_at.desc',limit='10')
    project = scope.get('project') or {}
    query = text[-2000:] or '\n'.join([project.get('name',''),project.get('description','')])
    if not query.strip() and profile:
        p=profile[0];query='\n'.join([p.get('writing_goal') or '',*(p.get('primary_topics') or []),*(p.get('favorite_subjects') or []),*prompt_themes(p)])
    if not text.strip():
        query += '\n' + '\n'.join((row.get('memory') or '')[:200] for row in memories[:5])
        query += '\n' + '\n'.join((row.get('summary') or '')[:200] for row in sources[:3])
    query=query.strip()[:2000]
    retrieved=await retrieve_user_chunks(user.id,query,scope=scope) if query and any(scope.get(key) for key in ('source_ids','memory_ids','session_ids')) else []
    # Defense in depth against stale retrieval results. The SQL matcher already
    # restricts IDs before selecting content; this is never its replacement.
    def authorized(chunk):
        key = {'document_chunk':'source_ids','writing_chunk':'session_ids','memory':'memory_ids','editor_document':'document_ids'}.get(chunk.source_type)
        identity = chunk.source_id if chunk.source_type=='memory' else (chunk.parent_id or chunk.source_id)
        return bool(key and str(identity) in scope.get(key, []))
    retrieved = [chunk for chunk in retrieved if authorized(chunk)]
    documents=[]
    if scope.get('document_ids'):
        documents=await project_rpc('workspace_document_passages',user,{'p_ids':scope['document_ids'],'p_query':query})
        retrieved += [RetrievedChunk('editor_document',d['id'],d['id'],d['plain_text'],0.0,source_title=d['title'],match='scoped_document') for d in documents]
    return dict(scope=scope,profile=profile,answers=answers,memories=memories,sources=sources,
                previous=previous,feedback=feedback,retrieved=retrieved,documents=documents,
                project_context=project_context(scope))

def request_text(scope, document_id, text):
    # One-request draft consent is separate from persistent ai_allowed. The active
    # request still must obey the chosen project/selection, and text-free modes.
    if scope['scope'] in {'none','profile_only'}: return ''
    if str(document_id) not in scope.get('request_document_ids',[]): return ''
    return text
