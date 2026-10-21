"""UnoWord admin dashboard API. Every route except /login is guarded by the
require_admin dependency (server-side session). Reuses existing Supabase tables
read-only; never exposes user writing content."""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.exceptions import HTTPException
from pydantic import BaseModel, Field

from lib.admin_auth import (
    clear_admin_cookie,
    clear_failures,
    create_token,
    hash_password,
    lock_seconds_remaining,
    record_failure,
    require_admin,
    set_admin_cookie,
    verify_password,
)
from lib import openai_config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


@contextmanager
def _db():
    conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"], connect_timeout=15)
    try:
        conn.set_session(readonly=False, autocommit=True)
        yield conn
    finally:
        conn.close()


def _one(cur, sql, params=()):
    cur.execute(sql, params)
    row = cur.fetchone()
    return row[0] if row else None


def _audit(action: str, *, email: str | None, record_id: str | None = None,
           detail: str | None = None, ip: str | None = None) -> None:
    try:
        with _db() as conn, conn.cursor() as cur:
            cur.execute(
                "insert into public.admin_audit_log (admin_email, action, record_id, detail, ip)"
                " values (%s,%s,%s,%s,%s)",
                (email, action, record_id, detail, ip),
            )
    except Exception as exc:  # audit must never break the request
        logger.warning("admin_audit_failed action=%s err=%s", action, exc)


def _seed_admin() -> None:
    email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    password = os.environ.get("ADMIN_INITIAL_PASSWORD")
    if not email or not password:
        logger.warning("admin seed skipped: ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD not set")
        return
    try:
        with _db() as conn, conn.cursor() as cur:
            cur.execute("select 1 from public.admin_users where email=%s", (email,))
            if cur.fetchone():
                return
            cur.execute(
                "insert into public.admin_users (email, password_hash) values (%s,%s)",
                (email, hash_password(password)),
            )
            logger.info("admin bootstrapped for %s", email)
    except Exception as exc:
        logger.warning("admin seed failed: %s", exc)


try:
    _seed_admin()
except Exception:  # pragma: no cover
    pass


# --------------------------------------------------------------------------- auth
class AdminLogin(BaseModel):
    email: str
    password: str


class AdminPasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=200)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")) or ""


@router.post("/login")
async def admin_login(payload: AdminLogin, request: Request, response: Response):
    email = payload.email.strip().lower()
    ip = _client_ip(request)
    locked = lock_seconds_remaining(email)
    if locked:
        _audit("login_locked", email=email, ip=ip, detail=f"{locked}s remaining")
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Too many attempts. Try again later.")
    with _db() as conn, conn.cursor() as cur:
        cur.execute("select id, password_hash from public.admin_users where email=%s", (email,))
        row = cur.fetchone()
    if not row or not verify_password(payload.password, row[1]):
        record_failure(email)
        _audit("login_failure", email=email, ip=ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    clear_failures(email)
    token = create_token(str(row[0]), email)
    set_admin_cookie(response, token)
    try:
        with _db() as conn, conn.cursor() as cur:
            cur.execute("update public.admin_users set last_login_at=now() where id=%s", (row[0],))
    except Exception:
        pass
    _audit("login_success", email=email, ip=ip)
    return {"email": email, "authenticated": True}


@router.post("/logout")
async def admin_logout(response: Response, admin=Depends(require_admin)):
    clear_admin_cookie(response)
    _audit("logout", email=admin.get("email"))
    return {"ok": True}


@router.get("/me")
async def admin_me(admin=Depends(require_admin)):
    return {"email": admin.get("email"), "authenticated": True}


@router.post("/change-password")
async def admin_change_password(payload: AdminPasswordChange, request: Request,
                                response: Response, admin=Depends(require_admin)):
    email = admin.get("email")
    with _db() as conn, conn.cursor() as cur:
        cur.execute("select id, password_hash from public.admin_users where email=%s", (email,))
        row = cur.fetchone()
    if not row or not verify_password(payload.current_password, row[1]):
        _audit("password_change_failure", email=email, ip=_client_ip(request))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            "update public.admin_users set password_hash=%s, password_changed_at=now() where id=%s",
            (hash_password(payload.new_password), row[0]),
        )
    # Re-issue the session so the current device stays signed in.
    set_admin_cookie(response, create_token(str(row[0]), email))
    _audit("password_change", email=email, ip=_client_ip(request))
    return {"ok": True}


