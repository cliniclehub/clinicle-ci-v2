/* Chat's split-pane Browser panel: a live, read-only (+ optional takeover)
 * view of the shared browser tool, as a right-side sidebar on the Chat view
 * -- so watching the agent browse never needs a real, separate OS browser
 * window (agent/tools/browser/browser_service.py runs it headless; this
 * panel is how a human actually sees it). Used to coexist with a standalone
 * Browser View nav page (views/browser-view.js, now retired in favor of
 * this panel) -- own cbp- prefixed ids/state is a holdover from avoiding
 * collisions with that page's bv-* ids, kept since browser-view.css's
 * shared .bv-* style classes are still reused here.
 * Polling only runs while the Chat view is on screen and the panel is open
 * (same guard activity-panel.js uses via _activityIsChatViewActive()).
 */

const CBP_OPEN_KEY = 'browser-panel-open';
const CBP_WIDTH_KEY = 'browser-panel-width';
const CBP_DEFAULT_WIDTH = 480;
const CBP_MIN_WIDTH = 320;

let _cbpFramePollTimer = null;
let _cbpStatusPollTimer = null;
let _cbpRunning = false;
let _cbpControlling = false;
let _cbpOpen = false;
let _cbpFittedFor = ''; // "widthxheight" last sent to resize_viewport, skip repeats

// =====================================================================
// Open/close
// =====================================================================

function openBrowserPanel() {
    if (_cbpOpen) return;
    const panel = document.getElementById('browser-panel');
    const btn = document.getElementById('browser-panel-toggle-btn');
    if (!panel) return;
    _cbpOpen = true;
    panel.classList.remove('hidden');
    if (btn) btn.classList.add('active');
    try { localStorage.setItem(CBP_OPEN_KEY, '1'); } catch (e) {}
    _cbpStartPolling();
}

function closeBrowserPanel() {
    if (!_cbpOpen) return;
    const panel = document.getElementById('browser-panel');
    const btn = document.getElementById('browser-panel-toggle-btn');
    _cbpOpen = false;
    if (panel) panel.classList.add('hidden');
    if (btn) btn.classList.remove('active');
    try { localStorage.setItem(CBP_OPEN_KEY, '0'); } catch (e) {}
    _cbpStopPolling();
    if (_cbpControlling) cbpToggleControl();
}

function toggleBrowserPanel() {
    if (_cbpOpen) closeBrowserPanel();
    else openBrowserPanel();
}

// =====================================================================
// Polling -- same /api/browser/status + /api/browser/frame endpoints the
// standalone Browser View page uses (channel/web/api/browser_view.py).
// =====================================================================

function _cbpStartPolling() {
    _cbpStopPolling();
    fetch('/api/browser/status').then(r => {
        if (r.status === 403) { closeBrowserPanel(); return null; }
        return r.json();
    }).then(data => {
        if (!data) return;
        _cbpApplyStatus(data);
    }).catch(() => {});
    _cbpStatusPollTimer = setInterval(_cbpPollStatus, 2000);
    _cbpFramePollTimer = setInterval(_cbpPollFrame, 700);
    _cbpWireControlHandlers();
}

function _cbpStopPolling() {
    if (_cbpFramePollTimer) { clearInterval(_cbpFramePollTimer); _cbpFramePollTimer = null; }
    if (_cbpStatusPollTimer) { clearInterval(_cbpStatusPollTimer); _cbpStatusPollTimer = null; }
}

function _cbpPollStatus() {
    if (typeof _activityIsChatViewActive === 'function' && !_activityIsChatViewActive()) return;
    fetch('/api/browser/status').then(r => r.json()).then(_cbpApplyStatus).catch(() => {});
}

function _cbpApplyStatus(data) {
    if (data.status !== 'success') return;
    const wasRunning = _cbpRunning;
    _cbpRunning = !!data.running;
    document.getElementById('cbp-idle')?.classList.toggle('hidden', _cbpRunning);
    document.getElementById('cbp-frame')?.classList.toggle('hidden', !_cbpRunning);
    const infoEl = document.getElementById('cbp-page-info');
    if (infoEl) infoEl.textContent = _cbpRunning ? `${data.title || ''} — ${data.url || ''}` : '';
    _cbpSetStatusText(_cbpRunning ? (t('browser_view_live') || 'Live') : '');
    // The page just became watchable (or the panel just opened onto an
    // already-running session) -- size its real viewport to the panel's
    // actual on-screen box so the frame fills it instead of coming back
    // letterboxed/cropped against whatever size it happened to launch at.
    if (_cbpRunning && !wasRunning) _cbpFitViewport();
}

