← [Previous: 03-DOCUMENT-PROCESSING.md](03-DOCUMENT-PROCESSING.md) | [Home](README.md) | [Next: 05-DATA-AND-COMPLIANCE.md](05-DATA-AND-COMPLIANCE.md) →

---

# Embeddings and Semantic Search

Convert text to vectors and build powerful search capabilities for RAG pipelines.

**Modules**: `penguin.embeddings` and `penguin.vector_db`

---

## Overview

This guide covers two complementary modules for semantic search:

1. **Embeddings Module** - Convert text to numerical vectors
2. **Vector Database Module** - Store and search vectors for similarity

**The RAG Pattern:**
```
User Question → Embed → Search Vector DB → Get Top K → Add to LLM Prompt → Answer
```

---

## Embeddings Module

### What is it?

The Embeddings module converts **text into numerical vectors** (lists of numbers). These vectors capture the semantic meaning of text - similar texts have similar vectors. This is fundamental for search, recommendations, and RAG (Retrieval-Augmented Generation).

### When to use it?

- **Semantic search**: Find documents by meaning, not just keywords
- **RAG pipelines**: Retrieve relevant context for LLM prompts
- **Similarity detection**: Find duplicate or related content
- **Clustering**: Group similar documents together
- **Recommendations**: Find items similar to user preferences

### How Embeddings Work

```
"Python is great" → [0.12, -0.45, 0.78, ...]  (1024 numbers)
"I love coding"   → [0.15, -0.42, 0.81, ...]  (similar vector!)
"The sky is blue" → [0.89, 0.23, -0.11, ...]  (different vector)
```

Similar meanings = similar vectors = closer in vector space.

### Supported Providers

| Provider | Models |
|----------|--------|
| **bedrock** | Titan Embed V2 (AWS) |
| **sentence_transformers** | BGE, E5, MiniLM (open-source, runs locally) |
| **local** | Custom/fine-tuned models |

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Dimensions** | Size of the vector (256, 512, 1024). Higher = more detail but more storage |
| **Query vs Document** | Some models encode queries and documents differently for better retrieval |
| **Batch embedding** | Embed multiple texts at once for efficiency |

### Choosing Dimensions

- **256**: Fastest, smallest, good for simple use cases
- **512**: Balanced choice for most applications
- **1024**: Most accurate, best for complex semantic tasks

### Simple Example: Generate Embeddings

```python
import asyncio
from penguin.embeddings import create_embedding_client

async def main():
    # Create embedding client (Bedrock Titan by default)
    client = create_embedding_client("bedrock", dimensions=1024)

    # Embed a single text
    result = await client.embed("Machine learning is fascinating")

    print(f"Vector dimensions: {result.dimensions}")
    print(f"First 5 values: {result.embedding[:5]}")

    # Embed multiple texts
    texts = [
        "Python is a programming language",
        "JavaScript runs in browsers",
        "Machine learning uses data"
    ]
    results = await client.embed_batch(texts)

    print(f"\nEmbedded {len(results)} texts")
    for i, r in enumerate(results):
        print(f"  Text {i+1}: {len(r.embedding)} dimensions")

asyncio.run(main())
```

### Using Open-Source Models

```python
import asyncio
from penguin.embeddings import create_embedding_client

async def main():
    # Use sentence-transformers (open-source, runs locally)
    client = create_embedding_client(
        "sentence_transformers",
        model="BAAI/bge-m3"  # Great multilingual model
    )

    result = await client.embed("Hello world")
    print(f"Dimensions: {result.dimensions}")
    print(f"Device: {client.device}")  # cuda/mps/cpu

asyncio.run(main())
```

### Query vs Document Embeddings

For retrieval tasks, some models perform better when queries and documents are encoded differently:

```python
import asyncio
from penguin.embeddings import create_embedding_client

async def main():
    client = create_embedding_client("sentence_transformers", model="BAAI/bge-m3")

    # For retrieval, use different methods for queries vs documents
    doc_embedding = await client.embed("Machine learning is a subset of AI...")
    query_embedding = await client.embed_query("What is machine learning?")

    # Query embedding adds special prefix for better retrieval
    print("Document and query embeddings generated for retrieval")

asyncio.run(main())
```

