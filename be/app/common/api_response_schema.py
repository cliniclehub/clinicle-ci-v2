from typing import TypeVar, Generic, Optional, Any, List, Union, Sequence
from pydantic import BaseModel, Field, ValidationError
from datetime import datetime
from enum import Enum
from app.common.base_schema import CamelModel, to_camel

# Generic type for response data
T = TypeVar('T')


#success messages
class SuccessMessages(str, Enum):
    """Standard success messages"""
    CREATED = "Resource created successfully"
    RETRIEVED = "Resource retrieved successfully"
    UPDATED = "Resource updated successfully"
    DELETED = "Resource deleted successfully"
    LISTED = "Resources listed successfully"
    OPERATION_COMPLETED = "Operation completed successfully"
    VERIFIED = "Verification completed successfully"
    SENT = "Message sent successfully"
    PROCESSED = "Request processed successfully"
    ADDED = "Resource added successfully"

class PaginationInfo(CamelModel):
    """Pagination information structure"""
    page: int
    page_size: int
    total_pages: int
    total_items: int
    has_next_page: bool
    has_prev_page: bool

    def model_dump(self, **kwargs):
        """Override model_dump to exclude None values"""
        data = super().model_dump(**kwargs)
        return {k: v for k, v in data.items() if v is not None}

class SuccessResponse(BaseModel, Generic[T]):
    """Success response format"""
    status: str = "success"
    message: str
    data: Optional[T] = None
    timestamp: datetime = Field(default_factory=datetime.now)
    pagination: Optional[PaginationInfo] = None

    def model_dump(self, **kwargs):
        """Override model_dump to ensure datetime is properly serialized and exclude None values"""
        data = super().model_dump(**kwargs)
        if isinstance(data.get('timestamp'), datetime):
            data['timestamp'] = data['timestamp'].isoformat()
        
        # Remove None values to exclude them from the response
        return {k: v for k, v in data.items() if v is not None}

class ErrorResponse(BaseModel):
    """Error response format"""
    status: str = "error"
    code: int
    type: str
    message: str
    description: Optional[str] = None
    details: Optional[Any] = None
    timestamp: datetime = Field(default_factory=datetime.now)

    def model_dump(self, **kwargs):
        """Override model_dump to ensure datetime is properly serialized and exclude None values"""
        data = super().model_dump(**kwargs)
        if isinstance(data.get('timestamp'), datetime):
            data['timestamp'] = data['timestamp'].isoformat()
        
        # Remove None values to exclude them from the response
        return {k: v for k, v in data.items() if v is not None}


def process_pydantic_errors(errors: Sequence[Any]) -> dict:
    """Helper function to process Pydantic validation errors into field-based format"""
    field_errors = {}
    for error in errors:
        if isinstance(error, dict) and error.get("loc"):
            field_name = error["loc"][-1] if error["loc"] else "unknown"
            if isinstance(field_name, (int, float)):
                field_name = str(field_name)
            else:
                field_name = to_camel(str(field_name))
            if field_name not in field_errors:
                field_errors[field_name] = error.get("msg", "Invalid value")
    return field_errors

# Helper functions
def success_response(
    data: Optional[T] = None, 
    message: str = SuccessMessages.OPERATION_COMPLETED,
    pagination: Optional[PaginationInfo] = None
) -> SuccessResponse[T]:
    """Helper function to create standardized success responses"""
    return SuccessResponse(
        message=message,
        data=data,
        pagination=pagination
    )

def error_response(
    message: str, 
    error_type: str, 
    error_code: int, 
    description: Optional[str] = None,
    details: Optional[Any] = None
) -> ErrorResponse:
    """Helper function to create standardized error responses"""
    return ErrorResponse(
        code=error_code,
        type=error_type,
        message=message,
        description=description,
        details=details
    )

def validation_error_response(
    message: str = "Validation error. Please check your input and try again.",
    description: str = "The provided data has the following validation errors.",
    details: Optional[Any] = None
) -> ErrorResponse:
    """Helper function specifically for validation errors"""
    # If details is already a dict (processed field errors), use it directly
    if isinstance(details, dict):
        field_errors = details
    # If details is a list (raw Pydantic errors), process them
    elif details and isinstance(details, list):
        field_errors = process_pydantic_errors(details)
    else:
        field_errors = {}
    
    return ErrorResponse(
        code=422,
        type="ValidationError",
        message=message,
        description=description,
        details=field_errors
    )

def paginated_response(
    data: List[Any], 
    total: int, 
    page: int, 
    limit: int, 
    message: str = "Data retrieved successfully"
) -> SuccessResponse:
    """Create a standard paginated response"""
    total_pages = (total + limit - 1) // limit
    has_next_page = page < total_pages
    has_prev_page = page > 1

    pagination = PaginationInfo(
        page=page,
        page_size=limit,
        total_pages=total_pages,
        total_items=total,
        has_next_page=has_next_page,
        has_prev_page=has_prev_page
    )
    
    return SuccessResponse(
        message=message,
        data=data,
        pagination=pagination
    )

