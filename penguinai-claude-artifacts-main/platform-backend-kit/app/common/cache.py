import functools
import hashlib
import json
from typing import Any, Callable, Optional

from app.redis import get_redis


class CacheService:
    @staticmethod
    async def get(key: str) -> Optional[str]:
        redis = get_redis()
        return await redis.get(key)

    @staticmethod
    async def set(key: str, value: str, ttl: int = 300) -> None:
        redis = get_redis()
        await redis.set(key, value, ex=ttl)

    @staticmethod
    async def delete(key: str) -> None:
        redis = get_redis()
        await redis.delete(key)

    @staticmethod
    async def get_json(key: str) -> Optional[Any]:
        data = await CacheService.get(key)
        return json.loads(data) if data else None

    @staticmethod
    async def set_json(key: str, value: Any, ttl: int = 300) -> None:
        await CacheService.set(key, json.dumps(value, default=str), ttl)


def cached(prefix: str, ttl: int = 300):
    """Decorator for caching async function results in Redis.

    Usage:
        @cached(prefix="user", ttl=600)
        async def get_user(user_id: str) -> dict:
            ...
    """

    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            key_data = f"{prefix}:{args}:{sorted(kwargs.items())}"
            cache_key = f"cache:{prefix}:{hashlib.md5(key_data.encode()).hexdigest()}"

            cached_result = await CacheService.get_json(cache_key)
            if cached_result is not None:
                return cached_result

            result = await func(*args, **kwargs)
            if result is not None:
                await CacheService.set_json(cache_key, result, ttl)
            return result

        return wrapper

    return decorator
