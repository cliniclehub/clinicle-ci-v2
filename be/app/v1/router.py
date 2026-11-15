from fastapi import APIRouter

from .auth.auth_admin_routes import router as auth_admin_router
from .auth.auth_me_routes import router as auth_me_router
from .auth.auth_public_routes import router as auth_public_router
from .auth.oauth_routes import router as oauth_router
from .cron_jobs.routes import router as cron_jobs_router
from .debug.routes import router as debug_router
from .email_engine.routes import router as email_engine_router
from .email_templates.routes import router as email_templates_router
from .filters.routes import router as filters_router
from .media.routes import router as media_router
from .notifications.routes import router as notifications_router
from .organizations.routes import router as organizations_router
from .roles.routes import router as roles_router
from .users.users_me_routes import router as users_me_router
from .users.users_org_routes import router as users_org_router
from .users.users_platform_routes import router as users_platform_router

router = APIRouter(prefix="/v1")

router.include_router(auth_public_router)
router.include_router(auth_admin_router)
router.include_router(auth_me_router)
router.include_router(oauth_router)

router.include_router(organizations_router)

router.include_router(users_platform_router)
router.include_router(users_org_router)
router.include_router(users_me_router)
router.include_router(roles_router)

router.include_router(filters_router)
router.include_router(email_templates_router)
router.include_router(email_engine_router)
router.include_router(notifications_router)
router.include_router(media_router)
router.include_router(debug_router)
router.include_router(cron_jobs_router)
