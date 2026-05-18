---
name: ui-testing-guide
description: Reviews and fixes React UI applications. MANDATORY browser testing with Playwright MCP to verify all buttons work and user workflows complete. Includes code review checklists, common fixes, and workflow verification. Triggers on requests to test UI, review UI, fix UI issues, or quality assurance.
---

# UI Testing Guide

This skill reviews React applications, identifies issues, and automatically fixes them.

**IMPORTANT:** This skill includes MANDATORY browser-based testing using Playwright MCP to verify all UI elements work correctly and user workflows are complete.

---

## CRITICAL: USE HANDOFF.MD FOR TESTING

**Before testing, you MUST reference HANDOFF.md Phase 1 (Frontend) to know WHAT to test.**

### Required Inputs from HANDOFF.md Phase 1

1. **Screen Inventory** - All screens with routes, entry/exit points
2. **User Journeys** - Step-by-step paths users take
3. **State Transitions** - What buttons lead where
4. **Button Inventory** - All buttons per screen with expected actions
5. **API Requirements** - What API calls each action makes

### Test Against the Design, Not Just the Code

```
HANDOFF.md Phase 1 says:    You verify:
─────────────────────────────────────────────────
Login → Queue on success    Click login, ends at /queue
Queue → Coding on Start     Click Start Coding, ends at /coding/:id
Coding → Queue on Complete  Click Complete, ends at /queue
Queue → Login on Logout     Click Logout, ends at /login
```

---

## REVIEW PROCESS

### Phase 1: Project Structure Review

1. **Verify project structure** - Ensure all required files exist:
   ```
   - package.json (with correct dependencies)
   - vite.config.js / tailwind.config.js
   - src/App.jsx (with proper routing)
   - src/components/ (all required components)
   - public/ (logos and assets)
   ```

2. **Check imports** - Verify all imports resolve correctly

### Phase 2: UI/UX Review

#### Layout Issues
- [ ] **Overflow problems** - Content exceeding container bounds
- [ ] **Overlapping elements** - Z-index conflicts, absolute positioning
- [ ] **Scroll issues** - Missing `overflow-y-auto` on scrollable containers
- [ ] **Height constraints** - PDFViewer needs explicit height (`h-screen`, `h-full`)
- [ ] **Flexbox issues** - Missing `flex-shrink-0` on headers/footers

#### Visual Consistency
- [ ] **Color scheme** - Using PenguinAI brand colors (`#fc459d`, gradients)
- [ ] **Spacing** - Consistent padding/margin (use Tailwind scale)
- [ ] **Border radius** - Consistent rounding (`rounded-xl`, `rounded-2xl`)

### Phase 3: Code Quality Review

#### React Best Practices
- [ ] **useMemo/useCallback** - Memoize expensive computations
- [ ] **Key props** - Unique keys for list items
- [ ] **Event handlers** - Proper `stopPropagation` where needed
- [ ] **Cleanup** - useEffect cleanup functions for subscriptions/timers

### Phase 4: Functional Review

#### Navigation
- [ ] **Route protection** - Auth guards on protected routes
- [ ] **Redirects** - Proper redirect logic after login/logout

#### Forms
- [ ] **Validation** - Required fields enforced
- [ ] **Error states** - Error messages displayed properly
- [ ] **Loading states** - Buttons disabled during submission

---

## PHASE 5: BROWSER TESTING WITH PLAYWRIGHT MCP (MANDATORY — CANNOT BE SKIPPED)

**This phase is REQUIRED and must be performed for every UI review.**

**Execution is automatic once infrastructure is ready.** Navigate and test all workflows without asking permission for each test. Plan approval covers all browser tests.

### 5.0 CRITICAL: Use Only User-Provided Test Data

**All testing MUST use data provided by the user, inserted into S3/DB.**

1. **Get test data from user** — Files, records, or fixtures
2. **Insert into S3/DB** — Before any testing begins
3. **Test with ONLY this data** — Real IDs, real files, real records
4. **If unclear** — ASK USER what data to use

❌ NEVER:
- Mock data in components
- Invented test records
- Hardcoded IDs not from user data

### 5.1 Setup Browser Testing

