# API Builder Templates

> Referenced by `.claude/agents/api-builder.md`. Read during implementation, not during planning.

---

## Execution Checklist

### Phase 1: Gather Requirements
1. [ ] Read `HANDOFF.md` — Phase 0 (data model) + Phase 1 (API requirements)
2. [ ] Review frontend src/services/api.js for expected endpoints
3. [ ] Identify all status enums from HANDOFF.md and frontend components
4. [ ] Map button actions to API endpoints
5. [ ] Document data shapes frontend expects

### Phase 2: Project Setup
6. [ ] Create backend/ directory in app root
7. [ ] Create project directory structure
8. [ ] Write requirements.txt with dependencies
9. [ ] Create .env file with configuration
10. [ ] Write config.py for environment loading

### Phase 3: Authentication
11. [ ] Create auth.py with password hashing
12. [ ] Create jwt_handler.py for token management
13. [ ] Create models/user.py with User schema
14. [ ] Create routes/auth_routes.py with login/register/me

### Phase 4: Domain Models
15. [ ] Create domain models with status enums matching HANDOFF.md
16. [ ] Ensure snake_case field names for JSON
17. [ ] Include all fields frontend expects
18. [ ] Create repository layer for MongoDB operations

### Phase 5: API Routes
19. [ ] Create route files for each domain
20. [ ] Implement all CRUD endpoints from HANDOFF.md requirements
21. [ ] Implement all action endpoints (status transitions, assignments)
22. [ ] Add `/api/v1/` prefix to all routes
23. [ ] Add `org_id` filtering on every query (multi-tenant)

### Phase 5b: S3 Presigned URLs (for PDF Viewer apps)

> **PDFViewer renders per-page PNG images, NOT raw PDFs.** If this project uses document viewing,
> seed data MUST include page images in S3. Without page images, PDFViewer shows blank pages and
> bbox highlighting breaks. The ai-integrator generates page images during processing, but golden
> case seed data needs them pre-generated.

24. [ ] Copy app/modules/storage/ from platform-backend-kit (StorageService for presigned URL flows)
25. [ ] Configure S3_BUCKET_NAME and S3_APP_PREFIX in .env
26. [ ] Implement presigned URL generation endpoints
27. [ ] Verify presigned_urls format matches PDFViewer (keys are page numbers as strings, values are S3 presigned URLs to PNG images)

### Phase 6: Integration
28. [ ] Create app.py with CORS allowing all origins (`*`)
29. [ ] Register all routers
30. [ ] Create seed_data.py script
31. [ ] Add health check: `GET /health` -> `{"status": "ok"}`
32. [ ] Start server and test health endpoint
33. [ ] Run seed script to populate test data
34. [ ] Run production-enforcement verification commands
35. [ ] Append Phase 2 section to `HANDOFF.md`

---

## Response Shapes (must match frontend)

Use domain-agnostic shapes that match what Phase 1 defines:

```python
# List response (paginated)
{
    "items": [{
        "id": "...",
        "title": "...",
        "status": "pending",
        ...
    }],
    "total": 10,
    "page": 1,
    "page_size": 20,
    "total_pages": 1
}

# Single item response
{
    "id": "...",
    "title": "...",
    "status": "pending",
    ...
}

# Async processing accepted
{
    "job_id": "...",
    "status": "pending",
    "message": "Processing started"
}
# HTTP 202 Accepted

# Error
{"detail": "Error message"}
```

---

## Output Format

When complete, the Phase 2 section in HANDOFF.md must include:

```json
{
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/v1/auth/login",
      "auth_required": false,
      "response": { "access_token": "string", "token_type": "string" }
    },
    {
      "method": "GET",
      "path": "/api/v1/items",
      "auth_required": true,
      "response": { "items": "array", "total": "number" }
    }
  ],
  "models": [
    {
      "collection": "users",
      "fields": ["id", "email", "org_id", "role", "hashed_password"],
      "indexes": ["email", "org_id"]
    }
  ],
  "seed_data": {
    "users": 2,
    "items": 6,
    "statuses_covered": ["pending", "processing", "review", "completed"]
  },
  "env_vars": ["MONGODB_URL", "JWT_SECRET", "S3_BUCKET_NAME", "S3_APP_PREFIX"],
  "files_created": [
    "backend/app.py",
    "backend/routes/auth_routes.py",
    "backend/models/user.py"
  ],
  "server_status": "running at :8000"
}
```

---

## Return Format

When complete, return:

```markdown
## API Builder Complete

### Backend
- Directory: [app-path]/backend
- Server: uvicorn app:app --reload --port 8000
- API Docs: http://localhost:8000/docs

### Endpoints Implemented
- POST /api/v1/auth/login
- POST /api/v1/auth/register
- GET /api/v1/auth/me
- GET /api/v1/items
- GET /api/v1/items/{id}
- PUT /api/v1/items/{id}
- [... all endpoints]

### Production Verification
- TODO/FIXME grep: 0 results
- Mock data grep: 0 results
- All queries use MongoDB: Yes

### Test Credentials
- Email: demo@penguinai.co
- Password: demo123

### HANDOFF.md
- Phase 2 section appended with endpoints, models, seed data, env vars

Ready for Phase 3: quality-tester
```
