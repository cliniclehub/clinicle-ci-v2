"""Tests for hosted media URL helpers."""

import pytest

from app.v1.media import url_utils as url_utils_module
from app.v1.media.url_utils import (
    is_hosted_org_media_url,
    sanitize_media_content_payload,
    sanitize_media_urls_in_value,
    sanitize_urls_in_text,
    strip_worker_auth_params_from_url,
)

WORKER = "https://media.example.workers.dev"


@pytest.fixture(autouse=True)
def _configure_worker_urls(monkeypatch):
    monkeypatch.setattr(
        url_utils_module,
        "configured_media_worker_hostnames",
        lambda: frozenset({"media.example.workers.dev"}),
    )


def test_is_hosted_org_media_url_worker_path():
    url = f"{WORKER}/orgs/org-1/media/video.mp4"
    assert is_hosted_org_media_url(url) is True


def test_is_hosted_org_media_url_rejects_unconfigured_worker():
    assert (
        is_hosted_org_media_url(
            "https://attacker.workers.dev/orgs/org-1/media/video.mp4"
        )
        is False
    )


def test_is_hosted_org_media_url_external_youtube():
    assert is_hosted_org_media_url("https://www.youtube.com/watch?v=abc") is False


def test_strip_worker_auth_params_from_url():
    url = (
        f"{WORKER}/orgs/org-1/media/video.mp4"
        "?token=old-jwt&expires=3600&local=true"
        "&mediaToken=old-media&media_token=old-media-too&download=1"
    )
    assert (
        strip_worker_auth_params_from_url(url)
        == f"{WORKER}/orgs/org-1/media/video.mp4?download=1"
    )


def test_strip_worker_auth_params_leaves_external_urls():
    url = "https://vimeo.com/12345?share=copy"
    assert strip_worker_auth_params_from_url(url) == url


def test_strip_worker_auth_params_leaves_attacker_worker_urls():
    url = "https://attacker.workers.dev/orgs/org-1/media/video.mp4?token=abc"
    assert strip_worker_auth_params_from_url(url) == url


def test_sanitize_media_content_payload_strips_media_url_token():
    payload = {
        "mediaUrl": f"{WORKER}/orgs/org-1/media/video.mp4?token=old",
        "isDraft": False,
    }
    result = sanitize_media_content_payload(payload)
    assert result["mediaUrl"] == f"{WORKER}/orgs/org-1/media/video.mp4"
    assert result["isDraft"] is False


def test_sanitize_media_urls_in_value_strips_nested_assessment_urls():
    payload = {
        "assessmentData": {
            "questions": [
                {
                    "assignmentContentURL": (
                        f"{WORKER}/orgs/org-1/media/doc.pdf?token=old"
                    )
                }
            ]
        },
        "thumbnailUrl": f"{WORKER}/orgs/org-1/media/poster.jpg?mediaToken=x",
        "richTextContent": (
            f'<a href="{WORKER}/orgs/org-1/media/slide.pdf?token=html">link</a>'
        ),
    }

    result = sanitize_media_urls_in_value(payload)

    assert (
        result["assessmentData"]["questions"][0]["assignmentContentURL"]
        == f"{WORKER}/orgs/org-1/media/doc.pdf"
    )
    assert result["thumbnailUrl"] == f"{WORKER}/orgs/org-1/media/poster.jpg"
    assert "token=html" not in result["richTextContent"]
    assert result["richTextContent"].endswith("/slide.pdf\">link</a>")


def test_sanitize_urls_in_text_leaves_external_links():
    text = '<a href="https://example.com/file.pdf?token=keep">x</a>'
    assert sanitize_urls_in_text(text) == text
