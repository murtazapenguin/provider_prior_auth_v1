#!/bin/bash
set -e

celery -A app.celery_app worker \
    --loglevel="${LOG_LEVEL:-info}" \
    --concurrency="${CELERY_CONCURRENCY:-4}"
