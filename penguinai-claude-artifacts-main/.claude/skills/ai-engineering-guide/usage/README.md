# Penguin AI SDK - Usage Documentation

Practical guides for Python developers using the Penguin AI SDK. Each guide provides examples and focused explanations.

> **v0.2.0**: Core rebuilt on **LangChain + LangGraph + Langfuse**. The primary API is `penguin.core`.

---

## 📚 Documentation Structure

### [00-GETTING-STARTED.md](00-GETTING-STARTED.md) - Start Here
Installation, your first example, and quick reference for common patterns.

**Topics**:
- What is Penguin AI SDK?
- Prerequisites and installation
- Your first example
- Understanding SDK patterns
- Provider comparison
- Common gotchas

**Read this first** if you're new to Penguin AI SDK.

---

### [01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md) - Foundation
Core module, models, tools, and agents - the primary v0.2.0 API.

**Topics**:
- Core module overview (v0.2.0)
- Models: create, invoke, stream, structured output
- Tools: @tool decorator and binding
- Agents: create_agent, run_agent
- Stateful workflows and state management
- Security callbacks
- Langfuse tracing basics

**Code examples**: Model creation, tool calling, agents, state graphs

---

### [02-TRACING-AND-CALLBACKS.md](02-TRACING-AND-CALLBACKS.md) - Observability
Callbacks for security/guardrails and Langfuse tracing for production monitoring.

**Topics**:
- Callbacks overview (security, guardrails, custom handlers)
- Langfuse tracing (global vs project-level)
- Session tracking and metadata
- Docker Compose for local Langfuse
- Production monitoring best practices

**Code examples**: Security callbacks, tracing setup, PenguinTracer

---

### [03-DOCUMENT-PROCESSING.md](03-DOCUMENT-PROCESSING.md) - OCR & Redaction
Extract text from documents and detect/remove PII.

**Topics**:
- OCR Module (Azure, AWS, Google providers)
- Processing PDFs and images
- Batch processing
- Querying OCR results
- Redaction Module (PII detection/removal)
- Complete pipeline: OCR → Redaction → LLM

**Code examples**: PDF extraction, batch processing, PII redaction

---

### [04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md) - Semantic Search
Text embeddings and vector databases for RAG pipelines.

**Topics**:
- Embeddings Module (Bedrock, sentence-transformers)
- Generate embeddings for text
- Open-source models
- Query vs document embeddings
- Vector Database Module (S3 Vectors)
- Storing and querying vectors
- Complete RAG example

**Code examples**: Embedding generation, vector storage, similarity search

---

### [05-DATA-AND-COMPLIANCE.md](05-DATA-AND-COMPLIANCE.md) - Data & Evaluation
Data assets, evaluation framework, and compliance checking.

**Topics**:
- Data Assets Module (ICD-10, bundled/remote datasets)
- Cache management
- Custom datasets
- Evals Module (LLM-as-judge framework)
- Batch evaluation
- Compliance Module (rule checking)
- Evals vs Compliance comparison

**Code examples**: Loading datasets, running evaluations, compliance checks

---

### [06-ML-CAPABILITIES.md](06-ML-CAPABILITIES.md) - Machine Learning
Blueprints, AutoML, fine-tuning, and vision models.

**Topics**:
- Blueprints Module (workflow pattern library)
- AutoML Module (automated ML for tabular data)
- Fine-tuning Module (LLMs, rerankers, embeddings)
- VLM Module (vision language models)

**Code examples**: Blueprint management, AutoML training, fine-tuning, image analysis

---

### [07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md) - Complete Examples
Common workflows showing how modules work together.

**Topics**:
- Workflow 1: Simple Chat
- Workflow 2: Agent with Tools
- Workflow 3: RAG Pipeline
- Workflow 4: Document Processing
- Workflow 5: Approval Workflow with State
- Environment variables reference
- Best practices

**Code examples**: Production-ready templates

---

## 🚀 Quick Start

### For Beginners

1. **Start**: [00-GETTING-STARTED.md](00-GETTING-STARTED.md) - Install and run your first example
2. **Learn**: [01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md) - Understand the core API
3. **Practice**: [07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md) - See complete workflows

### For Experienced Users

1. **Overview**: Skim [00-GETTING-STARTED.md](00-GETTING-STARTED.md) for quick reference
2. **Workflows**: Jump to [07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md) for patterns
3. **Deep Dive**: Reference specific modules (01-06) as needed

### For Document Processing

