from typing import List, Optional

from beanie import Indexed
from pydantic import EmailStr, Field

from app.common.models import BaseDocument


class User(BaseDocument):
    email: Indexed(EmailStr, unique=True)
    display_name: str
    provider: str  # "microsoft" | "saml"
    provider_user_id: str
    tenant_id: Indexed(Optional[str]) = None  # SaaS tenant/organization ID
    roles: List[str] = Field(default_factory=lambda: ["user"])
    permissions: List[str] = Field(default_factory=list)  # Fine-grained SaaS permissions
    avatar_url: Optional[str] = None
    is_active: bool = True
    last_login: Optional[str] = None

    class Settings:
        collection = "users"
        use_state_management = True
