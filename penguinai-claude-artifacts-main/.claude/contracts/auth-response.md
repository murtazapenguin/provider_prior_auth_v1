# Contract: auth-response

## Overview
Defines the authentication request AND response format for login endpoints.

## Producer
- **api-builder** (Phase 2) - Implements POST /api/v1/auth/login

## Consumers
- **ui-builder** (Phase 1) - AuthContext stores token, attaches to requests
- **quality-tester** (Phase 3) - Verifies login flow works

---

## Multiple Login Endpoints

The platform-backend-kit provides four login endpoints with two different JWT systems:

| Endpoint | Format | Token Field | JWT System | Returns User? |
|----------|--------|-------------|------------|---------------|
| `/auth/login` | form-urlencoded (`OAuth2PasswordRequestForm`) | `access_token` | `auth.py` (global secret, `sub` + `exp` claims) | No |
| `/auth/admin-login` | form-urlencoded (`OAuth2PasswordRequestForm`) | `access_token` | `auth.py` (global secret, `sub` + `exp` claims) | No |
| `/auth/basic_auth` | JSON (`BasicAuthRequest`) | `jwt_token` | `jwt_handler.py` (per-org secret, full user data + `exp`, `iat`, `aud`, `iss`) | Yes |
| `/auth/getToken` | JSON (SSO callback) | `jwt_token` | `jwt_handler.py` (per-org secret, full user data + `exp`, `iat`, `aud`, `iss`) | No |

**For new projects, use `/auth/login` (form-urlencoded).** This is the primary endpoint used by `Standard_UI_Template/LoginPage.jsx`.

---

## REQUEST FORMAT (CRITICAL)

### Content-Type: `application/x-www-form-urlencoded`

**NOT JSON.** FastAPI's OAuth2PasswordRequestForm requires form-urlencoded data.

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | YES | User's email (NOT `email`) |
| `password` | string | YES | User's password |

### Frontend Implementation (CORRECT)

```javascript
// AuthContext.jsx - MUST use form-urlencoded, NOT JSON
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

### Backend Implementation (CORRECT)

```python
# routes/auth.py - Uses OAuth2PasswordRequestForm
from fastapi.security import OAuth2PasswordRequestForm

@router.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = await authenticate_user(form_data.username, form_data.password)
    # ...
```

### Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Frontend sends JSON `{email, password}` | 422 Unprocessable Entity | Use URLSearchParams + form-urlencoded |
| Frontend uses `email` field | 422 - field not found | Use `username` field |
| Backend accepts JSON body | OAuth2 non-compliance | Use OAuth2PasswordRequestForm |

---

## RESPONSE FORMAT

### Content-Type: `application/json`

### `/auth/login` Response (Primary)

```json
{
  "access_token": "string (JWT)",
  "token_type": "bearer",
  "expires_in": "number (seconds, optional)"
}
```

### `/auth/basic_auth` Response (Includes User)

```json
{
  "jwt_token": "string (JWT)",
  "user": {
    "username": "string",
    "email": "string",
    "roles": ["string"],
    "org_name": "string"
  }
}
```

**Note:** The `user` object uses `roles` (plural array), `org_name` (not `org_id`), and has no `id` field. The `user` object is only returned by `/auth/basic_auth`, not by `/auth/login`.

## Field Requirements

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `access_token` | string | YES (for `/auth/login`) | JWT token for Bearer auth |
| `token_type` | string | YES (for `/auth/login`) | Must be "bearer" |
| `expires_in` | number | NO | Token expiry in seconds |
| `jwt_token` | string | YES (for `/auth/basic_auth`) | JWT token (different field name) |
| `user` | object | NO | User details (only from `/auth/basic_auth`) |

## Example

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

## Frontend Usage

```javascript
// AuthContext.jsx - MUST use form-urlencoded, NOT JSON
const login = async (email, password) => {
  const formData = new URLSearchParams();
  formData.append('username', email);  // Field MUST be 'username'
  formData.append('password', password);

  const response = await api.post('/api/v1/auth/login', formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  // MUST use access_token (not 'token')
  if (!response.data.access_token) {
    throw new Error('No token received');
  }

  localStorage.setItem('token', response.data.access_token);
};
```

## JWT Claims

The platform-backend-kit has two JWT systems with different claim structures:

### `auth.py` Tokens (used by `/auth/login`, `/auth/admin-login`)

| Claim | Type | Description |
|-------|------|-------------|
| `sub` | string | Username/email |
| `exp` | number | Expiration timestamp |

### `jwt_handler.py` Tokens (used by `/auth/basic_auth`, `/auth/getToken`)

| Claim | Type | Description |
|-------|------|-------------|
| `username` | string | Username |
| `preferred_username` | string | Preferred username |
| `roles` | string[] | User roles |
| `org_name` | string | Organization name |
| `short_org_name` | string | Short org name |
| `bucket_name` | string | S3 bucket name |
| `permissions` | object | Permission matrix |
| `exp` | number | Expiration timestamp |
| `iat` | number | Issued-at timestamp |
| `aud` | string | Audience (`"penguinai"`) |
| `iss` | string | Issuer (`"penguinai"`) |

## Validation Rules

1. `access_token` MUST be present and non-empty (for `/auth/login` responses)
2. `token_type` MUST equal "bearer" (case-insensitive)
3. Token MUST be valid JWT format
4. For `auth.py` tokens: contains `sub` + `exp` claims
5. For `jwt_handler.py` tokens: contains full user data + `exp`, `iat`, `aud`, `iss` claims

## Known Issues

1. `/auth/login` and `/auth/admin-login` return an extra `name` field in the response that is not part of the `Token` model definition.
2. Two different `User` models exist: `auth.py` defines one (with `preferred_username`, `entities`, etc.) and `models.py` defines another (with `permissions` dict). They have overlapping but different fields and defaults.

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Return `token` instead of `access_token` | Frontend auth breaks | Use `access_token` |
| Missing `token_type` | OAuth2 non-compliance | Always include |
| Expecting `org_id` in JWT claims | Claim not present | `auth.py` tokens only have `sub` + `exp`; use `jwt_handler.py` tokens for org data |
| Assuming single JWT system | Wrong token validation | Check which endpoint was used |
