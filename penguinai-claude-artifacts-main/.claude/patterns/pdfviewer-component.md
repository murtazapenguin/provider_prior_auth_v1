# Pattern: PDFViewer Component

**Canonical data contract:** `.claude/contracts/pdfviewer-data.md`

> **ALWAYS use `data-labelling-library` for PDF/document viewing.**
> **NEVER use:** pdf.js, react-pdf, pdfjs-dist, or custom viewers.

---

## Installation

```bash
cp -r data-labelling-library src/lib/pdf-viewer
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material lucide-react
```

---

## Basic Usage

```jsx
import { PDFViewer } from '../lib/pdf-viewer';

<PDFViewer
  documentData={documentData}
  boundingBoxes={boundingBoxes}
  className="h-full"
  userInterfaces={{ enableToolbar: false, zoom: true }}
/>
```

---

## Props Reference

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `documentData` | Object | Yes | `{files, presigned_urls}` — see pdfviewer-data contract |
| `boundingBoxes` | Array | No | Existing bboxes to display — canonical 3-field format |
| `searchResults` | Object | No | Search results with bbox highlights |
| `onDocumentChange` | `(filename: string) => void` | No | Called when user switches document |
| `onPageChange` | `(page: number) => void` | No | Called as user scrolls between pages |
| `onAnnotationAdd` | `(savedData: AnnotationGroup[]) => void` | No | Called when user confirms Save |
| `onSearchPerformed` | `(query: string) => void` | No | Called when user submits search query |
| `setSearchResults` | `Dispatch` | No | React state setter — PDFViewer calls it to clear results on Escape |
| `userInterfaces` | Object | No | Feature flags — see userInterfaces options below |
| `className` | string | No | CSS class on root container (e.g. `"h-full"`) |
| `initialPage` | number | No | Jump to this page on mount |

---

## Height Constraints (CRITICAL)

PDFViewer requires explicit height for proper scrolling:

```jsx
// CORRECT: Explicit height chain
<div className="h-screen flex">
  <div className="w-3/5 h-full">
    <PDFViewer documentData={data} className="h-full" />
  </div>
</div>

// WRONG: No height constraint — pages expand instead of scroll
<div>
  <PDFViewer documentData={data} />
</div>
```

---

## userInterfaces Options

```javascript
const userInterfaces = {
  docNavigation: true,    // "Doc X of Y" prev/next document buttons
  zoom: true,             // Zoom in/out controls
  download: false,        // Download current page as PNG
  enableSearch: true,     // Search box in toolbar
  enableToolbar: true,    // Annotation toolbar (draw/undo/redo/save/clear)
  keyboardShortcuts: true,// Keyboard shortcuts legend overlay
  showFilename: true,     // Filename badge overlay top-left
};
```

---

## Annotation Toolbar (enableToolbar: true)

```jsx
<PDFViewer
  documentData={documentData}
  boundingBoxes={existingBboxes}
  userInterfaces={{ enableToolbar: true }}
  onAnnotationAdd={(savedData) => {
    // savedData: AnnotationGroup[] — complete desired state
    // Backend should REPLACE all stored bboxes for this item
    await api.put(`/api/v1/items/${id}/annotations`, savedData);
  }}
/>
```

`onAnnotationAdd` receives grouped bboxes (existing + newly drawn, minus deleted):
```json
[{"page_number": 1, "document_name": "doc.pdf", "bbox": [[x1,y1,...,x4,y4]]}]
```

---

## Search (enableSearch: true)

```jsx
const [searchResults, setSearchResults] = useState(null);

<PDFViewer
  documentData={documentData}
  searchResults={searchResults}
  setSearchResults={setSearchResults}
  onSearchPerformed={async (query) => {
    const results = await api.get(`/api/v1/items/${id}/search?q=${query}`);
    setSearchResults(results);  // pass directly — no transformation
  }}
  userInterfaces={{ enableSearch: true }}
/>
```

---

## Evidence Click → Auto-Scroll

```jsx
const [boundingBoxes, setBoundingBoxes] = useState([]);

const handleEvidenceClick = (evidence) => {
  setBoundingBoxes([{
    document_name: evidence.documentName,
    page_number: evidence.page,  // INTEGER, 1-indexed
    bbox: [evidence.coords]
  }]);
  // PDFViewer auto-scrolls when boundingBoxes changes
};
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Toggle bounding box annotation mode |
| `Escape` | Cancel active draw / clear search |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `Ctrl+F` | Focus search input |
| `←` / `→` | Previous / next page |
| `Ctrl++` / `Ctrl+-` | Zoom in / out |

---

## Split Panel Layout (Common Pattern)

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

## Where It's Used
- **frontend-guide/SKILL.md** — PDFViewer section
- **contracts/pdfviewer-data.md** — documentData format, page image generation, annotations
