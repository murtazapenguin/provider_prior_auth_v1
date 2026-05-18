from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_SECRETS = {"change-me-in-production", "change-me-jwt-secret"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "platform-backend-kit"
    app_env: Literal["development", "staging", "production"] = "development"
    debug: bool = False
    secret_key: str = "change-me-in-production"
    api_v1_prefix: str = "/api/v1"

    # Database (DocumentDB / MongoDB)
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "platform_backend"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Celery
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "mongodb://localhost:27017"
    celery_result_db_name: str = "celery_results"

    # JWT
    jwt_secret_key: str = "change-me-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7
    jwt_issuer: str = "platform-backend-kit"
    jwt_audience: str = "platform-backend-kit"

    # Microsoft OAuth2 (MSAL)
    msal_client_id: str = ""
    msal_client_secret: str = ""
    msal_tenant_id: str = ""
    msal_authority: str = "https://login.microsoftonline.com/{tenant_id}"
    msal_redirect_uri: str = "http://localhost:8000/api/v1/auth/callback/microsoft"
    msal_scopes: str = "User.Read"

    # SAML2
    saml_sp_entity_id: str = ""
    saml_sp_acs_url: str = ""
    saml_idp_metadata_url: str = ""
    saml_idp_sso_url: str = ""
    saml_idp_cert_file: str = ""

    # Telemetry / Observability
    otel_service_name: str = "platform-backend-kit"
    otel_exporter_otlp_endpoint: str = ""
    otel_enabled: bool = True
    prometheus_enabled: bool = True

    # Logging
    log_level: str = "INFO"
    log_json: bool = False

    # Multi-tenancy
    s3_bucket_prefix: str = "platform"  # Bucket pattern: {prefix}-{tenant_id}
    tenant_db_prefix: str = "platform_tenant"  # DB pattern: {prefix}_{tenant_id}

    # AWS S3
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    s3_bucket_name: str = "workflow-builder-platform-backend-uploads"  # Shared bucket for all apps
    s3_app_prefix: str = ""  # Per-app folder prefix within the bucket (e.g., "pa-review", "invoice-processor")
    s3_presigned_url_expiry: int = 3600

    # CORS
    cors_allowed_origins: str = ""  # Comma-separated origins, e.g. "https://app.example.com,https://admin.example.com"

    # Rate limiting
    rate_limit_authenticated: int = 200  # Max requests per window for authenticated users
    rate_limit_anonymous: int = 50  # Max requests per window for anonymous IPs
    rate_limit_window_seconds: int = 60  # Sliding window in seconds

    @model_validator(mode="after")
    def _validate_production_config(self) -> "Settings":
        if self.app_env != "production":
            return self
        errors: list[str] = []
        if self.secret_key in _DEFAULT_SECRETS:
            errors.append("SECRET_KEY must be changed from the default value")
        if self.jwt_secret_key in _DEFAULT_SECRETS:
            errors.append("JWT_SECRET_KEY must be changed from the default value")
        if not self.msal_client_id:
            errors.append("MSAL_CLIENT_ID must be set")
        if not self.aws_access_key_id:
            errors.append("AWS_ACCESS_KEY_ID must be set")
        if not self.cors_allowed_origins:
            errors.append("CORS_ALLOWED_ORIGINS must be set (do not use '*' in production)")
        if errors:
            raise ValueError(f"Production configuration errors: {'; '.join(errors)}")
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
