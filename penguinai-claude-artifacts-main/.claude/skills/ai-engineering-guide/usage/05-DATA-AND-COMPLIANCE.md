← [Previous: 04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md) | [Home](README.md) | [Next: 06-ML-CAPABILITIES.md](06-ML-CAPABILITIES.md) →

---

# Data Assets, Evaluation, and Compliance

Reference datasets, LLM-as-judge evaluation, and compliance checking for production AI systems.

**Modules**: `penguin.data_assets`, `penguin.evals`, and `penguin.compliance`

---

## Overview

This guide covers three modules for data management and quality assurance:

1. **Data Assets Module** - Bundled and remote reference datasets
2. **Evals Module** - LLM-as-judge evaluation framework
3. **Compliance Module** - Rule-based compliance checking

---

## Data Assets Module

### What is it?

The Data Assets module provides **bundled and remote reference datasets** that you can use in your applications without managing external data sources. Bundled assets are included in the package, while remote assets are stored on S3 and downloaded on first use. It also supports registering your own custom datasets.

### When to use it?

- **Medical coding**: Look up ICD-10 diagnosis codes and guidelines
- **Reference data**: Access standardized code sets and classifications
- **Tool building**: Create tools that query reference data
- **Data enrichment**: Add standard descriptions to codes in your data

### Built-in Datasets

| Asset | Type | Description |
|-------|------|-------------|
| `icd10` | bundled | ICD-10-CM 2025 diagnosis codes |
| `icd10_guidelines` | remote | ICD-10 coding guidelines text (downloaded from S3) |

More datasets will be added in future versions.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Bundled asset** | Included in the package, loads instantly |
| **Remote asset** | Stored on S3, downloaded on first use, then cached locally |
| **Cache** | Remote assets are cached in `~/.penguin/assets/` |
| **Custom assets** | Register your own CSV files for easy access |

### Simple Example: Load Assets

```python
from penguin.data_assets import load_asset, list_assets, get_asset_info

# List available assets (shows type: bundled or remote)
assets = list_assets()
print("Available assets:")
for asset in assets:
    asset_type = asset.get('type', 'bundled')
    print(f"  - {asset['name']}: {asset['description']} [{asset_type}]")

# Get info about an asset
info = get_asset_info('icd10')
print(f"\nICD-10 columns: {info['columns']}")

# Load bundled asset (instant)
icd10_df = load_asset('icd10')
print(f"\nLoaded {len(icd10_df)} ICD-10 codes")

# Load remote asset (downloads on first use, requires AWS credentials)
# guidelines_df = load_asset('icd10_guidelines')

# Query specific codes
print("\n=== Example Queries ===")
code = "E11.9"
match = icd10_df[icd10_df['icd_code'] == code]
if len(match) > 0:
    print(f"{code}: {match['icd_desc'].values[0]}")

# Search by keyword
keyword = "diabetes"
matches = icd10_df[icd10_df['icd_desc'].str.contains(keyword, case=False, na=False)]
print(f"\nCodes containing '{keyword}':")
for _, row in matches.head(5).iterrows():
    print(f"  {row['icd_code']}: {row['icd_desc']}")
```

### Cache Management

Remote assets are cached locally to avoid re-downloading:

```python
from penguin.data_assets import clear_cache, get_cache_info, is_cached

# Check if a remote asset is cached
if is_cached('icd10_guidelines'):
    print("Guidelines already downloaded")

# View cache information
info = get_cache_info()
print(f"Cache location: {info['cache_dir']}")
print(f"Total size: {info['total_size_mb']} MB")
for asset in info['cached_assets']:
    print(f"  - {asset['name']}: {asset['size_mb']} MB")

# Clear a specific asset's cache
clear_cache('icd10_guidelines')

# Clear all cached assets
clear_cache()
```

### Using Data Assets in Agent Tools

```python
from penguin.core import tool
from penguin.data_assets import load_asset

# Load reference data
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

# Use with agents - see 07-WORKFLOWS-AND-PATTERNS.md#workflow-2
```

---

## Evals Module

### What is it?

The Evals module provides an **LLM-as-judge framework** for evaluating AI outputs. Instead of writing complex rule-based evaluation code, you define criteria in natural language and let an LLM judge whether outputs meet those criteria.

### When to use it?

- **Quality assurance**: Test your AI application's outputs systematically
- **Regression testing**: Ensure changes don't degrade quality
- **A/B testing**: Compare different models or prompts
- **Benchmark creation**: Build evaluation datasets for your use case
- **Continuous monitoring**: Track quality over time

### Why LLM-as-Judge?

Traditional evaluation methods (regex, keyword matching) can't assess:
- Factual accuracy
- Tone and professionalism
- Completeness of answers
- Relevance to questions

LLMs can evaluate these nuanced criteria, similar to how a human would.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Criteria** | Natural language descriptions of what makes a good output |
| **Prebuilt criteria** | Ready-to-use templates via `penguin.evals.criteria` (correctness, hallucination, PII, etc.) |
| **Pass/Fail** | Each criterion results in pass or fail (no numeric scores) |
| **Batch evaluation** | Evaluate multiple criteria per row in one LLM call |
| **EvalReport** | Contains pass rates, failures, and trace ID |

