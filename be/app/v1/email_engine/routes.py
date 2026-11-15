"""
Enhanced Email Routes
Simplified API endpoints for contextual email sending
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.orm import Session

from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.auth_helper import assert_permission, get_current_user, UserTokenInfo
from app.v1.auth.permissions import ORG_EMAIL_MANAGE
from app.common.business_exceptions import AuthorizationError, NotFoundError, BadRequestError
from app.common.app_logger import get_logger

from .services import EmailEngineService

class_logger = get_logger(__name__)
router = APIRouter(prefix="/email-engine", tags=["email-engine"])


#********************************************************************************
# Send Email
#********************************************************************************
@router.post("/send")
async def send_email(
    to_emails: List[str] = Body(..., description="List of recipient email addresses"),
    template_key: Optional[str] = Body(None, description="Template key to fetch from database"),
    template_data: Optional[Dict[str, Any]] = Body(None, description="Direct template data"),
    custom_variables: Optional[Dict[str, Any]] = Body(None, description="Additional custom variables"),
    from_name: Optional[str] = Body(None, description="Sender name"),
    from_email: Optional[str] = Body(None, description="Sender email"),
    reply_to: Optional[str] = Body(None, description="Reply-to email address"),
    cc_emails: Optional[List[str]] = Body(None, description="CC email addresses"),
    bcc_emails: Optional[List[str]] = Body(None, description="BCC email addresses"),
    priority: int = Body(5, ge=1, le=10, description="Email priority (1-10)"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    
    assert_permission(current_user, ORG_EMAIL_MANAGE)
    
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    service = EmailEngineService(db)
    result = service.send_email(
        to_emails=to_emails,
        template_key=template_key,
        template_data=template_data,
        organization_id=org_id,
        custom_variables=custom_variables,
        from_name=from_name,
        from_email=from_email,
        reply_to=reply_to,
        cc_emails=cc_emails,
        bcc_emails=bcc_emails,
        priority=priority
    )
    
    message = f"Email sent {result['method']}ly to {result['count']} recipient(s)"
    
    return success_response(
        data=result,
        message=message
    )




#********************************************************************************
# Process Email Queue
#********************************************************************************
@router.post("/process-queue")
async def process_email_queue(
    limit: int = Query(10, ge=1, le=100, description="Maximum number of emails to process"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Process queued emails one by one"""
    method_logger = class_logger.get_method_logger("process_email_queue")
    
    assert_permission(current_user, ORG_EMAIL_MANAGE)
    
    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    method_logger.info('Processing email queue', extra={
        'user_id': str(current_user.id),
        'limit': limit
    })
    
    service = EmailEngineService(db)
    processed_count = service.process_email_queue(organization_id=org_id, limit=limit)
    
    return success_response(
        data={"processedCount": processed_count},
        message=f"Processed {processed_count} email(s) from queue"
    )



#********************************************************************************           
# Get Email Queue
#********************************************************************************   
@router.get("/queue")
async def get_email_queue(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    status_filter: Optional[str] = Query(None),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get email queue with optional filtering"""
    method_logger = class_logger.get_method_logger("get_email_queue")
    method_logger.info('Getting email queue via API', extra={
        'user_id': str(current_user.id),
        'skip': skip,
        'limit': limit,
        'status_filter': status_filter
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailEngineService(db)
    queue_items, total_count = service.get_email_queue(
        organization_id=org_id,
        skip=skip,
        limit=limit,
        status_filter=status_filter
    )

    method_logger.info('Email queue retrieved successfully via API', extra={
        'count': len(queue_items),
        'total_count': total_count,
        'user_id': str(current_user.id)
    })

    return success_response(
        data={"queueItems": queue_items, "totalCount": total_count},
        message=SuccessMessages.LISTED,
        pagination={
            "page": (skip // limit) + 1,
            "page_size": limit,
            "total_pages": (total_count + limit - 1) // limit,
            "total_items": total_count,
            "has_next_page": (skip + limit) < total_count,
            "has_prev_page": skip > 0
        }
    )




#********************************************************************************
# Get Email Logs
#********************************************************************************
@router.get("/logs")
async def get_email_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    statusFilter: Optional[str] = Query(None),
    statusFilters: Optional[List[str]] = Query(None),
    templateId: Optional[UUID] = Query(None),
    search: Optional[str] = Query(None),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get email logs with optional filtering"""
    method_logger = class_logger.get_method_logger("get_email_logs")
    method_logger.info('Getting email logs via API', extra={
        'user_id': str(current_user.id),
        'skip': skip,
        'limit': limit,
        'statusFilter': statusFilter,
        'statusFilters': statusFilters,
        'templateId': str(templateId) if templateId else None,
        'search': search
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailEngineService(db)
    logs, total_count = service.get_email_logs(
        organization_id=org_id,
        skip=skip,
        limit=limit,
        status_filter=statusFilter,
        status_filters=statusFilters,
        template_id=templateId,
        search_term=search
    )

    method_logger.info('Email logs retrieved successfully via API', extra={
        'count': len(logs),
        'total_count': total_count,
        'user_id': str(current_user.id)
    })

    return success_response(
        data={"logs": logs, "totalCount": total_count},
        message=SuccessMessages.LISTED,
        pagination={
            "page": (skip // limit) + 1,
            "page_size": limit,
            "total_pages": (total_count + limit - 1) // limit,
            "total_items": total_count,
            "has_next_page": (skip + limit) < total_count,
            "has_prev_page": skip > 0
        }
    )


#********************************************************************************
# Email Analytics
#********************************************************************************
@router.get("/analytics")
async def get_email_analytics(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get email analytics and statistics"""
    method_logger = class_logger.get_method_logger("get_email_analytics")
    method_logger.info('Getting email analytics via API', extra={
        'user_id': str(current_user.id)
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailEngineService(db)
    analytics = service.get_email_analytics(organization_id=org_id)

    method_logger.info('Email analytics retrieved successfully via API', extra={
        'user_id': str(current_user.id)
    })

    return success_response(
        data=analytics,
        message="Email analytics retrieved successfully"
    )
