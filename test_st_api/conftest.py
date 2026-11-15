from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import pytest
from sqlalchemy import create_engine, text


ROOT = Path(__file__).resolve().parents[1]
ST_UI_ENV_PATH = ROOT / "test_st_ui" / ".env"
API_ENV_PATH = ROOT / "test_st_api" / ".env"
BE_ENV_PATH = ROOT / "be" / "config" / ".env.local"

CAMEL_CASE_RE = re.compile(r"^[a-z][A-Za-z0-9]*$")
UUID_KEY_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
SQL_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        values[key.strip()] = value
    return values


ST_UI_ENV = _load_env_file(ST_UI_ENV_PATH)
API_ENV = _load_env_file(API_ENV_PATH)
BE_ENV = _load_env_file(BE_ENV_PATH)
STRICT_SKIP_REPORTS: list[str] = []


def _env(key: str, default: str | None = None) -> str | None:
    return (
        os.environ.get(key)
        or API_ENV.get(key)
        or ST_UI_ENV.get(key)
        or BE_ENV.get(key)
        or default
    )


def _env_any(*keys: str, default: str | None = None) -> str | None:
    """Prefer ST_*; accept E2E_* / legacy API_TEST_TENANT_B_* as migration fallbacks."""
    for key in keys:
        value = _env(key)
        if value:
            return value
    return default


