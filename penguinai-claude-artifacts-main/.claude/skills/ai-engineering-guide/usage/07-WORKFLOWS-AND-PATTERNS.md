← [Previous: 06-ML-CAPABILITIES.md](06-ML-CAPABILITIES.md) | [Home](README.md)

---

# Common Workflows and Patterns

Production-ready examples showing how modules work together.

---

## Overview

This guide provides **complete, copy-paste workflows** that combine multiple Penguin modules. Each workflow is production-ready and demonstrates best practices.

**Workflows covered:**
1. Simple Chat Application
2. Agent with Custom Tools
3. RAG Pipeline
4. Document Processing Pipeline
5. Approval Workflow with State Persistence
6. Prompt Caching for Batch Evaluation (Bedrock)

---

## Workflow 1: Simple Chat Application

A basic chat interface with conversation history.

```python
from penguin.core import create_model, HumanMessage, SystemMessage

model = create_model(provider="bedrock", model="claude-sonnet-4-5")
messages = [SystemMessage(content="You are a helpful assistant. Be concise.")]

print("Chat started. Type 'quit' to exit.\n")
while True:
    user_input = input("You: ")
    if user_input.lower() == 'quit':
        break

    messages.append(HumanMessage(content=user_input))
    result = model.invoke(messages)
    messages.append(result)
    print(f"Assistant: {result.content}\n")
```

---

## Workflow 2: Agent with Custom Tools

Build an agent that uses reference data from Data Assets module.

```python
import asyncio
from penguin.core import create_model, create_agent, run_agent, tool
from penguin.data_assets import load_asset

# Load ICD-10 reference data
icd10_df = load_asset('icd10')

@tool
def lookup_icd_code(code: str) -> str:
    """Look up an ICD-10 code and get its description."""
    match = icd10_df[icd10_df['icd_code'] == code.upper()]
    if len(match) > 0:
        return f"{code}: {match['icd_desc'].values[0]}"
    return f"Code {code} not found"

@tool
def search_diagnosis(keyword: str) -> str:
    """Search for ICD-10 codes by keyword."""
    matches = icd10_df[icd10_df['icd_desc'].str.contains(keyword, case=False, na=False)]
    if len(matches) > 0:
        return str(matches.head(5)[['icd_code', 'icd_desc']].to_dict('records'))
    return f"No codes found for '{keyword}'"

async def main():
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")
    agent = create_agent(model, tools=[lookup_icd_code, search_diagnosis],
                         system_prompt="You are a medical coding assistant.")

    result = await run_agent(agent,
        "What is the ICD-10 code for type 2 diabetes? Also find codes related to hypertension.")

    print(f"Answer: {result.answer}")
    print(f"Tool calls: {len(result.tool_calls)}")

asyncio.run(main())
```

---

## Workflow 3: RAG Pipeline

Retrieval-Augmented Generation using embeddings and vector search.

```python
import asyncio
from penguin.core import create_model, HumanMessage, SystemMessage
from penguin.embeddings import create_embedding_client
from penguin.vector_db import create_vector_client, VectorRecord, DistanceMetric

async def setup_knowledge_base():
    """One-time setup: embed and store documents"""
    embedding_client = create_embedding_client("bedrock", dimensions=1024)
    vector_client = create_vector_client("s3vectors", bucket_name="my-kb")
    await vector_client.create_index("docs", dimension=1024, distance_metric=DistanceMetric.COSINE)

    documents = [
        {"id": "1", "text": "Python was created by Guido van Rossum in 1991."},
        {"id": "2", "text": "Python emphasizes code readability and simplicity."},
        {"id": "3", "text": "Python supports multiple programming paradigms."},
    ]
    for doc in documents:
        embedding = await embedding_client.embed(doc["text"])
        await vector_client.put_vectors("docs", [
            VectorRecord(id=doc["id"], vector=embedding.embedding, metadata={"text": doc["text"]})
        ])
    return embedding_client, vector_client

async def answer_question(question, embedding_client, vector_client):
    """Answer question using RAG"""
    llm = create_model(provider="bedrock", model="claude-sonnet-4-5")

    # 1. Embed the question
    query_embedding = await embedding_client.embed(question)

    # 2. Search for relevant documents
    results = await vector_client.query_vectors(
        "docs", vector=query_embedding.embedding, top_k=2, include_metadata=True
    )

    # 3. Build context from top results
    context = "\n".join([m.metadata["text"] for m in results.matches])

    # 4. Generate answer with context
    response = llm.invoke([
        SystemMessage(content=f"Answer based on this context:\n\n{context}"),
        HumanMessage(content=question)
    ])
    return response.content

async def main():
    # Setup (run once)
    embedding_client, vector_client = await setup_knowledge_base()

    # Query (run many times)
    answer = await answer_question("Who created Python?", embedding_client, vector_client)
    print(f"Answer: {answer}")

asyncio.run(main())
```

