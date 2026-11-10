"""Synthetic project RPC boundary for older provider fixtures.

SQL tests exercise the real RLS/resolver; provider tests still execute the common
context loader and assert exactly which authorized text reaches the model.
"""
from lib import projects, project_context
from lib.retrieval import RetrievedChunk


def install_project_boundary(monkeypatch, reader, retrieval=None, disabled=None):
    async def rows(table, user):
        try: return await reader(table, user, extra={'enabled':'eq.true','processing_status':'eq.ready'} if table=='ai_documents' else {})
        except KeyError: return []

    async def scope(user, payload):
        sources = await rows('ai_documents', user)
        revoked = await disabled(user.id, user.access_token) if disabled else set()
        refs = [r['id'] for r in sources if r.get('enabled', True) and r.get('processing_status', 'ready') == 'ready' and r['id'] not in revoked]
        documents = await rows('writing_documents', user)
        mems = await rows('ai_memories', user)
        memories = [r['id'] for r in mems if r.get('source_id') not in revoked]
        history = await rows('ai_suggestions', user)
        return {'scope':'current_project','project_id':None,'project':None,'profile_enabled':True,
                'source_ids':refs,'document_ids':[r['id'] for r in documents],
                'request_document_ids':[str(getattr(payload,'document_id',''))],
                'memory_ids':memories,'session_ids':[],
                'suggestion_ids':[r.get('id','history') for r in history],
                'feedback_ids':['feedback'],'resource_count':len(refs)+len(documents)}

    async def rpc(name, user, body=None):
        if name=='workspace_context_rows':
            table={'source':'ai_documents','memory':'ai_memories','suggestion':'ai_suggestions','feedback':'ai_feedback'}[body['p_kind']]
            values=await rows(table,user)
            return [row for row in values if row.get('id', 'feedback' if table=='ai_feedback' else 'history') in body['p_ids']]
        if name=='workspace_document_passages':
            return [row for row in await rows('writing_documents',user) if row['id'] in body['p_ids']]
        raise AssertionError(name)

    async def rest(method, table, token, params=None):
        from types import SimpleNamespace
        # Reader fixtures validate object identity; the active user is captured
        # by scope before loading profile rows.
        return await rows(table, holder['user'])

    holder={}
    async def resolve(user,payload):
        holder['user']=user
        return await scope(user,payload)
    async def retrieve(user_id,query,scope):
        if retrieval:
            result=await retrieval(user_id,query)
            return result
        return []
    monkeypatch.setattr(projects,'resolve_scope',resolve)
    monkeypatch.setattr(project_context,'resolve_scope',resolve)
    monkeypatch.setattr(projects,'project_rpc',rpc)
    monkeypatch.setattr(project_context,'project_rpc',rpc)
    monkeypatch.setattr(project_context,'user_rest',rest)
    monkeypatch.setattr(project_context,'retrieve_user_chunks',retrieve)
