from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.api_response_schema import SuccessMessages, success_response
from app.common.auth_helper import UserTokenInfo, assert_permission, get_current_user
from app.common.business_exceptions import NotFoundError
from app.common.database_pool import get_db
from app.v1.auth.permissions import ORG_NOTIFICATIONS_MANAGE
from app.v1.notifications.schema import (
    NotificationPreferences,
    NotificationRuleDefinitionResponse,
    NotificationSettings,
)
from app.v1.notifications.services import (
    NotificationConfigService,
    NotificationDispatchService,
    NotificationReportService,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _require_org_id(current_user: UserTokenInfo) -> UUID:
    if not current_user.organization_id:
        raise NotFoundError("Organization not found in token")
    return current_user.organization_id


def _require_notification_admin(current_user: UserTokenInfo) -> UUID:
    assert_permission(current_user, ORG_NOTIFICATIONS_MANAGE)
    return _require_org_id(current_user)


def _notification_admin_scope(current_user: UserTokenInfo) -> UUID | None:
    assert_permission(current_user, ORG_NOTIFICATIONS_MANAGE)
    if current_user.has_any_role(["super_admin"]) and not current_user.organization_id:
        return None
    return _require_org_id(current_user)


@router.get("/rules")
async def list_notification_rules(
    _current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Rule vocabulary is readable by any authenticated user (preferences UI).
    rules = NotificationConfigService.list_rules(db)
    data = [
        NotificationRuleDefinitionResponse.model_validate(rule).model_dump(by_alias=True)
        for rule in rules
    ]
    return success_response(data=data, message=SuccessMessages.LISTED)


@router.get("/org-settings")
async def get_org_notification_settings(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = _require_notification_admin(current_user)
    org = NotificationConfigService.get_organization(db, org_id)
    settings = NotificationSettings.model_validate(org.notification_settings or {})
    return success_response(data=settings.model_dump(by_alias=True), message=SuccessMessages.RETRIEVED)


@router.patch("/org-settings")
async def update_org_notification_settings(
    body: NotificationSettings,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = _require_notification_admin(current_user)
    settings = NotificationConfigService.update_org_settings(db, org_id, body)
    db.commit()
    return success_response(data=settings.model_dump(by_alias=True), message=SuccessMessages.UPDATED)


@router.get("/effective-settings")
async def get_effective_notification_settings(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = _require_notification_admin(current_user)
    effective = NotificationConfigService.effective_settings(db, org_id)
    return success_response(data=effective.model_dump(by_alias=True), message=SuccessMessages.RETRIEVED)


@router.get("/schedules")
async def list_notification_schedules(
    status: str | None = Query(None),
    exclude_statuses: str | None = Query(None, alias="excludeStatuses"),
    rule_key: str | None = Query(None, alias="ruleKey"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100, alias="pageSize"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = _notification_admin_scope(current_user)
    excluded = (
        [item.strip() for item in exclude_statuses.split(",") if item.strip()]
        if exclude_statuses
        else None
    )
    schedules = NotificationReportService.list_schedules(
        db,
        organization_id=org_id,
        status=status,
        exclude_statuses=excluded,
        rule_key=rule_key,
        page=page,
        page_size=page_size,
    )
    return success_response(data=schedules.model_dump(by_alias=True), message=SuccessMessages.LISTED)


@router.get("/deliveries")
async def list_notification_deliveries(
    status: str | None = Query(None),
    rule_key: str | None = Query(None, alias="ruleKey"),
    schedule_id: int | None = Query(None, alias="scheduleId"),
    user_id: UUID | None = Query(None, alias="userId"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100, alias="pageSize"),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = _notification_admin_scope(current_user)
    deliveries = NotificationReportService.list_deliveries(
        db,
        organization_id=org_id,
        status=status,
        rule_key=rule_key,
        schedule_id=schedule_id,
        user_id=user_id,
        page=page,
        page_size=page_size,
    )
    return success_response(data=deliveries.model_dump(by_alias=True), message=SuccessMessages.LISTED)


@router.get("/preferences/me")
async def get_my_notification_preferences(
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = _require_org_id(current_user)
    preferences = NotificationConfigService.get_user_preferences(db, current_user.id, org_id)
    return success_response(data=preferences.model_dump(by_alias=True), message=SuccessMessages.RETRIEVED)


@router.patch("/preferences/me")
async def update_my_notification_preferences(
    body: NotificationPreferences,
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = _require_org_id(current_user)
    preferences = NotificationConfigService.update_user_preferences(db, current_user.id, org_id, body)
    db.commit()
    return success_response(data=preferences.model_dump(by_alias=True), message=SuccessMessages.UPDATED)


@router.post("/dispatch-due")
async def dispatch_due_notifications(
    limit: int = Query(100, ge=1, le=500),
    current_user: UserTokenInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_permission(current_user, ORG_NOTIFICATIONS_MANAGE)

    org_id = None if current_user.has_any_role(["super_admin"]) else _require_org_id(current_user)
    summary = await NotificationDispatchService.dispatch_due(db, organization_id=org_id, limit=limit)
    db.commit()
    return success_response(data=summary, message=SuccessMessages.PROCESSED)
