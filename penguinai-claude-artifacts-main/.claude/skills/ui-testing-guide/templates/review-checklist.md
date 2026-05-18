# UI Review Checklist

## Application: {{APP_NAME}}
## Date: {{DATE}}
## Reviewer: quality-tester

---

## 1. Project Structure

| Check | Status | Notes |
|-------|--------|-------|
| package.json exists and valid | | |
| All dependencies installed | | |
| vite.config.js configured | | |
| Tailwind v4 CSS config (index.css) | | |
| postcss.config.js exists | | |
| index.html has correct entry | | |
| Public assets present (logos) | | |

## 2. Component Structure

| Component | Exists | Imports OK | Props Valid | Notes |
|-----------|--------|------------|-------------|-------|
| App.jsx | | | | |
| LoginPage.jsx | | | | |
| Layout.jsx | | | | |
| Sidebar.jsx | | | | |
| QueuePage.jsx | | | | |
| UploadPage.jsx | | | | |
| CodingScreen.jsx | | | | |

## 3. UI/Layout Issues

### Height & Overflow
| Issue | Location | Severity | Fixed |
|-------|----------|----------|-------|
| PDFViewer height constraints | | | |
| Scrollable container setup | | | |
| Overflow hidden on parents | | | |
| flex-shrink-0 on fixed elements | | | |

### Visual Issues
| Issue | Location | Severity | Fixed |
|-------|----------|----------|-------|
| Overlapping elements | | | |
| Z-index conflicts | | | |
| Inconsistent spacing | | | |
| Color scheme issues | | | |

## 4. Functionality

### Navigation
| Check | Status | Notes |
|-------|--------|-------|
| Login redirect works | | |
| Logout clears state | | |
| Protected routes guarded | | |
| Back navigation works | | |

### Forms
| Check | Status | Notes |
|-------|--------|-------|
| Required validation | | |
| Error messages shown | | |
| Loading states | | |
| Submit disabled when loading | | |

### PDF Viewer Integration
| Check | Status | Notes |
|-------|--------|-------|
| documentData format correct | | |
| boundingBoxes update triggers scroll | | |
| Click handlers work | | |
| Toolbar configured correctly | | |

## 5. Code Quality

### React Patterns
| Check | Status | Notes |
|-------|--------|-------|
| useMemo for expensive ops | | |
| useCallback for handlers | | |
| Proper key props | | |
| useEffect cleanup | | |
| No prop drilling issues | | |

### Performance
| Check | Status | Notes |
|-------|--------|-------|
| No unnecessary re-renders | | |
| Bundle size reasonable | | |
| Images optimized | | |

## 6. Build Verification

```
npm run build output:
{{BUILD_OUTPUT}}
```

## 7. Issues Summary

### Critical (Must Fix)
1.

### High Priority
1.

### Medium Priority
1.

### Low Priority (Optional)
1.

## 8. Fixes Applied

| # | File | Line | Change Description |
|---|------|------|-------------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

## 9. Final Status

- [ ] All critical issues resolved
- [ ] Build passes without errors
- [ ] Application runs correctly
- [ ] Ready for deployment
