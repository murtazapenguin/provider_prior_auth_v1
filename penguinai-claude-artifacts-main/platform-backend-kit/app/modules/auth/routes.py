from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import RedirectResponse

from app.common.audit import audit_log
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.jwt import blacklist_token
from app.modules.auth.schemas import (
    LoginRequest,
    RefreshTokenRequest,
    TokenResponse,
    UserResponse,
)
from app.modules.auth.service import AuthService

router = APIRouter()


@router.post("/login", summary="Initiate SSO login")
async def login(body: LoginRequest):
    login_url = await AuthService.initiate_login(body.provider, body.redirect_url)
    return {"login_url": login_url}


@router.get("/login/{provider}", summary="Redirect to SSO provider")
async def login_redirect(provider: str, redirect_url: Optional[str] = Query(None)):
    login_url = await AuthService.initiate_login(provider, redirect_url)
    return RedirectResponse(url=login_url)


@router.get("/callback/{provider}", summary="SSO callback (GET)", response_model=TokenResponse)
async def auth_callback(provider: str, request: Request):
    return await AuthService.handle_callback(provider, request)


@router.post("/callback/{provider}", summary="SSO callback (POST)", response_model=TokenResponse)
async def auth_callback_post(provider: str, request: Request):
    return await AuthService.handle_callback(provider, request)


@router.post("/refresh", summary="Refresh access token", response_model=TokenResponse)
async def refresh_token(body: RefreshTokenRequest):
    return await AuthService.refresh_tokens(body.refresh_token)


@router.post("/logout", summary="Logout and revoke token")
async def logout(request: Request, user: CurrentUser):
    # Blacklist the current access token so it can't be reused
    user_payload = getattr(request.state, "user", None)
    if isinstance(user_payload, dict):
        jti = user_payload.get("jti")
        exp = user_payload.get("exp")
        if jti and exp:
            import time

            remaining = max(int(exp - time.time()), 0)
            if remaining > 0:
                await blacklist_token(jti, ttl_seconds=remaining)

    audit_log(
        action="user.logout",
        actor_id=str(user.id),
        tenant_id=user.tenant_id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
    )

    logout_url = await AuthService.get_logout_url(user.provider)
    return {"message": "Logged out successfully", "provider_logout_url": logout_url}


@router.get("/me", summary="Get current user profile", response_model=UserResponse)
async def get_current_user_profile(user: CurrentUser):
    return UserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        provider=user.provider,
        tenant_id=user.tenant_id,
        roles=user.roles,
        permissions=user.permissions,
        avatar_url=user.avatar_url,
        is_active=user.is_active,
    )
