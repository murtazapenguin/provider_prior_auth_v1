class AppException(Exception):
    def __init__(self, message: str, code: str = "INTERNAL_ERROR", status_code: int = 500):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


class NotFoundException(AppException):
    def __init__(self, message: str = "Resource not found", code: str = "NOT_FOUND"):
        super().__init__(message=message, code=code, status_code=404)


class UnauthorizedException(AppException):
    def __init__(self, message: str = "Unauthorized", code: str = "UNAUTHORIZED"):
        super().__init__(message=message, code=code, status_code=401)


class ForbiddenException(AppException):
    def __init__(self, message: str = "Forbidden", code: str = "FORBIDDEN"):
        super().__init__(message=message, code=code, status_code=403)


class BadRequestException(AppException):
    def __init__(self, message: str = "Bad request", code: str = "BAD_REQUEST"):
        super().__init__(message=message, code=code, status_code=400)


class ConflictException(AppException):
    def __init__(self, message: str = "Conflict", code: str = "CONFLICT"):
        super().__init__(message=message, code=code, status_code=409)
