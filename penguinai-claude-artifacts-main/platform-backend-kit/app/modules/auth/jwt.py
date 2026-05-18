import uuid
from datetime import UTC, datetime, timedelta

import jwt
from jwt.exceptions import PyJWTError

from app.common.exceptions import UnauthorizedException
from app.config import get_settings

# --- Token blacklist (Redis-backed) ---

_BLACKLIST_PREFIX = "token_blacklist:"


async def blacklist_token(jti: str, ttl_seconds: int) -> None:
    """Add a token's jti to the blacklist. TTL matches the token's remaining lifetime."""
    from app.redis import get_redis

    redis = get_redis()
    await redis.set(f"{_BLACKLIST_PREFIX}{jti}", "1", ex=ttl_seconds)


async def is_token_blacklisted(jti: str) -> bool:
    """Check if a token's jti has been revoked."""
    from app.redis import get_redis

    try:
        redis = get_redis()
        return await redis.exists(f"{_BLACKLIST_PREFIX}{jti}") > 0
    except Exception:
        # If Redis is down, fail open (allow token) to avoid total outage
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create an access token with standard SaaS JWT claims.

    Payload includes:
        sub       — user ID
        email     — user email
        roles     — user roles
        permissions — fine-grained permissions
        tenant_id — SaaS tenant/organization ID
        iss       — token issuer (this platform)
        aud       — intended audience
        jti       — unique token ID (for revocation/replay protection)
        iat       — issued at
        exp       — expiration
        type      — "access"
    """
    settings = get_settings()
    to_encode = data.copy()
    now = datetime.now(UTC)
    expire = now + (expires_delta or timedelta(minutes=settings.jwt_access_token_expire_minutes))

    to_encode.update(
        {
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "jti": str(uuid.uuid4()),
            "iat": now,
            "exp": expire,
            "type": "access",
        }
    )
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(data: dict) -> str:
    """Create a refresh token with SaaS JWT claims."""
    settings = get_settings()
    to_encode = data.copy()
    now = datetime.now(UTC)
    expire = now + timedelta(days=settings.jwt_refresh_token_expire_days)

    to_encode.update(
        {
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "jti": str(uuid.uuid4()),
            "iat": now,
            "exp": expire,
            "type": "refresh",
        }
    )
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Decode and validate an access token.

    Validates: signature, expiration, issuer, audience, token type.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
        )
        if payload.get("type") != "access":
            raise UnauthorizedException("Invalid token type")
        return payload
    except PyJWTError as e:
        raise UnauthorizedException(f"Invalid token: {e}")


def decode_refresh_token(token: str) -> dict:
    """Decode and validate a refresh token.

    Validates: signature, expiration, issuer, audience, token type.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
        )
        if payload.get("type") != "refresh":
            raise UnauthorizedException("Invalid token type")
        return payload
    except PyJWTError as e:
        raise UnauthorizedException(f"Invalid refresh token: {e}")
