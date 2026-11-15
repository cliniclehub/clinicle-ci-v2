"""Org admins cannot change super-admin-only organization flags."""

from uuid import uuid4

from app.v1.organizations.services import OrganizationService


def test_org_admin_cannot_change_is_active():
    org_id = uuid4()
    update_data = {
        "is_active": False,
        "enable_user_profile": True,
        "profile_field_settings": {"fields": {"gender": {"visible": True, "required": True}}},
    }

    OrganizationService._apply_org_admin_update_restrictions(
        update_data,
        org_id=org_id,
    )

    assert "is_active" not in update_data
    assert update_data["enable_user_profile"] is True
    assert update_data["profile_field_settings"]["fields"]["gender"]["visible"] is True
