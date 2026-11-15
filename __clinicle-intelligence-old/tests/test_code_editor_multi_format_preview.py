# encoding:utf-8
"""Code Editor multi-format preview: images and PDFs render inline via the
existing /api/file?path=<abs> raw-bytes endpoint (channel/web/api/files.py's
FileServeHandler) instead of the plain "Binary file -- cannot edit as text"
message. docx/xlsx get a real client-side render too (docx-preview+JSZip,
SheetJS -- vendored locally, lazy-loaded). pptx has no viable in-browser
renderer without a server-side conversion pass that doesn't exist here, so
it keeps the honest download-link fallback -- see
test_code_editor_office_preview.py for the docx/xlsx-specific coverage."""

from pathlib import Path

ROOT = Path(__file__).parents[1]


def _js():
    return (ROOT / "channel/web/static/js/views/code-editor.js").read_text(encoding="utf-8")


def _html():
    return (ROOT / "channel/web/templates/views/code-editor.html").read_text(encoding="utf-8")


def _css():
    return (ROOT / "channel/web/static/css/code-editor.css").read_text(encoding="utf-8")


def test_known_image_and_pdf_extensions_map_to_a_preview_kind():
    js = _js()
    for ext in ("png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"):
        assert f"{ext}: 'image'" in js, f"{ext} missing from preview kind map"
    assert "pdf: 'pdf'" in js


def test_preview_reuses_the_existing_file_serve_endpoint_not_a_new_one():
    js = _js()
    assert "/api/file?path=" in js


def test_html_has_image_pdf_and_download_preview_containers():
    html = _html()
    assert 'id="ce-preview-image-wrap"' in html
    assert 'id="ce-preview-image"' in html
    assert 'id="ce-preview-pdf-wrap"' in html
    assert 'id="ce-preview-pdf"' in html
    assert 'id="ce-preview-download-wrap"' in html
    assert 'id="ce-preview-download-link"' in html


def test_preview_containers_have_their_own_css():
    css = _css()
    assert ".ce-preview-wrap" in css
    assert ".ce-preview-image" in css
    assert ".ce-preview-pdf" in css
    assert ".ce-preview-download-link" in css


def test_open_file_no_longer_just_refuses_binary_files():
    """The old behavior (_ceStatus('Binary file -- cannot edit as text',
    true); return;) must be gone -- binary now branches into a preview or
    a download link instead of a dead end."""
    js = _js()
    assert "Binary file -- cannot edit as text" not in js