### API Efficiency: Batch Evaluation

Penguin evaluates up to 10 criteria per LLM call, dramatically reducing API costs:

| Scenario | Without Batch | With Batch |
|----------|---------------|------------|
| 5 criteria × 100 rows | 500 calls | **100 calls** |
| 10 criteria × 100 rows | 1000 calls | **100 calls** |

### Prebuilt Criteria Templates

Instead of writing criteria strings from scratch, use the `criteria` module for
well-tested, ready-to-use templates:

```python
from penguin.evals import criteria

# Individual criteria constants
criteria.CORRECTNESS          # factual accuracy vs. reference answer
criteria.ANSWER_RELEVANCE     # directly addresses the question
criteria.COMPLETENESS         # all parts of the question answered
criteria.CONCISENESS          # no padding or filler
criteria.HALLUCINATION        # no claims absent from the context (needs context_col)
criteria.GROUNDEDNESS         # all facts traceable to context (needs context_col)
criteria.PROFESSIONAL_TONE    # no slang, sarcasm, or inappropriate tone
criteria.NO_PII               # no names, emails, account numbers, etc.
criteria.TOXICITY_FREE        # no hateful or harmful content
criteria.INSTRUCTION_FOLLOWING  # follows format/style/length constraints
criteria.LANGUAGE_QUALITY     # correct grammar and spelling

# Parameterised factories
criteria.conciseness(max_words=80)            # exact word-count limit
criteria.no_pii(pii_types=["email", "SSN"])   # scoped to specific PII types

# Pre-assembled bundles (return a list of criteria)
criteria.for_qa()             # correctness, relevance, completeness, conciseness
criteria.for_rag()            # groundedness, hallucination, relevance (needs context_col)
criteria.for_chatbot()        # relevance, professional tone, no PII, conciseness
criteria.for_summarization()  # completeness, hallucination, language quality, conciseness
```

### Simple Example: Evaluate a Q&A Bot

```python
import asyncio
import pandas as pd
from penguin.core import create_model
from penguin.evals import EvalRunner, criteria

async def main():
    # Create model using penguin.core (Langfuse-integrated)
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")
    runner = EvalRunner(model, max_concurrency=3)

    # Prepare test data
    df = pd.DataFrame({
        'input': [
            "What is the capital of France?",
            "What is 2 + 2?",
            "Who wrote Romeo and Juliet?"
        ],
        'output': [
            "Paris is the capital of France.",
            "The answer is 4.",
            "I don't know."  # This one should fail!
        ],
        'expected': [
            "Paris",
            "4",
            "William Shakespeare"
        ]
    })

    # Use the prebuilt for_qa() bundle (or mix prebuilt + custom)
    report = await runner.evaluate(
        df=df,
        criteria=criteria.for_qa(),
        task_name="QA Bot Test",
        input_col="input",
        output_col="output",
        expected_col="expected",
    )

    # View results
    print(f"Trace ID: {report.trace_id}")
    print(f"Overall pass rate: {report.overall_pass_rate:.1%}")

    print("\nPer-criteria results:")
    for name, summary in report.criteria_summaries.items():
        print(f"  {name[:40]}: {summary.pass_rate:.1%}")

    # Find failures
    print("\nFailures:")
    for i, row_result in enumerate(report.row_results):
        for crit_name, result in row_result.items():
            if not result.passed:
                print(f"  Row {i}: Failed '{crit_name[:30]}...' - {result.reason}")

asyncio.run(main())
```

### Mixing Prebuilt and Custom Criteria

```python
# Combine prebuilt constants with your own domain-specific criteria
report = await runner.evaluate(
    df=df,
    criteria=[
        criteria.CORRECTNESS,
        criteria.ANSWER_RELEVANCE,
        criteria.conciseness(max_words=80),
        "The output must not mention competitor products",
        "The output must include a source citation",
    ],
    task_name="Product QA",
    expected_col="expected",
)
```

---

## Sending Eval Scores to Langfuse

When Langfuse is configured (via `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`), you can push per-criteria pass rates as scores so they appear in the Langfuse dashboard alongside your traces.

### Auto-tracing

All LLM calls made through `create_model()` are automatically traced by Langfuse when keys are configured — no extra setup required. Use `PenguinTracer` to group evaluation calls under a named session.

### Pushing Scores After Evaluation

Call `report.export_to_langfuse()` after `runner.evaluate()` completes:

