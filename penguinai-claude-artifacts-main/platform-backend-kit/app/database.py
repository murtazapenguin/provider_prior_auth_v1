from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import Settings

_client: AsyncIOMotorClient | None = None


async def init_db(settings: Settings) -> None:
    global _client
    _client = AsyncIOMotorClient(
        settings.mongodb_url,
        maxPoolSize=50,
        connectTimeoutMS=5000,
        socketTimeoutMS=30000,
        serverSelectionTimeoutMS=5000,
    )
    database = _client[settings.mongodb_db_name]

    # Only shared (non-tenant) models are registered with Beanie.
    # Tenant-scoped data uses Motor collections directly via TenantContext.
    from app.modules.auth.models import User
    from app.modules.auth.tenant_model import Tenant

    await init_beanie(
        database=database,
        document_models=[User, Tenant],
    )


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        _client = None


def get_motor_client() -> AsyncIOMotorClient:
    """Expose the Motor client for tenant database access."""
    if _client is None:
        raise RuntimeError("Database not initialized")
    return _client


def get_database():
    if _client is None:
        raise RuntimeError("Database not initialized")
    from app.config import get_settings

    return _client[get_settings().mongodb_db_name]
