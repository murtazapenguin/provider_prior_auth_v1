import pytest


@pytest.mark.asyncio
async def test_upload_url_requires_auth(client):
    response = await client.post(
        "/api/v1/storage/upload-url",
        json={"filename": "test.pdf", "content_type": "application/pdf"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_download_url_requires_auth(client):
    response = await client.get("/api/v1/storage/download-url/some-id")
    assert response.status_code == 401
