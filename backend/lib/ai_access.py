"""Server-authoritative UnoWord AI entitlement checks."""

import os
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status

from lib.plans import plan_features
from lib.auth import AuthenticatedUser, require_user
from lib.supabase_client import SupabaseAPIError, raise_http, service_rest


async def get_entitlement(user_id: str) -> dict | None:
    try:
        rows = await service_rest(
            "GET",
            "ai_entitlements",
            params={"select": "*", "user_id": f"eq.{user_id}", "limit": "1"},
        )
    except SupabaseAPIError as error:
        raise_http(error)
    native = rows[0] if rows else None
    if entitlement_is_active(native) or not os.getenv("SUBSTACK_STRIPE_SECRET_KEY"):
        return native
    # Independent source; never overwrite UnoWord's native Stripe/Lifetime row.
    from lib import substack_stripe
    try:
        config = substack_stripe.config()
        external = await substack_stripe.rpc("entitlement", user=user_id, account=config.account, live=config.live)
    except HTTPException:
        return native  # A failed external integration never removes native access.
    return external or native


def entitlement_is_active(entitlement: dict | None) -> bool:
    if not entitlement:
        return False
    if entitlement.get("status") not in {"active", "trialing"} or not plan_features(entitlement.get("plan", "free"))["new_topic"]:
        return False
    # Sandbox subscriptions must not unlock paid access after a switch to live keys.
    key = os.getenv('STRIPE_SECRET_KEY', '')
    if entitlement.get('billing_source') in {'stripe', 'stripe_lifetime'} and key and (
        bool(entitlement.get('billing_livemode')) != key.startswith(('sk_live_', 'rk_live_'))
    ):
        return False
    if entitlement.get('billing_source') == 'substack_stripe':
        external_key = os.getenv('SUBSTACK_STRIPE_SECRET_KEY', '')
        if not external_key or bool(entitlement.get('billing_livemode')) != external_key.startswith(('sk_live_', 'rk_live_')):
            return False
    valid_until = entitlement.get("valid_until")
    return not valid_until or datetime.fromisoformat(valid_until.replace("Z", "+00:00")) >= datetime.now(timezone.utc)


async def require_ai_user(user: AuthenticatedUser = Depends(require_user)) -> AuthenticatedUser:
    if not entitlement_is_active(await get_entitlement(user.id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="An eligible UnoWord AI plan is required")
    return user