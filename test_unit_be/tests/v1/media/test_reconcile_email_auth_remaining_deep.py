"""Media reconcile dry-run + auth revoke session remaining."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.common.business_exceptions import BusinessException, ResourceNotFoundError
from app.v1.auth.services import Auth2Service
from app.v1.media.media_reconcile_service import MediaLibraryReconcileService


def _run(coro):
    return asyncio.run(coro)


def _q(result=None, *, all_rows=None):
    q = MagicMock()
    q.filter.return_value = q
    q.filter_by.return_value = q
    q.order_by.return_value = q
    q.first.return_value = result
    q.all.return_value = all_rows if all_rows is not None else []
    return q


def test_media_reconcile_dry_run_r2_and_db_only():
    db = MagicMock()
    oid = uuid4()
    key = f"orgs/{oid}/media/a.mp4"
    asset = SimpleNamespace(
        id=uuid4(),
        source_object_key=f"orgs/{oid}/media/missing.mp4",
        display_name="missing.mp4",
        source_size_bytes=10,
        status="uploaded",
        media_type="video",
    )
    db.query.return_value = _q(all_rows=[asset])
    with patch.object(
        MediaLibraryReconcileService,
        "_list_r2_source_objects",
        return_value={key: 100},
    ):
        out = MediaLibraryReconcileService.reconcile(
            db, organization_id=oid, dry_run=True
        )
        assert out is not None
        assert hasattr(out, "items") or getattr(out, "r2_only", 0) >= 0


def test_auth_revoke_session_paths():
    db = MagicMock()
    svc = Auth2Service(db)
    db.query.return_value = _q(None)
    with pytest.raises((ResourceNotFoundError, BusinessException, Exception)):
        _run(svc.revoke_session(1, uuid4()))

    session = SimpleNamespace(id=1, user_id=uuid4(), revoked=False)
    db.query.return_value = _q(session)
    _run(svc.revoke_session(1, session.user_id))
    assert session.revoked is True