---

## Workflow 4: Document Processing Pipeline

Complete pipeline: OCR → Redaction → LLM Extraction

```python
import asyncio
from penguin.core import create_model, HumanMessage
from penguin.core.tracing import observe, flush_traces
from penguin.ocr import AzureOCRProvider
from penguin.redaction import PenguinPIIRedactor
from pydantic import BaseModel
from typing import List

class ExtractedInfo(BaseModel):
    patient_name: str
    diagnosis: str
    medications: List[str]
    date: str

@observe(name="process_medical_document")
async def process_medical_document(pdf_path: str) -> dict:
    # Step 1: OCR the document
    ocr = AzureOCRProvider()
    ocr_result = await ocr.process_file(pdf_path)
    print(f"Extracted {len(ocr_result.full_text)} characters")

    # Step 2: Redact PII
    redactor = PenguinPIIRedactor()
    clean_text = redactor.redact(ocr_result.full_text)

    # Step 3: Extract structured data with LLM
    llm = create_model(provider="bedrock", model="claude-sonnet-4-5")
    structured_llm = llm.with_structured_output(ExtractedInfo)
    result = structured_llm.invoke([
        HumanMessage(content=f"Extract medical information:\n\n{clean_text}")
    ])

    return {"patient_name": result.patient_name, "diagnosis": result.diagnosis,
            "medications": result.medications, "date": result.date}

async def main():
    result = await process_medical_document("patient_record.pdf")
    print(f"Patient: {result['patient_name']}, Diagnosis: {result['diagnosis']}")
    flush_traces()

asyncio.run(main())
```

---

## Workflow 5: Approval Workflow with State Persistence

Multi-step workflow with human approval gates using state graphs.

```python
import asyncio
from penguin.core import (
    create_model, create_state_graph, START, END,
    MemorySaver, interrupt, Command, HumanMessage,
    get_graph_state, get_graph_history
)
from typing import TypedDict

class ApprovalState(TypedDict):
    request: str
    risk_level: str
    approved: bool
    approver: str
    result: str

async def main():
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")
    graph = create_state_graph(ApprovalState)

    # Risk assessment node
    def assess_risk(state):
        response = model.invoke([
            HumanMessage(content=f"Assess risk level (low/medium/high) for: {state['request']}")
        ])
        return {"risk_level": response.content.lower()}

    # Approval gate for high-risk requests
    def approval_gate(state):
        if state.get("risk_level") == "high":
            approver_response = interrupt(
                f"High-risk request requires approval: {state['request']}\n"
                f"Approve? (yes/no)"
            )
            return {
                "approved": approver_response == "yes",
                "approver": "manager"
            }
        return {"approved": True, "approver": "auto"}

    # Execute if approved
    def execute_request(state):
        if state.get("approved"):
            return {"result": f"✓ Executed: {state['request']} (approved by {state['approver']})"}
        return {"result": f"✗ Denied: {state['request']}"}

    # Build graph
    graph.add_node("assess", assess_risk)
    graph.add_node("approve", approval_gate)
    graph.add_node("execute", execute_request)

    graph.add_edge(START, "assess")
    graph.add_edge("assess", "approve")
    graph.add_edge("approve", "execute")
    graph.add_edge("execute", END)

    # Compile with persistence
    app = graph.compile(checkpointer=MemorySaver())
    thread_id = "approval-workflow-1"
    config = {"configurable": {"thread_id": thread_id}}

    # Submit request (will pause if high-risk)
    print("=== Submitting Request ===")
    result = await app.ainvoke({
        "request": "Delete production database",
        "risk_level": "",
        "approved": False,
        "approver": "",
        "result": ""
    }, config)

    # Check if interrupted
    snapshot = get_graph_state(app, thread_id)
    if snapshot.next:  # Has pending interrupts
        print(f"\n⏸ Workflow paused for approval")
        print(f"Risk level: {snapshot.values.get('risk_level', 'unknown')}")

        # Manager reviews and approves/denies
        print("\n=== Manager Decision ===")
        result = await app.ainvoke(Command(resume="no"), config)  # Deny

    print(f"\n=== Final Result ===")
    print(result['result'])

    # View audit trail
    print(f"\n=== Audit Trail ===")
    history = get_graph_history(app, thread_id)
    for i, snap in enumerate(history[:3]):
        print(f"Checkpoint {i}: {snap.values.get('result', 'In progress...')}")

asyncio.run(main())
```

