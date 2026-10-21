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
    return rows[0] if rows else None


def entitlement_is_active(entitlement: dict | None) -> bool:
    if not entitlement:
        return False
    if entitlement.get("status") not in {"active", "trialing"} or not plan_features(entitlement.get("plan", "free"))["new_topic"]:
        return False
    # Sandbox subscriptions must not unlock paid access after a switch to live keys.
    key = os.getenv('STRIPE_SECRET_KEY', '')
    if entitlement.get('billing_source') == 'stripe' and key and (
        bool(entitlement.get('billing_livemode')) != key.startswith(('sk_live_', 'rk_live_'))
    ):
        return False
    valid_until = entitlement.get("valid_until")
    return not valid_until or datetime.fromisoformat(valid_until.replace("Z", "+00:00")) >= datetime.now(timezone.utc)


async def require_ai_user(user: AuthenticatedUser = Depends(require_user)) -> AuthenticatedUser:
    if not entitlement_is_active(await get_entitlement(user.id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="An eligible UnoWord AI plan is required")
    return user