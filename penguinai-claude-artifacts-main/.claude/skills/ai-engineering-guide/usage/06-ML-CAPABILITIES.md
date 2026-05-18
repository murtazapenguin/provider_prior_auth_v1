← [Previous: 05-DATA-AND-COMPLIANCE.md](05-DATA-AND-COMPLIANCE.md) | [Home](README.md) | [Next: 07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md) →

---

# Machine Learning Capabilities

Advanced ML features: workflow patterns, AutoML, fine-tuning, and vision models.

**Modules**: `penguin.blueprints`, `penguin.automl`, `penguin.finetuning`, and `penguin.vlm`

---

## Overview

This guide covers four advanced ML capabilities:

1. **Blueprints Module** - Workflow pattern library
2. **AutoML Module** - Automated ML for tabular data
3. **Fine-tuning Module** - Customize LLMs, rerankers, embeddings
4. **VLM Module** - Vision language models for image analysis

---

## Blueprints Module

### What is it?

The Blueprints module is a **workflow pattern library** - a place to store, organize, and retrieve reusable workflow templates. When you solve a problem once, you can save the pattern as a blueprint and find it later.

### When to use it?

- **Knowledge management**: Store successful workflows for reuse
- **Team collaboration**: Share patterns across your team
- **Pattern discovery**: Find similar solutions to new problems
- **Code generation**: Use stored workflows as templates

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Blueprint** | A stored workflow with name, description, steps, and code |
| **Tags** | Keywords for organizing and searching blueprints |
| **Text search** | Fast fuzzy matching search (no LLM needed) |
| **LLM search** | Semantic search that understands intent |
| **Registry** | Storage and retrieval system for blueprints |

### Simple Example: Save and Search Workflows

```python
import asyncio
from penguin.core import create_model
from penguin.blueprints import BlueprintRegistry

async def main():
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")
    registry = BlueprintRegistry(model)

    # Add a blueprint (workflow pattern)
    registry.add_blueprint(
        name="pdf_extraction",
        description="Extract structured data from PDF documents",
        workflow="""
        1. OCR the PDF using Azure Document Intelligence
        2. Clean and preprocess the extracted text
        3. Use LLM to extract structured fields
        4. Validate and return JSON output
        """,
        code='''
async def extract_from_pdf(pdf_path: str) -> dict:
    from penguin.ocr import AzureOCRProvider
    ocr = AzureOCRProvider()
    result = await ocr.process_file(pdf_path)
    # ... extraction logic ...
    return {"data": "..."}
''',
        tags=["pdf", "extraction", "ocr"]
    )
    print("Blueprint added!")

    # List all blueprints
    blueprints = registry.list_blueprints()
    print(f"\nAll blueprints ({len(blueprints)}):")
    for bp in blueprints:
        print(f"  - {bp['name']}: {bp['description']}")

    # Search by text (fast, no LLM)
    results = registry.find_by_text("PDF", max_results=5)
    print(f"\nText search for 'PDF':")
    for bp, score in results:
        print(f"  - {bp.name} (score: {score:.2f})")

    # Search by tags (fast, no LLM)
    results = registry.find_by_tags(["ocr", "extraction"])
    print(f"\nTag search for ['ocr', 'extraction']:")
    for bp in results:
        print(f"  - {bp.name}: {bp.tags}")

    # LLM-based semantic search (slower, more accurate)
    result = await registry.llm_search("How to process scanned documents?")
    if result:
        print(f"\nLLM search found: {result.name}")
        print(f"Workflow:\n{result.workflow}")

asyncio.run(main())
```

---

## AutoML Module

### What is it?

The AutoML module provides **automated machine learning** for tabular data. It handles model selection, hyperparameter tuning, cross-validation, and evaluation - you just provide clean data and specify the task.

### When to use it?

- **Classification**: Predict categories (fraud detection, churn prediction)
- **Regression**: Predict numbers (price forecasting, demand prediction)
- **Quick prototyping**: Get a working model without manual tuning
- **Baseline models**: Establish performance benchmarks

### What AutoML Handles For You

1. **Model selection**: Tries multiple algorithms (Random Forest, XGBoost, etc.)
2. **Hyperparameter tuning**: Uses Optuna to find optimal settings
3. **Cross-validation**: Ensures model generalizes well
4. **Evaluation**: Provides accuracy, AUC, and other metrics
5. **Explainability**: SHAP-based feature importance

### Simple Example: Train a Classifier

