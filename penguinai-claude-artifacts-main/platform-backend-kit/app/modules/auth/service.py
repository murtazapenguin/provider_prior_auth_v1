from datetime import UTC, datetime
from typing import Optional

from fastapi import Request
from loguru import logger

from app.common.audit import audit_log
from app.common.exceptions import UnauthorizedException
from app.config import get_settings
from app.modules.auth.jwt import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from app.modules.auth.models import User
from app.modules.auth.providers.factory import get_auth_provider
from app.modules.auth.rbac import resolve_permissions
from app.modules.auth.schemas import AuthCallbackData, TokenResponse
from app.modules.auth.tenant_model import Tenant


def _build_token_data(user: User) -> dict:
    """Build the JWT payload data from a User document.

    This is the single place that defines what goes into the token.
    Permissions are resolved from roles + any directly-assigned extras.
    """
    return {
        "sub": str(user.id),
        "email": user.email,
        "tenant_id": user.tenant_id,
        "roles": user.roles,
        "permissions": resolve_permissions(user.roles, user.permissions),
    }


class AuthService:
    @staticmethod
    async def initiate_login(provider_name: str, redirect_url: Optional[str] = None) -> str:
        provider = get_auth_provider(provider_name)
        return await provider.get_login_url(redirect_url)

    @staticmethod
    async def handle_callback(provider_name: str, request: Request) -> TokenResponse:
        client_ip = request.client.host if request.client else None
        provider = get_auth_provider(provider_name)
        callback_data: AuthCallbackData = await provider.handle_callback(request)

        # Extract tenant_id from provider claims if available
        tenant_id = callback_data.tenant_id
        if not tenant_id and callback_data.raw_claims:
            # Microsoft: tid claim is the Azure AD tenant ID
            # SAML: may come as organizationId or tenantId attribute
            tenant_id = (
                callback_data.raw_claims.get("tid")
                or callback_data.raw_claims.get("tenantId")
                or callback_data.raw_claims.get("organizationId")
            )

        user = await User.find_one(User.email == callback_data.email)
        if user is None:
            user = User(
                email=callback_data.email,
                display_name=callback_data.display_name,
                provider=callback_data.provider,
                provider_user_id=callback_data.provider_user_id,
                tenant_id=tenant_id,
                avatar_url=callback_data.avatar_url,
            )
            await user.insert()
        else:
            user.display_name = callback_data.display_name
            user.provider_user_id = callback_data.provider_user_id
            user.last_login = datetime.now(UTC).isoformat()
            if tenant_id and not user.tenant_id:
                user.tenant_id = tenant_id
            if callback_data.avatar_url:
                user.avatar_url = callback_data.avatar_url
            await user.save()

        # Auto-provision Tenant record if it doesn't exist yet
        if tenant_id:
            existing_tenant = await Tenant.find_one(Tenant.tenant_id == tenant_id)
            if not existing_tenant:
                tenant = Tenant(
                    tenant_id=tenant_id,
                    name=tenant_id,  # Default name; can be updated later
                )
                await tenant.insert()
                logger.info("Auto-provisioned tenant {}", tenant_id)

                # First user in a new tenant becomes the owner
                if "owner" not in user.roles:
                    user.roles = ["owner", "user"]
                    await user.save()

                audit_log(
                    action="tenant.provisioned",
                    actor_id=str(user.id),
                    tenant_id=tenant_id,
                    resource_type="tenant",
                    resource_id=tenant_id,
                    ip_address=client_ip,
                )

        audit_log(
            action="user.login",
            actor_id=str(user.id),
            tenant_id=user.tenant_id,
            resource_type="user",
            resource_id=str(user.id),
            details={"provider": provider_name, "email": user.email},
            ip_address=client_ip,
        )

        token_data = _build_token_data(user)
        settings = get_settings()

        return TokenResponse(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
            expires_in=settings.jwt_access_token_expire_minutes * 60,
        )

    @staticmethod
    async def refresh_tokens(refresh_token_str: str) -> TokenResponse:
        payload = decode_refresh_token(refresh_token_str)
        user_id = payload.get("sub")
        user = await User.get(user_id)
        if not user or not user.is_active:
            raise UnauthorizedException("User not found or inactive")

        token_data = _build_token_data(user)
        settings = get_settings()

        return TokenResponse(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
            expires_in=settings.jwt_access_token_expire_minutes * 60,
        )

    @staticmethod
    async def get_logout_url(provider_name: str) -> Optional[str]:
        provider = get_auth_provider(provider_name)
        return await provider.get_logout_url()
