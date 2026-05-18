---
name: production-enforcement
description: "Enforces production-ready code standards. Prevents mock data, placeholder functions, TODO comments, and stub implementations. Required skill for all agents."
---

# Production Enforcement Skill

This skill enforces production-ready code standards across all agents. Every agent MUST include this skill in their frontmatter.

---

## Core Principle: No Mocking Policy

**Zero tolerance for:**
- TODO, FIXME, HACK comments
- Hardcoded or mock data in production code paths
- Stub or placeholder functions
- "This would call the database" style comments
- Console.log as primary functionality
- Incomplete error handling

---

## Core Principle: Use Only User-Provided Data

**All code and testing MUST use data provided by the user, inserted into S3/DB.**

❌ FORBIDDEN:
- Mock data in components
- Hardcoded test responses
- Invented IDs or records
- Any data not provided by user

✅ REQUIRED:
- Insert user-provided data into S3/DB first
- Test with only this inserted data
- Reference real IDs from user data
- If unclear → ASK USER

---

## Forbidden Patterns

### Code Comments
```javascript
// ❌ FORBIDDEN
// TODO: Implement authentication
// FIXME: Add error handling
// HACK: Temporary workaround
// Placeholder for future implementation
```

### Mock Data
```javascript
// ❌ FORBIDDEN
const users = [{ id: 1, name: "Test User" }];  // Hardcoded
const items = [/* mock data */];
return { success: true };  // Stub response
```

### Placeholder Functions
```python
# ❌ FORBIDDEN
def process_document(file_path):
    pass  # Not implemented

def validate_user(token):
    return True  # Always returns true

async def fetch_data():
    # This would call the API
    return {}
```

### Console-Only Handlers
```javascript
// ❌ FORBIDDEN
onClick={() => console.log('clicked')}
onSubmit={() => console.log('submitted')}
```

### Hardcoded URLs (breaks inside Docker)
```javascript
// ❌ FORBIDDEN — breaks when frontend runs inside Docker container
const API_BASE = "http://localhost:8000/api/v1";
const wsUrl = "ws://localhost:8000/ws/";
axios.create({ baseURL: "http://localhost:8000" });

// ✅ REQUIRED — use relative URLs (works with both Vite proxy and nginx)
const API_BASE = "/api/v1";
const wsUrl = `ws://${window.location.host}/ws/`;
axios.create({ baseURL: "/api/v1" });
```

---

## Required Patterns

### Real Implementations
```javascript
// ✅ REQUIRED
const users = await db.collection('users').find({ org_id }).toArray();
const items = await api.get('/api/v1/items');
```

### Functional Handlers
```javascript
// ✅ REQUIRED
onClick={handleSubmit}  // Where handleSubmit does real work

async function handleSubmit() {
  try {
    const response = await api.post('/api/v1/items', data);
    navigate(`/items/${response.id}`);
  } catch (error) {
    setError(error.message);
  }
}
```

### Complete Error Handling
```python
# ✅ REQUIRED
async def process_document(file_path: str) -> dict:
    if not os.path.exists(file_path):
        raise HTTPException(404, f"File not found: {file_path}")

    try:
        result = await ocr_provider.process(file_path)
        return {"status": "success", "data": result}
    except OCRError as e:
        logger.error(f"OCR failed: {e}")
        raise HTTPException(500, f"OCR processing failed: {str(e)}")
```

---

## Verification Commands

Before marking any task complete, run these searches. **All must return ZERO results:**

```bash
# Search for TODO/FIXME comments
grep -rn "TODO" --include="*.py" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" .
grep -rn "FIXME" --include="*.py" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" .

# Search for mock/stub/placeholder
grep -rn "mock" --include="*.py" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" .
grep -rn "stub" --include="*.py" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" .
grep -rn "placeholder" --include="*.py" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" .

# Search for pass statements in Python (empty functions)
grep -rn "^\s*pass\s*$" --include="*.py" .

# Search for console.log in handlers (JS/TS)
grep -rn "onClick.*console.log" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" .

# Search for hardcoded localhost URLs (break inside Docker)
grep -rn "localhost:8000" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" .
grep -rn "localhost:8000" --include="*.env*" .
```

---

## Definition of Done Checklist

Every agent must verify these items before completion:

### Code Completeness
- [ ] NO TODO/FIXME/HACK comments anywhere in code
- [ ] NO mock or hardcoded data in production paths
- [ ] NO placeholder or stub functions
- [ ] NO empty pass statements
- [ ] All functions fully implemented with real logic

### Error Handling
- [ ] All API calls wrapped in try/catch
- [ ] Specific error messages (not generic)
- [ ] HTTP status codes used correctly
- [ ] User-facing errors are helpful

### Integration
- [ ] Real database queries (not mocked)
- [ ] Real API calls (not stubbed)
- [ ] Real authentication checks
- [ ] Real file operations
- [ ] NO hardcoded `localhost:8000` URLs — use relative `/api/v1` instead

### Verification
- [ ] Grep searches return zero forbidden patterns
- [ ] Code compiles/builds without errors
- [ ] Can be deployed immediately without changes

---

## Wrong vs Correct Examples

### Authentication

```python
# ❌ WRONG
def check_auth(token):
    return True  # TODO: Implement

# ✅ CORRECT
def check_auth(token: str) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        user = db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(401, "User not found")
        return User(**user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
```

### Data Fetching

```javascript
// ❌ WRONG
const [items, setItems] = useState([
  { id: 1, title: "Sample Item" },
  { id: 2, title: "Another Item" }
]);

// ✅ CORRECT
const [items, setItems] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  async function fetchItems() {
    try {
      const response = await api.get('/api/v1/items');
      setItems(response.data.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  fetchItems();
}, []);
```

### Button Handlers

```jsx
// ❌ WRONG
<button onClick={() => console.log('delete clicked')}>
  Delete
</button>

// ✅ CORRECT
<button onClick={handleDelete} disabled={deleting}>
  {deleting ? 'Deleting...' : 'Delete'}
</button>

async function handleDelete() {
  setDeleting(true);
  try {
    await api.delete(`/api/v1/items/${item.id}`);
    navigate('/dashboard');
  } catch (err) {
    setError(`Failed to delete: ${err.message}`);
  } finally {
    setDeleting(false);
  }
}
```

---

## Enforcement

This skill is automatically assigned to all agents. Agents MUST:

1. Include `production-enforcement` in their skills frontmatter
2. Include a "NO MOCKING ALLOWED" section in their agent file
3. Run verification commands before marking tasks complete
4. Include Definition of Done checklist in their completion report

Failure to enforce these standards results in code that cannot be deployed and requires rework.
