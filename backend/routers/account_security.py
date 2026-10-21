"""Account mutations use GoTrue only; no admin updates, copied users, or local credentials."""
import os
from typing import Literal
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, model_validator
from lib.auth import AuthenticatedUser, require_user
from lib.request_security import limit_sensitive, trusted_origin
from lib.supabase_client import SupabaseAPIError, auth_request
from routers.auth import _password_grant, _set_session_cookies

router = APIRouter(prefix='/auth', tags=['account security'])

class Owned(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_user_id: str
    current_password: SecretStr = Field(min_length=1, max_length=200)

class EmailChange(Owned):
    email: EmailStr

class NewPassword(BaseModel):
    model_config = ConfigDict(extra='forbid')
    new_password: SecretStr = Field(min_length=8, max_length=200)
    confirm_password: SecretStr = Field(min_length=8, max_length=200)

    @model_validator(mode='after')
    def matching(self):
        if self.new_password.get_secret_value() != self.confirm_password.get_secret_value():
            raise ValueError('passwords_must_match')
        return self

class PasswordChange(Owned, NewPassword):
    pass

class RecoveryRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: EmailStr

class EmailVerification(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token_hash: SecretStr = Field(min_length=1, max_length=2048)
    type: Literal['email_change'] = 'email_change'

class RecoveryComplete(NewPassword):
    token_hash: SecretStr = Field(min_length=1, max_length=2048)


def provider_error(error: SupabaseAPIError, *, reauth=False):
    if error.response_status == 429:
        raise HTTPException(429, 'security_rate_limited')
    if reauth:
        raise HTTPException(401, 'current_password_invalid')
    detail = error.detail.lower()
    if 'already' in detail or 'registered' in detail:
        code = 'email_unavailable'
    elif 'weak' in detail or 'password' in detail:
        code = 'password_policy_rejected'
    elif 'expired' in detail or 'token' in detail or 'otp' in detail:
        code = 'verification_expired'
    else:
        code = 'security_provider_failed'
    raise HTTPException(400 if error.response_status < 500 else 502, code)

async def provider_user(user):
    try:
        data = await auth_request('GET', 'user', access_token=user.access_token)
    except SupabaseAPIError as error:
        if error.response_status in {401, 403}:
            raise HTTPException(401, 'session_expired')
        raise HTTPException(502, 'security_provider_failed')
    if str(data.get('id')) != user.id:
        raise HTTPException(401, 'session_expired')
    return data

def password_identity(data):
    providers = (data.get('app_metadata') or {}).get('providers') or [i.get('provider') for i in data.get('identities', [])]
    return 'email' in providers

async def reauthenticate(payload, user):
    if payload.expected_user_id != user.id:
        raise HTTPException(409, 'account_changed')
    limit_sensitive('reauth:' + user.id)
    data = await provider_user(user)
    if not password_identity(data):
        raise HTTPException(409, 'identity_provider_required')
    try:
        session = await _password_grant(data['email'], payload.current_password.get_secret_value())
    except SupabaseAPIError as error:
        provider_error(error, reauth=True)
    if str((session.get('user') or {}).get('id')) != user.id:
        raise HTTPException(401, 'current_password_invalid')
    return data, session

async def revoke_others(session):
    # Fail visibly if revocation fails; never claim it succeeded. GoTrue revokes
    # refresh sessions. Already issued access JWTs last until their expiry.
    try:
        await auth_request('POST', 'logout?scope=others', access_token=session['access_token'])
    except SupabaseAPIError:
        return False
    return True

@router.get('/security')
async def security_status(user: AuthenticatedUser = Depends(require_user)):
    data = await provider_user(user)
    return {'user_id': user.id, 'email': data.get('email'), 'email_verified': bool(data.get('email_confirmed_at')),
            'pending_email': data.get('new_email') or None, 'password_identity': password_identity(data),
            'email_workflow_configured': os.getenv('AUTH_SECURITY_EMAILS_CONFIGURED', 'false').lower() == 'true'}

@router.post('/email/change', dependencies=[Depends(trusted_origin)])
async def change_email(payload: EmailChange, response: Response, user: AuthenticatedUser = Depends(require_user)):
    data, session = await reauthenticate(payload, user)
    if payload.email.lower() == (data.get('email') or '').lower():
        raise HTTPException(400, 'email_unchanged')
    if os.getenv('AUTH_SECURITY_EMAILS_CONFIGURED', 'false').lower() != 'true':
        raise HTTPException(503, 'email_workflow_not_configured')
    try:
        config = await auth_request('GET', 'settings')
        if config.get('mailer_autoconfirm') is not False:
            raise HTTPException(503, 'email_verification_not_configured')
        await auth_request('PUT', 'user', access_token=session['access_token'], json={'email': str(payload.email)})
    except SupabaseAPIError as error:
        provider_error(error)
    _set_session_cookies(response, session)
    return {'status': 'verification_required', 'user_id': user.id}

@router.post('/email/resend', dependencies=[Depends(trusted_origin)])
async def resend_email(payload: Owned, user: AuthenticatedUser = Depends(require_user)):
    data, session = await reauthenticate(payload, user)
    if not data.get('new_email'):
        raise HTTPException(400, 'no_pending_email')
    limit_sensitive('email-resend:' + user.id, 1, 60)
    try:
        await auth_request('POST', 'resend', json={'type': 'email_change', 'email': data['new_email']}, access_token=session['access_token'])
    except SupabaseAPIError as error:
        provider_error(error)
    return {'status': 'verification_required'}

@router.post('/password/change', dependencies=[Depends(trusted_origin)])
async def change_password(payload: PasswordChange, response: Response, user: AuthenticatedUser = Depends(require_user)):
    _, session = await reauthenticate(payload, user)
    try:
        await auth_request('PUT', 'user', access_token=session['access_token'], json={'password': payload.new_password.get_secret_value()})
    except SupabaseAPIError as error:
        provider_error(error)
    revoked = await revoke_others(session)
    _set_session_cookies(response, session)
    return {'status': 'password_updated', 'user_id': user.id, 'other_sessions_revoked': revoked}

@router.post('/recovery', dependencies=[Depends(trusted_origin)], status_code=202)
async def request_recovery(payload: RecoveryRequest, request: Request):
    limit_sensitive('recovery:' + (request.client.host if request.client else 'unknown'), 5, 300)
    if os.getenv('AUTH_SECURITY_EMAILS_CONFIGURED', 'false').lower() != 'true':
        raise HTTPException(503, 'email_workflow_not_configured')
    redirect = os.getenv('PUBLIC_APP_URL', 'https://unoword.vercel.app').rstrip('/') + '/account/security'
    try:
        await auth_request('POST', 'recover?redirect_to=' + quote(redirect, safe=''), json={'email': str(payload.email)})
    except SupabaseAPIError:
        # Provider response must never reveal whether this address exists.
        pass
    return {'status': 'if_account_exists_check_email'}

async def verify(token_hash, kind):
    try:
        return await auth_request('POST', 'verify', json={'token_hash': token_hash.get_secret_value(), 'type': kind})
    except SupabaseAPIError as error:
        provider_error(error)

@router.post('/email/verify', dependencies=[Depends(trusted_origin)])
async def verify_email(payload: EmailVerification, response: Response, request: Request):
    limit_sensitive('verify:' + (request.client.host if request.client else 'unknown'), 15)
    session = await verify(payload.token_hash, 'email_change')
    if session.get('access_token'):
        _set_session_cookies(response, session)
    # Secure email change can require BOTH links, so do not promise completion
    # just because the first address was verified.
    return {'status': 'verification_accepted_check_both_addresses'}

@router.post('/recovery/complete', dependencies=[Depends(trusted_origin)])
async def complete_recovery(payload: RecoveryComplete, response: Response, request: Request):
    limit_sensitive('reset:' + (request.client.host if request.client else 'unknown'), 10)
    session = await verify(payload.token_hash, 'recovery')  # provider consumes this expiring, single-use token
    token = session.get('access_token')
    if not token:
        raise HTTPException(400, 'verification_expired')
    try:
        await auth_request('PUT', 'user', access_token=token, json={'password': payload.new_password.get_secret_value()})
    except SupabaseAPIError as error:
        provider_error(error)
    revoked = await revoke_others(session)
    _set_session_cookies(response, session)
    return {'status': 'password_updated', 'other_sessions_revoked': revoked}
