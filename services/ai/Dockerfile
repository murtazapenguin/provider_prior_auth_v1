# syntax=docker/dockerfile:1
#
# FastAPI AI sidecar — image for Render / Railway deployment.
#
# BUILD CONTEXT MUST BE THE REPO ROOT — the Penguin SDK wheel lives outside
# services/ai/. On Render / Railway set:
#   Dockerfile path: services/ai/Dockerfile
#   Build context:   .   (repo root)
#
# If the torch install fails for lack of a Python 3.14 CPU wheel, change the
# base image to python:3.12-slim — the service code only requires >=3.11.

FROM python:3.14-slim

# libreoffice (soffice): runtime dependency for the FHIR document-intake
# pipeline (RTF / HTML / CCDA → PDF before OCR). PDF + plain-text inputs do
# not need it, but mock fixtures may include other formats.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch CPU build first. On Linux, plain `pip install torch` pulls the large
# CUDA build; the CPU index keeps the image lean.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Penguin AI SDK from the bundled wheel (the [cpu] extra matches the venv).
# Keep the original filename — pip parses wheel metadata from the name.
COPY penguinai-claude-artifacts-main/packages/penguin_ai_sdk-0.2.0-py3-none-any.whl /tmp/
RUN pip install --no-cache-dir "/tmp/penguin_ai_sdk-0.2.0-py3-none-any.whl[cpu]"

# Remaining runtime deps (from services/ai/pyproject.toml).
RUN pip install --no-cache-dir \
      "fastapi>=0.110" "uvicorn[standard]>=0.27" "pydantic>=2.6" \
      "pydantic-settings>=2.0" "pymupdf>=1.24" "httpx>=0.27" \
      "loguru>=0.7" "asyncpg>=0.29"

# Sidecar source. Imports resolve as `services.ai.*`, so preserve the layout.
COPY services/ /app/services/

ENV PYTHONUNBUFFERED=1

# Render / Railway inject $PORT; default 8000 for a local `docker run`.
EXPOSE 8000
CMD ["sh", "-c", "python -m uvicorn services.ai.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
