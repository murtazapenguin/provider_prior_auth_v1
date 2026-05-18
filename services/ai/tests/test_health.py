"""Health endpoint smoke tests. Run: pytest services/ai/tests/test_health.py"""

import pytest


def test_penguin_import():
    from penguin.core import create_model  # noqa: F401
    assert create_model is not None


@pytest.mark.asyncio
async def test_health_returns_200(client):
    resp = await client.get('/health')
    assert resp.status_code == 200
    assert resp.json()['status'] == 'healthy'


@pytest.mark.asyncio
async def test_readiness_has_tracing_flag(client):
    resp = await client.get('/readiness')
    assert resp.status_code == 200
    data = resp.json()
    assert 'tracing_enabled' in data


@pytest.mark.asyncio
async def test_request_id_roundtrip(client):
    resp = await client.get('/health', headers={'X-Request-ID': 'test-123'})
    assert resp.headers.get('x-request-id') == 'test-123'