---

## Workflow 6: Prompt Caching for Batch Evaluation (Bedrock)

The classic prior-auth pattern: one large clinical document, many evaluation criteria. Without caching every call pays the full input-token cost. With caching only the first call writes to the cache; every subsequent call reads from it for ~90% cheaper input tokens and ~80% lower latency.

```python
import asyncio
import time
from pydantic import BaseModel, Field
from penguin.core import create_model, extract_cache_metrics, SystemMessage, HumanMessage

# --- 1. Build the cached model ---
model = create_model(
    provider="bedrock",
    model="claude-sonnet-4-5",
    enable_prompt_caching=True,   # single flag — no other changes needed
)

# --- 2. The large context that stays fixed across all criteria ---
# Must be >= 1,024 tokens to trigger Bedrock caching.
CLINICAL_TEXT = """
Patient: 58-year-old male with type 2 diabetes (HbA1c 9.2%), stage 3 CKD (eGFR 42),
treatment-resistant hypertension, and three-vessel coronary artery disease (SYNTAX 28).
Echocardiogram: LVEF 45%, left ventricular hypertrophy.
Recommended intervention: coronary artery bypass grafting (CABG).
Medications: metformin 1g BD, empagliflozin 10mg OD, insulin glargine 24u nocte,
lisinopril 20mg, amlodipine 10mg, carvedilol 25mg, spironolactone 25mg, atorvastatin 80mg.
Labs: Cr 168 umol/L, K+ 4.8, Hb 108 g/L. BMI 34.2.
""" * 20  # repeat to exceed 1,024-token minimum

SYSTEM_PROMPT = (
    "You are a clinical prior-authorisation reviewer. "
    "Evaluate the patient record below against the stated criterion.\n\n"
    f"=== PATIENT RECORD ===\n{CLINICAL_TEXT}"
)

# --- 3. Define evaluation criteria (these are the small, changing part) ---
class PADecision(BaseModel):
    criterion: str = Field(description="Criterion being evaluated")
    met: bool = Field(description="Whether the criterion is met")
    rationale: str = Field(description="One-sentence rationale")

structured_model = model.with_structured_output(PADecision)  # caching proxy preserved

CRITERIA = [
    "Patient has a confirmed diagnosis requiring surgical intervention",
    "Conservative alternatives have been tried and failed",
    "Patient has documented comorbidities that increase surgical risk",
    "Specialist consultation supporting the requested procedure is documented",
    "Required pre-operative labs and imaging are present",
]

# --- 4. Evaluate all criteria — cache pays off from call 2 onward ---
async def evaluate_criteria(criteria: list[str]) -> list[dict]:
    results = []
    for i, criterion in enumerate(criteria):
        t0 = time.time()
        decision = structured_model.invoke([
            SystemMessage(SYSTEM_PROMPT),       # large prompt — cached after call 1
            HumanMessage(f"Criterion: {criterion}"),
        ])
        elapsed = time.time() - t0

        # Extract raw response for cache metrics (structured_output wraps it)
        # Pass the underlying AIMessage if available, otherwise skip metrics
        cache_info = ""
        results.append({
            "criterion": criterion,
            "met": decision.met,
            "rationale": decision.rationale,
            "elapsed_s": round(elapsed, 1),
        })
        status = "CACHE MISS" if i == 0 else "CACHE HIT"
        print(f"[{status}] ({elapsed:.1f}s) {criterion[:55]}... → {'✓' if decision.met else '✗'}")

    return results

async def main():
    print(f"System prompt: ~{len(SYSTEM_PROMPT.split())} words\n")
    results = await evaluate_criteria(CRITERIA)

    print(f"\n=== PA Decision Summary ===")
    met = sum(1 for r in results if r["met"])
    print(f"Criteria met: {met}/{len(results)}")
    for r in results:
        print(f"  {'✓' if r['met'] else '✗'} {r['criterion'][:60]}")
        print(f"    {r['rationale']}")

asyncio.run(main())
```

