from typing import List, Optional

from pydantic import BaseModel


class TenantUserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    roles: List[str]
    is_active: bool


class UpdateUserRolesRequest(BaseModel):
    roles: List[str]


class UpdateUserRolesResponse(BaseModel):
    id: str
    email: str
    roles: List[str]
    message: str