1. [00-GETTING-STARTED.md](00-GETTING-STARTED.md) - Installation
2. [03-DOCUMENT-PROCESSING.md](03-DOCUMENT-PROCESSING.md) - OCR and redaction
3. [07-WORKFLOWS-AND-PATTERNS.md#workflow-4](07-WORKFLOWS-AND-PATTERNS.md#workflow-4-document-processing-pipeline) - Complete pipeline

### For Production Deployment

1. [01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md) - Core API
2. [02-TRACING-AND-CALLBACKS.md](02-TRACING-AND-CALLBACKS.md) - Monitoring and security
3. [07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md) - Best practices

---

## 📋 Topics by Use Case

### "I want to chat with an LLM"
→ [00-GETTING-STARTED.md - Your First Example](00-GETTING-STARTED.md#your-first-example)
→ [01-CORE-AND-AGENTS.md - Basic Usage](01-CORE-AND-AGENTS.md#basic-usage)

### "I want to build an agent with tools"
→ [01-CORE-AND-AGENTS.md - Tools](01-CORE-AND-AGENTS.md#tools)
→ [01-CORE-AND-AGENTS.md - Agents](01-CORE-AND-AGENTS.md#agents)
→ [07-WORKFLOWS-AND-PATTERNS.md - Workflow 2](07-WORKFLOWS-AND-PATTERNS.md#workflow-2-agent-with-custom-tools)

### "I want to process documents (OCR)"
→ [03-DOCUMENT-PROCESSING.md - OCR Module](03-DOCUMENT-PROCESSING.md#ocr-module)
→ [07-WORKFLOWS-AND-PATTERNS.md - Workflow 4](07-WORKFLOWS-AND-PATTERNS.md#workflow-4-document-processing-pipeline)

### "I want semantic search / RAG"
→ [04-EMBEDDINGS-AND-SEARCH.md - Embeddings](04-EMBEDDINGS-AND-SEARCH.md#embeddings-module)
→ [04-EMBEDDINGS-AND-SEARCH.md - Vector DB](04-EMBEDDINGS-AND-SEARCH.md#vector-database-module)
→ [07-WORKFLOWS-AND-PATTERNS.md - Workflow 3](07-WORKFLOWS-AND-PATTERNS.md#workflow-3-rag-pipeline)

### "I want to track costs and debug"
→ [02-TRACING-AND-CALLBACKS.md - Langfuse Tracing](02-TRACING-AND-CALLBACKS.md#langfuse-tracing)
→ [02-TRACING-AND-CALLBACKS.md - Production Monitoring](02-TRACING-AND-CALLBACKS.md#production-monitoring)

### "I want to evaluate my AI outputs"
→ [05-DATA-AND-COMPLIANCE.md - Evals Module](05-DATA-AND-COMPLIANCE.md#evals-module)
→ [05-DATA-AND-COMPLIANCE.md - Compliance Module](05-DATA-AND-COMPLIANCE.md#compliance-module)

### "I want to fine-tune a model"
→ [06-ML-CAPABILITIES.md - Fine-tuning Module](06-ML-CAPABILITIES.md#fine-tuning-module)

---

## 🔍 Search by Keyword

| Keyword | Guide | Section |
|---------|-------|---------|
| create_model | 01-CORE | [Basic Usage](01-CORE-AND-AGENTS.md#basic-usage) |
| @tool | 01-CORE | [Tools](01-CORE-AND-AGENTS.md#tools) |
| create_agent | 01-CORE | [Agents](01-CORE-AND-AGENTS.md#agents) |
| streaming | 01-CORE | [Streaming](01-CORE-AND-AGENTS.md#streaming) |
| structured output | 01-CORE | [Structured Output](01-CORE-AND-AGENTS.md#structured-output) |
| state graph | 01-CORE | [Stateful Workflows](01-CORE-AND-AGENTS.md#stateful-workflows-and-state-management) |
| interrupts | 01-CORE | [Human-in-the-Loop](01-CORE-AND-AGENTS.md#stateful-workflows-and-state-management) |
| Langfuse | 02-TRACING | [Langfuse Tracing](02-TRACING-AND-CALLBACKS.md#langfuse-tracing) |
| PenguinTracer | 02-TRACING | [Project-Level Tracing](02-TRACING-AND-CALLBACKS.md#project-level-tracing-with-penguintracer) |
| security callbacks | 02-TRACING | [Callbacks Overview](02-TRACING-AND-CALLBACKS.md#callbacks-overview) |
| OCR | 03-DOCUMENT | [OCR Module](03-DOCUMENT-PROCESSING.md#ocr-module) |
| redaction | 03-DOCUMENT | [Redaction Module](03-DOCUMENT-PROCESSING.md#redaction-module) |
| embeddings | 04-EMBEDDINGS | [Embeddings Module](04-EMBEDDINGS-AND-SEARCH.md#embeddings-module) |
| vector database | 04-EMBEDDINGS | [Vector Database Module](04-EMBEDDINGS-AND-SEARCH.md#vector-database-module) |
| RAG | 04-EMBEDDINGS | [Complete RAG Example](04-EMBEDDINGS-AND-SEARCH.md#vector-database-module) |
| ICD-10 | 05-DATA | [Data Assets](05-DATA-AND-COMPLIANCE.md#data-assets-module) |
| evaluation | 05-DATA | [Evals Module](05-DATA-AND-COMPLIANCE.md#evals-module) |
| compliance | 05-DATA | [Compliance Module](05-DATA-AND-COMPLIANCE.md#compliance-module) |
| blueprints | 06-ML | [Blueprints Module](06-ML-CAPABILITIES.md#blueprints-module) |
| AutoML | 06-ML | [AutoML Module](06-ML-CAPABILITIES.md#automl-module) |
| fine-tuning | 06-ML | [Fine-tuning Module](06-ML-CAPABILITIES.md#fine-tuning-module) |
| VLM | 06-ML | [VLM Module](06-ML-CAPABILITIES.md#vlm-module) |

---

## 🗺️ Module Quick Reference

| Module | Guide | Status | Description |
|--------|-------|--------|-------------|
| **Core** | 01-CORE | v0.2.0 Primary API | Models, tools, agents, tracing |
| **Callbacks** | 02-TRACING | Active | Security, guardrails, custom handlers |
| **Tracing** | 02-TRACING | Active | Langfuse observability |
| **OCR** | 03-DOCUMENT | Active | Document text extraction |
| **Redaction** | 03-DOCUMENT | Active | PII detection/removal |
| **Embeddings** | 04-EMBEDDINGS | Active | Text → vectors |
| **Vector DB** | 04-EMBEDDINGS | Active | Similarity search |
| **Data Assets** | 05-DATA | Active | Bundled/remote datasets |
| **Evals** | 05-DATA | Active | LLM-as-judge evaluation |
| **Compliance** | 05-DATA | Active | Rule checking |
| **Blueprints** | 06-ML | Active | Workflow pattern library |
| **AutoML** | 06-ML | Active | Automated ML training |
| **Fine-tuning** | 06-ML | Active | Model customization |
| **VLM** | 06-ML | Active | Vision language models |
| **LLM** | - | Deprecated | Use Core instead |
| **Tools** | - | Deprecated | Use Core instead |
| **Agents** | - | Deprecated | Use Core instead |
| **Middleware** | - | Deprecated | Use Callbacks instead |
| **Observability** | - | Deprecated | Use Tracing instead |

---

## ⚠️ Common Gotchas

### Installation
- ❌ **WRONG**: `pip install penguin` (doesn't install PyTorch)
- ✅ **CORRECT**: `pip install torch --index-url https://download.pytorch.org/whl/cpu` first
- See: [00-GETTING-STARTED.md - Installation](00-GETTING-STARTED.md#installation)

### Model Provider Slugs
- ❌ **WRONG**: `provider="bedrock"` (will fail with LangChain)
- ✅ **CORRECT**: Use registry: `create_model(provider="bedrock", model="claude-sonnet-4-5")`
- See: [01-CORE-AND-AGENTS.md - Basic Usage](01-CORE-AND-AGENTS.md#basic-usage)

### Async/Sync
- ❌ **WRONG**: Forgetting `await` with async methods
- ✅ **CORRECT**: `result = await run_agent(agent, prompt)`
- See: [01-CORE-AND-AGENTS.md - Agents](01-CORE-AND-AGENTS.md#agents)

### OCR Line Numbers
- ❌ **WRONG**: Assuming line numbers are 0-indexed
- ✅ **CORRECT**: Line numbers start at 1 and reset on each page
- See: [03-DOCUMENT-PROCESSING.md - Querying OCR Results](03-DOCUMENT-PROCESSING.md#querying-ocr-results)

---

## 📖 Additional Resources

### Penguin SDK
- [Main README](../../README.md) - Full API reference
- [Examples](../../examples/) - Jupyter notebooks and scripts

### Official Documentation
- [LangChain Docs](https://python.langchain.com/)
- [LangGraph Docs](https://langchain-ai.github.io/langgraph/)
- [Langfuse Docs](https://langfuse.com/docs)

---

## 🎯 Next Steps

1. **Installation**: [00-GETTING-STARTED.md](00-GETTING-STARTED.md)
2. **First Example**: [00-GETTING-STARTED.md#your-first-example](00-GETTING-STARTED.md#your-first-example)
3. **Learn Core API**: [01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md)
4. **See Complete Workflows**: [07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md)

---

*This modular documentation structure supports progressive disclosure - start simple, go deep when needed.*
