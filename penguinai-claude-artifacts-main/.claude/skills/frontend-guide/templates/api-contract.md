# API Contract

Expected backend API endpoints for the PDF processing and annotation application.

## Base URL

Configure via environment variable (ALWAYS relative — never hardcode localhost):
```
VITE_API_BASE_URL=/api/v1
```

## Authentication

### POST /auth/login

Authenticate user and receive JWT token.

**Request:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response (200 OK):**
```json
{
  "token": "<jwt-token>",
  "user": {
    "id": "user-123",
    "username": "john.doe",
    "email": "john@example.com",
    "name": "John Doe"
  }
}
```

**Response (401 Unauthorized):**
```json
{
  "detail": "Invalid credentials"
}
```

### GET /auth/me

Validate token and get current user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "id": "user-123",
  "username": "john.doe",
  "email": "john@example.com",
  "name": "John Doe"
}
```

**Response (401 Unauthorized):**
```json
{
  "detail": "Token expired or invalid"
}
```

---

## Documents

### GET /documents

List all documents for the current user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "doc-123",
    "name": "report.pdf",
    "status": "completed",
    "page_count": 5,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:35:00Z"
  },
  {
    "id": "doc-456",
    "name": "invoice.pdf",
    "status": "processing",
    "page_count": null,
    "created_at": "2024-01-15T11:00:00Z",
    "updated_at": "2024-01-15T11:00:00Z"
  }
]
```

### GET /documents/:id

Get a single document with page URLs.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "id": "doc-123",
  "name": "report.pdf",
  "status": "completed",
  "page_count": 5,
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:35:00Z",
  "pages": [
    {
      "page_number": 1,
      "image_url": "https://storage.example.com/doc-123/page-1.png?token=..."
    },
    {
      "page_number": 2,
      "image_url": "https://storage.example.com/doc-123/page-2.png?token=..."
    },
    {
      "page_number": 3,
      "image_url": "https://storage.example.com/doc-123/page-3.png?token=..."
    },
    {
      "page_number": 4,
      "image_url": "https://storage.example.com/doc-123/page-4.png?token=..."
    },
    {
      "page_number": 5,
      "image_url": "https://storage.example.com/doc-123/page-5.png?token=..."
    }
  ]
}
```

**Response (404 Not Found):**
```json
{
  "detail": "Document not found"
}
```

### POST /documents/upload

Upload a new document for processing.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request:**
```
file: <PDF file>
```

**Response (201 Created):**
```json
{
  "id": "doc-789",
  "name": "new-report.pdf",
  "status": "processing",
  "detail": "Document uploaded successfully. Processing started."
}
```

**Response (400 Bad Request):**
```json
{
  "detail": "Invalid file format. Only PDF files are supported."
}
```

### DELETE /documents/:id

Delete a document and its annotations.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "detail": "Document deleted successfully"
}
```

---

## Processing Status

### GET /documents/:id/status

Get document processing status. Used for polling.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK) - Processing:**
```json
{
  "status": "processing",
  "progress": 45,
  "detail": "Converting pages to images..."
}
```

**Response (200 OK) - Completed:**
```json
{
  "status": "completed",
  "progress": 100,
  "detail": "Processing complete"
}
```

**Response (200 OK) - Failed:**
```json
{
  "status": "failed",
  "progress": 0,
  "detail": "Failed to process document: Invalid PDF format"
}
```

**Status Values:**
- `uploaded` - Document uploaded, waiting to process
- `processing` - Document is being processed
- `completed` - Processing finished successfully
- `failed` - Processing failed

---

## Annotations

### GET /documents/:id/annotations

