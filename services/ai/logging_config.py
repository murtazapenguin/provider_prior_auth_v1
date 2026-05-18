import logging
import sys
from contextvars import ContextVar

from loguru import logger

from services.ai.config import Settings

# Per-request structured logging context
request_id_ctx: ContextVar[str] = ContextVar('request_id', default='-')
trace_id_ctx: ContextVar[str] = ContextVar('trace_id', default='-')
span_id_ctx: ContextVar[str] = ContextVar('span_id', default='-')

_DEV_FORMAT = (
    '<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | '
    '<level>{level: <8}</level> | '
    '<cyan>{extra[request_id]}</cyan> | '
    '{message}'
)

_JSON_FORMAT = (
    '{{"timestamp":"{time:YYYY-MM-DDTHH:mm:ss.SSSZ}",'
    '"level":"{level}",'
    '"message":"{message}",'
    '"request_id":"{extra[request_id]}",'
    '"trace_id":"{extra[trace_id]}",'
    '"module":"{module}",'
    '"function":"{function}",'
    '"line":{line}}}'
)


def _context_patcher(record: dict) -> None:
    record['extra']['request_id'] = request_id_ctx.get('-')
    record['extra']['trace_id'] = trace_id_ctx.get('-')
    record['extra']['span_id'] = span_id_ctx.get('-')


class InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno  # type: ignore[assignment]

        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back  # type: ignore[assignment]
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def configure_logging(settings: Settings) -> None:
    logger.remove()
    logger.configure(patcher=_context_patcher)

    fmt = _JSON_FORMAT if settings.log_json else _DEV_FORMAT
    logger.add(
        sys.stderr,
        format=fmt,
        level=settings.log_level.upper(),
        colorize=not settings.log_json,
        serialize=False,
    )

    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
    for name in ['uvicorn', 'uvicorn.error', 'uvicorn.access', 'boto3', 'botocore']:
        logging.getLogger(name).handlers = [InterceptHandler()]
        logging.getLogger(name).propagate = False

    logger.info('Logging configured', level=settings.log_level, json_mode=settings.log_json)
