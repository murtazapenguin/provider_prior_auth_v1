from typing import Optional

from pydantic import BaseModel


class PresignedUploadRequest(BaseModel):
    filename: str
    content_type: str
    description: Optional[str] = None


class PresignedUploadResponse(BaseModel):
    upload_url: str
    s3_key: str
    file_id: str
    expires_in: int


class PresignedDownloadResponse(BaseModel):
    download_url: str
    filename: str
    expires_in: int


class FileMetadataResponse(BaseModel):
    id: str
    filename: str
    s3_key: str
    content_type: str
    size_bytes: Optional[int]
    uploaded_by: str
    description: Optional[str]
    is_uploaded: bool
    created_at: str


class ConfirmUploadRequest(BaseModel):
    size_bytes: Optional[int] = None
