import uuid
from typing import Optional

import msal
from fastapi import Request

from app.common.cache import CacheService
from app.common.exceptions import UnauthorizedException
from app.config import get_settings
from app.modules.auth.providers.base import AuthProvider
from app.modules.auth.schemas import AuthCallbackData


class MicrosoftAuthProvider(AuthProvider):
    def __init__(self):
        settings = get_settings()
        self._client_id = settings.msal_client_id
        self._authority = settings.msal_authority.format(tenant_id=settings.msal_tenant_id)
        self._redirect_uri = settings.msal_redirect_uri
        self._scopes = [s.strip() for s in settings.msal_scopes.split(",")]

        self._msal_app = msal.ConfidentialClientApplication(
            client_id=self._client_id,
            client_credential=settings.msal_client_secret,
            authority=self._authority,
        )

    async def get_login_url(self, redirect_url: Optional[str] = None) -> str:
        state_id = uuid.uuid4().hex
        flow = self._msal_app.initiate_auth_code_flow(
            scopes=self._scopes,
            redirect_uri=self._redirect_uri,
            state=state_id,
        )
        flow_data = {**flow, "_redirect_url": redirect_url or ""}
        await CacheService.set_json(f"msal_flow:{state_id}", flow_data, ttl=600)
        return flow["auth_uri"]

    async def handle_callback(self, request: Request) -> AuthCallbackData:
        params = dict(request.query_params)
        state = params.get("state", "")

        flow = await CacheService.get_json(f"msal_flow:{state}")
        if not flow:
            raise UnauthorizedException("Invalid or expired auth flow")

        # Extract and remove the stored redirect URL before passing to MSAL
        _redirect_url = flow.pop("_redirect_url", "")

        result = self._msal_app.acquire_token_by_auth_code_flow(
            auth_code_flow=flow,
            auth_response=params,
        )

        if "error" in result:
            raise UnauthorizedException(
                f"MSAL error: {result.get('error_description', result['error'])}"
            )

        id_claims = result.get("id_token_claims", {})

        return AuthCallbackData(
            email=id_claims.get("preferred_username") or id_claims.get("email", ""),
            display_name=id_claims.get("name", ""),
            provider="microsoft",
            provider_user_id=id_claims.get("oid", id_claims.get("sub", "")),
            avatar_url=None,
            raw_claims=id_claims,
        )

    async def get_logout_url(self) -> Optional[str]:
        return f"{self._authority}/oauth2/v2.0/logout"
