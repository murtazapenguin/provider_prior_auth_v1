"""PA AI Service — FastAPI sidecar for the Penguin SDK.

HARD RULE: Penguin SDK imports are restricted to penguin_client.py.
Direct imports of openai, anthropic, boto3-for-Bedrock, pytesseract,
or langchain are forbidden in this service. See CLAUDE.md "Forbidden libraries".
"""

from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI

from services.ai.common.error_handlers import register_error_handlers
from services.ai.config import get_settings
from services.ai.logging_config import configure_logging
from services.ai.middleware.logging import LoggingMiddleware
from services.ai.middleware.request_id import RequestIDMiddleware
from services.ai.middleware.security import SecurityHeadersMiddleware

configure_logging(get_settings())

# Inject AWS credentials from pydantic-settings into the process environment
# so boto3 (used internally by Penguin SDK) picks them up via its default chain.
import os as _os  # noqa: E402
_s = get_settings()
if _s.aws_access_key_id:
    _os.environ.setdefault('AWS_ACCESS_KEY_ID', _s.aws_access_key_id)
    _os.environ.setdefault('AWS_SECRET_ACCESS_KEY', _s.aws_secret_access_key)
    _os.environ.setdefault('AWS_DEFAULT_REGION', _s.aws_region)
    _os.environ.setdefault('AWS_REGION', _s.aws_region)
    if _s.aws_session_token:
        _os.environ.setdefault('AWS_SESSION_TOKEN', _s.aws_session_token)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.database_url:
        app.state.db_pool = await asyncpg.create_pool(settings.database_url)
    else:
        app.state.db_pool = None
    yield
    if app.state.db_pool:
        await app.state.db_pool.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        docs_url='/docs' if settings.debug else None,
        redoc_url='/redoc' if settings.debug else None,
        lifespan=lifespan,
    )

    # Middleware order (outermost first = added last)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(LoggingMiddleware)

    register_error_handlers(app)

    from services.ai.modules.health.routes import router as health_router
    from services.ai.modules.derive_codes.routes import router as derive_codes_router
    from services.ai.modules.extract_evidence.routes import router as extract_evidence_router
    from services.ai.modules.ingest_documents.routes import router as ingest_documents_router
    from services.ai.modules.ingest_policy.routes import router as ingest_policy_router
    from services.ai.modules.ocr.routes import router as ocr_router
    from services.ai.modules.submission_packet.routes import router as submission_packet_router
    from services.ai.modules.triage_documents.routes import router as triage_documents_router

    app.include_router(health_router)
    app.include_router(derive_codes_router)
    app.include_router(extract_evidence_router)
    app.include_router(ingest_documents_router)
    app.include_router(ingest_policy_router)
    app.include_router(ocr_router)
    app.include_router(submission_packet_router)
    app.include_router(triage_documents_router)

    return app


app = create_app()
