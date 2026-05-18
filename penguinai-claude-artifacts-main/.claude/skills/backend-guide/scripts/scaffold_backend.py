#!/usr/bin/env python3
"""
Backend Scaffolding Script
Creates a complete FastAPI backend project structure with MongoDB integration.

Usage:
    python scaffold_backend.py --name my-backend --db my_database
    python scaffold_backend.py --name icd-coding-backend --db penguin_icd_coding --port 8000
"""

import argparse
import os
from pathlib import Path

def create_file(path: Path, content: str):
    """Create a file with the given content."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    print(f"Created: {path}")

def scaffold_backend(name: str, db_name: str, port: int = 8000):
    """Create complete backend project structure."""

    base_dir = Path(name)
    base_dir.mkdir(exist_ok=True)

    # requirements.txt
    create_file(base_dir / "requirements.txt", """fastapi==0.109.0
uvicorn[standard]==0.27.0
motor==3.3.2
pydantic[email]==2.5.3
python-jose[cryptography]==3.3.0
bcrypt==4.1.2
python-multipart==0.0.6
python-dotenv==1.0.0
""")

    # .env
    create_file(base_dir / ".env", f"""# MongoDB
MONGODB_CONNECTION_STRING=mongodb://localhost:27017/
DATABASE_NAME={db_name}

# JWT
JWT_SECRET_KEY=change-this-secret-in-production
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

