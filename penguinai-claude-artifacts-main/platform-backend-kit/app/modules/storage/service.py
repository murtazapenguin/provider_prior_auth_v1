import re
import uuid
from datetime import UTC, datetime

import boto3
from botocore.config import Config as BotoConfig
from bson import ObjectId

from app.common.audit import audit_log
from app.common.exceptions import BadRequestException, ConflictException, NotFoundException
from app.config import get_settings
from app.modules.storage.constants import ALLOWED_CONTENT_TYPES
from app.modules.storage.models import FileMetadata
from app.modules.storage.schemas import (
    PresignedDownloadResponse,
    PresignedUploadRequest,
    PresignedUploadResponse,
)
from app.tenant import get_tenant_collection, get_tenant_ctx


class StorageService:
    def __init__(self):
        settings = get_settings()
        self._s3_client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            config=BotoConfig(signature_version="s3v4"),
        )
        self._expiry = settings.s3_presigned_url_expiry

    def _get_bucket(self) -> str:
        """Get the S3 bucket for the current tenant."""
        return get_tenant_ctx().s3_bucket

    def _get_collection(self):
        """Get the file_metadata collection for the current tenant's database."""
        return get_tenant_collection("file_metadata")

    async def generate_upload_url(
        self, request: PresignedUploadRequest, user_id: str
    ) -> PresignedUploadResponse:
        if request.content_type not in ALLOWED_CONTENT_TYPES:
            raise BadRequestException(f"Content type '{request.content_type}' is not allowed")

        settings = get_settings()
        ctx = get_tenant_ctx()
        safe_filename = re.sub(r"[^\w.\-]", "_", request.filename)
        s3_key = f"{settings.s3_app_prefix}/uploads/{ctx.tenant_id}/{user_id}/{uuid.uuid4().hex}/{safe_filename}"

        upload_url = self._s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._get_bucket(),
                "Key": s3_key,
                "ContentType": request.content_type,
            },
            ExpiresIn=self._expiry,
        )

        file_meta = FileMetadata(
            tenant_id=ctx.tenant_id,
            filename=request.filename,
            s3_key=s3_key,
            content_type=request.content_type,
            uploaded_by=user_id,
            description=request.description,
        )
        collection = self._get_collection()
        result = await collection.insert_one(file_meta.to_doc())

        audit_log(
            action="file.upload_url_generated",
            actor_id=user_id,
            tenant_id=ctx.tenant_id,
            resource_type="file",
            resource_id=str(result.inserted_id),
            details={"filename": request.filename, "content_type": request.content_type},
        )

        return PresignedUploadResponse(
            upload_url=upload_url,
            s3_key=s3_key,
            file_id=str(result.inserted_id),
            expires_in=self._expiry,
        )

    async def confirm_upload(
        self, file_id: str, user_id: str, size_bytes: int | None = None
    ) -> FileMetadata:
        collection = self._get_collection()
        doc = await collection.find_one({"_id": ObjectId(file_id)})
        if not doc or doc.get("uploaded_by") != user_id:
            raise NotFoundException("File not found")

        if doc.get("is_uploaded"):
            raise ConflictException("File upload already confirmed")

        update: dict = {
            "is_uploaded": True,
            "updated_at": datetime.now(UTC),
        }
        if size_bytes:
            update["size_bytes"] = size_bytes

        await collection.update_one({"_id": ObjectId(file_id)}, {"$set": update})
        doc.update(update)
        return FileMetadata.from_doc(doc)

    async def generate_download_url(self, file_id: str, user_id: str) -> PresignedDownloadResponse:
        collection = self._get_collection()
        doc = await collection.find_one({"_id": ObjectId(file_id)})
        if not doc or doc.get("uploaded_by") != user_id:
            raise NotFoundException("File not found")
        if not doc.get("is_uploaded"):
            raise BadRequestException("File upload not confirmed")

        download_url = self._s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._get_bucket(),
                "Key": doc["s3_key"],
            },
            ExpiresIn=self._expiry,
        )

        audit_log(
            action="file.download_url_generated",
            actor_id=user_id,
            tenant_id=doc.get("tenant_id"),
            resource_type="file",
            resource_id=file_id,
            details={"filename": doc["filename"]},
        )

        return PresignedDownloadResponse(
            download_url=download_url,
            filename=doc["filename"],
            expires_in=self._expiry,
        )
