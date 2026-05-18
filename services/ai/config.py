from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root is three levels up from this file:
#   services/ai/config.py → services/ai/ → services/ → repo root
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parent / '.env'),
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore',
    )

    app_name: str = 'pa-ai-service'
    app_env: Literal['development', 'staging', 'production'] = 'development'
    debug: bool = True
    log_level: str = 'INFO'
    log_json: bool = False

    ai_service_token: str = 'dev-token-change-me'

    # AWS (Bedrock LLM + Textract OCR)
    aws_region: str = 'us-east-1'
    aws_access_key_id: str = ''
    aws_secret_access_key: str = ''
    aws_session_token: str = ''
    s3_ocr_staging_bucket: str = ''

    # Langfuse tracing (off by default — set vars to enable)
    langfuse_public_key: str = ''
    langfuse_secret_key: str = ''
    langfuse_host: str = ''

    # Penguin SDK
    penguin_llm_provider: str = 'bedrock'
    penguin_llm_model: str = 'claude-sonnet-4-5'
    penguin_guard_model: str = 'claude-haiku-4-5'

    # Postgres (for ai_call_cache)
    database_url: str = ''

    # Where Next.js serves static files.  Empty string → auto-resolve to <repo_root>/public.
    # Override with PUBLIC_DIR env var for production deployments (e.g. S3-backed path).
    public_dir_override: str = ''

    @property
    def is_production(self) -> bool:
        return self.app_env == 'production'

    @property
    def is_tracing_enabled(self) -> bool:
        return bool(self.langfuse_public_key and self.langfuse_secret_key)

    @property
    def public_dir(self) -> Path:
        """Absolute path to the Next.js public/ directory.

        Defaults to <repo_root>/public; overridden via PUBLIC_DIR_OVERRIDE env var.
        The directory is created on first access if it doesn't exist.
        """
        if self.public_dir_override:
            p = Path(self.public_dir_override)
        else:
            p = _REPO_ROOT / 'public'
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()
