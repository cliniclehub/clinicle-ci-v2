from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import Field, field_validator

from app.common.base_schema import CamelModel


class NotificationRuleConfig(CamelModel):
    enabled: Optional[bool] = None
    channels: Optional[List[str]] = None
    offsets_minutes: Optional[List[int]] = None

    @field_validator("channels")
    @classmethod
    def validate_channels(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value
        allowed = {"email"}
        invalid = [channel for channel in value if channel not in allowed]
        if invalid:
            raise ValueError(f"Unsupported notification channel(s): {', '.join(invalid)}")
        return value

    @field_validator("offsets_minutes")
    @classmethod
    def validate_offsets(cls, value: Optional[List[int]]) -> Optional[List[int]]:
        if value is None:
            return value
        if len(value) == 0:
            raise ValueError("Minutes before is required.")
        for offset in value:
            if offset < 0:
                raise ValueError("Notification offsets must be greater than or equal to 0")
        return sorted(set(value), reverse=True)


class NotificationSettings(CamelModel):
    enabled: bool = True
    inherit_org_defaults: bool = True
    rules: Dict[str, NotificationRuleConfig] = Field(default_factory=dict)


class NotificationPreferences(CamelModel):
    email_enabled: bool = True


class NotificationRuleDefinitionResponse(CamelModel):
    rule_key: str
    display_name: str
    description: Optional[str] = None
    category: str
    default_channels: List[str]
    default_offsets_minutes: List[int]
    recipient_role: str
    is_time_based: bool
    template_key: str
    is_active: bool


class EffectiveNotificationRuleResponse(CamelModel):
    rule_key: str
    enabled: bool
    channels: List[str]
    offsets_minutes: List[int]
    inherited_from: str


class EffectiveNotificationSettingsResponse(CamelModel):
    organization_id: UUID
    enabled: bool
    rules: List[EffectiveNotificationRuleResponse]


class NotificationScheduleResponse(CamelModel):
    id: int
    organization_id: UUID
    user_id: Optional[UUID] = None
    rule_key: str
    rule_display_name: Optional[str] = None
    fire_at: datetime
    event_at: datetime
    source_type: str
    source_id: UUID
    status: str
    schedule_metadata: Dict[str, Any] = Field(default_factory=dict)
    dispatched_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class NotificationDeliveryResponse(CamelModel):
    id: int
    organization_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    rule_key: str
    rule_display_name: Optional[str] = None
    channel: str
    source_type: str
    source_id: UUID
    schedule_id: Optional[int] = None
    fire_at: datetime
    delivered_at: Optional[datetime] = None
    status: str
    error_message: Optional[str] = None
    delivery_metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None


class NotificationScheduleListResponse(CamelModel):
    items: List[NotificationScheduleResponse]
    total: int
    page: int
    page_size: int


class NotificationDeliveryListResponse(CamelModel):
    items: List[NotificationDeliveryResponse]
    total: int
    page: int
    page_size: int


class NotificationDispatchResponse(CamelModel):
    due_schedules: int
    processed_schedules: int
    sent: int
    skipped: int
    failed: int
    errors: List[Dict[str, Any]] = Field(default_factory=list)


def settings_to_dict(settings: NotificationSettings) -> Dict[str, Any]:
    return settings.model_dump(by_alias=True, exclude_none=True)


def settings_from_dict(value: Optional[Dict[str, Any]]) -> NotificationSettings:
    if not value:
        return NotificationSettings()
    return NotificationSettings.model_validate(value)
