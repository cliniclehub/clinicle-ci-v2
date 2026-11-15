# encoding:utf-8
"""channel/web/api/config.py's CustomCssHandler: deliberately separate from
ConfigHandler.GET, which requires settings.general/security (it also
returns API keys). Custom CSS is workspace-wide branding every logged-in
member's page should apply -- gated on auth only, no settings capability,
so a regular member's page doesn't 403 on every load just to skin itself."""

import json
from unittest.mock import patch

import pytest
import web

from channel.web.api.config import CustomCssHandler


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    web.ctx.headers = []


def test_returns_the_configured_custom_css():
    with patch("channel.web.api.config._require_auth"), \
         patch("channel.web.api.config.web.header"), \
         patch("channel.web.api.config.conf", return_value={"custom_css": ".foo { color: red; }"}):
        response = json.loads(CustomCssHandler().GET())
    assert response == {"status": "success", "custom_css": ".foo { color: red; }"}


def test_defaults_to_an_empty_string_when_unset():
    with patch("channel.web.api.config._require_auth"), \
         patch("channel.web.api.config.web.header"), \
         patch("channel.web.api.config.conf", return_value={}):
        response = json.loads(CustomCssHandler().GET())
    assert response == {"status": "success", "custom_css": ""}


def test_requires_authentication_but_not_a_settings_capability():
    """The one property that actually matters: _require_auth is called
    (an anonymous request is rejected), but _require_config_capability
    (settings.general/security) is never invoked -- any logged-in member
    can read this, unlike the full /config endpoint."""
    with patch("channel.web.api.config._require_auth", side_effect=web.HTTPError(
        "401 Unauthorized", {}, "",
    )) as require_auth, \
         patch("channel.web.api.config._require_config_capability") as require_cap, \
         patch("channel.web.api.config.web.header"), \
         patch("channel.web.api.config.conf", return_value={}):
        with pytest.raises(web.HTTPError):
            CustomCssHandler().GET()
    require_auth.assert_called_once()
    require_cap.assert_not_called()