class OpenAIKeyIn(BaseModel):
    api_key: str = Field(min_length=10, max_length=300)


@router.get("/openai-settings")
async def openai_settings(admin=Depends(require_admin)):
    return openai_config.get_status()


@router.post("/openai-key")
async def save_openai_key(payload: OpenAIKeyIn, request: Request, admin=Depends(require_admin)):
    key = payload.api_key.strip()
    if not key.startswith("sk-"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="That does not look like an OpenAI API key (expected to start with 'sk-').",
        )
    openai_config.set_openai_key(key)
    _audit("openai_key_saved", email=admin.get("email"), ip=_client_ip(request))
    return openai_config.get_status()


@router.post("/openai-test")
async def test_openai_key(request: Request, admin=Depends(require_admin)):
    ok, label, message = await openai_config.test_connection()
    tested_at = openai_config.record_test(ok) if label != "not_configured" else None
    _audit(
        "openai_key_tested", email=admin.get("email"), ip=_client_ip(request),
        detail=f"ok={ok} status={label}",
    )
    return {"ok": ok, "status": label, "message": message, "tested_at": tested_at}


@router.delete("/openai-key")
async def delete_openai_key(request: Request, admin=Depends(require_admin)):
    openai_config.remove_openai_key()
    _audit("openai_key_removed", email=admin.get("email"), ip=_client_ip(request))
    return openai_config.get_status()


# --------------------------------------------------------------------------- data
def _range_days(value: str | None) -> int | None:
    return {"7d": 7, "30d": 30, "today": 1, "all": None}.get(value or "30d", 30)


@router.get("/overview")
async def overview(range: str = "30d", admin=Depends(require_admin)):
    with _db() as conn, conn.cursor() as cur:
        total = _one(cur, "select count(*) from auth.users") or 0
        new7 = _one(cur, "select count(*) from auth.users where created_at >= now()-interval '7 days'") or 0
        new30 = _one(cur, "select count(*) from auth.users where created_at >= now()-interval '30 days'") or 0
        paid = _one(cur, "select count(distinct user_id) from public.ai_entitlements "
                         "where status='active' and coalesce(plan,'free') <> 'free'") or 0
        active30 = _one(cur,
            "select count(distinct user_id) from ("
            " select user_id from public.ai_writing_sessions where created_at >= now()-interval '30 days'"
            " union select user_id from public.ai_usage where created_at >= now()-interval '30 days'"
            ") a") or 0
        sessions = _one(cur, "select count(*) from public.ai_writing_sessions") or 0
        words = _one(cur, "select coalesce(sum(word_count),0) from public.ai_writing_sessions") or 0
        feedback = _one(cur, "select count(*) from public.ai_feedback") or 0

        cur2 = conn.cursor()
        cur2.execute("select to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, count(*) "
                     "from auth.users where created_at >= now()-interval '30 days' group by 1 order by 1")
        growth = [{"date": r[0], "value": int(r[1])} for r in cur2.fetchall()]
        cur2.execute("select to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, count(*), coalesce(sum(word_count),0) "
                     "from public.ai_writing_sessions where created_at >= now()-interval '30 days' group by 1 order by 1")
        activity = [{"date": r[0], "sessions": int(r[1]), "words": int(r[2])} for r in cur2.fetchall()]
        cur2.close()

    free = max(0, total - paid)
    conversion = round((paid / total) * 100, 1) if total else 0.0
    return {
        "range": range,
        "cards": {
            "total_users": total, "new_7d": new7, "new_30d": new30,
            "active_users_30d": active30, "free_users": free, "paid_users": paid,
            "conversion_rate": conversion, "writing_sessions": sessions,
            "total_words": int(words), "feedback": feedback,
            "revenue": None,  # Stripe revenue reporting is not implemented
        },
        "charts": {"user_growth": growth, "writing_activity": activity,
                   "accounts": [{"name": "free", "value": free}, {"name": "paid", "value": paid}]},
        "notes": {"active_users_definition": "Users with a writing session or AI request in the last 30 days.",
                  "revenue_available": False},
    }


