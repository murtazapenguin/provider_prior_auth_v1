from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from loguru import logger

from services.ai.common.exceptions import AppException


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException):
        return JSONResponse(
            status_code=exc.status_code,
            content={'error': {'code': exc.code, 'message': exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = [
            {'field': '.'.join(str(loc) for loc in e['loc']), 'message': e['msg']}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                'error': {
                    'code': 'VALIDATION_ERROR',
                    'message': 'Validation failed',
                    'details': errors,
                }
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.opt(exception=exc).error('Unhandled exception: {}', exc)
        return JSONResponse(
            status_code=500,
            content={'error': {'code': 'INTERNAL_ERROR', 'message': 'An unexpected error occurred'}},
        )
