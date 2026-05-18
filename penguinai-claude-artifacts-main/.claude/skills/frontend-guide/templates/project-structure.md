# Project Structure

## Complete Folder Structure

```
my-pdf-app/
├── .env.development              # Development environment variables
├── .env.production               # Production environment variables
├── .gitmodules                   # Git submodule configuration
├── index.html                    # HTML entry point
├── package.json                  # Project dependencies
├── postcss.config.js             # PostCSS configuration
├── # Note: Tailwind v4 uses CSS-based config (@import "tailwindcss" in index.css)
├── vite.config.js                # Vite configuration
├── eslint.config.js              # ESLint configuration
├── public/
│   └── logo.svg                  # App logo
└── src/
    ├── main.jsx                  # React entry point with providers
    ├── App.jsx                   # Root component with routing
    ├── index.css                 # Global styles + Tailwind imports
    │
    ├── lib/
    │   └── pdf-viewer/           # data-labelling-library (git submodule)
    │       ├── src/
    │       │   └── components/
    │       │       └── PDFViewer.jsx
    │       └── index.js
    │
    ├── api/
    │   ├── client.js             # Axios instance with interceptors
    │   └── endpoints.js          # API endpoint constants (optional)
    │
    ├── context/
    │   └── AuthContext.jsx       # Authentication context provider
    │
    ├── hooks/
    │   ├── useAuth.js            # Re-export from AuthContext
    │   ├── useDocuments.js       # Document CRUD hooks
    │   ├── useAnnotations.js     # Annotation CRUD hooks
    │   └── useProcessingStatus.js # Polling hook for status
    │
    ├── components/
    │   ├── auth/
    │   │   ├── LoginPage.jsx     # Login form with validation
    │   │   └── ProtectedRoute.jsx # Route guard component
    │   │
    │   ├── layout/
    │   │   ├── AppLayout.jsx     # Main layout with sidebar
    │   │   ├── Header.jsx        # Top navigation bar
    │   │   └── Sidebar.jsx       # Navigation sidebar
    │   │
    │   ├── documents/
    │   │   ├── DocumentList.jsx  # Document listing with search
    │   │   ├── DocumentCard.jsx  # Individual document card
    │   │   ├── DocumentViewer.jsx # PDFViewer wrapper
    │   │   ├── UploadDocument.jsx # File upload component
    │   │   └── ProcessingStatus.jsx # Processing indicator
    │   │
    │   └── common/
    │       ├── LoadingSpinner.jsx
    │       ├── ErrorMessage.jsx
    │       └── ConfirmDialog.jsx
    │
    ├── pages/
    │   ├── DashboardPage.jsx     # Main dashboard
    │   ├── DocumentsPage.jsx     # Documents list page
    │   └── AnnotationPage.jsx    # Full annotation workspace
    │
    └── utils/
        ├── transformers.js       # Data transformation utilities
        └── constants.js          # App-wide constants
```

## File Descriptions

### Root Files

| File | Purpose |
|------|---------|
| `.env.development` | `VITE_API_BASE_URL=/api/v1` (relative — Vite proxy routes to backend) |
| `.env.production` | `VITE_API_BASE_URL=https://api.yourapp.com` |
| `vite.config.js` | Vite bundler configuration — MUST include `@tailwindcss/vite` plugin |
| `src/index.css` | Tailwind v4 CSS-based config (`@import "tailwindcss"`) |

### Entry Points

| File | Purpose |
|------|---------|
| `main.jsx` | React DOM render with QueryClientProvider and AuthProvider |
| `App.jsx` | BrowserRouter with route definitions |
| `index.css` | Tailwind directives and global styles |

### API Layer

| File | Purpose |
|------|---------|
| `api/client.js` | Axios instance with JWT interceptor and 401 handling |
| `api/endpoints.js` | API endpoint constants (optional, for larger apps) |

### Context

| File | Purpose |
|------|---------|
| `context/AuthContext.jsx` | JWT token management, login/logout, user state |

### Hooks

| File | Purpose |
|------|---------|
| `hooks/useAuth.js` | Re-export useAuth from AuthContext |
| `hooks/useDocuments.js` | `useDocuments()`, `useDocument(id)`, `useUploadDocument()` |
| `hooks/useAnnotations.js` | `useAnnotations(id)`, `useSaveAnnotations(id)` |
| `hooks/useProcessingStatus.js` | Polling hook with conditional refetch |

### Components

| File | Purpose |
|------|---------|
| `components/auth/LoginPage.jsx` | Login form with error handling |
| `components/auth/ProtectedRoute.jsx` | Auth guard wrapper |
| `components/layout/AppLayout.jsx` | Main layout with Outlet |
| `components/layout/Sidebar.jsx` | Navigation links |
| `components/documents/DocumentViewer.jsx` | PDFViewer integration |
| `components/documents/UploadDocument.jsx` | Drag-drop file upload |
| `components/documents/ProcessingStatus.jsx` | Progress indicator |

### Utils

| File | Purpose |
|------|---------|
| `utils/transformers.js` | API to PDFViewer data transformations |
| `utils/constants.js` | Processing statuses, route paths |

## Sample main.jsx

```javascript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
```

## Sample AppLayout.jsx

```javascript
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';

const AppLayout = () => {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
```

## Environment Variables

### .env.development
```
# Use relative URL — Vite proxy handles routing to backend in local dev.
# NEVER use http://localhost:8000 — breaks inside Docker containers.
VITE_API_BASE_URL=/api/v1
```

### .env.production
```
VITE_API_BASE_URL=/api/v1
```

Access in code:
```javascript
// Default to relative URL so it works with both Vite proxy and nginx
const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
```
