# PDF Viewer / Data Annotation Library

A React-based PDF image viewer with page navigation, zoom, search highlighting, freehand/highlight annotations, bounding box selection, page rotation, and optional ICD selection flows. This repo is self-contained inside `frontend/src/lib/pdf-viewer` so it can be pushed as its own project.

## Quick start

```bash
cd frontend/src/lib/pdf-viewer
npm install
npm run dev   # local demo playground at http://localhost:5173
```

Install peer deps (if you consume it inside another app):

```bash
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material
```

## What is inside

- `src/components/PDFViewer.jsx` – main composed component (exports as default).
- `PDFToolbar` – page/zoom/search/rotation controls rendered inside the viewer.
- `PDFPageRenderer` – renders each page image, highlights, annotations, and bounding boxes.
- `AnnotationToolbar` / `AnnotationCanvas` – drawing + highlight tools and undo/redo.
- `ConfirmationDialog` – reusable confirmation dialog component.
- `SampleData.js` – mock data for local demo.
- `index.js` – re-exports `PDFViewer` as the package entry.

## Features

- **Page Navigation**: Navigate between pages with prev/next buttons, page input, and keyboard shortcuts
- **Zoom Controls**: Zoom in/out with slider (50% - 200%), zoom percentage display
- **Search**: Full-text search with result highlighting and navigation between matches
- **Page Rotation**: Rotate pages left/right (90-degree increments)
- **Selection Mode**: Draw bounding boxes on pages for region selection
- **ICD Code Integration**: Optional ICD code selection flows with evidence linking
- **Annotations**: Freehand drawing and highlighting tools (via AnnotationCanvas)
- **Bounding Boxes**: Pre-highlight regions on pages with custom labels
- **Virtualization**: Dynamic page loading for large documents (loads 25 pages at a time)
- **Pan Support**: Pan zoomed pages with mouse drag
- **Keyboard Shortcuts**: Arrow keys for navigation, Escape to cancel modes, Ctrl+B to toggle selection
- **Notifications**: Toast notifications for user feedback
- **Responsive Design**: Adapts to narrow viewports (40% or less width)

## Component Props

### PDFViewer Props

#### Required Props

- **`documentData`** (object, required): Document data structure
  ```typescript
  {
    files: string[];  // Ordered list of document names
    presigned_urls: {
      [fileName: string]: {
        [pageNumber: string]: string;  // Page number to image URL mapping
      }
    }
  }
  ```

#### Optional Props

- **`boundingBoxes`** (array | null, default: `null`): Pre-existing bounding boxes to display
  ```typescript
  Array<{
    document_name: string;
    page_number: string;
    bbox: number[][];  // Array of bbox coordinates [x1, y1, x2, y2, x3, y3, x4, y4]
    label?: string[];  // Optional labels for the bounding box
    supporting_sentence_in_document?: string;
  }>
  ```

- **`searchResults`** (object | null, default: `null`): Search results to highlight
  ```typescript
  {
    results: Array<{
      document_name: string;
      page_number: string;
      text_snippet: string;
      match_score: number;
      bbox: number[][];  // Highlight polygon coordinates
    }>;
    total_matches: number;
  }
  ```

- **`setSearchResults`** (function): Callback to update search results state
  ```typescript
  (results: object | null) => void
  ```

- **`userInterfaces`** (object, default: `{}`): Toggle UI features
  ```typescript
  {
    docNavigation?: boolean;      // Show document navigation dropdown
    zoom?: boolean;                // Show zoom controls
    download?: boolean;            // Show download button
    keyboardShortcuts?: boolean;   // Enable keyboard shortcuts
    showFilename?: boolean;        // Show current document filename
  }
  ```

- **`className`** (string, default: `""`): Additional CSS class for the container

#### Callback Props

- **`onDocumentChange`** (function): Called when the active document changes
  ```typescript
  (documentName: string) => void
  ```

- **`onPageChange`** (function): Called when the current page changes
  ```typescript
  (pageNumber: number) => void
  ```

