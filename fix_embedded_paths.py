#!/usr/bin/env python3
"""
Bulk-rewrite embedded paths in planning docs.

Replaces every occurrence of `/Users/murtaza/provider_pa_hackathon/` with
`/Users/murtaza/Documents/provider_pa_hackathon/` across all *.md files at
the repo root and under tasks/.

Skips penguinai-claude-artifacts-main/ (vendor — read-only).

Run from the repo root:
    python3 fix_embedded_paths.py

Each modified file is backed up to <file>.bak.<timestamp>. Idempotent.
"""

import datetime
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
TS = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

OLD_PREFIX = "/Users/murtaza/provider_pa_hackathon/"
NEW_PREFIX = "/Users/murtaza/Documents/provider_pa_hackathon/"


def fix_file(path):
    text = path.read_text(encoding="utf-8")
    if OLD_PREFIX not in text:
        return 0  # nothing to do
    count = text.count(OLD_PREFIX)
    new_text = text.replace(OLD_PREFIX, NEW_PREFIX)
    backup = path.with_suffix(path.suffix + f".bak.{TS}")
    backup.write_text(text, encoding="utf-8")
    path.write_text(new_text, encoding="utf-8")
    return count


def main():
    if not (REPO_ROOT / "CLAUDE.md").exists():
        print("ERROR: CLAUDE.md not found in script directory.")
        print("Run this script from the repo root.")
        sys.exit(1)

    print(f"Repo: {REPO_ROOT}")
    print(f"Replacing: {OLD_PREFIX!r}")
    print(f"     With: {NEW_PREFIX!r}")
    print(f"Backup suffix: .bak.{TS}\n")

    targets = sorted(REPO_ROOT.glob("*.md")) + sorted((REPO_ROOT / "tasks").glob("*.md"))
    # Defensive: never touch vendor
    targets = [t for t in targets if "penguinai-claude-artifacts-main" not in str(t)]

    total = 0
    touched = 0
    for t in targets:
        n = fix_file(t)
        rel = t.relative_to(REPO_ROOT)
        if n == 0:
            print(f"  ⏭  {rel}")
        else:
            print(f"  ✅ {rel}  ({n} occurrence{'s' if n != 1 else ''})")
            touched += 1
            total += n

    print()
    print("=" * 70)
    print(f"Done. {touched} file(s) modified, {total} path(s) rewritten.")
    print(f"Backups: *.bak.{TS} (delete after you verify).")
    print("=" * 70)
    print()
    print("Verify with:")
    print(f"  grep -rn '{OLD_PREFIX}' *.md tasks/*.md 2>/dev/null  # should return nothing")


if __name__ == "__main__":
    main()
