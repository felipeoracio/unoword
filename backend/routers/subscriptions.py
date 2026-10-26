"""Authenticated hosted billing and signature-verified subscription events."""

import os
from datetime import datetime, timezone, timedelta
from typing import Literal
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from lib import billing, lifetime
from lib.request_security import trusted_origin, limit_sensitive
from lib.auth import AuthenticatedUser, require_user
from lib.ai_access import get_entitlement, entitlement_is_active

router = APIRouter(prefix="/subscription", tags=["subscription"])


class PlanChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_plan: Literal["free", "pro"]
    confirmed: bool = False
    expected_user_id: str


async def require_billing_user(
    response: Response, user: AuthenticatedUser = Depends(require_user)
):
    # The development-header adapter is useful for AI fixtures, but it is not
    # a signed-in Supabase session and must never authorize customer billing.
    if os.getenv("AI_AUTH_MODE", "supabase").lower() != "supabase" or not getattr(
        user, "access_token", ""
    ):
        raise HTTPException(401, "billing_sign_in_required")
    response.headers["Cache-Control"] = "private, no-store"
    return user


@router.get("")
async def subscription(user: AuthenticatedUser = Depends(require_billing_user)):
    entitlement = await get_entitlement(user.id)
    state = await billing.account(user.id) if os.getenv("STRIPE_SECRET_KEY") else None
    return {
        "user_id": user.id,
        "access_source": (entitlement or {}).get("billing_source"),
        "plan": "pro" if entitlement_is_active(entitlement) else "free",
        "status": (
            state["status"]
            if state and state.get("subscription_id")
            else (entitlement or {}).get("status", "inactive")
        ),
        "billing_available": billing.billing_available(),
        "managed_by_stripe": bool(state and state.get("customer_id")),
        "period_end": (state or {}).get("period_end"),
        "cancel_at_period_end": (state or {}).get("cancel_at_period_end", False),
        "trial_eligible": not bool((state or {}).get("trial_used")),
    }


@router.post("/change", dependencies=[Depends(trusted_origin)])
async def change_plan(
    payload: PlanChange, user: AuthenticatedUser = Depends(require_billing_user)
):
    if payload.expected_user_id != user.id:
        raise HTTPException(409, "account_changed")
    if not payload.confirmed:
        raise HTTPException(409, "confirmation_required")
    limit_sensitive("billing:" + user.id, maximum=10)
    return await billing.change_plan(user, payload.target_plan)


@router.post("/webhook")
async def webhook(request: Request):
    # Remains active when new checkout is disabled, so cancellations still sync.
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    if not secret:
        raise HTTPException(503, "billing_unavailable")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 262144:
            raise HTTPException(413, "billing_event_too_large")
    try:
        event = stripe.Webhook.construct_event(
            bytes(body),
            request.headers.get("stripe-signature", ""),
            secret,
            tolerance=300,
        ).to_dict()
    except (ValueError, stripe.SignatureVerificationError) as error:
        raise HTTPException(400, "invalid_billing_signature") from error
    if bool(event.get("livemode")) != billing.require_allowed_mode():
        raise HTTPException(400, "billing_mode_mismatch")
    await billing.process_event(event)
    await lifetime.process_event(event)
    return {"received": True}


class LifetimePurchase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed: bool = False
    expected_user_id: str


@router.get("/lifetime/offer")
async def lifetime_offer(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await lifetime.availability()


@router.get("/lifetime")
async def lifetime_status(user: AuthenticatedUser = Depends(require_billing_user)):
    item = await lifetime.order(user.id)
    offer = await lifetime.availability()
    status = (item or {}).get("status", "none")
    return {
        "user_id": user.id,
        "status": status,
        "can_refund": status == "paid"
        and bool((item or {}).get("paid_at"))
        and datetime.now(timezone.utc)
        <= datetime.fromisoformat(item["paid_at"].replace("Z", "+00:00"))
        + timedelta(days=lifetime.REFUND_DAYS),
        "can_checkout": lifetime.configured()
        and (
            status == "reserved"
            or status == "none"
            and offer["available"] is not None
            and offer["available"] > 0
        ),
    }


@router.post("/lifetime", dependencies=[Depends(trusted_origin)])
async def lifetime_checkout(
    payload: LifetimePurchase, user: AuthenticatedUser = Depends(require_billing_user)
):
    if payload.expected_user_id != user.id:
        raise HTTPException(409, "account_changed")
    if not payload.confirmed:
        raise HTTPException(409, "confirmation_required")
    limit_sensitive("lifetime:" + user.id, maximum=10)
    return await lifetime.checkout(user)


@router.post("/lifetime/refund", dependencies=[Depends(trusted_origin)])
async def lifetime_refund(
    payload: LifetimePurchase, user: AuthenticatedUser = Depends(require_billing_user)
):
    if payload.expected_user_id != user.id:
        raise HTTPException(409, "account_changed")
    if not payload.confirmed:
        raise HTTPException(409, "confirmation_required")
    limit_sensitive("lifetime-refund:" + user.id, maximum=5)
    return await lifetime.refund(user)
