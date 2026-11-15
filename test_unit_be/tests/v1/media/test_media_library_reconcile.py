"""Unit tests for MediaLibraryReconcileService."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.v1.media import media_reconcile_service as reconcile_module
from app.v1.media.media_reconcile_service import MediaLibraryReconcileService


pytestmark = pytest.mark.unit


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return list(self._rows)


class _FakeDb:
    def __init__(self, assets=None):
        self._assets = assets or []

    def query(self, model):
        return _FakeQuery(self._assets)


def test_is_source_media_key_skips_thumbs_and_folders():
    org_id = uuid4()
    prefix = f"orgs/{org_id}/media"
    assert MediaLibraryReconcileService._is_source_media_key(
        f"{prefix}/video.mp4", organization_id=org_id
    )
    assert not MediaLibraryReconcileService._is_source_media_key(
        f"{prefix}/video_thumb.jpg", organization_id=org_id
    )
    assert not MediaLibraryReconcileService._is_source_media_key(
        f"{prefix}/", organization_id=org_id
    )
    assert not MediaLibraryReconcileService._is_source_media_key(
        f"orgs/{org_id}/media-hls/{uuid4()}/seg.ts", organization_id=org_id
    )


def test_reconcile_dry_run_classifies_r2_only_size_and_db_only(monkeypatch):
    org_id = uuid4()
    matched_key = f"orgs/{org_id}/media/ok.mp4"
    r2_only_key = f"orgs/{org_id}/media/missing-row.mp4"
    size_key = f"orgs/{org_id}/media/bad-size.mp4"
    db_only_key = f"orgs/{org_id}/media/gone.mp4"
    thumb_key = f"orgs/{org_id}/media/photo_thumb.jpg"

    matched = SimpleNamespace(
        id=uuid4(),
        source_object_key=matched_key,
        display_name="ok.mp4",
        source_size_bytes=100,
        source_mime_type="video/mp4",
    )
    size_asset = SimpleNamespace(
        id=uuid4(),
        source_object_key=size_key,
        display_name="bad-size.mp4",
        source_size_bytes=None,
        source_mime_type="video/mp4",
    )
    db_only = SimpleNamespace(
        id=uuid4(),
        source_object_key=db_only_key,
        display_name="gone.mp4",
        source_size_bytes=50,
        source_mime_type="video/mp4",
    )
    db = _FakeDb(assets=[matched, size_asset, db_only])

    monkeypatch.setattr(
        MediaLibraryReconcileService,
        "_list_r2_source_objects",
        lambda organization_id: {
            matched_key: 100,
            r2_only_key: 200,
            size_key: 300,
            thumb_key: 10,  # filtered inside list helper normally; include to ensure classify path
        },
    )
    # Override list to apply thumb filter like production helper
    def fake_list(organization_id):
        raw = {
            matched_key: 100,
            r2_only_key: 200,
            size_key: 300,
            thumb_key: 10,
        }
        return {
            k: v
            for k, v in raw.items()
            if MediaLibraryReconcileService._is_source_media_key(k, organization_id=organization_id)
        }

    monkeypatch.setattr(MediaLibraryReconcileService, "_list_r2_source_objects", fake_list)

    result = MediaLibraryReconcileService.reconcile(
        db, organization_id=org_id, dry_run=True
    )

    assert result.dry_run is True
    assert result.r2_scanned == 3
    assert result.db_scanned == 3
    assert result.matched == 1
    assert result.r2_only == 1
    assert result.size_refresh == 1
    assert result.db_only == 1
    assert result.created == 0
    assert result.updated == 0

    actions = {item.action for item in result.items}
    assert "wouldCreate" in actions
    assert "wouldRefreshSize" in actions
    assert "missingInR2" in actions
    assert all(item.object_key != thumb_key for item in result.items)


def test_reconcile_apply_creates_and_refreshes(monkeypatch):
    org_id = uuid4()
    r2_only_key = f"orgs/{org_id}/media/new.mp4"
    size_key = f"orgs/{org_id}/media/size.mp4"
    size_asset = SimpleNamespace(
        id=uuid4(),
        source_object_key=size_key,
        display_name="size.mp4",
        source_size_bytes=None,
        source_mime_type=None,
    )
    db = _FakeDb(assets=[size_asset])

    monkeypatch.setattr(
        MediaLibraryReconcileService,
        "_list_r2_source_objects",
        lambda organization_id: {r2_only_key: 111, size_key: 222},
    )
    monkeypatch.setattr(
        MediaLibraryReconcileService,
        "_head_metadata",
        lambda key: ("video/mp4", 111 if key == r2_only_key else 222, None),
    )

    created_keys = []
    refreshed_sizes = []

    def fake_create_or_get(
        _db,
        *,
        organization_id,
        source_object_key,
        media_type=None,
        source_mime_type=None,
        source_size_bytes=None,
        created_by=None,
    ):
        if source_object_key == r2_only_key:
            created_keys.append(source_object_key)
            return SimpleNamespace(
                id=uuid4(),
                source_object_key=source_object_key,
                display_name="new.mp4",
                source_size_bytes=source_size_bytes,
            )
        refreshed_sizes.append(source_size_bytes)
        size_asset.source_size_bytes = source_size_bytes
        size_asset.source_mime_type = source_mime_type
        return size_asset

    monkeypatch.setattr(
        reconcile_module.MediaAssetService,
        "create_or_get_asset_for_source",
        staticmethod(fake_create_or_get),
    )

    result = MediaLibraryReconcileService.reconcile(
        db, organization_id=org_id, dry_run=False, created_by=uuid4()
    )

    assert result.dry_run is False
    assert result.created == 1
    assert result.updated == 1
    assert result.errors == 0
    assert created_keys == [r2_only_key]
    assert refreshed_sizes == [222]
    actions = {item.action for item in result.items}
    assert "created" in actions
    assert "updated" in actions


def test_reconcile_apply_does_not_delete_db_only(monkeypatch):
    org_id = uuid4()
    db_only_key = f"orgs/{org_id}/media/orphan.mp4"
    asset = SimpleNamespace(
        id=uuid4(),
        source_object_key=db_only_key,
        display_name="orphan.mp4",
        source_size_bytes=9,
        source_mime_type="video/mp4",
    )
    db = _FakeDb(assets=[asset])
    monkeypatch.setattr(
        MediaLibraryReconcileService,
        "_list_r2_source_objects",
        lambda organization_id: {},
    )
    create_calls = []
    monkeypatch.setattr(
        reconcile_module.MediaAssetService,
        "create_or_get_asset_for_source",
        staticmethod(lambda *a, **k: create_calls.append(k) or asset),
    )

    result = MediaLibraryReconcileService.reconcile(
        db, organization_id=org_id, dry_run=False
    )

    assert result.db_only == 1
    assert result.created == 0
    assert result.updated == 0
    assert create_calls == []
    assert result.items[0].action == "missingInR2"
