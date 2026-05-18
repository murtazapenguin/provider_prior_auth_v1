from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from services.ai.config import get_settings

_bearer = HTTPBearer(auto_error=False)


def require_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    settings = get_settings()
    if credentials is None or credentials.credentials != settings.ai_service_token:
        raise HTTPException(status_code=401, detail='Unauthorized')