```python
from penguin.automl import FDEAutoML
from sklearn.datasets import load_iris
from sklearn.preprocessing import StandardScaler
import pandas as pd

# Load sample data
iris = load_iris()
X = pd.DataFrame(iris.data, columns=iris.feature_names)
y = iris.target

# Preprocess (required - data must be clean and numeric)
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Create AutoML instance
automl = FDEAutoML(
    task='classification',
    models=['logistic_regression', 'random_forest', 'xgboost'],
    metric='accuracy',
    n_trials=20,      # Number of hyperparameter trials
    cv_folds=5,       # Cross-validation folds
    random_state=42
)

# Train with automatic train-test split
automl.fit(X_scaled, y, test_size=0.2)

# Evaluate
results = automl.evaluate(verbose=True)
print(f"\nBest model accuracy: {results['accuracy']:.4f}")

# Make predictions
predictions = automl.predict(X_scaled[:5])
print(f"Predictions for first 5 samples: {predictions}")

# Get feature importance
importance = automl.get_feature_importance(top_n=4)
print(f"\nFeature importance:\n{importance}")

# Save model for later use
model_id = automl.save_model('iris_classifier')
print(f"\nModel saved with ID: {model_id}")
```

---

## Fine-tuning Module

### What is it?

The Fine-tuning module lets you **customize AI models with your own data**. Instead of relying solely on prompting, you can teach models your specific patterns, terminology, and desired outputs.

### When to use it?

- **Domain adaptation**: Train models on your industry's language
- **Style matching**: Make outputs follow your format/tone
- **Task specialization**: Optimize for your specific use case
- **Cost reduction**: Smaller fine-tuned models can match larger general models
- **Latency reduction**: Specialized models often need less reasoning

### Types of Fine-tuning

| Type | Use Case | Data Format |
|------|----------|-------------|
| **LLM** | Custom chat/completion behavior | CSV: input, output |
| **Reranker** | Improve search relevance | JSONL: query, pos, neg |
| **Embedding** | Domain-specific similarity | JSONL: anchor, positive, negative |

### Simple Example: Fine-tune an LLM

```python
from penguin.finetuning import train

# Prepare your data as CSV with 'input' and 'output' columns:
# input,output
# "What is Python?","Python is a programming language..."
# "Explain ML","Machine learning is..."

# Train with simple API
result = train(
    "llm",                          # Trainer type
    dataset_path="training_data.csv",
    model="qwen3-4b",               # Base model
    output_dir="./my_adapter",
    max_steps=100,
    learning_rate=2e-4
)

print(f"Training {'succeeded' if result.success else 'failed'}")
print(f"Final loss: {result.final_loss}")
```

### Using the Fine-tuned Model

```python
from penguin.finetuning.inference import UnslothInference

# Load your fine-tuned adapter
engine = UnslothInference("./my_adapter")

# Generate text
response = engine.generate("What is Python?")
print(response)

# Or use chat format
response = engine.chat([
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Explain machine learning briefly."}
])
print(response)

# Cleanup
engine.cleanup()
```

---

## VLM Module

### What is it?

The VLM (Vision Language Model) module lets you **extract information from images** using AI. You can ask questions about images, extract structured data, or get descriptions of visual content.

### When to use it?

- **Document understanding**: Extract data from forms, receipts, IDs
- **Image analysis**: Describe scenes, identify objects, count items
- **Visual Q&A**: Answer questions about image contents
- **Data extraction**: Pull structured information from charts, diagrams
- **Accessibility**: Generate descriptions for visual content

### Simple Example: Analyze an Image

```python
import asyncio
from penguin.vlm.providers.gemini import GeminiVLMProvider

async def main():
    # Create VLM provider (requires GOOGLE_API_KEY)
    provider = GeminiVLMProvider(model_id="gemini-2.5-flash")

    # Example 1: Free-text extraction
    result = await provider.extract(
        image_paths=["photo.jpg"],
        prompt="Describe what you see in this image"
    )
    print("Description:", result.raw_text)

    # Example 2: Structured extraction with JSON schema
    schema = {
        "type": "object",
        "properties": {
            "objects": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of objects in the image"
            },
            "people_count": {
                "type": "integer",
                "description": "Number of people visible"
            },
            "setting": {
                "type": "string",
                "description": "Indoor or outdoor setting"
            }
        },
        "required": ["objects", "setting"]
    }

    result = await provider.extract(
        image_paths=["scene.jpg"],
        prompt="Analyze this image",
        response_schema=schema
    )

    print("\nStructured output:")
    print(f"  Objects: {result.structured_data['objects']}")
    print(f"  People: {result.structured_data.get('people_count', 'N/A')}")
    print(f"  Setting: {result.structured_data['setting']}")

asyncio.run(main())
```

---

## Next Steps

**Continue learning:**
- **[07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md)** - See complete production workflows

**Related:**
- **[01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md)** - Core API for LLM processing
- **[03-DOCUMENT-PROCESSING.md](03-DOCUMENT-PROCESSING.md)** - OCR as alternative to VLM
- **[04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md)** - Embeddings and vector search

---

← [Previous: 05-DATA-AND-COMPLIANCE.md](05-DATA-AND-COMPLIANCE.md) | [Home](README.md) | [Next: 07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md) →
