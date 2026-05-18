"""HARD RULE: This is the ONLY file in services/ai/ that imports from penguin.*.
Direct imports of openai, anthropic, boto3 (for Bedrock), pytesseract, or
langchain are forbidden in this service. See CLAUDE.md "Forbidden libraries".
"""

from typing import Literal

from services.ai.config import get_settings

_model_cache: dict[str, object] = {}

ModelRole = Literal['derivation', 'extraction', 'ingestion', 'split', 'narrative', 'triage']


def get_model(role: ModelRole):
    """Return a cached Penguin LLM model for the given role.

    derivation  → Sonnet 4.5, temp=0.0, max_tokens=4096
    extraction  → Sonnet 4.5, temp=0.0, max_tokens=4096
    ingestion   → Sonnet 4.5, temp=0.0, max_tokens=32768, long_context=True
    split       → Haiku 4.5,  temp=0.0, max_tokens=2048
    narrative   → Haiku 4.5,  temp=0.0, max_tokens=1024
    triage      → Haiku 4.5,  temp=0.0, max_tokens=2048  (Phase 6 document triage)
    """
    from penguin.core import create_model  # noqa: PLC0415

    if role in _model_cache:
        return _model_cache[role]

    settings = get_settings()

    _ROLE_CONFIG = {
        'derivation': {
            'provider': settings.penguin_llm_provider,
            'model': settings.penguin_llm_model,
            'temperature': 0.0,
            'max_tokens': 4096,
        },
        'extraction': {
            'provider': settings.penguin_llm_provider,
            'model': settings.penguin_llm_model,
            'temperature': 0.0,
            'max_tokens': 4096,
        },
        'ingestion': {
            'provider': settings.penguin_llm_provider,
            'model': settings.penguin_llm_model,
            'temperature': 0.0,
            # Policy ingestion emits the entire criteria list as ONE structured
            # (tool-call) response. The tool-call JSON encoding is markedly more
            # verbose than free text, so large UHC policies (e.g. apheresis 27pp,
            # cosmetic-reconstructive 29pp — and even dense 5pp drug policies like
            # Cosentyx) blow past 8192 output tokens. When that happens the model
            # stops with stopReason=max_tokens mid-tool-call, the partial JSON is
            # unparseable, langchain yields `input={}`, and IngestionResult fails
            # validation ("criteria Field required"). 32768 covers every policy
            # observed; Sonnet 4.5 on Bedrock allows up to 64000.
            'max_tokens': 32768,
        },
        'split': {
            'provider': settings.penguin_llm_provider,
            'model': settings.penguin_guard_model,
            'temperature': 0.0,
            'max_tokens': 2048,
        },
        'narrative': {
            'provider': settings.penguin_llm_provider,
            # Use the main LLM model (sonnet) — the guard model (haiku) hits
            # NotImplementedError in langchain_aws's older ChatBedrock path.
            'model': settings.penguin_llm_model,
            'temperature': 0.0,
            'max_tokens': 1024,
        },
        'triage': {
            # Mirrors `split` — Haiku via penguin_guard_model.  `split`
            # uses Haiku in production and works; if `langchain_aws`'s older
            # ChatBedrock path raises NotImplementedError for Haiku we'll
            # flip to penguin_llm_model the same way `narrative` did.
            'provider': settings.penguin_llm_provider,
            'model': settings.penguin_guard_model,
            'temperature': 0.0,
            'max_tokens': 2048,
        },
    }

    cfg = _ROLE_CONFIG[role]

    # Phase 7 fix: long policy ingestion (e.g. UHC sleep-studies, bariatric)
    # times out at the boto3 socket layer (~60s default read_timeout) even
    # though Penguin's request_timeout default is 900. Pass an explicit
    # botocore Config through to the Bedrock client so socket reads don't
    # cut off mid-extraction. Only applies to bedrock providers.
    if cfg.get('provider') == 'bedrock':
        from botocore.config import Config  # noqa: PLC0415  (boto3 for S3/Bedrock client config is allowed; we don't call Bedrock APIs directly)
        cfg = {
            **cfg,
            'config': Config(
                read_timeout=900,
                connect_timeout=60,
                retries={'max_attempts': 3, 'mode': 'standard'},
            ),
        }

    model = create_model(**cfg)
    _model_cache[role] = model
    return model


def get_ocr_provider():
    """Return the AWS Textract OCR provider (single-cloud setup with Bedrock)."""
    from penguin.ocr.providers.aws import AWSTextractProvider  # noqa: PLC0415

    settings = get_settings()
    return AWSTextractProvider(
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        aws_session_token=settings.aws_session_token or None,
        s3_bucket=settings.s3_ocr_staging_bucket or None,
    )


def get_tracer_session(pa_id: str, provider_id: str):
    """Return a PenguinTracer session if Langfuse is configured, else a no-op context."""
    settings = get_settings()
    if not settings.is_tracing_enabled:
        from contextlib import nullcontext  # noqa: PLC0415
        return nullcontext()
    from penguin.tracing import PenguinTracer  # noqa: PLC0415
    return PenguinTracer.session(session_id=pa_id, user_id=provider_id)
