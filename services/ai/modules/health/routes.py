from fastapi import APIRouter
from loguru import logger

from services.ai.config import get_settings

router = APIRouter(tags=['health'])


@router.get('/health', summary='Liveness probe')
async def health_check():
    return {'status': 'healthy'}


@router.get('/readiness', summary='Readiness probe')
async def readiness_check():
    settings = get_settings()
    checks: dict[str, str | bool] = {
        'tracing_enabled': settings.is_tracing_enabled,
    }

    # No-op Bedrock credential ping — catches misconfigured AWS creds early.
    # We do a lightweight list-call that doesn't consume tokens.
    if settings.aws_access_key_id or settings.aws_region:
        try:
            import boto3  # noqa: PLC0415
            session = boto3.Session(
                aws_access_key_id=settings.aws_access_key_id or None,
                aws_secret_access_key=settings.aws_secret_access_key or None,
                aws_session_token=settings.aws_session_token or None,
                region_name=settings.aws_region,
            )
            sts = session.client('sts')
            sts.get_caller_identity()
            checks['bedrock_auth'] = 'ok'
        except Exception as exc:
            logger.warning('Readiness: Bedrock credential check failed: {}', exc)
            checks['bedrock_auth'] = 'unconfigured' if settings.is_production else f'error: {exc}'

    return {'status': 'healthy', **checks}
