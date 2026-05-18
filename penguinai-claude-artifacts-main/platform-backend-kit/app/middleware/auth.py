from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.logging_config import user_id_ctx

EXEMPT_PATHS = {"/health", "/readiness", "/docs", "/redoc", "/openapi.json", "/metrics", "/scalar"}


class JWTSessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.user = None

        path = request.url.path
        if any(path.startswith(exempt) for exempt in EXEMPT_PATHS):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                from app.modules.auth.jwt import decode_access_token, is_token_blacklisted

                payload = decode_access_token(token)

                # Check if token has been revoked (logout)
                jti = payload.get("jti")
                if jti and await is_token_blacklisted(jti):
                    logger.debug("Blacklisted token used: jti={}", jti)
                else:
                    request.state.user = payload

                    # Bind user_id to loguru context for downstream logging
                    uid = payload.get("sub", "-")
                    user_id_ctx.set(uid)
            except Exception as e:
                logger.debug("JWT decode failed: {}", e)

        return await call_next(request)
