"""One-time, test-only lifetime purchases. Stripe verifies money; SQL owns capacity."""

import os
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi import HTTPException
from lib import billing
from lib.supabase_client import SupabaseAPIError, service_rest

PRICE = {"amount": 10000, "currency": "usd", "capacity": 25}
REFUND_DAYS = 14
OFFER = "lifetime_100_first_25_v1"


def test_mode():
    if billing.require_allowed_mode():
        raise HTTPException(503, "lifetime_test_mode_required")


def configured():
    try:
        test_mode()
    except HTTPException:
        return False
    return os.getenv("STRIPE_LIFETIME_ENABLED", "").lower() == "true" and all(
        os.getenv(k, "").strip()
        for k in ("STRIPE_LIFETIME_PRICE_ID", "STRIPE_WEBHOOK_SECRET")
    )


async def db(method, path, **kwargs):
    try:
        return await service_rest(method, path, **kwargs)
    except SupabaseAPIError as error:
        if "lifetime_capacity_unavailable" in error.detail:
            raise HTTPException(409, "lifetime_capacity_unavailable") from error
        raise HTTPException(503, "lifetime_storage_unavailable") from error


async def availability():
    result = {
        **PRICE,
        "test_mode": True,
        "checkout_available": False,
        "remaining": None,
        "available": None,
        "refund_days": REFUND_DAYS,
        "daily_ai_limit": effective_ai_limit(),
        "purchased": None,
        "reserved": None,
    }
    try:
        rows = await db(
            "GET", "lifetime_orders", params={"select": "status,slot", "limit": "26"}
        )
        sold = await db(
            "GET", "lifetime_sold_slots", params={"select": "slot", "limit": "26"}
        )
    except HTTPException:
        return result
    purchased = len(sold)
    reserved = sum(r["status"] == "reserved" for r in rows)
    remaining = max(0, PRICE["capacity"] - len({r["slot"] for r in rows + sold}))
    return {
        **result,
        "purchased": purchased,
        "reserved": reserved,
        "remaining": max(0, PRICE["capacity"] - purchased),
        "available": remaining,
        "checkout_available": configured() and remaining > 0,
    }


async def order(user_id):
    rows = await db(
        "GET",
        "lifetime_orders",
        params={"user_id": f"eq.{user_id}", "select": "*", "limit": "1"},
    )
    return rows[0] if rows else None


async def verified_price(c):
    price = await billing.call(
        c.v1.prices.retrieve,
        os.environ["STRIPE_LIFETIME_PRICE_ID"],
        operation="price_lookup",
    )
    if not (
        price.get("active")
        and price.get("type") == "one_time"
        and not price.get("recurring")
        and price.get("unit_amount") == PRICE["amount"]
        and price.get("currency") == PRICE["currency"]
        and price.get("livemode") is False
    ):
        raise HTTPException(503, "lifetime_price_mismatch")
    return price


async def expired(c, item):
    if not item.get("checkout_id") or item["status"] != "reserved":
        return False
    session = await billing.call(
        c.v1.checkout.sessions.retrieve,
        item["checkout_id"],
        operation="checkout_lookup",
    )
    if (
        session.get("livemode") is not False
        or session.get("customer") != item["customer_id"]
        or session.get("metadata", {}).get("attempt") != item["attempt"]
    ):
        raise HTTPException(400, "lifetime_owner_mismatch")
    if session.get("status") == "expired":
        return await db(
            "POST",
            "rpc/lifetime_release",
            json={
                "p_user_id": item["user_id"],
                "p_attempt": item["attempt"],
                "p_checkout": item["checkout_id"],
            },
        )
    return False


