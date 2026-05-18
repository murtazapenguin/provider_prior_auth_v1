← [Home](README.md) | [Next: 01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md) →

---

# Getting Started with Penguin AI SDK

**A quick introduction to get you up and running in minutes**

---

## What is Penguin AI SDK?

Penguin AI SDK is a **provider-agnostic AI orchestration library** built on **LangChain + LangGraph + Langfuse**. Instead of learning different APIs for each AI provider (AWS Bedrock, Google Gemini, OpenAI), you use a single, consistent interface.

**Key benefits:**
- **One API, Multiple Providers**: 18+ models across Bedrock, OpenAI, Azure, Gemini — same code
- **Built-in Tool System**: LangChain `@tool` decorator with automatic schema generation
- **Agent Framework**: LangGraph React agents with checkpointing and multi-turn support
- **Full Pipeline Support**: OCR, embeddings, vector search, evaluation — everything for production AI apps
- **Langfuse Tracing**: Auto-instrumented LLM calls with a visual dashboard

---

## Prerequisites

Before using Penguin AI SDK, ensure you have:

- **Python 3.12** installed
- **AWS credentials** configured (for Bedrock) - run `aws configure`
- **API keys** for other providers (Gemini, OpenAI) if needed

---

## Installation

### CPU Installation (Mac/Laptops/EC2) - Recommended for most users

The wheel is bundled in the repository root — no S3 download needed.

```bash
# Step 1: Install CPU-only PyTorch first (saves ~2GB vs CUDA version)
pip install torch --index-url https://download.pytorch.org/whl/cpu

# Step 2: Install Penguin from the bundled wheel
pip install "./packages/penguin_ai_sdk-0.2.0-py3-none-any.whl[cpu]"
```

### Minimal Installation (API features only, no finetuning)

```bash
pip install "./packages/penguin_ai_sdk-0.2.0-py3-none-any.whl[api]"
```

### GPU Installation (CUDA machines only)

```bash
# Step 1: Install CUDA PyTorch (adjust cu121 for your CUDA version)
pip install torch --index-url https://download.pytorch.org/whl/cu121

# Step 2: Install Penguin with GPU support from the bundled wheel
pip install "./packages/penguin_ai_sdk-0.2.0-py3-none-any.whl[gpu]"
```

---

## Your First Example

Here's a complete example you can run immediately:

```python
from penguin.core import create_model, HumanMessage

# Step 1: Create a model (uses AWS Bedrock by default)
model = create_model(provider="bedrock", model="claude-sonnet-4-5")

# Step 2: Send a message and get a response
result = model.invoke([HumanMessage(content="What is Python in one sentence?")])

# Step 3: Print the response
print(result.content)
# Output: "Python is a high-level, interpreted programming language..."
```

---

## Understanding the SDK Pattern

The v0.2.0 core API follows LangChain conventions:

```python
# 1. Import from penguin.core
from penguin.core import create_model, create_agent, run_agent, tool, HumanMessage, SystemMessage

# 2. Create a model
model = create_model(provider="bedrock", model="claude-sonnet-4-5")

# 3. Use LangChain methods
result = model.invoke([HumanMessage(content="Hello")])  # Sync
for chunk in model.stream([HumanMessage(content="Hi")]):  # Stream
    print(chunk.content, end="")
```

---

## Common Gotchas

1. **Sync by default**: `model.invoke()` is synchronous. Use `await model.ainvoke()` for async.
2. **Provider credentials**: Ensure AWS credentials or API keys are set before running
3. **Model names**: Use friendly names from the registry (e.g., `"claude-sonnet-4-5"`, `"gpt-4o"`, `"gemini-2.5-flash"`)

---

## Quick Reference

### Provider Comparison

| Provider | Models | Setup Required |
|----------|--------|----------------|
| `bedrock` | Claude Opus/Sonnet 4.5, Claude 3 | AWS credentials (`aws configure`) |
| `openai` | GPT-4o, o1 | `OPENAI_API_KEY` env var |
| `azure_openai` | Azure GPT-4o | `AZURE_OPENAI_*` env vars |
| `google-genai` | Gemini 2.5 Flash/Pro | `GOOGLE_API_KEY` env var |

### Common Patterns Cheat Sheet

> **Tip**: `penguin.core` re-exports all common LangChain and LangGraph types
> (`HumanMessage`, `BaseChatModel`, `StateGraph`, etc.) so you rarely need to
> import from `langchain_core` or `langgraph` directly.
> See the full list in [01-CORE-AND-AGENTS.md — Quick Reference](01-CORE-AND-AGENTS.md#quick-reference-penguincore-exports).

```python
# Core imports
from penguin.core import (
    create_model, tool, create_agent, run_agent,
    HumanMessage, SystemMessage,
    # Stateful workflows
    create_state_graph, START, END, MemorySaver,
    interrupt, Command, RetryPolicy,
    get_graph_state, update_graph_state, get_graph_history
)

model = create_model(provider="bedrock", model="claude-sonnet-4-5")

# Simple chat
result = model.invoke([HumanMessage(content="Hello")])
print(result.content)

# Chat with system prompt
result = model.invoke([
    SystemMessage(content="You are a helpful assistant."),
    HumanMessage(content="Hello")
])

# Streaming response
for chunk in model.stream([HumanMessage(content="Tell me a story")]):
    print(chunk.content, end="")

# Structured output (JSON)
from pydantic import BaseModel
class Person(BaseModel):
    name: str
    age: int

structured_model = model.with_structured_output(Person)
result = structured_model.invoke([HumanMessage(content="Extract: John is 30")])
print(result.name, result.age)  # "John" 30

# Prompt caching — reuse large system prompts cheaply (Bedrock)
from penguin.core import with_prompt_caching, extract_cache_metrics
cached_model = create_model(provider="bedrock", model="claude-sonnet-4-5", enable_prompt_caching=True)
# First call writes to cache; subsequent calls with the same SystemMessage are ~90% cheaper
r = cached_model.invoke([SystemMessage(content="big prompt..."), HumanMessage(content="q")])
m = extract_cache_metrics(r)  # {"cache_hit": bool, "cache_write_tokens": int, "cache_read_tokens": int}

# Create and use tools with an agent
@tool
def get_weather(city: str) -> str:
    """Get weather for a city."""
    return f"Sunny in {city}"

agent = create_agent(model, tools=[get_weather])
result = await run_agent(agent, "Weather in Paris?")
print(result.answer)
```

---

## Configuration

Create a `.env` file or set environment variables:

```bash
# AWS Bedrock (uses boto3 credentials)
AWS_PROFILE=default
AWS_REGION=us-east-1

# Google Gemini
GOOGLE_API_KEY=your-api-key

# OpenAI
OPENAI_API_KEY=your-api-key

# Azure OpenAI
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/

# Langfuse Tracing (optional - v0.2.0)
LANGFUSE_PUBLIC_KEY=pk-your-key
LANGFUSE_SECRET_KEY=sk-your-key
LANGFUSE_HOST=https://langfuse.penguinai.co  # Or https://cloud.langfuse.com
```

---

## Next Steps

**Continue learning**:
- **[01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md)** - Learn the full core API (models, tools, agents, state graphs)
- **[07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md)** - See complete production workflows

**Module-specific guides**:
- **[02-TRACING-AND-CALLBACKS.md](02-TRACING-AND-CALLBACKS.md)** - Add security and monitoring
- **[03-DOCUMENT-PROCESSING.md](03-DOCUMENT-PROCESSING.md)** - Process PDFs with OCR, bounding boxes, etc
- **[04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md)** - Build RAG applications

---

← [Home](README.md) | [Next: 01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md) →
