import time

from loguru import logger

from app.celery_app import celery_app


@celery_app.task(bind=True, name="tasks.example_long_running")
def example_long_running_task(self, duration: int = 10, data: dict = None, tenant_id: str = None):
    logger.info("Task {} started for tenant={} duration={}", self.request.id, tenant_id, duration)

    for i in range(duration):
        time.sleep(1)
        self.update_state(
            state="PROGRESS",
            meta={"current": i + 1, "total": duration, "percent": int((i + 1) / duration * 100)},
        )

    logger.info("Task {} completed for tenant={}", self.request.id, tenant_id)
    return {
        "status": "completed",
        "duration": duration,
        "tenant_id": tenant_id,
        "data": data,
    }


@celery_app.task(name="tasks.send_notification")
def send_notification_task(user_id: str, message: str, tenant_id: str = None):
    logger.info("Sending notification to user {} (tenant={}): {}", user_id, tenant_id, message)
    return {"user_id": user_id, "tenant_id": tenant_id, "message": message, "sent": True}
