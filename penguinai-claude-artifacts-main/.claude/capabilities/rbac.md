# Capability: rbac

## Description
Role-based access control. Multiple user roles with different permissions (e.g., Reviewer, Approver, Admin).

## Question
"What user roles are needed?"

## Options
- Single role (e.g., "Reviewer") — simple auth
- Multiple roles — define role list and permissions

## Follow-up Question (if Multiple)
"Define the roles and their permissions:"
- Role name
- What they can view
- What they can edit
- What they can approve

## Contracts Required
- `auth-response` — Extended with role field

## Schema Fields
When enabled, add to User model:

```python
# User model
role: str                       # Role identifier
permissions: list[str]          # Optional: explicit permissions

# If multiple roles
roles: list[str]                # User can have multiple roles
```

## Auth Response Schema
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "reviewer",
    "permissions": ["view_cases", "edit_cases"]
  }
}
```

## API Endpoints
When enabled, implement:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/auth/me` | Returns user with `role`/`permissions` fields |
| GET | `/api/v1/roles` | List available roles (admin only) |

All protected endpoints check user role before allowing action. Permission denied returns 403.

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/api/v1/auth/me` | GET | - | - | application/json |
| `/api/v1/roles` | GET | - | - | application/json |

**Response — GET /auth/me (with RBAC):**
```json
{
  "id": "user_123",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "reviewer",
  "permissions": ["view_cases", "edit_cases"]
}
```

**Error — 403 Forbidden:**
```json
{ "detail": "Insufficient permissions" }
```

## Data Types

### Pydantic Models (Backend)
```python
class UserWithRole(BaseModel):
    id: str
    email: str
    name: str
    role: str
    permissions: list[str] = []

class RoleDefinition(BaseModel):
    role: str
    permissions: list[str]
```

### TypeScript Interfaces (Frontend)
```typescript
interface UserWithRole {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

interface RoleDefinition {
  role: string;
  permissions: string[];
}
```

## UI Components
When enabled, include:
- Role-based route guards
- Conditional rendering based on permissions
- Role indicator in user menu

## Common Role Patterns

### Reviewer + Approver
```python
roles = {
  "reviewer": ["view_cases", "edit_cases"],
  "approver": ["view_cases", "edit_cases", "approve_cases", "deny_cases"],
  "admin": ["*"]
}
```

### View Only + Editor
```python
roles = {
  "viewer": ["view_items"],
  "editor": ["view_items", "edit_items"],
  "admin": ["*"]
}
```

## Dependencies
- JWT token includes role claim
- Backend validates role on protected endpoints
- Frontend checks permissions for UI elements