def env_flag(key: str, default: bool = False) -> bool:
    value = _env(key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _domain_from_url(value: str | None, fallback: str = "testorg-a.clinicle-ci.local") -> str:
    if not value:
        return fallback
    parsed = urlparse(value)
    return parsed.hostname or fallback


@dataclass(frozen=True)
class ApiRole:
    slug: str
    email: str
    password: str
    org_domain: str


# (slug, email keys…, password keys…, optional base_url keys…)
ROLE_ENV_MAP: tuple[tuple[str, tuple[str, ...], tuple[str, ...], tuple[str, ...] | None], ...] = (
    (
        "user",
        ("ST_USER_EMAIL", "E2E_USER_EMAIL"),
        ("ST_USER_PASSWORD", "E2E_USER_PASSWORD"),
        None,
    ),
    (
        "user-2",
        ("ST_USER2_EMAIL", "E2E_USER2_EMAIL"),
        ("ST_USER2_PASSWORD", "E2E_USER2_PASSWORD"),
        None,
    ),
    (
        "user-3",
        ("ST_USER3_EMAIL", "E2E_USER3_EMAIL"),
        ("ST_USER3_PASSWORD", "E2E_USER3_PASSWORD"),
        None,
    ),
    (
        "org-admin",
        (
            "ST_ORG_ADMIN_EMAIL",
            "E2E_ORG_ADMIN_EMAIL",
            "ST_ADMIN_EMAIL",
            "E2E_ADMIN_EMAIL",
        ),
        (
            "ST_ORG_ADMIN_PASSWORD",
            "E2E_ORG_ADMIN_PASSWORD",
            "ST_ADMIN_PASSWORD",
            "E2E_ADMIN_PASSWORD",
        ),
        None,
    ),
    (
        "org-owner",
        ("ST_ORG_OWNER_EMAIL", "E2E_ORG_OWNER_EMAIL"),
        ("ST_ORG_OWNER_PASSWORD", "E2E_ORG_OWNER_PASSWORD"),
        None,
    ),
    (
        "super-admin",
        ("ST_SUPER_ADMIN_EMAIL", "E2E_SUPER_ADMIN_EMAIL"),
        ("ST_SUPER_ADMIN_PASSWORD", "E2E_SUPER_ADMIN_PASSWORD"),
        ("ST_SUPER_ADMIN_BASE_URL", "E2E_SUPER_ADMIN_BASE_URL"),
    ),
)


def configured_roles() -> list[ApiRole]:
    org_domain = _env("ORG_DOMAIN") or _domain_from_url(_env("PLAYWRIGHT_BASE_URL"))
    roles: list[ApiRole] = []
    for slug, email_keys, password_keys, base_url_keys in ROLE_ENV_MAP:
        email = _env_any(*email_keys)
        password = _env_any(*password_keys)
        if not email or not password:
            continue
        role_domain = org_domain
        if base_url_keys:
            role_domain = _domain_from_url(
                _env_any(*base_url_keys),
                fallback=org_domain,
            )
        roles.append(ApiRole(slug=slug, email=email, password=password, org_domain=role_domain))
    return roles


def pytest_generate_tests(metafunc):
    if "api_role" in metafunc.fixturenames:
        roles = configured_roles()
        metafunc.parametrize("api_role", roles, ids=[role.slug for role in roles])


def pytest_runtest_logreport(report):
    if env_flag("API_TEST_STRICT") and report.skipped:
        STRICT_SKIP_REPORTS.append(report.nodeid)


def pytest_sessionfinish(session, exitstatus):
    if env_flag("API_TEST_STRICT") and STRICT_SKIP_REPORTS:
        session.exitstatus = pytest.ExitCode.TESTS_FAILED


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        raw_body: bytes | str | None = None,
        content_type: str | None = None,
        token: str | None = None,
        org_domain: str | None = None,
        extra_headers: dict[str, str] | None = None,
        expected_status: int = 200,
    ) -> dict[str, Any]:
        if json_body is not None and raw_body is not None:
            raise ValueError("Provide either json_body or raw_body, not both")
        body = None
        headers = {"Accept": "application/json"}
        if extra_headers:
            headers.update(extra_headers)
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif raw_body is not None:
            body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
            headers["Content-Type"] = content_type or "application/octet-stream"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if org_domain:
            headers["X-Organization-Domain"] = org_domain

        request = Request(
            f"{self.base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=10) as response:
                response_body = response.read().decode("utf-8")
                status = response.status
        except HTTPError as exc:
            response_body = exc.read().decode("utf-8")
            status = exc.code
        except URLError as exc:
            message = f"API is not reachable at {self.base_url}: {exc.reason}"
            if env_flag("API_TEST_STRICT"):
                pytest.fail(message)
            pytest.skip(message)

        assert status == expected_status, (
            f"{method} {path} returned {status}, expected {expected_status}: {response_body}"
        )
        return json.loads(response_body) if response_body else {}

    def request_bytes(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        extra_headers: dict[str, str] | None = None,
        expected_status: int = 200,
        accept: str = "application/octet-stream",
    ) -> tuple[bytes, dict[str, str]]:
        """Send an HTTP request for a non-JSON response such as a CSV export."""
        headers = {"Accept": accept}
        if extra_headers:
            headers.update(extra_headers)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(f"{self.base_url}{path}", headers=headers, method=method)
        try:
            with urlopen(request, timeout=10) as response:
                response_body = response.read()
                response_headers = dict(response.headers.items())
                status = response.status
        except HTTPError as exc:
            response_body = exc.read()
            response_headers = dict(exc.headers.items())
            status = exc.code
        except URLError as exc:
            message = f"API is not reachable at {self.base_url}: {exc.reason}"
            if env_flag("API_TEST_STRICT"):
                pytest.fail(message)
            pytest.skip(message)

        assert status == expected_status, (
            f"{method} {path} returned {status}, expected {expected_status}: "
            f"{response_body.decode('utf-8', errors='replace')}"
        )
        return response_body, response_headers

    def login(self, role: ApiRole) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/v1/auth/login",
            json_body={
                "email": role.email,
                "password": role.password,
                "orgDomain": role.org_domain,
            },
        )

    def access_token(self, role: ApiRole) -> str:
        payload = self.login(role)
        assert_success_envelope(payload)
        token = payload["data"]["tokens"]["accessToken"]
        assert token
        return token


@pytest.fixture(scope="session")
def api_client() -> ApiClient:
    return ApiClient(_env("API_BASE_URL", "http://localhost:8000") or "http://localhost:8000")


@pytest.fixture(scope="session")
def org_domain() -> str:
    return _env("ORG_DOMAIN") or _domain_from_url(_env("PLAYWRIGHT_BASE_URL"))


@pytest.fixture(scope="session")
def org_admin_role() -> ApiRole:
    return role_by_slug("org-admin")


