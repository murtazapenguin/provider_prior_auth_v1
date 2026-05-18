# Quality Tester Templates

> Referenced by `.claude/agents/quality-tester.md`. Read during implementation, not during planning.

---

## Output Format

When complete, the Phase 3 section in HANDOFF.md must include:

```json
{
  "environment": {
    "frontend": "http://localhost:5173",
    "backend": "http://localhost:8000"
  },
  "code_review": {
    "issues_found": 3,
    "issues_fixed": 3,
    "build_status": "passing"
  },
  "production_verification": {
    "todo_grep": 0,
    "fixme_grep": 0,
    "mock_grep": 0,
    "console_log_handlers": 0
  },
  "button_tests": [
    { "button": "Sign In", "location": "/login", "tested": true, "works": true },
    { "button": "Logout", "location": "Header", "tested": true, "works": true }
  ],
  "workflow_tests": [
    { "workflow": "Login", "steps": 3, "status": "pass", "issues": "none" },
    { "workflow": "Main", "steps": 5, "status": "pass", "issues": "none" }
  ],
  "api_verification": [
    { "endpoint": "POST /api/v1/auth/login", "called_by": "LoginPage", "status": "working" }
  ],
  "contract_verification": {
    "api_response_shapes": "verified",
    "bbox_canonical_format": "verified",
    "pdfviewer_props": "verified",
    "error_response_format": "verified",
    "websocket_messages": "verified"
  },
  "console_errors": [],
  "issues_fixed": [
    "Fixed missing onClick handler on Submit button",
    "Added loading state to Dashboard"
  ],
  "remaining_issues": [],
  "final_status": "PRODUCTION READY"
}
```

---

## Test Report Template

```markdown
## Phase 3: Testing

### Environment
- Frontend: http://localhost:5173
- Backend: http://localhost:8000

### Code Review
- Issues found: [count]
- Issues fixed: [count]
- Build status: Passing

### Production Verification
- grep TODO: 0 results
- grep FIXME: 0 results
- grep mock: 0 results
- console.log handlers: 0 results

### Button Tests
| Button | Location | Tested | Works |
|--------|----------|--------|-------|
| Sign In | /login | Yes | Yes |
| Logout | Header/Sidebar | Yes | Yes |
| [button] | [screen] | [Yes/No] | [Yes/No] |

### Workflow Tests
| Workflow | Steps | Status | Issues |
|----------|-------|--------|--------|
| Login | 3 | Pass | None |
| [workflow] | [n] | [Pass/Fail] | [details] |

### API Integration
| Endpoint | Called By | Status |
|----------|-----------|--------|
| POST /api/v1/auth/login | LoginPage | Working |
| [endpoint] | [component] | [Working/Failed] |

### Contract Verification
| Contract | Reference | Status |
|----------|-----------|--------|
| API response shapes | api-contract.md | Verified |
| Bbox canonical format | CLAUDE.md Section 25 | Verified |
| PDFViewer props | frontend-guide | Verified |
| Error response format | {"detail": "..."} | Verified |
| WebSocket messages | {type, payload} | Verified / N/A |

### Console Errors
- [List any errors, or "None"]

### Issues Found and Fixed
- [List issues and fixes applied]

### Remaining Issues
- [List any issues not fixed, or "None"]

### Final Status: [PRODUCTION READY / NEEDS FIXES]
```

---

## Common Fixes

### Non-Working Button
1. Check onClick handler exists
2. Check navigation logic
3. Check API call configuration
4. Fix and re-test

### Broken Workflow
1. Identify which step fails
2. Check component responsible
3. If minor fix: Apply directly
4. If major: Document for relevant phase agent

### Console Errors
1. Document error message
2. Trace to source file
3. Fix underlying issue
4. Verify resolved

---

## Return Format

When complete, return:

```markdown
## Quality Tester Complete

### Test Summary
- Code Review: [X] issues found, [X] fixed
- Build: Passing
- Browser Tests: All buttons working
- Workflows: All passing
- API Integration: Verified

### Production Verification
- TODO/FIXME grep: 0 results
- Mock data grep: 0 results
- All buttons tested: [X]/[X]
- All workflows tested: [X]/[X]

### Contract Verification
- API response shapes: Verified
- Bbox canonical format: Verified
- PDFViewer props: Verified
- Error response format: Verified

### Application Ready
- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Test Credentials
- Email: demo@penguinai.co
- Password: demo123

### HANDOFF.md
- Phase 3 section appended with test matrices and final status

### Status: PRODUCTION READY
```
