# API Routes Reference

Complete route implementations for FastAPI backends.

## Authentication Routes (routes/auth_routes.py)

```python
from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from models.user import UserCreate, UserLogin, TokenResponse, UserResponse
from repositories.user_repository import UserRepository
from auth import Auth
from jwt_handler import JWTHandler
from datetime import datetime

router = APIRouter()
security = HTTPBearer()

@router.post("/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    """Register a new user."""
    repo = UserRepository()

    # Check if username exists
    existing = await repo.get_by_username(user_data.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    # Create user
    hashed_password = Auth.hash_password(user_data.password)
    user_dict = user_data.model_dump(exclude={"password"})
    user_dict["hashed_password"] = hashed_password
    user_dict["created_at"] = datetime.utcnow()
    user_dict["is_active"] = True

    user_id = await repo.create(user_dict)
    user = await repo.get_by_id(user_id)

    # Generate token
    token = JWTHandler.create_access_token({
        "sub": user.username,
        "user_id": user.id
    })

    return TokenResponse(
        token=token,
        user=UserResponse(**user.model_dump())
    )

@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    """Login and get access token."""
    repo = UserRepository()

    user = await repo.get_by_username(credentials.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )

    if not Auth.verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )

    token = JWTHandler.create_access_token({
        "sub": user.username,
        "user_id": user.id
    })

    return TokenResponse(
        token=token,
        user=UserResponse(**user.model_dump())
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Get current user info."""
    payload = JWTHandler.verify_token(credentials.credentials)
    repo = UserRepository()

    user = await repo.get_by_id(payload["user_id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return UserResponse(**user.model_dump())
```

## Document Routes (routes/document_routes.py)

```python
from fastapi import APIRouter, HTTPException, status, Depends, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from models.document import (
    DocumentCreate, DocumentUpdate, DocumentResponse,
    DocumentListResponse, DocumentStatus, ItemStatus
)
from repositories.document_repository import DocumentRepository
from jwt_handler import JWTHandler
from datetime import datetime

router = APIRouter()
security = HTTPBearer()

async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> str:
    """Extract user ID from JWT token."""
    payload = JWTHandler.verify_token(credentials.credentials)
    return payload["user_id"]

@router.get("/queue", response_model=DocumentListResponse)
async def get_queue(
    status: Optional[DocumentStatus] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_id: str = Depends(get_current_user_id)
):
    """Get documents queue with optional status filter."""
    repo = DocumentRepository()

    filter_dict = {}
    if status:
        filter_dict["status"] = status.value

    skip = (page - 1) * page_size
    documents = await repo.get_all(
        filter=filter_dict,
        skip=skip,
        limit=page_size
    )
    total = await repo.count(filter=filter_dict)

    return DocumentListResponse(
        documents=[DocumentResponse(**d.model_dump()) for d in documents],
        total=total,
        page=page,
        page_size=page_size
    )

@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """Get a specific document by ID."""
    repo = DocumentRepository()
    document = await repo.get_by_id(document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    return DocumentResponse(**document.model_dump())

@router.post("/", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(
    document_data: DocumentCreate,
    user_id: str = Depends(get_current_user_id)
):
    """Create a new document."""
    repo = DocumentRepository()

    doc_dict = document_data.model_dump()
    doc_dict["status"] = DocumentStatus.PENDING.value
    doc_dict["created_at"] = datetime.utcnow()
    doc_dict["updated_at"] = datetime.utcnow()
    doc_dict["items"] = []

    doc_id = await repo.create(doc_dict)
    document = await repo.get_by_id(doc_id)

    return DocumentResponse(**document.model_dump())

@router.put("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: str,
    update_data: DocumentUpdate,
    user_id: str = Depends(get_current_user_id)
):
    """Update a document."""
    repo = DocumentRepository()
    document = await repo.get_by_id(document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    update_dict = update_data.model_dump(exclude_unset=True)
    update_dict["updated_at"] = datetime.utcnow()

    await repo.update(document_id, update_dict)
    document = await repo.get_by_id(document_id)

    return DocumentResponse(**document.model_dump())

@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """Delete a document."""
    repo = DocumentRepository()
    document = await repo.get_by_id(document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    await repo.delete(document_id)
    return None

@router.put("/{document_id}/start", response_model=DocumentResponse)
async def start_workflow(
    document_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """Start working on a document."""
    repo = DocumentRepository()
    document = await repo.get_by_id(document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    if document.status != DocumentStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document is not in pending status"
        )

    await repo.update(document_id, {
        "status": DocumentStatus.IN_PROGRESS.value,
        "assigned_to": user_id,
        "updated_at": datetime.utcnow()
    })

    document = await repo.get_by_id(document_id)
    return DocumentResponse(**document.model_dump())

@router.put("/{document_id}/items/{item_id}", response_model=DocumentResponse)
async def update_item_status(
    document_id: str,
    item_id: str,
    status: ItemStatus = Query(...),
    user_id: str = Depends(get_current_user_id)
):
    """Update the status of a workflow item (accept/deny)."""
    repo = DocumentRepository()
    document = await repo.get_by_id(document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    # Update the specific item
    updated = await repo.update_item_status(document_id, item_id, status.value)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found"
        )

    document = await repo.get_by_id(document_id)
    return DocumentResponse(**document.model_dump())

@router.put("/{document_id}/complete", response_model=DocumentResponse)
async def complete_workflow(
    document_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """Mark document workflow as complete."""
    repo = DocumentRepository()
    document = await repo.get_by_id(document_id)

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    # Check if all items have been reviewed
    pending_items = [i for i in document.items if i.status == ItemStatus.PENDING]
    if pending_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{len(pending_items)} items still pending review"
        )

    await repo.update(document_id, {
        "status": DocumentStatus.COMPLETED.value,
        "completed_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    })

    document = await repo.get_by_id(document_id)
    return DocumentResponse(**document.model_dump())
```

