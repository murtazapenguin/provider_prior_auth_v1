"""CLI: diff a hand-curated Policy against an AI-ingested Policy.

Use case: Clinical Informaticist spot-checks AI ingestion quality before
publishing a draft policy. Given two Policy ids (one hand-curated, one
AI-ingested) for roughly the same payer + procedure, prints a side-by-side
PolicyCriterion-row diff in plain text.

Output covers:
  - Criterion-count delta (curated vs ingested)
  - Per-row text-similarity (Jaccard token overlap) for matched pairs
  - Missing criteria (in curated but not ingested)
  - Extra criteria (in ingested but not curated)

Matching strategy:
  Greedy best-match by Jaccard similarity on lower-cased token sets. Curated
  criteria are walked in ordinal order; each is matched to the unused
  ingested criterion with the highest Jaccard score (ties broken by ordinal).
  A pair is considered "matched" only if Jaccard ≥ MATCH_THRESHOLD (0.20);
  below that, the curated row is reported as missing and the ingested row
  stays in the pool for later matches.

This is intentionally simple — it's a spot-check tool, not a rigorous eval.

USAGE:

    python -m services.ai.cli.diff_curated_vs_ingested \\
        policy-uhc-botox-chronic-migraine 7f4a... \\
        [--database-url=postgres://...]
"""

from __future__ import annotations

import argparse
import asyncio
import re
from dataclasses import dataclass
from typing import Any, Optional

# Tokens shorter than 3 chars get dropped from the Jaccard set — they're
# overwhelmingly stopwords ("of", "to", "in", "a") and add noise.
_MIN_TOKEN_LEN = 3
_TOKEN_RE = re.compile(r"[a-z0-9]+")
MATCH_THRESHOLD = 0.20


# ─── Data ─────────────────────────────────────────────────────────────────────


@dataclass
class CriterionRow:
    id: str
    ordinal: int
    text: str
    evidence_hint: Optional[str]
    upload_hint: Optional[str]
    group: Optional[str]
    group_operator: Optional[str]


@dataclass
class PolicySnapshot:
    id: str
    title: str
    payer_id: str
    publish_status: str
    criteria: list[CriterionRow]


# ─── Similarity ───────────────────────────────────────────────────────────────


def _tokens(text: str) -> set[str]:
    return {
        t for t in _TOKEN_RE.findall(text.lower()) if len(t) >= _MIN_TOKEN_LEN
    }


