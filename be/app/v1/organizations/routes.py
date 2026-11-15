from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query, HTTPException, status, Request, Header
from sqlalchemy.orm import Session
from pydantic import BaseModel
import socket

import html

from app.common.database_pool import get_db
from app.common.config import get_platform_dns_cname_expected_target
from app.common.dns_cname_helper import normalize_dns_hostname, query_cname_target
from app.common.business_exceptions import NotFoundError, AuthorizationError, BadRequestError
from app.common.api_response_schema import success_response, SuccessMessages, paginated_response, SuccessResponse
from .model import Organization as OrganizationModel  # For DB queries
from .schema import (
    ContactFormCreate,
    Organization,
    OrganizationPublic,
    OrganizationLandingPagePublic,
    OrganizationCreate,
    OrganizationUpdate,
    OrganizationDropdown,
    OrganizationMobileListItem,
)  # For response models
from .services import OrganizationService
from app.common.auth_helper import assert_any_permission, assert_permission, get_current_user, UserTokenInfo
from app.v1.auth.permissions import (
    ORG_CONFIGURATIONS_MANAGE,
    ORG_SETTINGS_MANAGE,
    PLATFORM_ORGANIZATIONS_READ,
    PLATFORM_ORGANIZATIONS_WRITE,
)
from app.v1.email_engine.services import EmailEngineService
from app.v1.users.services import UserService # For User service
from app.v1.users.schema import User # For User schema

router = APIRouter(
    prefix="/organizations",
    tags=["organizations"]
)


#********************************************************************************
# Public Routes
#********************************************************************************

#--------------------------------
# Get organization white-label data by domain
# used for whitelabeling and branding of the login/registration pages before user is authenticated
#
# public endpoint
#--------------------------------
@router.get("/get-white-label-data-by-domain", 
    response_model=SuccessResponse[OrganizationPublic],
)
async def get_white_label_data_by_domain(
    x_org_domain: str = Header(..., alias='X-Organization-Domain'),
    db: Session = Depends(get_db)
):
    """Get organization by domain"""
    org = (
        db.query(OrganizationModel)
        .filter(
            OrganizationModel.domain == x_org_domain
        )
        .first()
    )

    if not org:
        raise NotFoundError(f"Domain '{x_org_domain}' not found")
    return success_response(
        data=OrganizationPublic.from_org_model(org),
        message=SuccessMessages.RETRIEVED,
    )


#--------------------------------
# Get organization public landing page HTML by domain
#
# public endpoint — intentionally separate from white-label to avoid large HTML on every branding fetch
#--------------------------------
@router.get(
    "/get-landing-page-by-domain",
    response_model=SuccessResponse[OrganizationLandingPagePublic],
)
async def get_landing_page_by_domain(
    x_org_domain: str = Header(..., alias="X-Organization-Domain"),
    db: Session = Depends(get_db),
):
    """Return custom site-landing body HTML for the organization resolved by domain."""
    landing = await OrganizationService.get_landing_page_html_by_domain(db, x_org_domain)
    return success_response(data=landing, message=SuccessMessages.RETRIEVED)


#--------------------------------
# List organizations for mobile app picker
#
# public endpoint (no authentication required)
#--------------------------------
@router.get(
    "/mobile-list",
    response_model=SuccessResponse[List[OrganizationMobileListItem]],
    summary="List organizations for mobile app picker (public)"
)
async def get_organizations_mobile_list(
    db: Session = Depends(get_db)
):
    """Public endpoint for mobile app to discover available organizations.
    Returns active orgs with branding data needed for the org picker screen.
    No authentication required -- this is the app's entry point before login."""
    orgs = await OrganizationService.list_organizations_for_mobile(db)
    return success_response(data=orgs, message=SuccessMessages.LISTED)


_DEFAULT_CONTACT_CATEGORY_LABELS = {
    "general": "General",
    "technical": "Technical issue",
    "billing": "Billing",
    "account": "Account",
    "other": "Other",
}

