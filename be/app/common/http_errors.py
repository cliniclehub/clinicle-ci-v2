from fastapi import HTTPException, status
from .business_exceptions import *


# Now you have 10 core exceptions that cover virtually all business scenarios:
# Exception	HTTP Code	Use Case
# NotFoundError	404	Resource not found
# ConflictError	409	Duplicates, conflicts
# UnauthorizedError	401	Not authenticated
# ForbiddenError	403	Not authorized
# ValidationError	422	Invalid input data
# BadRequestError	400	Invalid request format
# PaymentRequiredError	402	Subscription/upgrade needed
# ResourceExpiredError	410	Expired tokens/links
# RateLimitError	429	Too many requests
# ServiceUnavailableError	503	Service down

# This covers:
# CRUD operations (404, 409, 400, 422)
# Authentication/Authorization (401, 403)
# Business rules (402, 410, 429)
# System issues (503)


def to_http_exception(error: AppError) -> HTTPException:
    """Convert business exceptions to HTTP exceptions"""
    if isinstance(error, NotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error.message)
    elif isinstance(error, ConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=error.message)
    elif isinstance(error, AuthenticationError):
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=error.message)
    elif isinstance(error, ForbiddenError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=error.message)
    elif isinstance(error, AuthorizationError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=error.message)
    elif isinstance(error, ValidationError):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error.message)
    elif isinstance(error, BadRequestError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error.message)
    elif isinstance(error, PaymentRequiredError):
        return HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=error.message)
    elif isinstance(error, ResourceExpiredError):
        return HTTPException(status_code=status.HTTP_410_GONE, detail=error.message)
    elif isinstance(error, RateLimitError):
        return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=error.message)
    elif isinstance(error, ServiceUnavailableError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.message)
    else:
        return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal Server Error") 