async def checkout(user):
    test_mode()
    if not configured():
        raise HTTPException(503, "lifetime_unavailable")
    c = billing.client()
    await verified_price(c)
    async with billing.locked(user.id) as (state, lease):
        previous = await order(user.id)
        if previous and previous["status"] != "reserved":
            raise HTTPException(409, "lifetime_already_purchased")
        customer = state.get("customer_id")
        if customer and state.get("livemode"):
            raise HTTPException(409, "billing_mode_mismatch")
        entitlement = await billing.get_entitlement(user.id)
        if (
            billing.entitlement_is_active(entitlement)
            and (entitlement or {}).get("billing_source") != "stripe"
        ):
            raise HTTPException(409, "plan_managed_separately")
        if customer:
            subscriptions = await billing.call(
                c.v1.subscriptions.list,
                {"customer": customer, "status": "all", "limit": 100},
                operation="subscriptions_list",
            )
            if subscriptions.get("has_more") or any(
                s["status"] not in billing.TERMINAL for s in subscriptions["data"]
            ):
                raise HTTPException(409, "lifetime_existing_subscription")
            if state.get("checkout_id"):
                monthly = await billing.call(
                    c.v1.checkout.sessions.retrieve,
                    state["checkout_id"],
                    operation="checkout_lookup",
                )
                if monthly.get("status") in {"open", "complete"}:
                    raise HTTPException(409, "lifetime_existing_subscription")
        else:
            customer = (
                await billing.call(
                    c.v1.customers.create,
                    {"metadata": {"unoword_user_id": user.id}},
                    options={"idempotency_key": "unoword-customer-" + user.id},
                    operation="customer_create",
                )
            )["id"]
            state.update(customer_id=customer, livemode=False)
            await billing.commit(state, lease)
        if previous and await expired(c, previous):
            previous = None
        if previous and previous["price_id"] != os.environ["STRIPE_LIFETIME_PRICE_ID"]:
            raise HTTPException(409, "lifetime_review_required")
        if previous and previous.get("checkout_id"):
            session = await billing.call(
                c.v1.checkout.sessions.retrieve,
                previous["checkout_id"],
                operation="checkout_lookup",
            )
            if session.get("status") == "open":
                return {
                    "url": billing.hosted_url(session["url"]),
                    "destination": "checkout",
                }
            raise HTTPException(409, "lifetime_payment_pending")
        # Expired sessions only release slots after verified Stripe state; never by a local timer.
        if (
            previous
            and not previous.get("checkout_id")
            and datetime.fromisoformat(previous["created_at"].replace("Z", "+00:00"))
            < datetime.now(timezone.utc) - timedelta(hours=23)
        ):
            raise HTTPException(409, "lifetime_review_required")
        reserve_payload = {
            "p_user_id": user.id,
            "p_attempt": str(uuid4()),
            "p_customer": customer,
            "p_price": os.environ["STRIPE_LIFETIME_PRICE_ID"],
        }
        item = previous
        if not item:
            try:
                item = await db("POST", "rpc/lifetime_reserve", json=reserve_payload)
            except HTTPException as error:
                if error.detail != "lifetime_capacity_unavailable":
                    raise
                # Bound reconciliation work; ordinary purchases do not scan Stripe.
                candidates = await db(
                    "GET",
                    "lifetime_orders",
                    params={
                        "status": "eq.reserved",
                        "checkout_id": "not.is.null",
                        "created_at": "lt."
                        + (
                            datetime.now(timezone.utc) - timedelta(minutes=31)
                        ).isoformat(),
                        "select": "*",
                        "limit": "5",
                    },
                )
                await asyncio.gather(
                    *(
                        expired(c, candidate)
                        for candidate in candidates
                        if candidate["user_id"] != user.id
                    )
                )
                item = await db("POST", "rpc/lifetime_reserve", json=reserve_payload)
        params = {
            "mode": "payment",
            "customer": customer,
            "client_reference_id": user.id,
            "managed_payments": {"enabled": False},
            "payment_method_types": ["card"],
            "line_items": [
                {"price": os.environ["STRIPE_LIFETIME_PRICE_ID"], "quantity": 1}
            ],
            "metadata": {
                "unoword_user_id": user.id,
                "offer": OFFER,
                "attempt": item["attempt"],
            },
            "payment_intent_data": {
                "metadata": {
                    "unoword_user_id": user.id,
                    "offer": OFFER,
                    "attempt": item["attempt"],
                }
            },
            "success_url": billing.app_url()
            + "/account?offer=lifetime&billing=success",
            "cancel_url": billing.app_url()
            + "/account?offer=lifetime&billing=canceled",
        }
        # No changing timestamps in idempotent request parameters. Stripe's default
        # expiration is safe; reservations release only after verified expiration.
        session = await billing.call(
            c.v1.checkout.sessions.create,
            params,
            options={"idempotency_key": "unoword-lifetime-" + item["attempt"]},
            operation="checkout_create",
        )
        attached = await db(
            "POST",
            "rpc/lifetime_attach",
            json={
                "p_user_id": user.id,
                "p_attempt": item["attempt"],
                "p_checkout": session["id"],
            },
        )
        if not attached:
            raise HTTPException(409, "lifetime_payment_pending")
        return {"url": billing.hosted_url(session["url"]), "destination": "checkout"}


