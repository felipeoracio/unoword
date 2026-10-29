"""Supabase Auth proxy using httpOnly cookies for browser sessions."""

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status

from lib.auth import AuthenticatedUser, require_user
from lib.ai_access import entitlement_is_active, get_entitlement
from lib.plans import plan_features
from lib.supabase_client import SupabaseAPIError, auth_request, raise_http
from models.auth import AuthCredentials, AuthResult, AuthUser
from lib.request_security import limit_sensitive
from lib.browser_auth import clear_flow

router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_COOKIE = "uno_session"
REFRESH_COOKIE = "uno_refresh"
GOOGLE_OAUTH_COOKIE = "__Host-uno_google_oauth"
EMAIL_SIGNUP_COOKIE = "__Host-uno_email_signup"


def _set_session_cookies(response: Response, session: dict) -> None:
    access_token = session.get("access_token")
    refresh_token = session.get("refresh_token")
    expires_in = max(60, int(session.get("expires_in") or 3600))
    if access_token:
        response.set_cookie(
            ACCESS_COOKIE,
            access_token,
            max_age=expires_in,
            httponly=True,
            secure=True,
            samesite="none",
            path="/",
        )
    if refresh_token:
        response.set_cookie(
            REFRESH_COOKIE,
            refresh_token,
            max_age=60 * 60 * 24 * 30,
            httponly=True,
            secure=True,
            samesite="none",
            path="/api/auth",
        )


def _result(data: dict, fallback_email: str) -> AuthResult:
    user = data.get("user") or {}
    authenticated = bool(data.get("access_token"))
    return AuthResult(
        user=AuthUser(
            id=str(user.get("id") or "pending-confirmation"),
            email=user.get("email") or fallback_email,
            plan=None,
            ai_access=False,
        ),
        authenticated=authenticated,
        message=(
            "Signed in."
            if authenticated
            else "Check your email to confirm your account."
        ),
    )


async def _password_grant(email: str, password: str) -> dict:
    return await auth_request(
        "POST", "token?grant_type=password", json={"email": email, "password": password}
    )


@router.post("/login", response_model=AuthResult)
async def login(
    payload: AuthCredentials, response: Response, request: Request
) -> AuthResult:
    limit_sensitive(
        "login:" + (request.client.host if request.client else "unknown"),
        maximum=20,
        seconds=300,
    )
    try:
        data = await _password_grant(payload.email, payload.password)
    except SupabaseAPIError as error:
        if "confirm" in (error.detail or "").lower():
            raise HTTPException(403, "email_confirmation_required")
        # Normalize Supabase's native 400 for bad credentials to a REST-correct 401.
        if (
            error.response_status == 400
            and "invalid login credentials" in (error.detail or "").lower()
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail=error.detail
            )
        raise_http(error)
    _set_session_cookies(response, data)
    return _result(data, payload.email)


@router.post("/refresh", response_model=AuthResult)
async def refresh_session(
    response: Response, uno_refresh: str | None = Cookie(default=None)
) -> AuthResult:
    if not uno_refresh:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh session required"
        )
    try:
        data = await auth_request(
            "POST",
            "token?grant_type=refresh_token",
            json={"refresh_token": uno_refresh},
        )
    except SupabaseAPIError as error:
        raise_http(error)
    _set_session_cookies(response, data)
    return _result(data, "")


@router.get("/me", response_model=AuthUser)
async def me(user: AuthenticatedUser = Depends(require_user)) -> AuthUser:
    try:
        identity = await auth_request("GET", "user", access_token=user.access_token)
    except SupabaseAPIError as error:
        if error.response_status in {401, 403}:
            raise HTTPException(401, "session_expired")
        raise_http(error)
    if str(identity.get("id")) != user.id:
        raise HTTPException(401, "session_expired")
    entitlement = await get_entitlement(user.id)
    return AuthUser(
        id=user.id,
        email=identity.get("email"),
        plan=entitlement.get("plan") if entitlement else None,
        ai_access=entitlement_is_active(entitlement),
        features=plan_features("pro" if entitlement_is_active(entitlement) else "free"),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response, uno_session: str | None = Cookie(default=None)
) -> None:
    if uno_session:
        try:
            await auth_request("POST", "logout", access_token=uno_session)
        except SupabaseAPIError:
            pass
    clear_flow(response, GOOGLE_OAUTH_COOKIE)
    clear_flow(response, EMAIL_SIGNUP_COOKIE)
    response.delete_cookie(ACCESS_COOKIE, path="/", secure=True, samesite="none")
    response.delete_cookie(
        REFRESH_COOKIE, path="/api/auth", secure=True, samesite="none"
    )
