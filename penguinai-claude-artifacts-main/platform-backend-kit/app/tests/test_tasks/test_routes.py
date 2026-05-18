import pytest


@pytest.mark.asyncio
async def test_trigger_task_requires_auth(client):
    response = await client.post(
        "/api/v1/tasks/trigger",
        json={"task_name": "tasks.example_long_running"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_task_status_requires_auth(client):
    response = await client.get("/api/v1/tasks/status/some-task-id")
    assert response.status_code == 401
