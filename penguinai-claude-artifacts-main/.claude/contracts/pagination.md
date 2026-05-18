# Contract: pagination

## Overview
Defines the paginated list response format for all collection endpoints.

## Producer
- **api-builder** (Phase 2) - All list endpoints (GET /cases, GET /users, etc.)

## Consumers
- **ui-builder** (Phase 1) - DataTable components, pagination controls
- **quality-tester** (Phase 3) - Verifies list endpoints

## Schema

### Request Parameters

```
GET /api/v1/cases?page=1&page_size=20&sort_by=created_at&sort_order=desc&status=pending
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number (1-indexed) |
| `page_size` | int | 20 | Items per page (max 100) |
| `sort_by` | string | "created_at" | Field to sort by |
| `sort_order` | string | "desc" | "asc" or "desc" |
| `{filter}` | string | - | Filter fields (e.g., status, lob) |

### Response

```json
{
  "items": [
    { "id": "...", "field": "value" }
  ],
  "total": 100,
  "page": 1,
  "page_size": 20,
  "total_pages": 5
}
```

## Field Requirements

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | array | YES | Array of items for current page |
| `total` | int | YES | Total count across all pages |
| `page` | int | YES | Current page number |
| `page_size` | int | YES | Items per page |
| `total_pages` | int | NO | Calculated total pages |

## Example

```json
{
  "items": [
    { "case_id": "91091190", "status": "pending", "lob": "MEDICAID" },
    { "case_id": "91828954", "status": "evaluated", "lob": "MEDICAID" }
  ],
  "total": 45,
  "page": 1,
  "page_size": 20,
  "total_pages": 3
}
```

## Frontend Usage

```javascript
// Dashboard.jsx
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(20);

const { data } = useQuery(['cases', page, pageSize], () =>
  api.get('/cases', { params: { page, page_size: pageSize } })
);

// Render
<DataTable data={data.items} />
<Pagination
  currentPage={data.page}
  totalPages={data.total_pages}
  onPageChange={setPage}
/>
```

## Validation Rules

1. `items` MUST be an array (empty array if no results)
2. `total` MUST reflect actual count (not just current page)
3. `page` MUST match requested page
4. `page_size` MUST NOT exceed 100
5. Empty results: `{ "items": [], "total": 0, "page": 1, "page_size": 20 }`

## Backend Implementation

```python
@router.get("/cases")
async def list_cases(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc"),
    status: Optional[str] = None
):
    skip = (page - 1) * page_size
    query = {"org_id": current_user.org_id}
    if status:
        query["status"] = status

    total = await db.cases.count_documents(query)
    items = await db.cases.find(query).skip(skip).limit(page_size).to_list(page_size)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": ceil(total / page_size)
    }
```

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Use `limit` instead of `page_size` | Frontend pagination breaks | Use `page_size` |
| Return `data` instead of `items` | DataTable can't render | Use `items` |
| Missing `total` | Can't calculate total pages | Always include |
| 0-indexed pages | Off-by-one errors | Use 1-indexed |
