.PHONY: install dev lock lint format typecheck test run worker

# Install production dependencies
install:
	pip install .

# Install with dev dependencies
dev:
	pip install -e ".[dev]"

# Generate locked requirements from pyproject.toml
lock:
	pip-compile --strip-extras -o requirements.lock pyproject.toml
	pip-compile --strip-extras --extra dev -o requirements-dev.lock pyproject.toml

# Lint with ruff
lint:
	ruff check app/

# Format with ruff
format:
	ruff format app/
	ruff check --fix app/

# Type check with mypy
typecheck:
	mypy app/ --ignore-missing-imports

# Run tests
test:
	pytest app/tests/ -v

# Run API server (development)
run:
	uvicorn app.main:app --reload --port 8000

# Run Celery worker
worker:
	celery -A app.celery_app worker --loglevel=info
