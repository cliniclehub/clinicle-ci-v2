from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from app.common.app_logger import get_logger
from app.common.business_exceptions import NotFoundError
from app.common.config import NOTIFICATION_DISPATCH_PROCESSING_STALE_AFTER_SECONDS
from app.v1.email_engine.recipient_gate import (
    BLOCKED_PLACEHOLDER_EMAIL_REASON,
    is_non_deliverable_recipient_email,
)
from app.v1.email_engine.services import EmailEngineService
from app.v1.notifications.model import (
    NotificationDelivery,
    NotificationRuleDefinition,
    NotificationSchedule,
)
from app.v1.notifications.schema import (
    EffectiveNotificationRuleResponse,
    EffectiveNotificationSettingsResponse,
    NotificationDeliveryListResponse,
    NotificationDeliveryResponse,
    NotificationPreferences,
    NotificationRuleConfig,
    NotificationScheduleListResponse,
    NotificationScheduleResponse,
    NotificationSettings,
    settings_from_dict,
    settings_to_dict,
)
from app.v1.organizations.model import Organization
from app.v1.users.model import User

logger = get_logger(__name__)

# Transactional mail (e.g. registration-welcome) is sent by auth/email-template flows,
# not the notification engine. Keep DEFAULT_RULES empty until product features add
# business notification rules.
DEFAULT_RULES: tuple[dict[str, Any], ...] = ()

# Legacy rule keys that must stay inactive so they do not appear in org settings.
LEGACY_INACTIVE_RULE_KEYS: tuple[str, ...] = ("user-welcome",)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _rule_config_to_response(
    rule_key: str,
    config: dict[str, Any],
    inherited_from: str,
) -> EffectiveNotificationRuleResponse:
    return EffectiveNotificationRuleResponse(
        rule_key=rule_key,
        enabled=bool(config.get("enabled", True)),
        channels=list(config.get("channels") or ["email"]),
        offsets_minutes=list(config.get("offsets_minutes") or []),
        inherited_from=inherited_from,
    )


