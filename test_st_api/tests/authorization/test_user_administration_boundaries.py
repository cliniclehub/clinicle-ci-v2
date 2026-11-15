from __future__ import annotations

import pytest

from conftest import (
    ApiClient,
    ApiRole,
    assert_camel_case_response,
    assert_error_envelope,
    role_by_slug,
)


pytestmark = pytest.mark.api
RESOURCE_ID = "00000000-0000-0000-0000-000000000001"


ORG_USER_ADMIN_ROUTES = [
    ("GET", "/api/v1/users/org"),
    ("GET", f"/api/v1/users/org/{RESOURCE_ID}"),
    ("PUT", f"/api/v1/users/org/{RESOURCE_ID}"),
    ("DELETE", f"/api/v1/users/org/{RESOURCE_ID}"),
    ("POST", f"/api/v1/users/org/{RESOURCE_ID}/change-password"),
    ("GET", "/api/v1/users/statistics"),
]


PLATFORM_USER_ADMIN_ROUTES = [
    ("GET", "/api/v1/users/platform"),
    ("GET", f"/api/v1/users/platform/{RESOURCE_ID}"),
    ("PUT", f"/api/v1/users/platform/{RESOURCE_ID}"),
    ("DELETE", f"/api/v1/users/platform/{RESOURCE_ID}"),
    ("POST", f"/api/v1/users/platform/{RESOURCE_ID}/change-password"),
]


def _body_for(method: str, path: str) -> dict | None:
    if method == "PUT":
        return {"firstName": "Unauthorized"}
    if path.endswith("change-password"):
        return {"newPassword": "MustNotBeApplied123!"}
    return None


@pytest.mark.parametrize("role_fixture", ["user_role", "super_admin_role"])
@pytest.mark.parametrize(("method", "path"), ORG_USER_ADMIN_ROUTES)
def test_user_and_platform_admin_cannot_use_org_user_administration(
    request: pytest.FixtureRequest,
    api_client: ApiClient,
    role_fixture: str,
    method: str,
    path: str,
):
    role: ApiRole = request.getfixturevalue(role_fixture)
    body = _body_for(method, path)
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(role),
        json_body=body,
        expected_status=403,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize("role_slug", ["org-admin", "user"])
@pytest.mark.parametrize(("method", "path"), PLATFORM_USER_ADMIN_ROUTES)
def test_org_roles_cannot_use_platform_user_administration(
    api_client: ApiClient,
    role_slug: str,
    method: str,
    path: str,
):
    role = role_by_slug(role_slug)
    body = _body_for(method, path)
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(role),
        json_body=body,
        expected_status=403,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)


@pytest.mark.parametrize(
    ("role_slug", "path"),
    [
        ("org-admin", "/api/v1/users/org/not-a-uuid"),
        ("super-admin", "/api/v1/users/platform/not-a-uuid"),
    ],
)
@pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
def test_user_administration_rejects_malformed_user_identifiers(
    api_client: ApiClient,
    role_slug: str,
    path: str,
    method: str,
):
    payload = api_client.request(
        method,
        path,
        token=api_client.access_token(role_by_slug(role_slug)),
        json_body={"firstName": "Never Applied"} if method == "PUT" else None,
        expected_status=422,
    )
    assert_error_envelope(payload)
    assert_camel_case_response(payload)