1. **Start the development server:**
   ```bash
   cd [app-directory]
   npm run dev &
   ```
   Wait for server to start (http://localhost:5173)

2. **Initialize browser context:**
   - Use `mcp__playwright__browser_navigate` to open the application URL
   - Use `mcp__playwright__browser_snapshot` to get the accessibility tree

### 5.2 Test All Buttons and Interactive Elements

#### Login Page Testing
- [ ] Navigate to login page
- [ ] Take screenshot to verify layout
- [ ] Test username/password input fields
- [ ] Test login button (click and verify navigation)
- [ ] Verify redirect to main page after login

#### Navigation Testing
- [ ] Test all sidebar/navbar links
- [ ] Verify each link navigates to correct page
- [ ] Test logout button
- [ ] Test back buttons where applicable

#### Page-Specific Button Testing
- [ ] Use `mcp__playwright__browser_snapshot` to locate all buttons (by ref)
- [ ] Click each button with `mcp__playwright__browser_click` and verify expected behavior
- [ ] Take screenshots with `mcp__playwright__browser_take_screenshot` before and after clicks
- [ ] Document any buttons that don't respond

### 5.3 User Workflow Verification

**CRITICAL:** Test workflows defined in HANDOFF.md Phase 1, not just common patterns.

#### Test Each Journey Step-by-Step

```markdown
### Journey 1: First-time User (from HANDOFF.md Phase 1)
- [ ] Step 1: Navigate to /login → Login page displays
- [ ] Step 2: Enter demo@penguinai.co / demo123 → No errors
- [ ] Step 3: Click Sign In → Redirects to /queue
- [ ] Step 4: Queue shows documents → Documents visible
- [ ] Step 5: Click Start Coding → Navigates to /coding/:id
- [ ] Step 6: See PDF and codes → Both panels render
- [ ] Step 7: Click Accept on a code → Status changes
- [ ] Step 8: Click Complete → Redirects to /queue
- [ ] Step 9: Click Logout → Redirects to /login
```

#### Test State Transitions Table

| From | Action | Expected To | Actual | Pass? |
|------|--------|-------------|--------|-------|
| /login | Submit (success) | /queue | | |
| /queue | Start Coding | /coding/:id | | |
| /queue | Logout | /login | | |
| /coding | Complete | /queue | | |
| /coding | Back | /queue | | |

#### Test Button Inventory

| Button | Expected Action | Tested | Works? |
|--------|-----------------|--------|--------|
| Sign In | Submit form, redirect to /queue | | |
| Start Coding | Navigate to /coding/:id | | |
| Accept | Update code status | | |
| Complete | Mark doc complete, go to /queue | | |
| Logout | Clear token, go to /login | | |

### 5.4 Browser Testing Commands (Playwright MCP)

```javascript
// Navigate to URL
mcp__playwright__browser_navigate({ url: "http://localhost:5173" })

// Get accessibility snapshot (preferred over screenshot for actions)
mcp__playwright__browser_snapshot()

// Take screenshot (for visual verification)
mcp__playwright__browser_take_screenshot({ type: "png" })

// Click element by ref (from snapshot)
mcp__playwright__browser_click({ ref: "e36", element: "Sign In button" })

// Type text into element
mcp__playwright__browser_type({ ref: "e32", text: "demo@penguinai.co" })

// Fill multiple form fields at once
mcp__playwright__browser_fill_form({ fields: [
  { name: "Email", type: "textbox", ref: "e32", value: "demo@penguinai.co" },
  { name: "Password", type: "textbox", ref: "e35", value: "demo123" }
]})

// Read console for errors
mcp__playwright__browser_console_messages({ level: "error" })

// Check network requests
mcp__playwright__browser_network_requests({ includeStatic: false })

// Wait for text to appear
mcp__playwright__browser_wait_for({ text: "Dashboard" })
```

### 5.5 Document Browser Test Results

```markdown
## Browser Test Results

### Environment
- URL: http://localhost:5173
- Browser: Playwright MCP (Chromium)

### Buttons Tested
| Button | Location | Action | Result |
|--------|----------|--------|--------|
| Login | LoginPage | Click | ✅ Navigates to Queue |
| Logout | Sidebar | Click | ✅ Redirects to Login |

### Workflows Tested
| Workflow | Steps | Status | Issues |
|----------|-------|--------|--------|
| Login Flow | 3 | ✅ Pass | None |

### Console Errors
- [List any JavaScript errors found]
```

---

## PHASE 6: DELEGATE MISSING FEATURES

If browser testing reveals missing functionality:

1. **Document the issue** with current state, expected state, user impact
2. **Record in HANDOFF.md Phase 3** — the orchestrator decides whether to re-run ui-builder
3. **Re-test** after fixes are applied

---

## COMMON FIXES

### Fix 1: PDFViewer Height Issues
```jsx
// WRONG
<div><PDFViewer documentData={data} /></div>

// CORRECT
<div className="h-screen flex">
  <div className="w-3/5 h-full">
    <PDFViewer documentData={data} className="h-full" />
  </div>
</div>
```

### Fix 2: Z-index Hierarchy
```jsx
<header className="... z-50">  {/* Highest */}
<aside className="... z-40">   {/* Sidebar */}
<main className="... z-10">    {/* Content */}
```

### Fix 3: Scrollable Container
```jsx
<div className="h-full flex flex-col overflow-hidden">
  <header className="flex-shrink-0">...</header>
  <main className="flex-1 overflow-y-auto">{content}</main>
</div>
```

### Fix 4: Click Event Bubbling
```jsx
<button onClick={(e) => {
  e.stopPropagation()
  handleButtonClick()
}}>
```

### Fix 5: Loading States
```jsx
const [isLoading, setIsLoading] = useState(false)

<button disabled={isLoading}>
  {isLoading ? 'Loading...' : 'Submit'}
</button>
```

See `templates/common-fixes.md` for more patterns.

---

## EXECUTION STEPS

### Step 1: Code Review
1. Identify the application directory
2. Read all components (.jsx/.js files)
3. Run the checklist - go through each review category
4. Document issues found
5. Apply fixes using Edit tool
6. Verify build with `npm run build`

### Step 2: Browser Testing (MANDATORY)
7. Start dev server: `npm run dev &`
8. Open browser with Playwright MCP
9. Test all buttons - click every button and verify
10. Test all workflows - complete each user journey
11. Check console for errors
12. Document results

### Step 3: Handle Missing Features
13. List missing workflows/functionality
14. Document in HANDOFF.md Phase 3 for orchestrator
15. Re-test after changes

### Step 4: Final Report
16. Summarize changes and fixes applied
17. Report browser test outcomes
18. Clean up (stop dev server)

---

## PRIORITY ORDER FOR FIXES

1. **Critical** - Build errors, broken functionality
2. **High** - UI layout issues, overflow problems, non-working buttons
3. **Medium** - Missing loading states, validation
4. **Low** - Code style, minor optimizations

---

## BROWSER TESTING FAILURE HANDLING

### Non-working Button
1. Take screenshot showing the button
2. Check console for errors
3. Read the component code
4. Fix the onClick handler or navigation logic
5. Re-test in browser

### Playwright Click Not Triggering React Handlers

Playwright's `browser_click` may fail to trigger React event handlers on elements inside scrollable containers. The click "lands" but React's synthetic event system doesn't fire.

**Diagnosis:** Click the button → check React state via fiber inspection → state didn't change.

**Workaround:** Use `browser_evaluate` with native DOM click:

```javascript
// If browser_click doesn't trigger React handler:
mcp__playwright__browser_evaluate({
  function: `() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.includes('TARGET_BUTTON_TEXT')) {
        btn.click();
        break;
      }
    }
  }`
})
```