## User Repository (repositories/user_repository.py)

```python
from typing import Optional
from repositories.base_repository import BaseRepository
from models.user import UserModel
from utils.db_utils import DatabaseManager

class UserRepository(BaseRepository[UserModel]):
    def __init__(self):
        collection = DatabaseManager.get_collection("users")
        super().__init__(collection, UserModel)

    async def get_by_username(self, username: str) -> Optional[UserModel]:
        """Get user by username."""
        doc = await self.collection.find_one({"username": username})
        if doc:
            doc["id"] = str(doc.pop("_id"))
            return UserModel(**doc)
        return None

    async def get_by_email(self, email: str) -> Optional[UserModel]:
        """Get user by email."""
        doc = await self.collection.find_one({"email": email})
        if doc:
            doc["id"] = str(doc.pop("_id"))
            return UserModel(**doc)
        return None
```

## Document Repository (repositories/document_repository.py)

```python
from typing import Optional, List
from bson import ObjectId
from repositories.base_repository import BaseRepository
from models.document import DocumentModel, DocumentStatus
from utils.db_utils import DatabaseManager

class DocumentRepository(BaseRepository[DocumentModel]):
    def __init__(self):
        collection = DatabaseManager.get_collection("documents")
        super().__init__(collection, DocumentModel)

    async def get_by_status(self, status: DocumentStatus) -> List[DocumentModel]:
        """Get documents by status."""
        return await self.get_all(filter={"status": status.value})

    async def get_assigned_to(self, user_id: str) -> List[DocumentModel]:
        """Get documents assigned to a user."""
        return await self.get_all(filter={"assigned_to": user_id})

    async def update_item_status(
        self,
        document_id: str,
        item_id: str,
        status: str
    ) -> bool:
        """Update status of a specific item in the document."""
        result = await self.collection.update_one(
            {
                "_id": ObjectId(document_id),
                "items.id": item_id
            },
            {
                "$set": {"items.$.status": status}
            }
        )
        return result.modified_count > 0
```

## Upload Routes (routes/upload_routes.py)

```python
from fastapi import APIRouter, UploadFile, File, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List
import os
import uuid
from datetime import datetime
from models.upload import FileUploadResponse, BatchUploadResponse
from jwt_handler import JWTHandler

router = APIRouter()
security = HTTPBearer()
UPLOAD_DIR = "uploads"

async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> str:
    payload = JWTHandler.verify_token(credentials.credentials)
    return payload["user_id"]

@router.post("/", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id)
):
    """Upload a single file."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    file_ext = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    return FileUploadResponse(
        id=str(uuid.uuid4()),
        filename=file.filename,
        content_type=file.content_type,
        size=len(content),
        upload_path=file_path,
        created_at=datetime.utcnow()
    )

@router.post("/batch", response_model=BatchUploadResponse)
async def upload_multiple_files(
    files: List[UploadFile] = File(...),
    user_id: str = Depends(get_current_user_id)
):
    """Upload multiple files."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    uploaded = []
    errors = []

    for file in files:
        try:
            file_ext = os.path.splitext(file.filename)[1]
            unique_filename = f"{uuid.uuid4()}{file_ext}"
            file_path = os.path.join(UPLOAD_DIR, unique_filename)

            content = await file.read()
            with open(file_path, "wb") as f:
                f.write(content)

            uploaded.append(FileUploadResponse(
                id=str(uuid.uuid4()),
                filename=file.filename,
                content_type=file.content_type,
                size=len(content),
                upload_path=file_path,
                created_at=datetime.utcnow()
            ))
        except Exception as e:
            errors.append(f"{file.filename}: {str(e)}")

    return BatchUploadResponse(
        success_count=len(uploaded),
        failed_count=len(errors),
        files=uploaded,
        errors=errors
    )
```
