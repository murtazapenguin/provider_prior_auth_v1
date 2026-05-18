# Common UI Fixes Reference

## Layout Fixes

### 1. Full Height Split Panel Layout
```jsx
// Pattern for PDF viewer + side panel
<div className="h-screen flex overflow-hidden">
  {/* Left Panel - PDF Viewer */}
  <div className="w-3/5 h-full border-r border-gray-200">
    <PDFViewer
      documentData={documentData}
      boundingBoxes={boundingBoxes}
      className="h-full"
    />
  </div>

  {/* Right Panel - Scrollable Content */}
  <div className="w-2/5 h-full flex flex-col overflow-hidden">
    <header className="flex-shrink-0 p-4 border-b">
      {/* Fixed header content */}
    </header>
    <main className="flex-1 overflow-y-auto p-4">
      {/* Scrollable content */}
    </main>
    <footer className="flex-shrink-0 p-4 border-t">
      {/* Fixed footer content */}
    </footer>
  </div>
</div>
```

### 2. Sidebar + Main Content Layout
```jsx
<div className="min-h-screen flex">
  {/* Sidebar - Fixed width */}
  <aside className={`${collapsed ? 'w-16' : 'w-64'} flex-shrink-0 transition-all`}>
    {/* Sidebar content */}
  </aside>

  {/* Main Content - Fills remaining space */}
  <main className="flex-1 flex flex-col overflow-hidden">
    <header className="flex-shrink-0">{/* Header */}</header>
    <div className="flex-1 overflow-y-auto">{/* Content */}</div>
  </main>
</div>
```

### 3. Modal/Dialog Overlay
```jsx
<div className="fixed inset-0 z-50 flex items-center justify-center">
  {/* Backdrop */}
  <div
    className="absolute inset-0 bg-black/50 backdrop-blur-sm"
    onClick={onClose}
  />

  {/* Modal Content */}
  <div className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4">
    {/* Modal body */}
  </div>
</div>
```

## State Management Fixes

### 1. Proper Loading State Pattern
```jsx
const [state, setState] = useState({
  data: null,
  isLoading: false,
  error: null
})

const fetchData = async () => {
  setState(prev => ({ ...prev, isLoading: true, error: null }))
  try {
    const data = await api.getData()
    setState(prev => ({ ...prev, data, isLoading: false }))
  } catch (error) {
    setState(prev => ({ ...prev, error: error.message, isLoading: false }))
  }
}
```

### 2. Memoized Filtered Data
```jsx
const filteredItems = useMemo(() => {
  return items
    .filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase())
      const matchesFilter = filter === 'all' || item.status === filter
      return matchesSearch && matchesFilter
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}, [items, search, filter])
```

### 3. Debounced Search Input
```jsx
const [searchInput, setSearchInput] = useState('')
const [debouncedSearch, setDebouncedSearch] = useState('')

useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearch(searchInput)
  }, 300)

  return () => clearTimeout(timer)
}, [searchInput])
```

## Event Handler Fixes

### 1. Stop Propagation Pattern
```jsx
const handleItemClick = (item) => {
  setSelectedItem(item)
}

const handleButtonClick = (e, item) => {
  e.stopPropagation() // Prevent parent click
  performAction(item)
}

return (
  <div onClick={() => handleItemClick(item)}>
    <button onClick={(e) => handleButtonClick(e, item)}>
      Action
    </button>
  </div>
)
```

### 2. Keyboard Event Handling
```jsx
const handleKeyDown = (e) => {
  switch (e.key) {
    case 'Enter':
      e.preventDefault()
      handleSubmit()
      break
    case 'Escape':
      handleCancel()
      break
  }
}

<input onKeyDown={handleKeyDown} />
```

## Form Fixes

### 1. Controlled Form with Validation
```jsx
const [formData, setFormData] = useState({
  name: '',
  email: ''
})
const [errors, setErrors] = useState({})

const validate = () => {
  const newErrors = {}
  if (!formData.name.trim()) newErrors.name = 'Name is required'
  if (!formData.email.includes('@')) newErrors.email = 'Invalid email'
  setErrors(newErrors)
  return Object.keys(newErrors).length === 0
}

const handleSubmit = (e) => {
  e.preventDefault()
  if (validate()) {
    submitForm(formData)
  }
}

<form onSubmit={handleSubmit}>
  <input
    value={formData.name}
    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
    className={errors.name ? 'border-red-500' : 'border-gray-300'}
  />
  {errors.name && <span className="text-red-500 text-sm">{errors.name}</span>}
</form>
```

## Styling Fixes

