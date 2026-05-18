import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import ASGITransport, AsyncClient

from app.tenant import TenantContext, set_tenant_ctx


@pytest.fixture
def mock_settings():
    from app.config import Settings

    return Settings(
        app_env="development",
        debug=True,
        secret_key="test-secret",
        jwt_secret_key="test-jwt-secret",
        mongodb_url="mongodb://localhost:27017",
        mongodb_db_name="test_platform_backend",
        redis_url="redis://localhost:6379/15",
        celery_broker_url="redis://localhost:6379/15",
        celery_result_backend="mongodb://localhost:27017",
        s3_bucket_prefix="test-platform",
        s3_app_prefix="test-app",
        tenant_db_prefix="test_tenant",
    )


@pytest.fixture
def mock_tenant_ctx():
    """Provide a mock TenantContext for tests that need tenant isolation."""
    mock_db = MagicMock()
    ctx = TenantContext(
        tenant_id="test-tenant",
        db=mock_db,
        s3_bucket="test-platform-test-tenant",
    )
    set_tenant_ctx(ctx)
    return ctx


@pytest.fixture
async def app(mock_settings):
    with patch("app.config.get_settings", return_value=mock_settings):
        with patch("app.database.init_db", new_callable=AsyncMock):
            with patch("app.database.close_db", new_callable=AsyncMock):
                with patch("app.database.get_motor_client", return_value=MagicMock()):
                    with patch("app.redis.init_redis", new_callable=AsyncMock):
                        with patch("app.redis.close_redis", new_callable=AsyncMock):
                            from app.main import create_app

                            application = create_app()
                            yield application


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


@pytest.fixture
def auth_headers(mock_settings):
    with patch("app.config.get_settings", return_value=mock_settings):
        from app.modules.auth.jwt import create_access_token

        token = create_access_token(
            {
                "sub": "test-user-id",
                "email": "test@example.com",
                "tenant_id": "test-tenant",
                "roles": ["user"],
                "permissions": [],
            }
        )
        return {"Authorization": f"Bearer {token}"}
