from typing import Annotated, List

from fastapi import Depends, Request

from app.common.exceptions import ForbiddenException, UnauthorizedException
from app.modules.auth.models import User


async def get_current_user(request: Request) -> User:
    payload = request.state.user
    if payload is None:
        raise UnauthorizedException("Authentication required")

    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedException("Invalid token payload")

    user = await User.get(user_id)
    if user is None or not user.is_active:
        raise UnauthorizedException("User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(required_roles: List[str]):
    """Dependency factory for role-based access control.

    Usage:
        @router.get("/admin", dependencies=[Depends(require_roles(["admin"]))])
    """

    async def role_checker(user: CurrentUser):
        if not any(role in user.roles for role in required_roles):
            raise ForbiddenException("Insufficient permissions")
        return user

    return role_checker


def require_permissions(required_permissions: List[str]):
    """Dependency factory for fine-grained permission checks.

    Usage:
        @router.post("/create", dependencies=[Depends(require_permissions(["files:write"]))])
    """

    async def permission_checker(user: CurrentUser):
        if not all(perm in user.permissions for perm in required_permissions):
            raise ForbiddenException("Insufficient permissions")
        return user

    return permission_checker


def require_tenant():
    """Dependency that ensures the user belongs to a tenant.

    Usage:
        @router.get("/data", dependencies=[Depends(require_tenant())])
    """

    async def tenant_checker(user: CurrentUser):
        if not user.tenant_id:
            raise ForbiddenException("Tenant membership required")
        return user

    return tenant_checker
