from fastapi import APIRouter, Depends

from app.modules.auth.dependencies import CurrentUser, require_permissions, require_tenant
from app.modules.storage.schemas import (
    ConfirmUploadRequest,
    FileMetadataResponse,
    PresignedDownloadResponse,
    PresignedUploadRequest,
    PresignedUploadResponse,
)
from app.modules.storage.service import StorageService

router = APIRouter()


def get_storage_service() -> StorageService:
    return StorageService()


@router.post(
    "/upload-url",
    summary="Generate presigned upload URL",
    response_model=PresignedUploadResponse,
    dependencies=[Depends(require_tenant()), Depends(require_permissions(["storage:upload"]))],
)
async def get_upload_url(
    body: PresignedUploadRequest,
    user: CurrentUser,
    service: StorageService = Depends(get_storage_service),
):
    return await service.generate_upload_url(body, user_id=str(user.id))


@router.post(
    "/confirm-upload/{file_id}",
    summary="Confirm file upload completion",
    response_model=FileMetadataResponse,
    dependencies=[Depends(require_tenant()), Depends(require_permissions(["storage:upload"]))],
)
async def confirm_upload(
    file_id: str,
    body: ConfirmUploadRequest,
    user: CurrentUser,
    service: StorageService = Depends(get_storage_service),
):
    file_meta = await service.confirm_upload(file_id, user_id=str(user.id), size_bytes=body.size_bytes)
    return FileMetadataResponse(
        id=str(file_meta.id),
        filename=file_meta.filename,
        s3_key=file_meta.s3_key,
        content_type=file_meta.content_type,
        size_bytes=file_meta.size_bytes,
        uploaded_by=file_meta.uploaded_by,
        description=file_meta.description,
        is_uploaded=file_meta.is_uploaded,
        created_at=file_meta.created_at.isoformat(),
    )


@router.get(
    "/download-url/{file_id}",
    summary="Generate presigned download URL",
    response_model=PresignedDownloadResponse,
    dependencies=[Depends(require_tenant()), Depends(require_permissions(["storage:download"]))],
)
async def get_download_url(
    file_id: str,
    user: CurrentUser,
    service: StorageService = Depends(get_storage_service),
):
    return await service.generate_download_url(file_id, user_id=str(user.id))
