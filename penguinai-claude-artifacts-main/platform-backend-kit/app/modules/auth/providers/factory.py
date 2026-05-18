from app.common.exceptions import BadRequestException
from app.modules.auth.constants import PROVIDER_MICROSOFT, PROVIDER_SAML
from app.modules.auth.providers.base import AuthProvider
from app.modules.auth.providers.microsoft import MicrosoftAuthProvider
from app.modules.auth.providers.saml import SAMLAuthProvider

_providers: dict[str, type[AuthProvider]] = {
    PROVIDER_MICROSOFT: MicrosoftAuthProvider,
    PROVIDER_SAML: SAMLAuthProvider,
}

_instances: dict[str, AuthProvider] = {}


def get_auth_provider(provider_name: str) -> AuthProvider:
    if provider_name not in _providers:
        raise BadRequestException(f"Unsupported auth provider: {provider_name}")

    if provider_name not in _instances:
        _instances[provider_name] = _providers[provider_name]()

    return _instances[provider_name]


def register_provider(name: str, provider_class: type[AuthProvider]) -> None:
    _providers[name] = provider_class
