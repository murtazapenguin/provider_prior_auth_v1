# After Phase 3: Completion

---

## Final Output Format

After all phases complete, report this summary:

```markdown
## Full-Stack Application Ready

### Frontend (ui-builder)
- URL: http://localhost:5173
- Build: Passing
- Routes: [list routes]
- WebSocket: Connected

### Backend (api-builder)
- URL: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Health: http://localhost:8000/health → {"status": "ok"}
- Endpoints: [count] implemented

### Infrastructure
- Docker: docker-compose.yml (app + services per selected capabilities)
- MongoDB: Connected, seed data loaded
- [If async_processing] Celery: Workers running, retry policy configured
- [If async_processing] Redis: Connected (cache + broker)

### AI Processing (if `ai_extraction` capability)
- OCR: [provider per config] (if `document_processing`)
- LLM: [provider per config]
- Pipeline: Working
- Golden Case: Passed

### Tests (quality-tester)
- Backend Tests: [count] passing
- Frontend Tests: [count] passing
- Browser Tests: All workflows verified
- Contract Validation: All passing
- Console Errors: Zero

### Seed Data
- Users: demo@penguinai.co / demo123
- Items: [count] across all statuses

### Status: PRODUCTION READY
```

---

## Post-Task Cleanup

After completing any task, clean up unnecessary files.

### Remove These Files

- Auto-generated README.md files in subdirectories (unless explicitly requested)
- CHANGELOG.md (unless requested)
- CONTRIBUTING.md
- Duplicate documentation files
- Empty or placeholder markdown files
- `.md` files created during development that aren't needed

### Keep These Files

- `HANDOFF.md` - Inter-agent communication, required across all phases
- `.env.example` - Environment template
- Project's main README if explicitly requested
- Test fixtures in `data/test_fixtures/`

### Cleanup Commands

```bash
# Review and remove unnecessary markdown files
find . -name "README.md" -path "*/src/*" -delete
find . -name "*.md" -empty -delete

# Remove common auto-generated files
rm -f CHANGELOG.md CONTRIBUTING.md CODE_OF_CONDUCT.md
```

### Production Verification (before delivery)

```bash
# Verify no TODO/FIXME comments
grep -rn "TODO\|FIXME\|HACK" --include="*.py" --include="*.js" --include="*.jsx" .

# Verify no mock data in production paths
grep -rn "mock\|placeholder\|hardcoded" --include="*.py" --include="*.js" .

# Verify no console.log in production
grep -rn "console.log" --include="*.js" --include="*.jsx" src/
```
