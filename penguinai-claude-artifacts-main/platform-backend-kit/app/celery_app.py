from celery import Celery
from celery.signals import worker_process_init

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "platform_backend",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    mongodb_backend_settings={
        "database": settings.celery_result_db_name,
        "taskmeta_collection": "celery_taskmeta",
    },
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    imports=["app.modules.tasks.workers.example_tasks"],
    broker_transport_options={
        "visibility_timeout": 3600,
    },
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=86400,
)


@worker_process_init.connect
def init_worker_logging(**kwargs):
    """Configure loguru in each Celery worker process."""
    from app.logging_config import configure_logging

    configure_logging(settings)
