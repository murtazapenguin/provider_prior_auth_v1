from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.common.cache import CacheService
from app.tenant import TenantContext, get_tenant_manager, set_tenant_ctx

# Paths that don't require tenant context
TENANT_EXEMPT_PATHS = {
    "/health",
    "/readiness",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/metrics",
}

# Auth endpoints that run before tenant context is available
TENANT_EXEMPT_PREFIXES = (
    "/api/v1/auth/login",
    "/api/v1/auth/callback",
    "/api/v1/auth/refresh",
)


class TenantContextMiddleware(BaseHTTPMiddleware):
    """Resolve tenant context from JWT and set per-request contextvar.

    Runs after JWTSessionMiddleware so request.state.user is populated.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Skip for exempt paths
        if path in TENANT_EXEMPT_PATHS or path.startswith(TENANT_EXEMPT_PREFIXES):
            return await call_next(request)

        user_payload = getattr(request.state, "user", None)
        if user_payload is None:
            # No authenticated user — let the auth dependency handle 401
            return await call_next(request)

        tenant_id = user_payload.get("tenant_id")
        if not tenant_id:
            # User has no tenant — let route-level deps handle this if required
            return await call_next(request)

        manager = get_tenant_manager()

        # Resolve tenant (check cache first, then DB)
        tenant_data = await CacheService.get_json(f"tenant:{tenant_id}")
        if not tenant_data:
            from app.modules.auth.tenant_model import Tenant

            tenant = await Tenant.find_one(Tenant.tenant_id == tenant_id)
            if tenant and tenant.is_active:
                tenant_data = {
                    "tenant_id": tenant.tenant_id,
                    "s3_bucket_override": tenant.s3_bucket_name,
                    "db_name_override": tenant.db_name,
                }
                await CacheService.set_json(f"tenant:{tenant_id}", tenant_data, ttl=300)
            else:
                logger.warning("Tenant {} not found or inactive", tenant_id)
                return await call_next(request)

        # Build tenant context
        db = manager.get_tenant_db(tenant_id)
        s3_bucket = manager.get_tenant_bucket(
            tenant_id, override=tenant_data.get("s3_bucket_override")
        )

        ctx = TenantContext(tenant_id=tenant_id, db=db, s3_bucket=s3_bucket)
        set_tenant_ctx(ctx)

        # Ensure indexes exist for this tenant (lazy, cached in-memory)
        await manager.ensure_indexes(tenant_id)

        return await call_next(request)
