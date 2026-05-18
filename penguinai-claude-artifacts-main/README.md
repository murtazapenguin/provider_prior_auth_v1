# PenguinAI Claude Artifacts

A collection of [Claude Code](https://claude.ai/claude-code) agents, skills, and reusable templates for building full-stack applications with AI-powered document processing capabilities.

## What's Inside

This repository contains:

| Directory | Description |
|-----------|-------------|
| `.claude/agents/` | Custom subagents for the full-stack development pipeline |
| `.claude/capabilities/` | Capability definitions used during Phase 0 requirements gathering |
| `.claude/contracts/` | Canonical data format specifications between agents |
| `.claude/orchestrator/` | Phase-specific orchestrator instructions |
| `.claude/patterns/` | Shared canonical patterns (S3, JWT, multi-tenancy, etc.) |
| `.claude/skills/` | Claude Code skills with patterns and templates |
| `Standard_UI_Template/` | React + Vite + Tailwind CSS starter template |
| `data-labelling-library/` | PDF viewer with annotation and NER capabilities |
| `platform-backend-kit/` | FastAPI + MongoDB backend template |
| `packages/` | Local Python packages (penguin-ai-sdk wheel) |

---

## Quick Start

### 1. Clone this repository

```bash
git clone https://github.com/Penguin-AI-Corp/penguinai-claude-artifacts.git
cd penguinai-claude-artifacts
```

### 2. Use with Claude Code

The agents and skills are automatically available when you run Claude Code in this directory:

```bash
claude
```

Claude will automatically detect and use the skills when relevant, or you can invoke them directly:

```bash
# Invoke skills directly
/frontend-guide
/backend-guide
/ai-engineering-guide
```

---

## Claude Code Agents

Agents are specialized subagents that Claude can spawn to handle specific tasks. They're defined in `.claude/agents/`.

| Agent | Purpose | Phase |
|-------|---------|-------|
| `ui-builder` | Builds React UI applications with Vite, React Router, and Tailwind CSS v4 | Phase 1 |
| `api-builder` | Creates FastAPI backends with MongoDB, JWT auth, and Motor async driver | Phase 2 |
| `ai-integrator` | Adds AI capabilities using penguin-ai-sdk (OCR, LLM extraction) | Phase 2.5 |
| `integration-tester` | Validates cross-phase contracts via real HTTP calls after each phase | After each phase |
| `quality-tester` | Tests applications with mandatory browser testing via Playwright MCP | Phase 3 |

### Development Pipeline

```
┌─────────────┐   ┌──────────────────┐   ┌─────────────┐   ┌──────────────────┐
│  ui-builder │──▶│integration-tester│──▶│ api-builder │──▶│integration-tester│
│   Phase 1   │   │  (after Phase 1) │   │   Phase 2   │   │  (after Phase 2) │
└─────────────┘   └──────────────────┘   └─────────────┘   └──────────────────┘
                                                                       │
                                                                       ▼
                  ┌────────────────┐   ┌──────────────────┐   ┌───────────────┐
                  │ quality-tester │◀──│integration-tester│◀──│ ai-integrator │
                  │    Phase 3     │   │ (after Phase 2.5)│   │   Phase 2.5   │
                  └────────────────┘   └──────────────────┘   └───────────────┘
```

---

## Claude Code Skills

Skills provide Claude with domain-specific knowledge and patterns. They're defined in `.claude/skills/` following the [Agent Skills open standard](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).

### Available Skills

| Skill | Triggers On | Description |
|-------|-------------|-------------|
| `frontend-guide` | React, PDF viewers, Tailwind | React UI patterns for PDF processing and document annotation |
| `backend-guide` | FastAPI, MongoDB, authentication | FastAPI backend patterns with JWT auth and async MongoDB |
| `ai-engineering-guide` | penguin-ai-sdk, LLM, OCR | AI application patterns using PenguinAI SDK |
| `ui-testing-guide` | Test UI, review UI, QA | Browser testing with Playwright MCP |

### Available Capabilities

Capabilities are selected during Phase 0 requirements gathering. Each enables specific infrastructure, endpoints, and UI components:

| Capability | Description |
|------------|-------------|
| `document_processing` | PDF/image viewing via PDFViewer component |
| `evidence_display` | Bounding box highlighting of AI evidence in documents |
| `ai_extraction` | penguin-ai-sdk OCR + LLM extraction pipeline |
| `realtime_status` | WebSocket progress updates during processing |
| `async_processing` | Celery background task queue (required for AI/ML work) |
| `file_storage` | AWS S3 upload/download with presigned URLs |
| `editable_results` | Users can edit AI extraction results |
| `workflow` | Item status transitions (e.g. pending → review → approved) |
| `rbac` | Role-based access control with per-role endpoint restrictions |

See `.claude/capabilities/` for the full definition of each capability.

### Skill Structure

Each skill follows the Claude Code skills format:

```
.claude/skills/
└── frontend-guide/
    ├── SKILL.md              # Main instructions (required)
    └── templates/            # Supporting templates
        ├── api-contract.md
        ├── api-hooks.js
        ├── auth-context.jsx
        └── transformers.js
```

### Using Skills

Skills are automatically loaded when Claude detects relevant context. You can also invoke them directly:

```bash
# In Claude Code
/frontend-guide    # Load React/UI patterns
/backend-guide     # Load FastAPI/MongoDB patterns
```

---

## Source Libraries

### Standard UI Template

**Location:** `Standard_UI_Template/`

A React + Vite + Tailwind CSS v4 starter template with PenguinAI branding.

```bash
# Copy to start a new project
cp -r Standard_UI_Template/* my-new-app/
cd my-new-app
npm install
npm run dev
```

**Features:**
- React 18 with Vite
- Tailwind CSS v4 with custom animations
- PenguinAI branding (colors, logos, glass effects)
- Login and Dashboard components
- React Router setup

### Data Labelling Library

**Location:** `data-labelling-library/`

A production PDF viewer with annotation and NER (Named Entity Recognition) capabilities.

```bash
# Add to your project
cp -r data-labelling-library my-app/src/lib/pdf-viewer

# Install dependencies
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material lucide-react
```

**Components:**
- `PDFViewer` - PDF viewing with bounding box highlighting and search
- `NERViewer` - Named entity recognition with color-coded entity types

**Usage:**
```jsx
import { PDFViewer, NERViewer } from './lib/pdf-viewer';

<PDFViewer
  documentData={documentData}
  boundingBoxes={boundingBoxes}
  className="h-full"
/>
```

### Platform Backend Kit

**Location:** `platform-backend-kit/`

A production-ready FastAPI backend with authentication, multi-tenancy, and WebSocket support.

```bash
# Copy to start a new backend
cp -r platform-backend-kit/* my-backend/
cd my-backend
pip install -r requirements.txt
uvicorn app:app --reload
```

**Features:**
- Multi-auth support (Basic, Microsoft, Google, SSO/SAML)
- JWT-based session management
- Role-based access control (RBAC)
- WebSocket real-time messaging
- OCR and PDF utilities (Azure Form Recognizer)
- Multi-cloud storage (AWS S3, Azure Blob)

---

## File Formats

### Document Data Format

Used by PDFViewer and NERViewer:

```javascript
const documentData = {
  files: ["document.pdf"],
  presigned_urls: {
    "document.pdf": {
      "1": "https://url-to-page-1.png",
      "2": "https://url-to-page-2.png"
    }
  }
};
```

### Bounding Box Format (8-point normalized)

```javascript
const boundingBoxes = {
  document_name: "document.pdf",  // must match documentData.files exactly
  page_number: 1,                 // integer, 1-indexed (NOT a string)
  bbox: [[0.1, 0.2, 0.3, 0.2, 0.3, 0.25, 0.1, 0.25]]  // normalized 0-1, x1,y1,...,x4,y4
};
```

See `.claude/contracts/bbox-format.md` for the full canonical specification.

### NER Data Format

```javascript
const nerData = [{
  filename: "document.pdf",
  data: {
    "1": [{
      word: "John",
      entity: "John Doe",
      entity_type: "PERSON",
      code: "P001",
      bbox: [0.1, 0.1, 0.2, 0.15],
      tags: ["patient"]
    }]
  }
}];
```

---

## Environment Variables

### Required Setup

All applications require a `.env` file at the **project root** (not `backend/.env`). The backend automatically reads from parent directories.

### Core Variables (Always Required)

```env
# Database
MONGODB_URL=mongodb://localhost:27017/
DATABASE_NAME=penguin_app

# Authentication
JWT_SECRET=<generate-with-openssl-rand-hex-32>

# CORS (Frontend-Backend Communication)
CORS_ORIGINS=http://localhost:5173,https://yourdomain.com
```

### Conditional Variables by Capability

#### If `async_processing` capability:
```env
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=<your-redis-password>  # If Redis requires auth
REDIS_SSL=true  # If using SSL/TLS
```

#### If `file_storage` or `document_processing` capability:
```env
# AWS S3 Storage
AWS_ACCESS_KEY_ID=<your-access-key>
AWS_SECRET_ACCESS_KEY=<your-secret-key>
S3_BUCKET_NAME=workflow-builder-platform-backend-uploads
S3_APP_PREFIX=your-app-name  # Per-app folder prefix within the shared bucket

# CORS (for browser uploads)
CORS_ORIGINS=http://localhost:5173,https://app.example.com
```

**Note:** After setting AWS credentials, configure S3 bucket CORS:
```bash
cd platform-backend-kit
python scripts/setup_s3_cors.py --bucket $S3_BUCKET_NAME --origins $CORS_ORIGINS
```

#### If `document_processing` capability:
```env
# Azure Document Intelligence (OCR)
AZURE_OCR_ENDPOINT=<your-azure-endpoint>
AZURE_OCR_SECRET_KEY=<your-azure-key>
```

#### If `ai_extraction` capability:

**All AI processing uses [penguin-ai-sdk](https://github.com/Penguin-AI-Corp/penguin-ai-sdk)** (provider-agnostic).

The SDK supports multiple LLM providers. Set credentials for **ONE** provider:

```env
# Option 1: AWS Bedrock (uses AWS credentials above)
# Option 2: Google Gemini
GOOGLE_API_KEY=<your-gemini-key>

# Option 3: OpenAI
OPENAI_API_KEY=<your-openai-key>

# Option 4: Azure OpenAI
AZURE_OPENAI_ENDPOINT=<your-azure-openai-endpoint>
AZURE_OPENAI_API_KEY=<your-azure-openai-key>
```

**For detailed penguin-ai-sdk configuration**, see: [`.claude/skills/ai-engineering-guide/usage/`](.claude/skills/ai-engineering-guide/usage/00-GETTING-STARTED.md)

### Frontend Variables

Create `frontend/.env.development`:

```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

### Complete Example

```env
# === Core (Always Required) ===
MONGODB_URL=mongodb://localhost:27017/
DATABASE_NAME=penguin_app
JWT_SECRET=<generate-with-openssl-rand-hex-32>

# === If async_processing ===
REDIS_URL=redis://localhost:6379

# === If file_storage or document_processing ===
AWS_ACCESS_KEY_ID=<your-access-key>
AWS_SECRET_ACCESS_KEY=<your-secret-key>
S3_BUCKET_NAME=workflow-builder-platform-backend-uploads
S3_APP_PREFIX=your-app-name  # Per-app folder prefix within the shared bucket

# === If document_processing (OCR) ===
AZURE_OCR_ENDPOINT=<your-azure-endpoint>
AZURE_OCR_SECRET_KEY=<your-azure-key>

# === If ai_extraction (choose ONE LLM provider) ===
# Bedrock: uses AWS credentials above
# OR
GOOGLE_API_KEY=<your-gemini-key>
# OR
OPENAI_API_KEY=<your-openai-key>
# OR
AZURE_OPENAI_ENDPOINT=<your-azure-openai-endpoint>
AZURE_OPENAI_API_KEY=<your-azure-openai-key>
```

### Important Notes

- **Single .env location**: All credentials in ONE file at project root
- **Backend auto-discovery**: `config.py` automatically loads `.env` from parent directories
- **Generate JWT_SECRET**: `openssl rand -hex 32`
- **Never commit**: Add `.env` to `.gitignore`
- **penguin-ai-sdk**: Provider-agnostic AI library (see .claude/skills/ai-engineering-guide/usage/ for details)
- **Environment discovery**: Search for existing `.env` files before creating new ones:
  ```bash
  find ../.. -name ".env*" -type f 2>/dev/null
  ```

---

## PenguinAI Branding

**Primary Color:** `#fc459d`

**Glass Effect:**
```css
.glass-effect {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
}
```

**Logo Assets:**
- `Standard_UI_Template/public/penguin-logo.svg` - Logo icon
- `Standard_UI_Template/public/Penguinai-name.png` - Full brand name

---

## Learn More

### Claude Code Documentation
- [Extend Claude with Skills](https://code.claude.com/docs/en/skills) - Official skills documentation
- [Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) - Agent Skills platform docs
- [Introducing Agent Skills](https://claude.com/blog/skills) - Blog post about skills

### Related Resources
- [Claude Code CLI](https://claude.ai/claude-code) - The agentic coding tool
- [Agent Skills Open Standard](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) - Technical deep dive

---

## License

MIT License

---

## Contributing

1. Follow existing code structure and naming conventions
2. Add docstrings and type hints to all new code
3. Test with Claude Code before submitting PRs
