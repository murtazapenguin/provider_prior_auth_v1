import pytest
from unittest.mock import patch

from app.common.exceptions import UnauthorizedException


@pytest.fixture(autouse=True)
def _patch_settings(mock_settings):
    with patch("app.config.get_settings", return_value=mock_settings):
        yield


def test_create_and_decode_access_token():
    from app.modules.auth.jwt import create_access_token, decode_access_token

    data = {
        "sub": "user-123",
        "email": "test@example.com",
        "tenant_id": "tenant-abc",
        "roles": ["user"],
        "permissions": ["files:read"],
    }
    token = create_access_token(data)
    payload = decode_access_token(token)

    assert payload["sub"] == "user-123"
    assert payload["email"] == "test@example.com"
    assert payload["tenant_id"] == "tenant-abc"
    assert payload["roles"] == ["user"]
    assert payload["permissions"] == ["files:read"]
    assert payload["type"] == "access"


def test_access_token_has_saas_claims():
    from app.modules.auth.jwt import create_access_token, decode_access_token

    data = {"sub": "user-123", "email": "test@example.com", "tenant_id": None, "roles": [], "permissions": []}
    token = create_access_token(data)
    payload = decode_access_token(token)

    # Standard JWT claims
    assert payload["iss"] == "platform-backend-kit"
    assert payload["aud"] == "platform-backend-kit"
    assert "jti" in payload  # unique token ID
    assert "iat" in payload  # issued at
    assert "exp" in payload  # expiration


def test_create_and_decode_refresh_token():
    from app.modules.auth.jwt import create_refresh_token, decode_refresh_token

    data = {"sub": "user-123", "email": "test@example.com", "tenant_id": "t-1", "roles": [], "permissions": []}
    token = create_refresh_token(data)
    payload = decode_refresh_token(token)

    assert payload["sub"] == "user-123"
    assert payload["type"] == "refresh"
    assert payload["iss"] == "platform-backend-kit"
    assert "jti" in payload


def test_decode_access_token_rejects_refresh_token():
    from app.modules.auth.jwt import create_refresh_token, decode_access_token

    token = create_refresh_token({"sub": "user-123"})
    with pytest.raises(UnauthorizedException):
        decode_access_token(token)


def test_decode_invalid_token():
    from app.modules.auth.jwt import decode_access_token

    with pytest.raises(UnauthorizedException):
        decode_access_token("invalid-token")


def test_decode_rejects_wrong_issuer(mock_settings):
    from jose import jwt as jose_jwt

    # Create a token with wrong issuer
    token = jose_jwt.encode(
        {"sub": "user-123", "type": "access", "iss": "wrong-issuer", "aud": mock_settings.jwt_audience},
        mock_settings.jwt_secret_key,
        algorithm=mock_settings.jwt_algorithm,
    )
    from app.modules.auth.jwt import decode_access_token

    with pytest.raises(UnauthorizedException):
        decode_access_token(token)


def test_decode_rejects_wrong_audience(mock_settings):
    from jose import jwt as jose_jwt

    token = jose_jwt.encode(
        {"sub": "user-123", "type": "access", "iss": mock_settings.jwt_issuer, "aud": "wrong-audience"},
        mock_settings.jwt_secret_key,
        algorithm=mock_settings.jwt_algorithm,
    )
    from app.modules.auth.jwt import decode_access_token

    with pytest.raises(UnauthorizedException):
        decode_access_token(token)
