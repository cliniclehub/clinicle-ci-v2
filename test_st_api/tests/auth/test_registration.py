from __future__ import annotations

from datetime import datetime, timezone

import pytest

from conftest import (
    ApiClient,
    assert_camel_case_response,
    assert_error_envelope,
    assert_success_envelope,
    latest_email_verification_code,
)


pytestmark = pytest.mark.api


def test_register_creates_unverified_user(
    api_client: ApiClient,
    org_domain: str,
):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    email = f"api-test-register-{stamp}@example.com"

    payload = api_client.request(
        "POST",
        "/api/v1/auth/register",
        json_body={
            "email": email,
            "password": "ApiTest123!",
            "firstName": "Api",
            "lastName": "Tester",
            "orgDomain": org_domain,
        },
        expected_status=200,
    )

    assert_success_envelope(payload)
    assert payload["data"]["email"] == email
    assert payload["data"]["userId"]
    assert payload["data"]["requiresVerification"] is True
    assert_camel_case_response(payload)


def test_verify_email_rejects_bad_code_then_accepts_generated_code(
    api_client: ApiClient,
    org_domain: str,
    api_db_engine,
):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    email = f"api-test-verify-{stamp}@example.com"

    register_payload = api_client.request(
        "POST",
        "/api/v1/auth/register",
        json_body={
            "email": email,
            "password": "ApiTest123!",
            "firstName": "Api",
            "lastName": "Verifier",
            "orgDomain": org_domain,
        },
    )
    assert_success_envelope(register_payload)
    user_id = register_payload["data"]["userId"]
    good_code = latest_email_verification_code(api_db_engine, user_id)
    bad_code = "000000" if good_code != "000000" else "000001"

    bad_payload = api_client.request(
        "POST",
        "/api/v1/auth/verify-email",
        json_body={
            "email": email,
            "code": bad_code,
            "orgDomain": org_domain,
        },
        expected_status=422,
    )
    assert_error_envelope(bad_payload)
    assert_camel_case_response(bad_payload)

    good_payload = api_client.request(
        "POST",
        "/api/v1/auth/verify-email",
        json_body={
            "email": email,
            "code": good_code,
            "orgDomain": org_domain,
        },
    )

    assert_success_envelope(good_payload)
    assert good_payload["data"]["verified"] is True
    assert_camel_case_response(good_payload)