Get all annotations for a document.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
[
  {
    "id": "ann-001",
    "document_id": "doc-123",
    "page_number": 1,
    "document_name": "report.pdf",
    "label": "Important Section",
    "coordinates": {
      "x1": 0.123,
      "y1": 0.456,
      "x2": 0.789,
      "y2": 0.456,
      "x3": 0.789,
      "y3": 0.654,
      "x4": 0.123,
      "y4": 0.654
    },
    "created_at": "2024-01-15T12:00:00Z",
    "created_by": "user-123"
  },
  {
    "id": "ann-002",
    "document_id": "doc-123",
    "page_number": 2,
    "document_name": "report.pdf",
    "label": "Key Data",
    "coordinates": {
      "x1": 0.200,
      "y1": 0.300,
      "x2": 0.600,
      "y2": 0.300,
      "x3": 0.600,
      "y3": 0.450,
      "x4": 0.200,
      "y4": 0.450
    },
    "created_at": "2024-01-15T12:05:00Z",
    "created_by": "user-123"
  }
]
```

### POST /documents/:id/annotations

Save annotations for a document. Replaces existing annotations.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "annotations": [
    {
      "document_name": "report.pdf",
      "page_number": 1,
      "label": "Important Section",
      "coordinates": {
        "x1": 0.123,
        "y1": 0.456,
        "x2": 0.789,
        "y2": 0.456,
        "x3": 0.789,
        "y3": 0.654,
        "x4": 0.123,
        "y4": 0.654
      }
    },
    {
      "document_name": "report.pdf",
      "page_number": 2,
      "label": "Key Data",
      "coordinates": {
        "x1": 0.200,
        "y1": 0.300,
        "x2": 0.600,
        "y2": 0.300,
        "x3": 0.600,
        "y3": 0.450,
        "x4": 0.200,
        "y4": 0.450
      }
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "saved_count": 2,
  "detail": "Annotations saved successfully"
}
```

### DELETE /documents/:id/annotations/:annotationId

Delete a single annotation.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "detail": "Annotation deleted successfully"
}
```

---

## Search

### POST /documents/:id/search

Search for text within a document.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "query": "search term"
}
```

**Response (200 OK):**
```json
{
  "document_id": "doc-123",
  "query": "search term",
  "total_matches": 3,
  "matches": [
    {
      "document_name": "report.pdf",
      "page_number": 1,
      "text": "This is the search term in context",
      "coordinates": {
        "x1": 0.350,
        "y1": 0.200,
        "x2": 0.550,
        "y2": 0.200,
        "x3": 0.550,
        "y3": 0.220,
        "x4": 0.350,
        "y4": 0.220
      },
      "score": 100
    },
    {
      "document_name": "report.pdf",
      "page_number": 3,
      "text": "Another occurrence of search term here",
      "coordinates": {
        "x1": 0.100,
        "y1": 0.500,
        "x2": 0.400,
        "y2": 0.500,
        "x3": 0.400,
        "y3": 0.520,
        "x4": 0.100,
        "y4": 0.520
      },
      "score": 95
    }
  ]
}
```

---

## Coordinate System

All bounding box coordinates are **normalized** (0-1 range) relative to the image dimensions.

### 8-Point Format
Coordinates specify 4 corners of a quadrilateral:
```
[x1, y1, x2, y2, x3, y3, x4, y4]

Point 1 (x1, y1): Top-left corner
Point 2 (x2, y2): Top-right corner
Point 3 (x3, y3): Bottom-right corner
Point 4 (x4, y4): Bottom-left corner
```

### Converting to Pixels
```javascript
const pixelX = normalizedX * imageWidth;
const pixelY = normalizedY * imageHeight;
```

### Example
For a 1000x800 pixel image, coordinates `[0.1, 0.2, 0.5, 0.2, 0.5, 0.4, 0.1, 0.4]` represent:
- Top-left: (100px, 160px)
- Top-right: (500px, 160px)
- Bottom-right: (500px, 320px)
- Bottom-left: (100px, 320px)

---

## Error Responses

All endpoints may return these error responses:

### 400 Bad Request
```json
{
  "detail": "Invalid request parameters"
}
```

### 401 Unauthorized
```json
{
  "detail": "Authentication required"
}
```

### 403 Forbidden
```json
{
  "detail": "You do not have permission to access this resource"
}
```

### 404 Not Found
```json
{
  "detail": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "detail": "An unexpected error occurred"
}
```

---

## Rate Limiting

API may implement rate limiting. Check response headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705320000
```

When rate limited (429 Too Many Requests):
```json
{
  "detail": "Rate limit exceeded. Please try again later."
}
```
