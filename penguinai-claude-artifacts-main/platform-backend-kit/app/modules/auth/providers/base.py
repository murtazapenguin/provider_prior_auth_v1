from abc import ABC, abstractmethod
from typing import Optional

from fastapi import Request

from app.modules.auth.schemas import AuthCallbackData


class AuthProvider(ABC):
    @abstractmethod
    async def get_login_url(self, redirect_url: Optional[str] = None) -> str: ...

    @abstractmethod
    async def handle_callback(self, request: Request) -> AuthCallbackData: ...

    async def get_logout_url(self) -> Optional[str]:
        return None