_CONTACT_FROM_NAME_MAX_LEN = 130


def _get_contact_topics_map(org: OrganizationModel) -> dict[str, str]:
    """Resolve contact topics from organization site_theme with safe defaults."""
    site_theme = org.site_theme if isinstance(org.site_theme, dict) else {}
    configured_topics = site_theme.get("contactTopics")
    if not isinstance(configured_topics, list):
        return dict(_DEFAULT_CONTACT_CATEGORY_LABELS)

    topic_map: dict[str, str] = {}
    for topic in configured_topics:
        if not isinstance(topic, dict):
            continue
        key = str(topic.get("key", "")).strip().lower()
        label = str(topic.get("label", "")).strip()
        if not key or not label:
            continue
        topic_map[key] = label

    return topic_map or dict(_DEFAULT_CONTACT_CATEGORY_LABELS)


def _contact_form_from_display_name(submitter_name: str, org_name: str) -> str:
    """Inbox-friendly From name; keeps platform From address (deliverability) but clarifies who wrote in."""
    name = (submitter_name or "").strip() or "Learner"
    org = (org_name or "").strip() or "Organization"
    base = f"{name} (via {org})"
    if len(base) <= _CONTACT_FROM_NAME_MAX_LEN:
        return base
    return base[: _CONTACT_FROM_NAME_MAX_LEN - 1] + "…"


#--------------------------------
# Public contact form — delivers to organization support_email
#--------------------------------
@router.post(
    "/contact-form",
    response_model=SuccessResponse[dict],
    summary="Submit public contact form (no auth)",
)
async def submit_public_contact_form(
    payload: ContactFormCreate,
    x_org_domain: str = Header(..., alias="X-Organization-Domain"),
    db: Session = Depends(get_db),
):
    domain = (x_org_domain or "").strip()
    if not domain:
        raise BadRequestError("Organization domain is required")

    org = (
        db.query(OrganizationModel)
        .filter(
            OrganizationModel.domain == domain
        )
        .first()
    )
    if not org:
        raise NotFoundError(f"Domain '{domain}' not found")
    if org.is_active is False:
        raise BadRequestError("Organization is not active")

    support_to = (org.support_email or "").strip()
    if not support_to:
        raise BadRequestError("This organization has not configured a support email")

    category_key = (payload.category or "").strip().lower()
    topic_map = _get_contact_topics_map(org)
    if category_key not in topic_map:
        raise BadRequestError("Invalid topic")

    category_label = topic_map[category_key]
    subject_line = f"[Contact: {category_label}] {payload.subject.strip()}"

    submitter_email_raw = str(payload.email).strip()
    safe_name = html.escape(payload.name.strip())
    safe_email = html.escape(submitter_email_raw)
    safe_topic = html.escape(category_label)
    safe_subject = html.escape(payload.subject.strip())
    safe_message = html.escape(payload.message.strip())
    safe_org = html.escape(org.name or "")

    from_display = _contact_form_from_display_name(payload.name.strip(), org.name or "")

    reply_hint_html = (
        "<p style=\"margin:0 0 1em 0;padding:12px 14px;background:#f4f4f5;border-radius:8px;"
        "border-left:4px solid #71717a;font-size:14px;line-height:1.5;color:#18181b;\">"
        "<strong>Replying</strong> — Use your mail app&rsquo;s <strong>Reply</strong> to answer "
        f"<strong>{safe_name}</strong> at "
        f"<a href=\"mailto:{html.escape(submitter_email_raw, quote=True)}\">{safe_email}</a>. "
        "The visible &ldquo;From&rdquo; address is the learning platform; your reply is still "
        "addressed to this person (Reply-To is set).</p>"
    )
    reply_hint_text = (
        "Replying — Use Reply in your mail app to answer "
        f"{payload.name.strip()} at {submitter_email_raw}.\n"
        "The visible From address is the learning platform; Reply-To is set to the person above.\n\n"
    )

    body_html = (
        reply_hint_html
        + f"<p><strong>Organization:</strong> {safe_org}</p>"
        f"<p><strong>Name:</strong> {safe_name}<br/>"
        f"<strong>Email:</strong> {safe_email}<br/>"
        f"<strong>Topic:</strong> {safe_topic}<br/>"
        f"<strong>Subject:</strong> {safe_subject}</p>"
        f"<p><strong>Message:</strong></p>"
        f"<p style='white-space:pre-wrap'>{safe_message}</p>"
    )
    body_text = (
        reply_hint_text
        + f"Organization: {org.name}\n"
        f"Name: {payload.name.strip()}\n"
        f"Email: {payload.email}\n"
        f"Topic: {category_label}\n"
        f"Subject: {payload.subject.strip()}\n\n"
        f"{payload.message.strip()}\n"
    )

    email_service = EmailEngineService(db)
    # Use template variables so user-supplied text cannot be interpreted as Jinja in the renderer.
    email_service.send_email(
        to_emails=[support_to],
        template_data={
            "subject": "{{ contact_subject }}",
            "bodyHtml": "{{ contact_body_html | safe }}",
            "bodyText": "{{ contact_body_text }}",
        },
        organization_id=org.id,
        from_name=from_display,
        reply_to=submitter_email_raw,
        priority=6,
        custom_variables={
            "contact_subject": subject_line,
            "contact_body_html": body_html,
            "contact_body_text": body_text,
        },
    )

    return success_response(data={"sent": True}, message="Message sent successfully")


