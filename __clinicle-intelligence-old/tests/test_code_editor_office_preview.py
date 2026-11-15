# encoding:utf-8
"""Code Editor genuine inline Office-document rendering: .docx via
docx-preview (+ JSZip, its UMD build reads window.JSZip), .xlsx/.xls via
SheetJS -- both vendored locally under channel/web/static/vendor/ and
lazy-loaded on first use, matching the existing d3 lazy-loader convention
in knowledge.js. .pptx is NOT covered: no viable in-browser renderer
exists without a server-side conversion pass (e.g. LibreOffice headless),
so it deliberately keeps the plain download-link fallback."""

from pathlib import Path

ROOT = Path(__file__).parents[1]


def _js():
    return (ROOT / "channel/web/static/js/views/code-editor.js").read_text(encoding="utf-8")


def _html():
    return (ROOT / "channel/web/templates/views/code-editor.html").read_text(encoding="utf-8")


def _css():
    return (ROOT / "channel/web/static/css/code-editor.css").read_text(encoding="utf-8")


def test_docx_and_xlsx_extensions_map_to_their_own_preview_kind():
    js = _js()
    assert "docx: 'docx'" in js
    assert "xlsx: 'xlsx'" in js
    assert "xls: 'xlsx'" in js
    # pptx must NOT get a preview kind -- it stays on the download-link path.
    assert "pptx:" not in js.split("_CE_PREVIEW_KIND_BY_EXT")[1].split("};")[0]


def test_the_vendor_libraries_are_local_not_a_cdn():
    js = _js()
    assert "/assets/vendor/jszip/jszip.min.js" in js
    assert "/assets/vendor/docx-preview/docx-preview.min.js" in js
    assert "/assets/vendor/xlsx/xlsx.full.min.js" in js
    assert "cdn." not in js


def test_docx_preview_loads_jszip_before_docx_preview_itself():
    """docx-preview's UMD wrapper reads window.JSZip synchronously at
    load time -- loading it after (or not at all) leaves docx.renderAsync
    silently broken, so the load order in ensureDocxPreviewLoaded matters,
    not just that both scripts get loaded eventually."""
    js = _js()
    loader_fn = js.split("function ensureDocxPreviewLoaded()")[1].split("\nfunction ")[0]
    jszip_pos = loader_fn.index("jszip/jszip.min.js")
    docx_pos = loader_fn.index("docx-preview/docx-preview.min.js")
    assert jszip_pos < docx_pos


def test_both_loaders_are_lazy_and_cache_the_promise():
    js = _js()
    docx_fn = js.split("function ensureDocxPreviewLoaded()")[1].split("\nfunction ")[0]
    assert "if (window.docx) return Promise.resolve(window.docx);" in docx_fn
    assert "_ceDocxLoadPromise" in docx_fn
    xlsx_fn = js.split("function ensureXlsxLoaded()")[1].split("\nfunction ")[0]
    assert "if (window.XLSX) return Promise.resolve(window.XLSX);" in xlsx_fn
    assert "_ceXlsxLoadPromise" in xlsx_fn


def test_docx_render_uses_the_existing_raw_bytes_endpoint_and_renderAsync():
    js = _js()
    render_fn = js.split("function _ceRenderDocxPreview(fileUrl)")[1].split("\nfunction ")[0]
    assert "fetch(fileUrl)" in render_fn
    assert ".arrayBuffer()" in render_fn
    assert "renderAsync(buf" in render_fn


def test_xlsx_render_builds_sheet_tabs_and_uses_sheet_to_html():
    js = _js()
    render_fn = js.split("function _ceRenderXlsxPreview(fileUrl)")[1].split("\nfunction ")[0]
    assert "XLSX.read(" in render_fn
    assert "sheet_to_html" in render_fn
    assert "workbook.SheetNames" in render_fn


def test_a_render_failure_shows_a_message_not_a_blank_panel():
    js = _js()
    docx_fn = js.split("function _ceRenderDocxPreview(fileUrl)")[1].split("\nfunction ")[0]
    assert "code_editor_preview_failed" in docx_fn
    xlsx_fn = js.split("function _ceRenderXlsxPreview(fileUrl)")[1].split("\nfunction ")[0]
    assert "code_editor_preview_failed" in xlsx_fn


def test_open_file_routes_docx_and_xlsx_to_their_own_renderer():
    js = _js()
    open_fn = js.split("function ceOpenFile(path)")[1].split("\nfunction ")[0]
    assert "_ceRenderDocxPreview(fileUrl)" in open_fn
    assert "_ceRenderXlsxPreview(fileUrl)" in open_fn
    assert "ce-preview-docx-wrap" in open_fn
    assert "ce-preview-xlsx-wrap" in open_fn


def test_hiding_all_editor_states_also_hides_the_office_previews():
    js = _js()
    hide_fn = js.split("function _ceHideAllEditorStates()")[1].split("\nfunction ")[0]
    assert "ce-preview-docx-wrap" in hide_fn
    assert "ce-preview-xlsx-wrap" in hide_fn


def test_html_has_docx_and_xlsx_preview_containers():
    html = _html()
    assert 'id="ce-preview-docx-wrap"' in html
    assert 'id="ce-preview-docx"' in html
    assert 'id="ce-preview-xlsx-wrap"' in html
    assert 'id="ce-preview-xlsx"' in html
    assert 'id="ce-preview-xlsx-tabs"' in html


def test_office_preview_containers_have_their_own_css():
    css = _css()
    assert ".ce-preview-office" in css
    assert ".ce-preview-xlsx-tab" in css
    assert "#ce-preview-xlsx table" in css


def test_vendor_files_actually_exist_on_disk():
    """The library files themselves, not just references to their paths --
    a broken /assets/vendor/ reference would only surface at runtime
    otherwise."""
    vendor = ROOT / "channel/web/static/vendor"
    assert (vendor / "jszip" / "jszip.min.js").is_file()
    assert (vendor / "docx-preview" / "docx-preview.min.js").is_file()
    assert (vendor / "xlsx" / "xlsx.full.min.js").is_file()


def test_vendored_docx_preview_bundle_reads_window_jszip_as_documented():
    """Confirms the assumption the load-order test above depends on: if a
    future re-vendor of docx-preview changes its UMD wrapper to bundle
    JSZip itself, this test (not just the load-order one) should fail."""
    bundle = (ROOT / "channel/web/static/vendor/docx-preview/docx-preview.min.js").read_text(encoding="utf-8")
    assert "e.JSZip" in bundle[:600]
