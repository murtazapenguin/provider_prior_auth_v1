---
name: frontend-guide
description: React UI patterns for PDF processing and document annotation workflows. Includes PDFViewer component, Tailwind CSS v4, React Router, and PenguinAI branding. Triggers on React, PDF viewers, frontend UI, or Tailwind.
---

# React UI Patterns

Patterns for building React applications with PDF viewing and document annotation capabilities.

---

## Source Libraries (CRITICAL - REUSE THESE)

### Standard UI Template
Base scaffold for new React applications with PenguinAI branding.

**Location:** `Standard_UI_Template/` (relative to repository root)

**Copy these components for new projects:**
```bash
# Copy complete template as starting point (from repository root)
cp -r Standard_UI_Template/* my-app/

# Or copy specific components
cp Standard_UI_Template/src/components/LoginPage.jsx my-app/src/components/
cp Standard_UI_Template/src/components/Dashboard.jsx my-app/src/components/
cp Standard_UI_Template/public/penguin-logo.svg my-app/public/
cp Standard_UI_Template/public/Penguinai-name.png my-app/public/
```

**Key Files:**
- `src/components/LoginPage.jsx` - Authentication UI with PenguinAI branding
- `src/components/Dashboard.jsx` - Dashboard layout pattern
- `public/penguin-logo.svg` - Logo icon
- `public/Penguinai-name.png` - Full brand name image
- `index.css` - Tailwind v4 CSS-based config (`@import "tailwindcss"`)

### data-labelling-library (PDF Viewer & NER Viewer)
Production PDF viewer with annotations, bounding boxes, and Named Entity Recognition.

**Location:** `data-labelling-library/` (relative to repository root)

**Exports:** `PDFViewer` (default), `NERViewer`

**Features:**
- Multi-page PDF viewing with smooth scrolling
- Zoom controls and keyboard navigation
- Annotation toolbar with undo/redo history
- Bounding box drawing and editing
- Named Entity Recognition (NER) visualization
- Entity type filtering and highlighting
- Search functionality

---

## PDFViewer Component (CRITICAL)

> **ALWAYS use `data-labelling-library` for PDF/document viewing.**
> **NEVER use:** pdf.js, react-pdf, pdfjs-dist, or custom viewers.
>
> **Full props reference, annotations, search, keyboard shortcuts:** See `.claude/patterns/pdfviewer-component.md`
> **documentData format and page image generation:** See `.claude/contracts/pdfviewer-data.md`

### Installation

```bash
cp -r data-labelling-library src/lib/pdf-viewer
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material lucide-react
```

### Basic Usage

```jsx
import { PDFViewer } from '../lib/pdf-viewer';

<PDFViewer
  documentData={documentData}
  boundingBoxes={boundingBoxes}
  className="h-full"
  userInterfaces={{ enableToolbar: false, zoom: true }}
/>
```

### Key Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `documentData` | Object | Yes | `{files, presigned_urls}` — see pdfviewer-data contract |
| `boundingBoxes` | Array | No | Canonical 3-field bbox format (pass from API directly) |
| `userInterfaces` | Object | No | Feature flags: `zoom`, `enableSearch`, `enableToolbar`, `docNavigation`, `showFilename` |
| `className` | string | No | CSS class on root container (e.g. `"h-full"`) |

### Height Constraints (CRITICAL)

PDFViewer requires explicit height for proper scrolling:

```jsx
// CORRECT: Explicit height chain
<div className="h-screen flex">
  <div className="w-3/5 h-full">
    <PDFViewer documentData={data} className="h-full" />
  </div>
</div>

// WRONG: Pages expand instead of scroll
<div>
  <PDFViewer documentData={data} />
</div>
```

### boundingBoxes Format

```javascript
// API returns canonical format — pass directly to PDFViewer (no transformation)
const { bboxes } = await api.get(`/api/v1/items/${id}/results`);

<PDFViewer documentData={documentData} boundingBoxes={bboxes} />
```

Canonical bbox schema — see `.claude/contracts/bbox-format.md` for full spec.

### Split Panel Layout (Common Pattern)

