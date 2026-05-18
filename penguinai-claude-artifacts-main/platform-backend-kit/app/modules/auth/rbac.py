"""Role-Based Access Control: permission constants, role mappings, and resolution."""


class Permissions:
    """Permission constants following resource:action pattern."""

    STORAGE_UPLOAD = "storage:upload"
    STORAGE_DOWNLOAD = "storage:download"
    STORAGE_DELETE = "storage:delete"

    TASKS_TRIGGER = "tasks:trigger"
    TASKS_VIEW = "tasks:view"

    USERS_READ = "users:read"
    USERS_UPDATE = "users:update"
    USERS_MANAGE_ROLES = "users:manage_roles"


ALL_PERMISSIONS: list[str] = [
    Permissions.STORAGE_UPLOAD,
    Permissions.STORAGE_DOWNLOAD,
    Permissions.STORAGE_DELETE,
    Permissions.TASKS_TRIGGER,
    Permissions.TASKS_VIEW,
    Permissions.USERS_READ,
    Permissions.USERS_UPDATE,
    Permissions.USERS_MANAGE_ROLES,
]

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "owner": list(ALL_PERMISSIONS),
    "admin": [
        Permissions.STORAGE_UPLOAD,
        Permissions.STORAGE_DOWNLOAD,
        Permissions.STORAGE_DELETE,
        Permissions.TASKS_TRIGGER,
        Permissions.TASKS_VIEW,
        Permissions.USERS_READ,
        Permissions.USERS_UPDATE,
        Permissions.USERS_MANAGE_ROLES,
    ],
    "user": [
        Permissions.STORAGE_UPLOAD,
        Permissions.STORAGE_DOWNLOAD,
        Permissions.TASKS_TRIGGER,
        Permissions.TASKS_VIEW,
        Permissions.USERS_READ,
    ],
}

# Roles that can be assigned via the admin API. "owner" is auto-assigned only.
ASSIGNABLE_ROLES = {"user", "admin"}


def resolve_permissions(roles: list[str], extra_permissions: list[str] | None = None) -> list[str]:
    """Merge role-based permissions with directly-assigned extras, deduplicated."""
    perms: set[str] = set()
    for role in roles:
        perms.update(ROLE_PERMISSIONS.get(role, []))
    if extra_permissions:
        perms.update(extra_permissions)
    return sorted(perms)