@pytest.fixture(scope="session")
def super_admin_role() -> ApiRole:
    return role_by_slug("super-admin")


@pytest.fixture(scope="session")
def user_role() -> ApiRole:
    return role_by_slug("user")


@pytest.fixture(scope="session")
def user_2_role() -> ApiRole:
    return role_by_slug("user-2")


@pytest.fixture(scope="session")
def user_3_role() -> ApiRole:
    """Disposable user used by mutation-heavy workflow tests."""
    return role_by_slug("user-3")


def _configured_tenant_b_role(slug: str, email_keys: tuple[str, ...], password_keys: tuple[str, ...]) -> ApiRole:
    domain = _env_any(
        "ST_TENANT_B_DOMAIN",
        "E2E_TENANT_B_DOMAIN",
        "API_TEST_TENANT_B_DOMAIN",
        default="testorg-b.clinicle-ci.local",
    )
    email = _env_any(*email_keys)
    password = _env_any(*password_keys)
    missing = []
    if not domain:
        missing.append("ST_TENANT_B_DOMAIN")
    if not email:
        missing.append(email_keys[0])
    if not password:
        missing.append(password_keys[0])
    if missing:
        message = f"Set {', '.join(missing)} to run Tenant A/B API isolation tests"
        if env_flag("API_TEST_STRICT"):
            pytest.fail(message)
        pytest.skip(message)
    return ApiRole(slug=slug, email=email, password=password, org_domain=domain)


@pytest.fixture(scope="session")
def tenant_b_org_admin_role() -> ApiRole:
    return _configured_tenant_b_role(
        "tenant-b-org-admin",
        (
            "ST_TENANT_B_ORG_ADMIN_EMAIL",
            "E2E_TENANT_B_ORG_ADMIN_EMAIL",
            "API_TEST_TENANT_B_ORG_ADMIN_EMAIL",
        ),
        (
            "ST_TENANT_B_ORG_ADMIN_PASSWORD",
            "E2E_TENANT_B_ORG_ADMIN_PASSWORD",
            "API_TEST_TENANT_B_ORG_ADMIN_PASSWORD",
        ),
    )


@pytest.fixture(scope="session")
def tenant_b_user_role() -> ApiRole:
    return _configured_tenant_b_role(
        "tenant-b-user",
        (
            "ST_TENANT_B_USER_EMAIL",
            "E2E_TENANT_B_USER_EMAIL",
            "API_TEST_TENANT_B_USER_EMAIL",
        ),
        (
            "ST_TENANT_B_USER_PASSWORD",
            "E2E_TENANT_B_USER_PASSWORD",
            "API_TEST_TENANT_B_USER_PASSWORD",
        ),
    )


def role_by_slug(slug: str) -> ApiRole:
    roles = {role.slug: role for role in configured_roles()}
    if slug not in roles:
        env_slug = slug.upper().replace("-", "_")
        message = f"Set ST_{env_slug}_EMAIL and ST_{env_slug}_PASSWORD in test_st_ui/.env"
        if env_flag("API_TEST_STRICT"):
            pytest.fail(message)
        pytest.skip(message)
    return roles[slug]

@pytest.fixture(scope="session")
def org_admin_token(api_client: ApiClient, org_admin_role: ApiRole) -> str:
    return api_client.access_token(org_admin_role)


@pytest.fixture(scope="session")
def tenant_b_org_admin_token(
    api_client: ApiClient,
    tenant_b_org_admin_role: ApiRole,
) -> str:
    return api_client.access_token(tenant_b_org_admin_role)


def api_db_schema() -> str:
    """Postgres schema for oracle SQL (local dump uses `ci`; some envs still use `app`)."""
    schema = (
        _env_any("ST_DATABASE_SCHEMA", "E2E_DATABASE_SCHEMA", "DB_SCHEMA", default="ci")
        or "ci"
    ).strip()
    if not SQL_IDENT_RE.fullmatch(schema):
        raise ValueError(f"Invalid DB schema name: {schema!r}")
    return schema


def db_table(table: str) -> str:
    """Qualify ``table`` with the configured API DB schema."""
    if not SQL_IDENT_RE.fullmatch(table):
        raise ValueError(f"Invalid table name: {table!r}")
    return f"{api_db_schema()}.{table}"


