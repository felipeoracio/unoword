"""Authenticated subscription boundary. Billing stays unavailable until integrated.

No client request, checkout redirect, or unverified event writes entitlements.
The current repository has no payment provider; do not simulate successful billing.
"""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from lib.plans import BILLING_AVAILABLE
from lib.request_security import trusted_origin
from lib.auth import AuthenticatedUser, require_user
from lib.ai_access import get_entitlement, entitlement_is_active

router = APIRouter(prefix='/subscription', tags=['subscription'])

class PlanChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    target_plan: Literal['free', 'pro']
    confirmed: bool = False
    expected_user_id: str

@router.get('')
async def subscription(user: AuthenticatedUser = Depends(require_user)):
    entitlement = await get_entitlement(user.id)
    return {'user_id': user.id, 'plan': 'pro' if entitlement_is_active(entitlement) else 'free',
            'status': (entitlement or {}).get('status', 'inactive'), 'billing_available': BILLING_AVAILABLE}

@router.post('/change', dependencies=[Depends(trusted_origin)])
async def change_plan(payload: PlanChange, user: AuthenticatedUser = Depends(require_user)):
    if payload.expected_user_id != user.id:
        raise HTTPException(409, 'account_changed')
    if not payload.confirmed:
        raise HTTPException(409, 'confirmation_required')
    raise HTTPException(503, 'billing_unavailable')
