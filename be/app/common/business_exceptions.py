
from typing import Any, Optional

class AppError(Exception):
    """Base class for all application-level business errors"""
    def __init__(self, detailed_message: Optional[str] = None):
        self.message = detailed_message or self._get_standard_message()
        self.detailed_message = detailed_message or self._get_standard_message()
        super().__init__(self.message)
    
    def _get_standard_message(self) -> str:
        """Override this method in subclasses to provide standard messages"""
        return "An application error occurred."

class BusinessException(AppError):
    """General business logic error"""
    def _get_standard_message(self) -> str:
        return "A business logic error occurred."

class NotFoundError(AppError):
    """Resource not found"""
    def _get_standard_message(self) -> str:
        return "The requested resource was not found."

class ResourceNotFoundError(AppError):
    """Resource not found (alias for NotFoundError)"""
    def _get_standard_message(self) -> str:
        return "The requested resource was not found."

class ConflictError(AppError):
    """Conflict in data (e.g., duplicate)"""
    def _get_standard_message(self) -> str:
        return "This resource already exists, or data not unique. Please try a different value."

class DuplicateResourceError(AppError):
    """Duplicate resource error (alias for ConflictError)"""
    def _get_standard_message(self) -> str:
        return "This resource already exists, or data not unique. Please try a different value."

class AuthorizationError(AppError):
    """Authorization failed"""
    def _get_standard_message(self) -> str:
        return "You don't have permission to perform this action."


class ForbiddenError(AppError):
    """Authenticated but access denied due to insufficient scope or permissions."""
    def _get_standard_message(self) -> str:
        return "Access denied."


class AuthenticationError(AppError):
    """Authentication failed"""
    def __init__(self, detailed_message: Optional[str] = None, *, locked_until: Optional[Any] = None):
        super().__init__(detailed_message)
        self.locked_until = locked_until

    def _get_standard_message(self) -> str:
        return "You are not authenticated. Please log in to continue."

class ValidationError(AppError):
    """Invalid input or state"""
    def _get_standard_message(self) -> str:
        return "Validation error. Please check your input and try again."

class RateLimitError(AppError):
    """Too many requests"""
    def _get_standard_message(self) -> str:
        return "Too many requests. Please wait a moment and try again."

class ServiceUnavailableError(AppError):
    """Downstream or internal dependency failure"""
    def _get_standard_message(self) -> str:
        return "Service temporarily unavailable. Please try again later."

class BadRequestError(AppError):
    """Invalid request format or parameters"""
    def _get_standard_message(self) -> str:
        return "Invalid request. Please check your input and try again."

class PaymentRequiredError(AppError):
    """Payment required (for subscription/upgrade scenarios)"""
    def _get_standard_message(self) -> str:
        return "Payment required. Please upgrade your plan to continue."

class ResourceExpiredError(AppError):
    """Resource has expired (tokens, links, etc.)"""
    def _get_standard_message(self) -> str:
        return "This resource has expired and is no longer available."

class NetworkError(AppError):
    """Network-related errors"""
    def _get_standard_message(self) -> str:
        return "Network error. Please check your connection and try again."
