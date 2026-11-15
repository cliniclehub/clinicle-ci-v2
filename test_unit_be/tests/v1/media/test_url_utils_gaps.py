"""Additional unit coverage for media url_utils edge cases."""

from app.v1.media import url_utils as url_utils_module
from app.v1.media.url_utils import (
    _parse_worker_hostname,
    configured_media_worker_hostnames,
    is_hosted_org_media_url,
    sanitize_media_content_payload,
    sanitize_media_urls_in_value,
    strip_org_scoped_media_auth_params,
    strip_worker_auth_params_from_url,
)


def test_parse_worker_hostname_variants(monkeypatch):
    assert _parse_worker_hostname(None) is None
    assert _parse_worker_hostname("  ") is None
    assert _parse_worker_hostname("media.example.workers.dev") == "media.example.workers.dev"
    assert _parse_worker_hostname("https://media.example.workers.dev/path") == "media.example.workers.dev"


def test_configured_media_worker_hostnames_reads_config(monkeypatch):
    monkeypatch.setattr(
        "app.common.config.R2_MEDIA_SERVER_WORKER_URL",
        "https://private.workers.dev",
    )
    monkeypatch.setattr(
        "app.common.config.R2_PUBLIC_MEDIA_SERVER_WORKER_URL",
        "public.workers.dev",
    )
    hosts = configured_media_worker_hostnames()
    assert "private.workers.dev" in hosts
    assert "public.workers.dev" in hosts


def test_is_hosted_org_media_url_relative_org_path(monkeypatch):
    monkeypatch.setattr(
        url_utils_module,
        "configured_media_worker_hostnames",
        lambda: frozenset({"media.example.workers.dev"}),
    )
    assert is_hosted_org_media_url("/orgs/org-1/media/a.mp4") is True
    assert is_hosted_org_media_url("/other/path") is False
    assert is_hosted_org_media_url("") is False


def test_is_hosted_org_media_url_no_configured_hosts(monkeypatch):
    monkeypatch.setattr(url_utils_module, "configured_media_worker_hostnames", lambda: frozenset())
    assert (
        is_hosted_org_media_url("https://media.example.workers.dev/orgs/o/media/a.mp4")
        is False
    )


def test_strip_org_scoped_media_auth_params():
    url = "https://media.example.workers.dev/orgs/org-1/media/a.mp4?token=x&expires=1&keep=1"
    assert (
        strip_org_scoped_media_auth_params(url)
        == "https://media.example.workers.dev/orgs/org-1/media/a.mp4?keep=1"
    )
    assert strip_org_scoped_media_auth_params("https://cdn.example/a.mp4?token=x") == (
        "https://cdn.example/a.mp4?token=x"
    )


def test_strip_worker_auth_leaves_non_hosted_unchanged(monkeypatch):
    monkeypatch.setattr(
        url_utils_module,
        "configured_media_worker_hostnames",
        lambda: frozenset({"media.example.workers.dev"}),
    )
    url = "https://other.example/orgs/o/media/a.mp4?token=abc"
    assert strip_worker_auth_params_from_url(url) == url


def test_sanitize_media_content_payload_non_dict_passthrough():
    assert sanitize_media_content_payload("x") == "x"
    assert sanitize_media_content_payload(None) is None
    assert sanitize_media_urls_in_value(42) == 42
    assert sanitize_media_urls_in_value(None) is None
