import os
from pathlib import Path


# Get the backend project root directory.
PROJECT_ROOT = Path(__file__).parent.parent.parent


# Load environment file based on ENVIRONMENT
def load_env_file():
    """
    Load the appropriate .env file from config folder.
    - If ENVIRONMENT is set, load config/.env.{ENVIRONMENT}
    - Otherwise, load config/.env.local (default)
    """
    from dotenv import load_dotenv
    
    env = os.getenv("ENVIRONMENT", "local")
    env_file = PROJECT_ROOT / "config" / f".env.{env}"
    
    if env_file.exists():
        load_dotenv(env_file)
        print(f"Loaded environment from: {env_file}")
    else:
        print(f"Warning: Environment file not found: {env_file}")

# Load environment file
load_env_file()

# Environment Configuration
# Values: local, integration, test, production
ENVIRONMENT = os.getenv("ENVIRONMENT", "local")
SERVICE_NAME = os.getenv("SERVICE_NAME", "platform-api")
DB_SCHEMA = os.getenv("DB_SCHEMA", "ci")


def _is_local_development_environment() -> bool:
    return (ENVIRONMENT or "local").lower() in ("local",)


def _env_bool(name: str, *, default_local: bool, default_non_local: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return default_local if _is_local_development_environment() else default_non_local
    return str(raw).strip().lower() == "true"

# When false, background asyncio schedulers are not started in the web service (use Render Cron instead).
ENABLE_INLINE_SCHEDULERS = os.getenv("ENABLE_INLINE_SCHEDULERS", "true").lower() == "true"

def get_platform_dns_cname_expected_target() -> str:
    """Hostname that org custom domains should CNAME to for this deployment."""
    explicit = (os.getenv("PLATFORM_DNS_CNAME_TARGET") or "").strip()
    if explicit:
        return explicit
    env = (ENVIRONMENT or "local").lower().strip()
    if env in ("production", "prod"):
        return os.getenv("PLATFORM_DNS_CNAME_TARGET_PROD", "app.example.com")
    if env in ("test", "tst", "testing"):
        return os.getenv("PLATFORM_DNS_CNAME_TARGET_TEST", "app.tst.example.com")
    if env in ("integration", "int", "staging"):
        return os.getenv("PLATFORM_DNS_CNAME_TARGET_INT", "app.int.example.com")
    return os.getenv("PLATFORM_DNS_CNAME_TARGET_LOCAL", "app.localhost")


# Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL")

# Pool Configuration
POOL_CLASS = os.getenv("POOL_CLASS", "QueuePool")
POOL_SIZE = int(os.getenv("POOL_SIZE", "5"))
MAX_OVERFLOW = int(os.getenv("MAX_OVERFLOW", "10"))
POOL_TIMEOUT = int(os.getenv("POOL_TIMEOUT", "30"))
POOL_RECYCLE = int(os.getenv("POOL_RECYCLE", "3600"))
POOL_PRE_PING = os.getenv("POOL_PRE_PING", "true").lower() == "true"
CONNECT_TIMEOUT=os.getenv("CONNECT_TIMEOUT", "10")


def _parse_int_env(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    if minimum is not None and value < minimum:
        return default
    if maximum is not None and value > maximum:
        return default
    return value


def _parse_seconds_env(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = (os.getenv(name) or "").strip().lower()
    for suffix in ("seconds", "second", "secs", "sec", "s"):
        if raw.endswith(suffix):
            raw = raw[: -len(suffix)].strip()
            break
    if raw:
        original = os.environ.get(name)
        os.environ[name] = raw
        try:
            return _parse_int_env(name, default, minimum=minimum, maximum=maximum)
        finally:
            if original is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = original
    return default


def _parse_statement_timeout_seconds() -> int:
    """
    Parse STATEMENT_TIMEOUT as seconds (supports optional s/sec suffix).

    PostgreSQL libpq expects statement_timeout in milliseconds; we store seconds here
    and convert when building connect options. Default is 300 seconds (5 minutes).
    """
    return _parse_seconds_env("STATEMENT_TIMEOUT", 300, minimum=1, maximum=86400)


STATEMENT_TIMEOUT_SECONDS = _parse_statement_timeout_seconds()
STATEMENT_TIMEOUT_MS = STATEMENT_TIMEOUT_SECONDS * 1000

ECHO = _env_bool("ECHO", default_local=True, default_non_local=False)
ECHO_POOL = _env_bool("ECHO_POOL", default_local=True, default_non_local=False)

# Logging Configuration (Console only - container-friendly)
LOG_LEVEL = os.getenv(
    "LOG_LEVEL",
    "DEBUG" if _is_local_development_environment() else "INFO",
)
LOG_HTTP_BODIES = _env_bool("LOG_HTTP_BODIES", default_local=True, default_non_local=False)
LOG_HTTP_HEADERS = _env_bool("LOG_HTTP_HEADERS", default_local=True, default_non_local=False)
# Use JSON format in containers/production, human-readable for local development
LOG_JSON = os.getenv("LOG_JSON", "false" if ENVIRONMENT == "local" else "true").lower() == "true"


def _parse_float_env(name: str, default: float, *, minimum: float | None = None, maximum: float | None = None) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    if minimum is not None and value < minimum:
        return default
    if maximum is not None and value > maximum:
        return default
    return value


# Auth2 Configuration
AUTH2_SECRET_KEY = os.getenv("AUTH2_SECRET_KEY")
AUTH2_ALGORITHM = os.getenv("AUTH2_ALGORITHM", "HS256")
AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("AUTH2_ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
AUTH2_REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("AUTH2_REFRESH_TOKEN_EXPIRE_DAYS", "7"))
AUTH2_EMAIL_VERIFICATION_EXPIRE_MINUTES = int(os.getenv("AUTH2_EMAIL_VERIFICATION_EXPIRE_MINUTES", "15"))
AUTH2_PASSWORD_RESET_EXPIRE_MINUTES = int(os.getenv("AUTH2_PASSWORD_RESET_EXPIRE_MINUTES", "15"))
AUTH2_MAX_LOGIN_ATTEMPTS = int(os.getenv("AUTH2_MAX_LOGIN_ATTEMPTS", "5"))
AUTH2_LOCKOUT_DURATION_MINUTES = int(os.getenv("AUTH2_LOCKOUT_DURATION_MINUTES", "15"))
AUTH2_PASSWORD_HISTORY_CHECK_DEPTH = int(os.getenv("AUTH2_PASSWORD_HISTORY_CHECK_DEPTH", "5"))
# Deprecated for media signing; use MEDIA_ACCESS_TOKEN_EXPIRE_MINUTES.
MEDIA_ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("MEDIA_ACCESS_TOKEN_EXPIRE_HOURS", "4"))
MEDIA_ACCESS_TOKEN_EXPIRE_MINUTES = _parse_int_env(
    "MEDIA_ACCESS_TOKEN_EXPIRE_MINUTES",
    25,
    minimum=1,
)
MEDIA_ACCESS_TOKEN_SECRET = os.getenv("MEDIA_ACCESS_TOKEN_SECRET") or AUTH2_SECRET_KEY
MEDIA_ACCESS_TOKEN_ALGORITHM = os.getenv("MEDIA_ACCESS_TOKEN_ALGORITHM", "HS256")
CRON_RUNNING_STALE_AFTER_SECONDS = _parse_seconds_env(
    "CRON_RUNNING_STALE_AFTER_SECONDS",
    1800,
    minimum=300,
    maximum=86400,
)
EMAIL_QUEUE_PROCESSING_STALE_AFTER_SECONDS = _parse_seconds_env(
    "EMAIL_QUEUE_PROCESSING_STALE_AFTER_SECONDS",
    900,
    minimum=60,
    maximum=86400,
)
NOTIFICATION_DISPATCH_PROCESSING_STALE_AFTER_SECONDS = _parse_seconds_env(
    "NOTIFICATION_DISPATCH_PROCESSING_STALE_AFTER_SECONDS",
    900,
    minimum=60,
    maximum=86400,
)
CRON_JOB_HISTORY_RETENTION_DAYS = _parse_int_env(
    "CRON_JOB_HISTORY_RETENTION_DAYS",
    30,
    minimum=0,
    maximum=3650,
)


# OAuth Configuration
# Google OAuth
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID")


def is_non_production_environment() -> bool:
    env = (ENVIRONMENT or "local").lower().strip()
    return env not in {"production", "prod"}

# Twilio Configuration for Phone Verification
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_VERIFY_SERVICE_SID = os.getenv("TWILIO_VERIFY_SERVICE_SID")

# Email Configuration
MAILERSEND_API_KEY = os.getenv("MAILERSEND_API_KEY")
# When false, emails are still rendered/queued/logged in DB but MailerSend is not called.
# Local/dev defaults to false to avoid burning quota; set EMAIL_DELIVERY_ENABLED=true to send.
EMAIL_DELIVERY_ENABLED = _env_bool(
    "EMAIL_DELIVERY_ENABLED",
    default_local=False,
    default_non_local=True,
)
DEFAULT_SYSTEM_FROM_EMAIL = os.getenv("DEFAULT_SYSTEM_FROM_EMAIL", "noreply@example.com")
DEFAULT_SENDER_FROM_EMAIL = os.getenv("DEFAULT_SENDER_FROM_EMAIL", "sender@example.com")
PLATFORM_DNS_PARENT_DOMAIN = (os.getenv("PLATFORM_DNS_PARENT_DOMAIN") or "example.com").strip().lower()


def is_email_delivery_enabled() -> bool:
    return EMAIL_DELIVERY_ENABLED

# Cloudflare R2 Configuration
CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")  # Private bucket
R2_PUBLIC_BUCKET_NAME = os.getenv("R2_PUBLIC_BUCKET_NAME")  # Public bucket
R2_MEDIA_SERVER_WORKER_URL = os.getenv("R2_MEDIA_SERVER_WORKER_URL")  # Private worker URL
R2_PUBLIC_MEDIA_SERVER_WORKER_URL = os.getenv("R2_PUBLIC_MEDIA_SERVER_WORKER_URL")  # Public worker URL

# Render Configuration
RENDER_API_KEY = os.getenv("RENDER_API_KEY")
# Target service for POST /v1/services/{id}/custom-domains (e.g. Next.js web service).
# Required on Render when this app runs on a different service than the one that serves org domains.
RENDER_CUSTOM_DOMAIN_SERVICE_ID = os.getenv("RENDER_CUSTOM_DOMAIN_SERVICE_ID")


def get_render_custom_domain_service_id():
    """
    Service ID for Render custom-domain API calls.
    """
    service_id = (RENDER_CUSTOM_DOMAIN_SERVICE_ID or "").strip()
    return service_id or None

# Namecheap DNS Configuration
NAMECHEAP_API_USER = os.getenv("NAMECHEAP_API_USER")
NAMECHEAP_API_KEY = os.getenv("NAMECHEAP_API_KEY")
NAMECHEAP_USERNAME = os.getenv("NAMECHEAP_USERNAME")
NAMECHEAP_CLIENT_IP = os.getenv("NAMECHEAP_CLIENT_IP")
NAMECHEAP_API_BASE_URL = os.getenv("NAMECHEAP_API_BASE_URL", "https://api.namecheap.com/xml.response")

def format_byte_size_label(num_bytes: int) -> str:
    """Human label for limits and errors (GiB if ≥ 1 GiB, else MiB)."""
    if num_bytes >= 1024**3:
        gib = num_bytes / (1024**3)
        if abs(gib - round(gib)) < 0.01:
            return f"{int(round(gib))} GiB"
        return f"{gib:.1f} GiB"
    mib = num_bytes / (1024**2)
    if abs(mib - round(mib)) < 0.01:
        return f"{int(round(mib))} MiB"
    return f"{mib:.1f} MiB"
