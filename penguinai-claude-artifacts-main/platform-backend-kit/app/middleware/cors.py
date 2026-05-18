from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings


def configure_cors(app: FastAPI, settings: Settings) -> None:
    if settings.cors_allowed_origins:
        # Production: use explicitly configured origins from env
        origins = [o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()]
    elif not settings.is_production:
        # Development: allow common local dev origins
        origins = ["http://localhost:3000", "http://localhost:8000"]
    else:
        # Production with no origins configured: deny all cross-origin
        origins = []

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