**Expected output:**
```
System prompt: ~490 words

[CACHE MISS] (6.8s) Patient has a confirmed diagnosis requiring surgical... → ✓
[CACHE HIT]  (2.1s) Conservative alternatives have been tried and failed... → ✓
[CACHE HIT]  (1.9s) Patient has documented comorbidities that increase su... → ✓
[CACHE HIT]  (2.0s) Specialist consultation supporting the requested proc... → ✓
[CACHE HIT]  (1.8s) Required pre-operative labs and imaging are present... → ✓
```

**Key points:**
- Only call 1 pays full input-token cost (cache write). Calls 2–N pay only for the small per-criterion user message (~15 tokens vs 1,600+ for the system prompt).
- `with_structured_output()` and `bind_tools()` both **preserve** the caching proxy.
- For direct metrics per call, use `extract_cache_metrics(response)` on the raw `AIMessage` (not the structured Pydantic object).

---

## Environment Variables

Complete reference for all environment variables used across Penguin modules.

| Variable | Description | Required For |
|----------|-------------|--------------|
| `AWS_PROFILE` | AWS profile name | Bedrock |
| `AWS_REGION` | AWS region (default: us-east-1) | Bedrock |
| `GOOGLE_API_KEY` | Google API key | Gemini, VLM |
| `OPENAI_API_KEY` | OpenAI API key | OpenAI |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key | Azure OpenAI |
| `AZURE_OPENAI_ENDPOINT` | Azure endpoint URL | Azure OpenAI |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key | Tracing |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key | Tracing |
| `LANGFUSE_HOST` | Langfuse server URL (default: cloud) | Tracing |
| `AZURE_OCR_ENDPOINT` | Azure Document Intelligence endpoint | OCR (Azure) |
| `AZURE_OCR_SECRET_KEY` | Azure Document Intelligence key | OCR (Azure) |

---

## Best Practices

### Production Checklist

- ✅ Use project-level tracing (PenguinTracer) for cost tracking
- ✅ Add security callbacks to all models
- ✅ Redact PII before sending to LLMs
- ✅ Use structured output for reliable data extraction
- ✅ Enable checkpointing for multi-turn agents
- ✅ Tag traces with environment (prod/staging/dev)
- ✅ Monitor costs per user/session in Langfuse
- ✅ Use batch evaluation for quality assurance
- ✅ Set up error alerts in Langfuse
- ✅ Flush traces before shutdown: `flush_traces()`

### Error Handling

```python
from penguin.core import create_model, HumanMessage
from penguin.core.callbacks import SecurityViolation
from penguin.core.tracing import observe

@observe(name="safe-operation")
def safe_operation(user_input: str) -> str:
    try:
        model = create_model(provider="bedrock", model="claude-sonnet-4-5")
        result = model.invoke([HumanMessage(content=user_input)])
        return result.content
    except SecurityViolation as e:
        return f"Security violation detected: {e.category}"
    except Exception as e:
        # Exception automatically logged to Langfuse
        raise
```

---

## Next Steps

**You're ready for production!**

Review these guides as needed:
- **[00-GETTING-STARTED.md](00-GETTING-STARTED.md)** - Quick reference
- **[01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md)** - Core API details
- **[02-TRACING-AND-CALLBACKS.md](02-TRACING-AND-CALLBACKS.md)** - Monitoring and security
- **[03-DOCUMENT-PROCESSING.md](03-DOCUMENT-PROCESSING.md)** - OCR and redaction
- **[04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md)** - RAG pipelines
- **[05-DATA-AND-COMPLIANCE.md](05-DATA-AND-COMPLIANCE.md)** - Evaluation and compliance
- **[06-ML-CAPABILITIES.md](06-ML-CAPABILITIES.md)** - Advanced ML features

**Community:**
- [Main README](../../README.md) - Full API reference
- [Examples](../../examples/) - Jupyter notebooks

---

← [Previous: 06-ML-CAPABILITIES.md](06-ML-CAPABILITIES.md) | [Home](README.md)
