"""
Central registry for all SQLAlchemy models.
Import this module to ensure all models are registered with SQLAlchemy.
"""

from app.v1.auth.model import (
    EmailVerificationCode,
    LoginAttempt,
    PasswordHistory,
    PasswordResetCode,
    PhoneVerificationRecord,
    RefreshToken,
    UserOAuthIdentity,
)
from app.v1.cron_jobs.model import CronJobRun, CronJobSetting
from app.v1.email_engine.model import EmailLog, EmailQueue
from app.v1.email_templates.model import EmailTemplate
from app.v1.filters.model import SavedFilter
from app.v1.media.media_asset_model import MediaAsset
from app.v1.notifications.model import (
    NotificationDelivery,
    NotificationRuleDefinition,
    NotificationSchedule,
)
from app.v1.organizations.model import Organization
from app.v1.roles.model import Role, UserRole, Permission, RolePermission
from app.v1.users.model import User

__all__ = [
    "Organization",
    "User",
    "Role",
    "UserRole",
    "Permission",
    "RolePermission",
    "UserOAuthIdentity",
    "EmailVerificationCode",
    "PasswordResetCode",
    "RefreshToken",
    "PasswordHistory",
    "LoginAttempt",
    "PhoneVerificationRecord",
    "SavedFilter",
    "EmailQueue",
    "EmailLog",
    "EmailTemplate",
    "CronJobRun",
    "CronJobSetting",
    "NotificationRuleDefinition",
    "NotificationSchedule",
    "NotificationDelivery",
    "MediaAsset",
]