def jaccard(a: str, b: str) -> float:
    """Jaccard token overlap; deterministic and dependency-free."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    union = ta | tb
    return len(inter) / len(union)


# ─── DB load ──────────────────────────────────────────────────────────────────


async def _load_policy(pool: Any, policy_id: str) -> Optional[PolicySnapshot]:
    """Load a Policy + its criteria from Postgres."""
    policy_row = await pool.fetchrow(
        '''
        SELECT id, title, "payerId", "publishStatus"
        FROM "Policy"
        WHERE id = $1
        ''',
        policy_id,
    )
    if policy_row is None:
        return None

    criterion_rows = await pool.fetch(
        '''
        SELECT id, ordinal, text, "evidenceHint", "uploadHint",
               "group", "groupOperator"
        FROM "PolicyCriterion"
        WHERE "policyId" = $1
        ORDER BY ordinal ASC
        ''',
        policy_id,
    )
    return PolicySnapshot(
        id=policy_row["id"],
        title=policy_row["title"],
        payer_id=policy_row["payerId"],
        publish_status=policy_row["publishStatus"],
        criteria=[
            CriterionRow(
                id=r["id"],
                ordinal=r["ordinal"],
                text=r["text"],
                evidence_hint=r["evidenceHint"],
                upload_hint=r["uploadHint"],
                group=r["group"],
                group_operator=r["groupOperator"],
            )
            for r in criterion_rows
        ],
    )


# ─── Diff ─────────────────────────────────────────────────────────────────────


@dataclass
class DiffPair:
    curated: Optional[CriterionRow]
    ingested: Optional[CriterionRow]
    similarity: float


def diff_criteria(
    curated: list[CriterionRow],
    ingested: list[CriterionRow],
) -> list[DiffPair]:
    """Greedy best-match between two criterion lists. See module docstring."""
    remaining = list(ingested)
    pairs: list[DiffPair] = []

    for cur in curated:
        if not remaining:
            pairs.append(DiffPair(curated=cur, ingested=None, similarity=0.0))
            continue
        best_idx = max(
            range(len(remaining)),
            key=lambda i: (jaccard(cur.text, remaining[i].text), -remaining[i].ordinal),
        )
        best = remaining[best_idx]
        sim = jaccard(cur.text, best.text)
        if sim >= MATCH_THRESHOLD:
            pairs.append(DiffPair(curated=cur, ingested=best, similarity=sim))
            remaining.pop(best_idx)
        else:
            pairs.append(DiffPair(curated=cur, ingested=None, similarity=0.0))

    # Whatever's left in remaining is an "extra" — ingested found something
    # the curated baseline doesn't have.
    for extra in remaining:
        pairs.append(DiffPair(curated=None, ingested=extra, similarity=0.0))

    return pairs


# ─── Rendering ────────────────────────────────────────────────────────────────


def _truncate(text: str, width: int) -> str:
    text = " ".join(text.split())  # collapse whitespace for tidy output
    if len(text) <= width:
        return text
    return text[: max(0, width - 3)] + "..."


def render_diff(
    curated: PolicySnapshot,
    ingested: PolicySnapshot,
    pairs: list[DiffPair],
) -> str:
    """Render a readable text diff."""
    matched = [p for p in pairs if p.curated and p.ingested]
    missing = [p for p in pairs if p.curated and not p.ingested]
    extra = [p for p in pairs if p.ingested and not p.curated]

    avg_sim = (sum(p.similarity for p in matched) / len(matched)) if matched else 0.0

    lines: list[str] = []
    lines.append("# Policy criteria diff")
    lines.append("")
    lines.append(f"Curated policy:  {curated.id}  ({curated.publish_status})")
    lines.append(f"  title:         {curated.title}")
    lines.append(f"  payer:         {curated.payer_id}")
    lines.append(f"  criteria:      {len(curated.criteria)}")
    lines.append("")
    lines.append(f"Ingested policy: {ingested.id}  ({ingested.publish_status})")
    lines.append(f"  title:         {ingested.title}")
    lines.append(f"  payer:         {ingested.payer_id}")
    lines.append(f"  criteria:      {len(ingested.criteria)}")
    lines.append("")
    lines.append("## Summary")
    delta = len(ingested.criteria) - len(curated.criteria)
    delta_str = f"+{delta}" if delta > 0 else str(delta)
    lines.append(f"  matched pairs:    {len(matched)}")
    lines.append(f"  missing (curated only): {len(missing)}")
    lines.append(f"  extra (ingested only):  {len(extra)}")
    lines.append(f"  count delta:      {delta_str}")
    lines.append(f"  avg similarity:   {avg_sim:.2f}")
    lines.append("")
    lines.append("## Matched pairs (curated <=> ingested)")
    if not matched:
        lines.append("  (none)")
    else:
        lines.append("  | ord | sim  | curated text                         | ingested text                        |")
        lines.append("  |-----|------|--------------------------------------|--------------------------------------|")
        for p in matched:
            assert p.curated and p.ingested
            lines.append(
                f"  | {p.curated.ordinal:>3} | {p.similarity:.2f} | "
                f"{_truncate(p.curated.text, 36):<36} | "
                f"{_truncate(p.ingested.text, 36):<36} |",
            )
    lines.append("")
    lines.append("## Missing criteria (in curated, no ingested match)")
    if not missing:
        lines.append("  (none)")
    else:
        for p in missing:
            assert p.curated
            lines.append(f"  - [ord {p.curated.ordinal}] {p.curated.text}")
    lines.append("")
    lines.append("## Extra criteria (in ingested, no curated match)")
    if not extra:
        lines.append("  (none)")
    else:
        for p in extra:
            assert p.ingested
            lines.append(f"  - [ord {p.ingested.ordinal}] {p.ingested.text}")
    lines.append("")
    return "\n".join(lines)


# ─── Entry points ─────────────────────────────────────────────────────────────


async def diff_policies(
    *,
    pool: Any,
    curated_policy_id: str,
    ingested_policy_id: str,
) -> str:
    """Programmatic entry: load both, run diff, return rendered output."""
    curated = await _load_policy(pool, curated_policy_id)
    if curated is None:
        return f"ERROR: curated policy not found: {curated_policy_id}\n"
    ingested = await _load_policy(pool, ingested_policy_id)
    if ingested is None:
        return f"ERROR: ingested policy not found: {ingested_policy_id}\n"
    pairs = diff_criteria(curated.criteria, ingested.criteria)
    return render_diff(curated, ingested, pairs)


async def _cli_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Diff a hand-curated Policy against an AI-ingested Policy. "
            "Prints a side-by-side criterion-row diff."
        ),
    )
    parser.add_argument(
        "curated_policy_id",
        help="The hand-curated Policy id (e.g. policy-uhc-botox-chronic-migraine).",
    )
    parser.add_argument(
        "ingested_policy_id",
        help="The AI-ingested Policy id (typically a 32-char hex uuid).",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Override DATABASE_URL. Defaults to services/ai/.env DATABASE_URL.",
    )
    args = parser.parse_args(argv)

    import asyncpg  # noqa: PLC0415

    from services.ai.config import get_settings  # noqa: PLC0415

    db_url = args.database_url or get_settings().database_url
    if not db_url:
        print("ERROR: no DATABASE_URL. Pass --database-url or set it in services/ai/.env.")
        return 1

    pool = await asyncpg.create_pool(db_url)
    try:
        output = await diff_policies(
            pool=pool,
            curated_policy_id=args.curated_policy_id,
            ingested_policy_id=args.ingested_policy_id,
        )
    finally:
        await pool.close()

    print(output)
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(asyncio.run(_cli_main(sys.argv[1:])))
