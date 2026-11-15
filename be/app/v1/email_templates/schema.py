"""
Email Templates Schema
Pydantic schemas for email template request/response validation
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field
from app.common.base_schema import CamelModel


class EmailTemplateBase(CamelModel):
    template_key: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    subject: str = Field(..., max_length=500)
    body_html: str
    body_text: Optional[str] = None
    from_name: Optional[str] = Field(None, max_length=200)
    from_email: Optional[str] = Field(None, max_length=200)
    reply_to: Optional[str] = Field(None, max_length=200)
    cc_emails: Optional[str] = Field(None, description="JSON array of CC email addresses")
    bcc_emails: Optional[str] = Field(None, description="JSON array of BCC email addresses")
    category: str = Field(default="transactional", max_length=50)
    is_active: bool = True
    is_system_default: bool = False
    available_fields: Optional[List[Dict[str, Any]]] = None
    preview_data: Optional[Dict[str, Any]] = None


class EmailTemplateCreate(EmailTemplateBase):
    pass


class EmailTemplateUpdate(CamelModel):
    template_key: Optional[str] = Field(None, min_length=1, max_length=100)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    subject: Optional[str] = Field(None, max_length=500)
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    from_name: Optional[str] = Field(None, max_length=200)
    from_email: Optional[str] = Field(None, max_length=200)
    reply_to: Optional[str] = Field(None, max_length=200)
    cc_emails: Optional[str] = Field(None, description="JSON array of CC email addresses")
    bcc_emails: Optional[str] = Field(None, description="JSON array of BCC email addresses")
    category: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None
    is_system_default: Optional[bool] = None
    available_fields: Optional[List[Dict[str, Any]]] = None
    preview_data: Optional[Dict[str, Any]] = None


class EmailTemplate(EmailTemplateBase):
    id: UUID
    organization_id: UUID
    is_system_default: bool = False
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmailTemplateResponse(EmailTemplate):
    """Response schema for API endpoints"""
    pass


class TemplatePreviewRequest(CamelModel):
    variables: Optional[Dict[str, Any]] = None


class TemplatePreviewResponse(CamelModel):
    subject: str
    html_content: str
    text_content: str
    variables_used: List[str]


class TemplateTestRequest(CamelModel):
    test_variables: Dict[str, Any]


class TemplateTestResponse(CamelModel):
    subject: str
    html_content: str
    text_content: str
    variables_used: List[str]