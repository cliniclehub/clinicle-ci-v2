"""Focused tests for EmailEngineService."""

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from app.v1.email_engine.model import EmailQueue
from app.v1.email_engine.services import EmailEngineService


def test_service_class_importable():
    assert EmailEngineService is not None


def test_service_has_send_email():
    assert hasattr(EmailEngineService, "send_email")


def test_service_has_queue_processing():
    assert hasattr(EmailEngineService, "process_email_queue")


def test_queued_email_keeps_template_data_as_json_object():
    db = MagicMock()
    service = EmailEngineService(db)
    service._prepare_template_variables = MagicMock(return_value={})
    service._get_organization_email_config = MagicMock(
        return_value={
            "from_name": "Test Organization",
            "from_email": "noreply@example.com",
            "reply_to": "support@example.com",
        }
    )
    service._resolve_reply_to = MagicMock(return_value="support@example.com")
    service._get_user_variables_for_email = MagicMock(
        return_value={"firstName": "Student"}
    )
    service.renderer.render_email = MagicMock(
        return_value={"subject": "Welcome", "bodyHtml": "<p>Welcome</p>"}
    )

    now = datetime.now(timezone.utc)

    def assign_database_values(queue_item):
        queue_item.id = 1
        queue_item.max_attempts = 3
        queue_item.created_at = now
        queue_item.updated_at = now

    db.add.side_effect = assign_database_values

    result = service._send_emails_via_queue(
        to_emails=["user@example.com"],
        template_data={"subject": "Welcome", "bodyHtml": "<p>Welcome</p>"},
        organization_id=uuid4(),
    )

    assert result[0].template_data == {"firstName": "Student"}
    queued_item = db.add.call_args.args[0]
    assert queued_item.template_data == {"firstName": "Student"}


def test_get_email_queue_normalizes_legacy_stringified_template_data():
    organization_id = uuid4()
    now = datetime.now(timezone.utc)
    queue_item = EmailQueue(
        id=1,
        organization_id=organization_id,
        to_emails=["user@example.com"],
        subject="Welcome",
        body_html="<p>Welcome</p>",
        from_email="sender@example.com",
        template_data=json.dumps({"firstName": "Student"}),
        status="pending",
        priority=5,
        attempts=0,
        max_attempts=3,
        created_at=now,
        updated_at=now,
    )
    query = MagicMock()
    query.count.return_value = 1
    query.order_by.return_value.offset.return_value.limit.return_value.all.return_value = [
        queue_item
    ]
    db = MagicMock()
    db.query.return_value.filter.return_value = query

    service = EmailEngineService(db)
    items, total = service.get_email_queue(str(organization_id))

    assert total == 1
    assert items[0].template_data == {"firstName": "Student"}