@pytest.fixture(scope="session")
def api_db_engine():
    database_url = (
        _env("API_TEST_DATABASE_URL")
        or _env("TEST_DATABASE_URL")
        or _env("DATABASE_URL")
    )
    if not database_url:
        message = "Set API_TEST_DATABASE_URL, TEST_DATABASE_URL, or DATABASE_URL to run DB-backed API tests"
        if env_flag("API_TEST_STRICT"):
            pytest.fail(message)
        pytest.skip(message)
    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        yield engine
    finally:
        engine.dispose()


def latest_email_verification_code(api_db_engine, user_id: str) -> str:
    with api_db_engine.connect() as conn:
        code = conn.execute(
            text(
                f"""
                SELECT code
                FROM {db_table('email_verification_codes')}
                WHERE user_id = :user_id
                  AND used = false
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                """
            ),
            {"user_id": user_id},
        ).scalar()
    assert code, f"No unused email verification code found for user {user_id}"
    return str(code)


def organization_id_for_domain(api_db_engine, org_domain: str) -> str:
    with api_db_engine.connect() as conn:
        org_id = conn.execute(
            text(
                f"""
                SELECT id
                FROM {db_table('organizations')}
                WHERE domain = :domain
                LIMIT 1
                """
            ),
            {"domain": org_domain},
        ).scalar()
    assert org_id, f"No organization found for domain {org_domain}"
    return str(org_id)


def tenant_resource_queries() -> dict[str, str]:
    return {
        "media_asset": (
            f"SELECT id FROM {db_table('media_assets')} "
            "WHERE organization_id = :organization_id "
            "ORDER BY created_at DESC LIMIT 1"
        ),
    }


def first_tenant_resource_id(api_db_engine, organization_id: str, resource: str) -> str:
    """Return a seeded tenant-owned ID or make the prerequisite explicit."""
    queries = tenant_resource_queries()
    if resource not in queries:
        raise ValueError(f"Unknown tenant resource type: {resource}")
    with api_db_engine.connect() as conn:
        resource_id = conn.execute(
            text(queries[resource]),
            {"organization_id": organization_id},
        ).scalar()
    if not resource_id:
        message = f"Seed Tenant A with at least one {resource} for isolation tests"
        if env_flag("API_TEST_STRICT"):
            pytest.fail(message)
        pytest.skip(message)
    return str(resource_id)


def user_id_for_email(api_db_engine, organization_id: str, email: str) -> str:
    with api_db_engine.connect() as conn:
        user_id = conn.execute(
            text(
                f"SELECT id FROM {db_table('users')} "
                "WHERE organization_id = :organization_id AND lower(email) = lower(:email) "
                "LIMIT 1"
            ),
            {"organization_id": organization_id, "email": email},
        ).scalar()
    if not user_id:
        message = f"Seed user {email} in organization {organization_id} for ownership tests"
        if env_flag("API_TEST_STRICT"):
            pytest.fail(message)
        pytest.skip(message)
    return str(user_id)


def assert_success_envelope(payload: dict[str, Any]) -> None:
    assert payload["status"] == "success"
    assert "message" in payload
    assert "timestamp" in payload


def assert_error_envelope(payload: dict[str, Any]) -> None:
    assert payload["status"] == "error"
    assert "message" in payload
    assert "timestamp" in payload


def assert_camel_case_response(payload: Any) -> None:
    violations = list(_find_non_camel_case_keys(payload))
    assert not violations, "Non-camelCase response keys found: " + ", ".join(violations[:25])


def _find_non_camel_case_keys(value: Any, path: str = "$") -> Iterable[str]:
    if isinstance(value, dict):
        for key, nested in value.items():
            key_path = f"{path}.{key}"
            if not CAMEL_CASE_RE.match(key) and not UUID_KEY_RE.match(key):
                yield key_path
            if key not in {"summary", "hostMetadata", "errorDetails"}:
                yield from _find_non_camel_case_keys(nested, key_path)
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            yield from _find_non_camel_case_keys(nested, f"{path}[{index}]")
