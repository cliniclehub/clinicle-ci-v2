/* Code Editor view: file tree + textarea editor + a persistent-shell
 * terminal over one Agent's own workspace (channel/web/api/workspace_files.py,
 * agent/workspace/terminal_session.py -- cd/env state carries over between
 * commands, unlike the old one-shot-per-command version).
 * Settings > Security & Access gated server side; a 403 here just means
 * this account isn't cleared for it, not that the feature is broken. */

let ceAgentId = '';
let ceOpenPath = '';
let ceDirty = false;

function loadCodeEditorView() {
    const roster = ensureAgentCatalog();
    roster.then(() => {
        const select = document.getElementById('ce-agent-select');
        if (!select) return;
        select.innerHTML = (agentCatalog || []).map(a =>
            `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
        if (!ceAgentId || !agentCatalog.some(a => a.id === ceAgentId)) {
            ceAgentId = (agentCatalog[0] || {}).id || '';
        }
        select.value = ceAgentId;
        if (ceAgentId) ceSelectAgent(ceAgentId);
    });
}

function ceSelectAgent(agentId) {
    ceAgentId = agentId;
    ceOpenPath = '';
    _ceCloseEditor();
    document.getElementById('ce-terminal-output').innerHTML = '';
    ceRefreshTree();
}

// Reloads the whole tree from the root, re-collapsing every expanded folder.
// Used on agent switch, after create/delete, and after a terminal command --
// a command can create, remove, or rename files the tree has no other way
// to learn about (see ceRunTerminalCommand's own call to this).
function ceRefreshTree() {
    if (!ceAgentId) return;
    _ceLoadTree('', document.getElementById('ce-tree'));
}

function _ceStatus(message, isError) {
    const el = document.getElementById('ce-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? '#dc2626' : '';
}

function _ceApplyAccess(ok) {
    document.getElementById('ce-not-applicable').classList.toggle('hidden', ok);
    document.getElementById('ce-body').classList.toggle('hidden', !ok);
}

// =====================================================================
// Tree
// =====================================================================
function _ceLoadTree(path, containerEl) {
    if (!ceAgentId || !containerEl) return;
    fetch(`/api/workspace/tree?agent_id=${encodeURIComponent(ceAgentId)}&path=${encodeURIComponent(path)}`)
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') {
                _ceApplyAccess(false);
                return;
            }
            _ceApplyAccess(true);
            containerEl.innerHTML = '';
            data.entries.forEach(entry => containerEl.appendChild(_ceRenderNode(entry)));
        }).catch(() => _ceStatus('Could not reach the server', true));
}

function _ceRenderNode(entry) {
    const node = document.createElement('div');
    node.className = 'ce-tree-node';
    const row = document.createElement('div');
    row.className = 'ce-tree-row';
    row.dataset.path = entry.path;
    const icon = entry.type === 'dir' ? 'fa-folder' : _ceFileIcon(entry.name);
    row.innerHTML = `<i class="fas ${icon}"></i><span>${escapeHtml(entry.name)}</span>`;
    node.appendChild(row);

    if (entry.type === 'dir') {
        const children = document.createElement('div');
        children.className = 'ce-tree-children';
        node.appendChild(children);
        let expanded = false;
        row.addEventListener('click', () => {
            expanded = !expanded;
            children.classList.toggle('open', expanded);
            row.querySelector('i').className = `fas ${expanded ? 'fa-folder-open' : 'fa-folder'}`;
            if (expanded && !children.dataset.loaded) {
                children.dataset.loaded = '1';
                _ceLoadTree(entry.path, children);
            }
        });
    } else {
        row.addEventListener('click', () => ceOpenFile(entry.path));
    }
    return node;
}

function _ceFileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
        py: 'fa-file-code', js: 'fa-file-code', ts: 'fa-file-code', html: 'fa-file-code',
        css: 'fa-file-code', json: 'fa-file-code', md: 'fa-file-lines', txt: 'fa-file-lines',
    };
    return map[ext] || 'fa-file';
}

// =====================================================================
// Editor
// =====================================================================
// Extensions the browser can render natively, given a raw-bytes URL --
// backed by the existing channel/web/api/files.py FileServeHandler
// (/api/file?path=<abs>), not a new serving surface. docx/xlsx get a real
// client-side render (docx-preview+JSZip, SheetJS -- vendored locally,
// lazy-loaded on first use). pptx has no viable in-browser renderer
// without a server-side conversion pass (e.g. LibreOffice headless),
// which doesn't exist here -- it keeps the honest download-link fallback
// below, not a fabricated preview.
const _CE_PREVIEW_KIND_BY_EXT = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
    webp: 'image', bmp: 'image', ico: 'image', svg: 'image',
    pdf: 'pdf',
    docx: 'docx',
    xlsx: 'xlsx', xls: 'xlsx',
};

// =====================================================================
// Office document preview: docx-preview (+ JSZip) and SheetJS, vendored
// locally under /assets/vendor/ (same offline-first convention as d3's
// own lazy loader in knowledge.js) and loaded only the first time a
// matching file is opened -- most sessions never touch either library.
// =====================================================================

let _ceDocxLoadPromise = null;

function _ceLoadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

function ensureDocxPreviewLoaded() {
    if (window.docx) return Promise.resolve(window.docx);
    if (_ceDocxLoadPromise) return _ceDocxLoadPromise;
    // docx-preview's UMD build reads window.JSZip at load time, so JSZip
    // must finish loading first -- these are not interchangeable order.
    _ceDocxLoadPromise = (window.JSZip ? Promise.resolve() : _ceLoadScript('/assets/vendor/jszip/jszip.min.js'))
        .then(() => _ceLoadScript('/assets/vendor/docx-preview/docx-preview.min.js'))
        .then(() => window.docx);
    return _ceDocxLoadPromise;
}

let _ceXlsxLoadPromise = null;

function ensureXlsxLoaded() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_ceXlsxLoadPromise) return _ceXlsxLoadPromise;
    _ceXlsxLoadPromise = _ceLoadScript('/assets/vendor/xlsx/xlsx.full.min.js').then(() => window.XLSX);
    return _ceXlsxLoadPromise;
}

function _ceRenderDocxPreview(fileUrl) {
    const container = document.getElementById('ce-preview-docx');
    container.innerHTML = `<p class="ce-preview-loading">${escapeHtml(t('code_editor_preview_loading') || 'Loading preview...')}</p>`;
    ensureDocxPreviewLoaded()
        .then(docxLib => fetch(fileUrl).then(r => r.arrayBuffer()).then(buf => [docxLib, buf]))
        .then(([docxLib, buf]) => {
            container.innerHTML = '';
            return docxLib.renderAsync(buf, container, container, { inWrapper: true, ignoreWidth: false });
        })
        .catch(() => {
            container.innerHTML = `<p class="ce-preview-loading">${escapeHtml(t('code_editor_preview_failed') || 'Could not render this document.')}</p>`;
        });
}

function _ceRenderXlsxPreview(fileUrl) {
    const container = document.getElementById('ce-preview-xlsx');
    const tabsEl = document.getElementById('ce-preview-xlsx-tabs');
    container.innerHTML = `<p class="ce-preview-loading">${escapeHtml(t('code_editor_preview_loading') || 'Loading preview...')}</p>`;
    tabsEl.innerHTML = '';
    ensureXlsxLoaded()
        .then(XLSX => fetch(fileUrl).then(r => r.arrayBuffer()).then(buf => [XLSX, buf]))
        .then(([XLSX, buf]) => {
            const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
            const renderSheet = (name) => {
                const sheet = workbook.Sheets[name];
                container.innerHTML = sheet ? XLSX.utils.sheet_to_html(sheet, { id: 'ce-xlsx-table' }) : '';
            };
            tabsEl.innerHTML = workbook.SheetNames.map((name, i) => `
                <button type="button" class="ce-preview-xlsx-tab${i === 0 ? ' active' : ''}"
                        onclick="_ceSwitchXlsxSheet('${_wsAttr(name)}', this)">${escapeHtml(name)}</button>
            `).join('');
            renderSheet(workbook.SheetNames[0]);
            window._ceXlsxWorkbook = workbook;
        })
        .catch(() => {
            container.innerHTML = `<p class="ce-preview-loading">${escapeHtml(t('code_editor_preview_failed') || 'Could not render this spreadsheet.')}</p>`;
        });
}

function _ceSwitchXlsxSheet(name, tabEl) {
    const workbook = window._ceXlsxWorkbook;
    if (!workbook) return;
    document.querySelectorAll('.ce-preview-xlsx-tab').forEach(el => el.classList.remove('active'));
    tabEl.classList.add('active');
    const sheet = workbook.Sheets[name];
    document.getElementById('ce-preview-xlsx').innerHTML =
        sheet ? window.XLSX.utils.sheet_to_html(sheet, { id: 'ce-xlsx-table' }) : '';
}

function _cePreviewKindFor(path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    return _CE_PREVIEW_KIND_BY_EXT[ext] || null;
}

function _ceHideAllEditorStates() {
    document.getElementById('ce-editor-wrap').classList.add('hidden');
    document.getElementById('ce-preview-image-wrap').classList.add('hidden');
    document.getElementById('ce-preview-pdf-wrap').classList.add('hidden');
    document.getElementById('ce-preview-docx-wrap').classList.add('hidden');
    document.getElementById('ce-preview-xlsx-wrap').classList.add('hidden');
    document.getElementById('ce-preview-download-wrap').classList.add('hidden');
    document.getElementById('ce-editor-empty').classList.add('hidden');
}

function _ceCloseEditor() {
    ceOpenPath = '';
    ceDirty = false;
    _ceHideAllEditorStates();
    document.getElementById('ce-editor-empty').classList.remove('hidden');
    document.getElementById('ce-save-btn').classList.add('hidden');
    document.getElementById('ce-delete-btn').classList.add('hidden');
    document.getElementById('ce-open-path').textContent = t('code_editor_no_file_open') || 'No file open';
}

function ceOpenFile(path) {
    if (ceDirty && !confirm('Discard unsaved changes?')) return;
    fetch(`/api/workspace/file?agent_id=${encodeURIComponent(ceAgentId)}&path=${encodeURIComponent(path)}`)
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') { _ceStatus(data.message || 'Could not open file', true); return; }

            ceOpenPath = path;
            ceDirty = false;
            _ceHideAllEditorStates();
            document.getElementById('ce-open-path').textContent = path + (data.truncated ? ' (truncated)' : '');
            document.querySelectorAll('.ce-tree-row').forEach(r => r.classList.toggle('active', r.dataset.path === path));
            document.getElementById('ce-delete-btn').classList.remove('hidden');
            _ceStatus('');

            const previewKind = _cePreviewKindFor(path);
            const fileUrl = data.abs_path ? `/api/file?path=${encodeURIComponent(data.abs_path)}` : '';

            if (previewKind && fileUrl) {
                document.getElementById('ce-save-btn').classList.add('hidden');
                if (previewKind === 'image') {
                    document.getElementById('ce-preview-image').src = fileUrl;
                    document.getElementById('ce-preview-image-wrap').classList.remove('hidden');
                } else if (previewKind === 'pdf') {
                    document.getElementById('ce-preview-pdf').src = fileUrl;
                    document.getElementById('ce-preview-pdf-wrap').classList.remove('hidden');
                } else if (previewKind === 'docx') {
                    document.getElementById('ce-preview-docx-wrap').classList.remove('hidden');
                    _ceRenderDocxPreview(fileUrl);
                } else if (previewKind === 'xlsx') {
                    document.getElementById('ce-preview-xlsx-wrap').classList.remove('hidden');
                    _ceRenderXlsxPreview(fileUrl);
                }
                return;
            }

            if (data.binary) {
                document.getElementById('ce-save-btn').classList.add('hidden');
                const link = document.getElementById('ce-preview-download-link');
                link.href = fileUrl;
                link.setAttribute('download', path.split('/').pop());
                document.getElementById('ce-preview-download-wrap').classList.remove('hidden');
                return;
            }

            const editor = document.getElementById('ce-editor');
            editor.value = data.content || '';
            document.getElementById('ce-editor-wrap').classList.remove('hidden');
            document.getElementById('ce-save-btn').classList.remove('hidden');
            _ceRefreshHighlight();
        }).catch(() => _ceStatus('Could not reach the server', true));
}

document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'ce-editor') { ceDirty = true; _ceRefreshHighlight(); }
});
document.addEventListener('scroll', (e) => {
    if (e.target && e.target.id === 'ce-editor') _ceSyncHighlightScroll();
}, true);

function ceSaveFile() {
    if (!ceOpenPath) return;
    const content = document.getElementById('ce-editor').value;
    fetch(`/api/workspace/file?agent_id=${encodeURIComponent(ceAgentId)}&path=${encodeURIComponent(ceOpenPath)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _ceStatus(data.message || 'Could not save', true); return; }
        ceDirty = false;
        _ceStatus('Saved.');
    }).catch(() => _ceStatus('Could not reach the server', true));
}

function ceDeleteOpenFile() {
    if (!ceOpenPath) return;
    const path = ceOpenPath;
    showConfirmModal(
        t('code_editor_delete_title') || 'Delete file',
        (t('code_editor_delete_confirm') || 'Delete {path}? This cannot be undone.').replace('{path}', path),
        () => {
            fetch(`/api/workspace/file?agent_id=${encodeURIComponent(ceAgentId)}&path=${encodeURIComponent(path)}`, {
                method: 'DELETE',
            }).then(r => r.json()).then(data => {
                if (data.status !== 'success') { _ceStatus(data.message || 'Could not delete', true); return; }
                _ceCloseEditor();
                ceRefreshTree();
            }).catch(() => _ceStatus('Could not reach the server', true));
        },
    );
}

function ceNewFilePrompt() {
    if (!ceAgentId) return;
    showPromptModal(t('code_editor_new_file_prompt') || 'New file path (relative to the workspace):', '', (path) => {
        if (!path) return;
        fetch(`/api/workspace/file?agent_id=${encodeURIComponent(ceAgentId)}&path=${encodeURIComponent(path)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '' }),
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') { _ceStatus(data.message || 'Could not create file', true); return; }
            ceRefreshTree();
            ceOpenFile(path);
        }).catch(() => _ceStatus('Could not reach the server', true));
    });
}

// =====================================================================
// Syntax highlighting: a read-only hljs-highlighted <pre><code> sits behind
// the real (text-transparent) textarea -- see code-editor.css's own comment
// on why both share the exact same box model. Reuses the highlight.js build
// already vendored for chat code blocks (channel/web/static/js/core/
// utils.js's applyHighlighting) instead of adding a dependency; only the
// languages that build registers (python/javascript/java/go/bash) actually
// colorize -- anything else renders as plain text, same as hljs's own
// behavior for an unregistered language.
// =====================================================================
const _CE_LANGUAGE_BY_EXT = {
    py: 'python', js: 'javascript', mjs: 'javascript', jsx: 'javascript',
    java: 'java', go: 'go', sh: 'bash', bash: 'bash',
};

function _ceLanguageFor(path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    return _CE_LANGUAGE_BY_EXT[ext] || null;
}

function _ceRefreshHighlight() {
    const codeEl = document.getElementById('ce-editor-highlight-code');
    const editor = document.getElementById('ce-editor');
    if (!codeEl || !editor) return;
    const hljsLib = getHljs();
    const text = editor.value;
    const lang = _ceLanguageFor(ceOpenPath);
    if (lang && hljsLib.getLanguage(lang)) {
        try {
            codeEl.innerHTML = hljsLib.highlight(text, { language: lang }).value;
        } catch (e) {
            codeEl.textContent = text;
        }
    } else {
        codeEl.textContent = text;
    }
    _ceSyncHighlightScroll();
}

function _ceSyncHighlightScroll() {
    const editor = document.getElementById('ce-editor');
    const highlight = document.getElementById('ce-editor-highlight');
    if (!editor || !highlight) return;
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
}

// =====================================================================
// Terminal (persistent per-agent shell -- cd/env state carries over
// between commands; see agent/workspace/terminal_session.py)
// =====================================================================
function ceResetTerminal() {
    if (!ceAgentId) return;
    fetch(`/api/workspace/terminal?agent_id=${encodeURIComponent(ceAgentId)}`, { method: 'DELETE' })
        .then(r => r.json()).then(() => {
            document.getElementById('ce-terminal-output').innerHTML = '';
        }).catch(() => _ceStatus('Could not reach the server', true));
}

function ceRunTerminalCommand() {
    const input = document.getElementById('ce-terminal-input');
    const command = input.value.trim();
    if (!command || !ceAgentId) return;
    input.value = '';
    const out = document.getElementById('ce-terminal-output');
    const cmdLine = document.createElement('div');
    cmdLine.className = 'ce-terminal-line-command';
    cmdLine.textContent = `$ ${command}`;
    out.appendChild(cmdLine);

    fetch('/api/workspace/terminal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: ceAgentId, command }),
    }).then(r => r.json()).then(data => {
        const line = document.createElement('div');
        if (data.status !== 'success') line.className = 'ce-terminal-line-error';
        line.textContent = data.output || data.message || '(no output)';
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
        // The command may have created, removed, or renamed files -- the tree
        // has no other way to learn that, so refresh it after every command.
        ceRefreshTree();
    }).catch(() => {
        const line = document.createElement('div');
        line.className = 'ce-terminal-line-error';
        line.textContent = 'Could not reach the server';
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
    });
}