function _cbpFitViewport() {
    const body = document.getElementById('cbp-body');
    if (!body) return;
    const width = Math.round(body.clientWidth);
    const height = Math.round(body.clientHeight);
    if (width < 50 || height < 50) return; // not laid out yet -- nothing sane to send
    const key = `${width}x${height}`;
    if (key === _cbpFittedFor) return;
    _cbpFittedFor = key;
    cbpSendControl({ action: 'resize', width, height });
}

function _cbpSetStatusText(message) {
    const el = document.getElementById('cbp-status');
    if (el) el.textContent = message || '';
}

function _cbpPollFrame() {
    if (!_cbpRunning) return;
    if (typeof _activityIsChatViewActive === 'function' && !_activityIsChatViewActive()) return;
    const img = document.getElementById('cbp-frame');
    if (img) img.src = `/api/browser/frame?t=${Date.now()}`;
}

// =====================================================================
// Bidirectional takeover -- click/type/scroll on the live page, against the
// same shared browser session via /api/browser/control.
// =====================================================================

function cbpToggleControl() {
    _cbpControlling = !_cbpControlling;
    document.getElementById('cbp-control-toggle')?.classList.toggle('active', _cbpControlling);
    document.getElementById('cbp-body')?.classList.toggle('bv-controlling', _cbpControlling);
    document.getElementById('cbp-control-bar')?.classList.toggle('hidden', !_cbpControlling);
    if (_cbpControlling) document.getElementById('cbp-control-input')?.focus();
}

function _cbpWireControlHandlers() {
    const img = document.getElementById('cbp-frame');
    const body = document.getElementById('cbp-body');
    if (!img || !body || img.dataset.cbpWired) return;
    img.dataset.cbpWired = '1';

    img.addEventListener('click', (e) => {
        if (!_cbpControlling || !_cbpRunning) return;
        const rect = img.getBoundingClientRect();
        const scale = img.naturalWidth / rect.width;
        const x = (e.clientX - rect.left) * scale;
        const y = (e.clientY - rect.top) * scale;
        cbpSendControl({ action: 'click', x, y });
    });

    body.addEventListener('wheel', (e) => {
        if (!_cbpControlling || !_cbpRunning) return;
        e.preventDefault();
        cbpSendControl({ action: 'scroll', dx: e.deltaX, dy: e.deltaY });
    }, { passive: false });
}

function cbpHandleKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const input = document.getElementById('cbp-control-input');
    const text = input.value;
    input.value = '';
    if (text) {
        cbpSendControl({ action: 'type', text }).then(() => cbpSendKey('Enter'));
    } else {
        cbpSendKey('Enter');
    }
}

function cbpSendKey(key) {
    cbpSendControl({ action: 'key', key });
}

function cbpSendControl(payload) {
    return fetch('/api/browser/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _cbpSetStatusText(data.message || 'Control action failed'); return; }
        _cbpPollFrame();
    }).catch(() => {});
}

// =====================================================================
// Resizer -- same drag pattern as workspace.js's initWorkspaceResizer.
// =====================================================================

function _initBrowserPanelResizer() {
    const resizer = document.getElementById('bp-resizer');
    const panel = document.getElementById('browser-panel');
    if (!resizer || !panel) return;

    let startX = 0;
    let startWidth = 0;

    function onMove(e) {
        const delta = startX - e.clientX;
        const next = Math.max(CBP_MIN_WIDTH, Math.min(window.innerWidth * 0.7, startWidth + delta));
        panel.style.width = `${next}px`;
    }

    function onUp() {
        resizer.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try { localStorage.setItem(CBP_WIDTH_KEY, String(parseInt(panel.style.width, 10) || CBP_DEFAULT_WIDTH)); } catch (e) {}
        if (_cbpRunning) _cbpFitViewport();
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

// =====================================================================
// Boot
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('browser-panel');
    if (panel) {
        let width = CBP_DEFAULT_WIDTH;
        try { width = parseInt(localStorage.getItem(CBP_WIDTH_KEY), 10) || CBP_DEFAULT_WIDTH; } catch (e) {}
        panel.style.width = `${width}px`;
    }
    _initBrowserPanelResizer();
    try {
        // Closed by default -- reopens only if the user explicitly left it
        // open last session, otherwise it auto-opens the moment the agent
        // actually starts using the browser tool (see chat/send.js's
        // tool_start handler).
        if (localStorage.getItem(CBP_OPEN_KEY) === '1') openBrowserPanel();
    } catch (e) {}
});
