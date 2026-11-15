from fastapi import Depends, FastAPI, Request, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import JSONResponse, HTMLResponse
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.exceptions import RequestValidationError, HTTPException
from sqlalchemy import text

from app.v1.models import *  # This ensures all models are loaded
from app.common.database_pool import Base, engine, close_database_connections, get_pool_status, get_database_health
from app.common.schema_name import SCHEMA
from app.common.auth_helper import require_super_admin
from app.common.build_info import get_build_info
from app.common.business_exceptions import AppError, AuthenticationError
from app.common.api_response_schema import error_response
from app.common.app_logger import get_logger, set_trace_id
from app.common.unknown_domain import is_unknown_domain_not_found
from app.common.config import LOG_HTTP_BODIES, LOG_HTTP_HEADERS
from app.common.log_redaction import redact_for_log, redact_header_value
from pydantic import ValidationError
import json
import os
import time
import uuid



from .v1.router import router as v1_router
from .scheduler import start_schedulers
import atexit
import signal
import sys

# Create schema then tables (SQLAlchemy create_all does not create the schema)
with engine.begin() as connection:
    connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"'))
Base.metadata.create_all(bind=engine)

class_logger = get_logger(__name__)

app = FastAPI(
    title="Clinicle Intelligence API",
    description="""
    # Clinicle Intelligence API
    
    This API provides authentication, organizations, users, roles, email, media, and notifications.
    
    ## Authentication
    Most endpoints require authentication via  JWT tokens.
    
    ## Response Format
    
    ### 1. Success Response (No Pagination)
    Standard success responses for single resource operations:
    ```json
    {
      "status": "success",
      "message": "Resource created successfully",
      "data": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "name": "Example Resource",
        "created_at": "2024-01-15T10:30:00"
      },
      "timestamp": "2024-01-15T10:30:00",
      pagination: null
    }
    ```
    
    ### 2. Success Response (With Pagination)
    Success responses for list operations with pagination:
    ```json
    {
      "status": "success",
      "message": "Resources listed successfully",
      "data": [
        {
          "id": "123e4567-e89b-12d3-a456-426614174000",
          "name": "Example Resource 1",
          "created_at": "2024-01-15T10:30:00"
        },
        {
          "id": "456e7890-e89b-12d3-a456-426614174001",
          "name": "Example Resource 2",
          "created_at": "2024-01-15T11:00:00"
        }
      ],
      "pagination": {
        "page": 2,
        "page_size": 25,
        "total_pages": 8,
        "total_items": 187,
        "has_next_page": true,
        "has_prev_page": true
      },
      "timestamp": "2024-01-15T12:00:00"
    }
    ```
    
    ### 3. Standard Error Response
    General error responses for business logic errors:
    ```json
    {
      "status": "error",
      "code": 401,
      "type": "AuthenticationError",
      "message": "You are not authenticated. Please log in to continue.",
      "description": "The provided authentication token is invalid or expired.",
      "timestamp": "2024-01-15T10:30:00"
    }
    ```
    
    ### 4. Error Response (With Validation Details)
    Validation errors with field-specific details:
    ```json
    {
      "status": "error",
      "code": 422,
      "type": "ValidationError",
      "message": "Validation error. Please check your input and try again.",
      "description": "The provided data has the following validation errors.",
      "details": {
        "email": "Invalid email format",
        "password": "Password must be at least 8 characters long",
        "age": "Age must be a positive number"
      },
      "timestamp": "2024-01-15T10:30:00"
    }
    ```
    
    ### 5. Error Response (With Additional Details)
    Complex error responses with additional context:
    ```json
    {
      "status": "error",
      "code": 409,
      "type": "ConflictError",
      "message": "Resource already exists",
      "description": "A resource with the provided identifier already exists in the system.",
      "details": {
        "field": "email",
        "value": "user@example.com",
        "existing_id": "456e7890-e89b-12d3-a456-426614174001"
      },
      "timestamp": "2024-01-15T10:30:00"
    }
    ```
    
    ## Pagination
    
    List endpoints support pagination using `page` and `page_size` parameters:
    
    - **page**: Page number (1-based, default: 1)
    - **page_size**: Items per page (1-100, default: 25)
    
    Example: `GET /api/v1/users/all-full?page=2&page_size=25`
    
    ## Common HTTP Status Codes
    
    - **200**: Success
    - **400**: Bad Request - Invalid input format
    - **401**: Unauthorized - Authentication required
    - **403**: Forbidden - Insufficient permissions
    - **404**: Not Found - Resource not found
    - **409**: Conflict - Resource already exists
    - **422**: Unprocessable Entity - Validation error
    - **500**: Internal Server Error
    """,
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    redirect_slashes=False
)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception Handlers - Order matters! More specific handlers first

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    """Handle business logic exceptions"""
    from app.common.http_errors import to_http_exception
    method_logger = class_logger.get_method_logger("app_error_handler")
    http_exc = to_http_exception(exc)
    log_fn = method_logger.info if is_unknown_domain_not_found(exc) else method_logger.error
    log_fn(
        f"Business exception: {exc.__class__.__name__} - {exc.message}",
        extra={
            "path": request.url.path,
            "method": request.method,
            "status_code": http_exc.status_code,
            "detail": exc.detailed_message,
        },
    )
    details = None
    if isinstance(exc, AuthenticationError) and getattr(exc, "locked_until", None):
        lu = exc.locked_until
        details = {
            "lockedUntil": lu.isoformat() if hasattr(lu, "isoformat") else str(lu)
        }
    error_resp = error_response(
        message=exc.message,
        error_type=exc.__class__.__name__,
        error_code=http_exc.status_code,
        description=exc.detailed_message,
        details=details
    )
    return JSONResponse(
        status_code=http_exc.status_code,
        content=error_resp.model_dump(by_alias=True)
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle Pydantic request validation errors"""
    from app.common.api_response_schema import validation_error_response, process_pydantic_errors
    
    # Use the helper function to process errors
    field_errors = process_pydantic_errors(exc.errors())
    
    response = validation_error_response(
        message="Validation error. Please check your input and try again.",
        description="The provided data has the following validation errors.",
        details=field_errors
    )
    
    return JSONResponse(
        status_code=422,
        content=response.model_dump(by_alias=True)
    )

@app.exception_handler(ValidationError)
async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    """Handle Pydantic model validation errors"""
    from app.common.api_response_schema import validation_error_response, process_pydantic_errors
    
    # Use the helper function to process errors
    field_errors = process_pydantic_errors(exc.errors())
    
    response = validation_error_response(
        message="Validation error. Please check your input and try again.",
        description="The provided data has the following validation errors.",
        details=field_errors
    )
    
    return JSONResponse(
        status_code=422,
        content=response.model_dump(by_alias=True)
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions - only for non-business logic exceptions"""
    # Map common HTTP status codes to appropriate error types
    error_type_map = {
        401: "AuthenticationError",
        403: "AuthorizationError", 
        404: "NotFoundError",
        409: "ConflictError",
        422: "ValidationError",
        429: "RateLimitError",
        503: "ServiceUnavailableError"
    }
    
    error_type = error_type_map.get(exc.status_code, "HTTPException")
    
    error_resp = error_response(
        message=exc.detail,
        error_type=error_type,
        error_code=exc.status_code,
        description=exc.detail
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=error_resp.model_dump(by_alias=True)
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle any unexpected exceptions"""
    import traceback

    method_logger = class_logger.get_method_logger("general_exception_handler")

    # Log the full exception with stack trace
    method_logger.error(
        f"Unexpected error: {type(exc).__name__} - {str(exc)}\n"
        f"Stack trace:\n{traceback.format_exc()}"
    )

    error_resp = error_response(
        message="An unexpected error occurred. Please try again later.",
        error_type="InternalServerError",
        error_code=500,
        description="The server encountered an unexpected error while processing your request."
    )
    return JSONResponse(
        status_code=500,
        content=error_resp.model_dump(by_alias=True)
    )

# Include versioned routers
app.include_router(v1_router, prefix="/api")

# Root endpoints


@app.get("/")
async def root_probe():
    return HTMLResponse(
        content="<html><head><title>Clinicle Intelligence API</title></head><body>OK</body></html>",
        status_code=200,
    )


@app.get("/api")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Welcome to the Clinicle Intelligence API",
        "versions": {
            "v1": "/api/v1"
        },
        "status": "operational"
    }


@app.get("/api/openapi.json", include_in_schema=False)
async def openapi_json(_user=Depends(require_super_admin)):
    return JSONResponse(app.openapi())


@app.get("/api/docs", include_in_schema=False)
async def swagger_ui(_user=Depends(require_super_admin)):
    return get_swagger_ui_html(
        openapi_url="/api/openapi.json",
        title=f"{app.title} - Swagger UI",
    )


@app.get("/api/redoc", include_in_schema=False)
async def redoc_ui(_user=Depends(require_super_admin)):
    return get_redoc_html(
        openapi_url="/api/openapi.json",
        title=f"{app.title} - ReDoc",
    )


@app.get("/api/v1/health/live")
async def health_live():
    """Minimal public probe for load balancers and container health checks."""
    return {"status": "ok"}


@app.get("/api/v1/health")
async def health_check(_user=Depends(require_super_admin)):
    """Health check endpoint (super-admin only)"""
    from datetime import datetime, timezone

    info = get_build_info()
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": info["release"],
        "release": info["release"],
        "build": info["build"],
        "git_sha": info["git_sha"],
        "environment": info["environment"],
    }


@app.get("/api/v1/health/database")
async def database_health_check(_user=Depends(require_super_admin)):
    """Database health check endpoint with connection pool monitoring"""
    return get_database_health()


@app.get("/api/v1/health/pool")
async def pool_status(_user=Depends(require_super_admin)):
    """Get detailed connection pool status"""
    from datetime import datetime, timezone
    return {
        "status": "success",
        "pool": get_pool_status(),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# detailed logging middleware
@app.middleware("http")
async def log_requests_and_responses(request: Request, call_next):
    """Log requests/responses with trace ID; full bodies only when explicitly enabled."""
    
    # Generate or extract trace ID for request correlation
    # Check for incoming trace ID from load balancer/gateway (common headers)
    trace_id = (
        request.headers.get("x-request-id") or
        request.headers.get("x-trace-id") or
        request.headers.get("rndr-id") or  # Render's request ID
        str(uuid.uuid4())[:8]  # Short UUID if none provided
    )
    set_trace_id(trace_id)
    
    method_logger = class_logger.get_method_logger("log_requests_and_responses")
    started = time.perf_counter()

    if request.url.query:
        method_logger.debug(
            f"Query Parameters: {json.dumps(redact_for_log(dict(request.query_params)), indent=2)}"
        )

    # Quiet production path: one INFO line with status/duration (no header/body dump).
    if not LOG_HTTP_BODIES and not LOG_HTTP_HEADERS:
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        method_logger.info(
            f"{request.method} {request.url.path} -> {response.status_code} ({elapsed_ms:.0f}ms)"
        )
        return response

    method_logger.info("---------------------- request start ----------------------")
    method_logger.info(f"\033[1m{request.method} {request.url.path}\033[0m")
    method_logger.debug(f"Request: {request.method} {request.url.path}")

    if LOG_HTTP_HEADERS:
        headers = {
            key: redact_header_value(key, value)
            for key, value in request.headers.items()
        }
        method_logger.debug(f"Headers: {json.dumps(headers, indent=2)}")

    # Get request body (full body logged at DEBUG when enabled)
    if LOG_HTTP_BODIES and request.method in ["POST", "PUT", "PATCH"]:
        try:
            body = await request.body()
            if body:
                body_str = body.decode('utf-8')
                try:
                    body_json = redact_for_log(json.loads(body_str))
                    method_logger.debug(f"Body: {json.dumps(body_json, indent=2)}")
                except json.JSONDecodeError:
                    method_logger.debug("Body: [non-json payload omitted]")
        except Exception as e:
            method_logger.debug(f"Could not read request body: {e}")

    # Process request
    response = await call_next(request)

    # Log response
    method_logger.debug(f"Response Status: {response.status_code}")

    if not LOG_HTTP_BODIES:
        method_logger.debug("---------------------- response  end------------------------------------")
        return response
    
    if LOG_HTTP_HEADERS:
        response_headers = {
            key: redact_header_value(key, value)
            for key, value in response.headers.items()
        }
        method_logger.debug(f"Response Headers: {json.dumps(response_headers, indent=2)}")

    # Get response body
    response_body = b""
    async for chunk in response.body_iterator:
        response_body += chunk

    # Reconstruct response
    response = Response(
        content=response_body,
        status_code=response.status_code,
        headers=dict(response.headers),
        media_type=response.media_type
    )

    # Log response body (full body logged at DEBUG; skip decoding binary streams e.g. download-media)
    try:
        response_text = response_body.decode("utf-8")
    except UnicodeDecodeError:
        content_type = response.headers.get("content-type") or "application/octet-stream"
        method_logger.debug(
            f"Response Body: [binary, {len(response_body)} bytes, content-type={content_type}]"
        )
    else:
        try:
            response_json = redact_for_log(json.loads(response_text))
            method_logger.debug(f"Response Body: {json.dumps(response_json, indent=2)}")
        except json.JSONDecodeError:
            method_logger.debug("Response Body: [non-json payload omitted]")
    
    method_logger.debug("---------------------- response  end------------------------------------")

    return response

# Shutdown handlers
@app.on_event("startup")
async def startup_event():
    """Initialize application on startup"""
    class_logger.info("Application starting up...")
    class_logger.info(f"Database pool status: {get_pool_status()}")

    try:
        from app.common.database_pool import SessionLocal
        from app.v1.roles.permission_bootstrap import ensure_permission_catalog

        db = SessionLocal()
        try:
            ensure_permission_catalog(db)
            db.commit()
            class_logger.info("Permission catalog ensured")
        finally:
            db.close()
    except Exception:
        class_logger.exception("Failed to ensure permission catalog")
    
    from app.common.config import ENABLE_INLINE_SCHEDULERS

    if ENABLE_INLINE_SCHEDULERS:
        start_schedulers()
    else:
        class_logger.info("Inline schedulers disabled (ENABLE_INLINE_SCHEDULERS=false)")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    class_logger.info("Application shutting down...")
    close_database_connections()

# Register signal handlers for graceful shutdown
def signal_handler(sig, frame):
    """Handle termination signals"""
    class_logger.info(f"Received signal {sig}, shutting down gracefully...")
    close_database_connections()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Register cleanup on exit
atexit.register(close_database_connections) 