@router.get("/users")
async def users(search: str = "", plan: str = "all", status: str = "all",
                sort: str = "created_desc", page: int = 1, page_size: int = 20,
                admin=Depends(require_admin)):
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    where, params = [], []
    if search.strip():
        where.append("(u.email ilike %s or u.id::text = %s)")
        params += [f"%{search.strip()}%", search.strip()]
    if plan == "paid":
        where.append("e.status='active' and coalesce(e.plan,'free') <> 'free'")
    elif plan == "free":
        where.append("(e.user_id is null or e.status <> 'active' or coalesce(e.plan,'free')='free')")
    if status in ("active", "inactive"):
        where.append("coalesce(e.status,'none') = %s" if status == "active" else "coalesce(e.status,'none') <> 'active'")
        if status == "active":
            params.append("active")
    clause = (" where " + " and ".join(where)) if where else ""
    order = {"created_desc": "u.created_at desc", "created_asc": "u.created_at asc",
             "email_asc": "u.email asc"}.get(sort, "u.created_at desc")
    with _db() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"select count(*) c from auth.users u left join public.ai_entitlements e on e.user_id=u.id {clause}", params)
        total = cur.fetchone()["c"]
        cur.execute(
            f"""select u.id, u.email, u.created_at, u.last_sign_in_at,
                   u.raw_user_meta_data->>'language' as language,
                   coalesce(e.plan,'free') as plan, coalesce(e.status,'none') as status,
                   (select count(*) from public.ai_writing_sessions s where s.user_id=u.id) as sessions,
                   (select coalesce(sum(word_count),0) from public.ai_writing_sessions s where s.user_id=u.id) as words
            from auth.users u left join public.ai_entitlements e on e.user_id=u.id
            {clause} order by {order} limit %s offset %s""",
            params + [page_size, (page - 1) * page_size],
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["id"] = str(r["id"])
        r["created_at"] = r["created_at"].isoformat() if r["created_at"] else None
        r["last_sign_in_at"] = r["last_sign_in_at"].isoformat() if r["last_sign_in_at"] else None
    return {"total": total, "page": page, "page_size": page_size, "users": rows}


@router.get("/users/{user_id}")
async def user_detail(user_id: str, admin=Depends(require_admin)):
    with _db() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""select u.id, u.email, u.created_at, u.last_sign_in_at,
               u.raw_user_meta_data->>'language' as language,
               coalesce(e.plan,'free') plan, coalesce(e.status,'none') status, e.valid_until,
               (select count(*) from public.ai_writing_sessions s where s.user_id=u.id) sessions,
               (select coalesce(sum(word_count),0) from public.ai_writing_sessions s where s.user_id=u.id) words,
               (select count(*) from public.ai_documents d where d.user_id=u.id) documents,
               (select count(*) from public.ai_feedback f where f.user_id=u.id) feedback
            from auth.users u left join public.ai_entitlements e on e.user_id=u.id where u.id=%s""", (user_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    row = dict(row)
    row["id"] = str(row["id"])
    for k in ("created_at", "last_sign_in_at", "valid_until"):
        row[k] = row[k].isoformat() if row.get(k) else None
    # Privacy: no writing content, drafts, or document text is ever returned.
    return row


@router.get("/subscriptions")
async def subscriptions(admin=Depends(require_admin)):
    with _db() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""select e.user_id, u.email, e.plan, e.status, e.valid_until, e.updated_at
                       from public.ai_entitlements e join auth.users u on u.id=e.user_id
                       order by e.updated_at desc nulls last limit 200""")
        rows = [dict(r) for r in cur.fetchall()]
        cur.execute("select coalesce(plan,'free') plan, count(*) from public.ai_entitlements group by 1")
        by_plan = [{"plan": r["plan"] if isinstance(r, dict) else r[0], "count": r["count"] if isinstance(r, dict) else r[1]} for r in cur.fetchall()]
    for r in rows:
        r["user_id"] = str(r["user_id"])
        for k in ("valid_until", "updated_at"):
            r[k] = r[k].isoformat() if r.get(k) else None
    return {"subscriptions": rows, "by_plan": by_plan, "revenue_available": False,
            "note": "Stripe billing is managed from the account page. Aggregated revenue reporting is not implemented."}