class NotificationConfigService:
    @staticmethod
    def ensure_default_rules(db: Session) -> None:
        for rule_data in DEFAULT_RULES:
            rule = db.get(NotificationRuleDefinition, rule_data["rule_key"])
            if not rule:
                db.add(NotificationRuleDefinition(**rule_data))
                continue
            for key, value in rule_data.items():
                setattr(rule, key, value)

        desired_keys = {rule_data["rule_key"] for rule_data in DEFAULT_RULES}
        for rule_key in LEGACY_INACTIVE_RULE_KEYS:
            if rule_key in desired_keys:
                continue
            rule = db.get(NotificationRuleDefinition, rule_key)
            if rule and rule.is_active:
                rule.is_active = False

    @staticmethod
    def list_rules(db: Session) -> list[NotificationRuleDefinition]:
        NotificationConfigService.ensure_default_rules(db)
        return (
            db.query(NotificationRuleDefinition)
            .filter(NotificationRuleDefinition.is_active.is_(True))
            .order_by(NotificationRuleDefinition.category.asc(), NotificationRuleDefinition.rule_key.asc())
            .all()
        )

    @staticmethod
    def get_organization(db: Session, organization_id: UUID) -> Organization:
        org = db.query(Organization).filter(Organization.id == organization_id).first()
        if not org:
            raise NotFoundError("Organization not found")
        return org

    @staticmethod
    def update_org_settings(
        db: Session,
        organization_id: UUID,
        settings: NotificationSettings,
    ) -> NotificationSettings:
        org = NotificationConfigService.get_organization(db, organization_id)
        org.notification_settings = settings_to_dict(settings)
        db.flush()
        return settings_from_dict(org.notification_settings)

    @staticmethod
    def _get_org_user(db: Session, user_id: UUID, organization_id: UUID) -> User:
        user = (
            db.query(User)
            .filter(User.id == user_id, User.organization_id == organization_id)
            .first()
        )
        if not user:
            raise NotFoundError("User not found")
        return user

    @staticmethod
    def get_user_preferences(db: Session, user_id: UUID, organization_id: UUID) -> NotificationPreferences:
        """Per-user overrides are not stored; every user gets the defaults."""
        NotificationConfigService._get_org_user(db, user_id, organization_id)
        return NotificationPreferences()

    @staticmethod
    def update_user_preferences(
        db: Session,
        user_id: UUID,
        organization_id: UUID,
        preferences: NotificationPreferences,
    ) -> NotificationPreferences:
        """No-op: there is nowhere to persist per-user overrides, so defaults stay in effect."""
        NotificationConfigService._get_org_user(db, user_id, organization_id)
        del preferences
        return NotificationPreferences()

    @staticmethod
    def resolve_rule_config(
        rule: NotificationRuleDefinition,
        organization: Optional[Organization],
    ) -> tuple[dict[str, Any], str]:
        config: dict[str, Any] = {
            "enabled": bool(rule.is_active),
            "channels": list(rule.default_channels or ["email"]),
            "offsets_minutes": list(rule.default_offsets_minutes or []),
        }
        inherited_from = "system"

        if organization:
            org_settings = settings_from_dict(organization.notification_settings)
            if not org_settings.enabled:
                config["enabled"] = False
                inherited_from = "organization"
            rule_override = org_settings.rules.get(rule.rule_key)
            if rule_override:
                config = NotificationConfigService._merge_rule_config(config, rule_override)
                if not org_settings.enabled:
                    config["enabled"] = False
                inherited_from = "organization"

        return config, inherited_from

    @staticmethod
    def _merge_rule_config(
        base: dict[str, Any],
        override: NotificationRuleConfig,
    ) -> dict[str, Any]:
        merged = dict(base)
        if override.enabled is not None:
            merged["enabled"] = override.enabled
        if override.channels is not None:
            merged["channels"] = list(override.channels)
        if override.offsets_minutes is not None:
            merged["offsets_minutes"] = list(override.offsets_minutes)
        return merged

    @staticmethod
    def effective_settings(
        db: Session,
        organization_id: UUID,
    ) -> EffectiveNotificationSettingsResponse:
        org = NotificationConfigService.get_organization(db, organization_id)
        rules = NotificationConfigService.list_rules(db)
        responses: list[EffectiveNotificationRuleResponse] = []
        for rule in rules:
            config, inherited_from = NotificationConfigService.resolve_rule_config(rule, org)
            responses.append(_rule_config_to_response(rule.rule_key, config, inherited_from))
        return EffectiveNotificationSettingsResponse(
            organization_id=organization_id,
            enabled=any(rule.enabled for rule in responses),
            rules=responses,
        )