#********************************************************************************
# Org Admin Only Routes
#********************************************************************************


#--------------------------------
# Get organization by ID (Org Admin Only)
#--------------------------------
@router.get("/my-organization", response_model=SuccessResponse[Organization])
async def get_my_organization(
    current_user: UserTokenInfo = Depends(get_current_user),

    db: Session = Depends(get_db)
):

    if not current_user.has_any_role(["org_admin", "user"]):
        raise AuthorizationError("You are not authorized to get organizations")
    
    """Get organization id from domain from token"""
    org_id = current_user.organization_id or None
    if not org_id:
        raise NotFoundError("Organization not found in token")

    """Get organization by id from db"""
    org = await OrganizationService.get_organization(db, org_id)
    payload = Organization.from_org_model(org)
    return success_response(data=payload, message=SuccessMessages.RETRIEVED)


#--------------------------------
# Update organization (Org Admin Only)
#--------------------------------
@router.patch("/my-organization", response_model=SuccessResponse[Organization])
async def update_my_organization(
    org_data: OrganizationUpdate,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    
    if not current_user.has_any_permission([ORG_SETTINGS_MANAGE, ORG_CONFIGURATIONS_MANAGE]):
        raise AuthorizationError("You are not authorized to update organizations")
    
    """Get organization id from domain from token"""
    org_id = current_user.organization_id or None
    if not org_id:
        raise NotFoundError("Organization not found in token")
    
    """Update organization by id from db"""
    org = await OrganizationService.update_organization(db, org_id, org_data, current_user_role="org_admin")
    return success_response(
        data=Organization.from_org_model(org), message=SuccessMessages.UPDATED
    )


#********************************************************************************
# Super Admin Only Routes
#********************************************************************************

#--------------------------------
# Get all organizations (Super Admin Only)
#--------------------------------
@router.get("/", response_model=SuccessResponse[List[Organization]])
async def list_organizations(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    is_active: Optional[bool] = None,
    search: Optional[str] = Query(None, description="Search term for name or domain"),
    sort_by: str = Query(default="created_at", description="Field to sort by"),
    sort_order: str = Query(default="desc", description="Sort order (asc or desc)"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    assert_permission(current_user, PLATFORM_ORGANIZATIONS_READ)
    
    # Calculate skip from page and page_size
    skip = (page - 1) * page_size
    
    organizations, total = await OrganizationService.list_organizations(
        db, skip, page_size, is_active, search, sort_by, sort_order
    )
    
    # Calculate user counts for all organizations
    from app.v1.users.model import User as UserModel
    from sqlalchemy import func

    org_ids = [org.id for org in organizations]
    user_counts = {}
    if org_ids:
        # Get user counts for all organizations in one query
        counts = db.query(
            UserModel.organization_id,
            func.count(UserModel.id).label('count')
        ).filter(
            UserModel.organization_id.in_(org_ids)
        ).group_by(UserModel.organization_id).all()
        
        user_counts = {str(org_id): count for org_id, count in counts}
    
    # Convert to Organization schema and add user_count
    organization_list = []
    for org in organizations:
        org_schema = Organization.from_org_model(org).model_copy(
            update={"user_count": user_counts.get(str(org.id), 0)}
        )
        organization_list.append(org_schema)
    
    return paginated_response(
        data=organization_list,
        total=total,
        page=page,
        limit=page_size,
        message=SuccessMessages.LISTED
    )


#--------------------------------
# Get organization by ID (Super Admin Only)
#--------------------------------
@router.get("/{org_id:uuid}", response_model=SuccessResponse[Organization])
async def get_organization(
    org_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),

    db: Session = Depends(get_db)
):
    """Get organization by ID"""
    assert_permission(current_user, PLATFORM_ORGANIZATIONS_READ)
   
    org = await OrganizationService.get_organization(db, org_id)
    return success_response(
        data=Organization.from_org_model(org), message=SuccessMessages.RETRIEVED
    )


#--------------------------------
# Create organization (Super Admin Only)
#--------------------------------
@router.post("/", 
    response_model=SuccessResponse[Organization],
)
async def create_organization(
    org_data: OrganizationCreate,
    current_user: UserTokenInfo = Depends(get_current_user),

    db: Session = Depends(get_db)
):
    """Create a new organization"""
    assert_permission(current_user, PLATFORM_ORGANIZATIONS_WRITE)
    
    org = await OrganizationService.create_organization(db, org_data)
    return success_response(
        data=Organization.from_org_model(org), message=SuccessMessages.CREATED
    )



#--------------------------------
# Update organization (Super Admin Only)
#--------------------------------
@router.patch("/{org_id:uuid}", response_model=SuccessResponse[Organization])
async def update_organization(
    org_id: UUID,
    org_data: OrganizationUpdate,
    current_user: UserTokenInfo = Depends(get_current_user),

    db: Session = Depends(get_db)
):

    assert_permission(current_user, PLATFORM_ORGANIZATIONS_WRITE)
    
    org = await OrganizationService.update_organization(db, org_id, org_data, current_user_role="super_admin")
    return success_response(
        data=Organization.from_org_model(org), message=SuccessMessages.UPDATED
    )

#--------------------------------
# Delete organization (Super Admin Only)
#--------------------------------
@router.delete("/{org_id}", response_model=SuccessResponse)
async def delete_organization(
    org_id: UUID,
    current_user: UserTokenInfo = Depends(get_current_user),

    db: Session = Depends(get_db)
):
    assert_permission(current_user, PLATFORM_ORGANIZATIONS_WRITE)
    await OrganizationService.delete_organization(db, org_id)
    return success_response(message=SuccessMessages.DELETED)

#--------------------------------
# Get organizations for dropdown -(Super Admin Only)
#--------------------------------
@router.get(
    "/dropdown",
    response_model=SuccessResponse[List[OrganizationDropdown]],
    tags=["organizations"],
    summary="Get all organizations for dropdown (public)"
)
async def get_organizations_dropdown(
    current_user: UserTokenInfo = Depends(get_current_user),

    db: Session = Depends(get_db)
):
    assert_permission(current_user, PLATFORM_ORGANIZATIONS_READ)
    orgs = await OrganizationService.list_organizations_dropdown(db)
    return success_response(data=orgs, message=SuccessMessages.LISTED)


#--------------------------------
# Get organization users (Super Admin Only)
#--------------------------------
@router.get("/{org_id:uuid}/users", response_model=SuccessResponse[List[User]])
async def get_organization_users(
    org_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search term for email or name"),
    role: Optional[str] = Query(None, description="Filter by role"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get users for a specific organization"""
    assert_permission(current_user, PLATFORM_ORGANIZATIONS_READ)
    
    # Calculate skip from page and page_size
    skip = (page - 1) * page_size
    
    # Use the existing get_users method with org_id filtering
    users, total = await UserService.get_users(
        db, skip, page_size, search, "created_at", "desc", org_id
    )
    
    return paginated_response(
        data=users,
        total=total,
        page=page,
        limit=page_size,
        message=SuccessMessages.LISTED
    )


#--------------------------------
# Verify Domain DNS Configuration (Super Admin or Org Admin for their own organization)
#--------------------------------
@router.get("/verify-domain-dns", response_model=SuccessResponse[dict])
async def verify_domain_dns(
    domain: str = Query(..., description="Domain to verify"),
    domain_type: str = Query("organization", description="Type of domain: 'organization' or 'platform'"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verify that a domain's DNS has a CNAME pointing to the platform host for this environment (see get_platform_dns_cname_expected_target).

    Org admins may call this for any hostname; super admins likewise. Verification is informational only.
    """
    assert_any_permission(current_user, PLATFORM_ORGANIZATIONS_WRITE, ORG_SETTINGS_MANAGE)

    if not current_user.has_permission(PLATFORM_ORGANIZATIONS_WRITE):
        org_id = current_user.organization_id
        if not org_id:
            raise NotFoundError("Organization not found in token")
        from app.v1.organizations.model import Organization
        org = db.query(Organization).filter(Organization.id == org_id).first()
        if not org:
            raise NotFoundError("Organization not found")
    
    try:
        # Clean the domain (remove http://, https://, trailing slashes)
        clean_domain = domain.strip().lower()
        if clean_domain.startswith("http://"):
            clean_domain = clean_domain[7:]
        if clean_domain.startswith("https://"):
            clean_domain = clean_domain[8:]
        if clean_domain.endswith("/"):
            clean_domain = clean_domain[:-1]
        
        # Remove port if present
        if ":" in clean_domain:
            clean_domain = clean_domain.split(":")[0]
        
        expected_target = get_platform_dns_cname_expected_target()
        expected_norm = normalize_dns_hostname(expected_target)

        try:
            cname_target = query_cname_target(clean_domain)
            if not cname_target:
                try:
                    socket.gethostbyname(clean_domain)
                    return success_response(
                        data={
                            "domain": clean_domain,
                            "verified": False,
                            "cname_target": None,
                            "expected_target": expected_target,
                            "message": f"CNAME record not found. Please create a CNAME record pointing {clean_domain} to {expected_target}"
                        },
                        message="DNS verification completed"
                    )
                except socket.gaierror:
                    return success_response(
                        data={
                            "domain": clean_domain,
                            "verified": False,
                            "cname_target": None,
                            "expected_target": expected_target,
                            "message": f"Domain {clean_domain} does not resolve. Please configure DNS first."
                        },
                        message="DNS verification completed"
                    )

            is_verified = normalize_dns_hostname(cname_target) == expected_norm
            if is_verified:
                return success_response(
                    data={
                        "domain": clean_domain,
                        "verified": True,
                        "cname_target": cname_target,
                        "expected_target": expected_target,
                        "message": f"CNAME record is correctly configured: {clean_domain} → {cname_target}"
                    },
                    message="DNS verification completed"
                )

            return success_response(
                data={
                    "domain": clean_domain,
                    "verified": False,
                    "cname_target": cname_target,
                    "expected_target": expected_target,
                    "message": f"CNAME record points to {cname_target}, but should point to {expected_target}"
                },
                message="DNS verification completed"
            )
        except Exception as e:
            return success_response(
                data={
                    "domain": clean_domain,
                    "verified": False,
                    "cname_target": None,
                    "expected_target": expected_target,
                    "message": f"Error verifying domain: {str(e)}"
                },
                message="DNS verification completed"
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to verify domain DNS: {str(e)}"
        )


#--------------------------------
# Add Domain to Render (Super Admin Only)
#--------------------------------
class AddDomainToRenderRequest(BaseModel):
    domain: str


class AddDomainToNamecheapRequest(BaseModel):
    domain: str


@router.post("/add-domain-to-render", response_model=SuccessResponse[dict])
async def add_domain_to_render(
    request: AddDomainToRenderRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a custom domain to Render service"""
    assert_any_permission(current_user, PLATFORM_ORGANIZATIONS_WRITE, ORG_SETTINGS_MANAGE)
    
    try:
        from app.common.render_helper import RenderHelper
        
        # Clean the domain (remove http://, https://, trailing slashes)
        clean_domain = request.domain.strip().lower()
        if clean_domain.startswith("http://"):
            clean_domain = clean_domain[7:]
        if clean_domain.startswith("https://"):
            clean_domain = clean_domain[8:]
        if clean_domain.endswith("/"):
            clean_domain = clean_domain[:-1]
        
        # Remove port if present
        if ":" in clean_domain:
            clean_domain = clean_domain.split(":")[0]
        
        # If org-scoped, verify they can only add their own organization's domain
        if not current_user.has_permission(PLATFORM_ORGANIZATIONS_WRITE):
            org_id = current_user.organization_id
            if not org_id:
                raise NotFoundError("Organization not found in token")
            
            # Get organization to check domain
            from app.v1.organizations.model import Organization
            org = db.query(Organization).filter(Organization.id == org_id).first()
            if not org:
                raise NotFoundError("Organization not found")
            
            # Check if the domain belongs to this organization
            org_domain = org.domain.lower().strip() if org.domain else None
            if not org_domain or clean_domain != org_domain:
                raise AuthorizationError("You can only add domains for your own organization")
        
        # Add domain to Render
        result = await RenderHelper.add_custom_domain(clean_domain)
        
        return success_response(
            data={
                "domain": clean_domain,
                "render_response": result,
                "message": f"Domain {clean_domain} successfully added to Render"
            },
            message="Domain added to Render successfully"
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add domain to Render: {str(e)}"
        )


#--------------------------------
# Add Domain CNAME to Namecheap (Super Admin Only)
#--------------------------------
@router.post("/add-domain-to-namecheap", response_model=SuccessResponse[dict])
async def add_domain_to_namecheap(
    request: AddDomainToNamecheapRequest,
    current_user: UserTokenInfo = Depends(get_current_user),
):
    """Create CNAME record in Namecheap for platform parent-domain subdomains."""
    assert_permission(current_user, PLATFORM_ORGANIZATIONS_WRITE)

    clean_domain = request.domain.strip().lower()
    if clean_domain.startswith("http://"):
        clean_domain = clean_domain[7:]
    if clean_domain.startswith("https://"):
        clean_domain = clean_domain[8:]
    if clean_domain.endswith("/"):
        clean_domain = clean_domain[:-1]
    if ":" in clean_domain:
        clean_domain = clean_domain.split(":")[0]

    from app.common.config import PLATFORM_DNS_PARENT_DOMAIN

    parent = (PLATFORM_DNS_PARENT_DOMAIN or "example.com").strip().lower()
    if not clean_domain.endswith(f".{parent}"):
        raise BadRequestError(f"Only *.{parent} domains are supported")

    try:
        from app.common.namecheap_helper import NamecheapHelper

        expected_target = get_platform_dns_cname_expected_target()
        result = await NamecheapHelper.ensure_cname_record(clean_domain, expected_target)
        return success_response(
            data=result,
            message=result.get("message", "Namecheap DNS operation completed"),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add domain to Namecheap: {str(e)}",
        )
