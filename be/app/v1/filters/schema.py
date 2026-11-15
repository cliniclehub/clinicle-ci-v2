from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID
from app.common.base_schema import CamelModel


class SavedFilterCreate(CamelModel):
    name: str = Field(..., min_length=1, max_length=255, description="Filter name")
    description: Optional[str] = Field(None, description="Filter description")
    page_type: str = Field(..., description="Page type this filter applies to")
    filter_config: Dict[str, Any] = Field(..., description="Filter configuration JSON")
    is_default: bool = Field(False, description="Whether this is the default filter")
    organization_id: Optional[UUID] = Field(None, description="Organization ID (auto-populated)")

    @validator('filter_config')
    def validate_filter_config(cls, v):
        """Validate that filter_config is a valid filter structure"""
        if not isinstance(v, dict):
            raise ValueError('filter_config must be a JSON object')
        
        # Basic validation - check for required keys
        required_keys = ['groups', 'groupLogic']
        if not all(key in v for key in required_keys):
            raise ValueError('filter_config must contain groups and groupLogic')
        
        # Validate groupLogic value
        if v['groupLogic'] not in ['AND', 'OR']:
            raise ValueError('groupLogic must be either "AND" or "OR"')
        
        # Validate groups is a list
        if not isinstance(v['groups'], list):
            raise ValueError('groups must be a list')
        
        return v

    @validator('name')
    def validate_name(cls, v):
        if not v.strip():
            raise ValueError('name cannot be empty')
        return v.strip()

    @validator('page_type')
    def validate_page_type(cls, v):
        valid_types = ['users']
        if v not in valid_types:
            raise ValueError(f'page_type must be one of: {", ".join(valid_types)}')
        return v


class SavedFilterUpdate(CamelModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255, description="Filter name")
    description: Optional[str] = Field(None, description="Filter description")
    filter_config: Optional[Dict[str, Any]] = Field(None, description="Filter configuration JSON")
    is_default: Optional[bool] = Field(None, description="Whether this is the default filter")

    @validator('filter_config')
    def validate_filter_config(cls, v):
        if v is not None:
            if not isinstance(v, dict):
                raise ValueError('filter_config must be a JSON object')
            
            required_keys = ['groups', 'groupLogic']
            if not all(key in v for key in required_keys):
                raise ValueError('filter_config must contain groups and groupLogic')
            
            if v['groupLogic'] not in ['AND', 'OR']:
                raise ValueError('groupLogic must be either "AND" or "OR"')
            
            if not isinstance(v['groups'], list):
                raise ValueError('groups must be a list')
        
        return v

    @validator('name')
    def validate_name(cls, v):
        if v is not None:
            if not v.strip():
                raise ValueError('name cannot be empty')
            return v.strip()
        return v


class SavedFilterResponse(CamelModel):
    id: int
    user_id: UUID
    organization_id: UUID
    name: str
    description: Optional[str]
    page_type: str
    filter_config: Dict[str, Any]  # JSON object
    is_default: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
