from datetime import UTC, datetime
from typing import Optional

from pydantic import BaseModel, Field


class FileMetadata(BaseModel):
    """Tenant-scoped file metadata stored via Motor (not Beanie).

    Each tenant's file_metadata collection lives in their own database.
    """

    id: Optional[str] = None
    tenant_id: str
    filename: str
    s3_key: str
    content_type: str
    size_bytes: Optional[int] = None
    uploaded_by: str
    description: Optional[str] = None
    is_uploaded: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def to_doc(self) -> dict:
        """Convert to a MongoDB document dict for insertion."""
        return self.model_dump(exclude={"id"})

    @classmethod
    def from_doc(cls, doc: dict) -> "FileMetadata":
        """Create an instance from a MongoDB document dict."""
        doc = dict(doc)  # avoid mutating the original
        doc["id"] = str(doc.pop("_id")) if "_id" in doc else None
        return cls(**doc)