@router.get("/writing-activity")
async def writing_activity(range: str = "30d", admin=Depends(require_admin)):
    days = _range_days(range)
    window = f"and created_at >= now()-interval '{days} days'" if days else ""
    with _db() as conn, conn.cursor() as cur:
        sessions = _one(cur, f"select count(*) from public.ai_writing_sessions where true {window}") or 0
        words = _one(cur, f"select coalesce(sum(word_count),0) from public.ai_writing_sessions where true {window}") or 0
        avg_dur = _one(cur, f"select coalesce(round(avg(writing_duration_seconds)),0) from public.ai_writing_sessions where writing_duration_seconds is not null {window}") or 0
        cur2 = conn.cursor()
        cur2.execute(f"select to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, count(*), coalesce(sum(word_count),0) "
                     f"from public.ai_writing_sessions where true {window} group by 1 order by 1")
        daily = [{"date": r[0], "sessions": int(r[1]), "words": int(r[2])} for r in cur2.fetchall()]
        cur2.close()
    return {"range": range, "sessions": sessions, "words": int(words),
            "avg_duration_seconds": int(avg_dur), "daily": daily}


@router.get("/feedback")
async def feedback(search: str = "", page: int = 1, page_size: int = 20, admin=Depends(require_admin)):
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    where, params = [], []
    if search.strip():
        where.append("(coalesce(f.note,'') ilike %s or coalesce(f.reason,'') ilike %s or u.email ilike %s)")
        s = f"%{search.strip()}%"
        params += [s, s, s]
    clause = (" where " + " and ".join(where)) if where else ""
    with _db() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"select count(*) c from public.ai_feedback f left join auth.users u on u.id=f.user_id {clause}", params)
        total = cur.fetchone()["c"]
        cur.execute(f"""select f.id, u.email, f.helpful, f.reason, f.note, f.created_at,
               coalesce(e.plan,'free') plan
            from public.ai_feedback f left join auth.users u on u.id=f.user_id
            left join public.ai_entitlements e on e.user_id=f.user_id
            {clause} order by f.created_at desc limit %s offset %s""",
            params + [page_size, (page - 1) * page_size])
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["id"] = str(r["id"])
        r["created_at"] = r["created_at"].isoformat() if r.get("created_at") else None
    # Fields not collected by the current feedback model → surfaced as unavailable in UI.
    return {"total": total, "page": page, "page_size": page_size, "feedback": rows,
            "unavailable_fields": ["app_version", "browser", "delivery_status"]}


@router.get("/system-health")
async def system_health(admin=Depends(require_admin)):
    db_ok = False
    try:
        with _db() as conn, conn.cursor() as cur:
            cur.execute("select 1")
            db_ok = cur.fetchone()[0] == 1
    except Exception:
        db_ok = False
    ai_status = openai_config.get_status()
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "checks": {
            "database": {"status": "ok" if db_ok else "down", "available": True},
            "auth": {"status": "ok" if os.environ.get("SUPABASE_JWT_SECRET") else "unknown",
                     "available": bool(os.environ.get("SUPABASE_URL"))},
            "ai_provider": {
                "status": "connected" if ai_status["last_test_ok"]
                          else ("configured" if ai_status["configured"] else "missing"),
                "available": True,
                "model": ai_status["chat_model"],
                "source": ai_status["source"],
                "last_test_at": ai_status["last_test_at"],
            },
            "payment_webhooks": {"status": "unavailable", "available": False},
            "feedback_delivery": {"status": "unavailable", "available": False},
        },
    }


@router.get("/audit-log")
async def audit_log(page: int = 1, page_size: int = 30, admin=Depends(require_admin)):
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    with _db() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("select count(*) c from public.admin_audit_log")
        total = cur.fetchone()["c"]
        cur.execute("select admin_email, action, record_id, detail, created_at from public.admin_audit_log "
                    "order by created_at desc limit %s offset %s", (page_size, (page - 1) * page_size))
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["created_at"] = r["created_at"].isoformat() if r.get("created_at") else None
    return {"total": total, "page": page, "page_size": page_size, "entries": rows}
