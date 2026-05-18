from datetime import UTC, datetime

from beanie import Document
from pydantic import Field


class TimestampMixin:
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class BaseDocument(TimestampMixin, Document):
    class Settings:
        use_state_management = True