# Server
HOST=0.0.0.0
PORT={port}
DEBUG=True

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
""")

    # app.py
    create_file(base_dir / "app.py", f'''from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv()

# Global database
db_client = None
db = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_client, db

    # Startup
    db_client = AsyncIOMotorClient(os.getenv("MONGODB_CONNECTION_STRING"))
    db = db_client[os.getenv("DATABASE_NAME")]
    print(f"Connected to MongoDB: {{os.getenv('DATABASE_NAME')}}")

    yield

    # Shutdown
    if db_client:
        db_client.close()

app = FastAPI(
    title="{name.replace('-', ' ').title()} API",
    description="Backend API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routes.auth_routes import router as auth_router
from routes.document_routes import router as document_router

app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(document_router, prefix="/api/v1/documents", tags=["Documents"])

@app.get("/health")
async def health_check():
    return {{"status": "ok"}}

def get_db():
    return db
''')

    # auth.py
    create_file(base_dir / "auth.py", '''import bcrypt

class Auth:
    @staticmethod
    def hash_password(password: str) -> str:
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')

    @staticmethod
    def verify_password(password: str, hashed_password: str) -> bool:
        return bcrypt.checkpw(
            password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
''')

    # jwt_handler.py
    create_file(base_dir / "jwt_handler.py", '''import jwt
from datetime import datetime, timedelta
from typing import Optional
from fastapi import HTTPException, status
import os

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "secret")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

class JWTHandler:
    @staticmethod
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        to_encode = data.copy()
        expire = datetime.utcnow() + (expires_delta or timedelta(minutes=EXPIRE_MINUTES))
        to_encode.update({"exp": expire})
        return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

    @staticmethod
    def verify_token(token: str) -> dict:
        try:
            return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
''')

    # models/__init__.py
    create_file(base_dir / "models" / "__init__.py", "")

    # models/user.py
    create_file(base_dir / "models" / "user.py", '''from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    username: str
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: str = "user"

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class UserModel(UserBase):
    id: str
    hashed_password: str
    created_at: datetime = datetime.utcnow()
    is_active: bool = True

class UserResponse(UserBase):
    id: str
    created_at: datetime
    is_active: bool

class TokenResponse(BaseModel):
    token: str
    user: UserResponse
''')

    # models/document.py
    create_file(base_dir / "models" / "document.py", '''from pydantic import BaseModel
from typing import Optional, List, Dict
from datetime import datetime
from enum import Enum

class DocumentStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"

class ItemStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DENIED = "denied"

class WorkflowItem(BaseModel):
    id: str
    code: Optional[str] = None
    description: str
    status: ItemStatus = ItemStatus.PENDING
    confidence: Optional[float] = None
    evidence: List[str] = []

class DocumentBase(BaseModel):
    name: str
    patient_name: Optional[str] = None
    patient_id: Optional[str] = None

class DocumentCreate(DocumentBase):
    pages: Dict[str, str]

class DocumentModel(DocumentBase):
    id: str
    status: DocumentStatus = DocumentStatus.PENDING
    pages: Dict[str, str]
    items: List[WorkflowItem] = []
    assigned_to: Optional[str] = None
    created_at: datetime = datetime.utcnow()
    updated_at: datetime = datetime.utcnow()
    completed_at: Optional[datetime] = None

class DocumentResponse(DocumentModel):
    pass

class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]
    total: int
    page: int
    page_size: int
''')

    # routes/__init__.py
    create_file(base_dir / "routes" / "__init__.py", "")

    # routes/auth_routes.py
    create_file(base_dir / "routes" / "auth_routes.py", '''from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from models.user import UserCreate, UserLogin, TokenResponse, UserResponse, UserModel
from auth import Auth
from jwt_handler import JWTHandler
from datetime import datetime
from bson import ObjectId

router = APIRouter()
security = HTTPBearer()

def get_db():
    from app import get_db
    return get_db()

@router.post("/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    db = get_db()

    existing = await db.users.find_one({"username": user_data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username exists")

    user_dict = user_data.model_dump(exclude={"password"})
    user_dict["hashed_password"] = Auth.hash_password(user_data.password)
    user_dict["created_at"] = datetime.utcnow()
    user_dict["is_active"] = True

    result = await db.users.insert_one(user_dict)
    user_dict["id"] = str(result.inserted_id)

    token = JWTHandler.create_access_token({"sub": user_dict["username"], "user_id": user_dict["id"]})
    return TokenResponse(token=token, user=UserResponse(**user_dict))

@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    db = get_db()

    user = await db.users.find_one({"username": credentials.username})
    if not user or not Auth.verify_password(credentials.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user["id"] = str(user.pop("_id"))
    token = JWTHandler.create_access_token({"sub": user["username"], "user_id": user["id"]})
    return TokenResponse(token=token, user=UserResponse(**user))

@router.get("/me", response_model=UserResponse)
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    db = get_db()
    payload = JWTHandler.verify_token(credentials.credentials)

    user = await db.users.find_one({"_id": ObjectId(payload["user_id"])})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user["id"] = str(user.pop("_id"))
    return UserResponse(**user)
''')

    # routes/document_routes.py
    create_file(base_dir / "routes" / "document_routes.py", '''from fastapi import APIRouter, HTTPException, status, Depends, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from models.document import DocumentCreate, DocumentResponse, DocumentListResponse, DocumentStatus, ItemStatus
from jwt_handler import JWTHandler
from datetime import datetime
from bson import ObjectId

router = APIRouter()
security = HTTPBearer()

def get_db():
    from app import get_db
    return get_db()

async def get_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    return JWTHandler.verify_token(credentials.credentials)["user_id"]

@router.get("/queue", response_model=DocumentListResponse)
async def get_queue(
    status: Optional[DocumentStatus] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_id: str = Depends(get_user_id)
):
    db = get_db()
    filter_dict = {"status": status.value} if status else {}

    skip = (page - 1) * page_size
    cursor = db.documents.find(filter_dict).skip(skip).limit(page_size)

    documents = []
    async for doc in cursor:
        doc["id"] = str(doc.pop("_id"))
        documents.append(DocumentResponse(**doc))

    total = await db.documents.count_documents(filter_dict)
    return DocumentListResponse(documents=documents, total=total, page=page, page_size=page_size)

@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str, user_id: str = Depends(get_user_id)):
    db = get_db()
    doc = await db.documents.find_one({"_id": ObjectId(document_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc["id"] = str(doc.pop("_id"))
    return DocumentResponse(**doc)

@router.post("/", response_model=DocumentResponse, status_code=201)
async def create_document(document_data: DocumentCreate, user_id: str = Depends(get_user_id)):
    db = get_db()
    doc_dict = document_data.model_dump()
    doc_dict["status"] = DocumentStatus.PENDING.value
    doc_dict["items"] = []
    doc_dict["created_at"] = datetime.utcnow()
    doc_dict["updated_at"] = datetime.utcnow()

    result = await db.documents.insert_one(doc_dict)
    doc_dict["id"] = str(result.inserted_id)
    return DocumentResponse(**doc_dict)

@router.put("/{document_id}/start", response_model=DocumentResponse)
async def start_workflow(document_id: str, user_id: str = Depends(get_user_id)):
    db = get_db()
    result = await db.documents.update_one(
        {"_id": ObjectId(document_id)},
        {"$set": {"status": DocumentStatus.IN_PROGRESS.value, "assigned_to": user_id, "updated_at": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")

    doc = await db.documents.find_one({"_id": ObjectId(document_id)})
    doc["id"] = str(doc.pop("_id"))
    return DocumentResponse(**doc)

@router.put("/{document_id}/items/{item_id}", response_model=DocumentResponse)
async def update_item(document_id: str, item_id: str, item_status: ItemStatus = Query(...), user_id: str = Depends(get_user_id)):
    db = get_db()
    result = await db.documents.update_one(
        {"_id": ObjectId(document_id), "items.id": item_id},
        {"$set": {"items.$.status": item_status.value, "updated_at": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document or item not found")

    doc = await db.documents.find_one({"_id": ObjectId(document_id)})
    doc["id"] = str(doc.pop("_id"))
    return DocumentResponse(**doc)

@router.put("/{document_id}/complete", response_model=DocumentResponse)
async def complete_workflow(document_id: str, user_id: str = Depends(get_user_id)):
    db = get_db()
    doc = await db.documents.find_one({"_id": ObjectId(document_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    pending = [i for i in doc.get("items", []) if i.get("status") == "pending"]
    if pending:
        raise HTTPException(status_code=400, detail=f"{len(pending)} items pending")

    await db.documents.update_one(
        {"_id": ObjectId(document_id)},
        {"$set": {"status": DocumentStatus.COMPLETED.value, "completed_at": datetime.utcnow(), "updated_at": datetime.utcnow()}}
    )

    doc = await db.documents.find_one({"_id": ObjectId(document_id)})
    doc["id"] = str(doc.pop("_id"))
    return DocumentResponse(**doc)
''')

    # seed_data.py
    create_file(base_dir / "seed_data.py", f'''import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
from auth import Auth

async def seed():
    client = AsyncIOMotorClient("mongodb://localhost:27017/")
    db = client["{db_name}"]

    # Clear existing data
    await db.users.delete_many({{}})
    await db.documents.delete_many({{}})

    # Create test user
    await db.users.insert_one({{
        "username": "demo",
        "email": "demo@penguinai.co",
        "full_name": "Demo User",
        "role": "user",
        "hashed_password": Auth.hash_password("demo123"),
        "is_active": True,
        "created_at": datetime.utcnow()
    }})

    # Create test documents
    await db.documents.insert_many([
        {{
            "name": "document_001.pdf",
            "patient_name": "John Doe",
            "patient_id": "P001",
            "status": "pending",
            "pages": {{"1": "/images/page1.png", "2": "/images/page2.png"}},
            "items": [
                {{"id": "item1", "code": "A01", "description": "Item 1", "status": "pending"}},
                {{"id": "item2", "code": "B02", "description": "Item 2", "status": "pending"}}
            ],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }},
        {{
            "name": "document_002.pdf",
            "patient_name": "Jane Smith",
            "patient_id": "P002",
            "status": "pending",
            "pages": {{"1": "/images/page1.png"}},
            "items": [
                {{"id": "item1", "code": "C03", "description": "Item 3", "status": "pending"}}
            ],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }}
    ])

    print("Seed data created!")
    print("Test user: demo@penguinai.co / demo123")
    client.close()

if __name__ == "__main__":
    asyncio.run(seed())
''')

    print(f"\n✅ Backend project '{name}' created successfully!")
    print(f"\nNext steps:")
    print(f"  cd {name}")
    print(f"  pip install -r requirements.txt")
    print(f"  python seed_data.py  # Optional: create test data")
    print(f"  uvicorn app:app --reload --port {port}")
    print(f"\nAPI docs: http://localhost:{port}/docs")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scaffold a FastAPI backend project")
    parser.add_argument("--name", required=True, help="Project name")
    parser.add_argument("--db", required=True, help="Database name")
    parser.add_argument("--port", type=int, default=8000, help="Server port")

    args = parser.parse_args()
    scaffold_backend(args.name, args.db, args.port)
