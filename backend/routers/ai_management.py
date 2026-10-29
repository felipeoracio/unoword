"""Admin-only allowance publishing and content-free AI cost monitoring."""

from datetime import datetime, timezone
from uuid import UUID
from decimal import Decimal
import json
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator, ConfigDict
from lib.admin_auth import require_admin
from lib.ai_quota import rpc
from routers.admin import _db

router = APIRouter(
    prefix="/admin/ai", tags=["admin-ai"], dependencies=[Depends(require_admin)]
)


def serial(value):
    if isinstance(value, (datetime, UUID)):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError()


def query(sql, params=()):
    import psycopg2.extras

    with _db() as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(sql, params)
        return json.loads(json.dumps([dict(r) for r in cur.fetchall()], default=serial))


class ProposedLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    suggestions_daily: int = Field(default=10, ge=1, le=100000)
    suggestions_monthly: int = Field(default=200, ge=1, le=1000000)
    guidance_monthly: int = Field(default=30, ge=1, le=1000000)
    cost_target: Decimal = Field(default=Decimal("2"), gt=0, le=10000, decimal_places=2)
    warning_percent: int = Field(default=80, ge=1, le=100)

    @field_validator("name")
    @classmethod
    def meaningful_name(cls, value):
        if not value.strip():
            raise ValueError("Enter a configuration name")
        return value.strip()


@router.get("/limits")
async def limits(response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return {
        "versions": query(
            "select * from public.ai_allowance_versions order by created_at desc"
        ),
        "releases": query(
            "select * from public.ai_allowance_releases order by effective_at desc"
        ),
        "assignments": query(
            "select version_id,count(*) as subscribers from public.ai_allowance_assignments group by version_id"
        ),
        "audit": query(
            "select * from public.ai_allowance_audit order by created_at desc limit 200"
        ),
        "prices": query(
            "select * from public.ai_model_prices order by effective_at desc limit 100"
        ),
    }


@router.post("/limits/preview")
async def preview(payload: ProposedLimits):
    protected = query("select count(*) as total from public.ai_allowance_assignments")[
        0
    ]["total"]
    return {
        "proposed": payload.model_dump(mode="json"),
        "protected_accounts": protected,
        "applies_to": "Future subscribers only, after publication. Existing assignments are never modified.",
        "public_terms": f"{payload.suggestions_daily} suggestions/day; {payload.suggestions_monthly} suggestions/calendar month; {payload.guidance_monthly} Writing Guidance requests/calendar month. No rollover. Monthly Pro and Lifetime have identical limits.",
    }


@router.post("/limits")
async def save(payload: ProposedLimits, admin=Depends(require_admin)):
    vid = await rpc(
        "ai_admin_create_version",
        {
            "p_admin": admin["sub"],
            "p_name": payload.name,
            "p_daily": payload.suggestions_daily,
            "p_monthly": payload.suggestions_monthly,
            "p_guidance": payload.guidance_monthly,
            "p_target": str(payload.cost_target),
            "p_warning": payload.warning_percent,
        },
    )
    return {"id": vid, "published": False}


class Publish(BaseModel):
    version_id: UUID
    effective_at: datetime
    reviewed_terms: bool = False

    @field_validator("effective_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None:
            raise ValueError("Timezone is required")
        return value


@router.post("/limits/publish")
async def publish(payload: Publish, admin=Depends(require_admin)):
    if not payload.reviewed_terms:
        raise HTTPException(422, "review_public_terms_before_publication")
    if payload.effective_at < datetime.now(timezone.utc):
        raise HTTPException(422, "publication_must_be_in_future")
    await rpc(
        "ai_admin_publish_version",
        {
            "p_admin": admin["sub"],
            "p_version": str(payload.version_id),
            "p_effective": payload.effective_at.isoformat(),
        },
    )
    return {"scheduled": True, "existing_subscribers_changed": False}


class ModelPrice(BaseModel):
    model: str = Field(min_length=1, max_length=100)
    input_per_million: Decimal = Field(ge=0, le=10000, decimal_places=6)
    cached_input_per_million: Decimal = Field(ge=0, le=10000, decimal_places=6)
    output_per_million: Decimal = Field(ge=0, le=10000, decimal_places=6)
    source_url: str = Field(
        pattern=r"^https://(?:developers\.openai\.com|platform\.openai\.com|openai\.com)/",
        max_length=300,
    )


@router.post("/model-prices")
async def model_price(payload: ModelPrice, admin=Depends(require_admin)):
    # Price and its audit record commit together. Old event prices remain intact.
    with _db() as conn:
        conn.autocommit = False
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "insert into public.ai_model_prices(model,input_per_million,cached_input_per_million,output_per_million,source_url,created_by) values(%s,%s,%s,%s,%s,%s) returning id",
                    (
                        payload.model,
                        payload.input_per_million,
                        payload.cached_input_per_million,
                        payload.output_per_million,
                        payload.source_url,
                        admin["sub"],
                    ),
                )
                price_id = str(cur.fetchone()[0])
                cur.execute(
                    "insert into public.ai_allowance_audit(admin_id,action,detail) values(%s,'model_price_added',%s::jsonb)",
                    (
                        admin["sub"],
                        json.dumps(
                            {"price_id": price_id, **payload.model_dump(mode="json")}
                        ),
                    ),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return {"id": price_id}


@router.get("/analytics")
async def analytics(response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    # Analytics uses UTC for comparable admin reports; customer quotas use their
    # own pinned timezone. Null means unknown cost, not zero spend.
    window = (
        "created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'"
    )
    totals = query(f"""select count(*) as calls, sum(estimated_cost) as estimated_spend,
      count(*) filter(where estimated_cost is null) as unpriced_calls,
      coalesce(sum(input_tokens),0) as input_tokens,coalesce(sum(output_tokens),0) as output_tokens
      from public.ai_cost_events where {window}""")[0]
    subscribers = query(
        "select count(*) as n from public.ai_entitlements where plan in ('pro','premium') and status in ('active','trialing') and (valid_until is null or valid_until>=now())"
    )[0]["n"]
    totals["active_pro_accounts"] = subscribers
    totals["average_per_active_pro_account"] = (
        totals["estimated_spend"] / subscribers
        if subscribers and totals["estimated_spend"] is not None
        else None
    )
    grouped = lambda field: query(
        f"select {field},count(*) as calls,sum(estimated_cost) as estimated_cost,count(*) filter(where estimated_cost is null) as unpriced_calls from public.ai_cost_events where {window} group by {field} order by estimated_cost desc nulls last limit 50"
    )
    targets = query(
        f"""select e.user_id,v.cost_target,sum(e.estimated_cost) as cost from public.ai_cost_events e
      join public.ai_allowance_assignments a on a.user_id=e.user_id join public.ai_allowance_versions v on v.id=a.version_id
      where e.{window} group by e.user_id,v.cost_target having sum(e.estimated_cost)>v.cost_target order by cost desc limit 50"""
    )
    return {
        "month": "UTC calendar month",
        "totals": totals,
        "by_feature": grouped("feature"),
        "by_model": grouped("model"),
        "highest_usage": grouped("user_id"),
        "by_status": grouped("status"),
        "above_cost_target": targets,
        "trends": query(
            f"select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as date,count(*) as calls,sum(estimated_cost) as estimated_cost from public.ai_cost_events where {window} group by 1 order by 1"
        ),
        "note": "Estimated API cost from recorded tokens and versioned model prices; not a Stripe charge or an allowance cap. Historical pre-migration estimates are excluded. Unknown prices and failed calls without reported tokens remain unpriced.",
    }