- **`onAnnotationAdd`** (function): Called when a new annotation is added
  ```typescript
  (annotation: {
    id: string;
    type: "pen" | "highlighter";
    points: Array<{ x: number; y: number }>;
    color: string;
    thickness: number;
    pageNumber: number;
  }) => void
  ```

- **`onSearchPerformed`** (function): Called when search is submitted
  ```typescript
  (query: string) => void | Promise<void>
  ```

- **`onSearchError`** (function): Called when search encounters an error
  ```typescript
  (error: Error) => void
  ```

#### ICD/Selection Mode Props

- **`isAddingICD`** (boolean, default: `false`): Enable ICD code addition mode
- **`onAreaSelected`** (function): Called when a bounding box is drawn in selection mode
  ```typescript
  (region: {
    document: string;
    page: number;
    bbox: number[][];
  }) => void
  ```

- **`onSelectionAction`** (function): Called when selection action is triggered
  ```typescript
  (action: string, data?: any) => void
  ```

- **`enableSelectionToolbar`** (boolean, default: `false`): Show selection toolbar after drawing bounding box

- **`documentId`** (string): Document ID for API calls related to ICD codes

- **`icdResults`** (array, default: `[]`): ICD code results from API
  ```typescript
  Array<{
    code: string;
    description: string;
    // ... other ICD result fields
  }>
  ```

- **`onEvidenceAdded`** (function): Callback to refresh results after evidence is added
  ```typescript
  () => void | Promise<void>
  ```

- **`pendingIcdCode`** (object | null, default: `null`): Pending ICD code from lookup search
  ```typescript
  {
    code: string;
    description: string;
  } | null
  ```

- **`onClearPendingIcd`** (function): Callback to clear pending ICD state
  ```typescript
  () => void
  ```

- **`pdfWidth`** (number, default: `50`): Width percentage of PDF viewer (affects responsive layout)

## Basic usage

```jsx
import React, { useState } from "react";
import PDFViewer from "./lib/pdf-viewer";

function App() {
  const [searchResults, setSearchResults] = useState(null);

  const documentData = {
    files: ["document1.pdf"],
    presigned_urls: {
      "document1.pdf": {
        "1": "/images/doc1-page1.png",
        "2": "/images/doc1-page2.png",
      },
    },
  };

  return (
    <PDFViewer
      documentData={documentData}
      boundingBoxes={[
        {
        document_name: "document1.pdf",
        page_number: "1",
        bbox: [[0.1, 0.1, 0.4, 0.1, 0.4, 0.2, 0.1, 0.2]],
          label: ["Region 1"],
        },
      ]}
      searchResults={searchResults}
      setSearchResults={setSearchResults}
      userInterfaces={{
        docNavigation: true,
        zoom: true,
        download: true,
        keyboardShortcuts: true,
        showFilename: true,
      }}
      onSearchPerformed={async (query) => {
        const results = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, documents: documentData.files }),
        }).then((r) => r.json());
        setSearchResults(results);
      }}
      onAnnotationAdd={(annotation) => {
        console.log("new annotation", annotation);
        // Persist annotation to your backend here
      }}
      onDocumentChange={(documentName) => {
        console.log("Document changed:", documentName);
      }}
      onPageChange={(pageNumber) => {
        console.log("Page changed:", pageNumber);
      }}
    />
  );
}
```

## Advanced Usage: ICD Code Selection Flow

