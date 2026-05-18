from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def mock_settings():
    from services.ai.config import Settings
    return Settings(
        app_env='development',
        debug=True,
        ai_service_token='test-token',
        aws_region='us-east-1',
        penguin_llm_provider='bedrock',
        penguin_llm_model='claude-sonnet-4-5',
        database_url='',
    )


@pytest.fixture
async def app(mock_settings):
    with patch('services.ai.config.get_settings', return_value=mock_settings):
        with patch('asyncpg.create_pool', new_callable=AsyncMock) as mock_pool:
            mock_pool.return_value.__aenter__ = AsyncMock(return_value=None)
            mock_pool.return_value.__aexit__ = AsyncMock(return_value=None)
            mock_pool.return_value.close = AsyncMock()
            from services.ai.main import create_app
            application = create_app()
            yield application


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url='http://test',
    ) as ac:
        yield ac
