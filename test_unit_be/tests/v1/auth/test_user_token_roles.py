"""UserTokenInfo role checks."""

from datetime import datetime
from uuid import uuid4

from app.v1.auth.schema import UserTokenInfo


def _token(roles):
    return UserTokenInfo(
        id=uuid4(),
        email="user@test.example",
        first_name="Test",
        last_name="User",
        organization_id=uuid4(),
        organization_name="Org",
        organization_domain="org.example",
        roles=roles,
        email_verified=True,
        must_change_password=False,
        locked=False,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


def test_has_role_exact_match():
    user = _token(["org_admin", "user"])
    assert user.has_role("org_admin") is True
    assert user.has_role("user") is True
    assert user.has_role("super_admin") is False


def test_has_any_role_partial_match():
    user = _token(["user"])
    assert user.has_any_role(["org_admin", "user"]) is True
    assert user.has_any_role(["org_admin", "super_admin"]) is False


def test_get_display_name():
    user = _token(["user"])
    assert user.get_display_name() == "Test User"
