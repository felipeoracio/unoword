"""Owner-bound email linking, isolated Stripe webhooks and admin-only controls."""
import hmac
import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from lib.auth import AuthenticatedUser, require_user
from lib.admin_auth import require_admin
from lib.request_security import trusted_origin, limit_sensitive
from lib import substack_stripe as integration

router = APIRouter(tags=['substack-integration'])


def private(response: Response):
    response.headers['Cache-Control']='private, no-store'
    response.headers['Referrer-Policy']='no-referrer'


class Owned(BaseModel):
    model_config=ConfigDict(extra='forbid')
    expected_user_id: UUID


class Begin(Owned):
    email: str = Field(min_length=3,max_length=254)


class Finish(Owned):
    request_id: UUID


class Verify(Finish):
    code: str = Field(pattern=r'^\d{8}$')


def owner(payload,user):
    if str(payload.expected_user_id)!=user.id:
        raise HTTPException(409,'account_changed')
    if os.getenv('AI_AUTH_MODE','supabase')!='supabase' or not user.access_token:
        raise HTTPException(401,'substack_sign_in_required')


@router.get('/subscription/substack')
async def status(response:Response,user:AuthenticatedUser=Depends(require_user)):
    private(response)
    if os.getenv('AI_AUTH_MODE','supabase')!='supabase' or not user.access_token:
        raise HTTPException(401,'substack_sign_in_required')
    return await integration.user_status(user)


@router.post('/subscription/substack/connect',dependencies=[Depends(trusted_origin)])
async def connect(payload:Begin,response:Response,user:AuthenticatedUser=Depends(require_user)):
    private(response);owner(payload,user);limit_sensitive('substack-link:'+user.id,3,3600)
    return await integration.begin_link(user,payload.email)


@router.post('/subscription/substack/verify',dependencies=[Depends(trusted_origin)])
async def verify(payload:Verify,response:Response,user:AuthenticatedUser=Depends(require_user)):
    private(response);owner(payload,user);limit_sensitive('substack-verify:'+user.id,15,600)
    return await integration.verify_link(user,str(payload.request_id),payload.code)


@router.post('/subscription/substack/finish',dependencies=[Depends(trusted_origin)])
async def finish(payload:Finish,response:Response,user:AuthenticatedUser=Depends(require_user)):
    private(response);owner(payload,user);limit_sensitive('substack-finish:'+user.id,5,600)
    return await integration.finish_link(user,str(payload.request_id))


@router.post('/subscription/substack/cancel',dependencies=[Depends(trusted_origin)])
async def cancel(payload:Finish,response:Response,user:AuthenticatedUser=Depends(require_user)):
    private(response);owner(payload,user)
    await integration.rpc('verification',action='cancel',user=user.id,id=str(payload.request_id),data={})
    return {'canceled':True}


@router.post('/subscription/substack/reverify',dependencies=[Depends(trusted_origin)])
async def reverify(payload:Owned,response:Response,user:AuthenticatedUser=Depends(require_user)):
    private(response);owner(payload,user);limit_sensitive('substack-reverify:'+user.id,3,300)
    c=integration.config()
    links=await integration.db('GET','substack_links',params={**integration.scope(c),'user_id':'eq.'+user.id,'disconnected_at':'is.null','select':'subscription_id'})
    for link in links:
        await integration.refresh_subscription(c,link['subscription_id'])
    return await integration.user_status(user)


@router.post('/subscription/substack/disconnect',dependencies=[Depends(trusted_origin)])
async def disconnect(payload:Owned,response:Response,user:AuthenticatedUser=Depends(require_user)):
    private(response);owner(payload,user)
    c=integration.config()
    await integration.rpc('disconnect',user=user.id,account=c.account,live=c.live)
    return {'connected':False,'other_subscriptions_preserved':True}


@router.post('/webhooks/substack-stripe')
async def webhook(request:Request):
    body=bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body)>524288:
            raise HTTPException(413,'substack_webhook_too_large')
    return await integration.accept_event(bytes(body),request.headers.get('stripe-signature',''))


@router.get('/internal/substack-sync')
async def scheduled(request:Request,response:Response):
    private(response)
    secret=os.getenv('CRON_SECRET','')
    if len(secret)<32:
        raise HTTPException(503,'substack_scheduler_not_configured')
    if not hmac.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+secret).encode()):
        raise HTTPException(401,'worker_authentication_required')
    return await integration.worker()


@router.get('/admin/integrations/substack',dependencies=[Depends(require_admin)])
async def admin_status(response:Response):
    private(response)
    return await integration.admin_status()


class Control(BaseModel):
    model_config=ConfigDict(extra='forbid')
    enabled: bool
    confirmed: bool=False


class Reconcile(BaseModel):
    model_config=ConfigDict(extra='forbid')
    operation: Literal['inspect','import','events','subscriptions','csv','retry_failed','destination']
    cursor: str|None=Field(default=None,pattern=r'^sub_[A-Za-z0-9]+$')
    row_hash: str|None=Field(default=None,pattern=r'^[a-f0-9]{64}$')
    destination_id: str|None=Field(default=None,max_length=160,pattern=r'^(we|ed)_[A-Za-z0-9_]+$')


@router.post('/admin/integrations/substack/activation',dependencies=[Depends(trusted_origin)])
async def activate(payload:Control,response:Response,admin=Depends(require_admin)):
    private(response)
    return await integration.set_enabled(payload.enabled,payload.confirmed,str(admin['sub']))


@router.post('/admin/integrations/substack/reconcile',dependencies=[Depends(trusted_origin)])
async def reconcile(payload:Reconcile,response:Response,admin=Depends(require_admin)):
    private(response);limit_sensitive('substack-admin:'+str(admin['sub']),30,300)
    if payload.operation=='inspect':return await integration.observe()
    if payload.operation=='destination':
        if not payload.destination_id:raise HTTPException(422,'substack_destination_id_required')
        return await integration.inspect_destination(payload.destination_id)
    if payload.operation=='import':return await integration.import_batch(payload.cursor)
    if payload.operation=='retry_failed':
        c=integration.config();return {'queued':await integration.rpc('retry_events',account=c.account,live=c.live)}
    if payload.operation=='events':return {'processed':await integration.process_event()}
    if payload.operation=='subscriptions':return {'processed':await integration.reconcile_links()}
    if not payload.row_hash:raise HTTPException(422,'substack_csv_row_required')
    return await integration.reconcile_csv(payload.row_hash)


class CSV(BaseModel):
    model_config=ConfigDict(extra='forbid')
    text: str=Field(max_length=524288)


@router.post('/admin/integrations/substack/csv',dependencies=[Depends(trusted_origin)])
async def csv_import(payload:CSV,response:Response,admin=Depends(require_admin)):
    private(response)
    return await integration.import_csv(payload.text,str(admin['sub']))