async def payment_details(c, item):
    session = await billing.call(
        c.v1.checkout.sessions.retrieve,
        item["checkout_id"],
        operation="checkout_lookup",
    )
    meta = session.get("metadata", {})
    if not (
        session.get("livemode") is False
        and session.get("mode") == "payment"
        and session.get("customer") == item["customer_id"]
        and session.get("client_reference_id") == item["user_id"]
        and meta.get("offer") == OFFER
        and meta.get("attempt") == item["attempt"]
        and meta.get("unoword_user_id") == item["user_id"]
    ):
        raise HTTPException(400, "lifetime_owner_mismatch")
    lines = await billing.call(
        c.v1.checkout.sessions.line_items.list,
        item["checkout_id"],
        {"limit": 2},
        operation="checkout_lines",
    )
    if (
        lines.get("has_more")
        or len(lines.get("data", [])) != 1
        or lines["data"][0].get("price", {}).get("id") != item["price_id"]
        or lines["data"][0].get("quantity") != 1
        or session.get("amount_total") != 10000
        or session.get("currency") != "usd"
    ):
        raise HTTPException(400, "lifetime_payment_mismatch")
    if session.get("status") != "complete" or session.get("payment_status") != "paid":
        return
    pi = await billing.call(
        c.v1.payment_intents.retrieve,
        session["payment_intent"],
        operation="payment_lookup",
    )
    if not (
        pi.get("status") == "succeeded"
        and pi.get("amount_received") == 10000
        and pi.get("currency") == "usd"
        and pi.get("livemode") is False
        and pi.get("customer") == item["customer_id"]
    ):
        raise HTTPException(400, "lifetime_payment_mismatch")
    charge = await billing.call(
        c.v1.charges.retrieve, pi["latest_charge"], operation="charge_lookup"
    )
    if not (
        charge.get("payment_intent") == pi["id"]
        and charge.get("customer") == item["customer_id"]
        and charge.get("livemode") is False
        and charge.get("paid")
        and charge.get("amount") == 10000
        and charge.get("currency") == "usd"
    ):
        raise HTTPException(400, "lifetime_payment_mismatch")
    if not isinstance(charge.get("created"), int):
        raise HTTPException(502, "lifetime_payment_date_missing")
    status = (
        "refunded"
        if charge.get("refunded") or charge.get("amount_refunded", 0) >= 10000
        else "paid"
    )
    if charge.get("disputed"):
        disputes = await billing.call(
            c.v1.disputes.list,
            {"payment_intent": pi["id"], "limit": 10},
            operation="dispute_lookup",
        )
        if (
            disputes.get("has_more")
            or not disputes.get("data")
            or any(d.get("status") != "won" for d in disputes["data"])
        ):
            status = "disputed"
    return pi, charge, status


