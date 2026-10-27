"""Public Supabase signup: email ownership is confirmed by the provider, not admin."""

import hashlib
from typing import Literal
from urllib.parse import urlencode
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from lib.browser_auth import (
    DESTINATIONS,
    app_origin,
    private,
    issue_flow,
    read_flow,
    clear_flow,
    verified_code_session,
)
from lib.request_security import limit_sensitive
from lib.supabase_client import auth_request, SupabaseAPIError
from models.auth import AuthCredentials, AuthResult, AuthUser
from routers.auth import EMAIL_SIGNUP_COOKIE, _set_session_cookies

router = APIRouter(prefix="/auth/signup", tags=["auth"])
TTL = 3600


class Signup(AuthCredentials):
    model_config = ConfigDict(extra="forbid")
    intent: Literal["account", "pro", "lifetime", "editor"] = "account"


class Complete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: SecretStr = Field(min_length=1, max_length=4096)


@router.post("", response_model=AuthResult, status_code=status.HTTP_201_CREATED)
async def signup(payload: Signup, request: Request, response: Response):
    limit_sensitive(
        "signup:" + (request.client.host if request.client else "unknown"),
        maximum=5,
        seconds=300,
    )
    email_key = hashlib.sha256(str(payload.email).lower().encode()).hexdigest()
    limit_sensitive("signup-email:" + email_key, maximum=1, seconds=60)
    try:
        settings = await auth_request("GET", "settings")
    except SupabaseAPIError:
        raise HTTPException(503, "email_signup_unavailable")
    if (
        not isinstance(settings, dict)
        or settings.get("mailer_autoconfirm") is not False
    ):
        raise HTTPException(503, "email_confirmation_not_configured")
    # The exact Site URL is already allowed by Supabase. Its confirmation email
    # verifies ownership, then returns a PKCE code instead of access tokens.
    redirect = app_origin() + "/"
    _nonce, challenge = issue_flow(response, EMAIL_SIGNUP_COOKIE, payload.intent, TTL)
    try:
        data = await auth_request(
            "POST",
            "signup?" + urlencode({"redirect_to": redirect}),
            json={
                "email": str(payload.email),
                "password": payload.password,
                "code_challenge": challenge,
                "code_challenge_method": "s256",
            },
        )
    except SupabaseAPIError as error:
        detail = (error.detail or "").lower()
        if error.response_status == 429:
            raise HTTPException(429, "security_rate_limited")
        if not (
            error.response_status in {400, 422}
            and any(w in detail for w in ("already", "registered", "exist"))
        ):
            if "weak" in detail or "password" in detail:
                raise HTTPException(422, "password_policy_rejected")
            raise HTTPException(503, "email_signup_unavailable")
        data = None
    if isinstance(data, dict) and data.get("access_token"):
        # Refuse an unexpected auto-confirmed session even if provider settings
        # changed between the configuration check and the signup request.
        raise HTTPException(503, "email_confirmation_not_configured")
    private(response)
    # Identical response for an existing address; no account lookup or login.
    return AuthResult(
        user=AuthUser(id="pending-confirmation", email=str(payload.email)),
        authenticated=False,
        message="Check your email to confirm your account, then return to sign in. If you already have an account, sign in instead.",
    )


@router.post("/complete")
async def complete(payload: Complete, request: Request, response: Response):
    limit_sensitive(
        "signup-verify:" + (request.client.host if request.client else "unknown"),
        maximum=15,
        seconds=300,
    )
    try:
        saved = read_flow(request, EMAIL_SIGNUP_COOKIE, TTL)
        session, identity = await verified_code_session(
            auth_request, payload.code.get_secret_value(), saved["verifier"]
        )
        if not identity.get("email_confirmed_at"):
            raise ValueError("email_not_verified")
    except (SupabaseAPIError, ValueError, TypeError, KeyError):
        result = private(
            JSONResponse({"detail": "signup_verification_failed"}, status_code=400)
        )
        clear_flow(result, EMAIL_SIGNUP_COOKIE)
        return result
    _set_session_cookies(response, session)
    clear_flow(response, EMAIL_SIGNUP_COOKIE)
    private(response)
    return {"redirect": DESTINATIONS[saved["intent"]]}
