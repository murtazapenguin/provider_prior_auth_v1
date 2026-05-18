"""Audit logging for sensitive SaaS operations.

Emits structured audit events via loguru to the same logging pipeline.
In production, these can be filtered/routed to a dedicated audit store
(e.g. CloudWatch, Datadog, ELK) using the `audit=True` extra field.
"""

from datetime import UTC, datetime
from typing import Any

from loguru import logger


def audit_log(
    action: str,
    actor_id: str | None = None,
    tenant_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> None:
    """Emit a structured audit log entry.

    Args:
        action: The action performed (e.g. "user.login", "file.upload", "tenant.provisioned")
        actor_id: The user ID who performed the action
        tenant_id: The tenant context
        resource_type: Type of resource affected (e.g. "user", "file", "tenant")
        resource_id: ID of the affected resource
        details: Additional context about the action
        ip_address: Client IP address
    """
    logger.bind(
        audit=True,
        audit_action=action,
        audit_actor=actor_id or "-",
        audit_tenant=tenant_id or "-",
        audit_resource_type=resource_type or "-",
        audit_resource_id=resource_id or "-",
        audit_details=details or {},
        audit_ip=ip_address or "-",
        audit_timestamp=datetime.now(UTC).isoformat(),
    ).info(
        "AUDIT | {action} | actor={actor} tenant={tenant} resource={resource_type}/{resource_id}",
        action=action,
        actor=actor_id or "-",
        tenant=tenant_id or "-",
        resource_type=resource_type or "-",
        resource_id=resource_id or "-",
    )