async def reconcile(c, item, event_id):
    details = await payment_details(c, item)
    if not details:
        return
    pi, charge, status = details
    await db(
        "POST",
        "rpc/lifetime_finalize",
        json={
            "p_user_id": item["user_id"],
            "p_attempt": item["attempt"],
            "p_checkout": item["checkout_id"],
            "p_payment_intent": pi["id"],
            "p_status": status,
            "p_event": event_id,
            "p_paid_at": billing.timestamp(charge["created"]),
        },
    )


async def process_event(event):
    kind = event["type"]
    obj = event["data"]["object"]
    if not (
        kind.startswith("checkout.session.")
        or kind == "charge.refunded"
        or kind.startswith("charge.dispute.")
    ):
        return
    if (
        kind.startswith("checkout.session.")
        and obj.get("metadata", {}).get("offer") != OFFER
    ):
        return
    if not os.getenv("STRIPE_LIFETIME_PRICE_ID"):
        return
    if event.get("livemode"):
        if obj.get("metadata", {}).get("offer") == OFFER:
            raise HTTPException(400, "lifetime_test_mode_required")
        return
    test_mode()
    if kind.startswith("checkout.session."):
        rows = await db(
            "GET",
            "lifetime_orders",
            params={"checkout_id": f'eq.{obj["id"]}', "select": "*", "limit": "1"},
        )
        # A webhook can arrive before attach; recover only the known reserved attempt.
        if not rows and obj.get("metadata", {}).get("offer") == OFFER:
            item = await order(obj["metadata"].get("unoword_user_id", ""))
            if (
                item
                and item["attempt"] == obj["metadata"].get("attempt")
                and not item.get("checkout_id")
            ):
                c = billing.client()
                s = await billing.call(
                    c.v1.checkout.sessions.retrieve,
                    obj["id"],
                    operation="checkout_lookup",
                )
                if (
                    s.get("customer") != item["customer_id"]
                    or s.get("metadata", {}).get("attempt") != item["attempt"]
                ):
                    raise HTTPException(400, "lifetime_owner_mismatch")
                await db(
                    "POST",
                    "rpc/lifetime_attach",
                    json={
                        "p_user_id": item["user_id"],
                        "p_attempt": item["attempt"],
                        "p_checkout": obj["id"],
                    },
                )
                item["checkout_id"] = obj["id"]
                rows = [item]
    else:
        pi = obj.get("payment_intent")
        if not isinstance(pi, str):
            return
        rows = await db(
            "GET",
            "lifetime_orders",
            params={"payment_intent_id": f"eq.{pi}", "select": "*", "limit": "1"},
        )
    if not rows:
        return
    item = rows[0]
    async with billing.locked(item["user_id"]):
        c = billing.client()
        if kind == "checkout.session.expired":
            await expired(c, item)
        else:
            await reconcile(c, item, event["id"])


def effective_ai_limit():
    # Same effective cap used by existing AI endpoints for a new Pro grant.
    from routers.ai import _resolve_daily_limit

    return _resolve_daily_limit({"daily_request_limit": 100})


async def refund(user):
    test_mode()
    async with billing.locked(user.id):
        item = await order(user.id)
        if not item or item["status"] not in {"paid", "refunded"}:
            raise HTTPException(409, "lifetime_refund_unavailable")
        c = billing.client()
        details = await payment_details(c, item)
        if not details:
            raise HTTPException(409, "lifetime_refund_unavailable")
        pi, charge, status = details
        if status == "refunded":
            await reconcile(c, item, "refund-reconcile-" + pi["id"])
            return {"status": "refunded"}
        if status != "paid":
            raise HTTPException(409, "lifetime_refund_unavailable")
        if datetime.now(timezone.utc) > datetime.fromtimestamp(
            charge["created"], timezone.utc
        ) + timedelta(days=REFUND_DAYS):
            raise HTTPException(409, "lifetime_refund_window_closed")
        result = await billing.call(
            c.v1.refunds.create,
            {"payment_intent": pi["id"]},
            options={"idempotency_key": "unoword-lifetime-refund-" + pi["id"]},
            operation="refund_create",
        )
        await reconcile(c, item, "refund-request-" + result["id"])
        return {"status": "refund_requested"}
