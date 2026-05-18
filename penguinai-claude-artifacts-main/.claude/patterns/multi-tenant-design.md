# Pattern: Multi-Tenant Design

Every app uses a shared MongoDB database with `org_id` filtering on every query. No separate databases per tenant.

---

## Multi-Tenant Collection Pattern

```python
from app.tenant import get_tenant_collection

async def list_items(tenant_id: str, skip: int = 0, limit: int = 50) -> dict:
    collection = get_tenant_collection("items")
    query_filter = {"tenant_id": tenant_id}
    total = await collection.count_documents(query_filter)
    cursor = collection.find(query_filter).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}
```

**Every query MUST include `org_id` (or `tenant_id`) as a filter.**

---

## TenantDatabaseManager (platform-backend-kit)

```python
# Copy from platform-backend-kit
cp platform-backend-kit/app/tenant.py backend/app/
```

Key exports:
- `get_tenant_collection(name)` — returns a Motor collection scoped to the current tenant
- `TenantContext` — contextvar holding the current `org_id`
- `TenantDatabaseManager` — manages per-tenant connection state

---

## Pagination Response Shape

```python
from app.common.schemas import PaginatedResponse

@router.get("/items", response_model=PaginatedResponse[ItemResponse])
async def list_items(user: CurrentUser, skip: int = 0, limit: int = 50):
    return await ItemService.list_items(user.tenant_id, skip=skip, limit=limit)
```

Standard response shape:
```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "page_size": 20,
  "total_pages": 5
}
```

---

## MongoDB Connection (Production)

Features from `platform-backend-kit`:
- Connection pooling with configurable pool size
- SSL/TLS support for AWS DocumentDB and MongoDB Atlas
- Automatic reconnection on connection drops

```env
MONGO_URI=mongodb://localhost:27017
METADATA_DB_NAME=platform-metadata
MONGO_POOL_SIZE=100
MONGO_TIMEOUT_MS=5000
```

For AWS DocumentDB:
```env
MONGO_URI=mongodb://user:pass@cluster.docdb.amazonaws.com:27017/?tls=true&tlsCAFile=global-bundle.pem&retryWrites=false
```

Copy the CA bundle:
```bash
cp platform-backend-kit/global-bundle.pem backend/
```

---

## User Schema (Every App)

```python
# Required fields on every user document
{
    "_id": str(uuid4()),
    "email": "user@example.com",
    "org_id": "org_default",          # REQUIRED for multi-tenant filtering
    "role": "reviewer",
    "hashed_password": get_password_hash("password"),
    "created_at": datetime.utcnow()
}
```

---

## Where It's Used
- **backend-guide/SKILL.md** — Multi-tenant collection pattern, MongoDB connection
- **CLAUDE.md** — Architecture section (shared DB, org_id filtering)
