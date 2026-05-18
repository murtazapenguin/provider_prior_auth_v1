from loguru import logger

from app.config import Settings

_tracer_provider = None
_meter_provider = None


def init_telemetry(app, settings: Settings) -> None:
    """Initialize OpenTelemetry tracing, metrics, and auto-instrumentation.

    Call during FastAPI lifespan startup.
    """
    global _tracer_provider, _meter_provider

    if not settings.otel_enabled:
        logger.info("OpenTelemetry disabled via configuration")
        return

    from opentelemetry import trace
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create(
        {
            "service.name": settings.otel_service_name,
            "service.version": "0.1.0",
            "deployment.environment": settings.app_env,
        }
    )

    # Tracer provider
    _tracer_provider = TracerProvider(resource=resource)

    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

        otlp_exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
        _tracer_provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
        logger.info("OTLP trace exporter configured", endpoint=settings.otel_exporter_otlp_endpoint)
    else:
        from opentelemetry.sdk.trace.export import ConsoleSpanExporter

        if settings.debug:
            _tracer_provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
            logger.info("Console trace exporter configured (debug mode)")

    trace.set_tracer_provider(_tracer_provider)

    # Meter provider with Prometheus exporter
    if settings.prometheus_enabled:
        from opentelemetry.exporter.prometheus import PrometheusMetricReader
        from opentelemetry.sdk.metrics import MeterProvider

        prometheus_reader = PrometheusMetricReader()
        _meter_provider = MeterProvider(resource=resource, metric_readers=[prometheus_reader])

        from opentelemetry import metrics

        metrics.set_meter_provider(_meter_provider)
        logger.info("Prometheus metrics exporter configured")

        # Mount /metrics endpoint
        _mount_prometheus_endpoint(app)

    # Auto-instrumentation — pass providers explicitly for robustness
    _instrument_fastapi(app, _tracer_provider, _meter_provider)
    _instrument_libraries()

    logger.info("OpenTelemetry initialized", service=settings.otel_service_name)


def shutdown_telemetry() -> None:
    global _tracer_provider, _meter_provider

    if _tracer_provider:
        _tracer_provider.shutdown()
        _tracer_provider = None

    if _meter_provider:
        _meter_provider.shutdown()
        _meter_provider = None

    logger.info("OpenTelemetry shut down")


def _mount_prometheus_endpoint(app) -> None:
    """Mount the Prometheus /metrics endpoint on the FastAPI app."""
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
    from starlette.requests import Request
    from starlette.responses import Response
    from starlette.routing import Route

    async def metrics_endpoint(request: Request) -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.routes.append(Route("/metrics", metrics_endpoint))


def _instrument_fastapi(app, tracer_provider=None, meter_provider=None) -> None:
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(
            app,
            tracer_provider=tracer_provider,
            meter_provider=meter_provider,
            excluded_urls="health,readiness,metrics,docs,redoc,openapi.json,scalar",
        )
        logger.debug("FastAPI instrumentation enabled")
    except Exception as e:
        logger.warning("Failed to instrument FastAPI: {}", e)


def _instrument_libraries() -> None:
    """Auto-instrument third-party libraries."""
    # Celery
    try:
        from opentelemetry.instrumentation.celery import CeleryInstrumentor

        CeleryInstrumentor().instrument()
        logger.debug("Celery instrumentation enabled")
    except Exception as e:
        logger.warning("Failed to instrument Celery: {}", e)

    # Redis
    try:
        from opentelemetry.instrumentation.redis import RedisInstrumentor

        RedisInstrumentor().instrument()
        logger.debug("Redis instrumentation enabled")
    except Exception as e:
        logger.warning("Failed to instrument Redis: {}", e)

    # PyMongo (used by Motor)
    try:
        from opentelemetry.instrumentation.pymongo import PymongoInstrumentor

        PymongoInstrumentor().instrument()
        logger.debug("PyMongo instrumentation enabled")
    except Exception as e:
        logger.warning("Failed to instrument PyMongo: {}", e)
