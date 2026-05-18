from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from app.common.error_handlers import register_error_handlers
from app.config import get_settings
from app.database import close_db, get_motor_client, init_db
from app.logging_config import configure_logging
from app.middleware.auth import JWTSessionMiddleware
from app.middleware.cors import configure_cors
from app.middleware.logging import LoggingMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.security import SecurityHeadersMiddleware
from app.middleware.tenant import TenantContextMiddleware
from app.redis import close_redis, init_redis
from app.telemetry import init_telemetry, shutdown_telemetry
from app.tenant import init_tenant_manager

# Configure loguru before anything else logs
configure_logging(get_settings())


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await init_db(settings)
    await init_redis(settings)
    init_tenant_manager(get_motor_client(), settings)
    yield
    await close_redis()
    await close_db()
    shutdown_telemetry()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        lifespan=lifespan,
    )

    # OpenTelemetry + Prometheus /metrics endpoint
    init_telemetry(app, settings)

    # Middleware (outermost first — added in reverse execution order)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(LoggingMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(TenantContextMiddleware)
    app.add_middleware(JWTSessionMiddleware)
    configure_cors(app, settings)

    # Error handlers
    register_error_handlers(app)

    # Routes
    from app.modules.auth.admin_routes import router as admin_router
    from app.modules.auth.routes import router as auth_router
    from app.modules.health.routes import router as health_router
    from app.modules.storage.routes import router as storage_router
    from app.modules.tasks.routes import router as tasks_router

    app.include_router(health_router)
    app.include_router(auth_router, prefix=f"{settings.api_v1_prefix}/auth", tags=["auth"])
    app.include_router(admin_router, prefix=f"{settings.api_v1_prefix}/admin", tags=["admin"])
    app.include_router(storage_router, prefix=f"{settings.api_v1_prefix}/storage", tags=["storage"])
    app.include_router(tasks_router, prefix=f"{settings.api_v1_prefix}/tasks", tags=["tasks"])

    # Scalar API docs (modern alternative to Swagger/ReDoc)
    if settings.debug:

        @app.get("/scalar", response_class=HTMLResponse, include_in_schema=False)
        async def scalar_docs():
            return f"""
            <!DOCTYPE html>
            <html>
            <head><title>{settings.app_name} — API Reference</title>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" /></head>
            <body>
            <script id="api-reference" data-url="/openapi.json"></script>
            <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
            </body>
            </html>
            """

    return app


app = create_app()
