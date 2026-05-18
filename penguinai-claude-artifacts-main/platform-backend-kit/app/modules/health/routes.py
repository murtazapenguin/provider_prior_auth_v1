import boto3
from botocore.config import Config as BotoConfig
from fastapi import APIRouter
from loguru import logger

from app.config import get_settings
from app.database import get_database
from app.redis import get_redis

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness probe")
async def health_check():
    return {"status": "healthy"}


@router.get("/readiness", summary="Readiness probe (MongoDB, Redis, S3)")
async def readiness_check():
    settings = get_settings()
    checks: dict[str, str] = {}

    try:
        db = get_database()
        await db.command("ping")
        checks["mongodb"] = "ok"
    except Exception as e:
        logger.warning("Readiness check failed for mongodb: {}", e)
        checks["mongodb"] = "error" if settings.is_production else f"error: {e}"

    try:
        redis = get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        logger.warning("Readiness check failed for redis: {}", e)
        checks["redis"] = "error" if settings.is_production else f"error: {e}"

    if settings.aws_access_key_id:
        try:
            s3 = boto3.client(
                "s3",
                region_name=settings.aws_region,
                aws_access_key_id=settings.aws_access_key_id,
                aws_secret_access_key=settings.aws_secret_access_key,
                config=BotoConfig(signature_version="s3v4", connect_timeout=5, read_timeout=5),
            )
            s3.head_bucket(Bucket=settings.s3_bucket_name)
            checks["s3"] = "ok"
        except Exception as e:
            logger.warning("Readiness check failed for s3: {}", e)
            checks["s3"] = "error" if settings.is_production else f"error: {e}"

    all_ok = all(v == "ok" for v in checks.values())
    return {"status": "ready" if all_ok else "degraded", "checks": checks}
