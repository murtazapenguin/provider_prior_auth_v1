from contextvars import ContextVar
from dataclasses import dataclass
from typing import Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase

from app.common.exceptions import ForbiddenException
from app.config import Settings

# Per-request tenant context
_tenant_ctx: ContextVar[Optional["TenantContext"]] = ContextVar("tenant_ctx", default=None)


@dataclass
class TenantContext:
    tenant_id: str
    db: AsyncIOMotorDatabase
    s3_bucket: str


def get_tenant_ctx() -> TenantContext:
    """Get the current request's tenant context. Raises if not set."""
    ctx = _tenant_ctx.get()
    if ctx is None:
        raise ForbiddenException("Tenant context not available")
    return ctx


def set_tenant_ctx(ctx: TenantContext) -> None:
    _tenant_ctx.set(ctx)


def get_tenant_collection(name: str) -> AsyncIOMotorCollection:
    """Shortcut: get a Motor collection from the current tenant's database."""
    return get_tenant_ctx().db[name]


class TenantDatabaseManager:
    """Manages per-tenant database references and lazy index creation."""

    _MAX_CACHED_TENANTS = 10_000

    def __init__(self, client: AsyncIOMotorClient, settings: Settings):
        self._client = client
        self._settings = settings
        self._indexed_tenants: set[str] = set()

    def get_tenant_db(self, tenant_id: str) -> AsyncIOMotorDatabase:
        db_name = f"{self._settings.tenant_db_prefix}_{tenant_id}"
        return self._client[db_name]

    def get_tenant_bucket(self, tenant_id: str, override: str | None = None) -> str:
        if override:
            return override
        return f"{self._settings.s3_bucket_prefix}-{tenant_id}"

    async def ensure_indexes(self, tenant_id: str) -> None:
        """Create indexes for a tenant's database on first access."""
        if tenant_id in self._indexed_tenants:
            return

        db = self.get_tenant_db(tenant_id)

        # FileMetadata indexes
        file_coll = db["file_metadata"]
        await file_coll.create_index("s3_key", unique=True)
        await file_coll.create_index("uploaded_by")

        if len(self._indexed_tenants) >= self._MAX_CACHED_TENANTS:
            self._indexed_tenants.clear()
            logger.warning("Indexed tenants cache cleared (hit {} limit)", self._MAX_CACHED_TENANTS)

        self._indexed_tenants.add(tenant_id)
        logger.info("Indexes created for tenant {}", tenant_id)


# Global instance, initialized in app lifespan
_manager: Optional[TenantDatabaseManager] = None


def init_tenant_manager(client: AsyncIOMotorClient, settings: Settings) -> TenantDatabaseManager:
    global _manager
    _manager = TenantDatabaseManager(client, settings)
    return _manager


def get_tenant_manager() -> TenantDatabaseManager:
    if _manager is None:
        raise RuntimeError("TenantDatabaseManager not initialized")
    return _manager