```jsx
import React, { useState } from "react";
import PDFViewer from "./lib/pdf-viewer";

function App() {
  const [isAddingICD, setIsAddingICD] = useState(false);
  const [pendingIcdCode, setPendingIcdCode] = useState(null);
  const [icdResults, setIcdResults] = useState([]);

  const handleAreaSelected = (region) => {
    console.log("Region selected:", region);
    // Show selection toolbar or trigger ICD code selection
  };

  const handleEvidenceAdded = async () => {
    // Refresh ICD results after evidence is added
    const results = await fetch(`/api/icd-results/${documentId}`).then(r => r.json());
    setIcdResults(results);
  };

  return (
    <PDFViewer
      documentData={documentData}
      isAddingICD={isAddingICD}
      onAreaSelected={handleAreaSelected}
      enableSelectionToolbar={true}
      documentId="doc-123"
      icdResults={icdResults}
      onEvidenceAdded={handleEvidenceAdded}
      pendingIcdCode={pendingIcdCode}
      onClearPendingIcd={() => setPendingIcdCode(null)}
      onSelectionAction={(action, data) => {
        if (action === "add-evidence") {
          // Add evidence with pending ICD code
          handleEvidenceAdded();
        }
      }}
    />
  );
}
```

## Data shape cheatsheet

### Page Coordinates

- **Bounding Box Format**: `bbox` entries are arrays of 8 numbers representing a quadrilateral:
  ```typescript
  [x1, y1, x2, y2, x3, y3, x4, y4]
  ```
  - Coordinates are normalized (0-1) relative to the page's top-left corner
  - `(x1, y1)` = top-left, `(x2, y2)` = top-right, `(x3, y3)` = bottom-right, `(x4, y4)` = bottom-left

### Annotations

```typescript
{
  id: string;                    // Unique identifier
  type: "pen" | "highlighter";    // Annotation type
  points: Array<{                 // Array of drawing points
    x: number;
    y: number;
  }>;
  color: string;                  // Hex color code
  thickness: number;              // Line thickness in pixels
  pageNumber: number;             // Page number (1-indexed)
}
```

### Search Results

Each search result must include:
- `document_name` (string): Name of the document
- `page_number` (string): Page number as a string
- `text_snippet` (string): Excerpt of matching text
- `match_score` (number): Relevance score
- `bbox` (number[][]): Array of bounding box polygons for highlighting

### Bounding Boxes

```typescript
{
  document_name: string;          // Document identifier
  page_number: string;            // Page number as string
  bbox: number[][];               // Array of bbox coordinate arrays
  label?: string[];               // Optional array of labels
  supporting_sentence_in_document?: string;  // Optional context text
}
```

## Keyboard Shortcuts

- **Arrow Keys** (Left/Right): Navigate to previous/next page
- **Escape**: Cancel selection mode or ICD addition mode
- **Ctrl+B** (or Cmd+B on Mac): Toggle selection mode
- **Page Input**: Type page number and press Enter to jump to page

## Building and packaging

```bash
# build the library bundle
npm run build
```

Outputs land in `dist/`.

## Push this folder to its own repo

From the folder `frontend/src/lib/pdf-viewer`:

```bash
git init
git remote add origin https://github.com/praveenmanthena/data_labelling_studio_v2.git
git add .
git commit -m "Publish pdf viewer library"
git branch -M main
git push -u origin main
```

If the remote already exists, remove `git init` and just add the remote then push.

## Component Architecture

### PDFViewer
Main container component that manages:
- Document and page state
- Zoom and rotation state
- Search state and results
- Selection mode and drawn regions
- Virtualization and dynamic page loading
- Keyboard shortcuts and focus management

### PDFToolbar
Toolbar component providing:
- Page navigation controls
- Zoom slider and buttons
- Rotation controls
- Search bar with result navigation
- Selection mode toggle
- Download button (if enabled)

### PDFPageRenderer
Renders individual PDF pages with:
- Image loading and display
- Bounding box overlays
- Search result highlights
- Annotation canvas overlay
- Selection mode drawing
- ICD code integration UI

### AnnotationToolbar
Side toolbar for annotation management:
- Expandable/collapsible panel
- Bounding box drawing mode toggle
- Undo/redo actions
- Save and clear all annotations
- Region list with selection
- Region deletion

### AnnotationCanvas
Canvas overlay for freehand drawing:
- Pen and highlighter tools
- Real-time drawing preview
- Annotation persistence
