# Capability: file_storage

## Description
Users upload files (PDFs, images, documents) which are stored in AWS S3.
All file operations go through S3 — NO local filesystem storage in production.

## Question
"Will users upload files?"

## Options
- Yes — store in S3 (mandatory for document_processing and ai_extraction with files)
- No — skip this capability

## Contracts Required
- `storage-format` — S3 key conventions and presigned URL patterns

## Schema Fields
Add to item schema:
```python
source_files: list[str]   # S3 keys (NOT presigned URLs — those expire)
file_names: list[str]     # Original filenames for display
```

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/v1/{items}/{id}/upload-url`    | Returns presigned PUT URL for upload |
| POST | `/api/v1/{items}/{id}/confirm-upload` | Confirms upload complete, updates DB |
| GET  | `/api/v1/{items}/{id}/files`         | Returns presigned GET URLs for download |

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/api/v1/{items}/{id}/upload-url` | GET | - | `file_name` (query param) | application/json |
| `/api/v1/{items}/{id}/confirm-upload` | POST | application/json | `{s3_key, file_name}` | application/json |
| `/api/v1/{items}/{id}/files` | GET | - | - | application/json |

**Response — GET /upload-url:**
```json
{"upload_url": "https://s3.../...", "s3_key": "prefix/org/entity/id/file.pdf", "expires_in": 3600}
```

**Request — POST /confirm-upload body:**
```json
{"s3_key": "prefix/org/entity/id/file.pdf", "file_name": "document.pdf"}
```

**Response — POST /confirm-upload:**
```json
{"status": "ok"}
```

**Response — GET /files:**
```json
{"files": [{"file_name": "document.pdf", "download_url": "https://s3.../...", "size": 102400}]}
```

## S3 Rules (MANDATORY)
- ALWAYS set `ContentType` on upload (use `mimetypes.guess_type()`)
- Store S3 keys in MongoDB, NEVER presigned URLs (they expire)
- Generate presigned URLs on-demand in `GET /files` endpoint
- Use `settings.s3_presigned_url_expiry` (default 3600s)
- S3 key pattern: `{s3_app_prefix}/{org_id}/{entity_type}/{entity_id}/{filename}`
- See `.claude/patterns/s3-integration.md` for full implementation

## Data Types

> See `.claude/contracts/storage-format.md` for full schema (if it exists), or derive from the API Formats above.

## UI Components
- File upload input (drag & drop or click)
- Upload progress indicator
- File list with download links

## Dependencies
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` env vars
- `S3_APP_PREFIX` to isolate this app within the shared bucket
- `platform-backend-kit/app/modules/storage/`