```jsx
<div className="h-screen flex">
  <div className="w-3/5 h-full border-r">
    <PDFViewer documentData={data} className="h-full" />
  </div>
  <div className="w-2/5 h-full overflow-y-auto p-4">
    {/* Sidebar: extraction results, annotations, etc. */}
  </div>
</div>
```

---

## NERViewer Component

```jsx
import { NERViewer } from '../lib/pdf-viewer';

<NERViewer
  documentData={documentData}
  nerData={nerData}   // [{filename, data: {page_str: [{word, entity, entity_type, bbox, tags}]}}]
  className="h-full"
  userInterfaces={{ docNavigation: true, zoom: true, showFilename: true }}
/>
```

Features: entity type filtering, entity details popup, tags sidebar (Ctrl+T), dynamic colors.

---

## Project Setup

### 1. Create Project

```bash
npm create vite@latest my-app -- --template react
cd my-app
npm install react-router-dom @heroicons/react lucide-react
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material
npm install -D tailwindcss @tailwindcss/vite
```

### 2. Tailwind CSS v4 Configuration

**CRITICAL:** Tailwind v4 with Vite requires the `@tailwindcss/vite` plugin in `vite.config.js`. Without this, CSS will not be processed and the app will appear unstyled.

```javascript
// vite.config.js — MUST include tailwindcss plugin
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

**No `postcss.config.js` needed** — the Vite plugin handles everything.

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  --animate-gradient: gradient 8s linear infinite;
  --animate-float: float 6s ease-in-out infinite;
}

@layer base {
  body { font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
}

@layer components {
  .gradient-bg {
    background: linear-gradient(-45deg, #667eea, #764ba2, #f093fb, #f5576c);
    background-size: 400% 400%;
    animation: gradient 15s ease infinite;
  }
  .glass-effect {
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
  }
}
```

**CRITICAL: CSS Cascade Layer Rules (Tailwind v4)**

In Tailwind v4, all utility classes live inside `@layer utilities`. Unlayered styles ALWAYS beat layered styles.

**NEVER do this:**
```css
/* BAD — unlayered reset overrides ALL Tailwind padding/margin utilities */
* { margin: 0; padding: 0; box-sizing: border-box; }
```

All custom CSS MUST be inside `@layer base`, `@layer components`, or `@layer utilities`. `@keyframes` can remain unlayered.

### 3. Project Structure

```
my-app/
├── public/
│   ├── penguin-logo.svg
│   └── Penguinai-name.png
├── src/
│   ├── App.jsx
│   ├── index.css
│   ├── lib/pdf-viewer/
│   ├── components/
│   ├── context/
│   ├── hooks/
│   └── services/api.js
└── .env.development
```

---

## Design System — Standard UI Template

The `Standard_UI_Template/` is the **single source of truth** for visual design. Every app must match its visual patterns.

### What to Copy

| Source File | What It Provides | Copy To |
|-------------|-----------------|---------|
| `Standard_UI_Template/src/index.css` | `.gradient-bg`, `.glass-effect`, `.input-glow` CSS classes | `src/index.css` |
| `Standard_UI_Template/tailwind.config.js` | `gradient`, `float`, `pulse-slow` animations + keyframes | `tailwind.config.js` |
| `Standard_UI_Template/public/penguin-logo.svg` | PenguinAI logo icon (vector) | `public/penguin-logo.svg` |
| `Standard_UI_Template/public/Penguinai-name.png` | PenguinAI full brand name image | `public/Penguinai-name.png` |

**MANDATORY:** Always copy logo files. Use `<img src="/penguin-logo.svg">` — NEVER use emoji (🐧) as a substitute.

### Visual Patterns to Match

| Pattern | Implementation |
|---------|---------------|
| **Glass cards** | `bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50` |
| **Gradient backgrounds** | `.gradient-bg` class |
| **Hover transforms** | `hover:scale-105 hover:shadow-2xl transition-all duration-300` |
| **Input glow** | `.input-glow` focus class |
| **Rounded corners** | `rounded-2xl` on cards, `rounded-xl` on inputs/buttons |

