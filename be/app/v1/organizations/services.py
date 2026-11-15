from typing import Any, Dict, List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_, asc, desc

from app.common.business_exceptions import NotFoundError, ConflictError
from app.common.render_helper import RenderHelper
from app.common.app_logger import get_logger

from .model import Organization as OrganizationModel
from .schema import (
    OrganizationCreate,
    OrganizationUpdate,
    OrganizationLandingPagePublic,
)

logger = get_logger(__name__)


class OrganizationService:
    #--------------------------------
    # List Organizations -super admin only
    #--------------------------------
    @staticmethod
    async def list_organizations(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        is_active: Optional[bool] = None,
        search: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc"
    ) -> tuple[List[OrganizationModel], int]:
        """Get organizations with pagination, search, and sorting - super admin only"""
        # Build base query
        query = db.query(OrganizationModel)
        
        # Apply is_active filter if provided
        if is_active is not None:
            query = query.filter(OrganizationModel.is_active == is_active)
        
        # Apply search if provided
        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    OrganizationModel.name.ilike(search_term),
                    OrganizationModel.domain.ilike(search_term),
                )
            )
        
        # Apply sorting with fallback for invalid fields
        try:
            sort_field = getattr(OrganizationModel, sort_by)
        except AttributeError:
            # Fallback to created_at if field doesn't exist
            sort_field = OrganizationModel.created_at
        
        if sort_order.lower() == "asc":
            query = query.order_by(asc(sort_field))
        else:
            query = query.order_by(desc(sort_field))
        
        # Get total count
        total = query.count()
        
        # Get paginated results
        organizations = query.offset(skip).limit(limit).all()
        
        return organizations, total

    #--------------------------------
    # Get Organization by ID -super admin and org admin
    #--------------------------------
    @staticmethod
    async def get_organization(db: Session, org_id: UUID) -> OrganizationModel:
        org = db.query(OrganizationModel).filter(OrganizationModel.id == org_id).first()
        if not org:
            raise NotFoundError("Organization not found")
        return org

    @staticmethod
    async def get_landing_page_html_by_domain(
        db: Session, domain: str
    ) -> OrganizationLandingPagePublic:
        org = (
            db.query(OrganizationModel)
            .filter(
                OrganizationModel.domain == domain
            )
            .first()
        )
        if not org:
            raise NotFoundError(f"Domain '{domain}' not found")
        return OrganizationLandingPagePublic(landing_page_html=org.landing_page_html)

    #--------------------------------
    # Create Organization -super admin only
    #--------------------------------
    @staticmethod
    async def create_organization(db: Session, org_data: OrganizationCreate) -> OrganizationModel:
        from app.v1.email_templates.services import EmailTemplateService
        
        try:
            org = OrganizationModel(**org_data.model_dump())
            db.add(org)
            db.commit()
            db.refresh(org)
            
            # Create default email templates for the new organization
            try:
                await EmailTemplateService.create_default_templates_for_organization(
                    db=db,
                    organization_id=org.id,
                    created_by=None  # System-created, no user ID
                )
            except Exception as template_error:
                # Log the error but don't fail organization creation
                logger.error(
                    f"Failed to create default email templates for organization {org.id}",
                    exc_info=True,
                    extra={'organization_id': str(org.id), 'error': str(template_error)}
                )
                # Continue - organization is created, templates can be added manually if needed
            
            return org
        except IntegrityError:
            db.rollback()
            raise ConflictError("Organization with this name or domain already exists")

    
    #--------------------------------
    # Update Organization -super admin and org admin
    #--------------------------------
    @staticmethod
    async def update_organization(
        db: Session,
        org_id: UUID,
        org_data: OrganizationUpdate,
        current_user_role: Optional[str] = None
    ) -> OrganizationModel:
        org = await OrganizationService.get_organization(db, org_id)
        
        update_data = org_data.model_dump(exclude_unset=True)
        # Do not clear timezone to NULL (column is NOT NULL)
        if update_data.get("timezone") is None and "timezone" in update_data:
            del update_data["timezone"]

        if current_user_role == "org_admin":
            OrganizationService._apply_org_admin_update_restrictions(
                update_data,
                org_id=org_id,
            )

        for field, value in update_data.items():
            if hasattr(org, field):
                setattr(org, field, value)

        try:
            db.commit()
            db.refresh(org)
            return org
        except IntegrityError:
            db.rollback()
            raise ConflictError("Organization with this domain already exists")
    
    @staticmethod
    def _apply_org_admin_update_restrictions(
        update_data: Dict[str, Any],
        *,
        org_id: UUID,
    ) -> None:
        """Strip fields org admins must not change (super_admin only)."""
        for restricted_key in ("is_active",):
            if restricted_key in update_data:
                logger.warning(
                    "Org admin attempted to change %s for organization %s. Request denied.",
                    restricted_key,
                    org_id,
                )
                del update_data[restricted_key]

    @staticmethod
    async def _add_domains_to_render(org: OrganizationModel) -> None:
        """
        Add organization domains to Render service if configured.
        This is called after organization creation or when domains are updated.
        
        Args:
            org: The organization model with domain information
        """
        method_logger = logger.get_method_logger("_add_domains_to_render")
        
        # Check if Render is configured
        try:
            from app.common.config import RENDER_API_KEY, get_render_custom_domain_service_id
            if not RENDER_API_KEY or not get_render_custom_domain_service_id():
                method_logger.info("Render API not configured, skipping domain addition")
                return
        except Exception:
            method_logger.info("Render configuration not available, skipping domain addition")
            return
        
        # Add organization domain if present (custom domains only — platform hosts use wildcards)
        if org.domain:
            try:
                method_logger.info(f"Adding organization domain {org.domain} to Render")
                await RenderHelper.add_custom_domain(org.domain)
                method_logger.info(f"Successfully added domain {org.domain} to Render")
            except Exception as e:
                # Log error but don't fail the organization creation/update
                method_logger.error(f"Failed to add domain {org.domain} to Render: {str(e)}", exc_info=True)

    #--------------------------------
    # Delete Organization -super admin only
    #--------------------------------
    @staticmethod
    async def delete_organization(db: Session, org_id: UUID) -> None:
        org = await OrganizationService.get_organization(db, org_id)
        
        # Check for dependent records that would prevent deletion
        from app.v1.users.model import User as UserModel
        
        user_count = db.query(UserModel).filter(UserModel.organization_id == org_id).count()
        
        if user_count > 0:
            raise ConflictError(
                f"Cannot delete organization: It has {user_count} user(s). "
                "Please remove these dependencies first."
            )
        
        try:
            db.delete(org)
            db.commit()
        except IntegrityError as e:
            try:
                db.rollback()
            except Exception:
                # If rollback fails, the session is likely already closed or in an invalid state
                pass
            # Extract a more user-friendly error message
            error_msg = str(e)
            if "foreign key constraint" in error_msg.lower():
                raise ConflictError(
                    "Cannot delete organization: It has associated records. "
                    "Please remove these dependencies first."
                )
            raise ConflictError(f"Cannot delete organization due to database constraints: {error_msg}")
        except Exception:
            try:
                db.rollback()
            except Exception:
                # If rollback fails, the session is likely already closed or in an invalid state
                pass
            # Re-raise the original exception to preserve the traceback
            raise

    #--------------------------------
    # List Organizations for Mobile Picker (public)
    #--------------------------------
    @staticmethod
    async def list_organizations_for_mobile(db: Session) -> List[OrganizationModel]:
        """List active organizations for mobile app picker (public endpoint)"""
        return db.query(OrganizationModel).filter(
            OrganizationModel.is_active == True
        ).order_by(OrganizationModel.name.asc()).all()

    #--------------------------------
    # List Organizations Dropdown -super admin only
    #--------------------------------
    @staticmethod
    async def list_organizations_dropdown(db: Session):
        orgs = db.query(OrganizationModel).all()
        return [{"id": org.id, "name": org.name, "domain": org.domain} for org in orgs]
