"""SavedFilterService validation and mocked CRUD coverage."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.common.business_exceptions import BadRequestError, NotFoundError
from app.v1.filters.schema import SavedFilterCreate, SavedFilterUpdate
from app.v1.filters.services import SavedFilterService


def _valid_config():
    return {
        "groupLogic": "AND",
        "groups": [
            {
                "logic": "AND",
                "conditions": [
                    {"field": "email", "operator": "contains", "value": "@"},
                ],
            }
        ],
    }


def _q(result=None, *, all_rows=None, count=0):
    q = MagicMock()
    q.filter.return_value = q
    q.order_by.return_value = q
    q.first.return_value = result
    q.all.return_value = all_rows if all_rows is not None else []
    q.count.return_value = count
    q.delete.return_value = 1
    return q


def test_validate_filter_structure():
    assert SavedFilterService._validate_filter_structure(_valid_config()) is True
    assert SavedFilterService._validate_filter_structure("nope") is False
    assert SavedFilterService._validate_filter_structure({}) is False
    assert SavedFilterService._validate_filter_structure({"groups": [], "groupLogic": "XOR"}) is False
    bad = _valid_config()
    bad["groups"][0]["conditions"][0] = {"field": "x"}
    assert SavedFilterService._validate_filter_structure(bad) is False
    assert SavedFilterService._validate_filter_structure({"groups": "x", "groupLogic": "AND"}) is False


def test_create_and_list_update_delete_saved_filters():
    async def _run():
        db = MagicMock()
        user_id = uuid4()
        org_id = uuid4()
        payload = SavedFilterCreate(
            name="Mine",
            page_type="users",
            filter_config=_valid_config(),
            is_default=False,
        )

        # Invalid structure path (bypass pydantic with monkeypatched validator already passed)
        with patch.object(SavedFilterService, "_validate_filter_structure", return_value=False):
            with pytest.raises(BadRequestError):
                await SavedFilterService.create_saved_filter(db, user_id, org_id, payload)

        db.query.return_value = _q(SimpleNamespace(id=1))
        with patch.object(SavedFilterService, "_validate_filter_structure", return_value=True):
            with pytest.raises(BadRequestError, match="already exists"):
                await SavedFilterService.create_saved_filter(db, user_id, org_id, payload)

        row = SimpleNamespace(
            id=7,
            user_id=user_id,
            organization_id=org_id,
            name="Mine",
            page_type="users",
            filter_config=_valid_config(),
            is_default=False,
            description=None,
            created_at=None,
            updated_at=None,
        )
        db.query.return_value = _q(None, all_rows=[row])
        db.add = MagicMock()
        db.commit = MagicMock()
        db.refresh = MagicMock()
        with patch.object(SavedFilterService, "_validate_filter_structure", return_value=True), patch(
            "app.v1.filters.services.SavedFilterModel", return_value=row
        ), patch(
            "app.v1.filters.services.SavedFilterResponse.from_orm",
            side_effect=lambda o: SimpleNamespace(id=o.id, name=o.name),
        ):
            created = await SavedFilterService.create_saved_filter(db, user_id, org_id, payload)
            assert created.name == "Mine"

            listed = await SavedFilterService.get_user_saved_filters(
                db, user_id, org_id, page_type="users"
            )
            assert len(listed) == 1

            db.query.return_value = _q(row)
            got = await SavedFilterService.get_saved_filter_by_id(db, 7, user_id, org_id)
            assert got.id == 7

            # update: first() returns filter, name-clash first() returns None
            q_upd = _q(row)
            q_upd.first.side_effect = [row, None]
            db.query.return_value = q_upd
            updated = await SavedFilterService.update_saved_filter(
                db, 7, user_id, org_id, SavedFilterUpdate(name="Renamed")
            )
            assert row.name == "Renamed"
            assert updated is not None

            db.query.return_value = _q(row)
            await SavedFilterService.delete_saved_filter(db, 7, user_id, org_id)

            db.query.return_value = _q(None)
            with pytest.raises(NotFoundError):
                await SavedFilterService.get_saved_filter_by_id(db, 99, user_id, org_id)

    asyncio.run(_run())
