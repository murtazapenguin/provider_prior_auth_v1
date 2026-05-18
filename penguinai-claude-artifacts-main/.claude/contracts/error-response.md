# Contract: error-response

## Overview
Defines the standard error response format for all API endpoints.

## Producer
- **api-builder** (Phase 2) - All error responses from FastAPI

## Consumers
- **ui-builder** (Phase 1) - Error handling in API hooks, toast notifications
- **quality-tester** (Phase 3) - Verifies error format consistency

## Schema

```json
{
  "detail": "string (human-readable error message)"
}
```

## Field Requirements

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `detail` | string | YES | Human-readable error message |

## HTTP Status Codes

| Code | Meaning | Example `detail` |
|------|---------|------------------|
| 400 | Bad Request | "Email is required" |
| 401 | Unauthorized | "Invalid credentials" |
| 403 | Forbidden | "Insufficient permissions" |
| 404 | Not Found | "Case not found" |
| 409 | Conflict | "Email already exists" |
| 422 | Validation Error | "Invalid email format" |
| 500 | Server Error | "Internal server error" |

## Examples

**401 Unauthorized:**
```json
{
  "detail": "Invalid credentials"
}
```

**404 Not Found:**
```json
{
  "detail": "Case with ID 12345 not found"
}
```

**422 Validation Error:**
```json
{
  "detail": "Email format is invalid"
}
```

## Frontend Usage

```javascript
// api-hooks.js
try {
  const response = await api.get('/cases');
} catch (error) {
  // MUST read from error.response.data.detail
  const message = error.response?.data?.detail || 'An error occurred';
  toast.error(message);
}
```

## Validation Rules

1. ALL error responses MUST have `detail` field
2. `detail` MUST be a string (not object, not array)
3. `detail` MUST be human-readable (not error codes)
4. Never expose stack traces or internal errors in `detail`

## FastAPI Implementation

```python
from fastapi import HTTPException

# Correct
raise HTTPException(status_code=404, detail="Case not found")

# Incorrect - will break frontend
raise HTTPException(status_code=404, detail={"error": "not found"})
```

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Return `error` instead of `detail` | Frontend can't display error | Use `detail` |
| Return object in `detail` | `[object Object]` shown | Use string |
| Expose stack trace | Security risk | Log internally, return generic message |
| Different format per endpoint | Inconsistent UX | Use global exception handler |
