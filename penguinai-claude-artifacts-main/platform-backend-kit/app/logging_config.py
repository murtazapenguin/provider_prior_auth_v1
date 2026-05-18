import logging
import sys
from contextvars import ContextVar

from loguru import logger

from app.config import Settings

# Context variables for per-request structured logging
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
trace_id_ctx: ContextVar[str] = ContextVar("trace_id", default="-")
span_id_ctx: ContextVar[str] = ContextVar("span_id", default="-")
user_id_ctx: ContextVar[str] = ContextVar("user_id", default="-")


def _context_patcher(record):
    """Inject contextvars into every loguru record's extra dict."""
    record["extra"]["request_id"] = request_id_ctx.get("-")
    record["extra"]["trace_id"] = trace_id_ctx.get("-")
    record["extra"]["span_id"] = span_id_ctx.get("-")
    record["extra"]["user_id"] = user_id_ctx.get("-")


# Format strings
_DEV_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
    "<level>{level: <8}</level> | "
    "<cyan>{extra[request_id]}</cyan> | "
    "<dim>{extra[trace_id]:.16}</dim> | "
    "{message}"
)

_JSON_FORMAT = (
    '{{"timestamp":"{time:YYYY-MM-DDTHH:mm:ss.SSSZ}",'
    '"level":"{level}",'
    '"message":"{message}",'
    '"request_id":"{extra[request_id]}",'
    '"trace_id":"{extra[trace_id]}",'
    '"span_id":"{extra[span_id]}",'
    '"user_id":"{extra[user_id]}",'
    '"module":"{module}",'
    '"function":"{function}",'
    '"line":{line}}}'
)


class InterceptHandler(logging.Handler):
    """Route stdlib logging records through loguru.

    This ensures third-party libraries (uvicorn, celery, motor, boto3)
    all emit through loguru with the same format and context.
    """

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def configure_logging(settings: Settings) -> None:
    """Configure loguru as the unified logging system.

    Call this once at application startup, before any other imports
    that might use logging.
    """
    # Remove default loguru handler
    logger.remove()

    # Add the context patcher
    logger.configure(patcher=_context_patcher)

    # Choose format based on environment
    if settings.log_json:
        fmt = _JSON_FORMAT
    else:
        fmt = _DEV_FORMAT

    # Add stdout sink
    logger.add(
        sys.stderr,
        format=fmt,
        level=settings.log_level.upper(),
        colorize=not settings.log_json,
        serialize=False,
    )

    # Intercept all stdlib logging
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

    # Specifically override noisy loggers
    for name in [
        "uvicorn",
        "uvicorn.error",
        "uvicorn.access",
        "celery",
        "celery.worker",
        "celery.app.trace",
        "motor",
        "pymongo",
        "boto3",
        "botocore",
    ]:
        logging.getLogger(name).handlers = [InterceptHandler()]
        logging.getLogger(name).propagate = False

    logger.info("Logging configured", level=settings.log_level, json_mode=settings.log_json)