### PenguinAI Branding

```jsx
const PRIMARY = "#fc459d";
const GRADIENTS = "from-[#fc459d] via-purple-600 to-pink-600";

// Glass Card
<div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50">

// Logo Usage
<img src="/penguin-logo.svg" alt="PenguinAI" className="h-8 w-8" />
<img src="/Penguinai-name.png" alt="PenguinAI" className="h-6" />
```

---

## React Router Setup

```jsx
// App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/queue" element={<ProtectedRoute><QueuePage /></ProtectedRoute>} />
        <Route path="/coding/:id" element={<ProtectedRoute><CodingPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('authToken');
  return token ? children : <Navigate to="/login" />;
}
```

---

## API Service Layer

```javascript
// src/services/api.js
// CRITICAL: Always use relative URL — works with Vite proxy (local dev) AND nginx (Docker).
// NEVER hardcode http://localhost:8000 — it breaks inside Docker containers.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const getHeaders = () => ({
  'Content-Type': 'application/json',
  ...(localStorage.getItem('authToken') && {
    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
  })
});

export const authAPI = {
  login: (email, password) =>
    fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email, password })
    }).then(r => r.json()),
  getMe: () =>
    fetch(`${BASE_URL}/auth/me`, { headers: getHeaders() }).then(r => r.json())
};
```

---

## Frontend State Management

### Standard Patterns for Every Page

| State | UI Pattern |
|-------|-----------|
| Loading | Skeleton placeholders matching content layout |
| Error | Red banner at top with message + "Retry" button |
| Empty | Centered illustration + message + call-to-action button |
| Submitting | Button shows spinner + disabled state, prevent double-click |

### Data Fetching Pattern

```jsx
function useItems(status) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchItems() {
      try {
        setLoading(true);
        const response = await api.get(`/api/v1/items?status=${status}`);
        setItems(response.data.items);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchItems();
  }, [status]);

  return { items, loading, error, refetch: fetchItems };
}
```

### Auth Context Pattern

```jsx
import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('authToken'));

  const login = async (email, password) => {
    const response = await api.post('/api/v1/auth/login', { email, password });
    localStorage.setItem('authToken', response.data.access_token);
    setToken(response.data.access_token);
    setUser(response.data.user);
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

### WebSocket Integration

```jsx
function useWebSocket(userId) {
  const [status, setStatus] = useState('disconnected');
  const [lastMessage, setLastMessage] = useState(null);

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/${userId}`);

    ws.onopen = () => setStatus('connected');
    ws.onclose = () => {
      setStatus('disconnected');
      setTimeout(() => reconnect(), 1000);
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setLastMessage(message);
      if (message.type === 'notification') toast(message.payload.message);
    };

    return () => ws.close();
  }, [userId]);

  return { status, lastMessage };
}
```

### Frontend Error States

```jsx
function ItemsPage() {
  const { items, loading, error, refetch } = useItems();

  if (loading) return <ItemsSkeleton />;

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        <p>{error}</p>
        <button onClick={refetch} className="underline">Retry</button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No items found</p>
        <button className="mt-4 btn-primary">Create First Item</button>
      </div>
    );
  }

  return <ItemsList items={items} />;
}
```

---

## Common UI Patterns

### Loading State

```jsx
<button disabled={isLoading} onClick={handleSubmit}>
  {isLoading ? <><Spinner className="animate-spin mr-2" /> Loading...</> : 'Submit'}
</button>
```

### Status Badge

```jsx
const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800'
};

<span className={`px-2 py-1 rounded-full text-xs ${STATUS_COLORS[status]}`}>
  {status}
</span>
```

---

## Progressive Disclosure

For detailed patterns, see:
- `.claude/patterns/pdfviewer-component.md` - Full PDFViewer props, annotations, search, keyboard shortcuts
- `.claude/contracts/pdfviewer-data.md` - documentData format, page image generation, annotation contract
- `.claude/contracts/bbox-format.md` - Bounding box format specification
- `templates/api-hooks.js` - React hooks for API calls
- `templates/auth-context.jsx` - Authentication context
