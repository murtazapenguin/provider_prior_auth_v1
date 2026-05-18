# FastAPI Patterns Reference

Detailed code patterns from platform-backend-kit for building FastAPI backends.

## App Initialization (app.py)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

# Global database client
db_client = None
db = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - connect/disconnect from MongoDB."""
    global db_client, db

    # Startup
    db_client = AsyncIOMotorClient("mongodb://localhost:27017/")
    db = db_client["penguin_app"]
    print("Connected to MongoDB")

    yield

    # Shutdown
    if db_client:
        db_client.close()
        print("Disconnected from MongoDB")

app = FastAPI(
    title="PenguinAI Backend",
    description="Backend API for PenguinAI applications",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
from routes.auth_routes import router as auth_router
from routes.document_routes import router as document_router

app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(document_router, prefix="/api/v1/documents", tags=["Documents"])

@app.get("/health")
async def health_check():
    return {"status": "ok"}
```

## Password Hashing (auth.py)

```python
import bcrypt

class Auth:
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using bcrypt."""
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')

    @staticmethod
    def verify_password(password: str, hashed_password: str) -> bool:
        """Verify a password against its hash."""
        return bcrypt.checkpw(
            password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
```

## JWT Token Handler (jwt_handler.py)

```python
import jwt
from datetime import datetime, timedelta
from typing import Optional
from fastapi import HTTPException, status

SECRET_KEY = "your-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

class JWTHandler:
    @staticmethod
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Create a JWT access token."""
        to_encode = data.copy()

        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt

    @staticmethod
    def verify_token(token: str) -> dict:
        """Verify and decode a JWT token."""
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            return payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has expired"
            )
        except jwt.InvalidTokenError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )
```

## Database Utilities (utils/db_utils.py)

```python
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import Optional

class DatabaseManager:
    _client: Optional[AsyncIOMotorClient] = None
    _db: Optional[AsyncIOMotorDatabase] = None

    @classmethod
    async def connect(cls, connection_string: str, database_name: str):
        """Connect to MongoDB."""
        cls._client = AsyncIOMotorClient(connection_string)
        cls._db = cls._client[database_name]
        await cls._client.admin.command('ping')
        print(f"Connected to MongoDB database: {database_name}")

    @classmethod
    async def disconnect(cls):
        """Disconnect from MongoDB."""
        if cls._client:
            cls._client.close()
            cls._client = None
            cls._db = None

    @classmethod
    def get_db(cls) -> AsyncIOMotorDatabase:
        """Get database instance."""
        if cls._db is None:
            raise RuntimeError("Database not connected")
        return cls._db

    @classmethod
    def get_collection(cls, collection_name: str):
        """Get a specific collection."""
        return cls.get_db()[collection_name]
```

## Repository Pattern (repositories/base_repository.py)

```python
from typing import Generic, TypeVar, Optional, List
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorCollection
from pydantic import BaseModel

T = TypeVar('T', bound=BaseModel)

class BaseRepository(Generic[T]):
    def __init__(self, collection: AsyncIOMotorCollection, model: type[T]):
        self.collection = collection
        self.model = model

    async def create(self, data: dict) -> str:
        """Create a new document."""
        result = await self.collection.insert_one(data)
        return str(result.inserted_id)

    async def get_by_id(self, id: str) -> Optional[T]:
        """Get document by ID."""
        doc = await self.collection.find_one({"_id": ObjectId(id)})
        if doc:
            doc["id"] = str(doc.pop("_id"))
            return self.model(**doc)
        return None

    async def get_all(self, filter: dict = None, skip: int = 0, limit: int = 100) -> List[T]:
        """Get all documents with optional filtering."""
        cursor = self.collection.find(filter or {}).skip(skip).limit(limit)
        documents = []
        async for doc in cursor:
            doc["id"] = str(doc.pop("_id"))
            documents.append(self.model(**doc))
        return documents

    async def update(self, id: str, data: dict) -> bool:
        """Update a document."""
        result = await self.collection.update_one(
            {"_id": ObjectId(id)},
            {"$set": data}
        )
        return result.modified_count > 0

    async def delete(self, id: str) -> bool:
        """Delete a document."""
        result = await self.collection.delete_one({"_id": ObjectId(id)})
        return result.deleted_count > 0

    async def count(self, filter: dict = None) -> int:
        """Count documents."""
        return await self.collection.count_documents(filter or {})
```

## Configuration (config.py)

```python
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # MongoDB
    mongodb_connection_string: str = "mongodb://localhost:27017/"
    database_name: str = "penguin_app"

    # JWT
    jwt_secret_key: str = "your-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True

    # CORS
    allowed_origins: str = "http://localhost:5173,http://localhost:3000"

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()
```

## Environment Variables (.env)

```
# MongoDB
MONGODB_CONNECTION_STRING=mongodb://localhost:27017/
DATABASE_NAME=penguin_icd_coding

# JWT
JWT_SECRET_KEY=your-secret-key-change-in-production
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

# Server
HOST=0.0.0.0
PORT=8000
DEBUG=True

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

## Seed Data Script (seed_data.py)

```python
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
from auth import Auth

async def seed():
    client = AsyncIOMotorClient("mongodb://localhost:27017/")
    db = client["penguin_icd_coding"]

    # Create test user
    await db.users.delete_many({})
    await db.users.insert_one({
        "username": "demo",
        "email": "demo@penguinai.co",
        "full_name": "Demo User",
        "role": "coder",
        "hashed_password": Auth.hash_password("demo123"),
        "is_active": True,
        "created_at": datetime.utcnow()
    })

    # Create test documents
    await db.documents.delete_many({})
    await db.documents.insert_many([
        {
            "name": "patient_record_001.pdf",
            "patient_name": "John Doe",
            "patient_id": "P001",
            "status": "pending",
            "pages": {"1": "/images/page1.png", "2": "/images/page2.png"},
            "icd_codes": [
                {"id": "code1", "code": "J06.9", "description": "Acute upper respiratory infection", "status": "pending"},
                {"id": "code2", "code": "R05", "description": "Cough", "status": "pending"}
            ],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        },
        {
            "name": "patient_record_002.pdf",
            "patient_name": "Jane Smith",
            "patient_id": "P002",
            "status": "pending",
            "pages": {"1": "/images/page1.png"},
            "icd_codes": [
                {"id": "code1", "code": "I10", "description": "Essential hypertension", "status": "pending"}
            ],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
    ])

    print("Seed data created!")
    print("Test user: demo@penguinai.co / demo123")
    client.close()

if __name__ == "__main__":
    asyncio.run(seed())
```
