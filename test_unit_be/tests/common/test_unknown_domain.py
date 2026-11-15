"""Unknown-tenant / unknown-domain log classification."""

import pytest

from app.common.business_exceptions import NotFoundError, ValidationError
from app.common.unknown_domain import (
    is_unknown_domain_not_found,
    is_unknown_domain_not_found_message,
)

pytestmark = pytest.mark.unit


def test_unknown_domain_message_matches_public_lookup_wording():
    assert is_unknown_domain_not_found_message("Domain 'spam.example' not found")
    assert is_unknown_domain_not_found_message('Domain "spam.example" not found')
    assert is_unknown_domain_not_found_message("Organization not found for domain")
    assert not is_unknown_domain_not_found_message("Organization not found")
    assert not is_unknown_domain_not_found_message("Course not found")
    assert not is_unknown_domain_not_found_message(None)


def test_unknown_domain_exception_is_not_found_only():
    assert is_unknown_domain_not_found(NotFoundError("Domain 'x' not found"))
    assert not is_unknown_domain_not_found(NotFoundError("Organization not found"))
    assert not is_unknown_domain_not_found(ValidationError("Domain 'x' not found"))
