# UI Builder Templates

> Referenced by `.claude/agents/ui-builder.md`. Read during implementation, not during planning.

---

## Execution Checklist

### Phase 1: Requirements Analysis
1. [ ] Read `HANDOFF.md` — understand data model, status enums, workflow
2. [ ] Identify application type from problem statement
3. [ ] List ALL screens needed (minimum: Login, Dashboard, Detail)
4. [ ] Map user states (logged out, logged in, in workflow)
5. [ ] Define ALL user journeys from start to finish
6. [ ] Create state transition table for every screen
7. [ ] Inventory ALL buttons needed per screen

### Phase 2: Project Setup
8. [ ] Create project with Vite + React
9. [ ] Install dependencies (react-router-dom, heroicons, mui, tailwind)
10. [ ] Copy data-labelling-library to src/lib/pdf-viewer
11. [ ] Copy PenguinAI logos to public/
12. [ ] Configure Tailwind CSS v4
13. [ ] Set up index.css with custom classes

### Phase 3: Core Infrastructure
14. [ ] Create App.jsx with React Router
15. [ ] Define ALL routes upfront (from screen inventory)
16. [ ] Implement route protection (auth checks)
17. [ ] Create Layout component with sidebar/header
18. [ ] Create API service layer (src/services/api.js)
19. [ ] Create .env.development with API URL

### Phase 4: Screen Implementation
For EACH screen in the inventory:
20. [ ] Create component file
21. [ ] Implement visual layout (from template patterns)
22. [ ] Add ALL buttons identified in inventory
23. [ ] Wire up navigation handlers (onClick -> navigate)
24. [ ] Wire up action handlers (onClick -> API call)
25. [ ] Add loading skeletons, error banners, empty states
26. [ ] Add WebSocket connection for real-time status (where applicable)

### Phase 5: Integration & Output
27. [ ] Connect all screens via routing
28. [ ] Ensure all navigation paths work
29. [ ] Test complete user journeys
30. [ ] Verify logout properly clears state
31. [ ] Run `npm run build` to check for errors
32. [ ] Run production-enforcement verification commands
33. [ ] Append Phase 1 section to `HANDOFF.md`

---

## Output Format

When complete, the Phase 1 section in HANDOFF.md must include:

```json
{
  "screens": [
    {
      "route": "/login",
      "component": "LoginPage",
      "purpose": "User authentication"
    },
    {
      "route": "/dashboard",
      "component": "Dashboard",
      "purpose": "List items with filters/sorting"
    }
  ],
  "buttons": [
    {
      "label": "Sign In",
      "location": "/login",
      "action": "submit_login",
      "api_call": "POST /api/v1/auth/login",
      "navigation": "/dashboard"
    }
  ],
  "api_endpoints_required": [
    {
      "method": "POST",
      "path": "/api/v1/auth/login",
      "request": "form-urlencoded: username, password (default per HANDOFF.md)",
      "response": { "access_token": "string", "token_type": "string" },
      "status_codes": [200, 401]
    }
  ],
  "files_created": [
    "src/App.jsx",
    "src/pages/LoginPage.jsx",
    "src/pages/Dashboard.jsx"
  ],
  "env_vars": ["VITE_API_URL"],
  "build_status": "passing"
}
```

---

## Return Format

When complete, return:

```markdown
## UI Builder Complete

### Application
- Directory: [app-path]
- Dev Server: npm run dev -> http://localhost:5173
- Build Status: Passing

### Screens Created
1. /login - Login page
2. /dashboard - Item list with filters/sorting
3. /items/:id - Detail/annotation view

### Production Verification
- TODO/FIXME grep: 0 results
- Mock data grep: 0 results
- All buttons wired: Yes

### HANDOFF.md
- Phase 1 section appended with screen inventory, button inventory, API requirements

Ready for Phase 2: api-builder
```
