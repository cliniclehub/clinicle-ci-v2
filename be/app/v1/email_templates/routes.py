"""
Email Templates Routes
API endpoints for email template CRUD operations
"""

from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.common.database_pool import get_db
from app.common.api_response_schema import success_response, SuccessMessages
from app.common.auth_helper import assert_permission, get_current_user, UserTokenInfo
from app.common.business_exceptions import NotFoundError
from app.common.app_logger import get_logger
from app.v1.auth.permissions import ORG_EMAIL_MANAGE

from .schema import (
    EmailTemplateCreate,
    EmailTemplateUpdate,
)
from .services import EmailTemplateService

class_logger = get_logger(__name__)

router = APIRouter(prefix="/email-templates", tags=["Email Templates"])


#********************************************************************************
# Create Email Template
#********************************************************************************
@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_template(
    data: EmailTemplateCreate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create new email template"""
    method_logger = class_logger.get_method_logger("create_template")
    method_logger.info('Creating email template via API', extra={
        'user_id': str(current_user.id),
        'template_key': data.template_key
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailTemplateService(db)
    template = await service.create_template(
        template_data=data,
        organization_id=org_id,
        created_by=str(current_user.id)
    )

    method_logger.info('Template created successfully via API', extra={
        'template_id': str(template.id),
        'user_id': str(current_user.id)
    })

    return success_response(
        data=template,
        message=SuccessMessages.CREATED
    )


#********************************************************************************
# List Email Templates
#********************************************************************************
@router.get("/")
async def list_templates(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    isActive: Optional[bool] = Query(None),
    category: Optional[str] = Query(None),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List email templates"""
    method_logger = class_logger.get_method_logger("list_templates")
    method_logger.info('Listing email templates via API', extra={
        'user_id': str(current_user.id),
        'skip': skip,
        'limit': limit,
        'isActive': isActive,
        'category': category
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailTemplateService(db)
    templates, total_count = await service.list_templates(
        organization_id=org_id,
        skip=skip,
        limit=limit,
        is_active=isActive,
        category=category
    )

    method_logger.info('Templates listed successfully via API', extra={
        'count': len(templates),
        'total_count': total_count,
        'user_id': str(current_user.id)
    })

    return success_response(
        data={"templates": templates, "totalCount": total_count},
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
# Get Email Template
#********************************************************************************
@router.get("/{template_id}")
async def get_template(
    template_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get email template by ID"""
    method_logger = class_logger.get_method_logger("get_template")
    method_logger.info('Getting email template via API', extra={
        'user_id': str(current_user.id),
        'template_id': str(template_id)
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailTemplateService(db)
    template = await service.get_template(template_id, org_id)

    method_logger.info('Template retrieved successfully via API', extra={
        'template_id': str(template_id),
        'user_id': str(current_user.id)
    })

    return success_response(
        data=template,
        message=SuccessMessages.RETRIEVED
    )


#********************************************************************************
# Update Email Template
#********************************************************************************
@router.put("/{template_id}")
async def update_template(
    template_id: UUID,
    data: EmailTemplateUpdate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update email template"""
    method_logger = class_logger.get_method_logger("update_template")
    method_logger.info('Updating email template via API', extra={
        'user_id': str(current_user.id),
        'template_id': str(template_id)
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailTemplateService(db)
    template = await service.update_template(
        template_id=template_id,
        template_data=data,
        organization_id=org_id
    )

    method_logger.info('Template updated successfully via API', extra={
        'template_id': str(template_id),
        'user_id': str(current_user.id)
    })

    return success_response(
        data=template,
        message=SuccessMessages.UPDATED
    )


#********************************************************************************
# Restore Email Template to Default
#********************************************************************************
@router.post("/{template_id}/restore-default")
async def restore_template_to_default(
    template_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restore template content from the bundled system default definition."""
    method_logger = class_logger.get_method_logger("restore_template_to_default")
    method_logger.info(
        "Restoring email template to default via API",
        extra={
            "user_id": str(current_user.id),
            "template_id": str(template_id),
        },
    )

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailTemplateService(db)
    template = await service.restore_template_to_default(template_id, org_id)

    return success_response(
        data=template,
        message="Template restored to default successfully",
    )


#********************************************************************************
# Delete Email Template
#********************************************************************************
@router.delete("/{template_id}")
async def delete_template(
    template_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete email template"""
    method_logger = class_logger.get_method_logger("delete_template")
    method_logger.info('Deleting email template via API', extra={
        'user_id': str(current_user.id),
        'template_id': str(template_id)
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailTemplateService(db)
    await service.delete_template(template_id, org_id)

    method_logger.info('Template deleted successfully via API', extra={
        'template_id': str(template_id),
        'user_id': str(current_user.id)
    })

    return success_response(
        data=None,
        message=SuccessMessages.DELETED
    )


#********************************************************************************
# Preview Template
#********************************************************************************
@router.post("/{template_id}/preview")
async def preview_template(
    template_id: UUID,
    variables: dict = None,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Preview template with variables"""
    method_logger = class_logger.get_method_logger("preview_template")
    method_logger.info('Previewing template via API', extra={
        'user_id': str(current_user.id),
        'template_id': str(template_id),
        'variables': variables
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailTemplateService(db)
    preview = await service.preview_template(template_id, org_id, variables or {})

    method_logger.info('Template preview generated via API', extra={
        'template_id': str(template_id),
        'user_id': str(current_user.id)
    })

    return success_response(
        data=preview,
        message="Template preview generated successfully"
    )


#********************************************************************************
# Test Template Rendering
#********************************************************************************
@router.post("/{template_id}/test")
async def test_template_rendering(
    template_id: UUID,
    test_variables: dict,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test template rendering with sample data"""
    method_logger = class_logger.get_method_logger("test_template_rendering")
    method_logger.info('Testing template rendering via API', extra={
        'user_id': str(current_user.id),
        'template_id': str(template_id),
        'test_variables': test_variables
    })

    assert_permission(current_user, ORG_EMAIL_MANAGE)

    org_id = current_user.organization_id
    if not org_id:
        raise NotFoundError("Organization not found in token")

    service = EmailTemplateService(db)
    result = await service.test_template_rendering(template_id, org_id, test_variables)

    method_logger.info('Template rendering test completed via API', extra={
        'template_id': str(template_id),
        'user_id': str(current_user.id)
    })

    return success_response(
        data=result,
        message="Template rendering test completed successfully"
    )
