import redis.asyncio as aioredis

from app.config import Settings

_redis: aioredis.Redis | None = None


async def init_redis(settings: Settings) -> None:
    global _redis
    _redis = aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        max_connections=50,
        socket_connect_timeout=5,
        socket_timeout=30,
    )


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.close()
        _redis = None


def get_redis() -> aioredis.Redis:
    if _redis is None:
        raise RuntimeError("Redis not initialized")
    return _redis
