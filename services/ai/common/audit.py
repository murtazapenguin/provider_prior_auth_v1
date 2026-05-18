"""Audit logging for PA AI service operations.

Emits structured loguru events with audit=True. The Next.js side writes
the PaEvent DB row via a follow-up call — this service is stateless w.r.t.
PaEvent persistence and only logs for observability.
"""

from datetime import UTC, datetime
from typing import Any

from loguru import logger


def audit_log(
    action: str,
    pa_id: str | None = None,
    actor: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    logger.bind(
        audit=True,
        audit_action=action,
        audit_pa_id=pa_id or '-',
        audit_actor=actor or '-',
        audit_metadata=metadata or {},
        audit_timestamp=datetime.now(UTC).isoformat(),
    ).info(
        'AUDIT | {action} | pa_id={pa_id} actor={actor}',
        action=action,
        pa_id=pa_id or '-',
        actor=actor or '-',
    )
