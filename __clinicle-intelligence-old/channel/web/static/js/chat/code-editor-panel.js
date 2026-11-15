/* Chat's split-pane Code Editor panel: the same file tree + editor +
 * terminal as the old standalone Code Editor view (views/code-editor.js,
 * untouched), now living as a right-side sidebar on the Chat view instead
 * of its own nav page -- same treatment as chat/browser-panel.js.
 *
 * Reuses every ce-* id and function as-is; this file only owns open/close/
 * resize for the panel shell around it. loadCodeEditorView() is called
 * fresh on every open, same as the old navigateTo('code-editor') branch
 * used to -- it resets to the default agent's root tree, which was already
 * the behavior every time this view was (re-)entered.
 */

const CEP_OPEN_KEY = 'code-editor-panel-open';
const CEP_WIDTH_KEY = 'code-editor-panel-width';
const CEP_DEFAULT_WIDTH = 680;
const CEP_MIN_WIDTH = 420;

let _cepOpen = false;

function openCodeEditorPanel() {
    if (_cepOpen) return;
    const panel = document.getElementById('code-editor-panel');
    const btn = document.getElementById('code-editor-panel-toggle-btn');
    if (!panel) return;
    _cepOpen = true;
    panel.classList.remove('hidden');
    if (btn) btn.classList.add('active');
    try { localStorage.setItem(CEP_OPEN_KEY, '1'); } catch (e) {}
    if (typeof loadCodeEditorView === 'function') loadCodeEditorView();
}

function closeCodeEditorPanel() {
    if (!_cepOpen) return;
    const panel = document.getElementById('code-editor-panel');
    const btn = document.getElementById('code-editor-panel-toggle-btn');
    _cepOpen = false;
    if (panel) panel.classList.add('hidden');
    if (btn) btn.classList.remove('active');
    try { localStorage.setItem(CEP_OPEN_KEY, '0'); } catch (e) {}
}

function toggleCodeEditorPanel() {
    if (_cepOpen) closeCodeEditorPanel();
    else openCodeEditorPanel();
}

// =====================================================================
// Resizer -- same drag pattern as workspace.js's initWorkspaceResizer /
// chat/browser-panel.js's _initBrowserPanelResizer.
// =====================================================================

function _initCodeEditorPanelResizer() {
    const resizer = document.getElementById('cep-resizer');
    const panel = document.getElementById('code-editor-panel');
    if (!resizer || !panel) return;

    let startX = 0;
    let startWidth = 0;

    function onMove(e) {
        const delta = startX - e.clientX;
        const next = Math.max(CEP_MIN_WIDTH, Math.min(window.innerWidth * 0.8, startWidth + delta));
        panel.style.width = `${next}px`;
    }

    function onUp() {
        resizer.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try { localStorage.setItem(CEP_WIDTH_KEY, String(parseInt(panel.style.width, 10) || CEP_DEFAULT_WIDTH)); } catch (e) {}
    }

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('code-editor-panel');
    if (panel) {
        let width = CEP_DEFAULT_WIDTH;
        try { width = parseInt(localStorage.getItem(CEP_WIDTH_KEY), 10) || CEP_DEFAULT_WIDTH; } catch (e) {}
        panel.style.width = `${width}px`;
    }
    _initCodeEditorPanelResizer();
    try {
        if (localStorage.getItem(CEP_OPEN_KEY) === '1') openCodeEditorPanel();
    } catch (e) {}
});
