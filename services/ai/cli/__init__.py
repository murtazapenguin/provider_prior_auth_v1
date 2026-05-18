"""CLI entry points for the AI service.

Each module under `cli/` exposes a `python -m services.ai.cli.<module>` entry
point so administrators / Clinical Informaticists can trigger ad-hoc workflows
(e.g. diffing a hand-curated policy against an AI-ingested twin) without
spinning up the full FastAPI service.
"""
