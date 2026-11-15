"""
Email Engine Schema
Pydantic schemas for email queue and logs request/response validation
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field
from app.common.base_schema import CamelModel


# =====================================================
# Email Queue Schemas
# =====================================================

class EmailQueueBase(CamelModel):
    to_emails: List[str] = Field(..., description="Array of email addresses")
    subject: str = Field(..., max_length=500)
    body_html: str
    body_text: Optional[str] = None
    from_name: Optional[str] = Field(None, max_length=200)
    from_email: str = Field(..., max_length=200)
    reply_to: Optional[str] = Field(None, max_length=200)
    cc_emails: Optional[List[str]] = Field(None, description="Array of CC email addresses")
    bcc_emails: Optional[List[str]] = Field(None, description="Array of BCC email addresses")
    template_data: Optional[Dict[str, Any]] = Field(None, description="Template data as dictionary")
    status: str = Field(..., max_length=50)
    priority: int = Field(default=5)
    scheduled_at: Optional[datetime] = None
    attempts: int = Field(default=0)
    max_attempts: int = Field(default=3)
    last_attempt_at: Optional[datetime] = None
    next_retry_at: Optional[datetime] = None
    error_message: Optional[str] = None
    error_details: Optional[Dict[str, Any]] = Field(None, description="JSON data")
    sent_at: Optional[datetime] = None
    provider_message_id: Optional[str] = Field(None, max_length=500)


class EmailQueue(EmailQueueBase):
    id: int
    organization_id: UUID
    template_id: Optional[UUID] = None
    template_key: Optional[str] = Field(None, max_length=100)
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    batch_id: Optional[UUID] = None
    batch_name: Optional[str] = Field(None, max_length=200)

    class Config:
        from_attributes = True


class EmailQueueResponse(EmailQueue):
    """Response schema for API endpoints"""
    pass


# =====================================================
# Email Log Schemas
# =====================================================

class EmailLogBase(CamelModel):
    to_emails: List[str] = Field(..., description="Array of email addresses")
    cc_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    subject: str = Field(..., max_length=500)
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    from_name: Optional[str] = Field(None, max_length=200)
    from_email: Optional[str] = Field(None, max_length=200)
    reply_to: Optional[str] = Field(None, max_length=200)
    template_data: Optional[Dict[str, Any]] = None
    status: str = Field(..., max_length=50)
    priority: int = Field(default=5)
    attempts: int = Field(default=0)
    max_attempts: int = Field(default=3)
    provider_message_id: Optional[str] = Field(None, max_length=500)
    sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    opened_at: Optional[datetime] = None
    first_clicked_at: Optional[datetime] = None
    bounced_at: Optional[datetime] = None
    complained_at: Optional[datetime] = None
    open_count: int = Field(default=0)
    click_count: int = Field(default=0)
    bounce_type: Optional[str] = Field(None, max_length=50)
    bounce_reason: Optional[str] = None
    complaint_feedback_type: Optional[str] = Field(None, max_length=100)
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    error_message: Optional[str] = None
    error_code: Optional[str] = Field(None, max_length=100)
    error_details: Optional[Dict[str, Any]] = None


class EmailLog(EmailLogBase):
    id: int
    organization_id: UUID
    queue_id: Optional[int] = None
    template_id: Optional[UUID] = None
    template_key: Optional[str] = Field(None, max_length=100)
    user_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    batch_id: Optional[UUID] = None
    batch_name: Optional[str] = Field(None, max_length=200)

    class Config:
        from_attributes = True


class EmailLogResponse(EmailLog):
    """Response schema for API endpoints"""
    pass


# =====================================================
# Email Sending Schemas
# =====================================================

class SendTemplateEmailRequest(CamelModel):
    template_key: str = Field(..., min_length=1)
    to_emails: List[str] = Field(..., min_items=1)
    template_variables: Optional[Dict[str, Any]] = None
    cc_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    priority: int = Field(5, ge=1, le=10)


class SendBulkEmailRequest(CamelModel):
    template_key: str = Field(..., min_length=1)
    cohort_id: Optional[UUID] = None
    user_ids: Optional[List[UUID]] = None
    email_addresses: Optional[List[str]] = None
    template_variables: Optional[Dict[str, Any]] = None
    cc_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    priority: int = Field(5, ge=1, le=10)


class DirectEmailRequest(CamelModel):
    to_emails: List[str] = Field(..., min_items=1)
    subject: str = Field(..., min_length=1)
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    cc_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    reply_to: Optional[str] = None


class UserEmailRequest(CamelModel):
    userIds: List[UUID] = Field(..., min_items=1)
    subject: str = Field(..., min_length=1)
    bodyHtml: str = Field(..., min_length=1)
    bodyText: Optional[str] = None
    sendToMe: bool = False


class TestEmailRequest(CamelModel):
    recipient_email: str = Field(..., max_length=255)
    template_variables: Optional[Dict[str, Any]] = None


# =====================================================
# Analytics Schemas
# =====================================================

class EmailAnalytics(CamelModel):
    total_emails: int
    delivered: int
    bounced: int
    failed: int
    delivery_rate: float
    bounce_rate: float
    failure_rate: float
    status_breakdown: Dict[str, int]
    template_usage: List[Dict[str, Any]]