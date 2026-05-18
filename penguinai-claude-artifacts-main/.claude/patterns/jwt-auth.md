# Pattern: JWT Authentication

Authentication patterns for FastAPI backends using platform-backend-kit.

---

## platform-backend-kit Auth Modules

| File | Purpose |
|------|---------|
| `app/modules/auth/dependencies.py` | `CurrentUser`, `require_roles()` |
| `app/modules/auth/routes.py` | Auth endpoints |
| `app/modules/auth/service.py` | Auth business logic |
| `app/modules/auth/models.py` | User, Tenant models |

```bash
cp -r platform-backend-kit/app/modules/auth backend/app/modules/
```

---

## CurrentUser Dependency

```python
from app.modules.auth.dependencies import CurrentUser, require_roles

# Protected endpoint
@router.get("/items")
async def list_items(user: CurrentUser):
    return await ItemService.list(user.tenant_id)

# Role-gated endpoint
@router.delete("/items/{id}", dependencies=[Depends(require_roles(["admin"]))])
async def delete_item(id: str, user: CurrentUser):
    ...
```

---

## Login Endpoint (OAuth2 form-urlencoded)

**IMPORTANT:** The default auth capability uses `OAuth2PasswordRequestForm` (form-urlencoded). If a user specifies JSON login, override this — user specs take precedence.

```python
from fastapi.security import OAuth2PasswordRequestForm

@router.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = await authenticate_user(form_data.username, form_data.password)
    token = create_access_token({"sub": user.email})
    return {"access_token": token, "token_type": "bearer"}
```

Frontend sends `URLSearchParams` with field named `username`:

```javascript
const formData = new URLSearchParams();
formData.append('username', email);  // Field MUST be 'username'
formData.append('password', password);
await api.post('/api/v1/auth/login', formData, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
});
```

---

## Simple JWT (without multi-tenancy)

```python
from jose import jwt
from datetime import datetime, timedelta

SECRET_KEY = os.getenv('JWT_SECRET')
ALGORITHM = "HS256"

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=30))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    username = payload.get("sub")
    return await db.users.find_one({"username": username})
```

---

## Environment Variables

```env
JWT_SECRET=your-secret-key-here
ACCESS_TOKEN_EXPIRE_MINUTES=30
SESSION_TOKEN_EXPIRY=21600
```

---

## Common Mistakes

| Mistake | Correct Approach |
|---------|------------------|
| JSON body for login | Use `OAuth2PasswordRequestForm` (form-urlencoded) |
| Field named `email` in request | Use `username` (required by OAuth2PasswordRequestForm) |
| Missing `token_type` in response | Always include `"token_type": "bearer"` |

---

## Where It's Used
- **backend-guide/SKILL.md** — Auth section
- **capabilities/authentication.md** — Full API formats + data types
