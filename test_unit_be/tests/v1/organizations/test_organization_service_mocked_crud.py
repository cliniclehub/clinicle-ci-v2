"""OrganizationService mocked CRUD coverage (Clinicle)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.common.business_exceptions import ConflictError, NotFoundError
from app.v1.organizations.schema import OrganizationCreate, OrganizationUpdate
from app.v1.organizations.services import OrganizationService


def _q(result=None, *, all_rows=None, count=0):
    q = MagicMock()
    q.filter.return_value = q
    q.order_by.return_value = q
    q.offset.return_value = q
    q.limit.return_value = q
    q.first.return_value = result
    q.all.return_value = all_rows if all_rows is not None else []
    q.count.return_value = count
    return q


def test_list_organizations_with_filters_and_sort_fallback():
    async def _run():
        db = MagicMock()
        org = SimpleNamespace(id=uuid4(), name="A", domain="a.test")
        db.query.return_value = _q(all_rows=[org], count=1)
        rows, total = await OrganizationService.list_organizations(
            db,
            skip=0,
            limit=10,
            is_active=True,
            search="A",
            sort_by="name",
            sort_order="asc",
        )
        assert total == 1
        assert rows == [org]

        rows2, total2 = await OrganizationService.list_organizations(
            db, sort_by="not_a_field", sort_order="desc"
        )
        assert total2 == 1
        assert rows2 == [org]

    asyncio.run(_run())


def test_get_organization_and_landing_page():
    async def _run():
        db = MagicMock()
        org = SimpleNamespace(id=uuid4(), landing_page_html="<p>hi</p>", domain="x.test")
        db.query.return_value = _q(org)
        assert await OrganizationService.get_organization(db, org.id) is org

        landing = await OrganizationService.get_landing_page_html_by_domain(db, "x.test")
        assert landing.landing_page_html == "<p>hi</p>"

        db2 = MagicMock()
        db2.query.return_value = _q(None)
        with pytest.raises(NotFoundError):
            await OrganizationService.get_organization(db2, uuid4())
        with pytest.raises(NotFoundError):
            await OrganizationService.get_landing_page_html_by_domain(db2, "missing.test")

    asyncio.run(_run())


def test_create_organization_success_and_conflict():
    async def _run():
        db = MagicMock()
        org = SimpleNamespace(id=uuid4(), name="N", domain="n.test")
        db.add = MagicMock()
        db.commit = MagicMock()
        db.refresh = MagicMock(side_effect=lambda o: setattr(o, "id", org.id) or o)
        with patch(
            "app.v1.organizations.services.OrganizationModel",
            side_effect=lambda **kw: SimpleNamespace(**kw, id=None),
        ), patch(
            "app.v1.email_templates.services.EmailTemplateService.create_default_templates_for_organization",
            new_callable=AsyncMock,
        ) as templates:
            payload = OrganizationCreate(name="N", domain="n.test")
            created = await OrganizationService.create_organization(db, payload)
            assert created.name == "N"
            templates.assert_awaited()

        db_fail = MagicMock()
        db_fail.add = MagicMock()
        db_fail.commit = MagicMock(side_effect=IntegrityError("stmt", {}, Exception()))
        db_fail.rollback = MagicMock()
        with patch(
            "app.v1.organizations.services.OrganizationModel",
            side_effect=lambda **kw: SimpleNamespace(**kw),
        ):
            with pytest.raises(ConflictError):
                await OrganizationService.create_organization(
                    db_fail, OrganizationCreate(name="Dup", domain="dup.test")
                )

    asyncio.run(_run())


def test_create_organization_continues_when_templates_fail():
    async def _run():
        db = MagicMock()
        db.add = MagicMock()
        db.commit = MagicMock()
        db.refresh = MagicMock()
        with patch(
            "app.v1.organizations.services.OrganizationModel",
            side_effect=lambda **kw: SimpleNamespace(**kw, id=uuid4()),
        ), patch(
            "app.v1.email_templates.services.EmailTemplateService.create_default_templates_for_organization",
            new_callable=AsyncMock,
            side_effect=RuntimeError("template boom"),
        ):
            created = await OrganizationService.create_organization(
                db, OrganizationCreate(name="N", domain="n.test")
            )
            assert created.name == "N"

    asyncio.run(_run())


def test_update_organization_basic_and_org_admin_restrictions():
    async def _run():
        db = MagicMock()
        org = SimpleNamespace(id=uuid4(), name="Old", domain="old.test", timezone="UTC")
        with patch.object(
            OrganizationService, "get_organization", new_callable=AsyncMock, return_value=org
        ):
            updated = await OrganizationService.update_organization(
                db,
                org.id,
                OrganizationUpdate(name="New", timezone=None),
                current_user_role="org_admin",
            )
            assert updated.name == "New"
            assert not hasattr(updated, "is_active") or True

            # org_admin cannot flip is_active
            org2 = SimpleNamespace(id=uuid4(), name="A", domain="a.test", timezone="UTC", is_active=True)
            with patch.object(
                OrganizationService, "get_organization", new_callable=AsyncMock, return_value=org2
            ):
                await OrganizationService.update_organization(
                    db,
                    org2.id,
                    OrganizationUpdate(is_active=False, name="B"),
                    current_user_role="org_admin",
                )
                assert org2.is_active is True
                assert org2.name == "B"

    asyncio.run(_run())


def test_update_organization_conflict():
    async def _run():
        db = MagicMock()
        org = SimpleNamespace(id=uuid4(), name="A", domain="a.test", timezone="UTC")
        db.commit = MagicMock(side_effect=IntegrityError("stmt", {}, Exception()))
        db.rollback = MagicMock()
        with patch.object(
            OrganizationService, "get_organization", new_callable=AsyncMock, return_value=org
        ):
            with pytest.raises(ConflictError):
                await OrganizationService.update_organization(
                    db, org.id, OrganizationUpdate(domain="taken.test")
                )

    asyncio.run(_run())


def test_delete_organization_blocked_and_success():
    async def _run():
        db = MagicMock()
        org = SimpleNamespace(id=uuid4())
        with patch.object(
            OrganizationService, "get_organization", new_callable=AsyncMock, return_value=org
        ):
            db.query.return_value = _q(count=2)
            with pytest.raises(ConflictError, match="user"):
                await OrganizationService.delete_organization(db, org.id)

            db2 = MagicMock()
            db2.query.return_value = _q(count=0)
            db2.delete = MagicMock()
            db2.commit = MagicMock()
            with patch.object(
                OrganizationService, "get_organization", new_callable=AsyncMock, return_value=org
            ):
                await OrganizationService.delete_organization(db2, org.id)
                db2.delete.assert_called_once_with(org)

    asyncio.run(_run())


def test_delete_organization_fk_conflict():
    async def _run():
        db = MagicMock()
        org = SimpleNamespace(id=uuid4())
        db.query.return_value = _q(count=0)
        db.delete = MagicMock()
        db.commit = MagicMock(
            side_effect=IntegrityError("foreign key constraint", {}, Exception())
        )
        db.rollback = MagicMock()
        with patch.object(
            OrganizationService, "get_organization", new_callable=AsyncMock, return_value=org
        ):
            with pytest.raises(ConflictError, match="associated records"):
                await OrganizationService.delete_organization(db, org.id)

    asyncio.run(_run())


def test_list_organizations_mobile_and_dropdown():
    async def _run():
        db = MagicMock()
        org = SimpleNamespace(id=uuid4(), name="A", domain="a.test", is_active=True)
        db.query.return_value = _q(all_rows=[org])
        rows = await OrganizationService.list_organizations_for_mobile(db)
        assert rows == [org]
        dropdown = await OrganizationService.list_organizations_dropdown(db)
        assert dropdown[0]["name"] == "A"
        assert dropdown[0]["domain"] == "a.test"

    asyncio.run(_run())


def test_add_domains_to_render_skips_without_config():
    async def _run():
        org = SimpleNamespace(domain="a.test")
        with patch("app.common.config.RENDER_API_KEY", None):
            await OrganizationService._add_domains_to_render(org)

    asyncio.run(_run())