```python
import asyncio
import pandas as pd
from penguin.core import create_model
from penguin.core.tracing import PenguinTracer
from penguin.evals import EvalRunner, criteria

async def main():
    # 1. Create a tracer session — groups all eval LLM calls in Langfuse
    tracer = PenguinTracer(project="my-project")

    with tracer.session(session_id="eval-run-001", user_id="data-team") as s:
        model = create_model(
            provider="bedrock",
            model="claude-sonnet-4-5",
        )
        runner = EvalRunner(model, max_concurrency=5)

        df = pd.DataFrame({
            "input": ["What is 2+2?", "Name the planets"],
            "output": ["4", "Mercury, Venus, Earth, Mars"],
        })

        eval_criteria = [
            criteria.CORRECTNESS,
            criteria.CONCISENESS,
        ]

        # 2. Run evaluation — LLM calls are traced automatically
        report = await runner.evaluate(
            df=df,
            criteria=eval_criteria,
            task_name="smoke-test",
        )

        print(f"Pass rate: {report.overall_pass_rate:.1%}")

    # 3. Push scores to Langfuse
    #    Pass a Langfuse trace_id to link scores to a specific trace, or
    #    omit it to use report.trace_id.
    report.export_to_langfuse()

asyncio.run(main())
```

After running this, open your Langfuse dashboard and navigate to **Scores** — you will see entries like:
- `smoke-test.overall_pass_rate` — average pass rate across all criteria
- `smoke-test.The output is factually correct and cons` — per-criteria pass rate (names are truncated to 50 chars)
- `smoke-test.The output is appropriately concise. It d` — per-criteria pass rate

### Linking Scores to a Specific Trace

If you have a Langfuse `trace_id` from a production trace (e.g., stored in your database), pass it to `export_to_langfuse()` to attach eval scores directly to that trace:

```python
report.export_to_langfuse(trace_id="your-langfuse-trace-id")
```

---

## Compliance Module

### What is it?

The Compliance module checks whether AI outputs **adhere to specific rules and policies**. While similar to Evals, it's designed specifically for compliance use cases where you need to verify outputs don't violate rules.

### When to use it?

- **PII prevention**: Ensure outputs don't leak sensitive information
- **Brand safety**: Check outputs follow brand guidelines
- **Regulatory compliance**: Verify medical/legal/financial disclaimers
- **Content moderation**: Detect inappropriate or harmful content
- **Policy enforcement**: Ensure AI follows company policies

### Evals vs Compliance: When to Use Which

| Evals | Compliance |
|-------|------------|
| "Is this answer good?" | "Does this violate our rules?" |
| Quality assessment | Rule violation detection |
| Pass rate metrics | Violation counts and details |
| Improve model outputs | Catch policy violations |

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Rules** | Specific policies that outputs must follow |
| **Violation** | When an output breaks a rule |
| **ComplianceReport** | Summary of violations by rule |
| **Batch evaluation** | Check multiple rules per output efficiently |

### Simple Example: Check Compliance Rules

```python
import asyncio
import pandas as pd
from penguin.core import create_model
from penguin.compliance import ComplianceRunner

async def main():
    # Create model and runner
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")
    runner = ComplianceRunner(model, max_concurrency=3)

    # Sample chatbot outputs to check
    df = pd.DataFrame({
        'input': [
            "What's my account number?",
            "I'm feeling sick, what should I do?",
            "How do I reset my password?"
        ],
        'output': [
            "Your account number is 1234-5678-9012.",  # PII violation!
            "You should see a doctor for proper diagnosis.",
            "Click 'Forgot Password' on the login page."
        ]
    })

    # Define compliance rules
    rules = [
        "Output must NOT reveal PII (account numbers, SSN, etc.)",
        "Output must NOT provide medical diagnosis",
        "Output must be helpful and professional"
    ]

    # Run compliance check (batch mode - all rules in one LLM call per row)
    report = await runner.evaluate(
        df=df,
        rules=rules,
        task_name="Customer Support Bot",
        batch_size=10,
    )

    # View results
    print(f"Trace ID: {report.trace_id}")
    print(f"Overall compliance: {report.overall_pass_rate:.1%}")

    print("\nPer-rule compliance:")
    for rule, summary in report.rule_summaries.items():
        status = "PASS" if summary.pass_rate == 1.0 else "FAIL"
        print(f"  [{status}] {rule[:50]}... ({summary.pass_rate:.0%})")

    # Find violations
    print("\nViolations:")
    for i, row_result in enumerate(report.row_results):
        for rule, result in row_result.items():
            if not result.passed:
                print(f"  Row {i}: Violated '{rule[:40]}...' - {result.reason}")

    # Push scores to Langfuse (no-op if Langfuse not configured)
    report.export_to_langfuse()

asyncio.run(main())
```

---

## Next Steps

**Continue learning:**
- **[06-ML-CAPABILITIES.md](06-ML-CAPABILITIES.md)** - AutoML, fine-tuning, and vision models
- **[07-WORKFLOWS-AND-PATTERNS.md](07-WORKFLOWS-AND-PATTERNS.md)** - Complete production workflows

**Related:**
- **[01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md)** - Core API for LLM processing
- **[02-TRACING-AND-CALLBACKS.md](02-TRACING-AND-CALLBACKS.md)** - View evaluation traces in Langfuse

---

← [Previous: 04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md) | [Home](README.md) | [Next: 06-ML-CAPABILITIES.md](06-ML-CAPABILITIES.md) →
