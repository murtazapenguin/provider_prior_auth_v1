from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings
from app.redis import get_redis

# Paths exempt from rate limiting
RATE_LIMIT_EXEMPT_PATHS = {"/health", "/readiness", "/metrics", "/docs", "/redoc", "/openapi.json", "/scalar"}

# Auth-sensitive paths get stricter limits (max 10 per window)
_AUTH_SENSITIVE_SUFFIXES = {"/auth/login", "/auth/refresh", "/auth/callback"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window rate limiter using Redis.

    Limits are per-IP for unauthenticated requests and per-user for
    authenticated requests. Tenant-level quotas can be layered on top.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if path in RATE_LIMIT_EXEMPT_PATHS:
            return await call_next(request)

        settings = get_settings()

        # Determine the rate-limit key: prefer user_id, fall back to IP
        user_payload = getattr(request.state, "user", None)
        if isinstance(user_payload, dict) and user_payload.get("sub"):
            identifier = f"user:{user_payload['sub']}"
            max_requests = settings.rate_limit_authenticated
        else:
            identifier = f"ip:{request.client.host}" if request.client else "ip:unknown"
            max_requests = settings.rate_limit_anonymous

        # Apply stricter limits to auth-sensitive endpoints
        if any(path.endswith(suffix) for suffix in _AUTH_SENSITIVE_SUFFIXES):
            max_requests = min(max_requests, 10)

        window = settings.rate_limit_window_seconds
        redis_key = f"ratelimit:{identifier}"

        try:
            redis = get_redis()
            pipe = redis.pipeline()
            pipe.incr(redis_key)
            pipe.expire(redis_key, window, nx=True)
            results = await pipe.execute()
            current_count = results[0]
        except Exception:
            # If Redis is down, allow the request through (fail open)
            return await call_next(request)

        # Set rate limit headers
        response: Response
        if current_count > max_requests:
            response = JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Too many requests. Please retry later.",
                    }
                },
            )
        else:
            response = await call_next(request)

        response.headers["X-RateLimit-Limit"] = str(max_requests)
        response.headers["X-RateLimit-Remaining"] = str(max(0, max_requests - current_count))
        response.headers["X-RateLimit-Window"] = str(window)
        return response
