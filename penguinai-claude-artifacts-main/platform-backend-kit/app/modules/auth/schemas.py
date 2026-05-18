from typing import List, Optional

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    provider: str
    redirect_url: Optional[str] = None


class AuthCallbackData(BaseModel):
    email: EmailStr
    display_name: str
    provider: str
    provider_user_id: str
    tenant_id: Optional[str] = None
    avatar_url: Optional[str] = None
    raw_claims: Optional[dict] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    provider: str
    tenant_id: Optional[str]
    roles: List[str]
    permissions: List[str]
    avatar_url: Optional[str]
    is_active: bool


class RefreshTokenRequest(BaseModel):
    refresh_token: str