**When to use:** If `browser_click` produces no visible change but the element is confirmed clickable (visible, not disabled), try the evaluate fallback before assuming the feature is broken.

**This is NOT a user-facing bug** — real browser clicks work correctly. It's a Playwright MCP interaction quirk with React's event system in scrollable containers.

### Verifying S3 Presigned URLs

When page images or S3-hosted files don't load, the browser may show `ERR_BLOCKED_BY_ORB` which masks the real error. **Always verify presigned URLs with `curl` first:**

```bash
# Test the actual presigned URL — reveals the real HTTP status and error
curl -I "https://bucket.s3.amazonaws.com/key?X-Amz-..."
```

Common root causes behind ORB errors:
| curl Result | Root Cause | Fix |
|-------------|-----------|-----|
| HTTP 400 "region is wrong" | S3 client signing with wrong region | Fix `AWS_REGION_NAME` for S3 |
| HTTP 403 Forbidden | Invalid credentials | Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` |
| HTTP 403 AccessDenied | Wrong bucket permissions | Check IAM policy |
| HTTP 200 but `Content-Type: application/octet-stream` | Missing ContentType on upload | Set `ContentType` via `mimetypes.guess_type()` |

### Verifying Bounding Box Rendering

When "View Source in PDF" or bbox highlighting doesn't show overlays:

1. **Check DOM for overlay elements:**
```javascript
mcp__playwright__browser_evaluate({
  function: `() => {
    const overlays = document.querySelectorAll('[class*="yellow"]');
    return { count: overlays.length };
  }`
})
```

2. **Check React state via fiber inspection:**
```javascript
mcp__playwright__browser_evaluate({
  function: `() => {
    const img = document.querySelector('img[alt^="Page"]');
    const fiberKey = Object.keys(img).find(k => k.startsWith('__reactFiber'));
    let fiber = img[fiberKey];
    while (fiber) {
      if (fiber.type?.name === 'PDFViewer') {
        return { bboxCount: fiber.memoizedProps?.boundingBoxes?.length };
      }
      fiber = fiber.return;
    }
  }`
})
```

3. **Check MongoDB for bbox data** (bypasses all frontend issues):
```bash
python3 -c "
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
async def check():
    db = AsyncIOMotorClient('mongodb://localhost:27017')['{database_name}']
    result = await db['{results_collection}'].find_one({'{entity_id_field}': 'THE_ID'})
    # Traverse result to find fields with bboxes
    ...