---

## Vector Database Module

### What is it?

The Vector Database module provides **persistent storage for embeddings** and fast similarity search. Once you've converted text to vectors using the Embeddings module, you store them here and can quickly find the most similar vectors to any query.

### When to use it?

- **RAG applications**: Store document embeddings, retrieve relevant context
- **Semantic search engines**: Build search that understands meaning
- **Recommendation systems**: Find similar items based on vector similarity
- **Knowledge bases**: Store and query large document collections

### How Vector Search Works

1. **Index creation**: Define dimension and distance metric
2. **Storage**: Add vectors with IDs and metadata
3. **Query**: Given a query vector, find the K most similar stored vectors
4. **Results**: Get IDs, similarity scores, and metadata of matches

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Index** | A collection of vectors with the same dimensions |
| **Distance metric** | How similarity is measured (COSINE, L2) |
| **VectorRecord** | A vector with ID and optional metadata |
| **top_k** | How many similar results to return |
| **Metadata** | Additional data stored with each vector (source file, text, etc.) |

### Distance Metrics Explained

- **COSINE** (recommended): Measures angle between vectors. Best for text similarity.
- **L2 (Euclidean)**: Measures straight-line distance. Better when magnitude matters.

### The RAG Pattern

```
User Question → Embed → Search Vector DB → Get Top K → Add to LLM Prompt → Answer
```

The Vector DB is the "retrieval" part of Retrieval-Augmented Generation.

### Simple Example: Store and Query Vectors

```python
import asyncio
from penguin.vector_db import create_vector_client, VectorRecord, DistanceMetric
from penguin.embeddings import create_embedding_client

async def main():
    # Create clients
    vector_client = create_vector_client("s3vectors", bucket_name="my-vectors-bucket")
    embedding_client = create_embedding_client("bedrock", dimensions=1024)

    # Step 1: Create an index
    await vector_client.create_index(
        "documents",
        dimension=1024,
        distance_metric=DistanceMetric.COSINE
    )
    print("Index created")

    # Step 2: Prepare documents
    documents = [
        {"id": "doc1", "text": "Python is a programming language"},
        {"id": "doc2", "text": "Machine learning uses algorithms"},
        {"id": "doc3", "text": "Data science combines statistics and programming"}
    ]

    # Step 3: Embed and store vectors
    for doc in documents:
        embedding = await embedding_client.embed(doc["text"])
        await vector_client.put_vectors("documents", [
            VectorRecord(
                id=doc["id"],
                vector=embedding.embedding,
                metadata={"text": doc["text"]}
            )
        ])
    print(f"Stored {len(documents)} vectors")

    # Step 4: Query for similar documents
    query = "What programming languages are there?"
    query_embedding = await embedding_client.embed(query)

    results = await vector_client.query_vectors(
        "documents",
        vector=query_embedding.embedding,
        top_k=2,
        include_metadata=True
    )

    print(f"\nQuery: {query}")
    print("Similar documents:")
    for match in results.matches:
        print(f"  - {match.id}: {match.metadata['text']} (score: {match.score:.4f})")

asyncio.run(main())
```

### Complete RAG Pipeline Example

Combining embeddings, vector search, and LLM:

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

## Next Steps

**Continue learning:**
- **[05-DATA-AND-COMPLIANCE.md](05-DATA-AND-COMPLIANCE.md)** - Data assets and evaluation
- **[07-WORKFLOWS-AND-PATTERNS.md#workflow-3](07-WORKFLOWS-AND-PATTERNS.md#workflow-3-rag-pipeline)** - Complete RAG workflow

**Related:**
- **[01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md)** - Core API for LLM processing
- **[03-DOCUMENT-PROCESSING.md](03-DOCUMENT-PROCESSING.md)** - OCR for document RAG

---

← [Previous: 03-DOCUMENT-PROCESSING.md](03-DOCUMENT-PROCESSING.md) | [Home](README.md) | [Next: 05-DATA-AND-COMPLIANCE.md](05-DATA-AND-COMPLIANCE.md) →
