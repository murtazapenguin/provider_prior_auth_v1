from typing import Optional

from fastapi import Request
from saml2 import BINDING_HTTP_POST, BINDING_HTTP_REDIRECT
from saml2.client import Saml2Client
from saml2.config import Config as Saml2Config

from app.common.exceptions import UnauthorizedException
from app.config import get_settings
from app.modules.auth.providers.base import AuthProvider
from app.modules.auth.schemas import AuthCallbackData


class SAMLAuthProvider(AuthProvider):
    def __init__(self):
        settings = get_settings()
        saml_settings = {
            "entityid": settings.saml_sp_entity_id,
            "service": {
                "sp": {
                    "name": settings.app_name,
                    "endpoints": {
                        "assertion_consumer_service": [
                            (settings.saml_sp_acs_url, BINDING_HTTP_POST),
                        ],
                    },
                    "allow_unsolicited": True,
                    "authn_requests_signed": False,
                    "want_assertions_signed": True,
                },
            },
            "metadata": {
                "remote": [{"url": settings.saml_idp_metadata_url}]
                if settings.saml_idp_metadata_url
                else [],
            },
        }
        config = Saml2Config()
        config.load(saml_settings)
        self._client = Saml2Client(config=config)

    async def get_login_url(self, redirect_url: Optional[str] = None) -> str:
        reqid, info = self._client.prepare_for_authenticate(
            relay_state=redirect_url or "",
            binding=BINDING_HTTP_REDIRECT,
        )
        for header_name, header_value in info["headers"]:
            if header_name == "Location":
                return header_value
        raise UnauthorizedException("Failed to generate SAML login URL")

    async def handle_callback(self, request: Request) -> AuthCallbackData:
        form_data = await request.form()
        saml_response = form_data.get("SAMLResponse")
        if not saml_response:
            raise UnauthorizedException("No SAMLResponse in callback")

        authn_response = self._client.parse_authn_request_response(
            saml_response,
            BINDING_HTTP_POST,
        )
        if authn_response is None:
            raise UnauthorizedException("Invalid SAML response")

        identity = authn_response.get_identity()
        name_id = str(authn_response.get_subject().text)

        email = (identity.get("email") or identity.get("emailAddress") or [""])[0]
        display_name = (identity.get("displayName") or identity.get("cn") or [""])[0]

        return AuthCallbackData(
            email=email,
            display_name=display_name or email,
            provider="saml",
            provider_user_id=name_id,
            raw_claims=dict(identity),
        )