asyncio.run(check())
"
```

**Debugging checklist for invisible bboxes:**
- [ ] API returns bboxes (check with `curl` or `browser_evaluate` fetch)
- [ ] React component receives bboxes (fiber inspection)
- [ ] Coordinates are 0-1 normalized (not inches, not pixels)
- [ ] `document_name` matches the current file in PDFViewer
- [ ] `page_number` matches the current page being viewed

### Broken Workflow
1. Document which step fails
2. Identify the component responsible
3. If minor: Apply fix directly
4. If major: Document in HANDOFF.md Phase 3 for orchestrator

---

## TEST-DRIVEN DEVELOPMENT (TDD) REQUIREMENTS

**TDD is not optional.** Tests are written BEFORE code, not after.

### Test Ownership

| Who | Writes | When |
|-----|--------|------|
| **Orchestrator** | Test fixtures with expected outputs | Phase 0, before any code |
| **ui-builder** | Component tests, route tests | BEFORE writing components |
| **api-builder** | Integration tests (real HTTP) | BEFORE writing endpoints |
| **ai-integrator** | Pipeline tests with REAL data | BEFORE writing pipeline |
| **quality-tester** | Runs ALL tests, verifies results | After all phases, blocks deploy |

### Per-Phase Test Requirements

| Phase | Test Type | Tools | Acceptance Criteria |
|-------|-----------|-------|---------------------|
| Phase 0 | Test fixtures | JSON files | Golden case with expected outputs defined |
| Phase 1 | Component + route tests | Vitest | Every screen renders, routes resolve |
| Phase 2 | Integration tests (REAL HTTP) | pytest + httpx | Real HTTP calls, not mocks |
| Phase 2.5 | Pipeline tests (REAL DATA) | pytest | Run on golden_case, verify expected_output matches |
| Phase 3 | E2E + smoke tests | pytest + browser | All tests pass, golden case produces expected output |

### Integration Test Requirements

```python
# tests/integration/test_api.py - MUST use real HTTP, not mocks

def test_login_returns_token():
    """Real HTTP test - not mocked."""
    response = httpx.post("http://localhost:8000/api/v1/auth/login",
                         data={"username": "demo@penguinai.co", "password": "demo123"})
    assert response.status_code == 200
    assert "access_token" in response.json()

def test_evaluation_produces_results():
    """Trigger real evaluation, verify results have citations."""
    # 1. Login
    # 2. Trigger evaluation on golden_case
    # 3. Wait for completion
    # 4. Verify: results match expected_output.json
```

### Acceptance Criteria Validation

Before any phase is marked complete, these MUST pass:

| Check | Criteria | Failure = Block |
|-------|----------|-----------------|
| Golden case test | Expected output matches | YES |
| Citation count | >= min_citations from fixture | YES |
| No empty results | At least 1 criterion has supporting_texts (non-empty array) | YES |
| Integration tests | All pytest tests pass | YES |
| No TODO/FIXME | grep returns 0 | YES |

Test locations: Backend `tests/`, Frontend `*.test.tsx` or `__tests__/`

---

## POST-TASK CLEANUP

**After completing any task, clean up unnecessary files:**

### Remove These Files
- Auto-generated README.md files (unless explicitly requested)
- CHANGELOG.md (unless requested)
- CONTRIBUTING.md
- Duplicate documentation files
- Empty or placeholder markdown files
- `.md` files created during development that aren't needed

### Keep These Files
- `HANDOFF.md` - Inter-agent communication file, required across all phases
- `.env.example` - Environment template
- Project's main README if explicitly requested

### Cleanup Commands

```bash
# Review and remove unnecessary markdown files
find . -name "README.md" -path "*/src/*" -delete
find . -name "*.md" -empty -delete

# Verify no TODO/FIXME comments
grep -rn "TODO" --include="*.py" --include="*.js" --include="*.jsx" .
grep -rn "FIXME" --include="*.py" --include="*.js" --include="*.jsx" .
```

---

## IMPORTANT NOTES

- **Browser testing is MANDATORY** - Never skip Phase 5
- **Test EVERY button** - Not just the main ones
- **Complete workflows** - Don't stop at individual button clicks
- **Test against HANDOFF.md Phase 1 design** - Not just what you see
- **Re-test after fixes** - Always verify changes work in browser
- **Clean up** - Stop dev server when done

---

## Progressive Disclosure

For detailed patterns, see:
- `templates/review-checklist.md` - Full review checklist
- `templates/common-fixes.md` - Extended fix patterns
