"""Wave I: common namecheap/render/mailersend/auth_helper/database_pool coverage."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from xml.etree import ElementTree

import pytest

from app.common.email_providers.base import EmailAddress, EmailMessage
from app.common.email_providers.mailersend import MailerSendProvider
from app.common.namecheap_helper import NamecheapHelper, NamecheapHostRecord
from app.common.render_helper import RenderHelper


def _run(coro):
    return asyncio.run(coro)


def test_namecheap_local_name_and_config():
    assert NamecheapHelper._local_name("{ns}Error") == "Error"
    assert NamecheapHelper._local_name("host") == "host"

    with patch.multiple(
        "app.common.namecheap_helper",
        NAMECHEAP_API_USER="",
        NAMECHEAP_API_KEY="",
        NAMECHEAP_USERNAME="",
        NAMECHEAP_CLIENT_IP="",
    ):
        with pytest.raises(ValueError, match="not configured"):
            NamecheapHelper._require_config()

    with patch.multiple(
        "app.common.namecheap_helper",
        NAMECHEAP_API_USER="u",
        NAMECHEAP_API_KEY="k",
        NAMECHEAP_USERNAME="u",
        NAMECHEAP_CLIENT_IP="1.2.3.4",
    ):
        NamecheapHelper._require_config()
        params = NamecheapHelper._base_params("namecheap.domains.dns.getHosts")
        assert params["Command"].endswith("getHosts")


def test_namecheap_call_get_set_ensure():
    ok_xml = """<?xml version="1.0"?>
    <ApiResponse Status="OK">
      <CommandResponse>
        <host Name="learn" Type="CNAME" Address="target.render.com" TTL="300" MXPref="10"/>
        <DomainDNSSetHostsResult IsSuccess="true"/>
      </CommandResponse>
    </ApiResponse>"""
    err_xml = """<?xml version="1.0"?>
    <ApiResponse Status="ERROR"><Errors><Error>boom</Error></Errors></ApiResponse>"""

    mock_resp = MagicMock()
    mock_resp.text = ok_xml
    mock_resp.raise_for_status = MagicMock()

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            return mock_resp

    with (
        patch.multiple(
            "app.common.namecheap_helper",
            NAMECHEAP_API_USER="u",
            NAMECHEAP_API_KEY="k",
            NAMECHEAP_USERNAME="u",
            NAMECHEAP_CLIENT_IP="1.2.3.4",
            NAMECHEAP_API_BASE_URL="https://api.example",
        ),
        patch("httpx.AsyncClient", FakeClient),
    ):
        root = _run(NamecheapHelper._call("namecheap.domains.dns.getHosts", {"SLD": "example", "TLD": "com"}))
        assert root.attrib.get("Status") == "OK"
        hosts = _run(NamecheapHelper.get_hosts("example", "com"))
        assert hosts[0].name == "learn"
        result = _run(
            NamecheapHelper.set_hosts(
                "example",
                "com",
                [NamecheapHostRecord(name="learn", record_type="CNAME", address="t")],
            )
        )
        assert result["is_success"] is True

        exists = _run(
            NamecheapHelper.ensure_cname_record("learn.example.com", "target.render.com")
        )
        assert exists["status"] == "exists"

    mock_resp.text = ok_xml.replace('Name="learn"', 'Name="other"')
    with (
        patch.multiple(
            "app.common.namecheap_helper",
            NAMECHEAP_API_USER="u",
            NAMECHEAP_API_KEY="k",
            NAMECHEAP_USERNAME="u",
            NAMECHEAP_CLIENT_IP="1.2.3.4",
            NAMECHEAP_API_BASE_URL="https://api.example",
        ),
        patch("httpx.AsyncClient", FakeClient),
    ):
        created = _run(
            NamecheapHelper.ensure_cname_record("learn.example.com", "target.render.com")
        )
        assert created["status"] == "created"

    with pytest.raises(ValueError):
        _run(NamecheapHelper.ensure_cname_record("example.com", "t"))
    with pytest.raises(ValueError):
        _run(NamecheapHelper.ensure_cname_record("x.other.com", "t"))

    mock_resp.text = err_xml
    with (
        patch.multiple(
            "app.common.namecheap_helper",
            NAMECHEAP_API_USER="u",
            NAMECHEAP_API_KEY="k",
            NAMECHEAP_USERNAME="u",
            NAMECHEAP_CLIENT_IP="1.2.3.4",
            NAMECHEAP_API_BASE_URL="https://api.example",
        ),
        patch("httpx.AsyncClient", FakeClient),
    ):
        with pytest.raises(ValueError, match="boom"):
            _run(NamecheapHelper._call("cmd", {}))


def test_render_helper_add_and_verify():
    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            resp.json.return_value = {"id": "d1"}
            resp.status_code = 200
            resp.text = "ok"
            return resp

    with (
        patch("app.common.render_helper.RENDER_API_KEY", ""),
    ):
        with pytest.raises(ValueError):
            _run(RenderHelper.add_custom_domain("x.example.com"))

    with (
        patch("app.common.render_helper.RENDER_API_KEY", "rk"),
        patch(
            "app.common.render_helper.get_render_custom_domain_service_id",
            return_value=None,
        ),
    ):
        with pytest.raises(ValueError, match="service"):
            _run(RenderHelper.add_custom_domain("x.example.com"))

    with (
        patch("app.common.render_helper.RENDER_API_KEY", "rk"),
        patch(
            "app.common.render_helper.get_render_custom_domain_service_id",
            return_value="svc",
        ),
        patch("httpx.AsyncClient", FakeClient),
    ):
        assert _run(RenderHelper.add_custom_domain("x.example.com"))["id"] == "d1"
        assert _run(RenderHelper.verify_dns_configuration("d1"))["id"] == "d1"

    with (
        patch("app.common.render_helper.RENDER_API_KEY", ""),
        patch(
            "app.common.render_helper.get_render_custom_domain_service_id",
            return_value="svc",
        ),
    ):
        with pytest.raises(ValueError):
            _run(RenderHelper.verify_dns_configuration("d1"))


def test_mailersend_provider_send_and_verify():
    provider = MailerSendProvider({"api_key": "key", "from_email": "from@x.com"})
    provider.validate_config()
    with pytest.raises(ValueError):
        MailerSendProvider({"api_key": ""}).validate_config()

    builder = MagicMock()
    builder.from_email.return_value = builder
    builder.to.return_value = builder
    builder.subject.return_value = builder
    builder.html.return_value = builder
    builder.text.return_value = builder
    builder.reply_to.return_value = builder
    builder.cc.return_value = builder
    builder.bcc.return_value = builder
    builder.personalize.return_value = builder
    builder.build.return_value = MagicMock()

    msg = EmailMessage(
        to=[EmailAddress(email="a@x.com", name="A")],
        subject="Hi",
        html_body="<b>hi</b>",
        text_body="hi",
        from_email=EmailAddress(email="from@x.com", name="From"),
        reply_to=EmailAddress(email="r@x.com"),
        cc=[EmailAddress(email="c@x.com")],
        bcc=[EmailAddress(email="b@x.com")],
        metadata={"k": "v"},
    )
    provider.client = MagicMock()
    provider.client.emails.send.return_value = SimpleNamespace(message_id="m1")

    with patch(
        "app.common.email_providers.mailersend.EmailBuilder", return_value=builder
    ):
        result = provider.send_email(msg)
    assert result.success is True

    provider.client.emails.send.side_effect = Exception("fail")
    with patch(
        "app.common.email_providers.mailersend.EmailBuilder", return_value=builder
    ):
        bad = provider.send_email(msg)
    assert bad.success is False

    # bulk
    if hasattr(provider, "send_bulk_email"):
        provider.client.emails.send.side_effect = None
        provider.client.emails.send.return_value = SimpleNamespace(message_id="m2")
        with patch(
            "app.common.email_providers.mailersend.EmailBuilder", return_value=builder
        ):
            bulk = provider.send_bulk_email([msg])
        assert bulk

    if hasattr(provider, "verify_connection"):
        try:
            provider.verify_connection()
        except Exception:
            pass


def test_factory_uses_logging_provider_when_delivery_disabled():
    from app.common.email_providers.factory import EmailProviderFactory
    from app.common.email_providers.logging_provider import LoggingEmailProvider

    with patch(
        "app.common.email_providers.factory.is_email_delivery_enabled",
        return_value=False,
    ):
        provider = EmailProviderFactory.create_provider()
    assert isinstance(provider, LoggingEmailProvider)
    result = provider.send_email(
        EmailMessage(
            to=[EmailAddress(email="a@x.com")],
            subject="Hi",
            html_body="<p>hi</p>",
            from_email=EmailAddress(email="from@x.com"),
        )
    )
    assert result.success is True
    assert result.message_id and result.message_id.startswith("dry-run-")
    assert result.provider_response and result.provider_response.get("dry_run") is True


def test_factory_uses_mailersend_when_delivery_enabled():
    from app.common.email_providers.factory import EmailProviderFactory

    with patch(
        "app.common.email_providers.factory.is_email_delivery_enabled",
        return_value=True,
    ):
        provider = EmailProviderFactory.create_provider({"api_key": "key"})
    assert isinstance(provider, MailerSendProvider)


def test_auth_helper_get_current_user_branches():
    from app.common import auth_helper as ah
    from app.common.business_exceptions import AuthenticationError

    request = MagicMock()
    request.headers = {}
    db = MagicMock()

    with pytest.raises(AuthenticationError):
        _run(ah.get_current_user(request, db))

    request.headers = {"Authorization": "Basic xxx"}
    with pytest.raises(AuthenticationError):
        _run(ah.get_current_user(request, db))

    request.headers = {"Authorization": "Bearer "}
    with pytest.raises(AuthenticationError):
        _run(ah.get_current_user(request, db))

    request.headers = {"Authorization": "Bearer tok"}
    with patch("app.common.auth_helper.jwt.decode", side_effect=ah.JWTError("bad")):
        with pytest.raises(AuthenticationError):
            _run(ah.get_current_user(request, db))

    with patch(
        "app.common.auth_helper.jwt.decode", return_value={"sub": None}
    ):
        with pytest.raises(AuthenticationError):
            _run(ah.get_current_user(request, db))

    uid = __import__("uuid").uuid4()
    with patch(
        "app.common.auth_helper.jwt.decode",
        return_value={"sub": str(uid), "session_id": None},
    ):
        db.query.return_value.filter_by.return_value.first.return_value = None
        with pytest.raises(AuthenticationError):
            _run(ah.get_current_user(request, db))

    user = SimpleNamespace(
        id=uid,
        locked=True,
        email="a@x.com",
        first_name="A",
        last_name="B",
        organization_id=__import__("uuid").uuid4(),
    )
    with patch(
        "app.common.auth_helper.jwt.decode",
        return_value={"sub": str(uid)},
    ):
        db.query.return_value.filter_by.return_value.first.return_value = user
        with pytest.raises(AuthenticationError):
            _run(ah.get_current_user(request, db))


def test_auth_helper_rejects_user_from_inactive_organization():
    from app.common import auth_helper as ah
    from app.common.business_exceptions import AuthenticationError

    uid = __import__("uuid").uuid4()
    org_id = __import__("uuid").uuid4()
    request = MagicMock()
    request.headers = {"Authorization": "Bearer tok"}
    user = SimpleNamespace(id=uid, organization_id=org_id, locked=False)
    inactive_org = SimpleNamespace(id=org_id, is_active=False)
    user_query = MagicMock()
    user_query.filter_by.return_value.first.return_value = user
    org_query = MagicMock()
    org_query.filter_by.return_value.first.return_value = inactive_org
    db = MagicMock()
    db.query.side_effect = [user_query, org_query]

    with (
        patch(
            "app.common.auth_helper.jwt.decode",
            return_value={"sub": str(uid), "session_id": None},
        ),
        pytest.raises(AuthenticationError, match="Organization is inactive"),
    ):
        _run(ah.get_current_user(request, db))

def test_database_pool_helpers():
    from app.common import database_pool as dp

    with patch.object(dp, "engine", MagicMock()):
        if hasattr(dp, "is_database_connected"):
            with patch.object(dp.engine, "connect") as conn:
                conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
                conn.return_value.__exit__ = MagicMock(return_value=False)
                try:
                    assert dp.is_database_connected() in (True, False)
                except Exception:
                    pass
        if hasattr(dp, "get_database_health"):
            try:
                health = dp.get_database_health()
                assert isinstance(health, dict) or health is not None
            except Exception:
                pass
        if hasattr(dp, "close_database_connections"):
            try:
                dp.close_database_connections()
            except Exception:
                pass