### 1. Consistent Button Styles
```jsx
// Primary Button
<button className="px-4 py-2 bg-gradient-to-r from-[#fc459d] to-pink-600 text-white font-medium rounded-xl hover:from-pink-600 hover:to-pink-700 transition-all duration-300 shadow-lg hover:shadow-xl disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed">
  Primary Action
</button>

// Secondary Button
<button className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-all duration-300">
  Secondary
</button>

// Icon Button
<button className="p-2 rounded-lg hover:bg-pink-50 text-gray-600 hover:text-[#fc459d] transition-all duration-200">
  <IconComponent className="w-5 h-5" />
</button>
```

### 2. Card Component Pattern
```jsx
<div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 overflow-hidden">
  <div className="p-6 border-b border-gray-200/50">
    <h3 className="text-xl font-bold text-gray-900">Card Title</h3>
    <p className="text-gray-600 mt-1">Card description</p>
  </div>
  <div className="p-6">
    {/* Card content */}
  </div>
</div>
```

### 3. Status Badge Pattern
```jsx
const getStatusBadge = (status) => {
  const styles = {
    pending: 'bg-yellow-100 text-yellow-800',
    active: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800'
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}
```

## Animation Fixes

### 1. Smooth Transitions
```jsx
// Expand/collapse animation
<div className={`overflow-hidden transition-all duration-300 ${
  isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
}`}>
  {/* Collapsible content */}
</div>

// Sidebar collapse
<aside className={`transition-all duration-300 ${
  collapsed ? 'w-16' : 'w-64'
}`}>
```

### 2. Loading Spinner
```jsx
<div className="flex items-center justify-center">
  <div className="w-8 h-8 border-4 border-pink-200 border-t-[#fc459d] rounded-full animate-spin" />
</div>
```

---

## PDFViewer / NERViewer Test Cases

### PDFViewer Annotation Toolbar Tests

When `userInterfaces.enableToolbar: true`:

**Test: Annotation Mode Toggle**
1. Click bounding box button in toolbar OR press Ctrl+B
2. Verify green "Draw bounding boxes" indicator appears
3. Press ESC to exit annotation mode
4. Verify indicator disappears

**Test: Draw Bounding Box**
1. Enter annotation mode (Ctrl+B)
2. Click and drag on PDF to draw rectangle
3. Verify bounding box appears with highlight
4. Check annotation count in toolbar increases

**Test: Undo/Redo**
1. Draw multiple bounding boxes
2. Press Ctrl+Z to undo
3. Verify last annotation is removed
4. Press Ctrl+Shift+Z or Ctrl+Y to redo
5. Verify annotation reappears

**Test: Save Annotations**
1. Draw one or more bounding boxes
2. Click Save button in toolbar
3. Verify confirmation dialog appears
4. Confirm save
5. Verify unsaved changes banner disappears

**Test: Clear All Annotations**
1. Draw annotations
2. Click trash/clear button in toolbar
3. Verify confirmation dialog with count
4. Confirm deletion
5. Verify all annotations are removed

**Test: Unsaved Changes Warning**
1. Draw bounding box (don't save)
2. Try to change document or page
3. Verify warning dialog appears
4. Test "Save & Continue", "Discard", and "Cancel" options

### NERViewer Test Cases

**Test: Entity Type Filtering**
1. Load NERViewer with nerData
2. In status bar, click entity type badges
3. Verify entities of that type toggle visibility
4. Check entity count updates per page

**Test: Entity Click Details**
1. Click on highlighted entity in document
2. Verify NEREntityDetails popup appears (top right)
3. Check word, entity name, code, and tags are displayed
4. Click X or press ESC to close

**Test: Tags Sidebar**
1. Press Ctrl+T or click Tags button
2. Verify NERTagsSidebar slides in from right
3. Expand tag categories
4. Verify entities grouped by tag are shown
5. Press Ctrl+T again to close

**Test: Keyboard Navigation**
1. Use arrow keys to scroll (↑↓)
2. Use Shift+arrow for page scroll
3. Use Ctrl+arrow for document start/end
4. Use PgUp/PgDn for page navigation
5. Verify keyboard shortcuts helper shows these bindings

**Test: Document/Page Navigation**
1. Use toolbar dropdown to change documents
2. Verify page resets and entities update
3. Use page input/arrows to change pages
4. Verify entity counts update per page

### Common Issues to Check

```jsx
// WRONG: No height constraint - pages won't scroll
<NERViewer documentData={data} nerData={ner} />

// CORRECT: Explicit height chain
<div className="h-screen">
  <NERViewer documentData={data} nerData={ner} className="h-full" />
</div>
```

```jsx
// WRONG: Missing nerData structure
const nerData = { page1: [...] }

// CORRECT: Array of documents with filename and data object
const nerData = [{
  filename: "doc.pdf",
  data: { "1": [...], "2": [...] }
}]
```
