"""Money/inventory provider boundaries. No real payments, accounts or Stripe calls."""

from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4
import hashlib, hmac, json, time
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from server import app
from lib import billing, lifetime
from lib.auth import require_user
from lib.request_security import _bursts

OWNER = "00000000-0000-4000-8000-000000000001"
ORIGIN = {"Origin": "https://unoword.vercel.app"}


@pytest.fixture
def system(monkeypatch):
    for k, v in {
        "AI_AUTH_MODE": "supabase",
        "STRIPE_SECRET_KEY": "sk_test_fixture",
        "STRIPE_WEBHOOK_SECRET": "whsec_fixture",
        "STRIPE_LIFETIME_PRICE_ID": "price_lifetime",
        "STRIPE_LIFETIME_ENABLED": "true",
        "STRIPE_LIVE_BILLING_APPROVED": "false",
    }.items():
        monkeypatch.setenv(k, v)
    from lib import ai_quota
    async def terms(): return {"id":"v2","name":"Coach","suggestions_daily":10,"suggestions_monthly":200,"guidance_monthly":30}
    monkeypatch.setattr(ai_quota,'public_allowance',terms)
    item = {
        "user_id": OWNER,
        "attempt": str(uuid4()),
        "slot": 1,
        "customer_id": "cus_test",
        "price_id": "price_lifetime",
        "checkout_id": None,
        "status": "reserved",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    state = {
        "user_id": OWNER,
        "customer_id": "cus_test",
        "livemode": False,
        "checkout_id": None,
    }
    orders = []
    sold = []
    events = set()
    calls = []
    entitlement = {}
    provider = Mock()
    provider.v1.prices.retrieve.return_value = {
        "id": "price_lifetime",
        "active": True,
        "type": "one_time",
        "unit_amount": 10000,
        "currency": "usd",
        "livemode": False,
    }
    provider.v1.subscriptions.list.return_value = {"data": [], "has_more": False}
    meta = {
        "offer": lifetime.OFFER,
        "unoword_user_id": OWNER,
        "attempt": item["attempt"],
    }
    session = {
        "id": "cs_test",
        "status": "open",
        "mode": "payment",
        "livemode": False,
        "customer": "cus_test",
        "client_reference_id": OWNER,
        "metadata": meta,
        "amount_total": 10000,
        "currency": "usd",
        "payment_status": "unpaid",
        "payment_intent": "pi_test",
        "url": "https://checkout.stripe.com/c/pay/fixture",
    }
    provider.v1.checkout.sessions.create.return_value = session
    provider.v1.checkout.sessions.retrieve.return_value = session
    provider.v1.checkout.sessions.line_items.list.return_value = {
        "data": [{"price": {"id": "price_lifetime"}, "quantity": 1}],
        "has_more": False,
    }
    provider.v1.payment_intents.retrieve.return_value = {
        "id": "pi_test",
        "status": "succeeded",
        "customer": "cus_test",
        "amount_received": 10000,
        "currency": "usd",
        "livemode": False,
        "latest_charge": "ch_test",
    }
    provider.v1.charges.retrieve.return_value = {
        "id": "ch_test",
        "payment_intent": "pi_test",
        "customer": "cus_test",
        "livemode": False,
        "paid": True,
        "amount": 10000,
        "currency": "usd",
        "refunded": False,
        "amount_refunded": 0,
        "disputed": False,
        "created": int(time.time()),
    }
    provider.v1.disputes.list.return_value = {"data": [], "has_more": False}

    async def db(method, path, **kwargs):
        calls.append((path, deepcopy(kwargs)))
        if path == 'rpc/ai_assign_allowance': return None
        params = kwargs.get("params", {})
        body = kwargs.get("json", {})
        if path == "lifetime_orders":
            found = orders
            for key in ["user_id", "checkout_id", "payment_intent_id", "status"]:
                if params.get(key, "").startswith("eq."):
                    found = [r for r in found if r.get(key) == params[key][3:]]
            if params.get("checkout_id") == "not.is.null":
                found = [r for r in found if r.get("checkout_id")]
            if "created_at" in params:
                found = []
            return deepcopy(found)
        if path == "lifetime_sold_slots":
            return deepcopy(sold)
        if path == "rpc/lifetime_reserve":
            if len(orders) >= 25:
                raise HTTPException(409, "lifetime_capacity_unavailable")
            if not orders:
                orders.append(deepcopy(item))
            return deepcopy(orders[0])
        if path == "rpc/lifetime_attach":
            orders[0]["checkout_id"] = body["p_checkout"]
            return True
        if path == "rpc/lifetime_release":
            orders.clear()
            return True
        if path == "rpc/lifetime_finalize":
            if body["p_event"] in events:
                return False
            events.add(body["p_event"])
            orders[0].update(
                status=body["p_status"], payment_intent_id=body["p_payment_intent"]
            )
            entitlement.update(
                status="active" if body["p_status"] == "paid" else "inactive",
                billing_source="stripe_lifetime",
                valid_until=None,
            )
            sold.append({"slot": 1})
            return True
        pytest.fail(path)

    @asynccontextmanager
    async def locked(_):
        yield state, str(uuid4())

    async def ent(_):
        return None

    monkeypatch.setattr(lifetime, "db", db)
    monkeypatch.setattr(billing, "locked", locked)
    monkeypatch.setattr(billing, "client", lambda: provider)
    monkeypatch.setattr(billing, "get_entitlement", ent)
    monkeypatch.setattr(
        billing, "process_event", lambda e: __import__("asyncio").sleep(0)
    )
    app.dependency_overrides[require_user] = lambda: SimpleNamespace(
        id=OWNER, access_token="verified-token", email="fixture@example.com"
    )
    _bursts.clear()
    with TestClient(app) as client:
        yield SimpleNamespace(
            client=client,
            provider=provider,
            session=session,
            item=item,
            state=state,
            orders=orders,
            sold=sold,
            calls=calls,
            entitlement=entitlement,
            events=events,
        )
    app.dependency_overrides.clear()
    _bursts.clear()


def buy(f, **patch):
    return f.client.post(
        "/api/subscription/lifetime",
        json={"expected_user_id": OWNER, "confirmed": True, **patch},
        headers=ORIGIN,
    )


def event(f, kind="checkout.session.completed", event_id="evt_paid", signature=True):
    payload = json.dumps(
        {"id": event_id, "type": kind, "livemode": False, "data": {"object": f.session}}
    )
    timestamp = int(time.time())
    digest = hmac.new(
        b"whsec_fixture", f"{timestamp}.{payload}".encode(), hashlib.sha256
    ).hexdigest()
    return f.client.post(
        "/api/subscription/webhook",
        content=payload,
        headers={
            "stripe-signature": f't={timestamp},v1={digest if signature else "bad"}'
        },
    )


def test_checkout_one_time_server_price_no_trial_and_stable_retry(system):
    f = system
    assert buy(f).status_code == 200
    params = f.provider.v1.checkout.sessions.create.call_args.args[0]
    assert params["mode"] == "payment" and params["line_items"] == [
        {"price": "price_lifetime", "quantity": 1}
    ]
    assert params["payment_method_types"] == ["card"] and params[
        "managed_payments"
    ] == {"enabled": False}
    assert "subscription_data" not in params and "trial_period_days" not in str(params)
    assert (
        buy(f).status_code == 200
        and f.provider.v1.checkout.sessions.create.call_count == 1
    )
    assert f.entitlement == {}


@pytest.mark.parametrize(
    "patch",
    [
        {"confirmed": False},
        {"expected_user_id": "other"},
        {"amount": 1},
        {"price_id": "evil"},
        {"quantity": 2},
    ],
)
def test_cannot_spoof_or_skip_confirmation(system, patch):
    assert buy(system, **patch).status_code in {409, 422}
    assert not system.provider.v1.checkout.sessions.create.called


def test_auth_and_csrf(system):
    f = system
    assert (
        f.client.post(
            "/api/subscription/lifetime",
            json={"expected_user_id": OWNER, "confirmed": True},
        ).status_code
        == 403
    )
    app.dependency_overrides.pop(require_user)
    assert buy(f).status_code == 401
    assert not f.provider.v1.checkout.sessions.create.called


@pytest.mark.parametrize(
    "patch",
    [
        {"type": "recurring"},
        {"unit_amount": 2000},
        {"currency": "eur"},
        {"livemode": True},
        {"active": False},
    ],
)
def test_wrong_stripe_price_fails_closed(system, patch):
    system.provider.v1.prices.retrieve.return_value.update(patch)
    assert buy(system).status_code == 503
    assert not system.orders


def test_live_never_enabled_even_with_general_approval(system, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_fixture")
    monkeypatch.setenv("STRIPE_LIVE_BILLING_APPROVED", "true")
    assert buy(system).status_code == 503
    assert not system.provider.v1.checkout.sessions.create.called


def test_existing_subscription_prevents_double_charge(system):
    f = system
    f.provider.v1.subscriptions.list.return_value = {
        "data": [{"status": "active"}],
        "has_more": False,
    }
    assert buy(f).status_code == 409
    assert not f.provider.v1.checkout.sessions.create.called


def test_no_access_until_signed_verified_paid_payment_and_duplicate_safe(system):
    f = system
    buy(f)
    assert event(f, signature=False).status_code == 400 and not f.entitlement
    assert event(f).status_code == 200 and not f.entitlement
    f.session.update(status="complete", payment_status="paid")
    assert (
        event(f).status_code == 200
        and f.entitlement["status"] == "active"
        and f.entitlement["valid_until"] is None
    )
    assert event(f).status_code == 200 and len(f.events) == 1


@pytest.mark.parametrize("which", ["amount", "owner", "price", "payment_intent"])
def test_tampered_payment_does_not_grant(system, which):
    f = system
    buy(f)
    f.session.update(status="complete", payment_status="paid")
    if which == "amount":
        f.session["amount_total"] = 1
    if which == "owner":
        f.session["metadata"]["unoword_user_id"] = "other"
    if which == "price":
        f.provider.v1.checkout.sessions.line_items.list.return_value["data"][0][
            "price"
        ]["id"] = "price_wrong"
    if which == "payment_intent":
        f.provider.v1.payment_intents.retrieve.return_value["status"] = "processing"
    assert event(f).status_code == 400 and not f.entitlement


def test_refund_and_out_of_order_completion_recheck_current_stripe(system):
    f = system
    buy(f)
    f.session.update(status="complete", payment_status="paid")
    event(f)
    f.provider.v1.charges.retrieve.return_value.update(
        refunded=True, amount_refunded=10000
    )
    assert event(f, event_id="evt_late_checkout").status_code == 200
    assert f.entitlement["status"] == "inactive"


def test_expiration_only_releases_verified_expired_checkout(system):
    f = system
    buy(f)
    assert (
        event(f, kind="checkout.session.expired").status_code == 200
        and len(f.orders) == 1
    )
    f.session["status"] = "expired"
    assert (
        event(f, kind="checkout.session.expired").status_code == 200 and f.orders == []
    )


def test_real_capacity_and_unavailable_counts_never_fabricated(system, monkeypatch):
    f = system
    f.orders[:] = [
        {**f.item, "user_id": str(uuid4()), "slot": i + 1} for i in range(25)
    ]
    offer = f.client.get("/api/subscription/lifetime/offer").json()
    assert (
        offer["available"] == 0
        and offer["remaining"] == 25
        and offer["reserved"] == 25
        and not offer["checkout_available"]
    )
    assert buy(f).status_code == 409

    async def unavailable(*a, **k):
        raise HTTPException(503, "lifetime_storage_unavailable")

    monkeypatch.setattr(lifetime, "db", unavailable)
    offer = f.client.get("/api/subscription/lifetime/offer").json()
    assert offer["remaining"] is None and not offer["checkout_available"]


def test_refund_only_in_14_day_window_uses_original_payment(system):
    f = system
    buy(f)
    f.session.update(status="complete", payment_status="paid")
    event(f)
    f.provider.v1.refunds.create.return_value = {"id": "re_test", "status": "succeeded"}

    def refunded(*a, **k):
        f.provider.v1.charges.retrieve.return_value.update(
            refunded=True, amount_refunded=10000
        )
        return {"id": "re_test", "status": "succeeded"}

    f.provider.v1.refunds.create.side_effect = refunded
    r = f.client.post(
        "/api/subscription/lifetime/refund",
        json={"expected_user_id": OWNER, "confirmed": True},
        headers=ORIGIN,
    )
    assert r.status_code == 200 and f.entitlement["status"] == "inactive"
    params = f.provider.v1.refunds.create.call_args
    assert params.args[0] == {"payment_intent": "pi_test"}
    assert (
        params.kwargs["options"]["idempotency_key"] == "unoword-lifetime-refund-pi_test"
    )


def test_late_refund_cannot_charge_or_refund(system):
    f = system
    buy(f)
    f.session.update(status="complete", payment_status="paid")
    event(f)
    f.provider.v1.charges.retrieve.return_value["created"] = (
        int(time.time()) - 15 * 86400
    )
    r = f.client.post(
        "/api/subscription/lifetime/refund",
        json={"expected_user_id": OWNER, "confirmed": True},
        headers=ORIGIN,
    )
    assert r.status_code == 409 and not f.provider.v1.refunds.create.called


def test_sold_out_counts_only_verified_paid_orders(system):
    f = system
    f.sold[:] = [{"slot": i + 1} for i in range(25)]
    offer = f.client.get("/api/subscription/lifetime/offer").json()
    assert (
        offer["purchased"] == 25
        and offer["remaining"] == 0
        and not offer["checkout_available"]
    )
    assert offer["refund_days"] == 14 and offer["daily_ai_limit"] > 0


def test_dispute_revokes_and_verified_win_restores(system):
    f = system
    buy(f)
    f.session.update(status="complete", payment_status="paid")
    event(f)
    f.provider.v1.charges.retrieve.return_value["disputed"] = True
    f.provider.v1.disputes.list.return_value = {
        "data": [{"status": "needs_response"}],
        "has_more": False,
    }
    assert (
        event(f, event_id="evt_dispute").status_code == 200
        and f.entitlement["status"] == "inactive"
    )
    f.provider.v1.disputes.list.return_value = {
        "data": [{"status": "won"}],
        "has_more": False,
    }
    assert (
        event(f, event_id="evt_won").status_code == 200
        and f.entitlement["status"] == "active"
    )


def test_installed_stripe_sdk_supports_used_services():
    import stripe

    c = stripe.StripeClient("sk_test_fixture")
    assert callable(c.v1.checkout.sessions.line_items.list)
    assert callable(c.v1.refunds.create)
    assert callable(c.v1.disputes.list)


def test_sandbox_lifetime_grant_cannot_unlock_live_mode(system, monkeypatch):
    from lib.ai_access import entitlement_is_active

    ent = {
        "plan": "pro",
        "status": "active",
        "billing_source": "stripe_lifetime",
        "billing_livemode": False,
        "valid_until": None,
    }
    assert entitlement_is_active(ent)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_fixture")
    assert not entitlement_is_active(ent)