class NotificationReportService:
    @staticmethod
    def list_schedules(
        db: Session,
        *,
        organization_id: Optional[UUID],
        status: Optional[str] = None,
        exclude_statuses: Optional[list[str]] = None,
        rule_key: Optional[str] = None,
        page: int = 1,
        page_size: int = 25,
    ) -> NotificationScheduleListResponse:
        query = db.query(NotificationSchedule).options(
            joinedload(NotificationSchedule.rule),
            joinedload(NotificationSchedule.user),
        )
        if organization_id:
            query = query.filter(NotificationSchedule.organization_id == organization_id)
        if status:
            query = query.filter(NotificationSchedule.status == status)
        elif exclude_statuses:
            query = query.filter(NotificationSchedule.status.notin_(exclude_statuses))
        if rule_key:
            query = query.filter(NotificationSchedule.rule_key == rule_key)

        total = query.with_entities(func.count(NotificationSchedule.id)).scalar() or 0
        schedules = (
            query.order_by(NotificationSchedule.fire_at.asc(), NotificationSchedule.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return NotificationScheduleListResponse(
            items=[NotificationReportService._schedule_response(schedule) for schedule in schedules],
            total=total,
            page=page,
            page_size=page_size,
        )

    @staticmethod
    def list_deliveries(
        db: Session,
        *,
        organization_id: Optional[UUID],
        status: Optional[str] = None,
        rule_key: Optional[str] = None,
        schedule_id: Optional[int] = None,
        user_id: Optional[UUID] = None,
        page: int = 1,
        page_size: int = 25,
    ) -> NotificationDeliveryListResponse:
        query = db.query(NotificationDelivery).options(
            joinedload(NotificationDelivery.rule),
            joinedload(NotificationDelivery.user),
            joinedload(NotificationDelivery.schedule),
        )
        if organization_id:
            query = query.filter(NotificationDelivery.organization_id == organization_id)
        if status:
            query = query.filter(NotificationDelivery.status == status)
        if rule_key:
            query = query.filter(NotificationDelivery.rule_key == rule_key)
        if schedule_id:
            query = query.filter(NotificationDelivery.schedule_id == schedule_id)
        if user_id:
            query = query.filter(NotificationDelivery.user_id == user_id)

        total = query.with_entities(func.count(NotificationDelivery.id)).scalar() or 0
        deliveries = (
            query.order_by(NotificationDelivery.fire_at.desc(), NotificationDelivery.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return NotificationDeliveryListResponse(
            items=[NotificationReportService._delivery_response(delivery) for delivery in deliveries],
            total=total,
            page=page,
            page_size=page_size,
        )

    @staticmethod
    def _schedule_response(schedule: NotificationSchedule) -> NotificationScheduleResponse:
        rule = schedule.rule
        return NotificationScheduleResponse(
            id=schedule.id,
            organization_id=schedule.organization_id,
            user_id=schedule.user_id,
            rule_key=schedule.rule_key,
            rule_display_name=getattr(rule, "display_name", None),
            fire_at=schedule.fire_at,
            event_at=schedule.event_at,
            source_type=schedule.source_type,
            source_id=schedule.source_id,
            status=schedule.status,
            schedule_metadata=schedule.schedule_metadata or {},
            dispatched_at=schedule.dispatched_at,
            created_at=schedule.created_at,
        )

    @staticmethod
    def _delivery_response(delivery: NotificationDelivery) -> NotificationDeliveryResponse:
        user = delivery.user
        rule = delivery.rule
        user_name = None
        if user:
            user_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip() or None
        return NotificationDeliveryResponse(
            id=delivery.id,
            organization_id=delivery.organization_id,
            user_id=delivery.user_id,
            user_name=user_name,
            user_email=getattr(user, "email", None),
            rule_key=delivery.rule_key,
            rule_display_name=getattr(rule, "display_name", None),
            channel=delivery.channel,
            source_type=delivery.source_type,
            source_id=delivery.source_id,
            schedule_id=delivery.schedule_id,
            fire_at=delivery.fire_at,
            delivered_at=delivery.delivered_at,
            status=delivery.status,
            error_message=delivery.error_message,
            delivery_metadata=delivery.delivery_metadata or {},
            created_at=delivery.created_at,
        )


class NotificationDispatchService:
    @staticmethod
    def _dispatch_processing_stale_cutoff(now: datetime) -> datetime:
        return now - timedelta(seconds=NOTIFICATION_DISPATCH_PROCESSING_STALE_AFTER_SECONDS)

    @staticmethod
    def claim_next_due_schedule(
        db: Session,
        *,
        organization_id: Optional[UUID] = None,
        now: Optional[datetime] = None,
    ) -> Optional[NotificationSchedule]:
        method_logger = logger.get_method_logger("claim_next_due_schedule")
        current_time = now or _utc_now()
        stale_cutoff = NotificationDispatchService._dispatch_processing_stale_cutoff(current_time)
        query = (
            db.query(NotificationSchedule)
            .options(
                joinedload(NotificationSchedule.rule),
                joinedload(NotificationSchedule.organization),
                joinedload(NotificationSchedule.user),
            )
            .filter(
                or_(
                    and_(
                        NotificationSchedule.status == "pending",
                        NotificationSchedule.fire_at <= current_time,
                    ),
                    and_(
                        NotificationSchedule.status == "processing",
                        NotificationSchedule.updated_at < stale_cutoff,
                    ),
                )
            )
        )
        if organization_id:
            query = query.filter(NotificationSchedule.organization_id == organization_id)
        schedule = (
            query.order_by(NotificationSchedule.fire_at.asc())
            .with_for_update(of=NotificationSchedule, skip_locked=True)
            .first()
        )
        if not schedule:
            return None
        if schedule.status == "processing":
            method_logger.warning(
                "Reclaiming stale notification schedule",
                extra={
                    "schedule_id": str(schedule.id),
                    "updated_at": schedule.updated_at.isoformat() if schedule.updated_at else None,
                    "stale_after_seconds": NOTIFICATION_DISPATCH_PROCESSING_STALE_AFTER_SECONDS,
                },
            )
        schedule.status = "processing"
        schedule.updated_at = current_time
        db.flush()
        return schedule

    @staticmethod
    async def dispatch_due(
        db: Session,
        *,
        organization_id: Optional[UUID] = None,
        now: Optional[datetime] = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        method_logger = logger.get_method_logger("dispatch_due")
        current_time = now or _utc_now()
        summary: dict[str, Any] = {
            "due_schedules": 0,
            "processed_schedules": 0,
            "sent": 0,
            "skipped": 0,
            "failed": 0,
            "errors": [],
        }

        while summary["processed_schedules"] < limit:
            schedule = NotificationDispatchService.claim_next_due_schedule(
                db,
                organization_id=organization_id,
                now=current_time,
            )
            if not schedule:
                break

            summary["due_schedules"] += 1
            db.commit()

            try:
                result = await NotificationDispatchService._dispatch_schedule(db, schedule)
                summary["processed_schedules"] += 1
                summary["sent"] += result["sent"]
                summary["skipped"] += result["skipped"]
                summary["failed"] += result["failed"]
            except Exception as exc:
                summary["failed"] += 1
                summary["errors"].append({"schedule_id": str(schedule.id), "error": str(exc)})
                schedule.status = "failed"
                schedule.updated_at = current_time
                method_logger.error(
                    "Notification schedule dispatch failed",
                    exc_info=True,
                    extra={"schedule_id": str(schedule.id), "rule_key": schedule.rule_key},
                )
            db.commit()

        return summary

    @staticmethod
    async def _dispatch_schedule(db: Session, schedule: NotificationSchedule) -> dict[str, int]:
        rule = schedule.rule
        user = schedule.user
        if not rule or not user or not user.email:
            schedule.status = "skipped"
            schedule.dispatched_at = _utc_now()
            return {"sent": 0, "skipped": 1, "failed": 0}

        config, _ = NotificationConfigService.resolve_rule_config(
            rule,
            schedule.organization,
        )
        if not config.get("enabled") or "email" not in config.get("channels", []):
            NotificationDispatchService._record_delivery(
                db,
                schedule,
                user_id=user.id,
                status="skipped",
                error_message="Notification disabled by preferences",
            )
            schedule.status = "skipped"
            schedule.dispatched_at = _utc_now()
            return {"sent": 0, "skipped": 1, "failed": 0}

        if not user.email_verified:
            NotificationDispatchService._record_delivery(
                db,
                schedule,
                user_id=user.id,
                status="skipped",
                error_message="Recipient email is missing or unverified",
            )
            schedule.status = "skipped"
            schedule.dispatched_at = _utc_now()
            return {"sent": 0, "skipped": 1, "failed": 0}

        service = EmailEngineService(db)
        try:
            send_result = service.send_email(
                to_emails=[user.email],
                template_key=rule.template_key,
                organization_id=schedule.organization_id,
                custom_variables=NotificationDispatchService._template_variables(schedule, user),
                priority=4,
            )
            result_rows = send_result.get("results") or []
            blocked = False
            for row in result_rows:
                success = row.get("success") or {}
                if isinstance(success, dict) and (
                    success.get("error_code") == "placeholder_recipient"
                    or (success.get("error_message") or "").startswith("Blocked:")
                ):
                    blocked = True
                    break
                if row.get("blocked"):
                    blocked = True
                    break
            if blocked or is_non_deliverable_recipient_email(user.email):
                NotificationDispatchService._record_delivery(
                    db,
                    schedule,
                    user_id=user.id,
                    status="skipped",
                    error_message=BLOCKED_PLACEHOLDER_EMAIL_REASON,
                )
                schedule.status = "skipped"
                schedule.dispatched_at = _utc_now()
                return {"sent": 0, "skipped": 1, "failed": 0}

            NotificationDispatchService._record_delivery(db, schedule, user_id=user.id, status="sent")
            schedule.status = "dispatched"
            schedule.dispatched_at = _utc_now()
            schedule.updated_at = _utc_now()
            return {"sent": 1, "skipped": 0, "failed": 0}
        except Exception as exc:
            NotificationDispatchService._record_delivery(
                db,
                schedule,
                user_id=user.id,
                status="failed",
                error_message=str(exc),
            )
            schedule.status = "failed"
            schedule.updated_at = _utc_now()
            return {"sent": 0, "skipped": 0, "failed": 1}

    @staticmethod
    def _record_delivery(
        db: Session,
        schedule: NotificationSchedule,
        *,
        user_id: UUID,
        status: str,
        error_message: Optional[str] = None,
    ) -> None:
        existing = (
            db.query(NotificationDelivery)
            .filter(
                NotificationDelivery.user_id == user_id,
                NotificationDelivery.rule_key == schedule.rule_key,
                NotificationDelivery.channel == "email",
                NotificationDelivery.source_type == schedule.source_type,
                NotificationDelivery.source_id == schedule.source_id,
                NotificationDelivery.fire_at == schedule.fire_at,
            )
            .first()
        )
        if existing:
            existing.status = status
            existing.error_message = error_message
            existing.delivered_at = _utc_now() if status == "sent" else existing.delivered_at
            return

        db.add(
            NotificationDelivery(
                organization_id=schedule.organization_id,
                user_id=user_id,
                rule_key=schedule.rule_key,
                channel="email",
                source_type=schedule.source_type,
                source_id=schedule.source_id,
                schedule_id=schedule.id,
                fire_at=schedule.fire_at,
                delivered_at=_utc_now() if status == "sent" else None,
                status=status,
                error_message=error_message,
            )
        )

    @staticmethod
    def _template_variables(schedule: NotificationSchedule, user: User) -> dict[str, Any]:
        metadata = dict(schedule.schedule_metadata or {})
        return {
            "firstName": user.first_name,
            "lastName": user.last_name,
            **metadata,
        }

    @staticmethod
    async def reconcile_upcoming(
        db: Session,
        *,
        organization_id: Optional[UUID] = None,
        horizon_days: int = 120,
    ) -> dict[str, Any]:
        """Expire stale pending schedules without querying product-specific resources."""
        del horizon_days
        now = _utc_now()
        query = db.query(NotificationSchedule).filter(
            NotificationSchedule.status == "pending",
            NotificationSchedule.fire_at < now,
        )
        if organization_id:
            query = query.filter(NotificationSchedule.organization_id == organization_id)
        expired = query.update(
            {"status": "expired", "updated_at": now},
            synchronize_session=False,
        )
        db.flush()
        return {
            "expired": int(expired or 0),
            "schedules_created": 0,
            "errors": [],
        }
