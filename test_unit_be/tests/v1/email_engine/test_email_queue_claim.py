"""Email queue durable claim coverage."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
import app.v1.email_engine.services as email_services
from app.v1.email_engine.model import EmailQueue
from app.v1.email_engine.services import EmailEngineService

pytestmark = pytest.mark.integration


def _queue_item(*, org_id, status="pending", updated_at=None):
    return EmailQueue(
        organization_id=org_id,
        to_emails=["user@example.com"],
        subject="Test",
        body_html="<p>Hi</p>",
        from_email="noreply@example.com",
        status=status,
        updated_at=updated_at or datetime.now(timezone.utc),
    )


def test_claim_next_email_queue_item_sets_processing(db_session):
    org_id = uuid4()
    item = _queue_item(org_id=org_id)
    db_session.add(item)
    db_session.commit()

    claimed = EmailEngineService.claim_next_email_queue_item(
        db_session,
        organization_id=org_id,
    )

    assert claimed is not None
    assert claimed.id == item.id
    assert claimed.status == "processing"


def test_claim_next_email_queue_item_reclaims_stale_processing(monkeypatch, db_session):
    monkeypatch.setattr(email_services, "EMAIL_QUEUE_PROCESSING_STALE_AFTER_SECONDS", 60)
    org_id = uuid4()
    item = _queue_item(
        org_id=org_id,
        status="processing",
        updated_at=datetime.now(timezone.utc) - timedelta(minutes=2),
    )
    db_session.add(item)
    db_session.commit()

    claimed = EmailEngineService.claim_next_email_queue_item(
        db_session,
        organization_id=org_id,
    )

    assert claimed is item
    assert claimed.status == "processing"
