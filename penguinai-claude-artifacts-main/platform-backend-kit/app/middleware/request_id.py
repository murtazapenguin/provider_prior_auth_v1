import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.logging_config import request_id_ctx, span_id_ctx, trace_id_ctx


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id

        # Bind request_id to loguru context for all downstream logging
        request_id_ctx.set(request_id)

        # Extract OTel trace context if available
        try:
            from opentelemetry import trace

            span = trace.get_current_span()
            ctx = span.get_span_context()
            if ctx.is_valid:
                trace_id_ctx.set(format(ctx.trace_id, "032x"))
                span_id_ctx.set(format(ctx.span_id, "016x"))
        except Exception:
            pass

        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
