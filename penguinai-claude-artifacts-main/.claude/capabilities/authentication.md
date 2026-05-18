# Capability: Authentication

## Description
JWT-based authentication with login/logout functionality.

## Status
**Always enabled** - Every project requires authentication.

## Question
N/A (always included)

## Contracts Required
- `auth-response` - Login response format
- `error-response` - Error response format

## Schema Fields

```python
User:
    user_id: str
    email: str
    org_id: str
    role: str
    hashed_password: str
```

## API Endpoints

| Endpoint | Method | Auth Required | Description |
|----------|--------|---------------|-------------|
| `/api/v1/auth/login` | POST | No | User login |
| `/api/v1/auth/logout` | POST | Yes | User logout |
| `/api/v1/auth/me` | GET | Yes | Get current user |
| `/api/v1/auth/refresh` | POST | Yes | Refresh token |

## API Formats (CRITICAL - Zero Transform)

### POST /api/v1/auth/login

| Attribute | Value |
|-----------|-------|
| Request Content-Type | `application/x-www-form-urlencoded` |
| Request Body | `username=string&password=string` |
| Response Content-Type | `application/json` |
| Response Body | `{"access_token": "string", "token_type": "bearer"}` |

**Backend Implementation:**
```python
# routes/auth.py - MUST use OAuth2PasswordRequestForm, NOT JSON
from fastapi.security import OAuth2PasswordRequestForm
from fastapi import Depends

@router.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = await authenticate_user(form_data.username, form_data.password)
    # ...
```

**Frontend Implementation:**
```javascript
// AuthContext.jsx - MUST send form-urlencoded, NOT JSON
const login = async (email, password) => {
  const formData = new URLSearchParams();
  formData.append('username', email);  // Field MUST be 'username'
  formData.append('password', password);

  const response = await api.post('/api/v1/auth/login', formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  localStorage.setItem('token', response.data.access_token);
};
```

### GET /api/v1/auth/me

| Attribute | Value |
|-----------|-------|
| Request Content-Type | - |
| Request Headers | `Authorization: Bearer {token}` |
| Response Content-Type | `application/json` |
| Response Body | `{"username": "string", "email": "string", "roles": ["string"], "org_name": "string"}` |

### POST /api/v1/auth/logout

| Attribute | Value |
|-----------|-------|
| Request Content-Type | `application/json` |
| Request Body | `{}` (empty) |
| Response Content-Type | `application/json` |
| Response Body | `{"message": "Logged out"}` |

## Data Types

> **Canonical schemas (Pydantic + TypeScript):** See `.claude/contracts/auth-response.md`
>
> Includes: `Token`, `UserResponse`
>
> **Note:** Login request uses `OAuth2PasswordRequestForm` (form-urlencoded). Frontend sends `URLSearchParams` with `username` and `password` fields.

## UI Components
- LoginPage with email/password form (sends as form-urlencoded with `username` field)
- AuthContext for token management
- ProtectedRoute wrapper

## Dependencies
- JWT_SECRET environment variable
- MongoDB users collection

## Common Mistakes to Avoid

| Mistake | Why It Happens | Correct Approach |
|---------|----------------|------------------|
| Using Pydantic BaseModel for login request | Seems cleaner than form data | Use `OAuth2PasswordRequestForm` (matches platform-backend-kit) |
| Frontend sends JSON `{email, password}` | Default axios/fetch behavior | Send `URLSearchParams` with `Content-Type: application/x-www-form-urlencoded` |
| Field named `email` in request | Intuitive naming | Use `username` (required by OAuth2PasswordRequestForm) |
| Missing `token_type` in response | Oversight | Always include `"token_type": "bearer"` |
