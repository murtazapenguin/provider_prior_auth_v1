from fastapi import APIRouter, Depends, Query

from app.common.audit import audit_log
from app.common.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.modules.auth.admin_schemas import (
    TenantUserResponse,
    UpdateUserRolesRequest,
    UpdateUserRolesResponse,
)
from app.modules.auth.dependencies import CurrentUser, require_permissions, require_roles, require_tenant
from app.modules.auth.models import User
from app.modules.auth.rbac import ASSIGNABLE_ROLES

router = APIRouter()


@router.get(
    "/users",
    summary="List tenant users (paginated)",
    dependencies=[Depends(require_tenant()), Depends(require_roles(["admin"]))],
)
async def list_tenant_users(
    user: CurrentUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List users belonging to the current user's tenant (paginated)."""
    query = User.find(User.tenant_id == user.tenant_id)
    total = await query.count()
    users = await query.skip(skip).limit(limit).to_list()
    return {
        "items": [
            TenantUserResponse(
                id=str(u.id),
                email=u.email,
                display_name=u.display_name,
                roles=u.roles,
                is_active=u.is_active,
            )
            for u in users
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.put(
    "/users/{user_id}/roles",
    summary="Update user roles within tenant",
    response_model=UpdateUserRolesResponse,
    dependencies=[
        Depends(require_tenant()),
        Depends(require_roles(["admin"])),
        Depends(require_permissions(["users:manage_roles"])),
    ],
)
async def update_user_roles(user_id: str, body: UpdateUserRolesRequest, user: CurrentUser):
    """Assign roles to a user within the same tenant."""
    target_user = await User.get(user_id)
    if target_user is None:
        raise NotFoundException("User not found")

    # Enforce tenant isolation
    if target_user.tenant_id != user.tenant_id:
        raise ForbiddenException("Cannot manage users outside your tenant")

    # Validate requested roles
    invalid_roles = set(body.roles) - ASSIGNABLE_ROLES
    if invalid_roles:
        raise BadRequestException(f"Invalid roles: {', '.join(sorted(invalid_roles))}")

    # Preserve the "owner" role if the target already has it
    new_roles = list(body.roles)
    if "owner" in target_user.roles and "owner" not in new_roles:
        new_roles.insert(0, "owner")

    target_user.roles = new_roles
    await target_user.save()

    audit_log(
        action="user.roles_updated",
        actor_id=str(user.id),
        tenant_id=user.tenant_id,
        resource_type="user",
        resource_id=user_id,
        details={"new_roles": new_roles},
    )

    return UpdateUserRolesResponse(
        id=str(target_user.id),
        email=target_user.email,
        roles=target_user.roles,
        message="Roles updated successfully",
    )
