/* Pending Edits view: file changes an Agent staged for approval instead of
 * applying immediately (agent/permission/execution_gate.py). Same
 * "nothing auto-actioned, only a click here decides" shape as
 * views/review-queue.js -- Accept actually runs the staged edit/write,
 * Reject discards it, and both only happen from a click in this UI. */

function loadPendingEdits() {
    const status = document.getElementById('pe-status-filter').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    fetch(`/api/pending-edits?${params.toString()}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _peStatus(data.message || 'Could not load pending edits', true); return; }
        _renderPendingEdits(data.pending_edits || []);
    }).catch(() => _peStatus('Could not reach the server', true));
}

function _peStatus(message, isError) {
    const el = document.getElementById('pending-edits-status');
    if (!el) return;
    if (!message) { el.classList.add('opacity-0'); return; }
    el.textContent = message;
    el.className = `text-sm mb-4 transition-opacity duration-150 ${isError ? 'text-red-500' : 'text-emerald-500'}`;
}

function _peDateLabel(unixSeconds) {
    try {
        return new Date(unixSeconds * 1000).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch (e) { return ''; }
}

// A hunk-level render, not a plain <pre> dump: +/- lines get their own
// background so the change is scannable at a glance, matching what a
// unified diff's own +/-/context convention already encodes.
function _renderDiffHtml(diff) {
    if (!diff) return '<div class="text-xs text-surface-400 italic">No diff available.</div>';
    const lines = diff.split('\n').map(line => {
        let cls = 'text-surface-500 dark:text-surface-400';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400';
        else if (line.startsWith('@@')) cls = 'text-primary-500 dark:text-primary-400 font-semibold';
        return `<div class="${cls} px-2 whitespace-pre-wrap font-mono text-[11px] leading-5">${escapeHtml(line) || '&nbsp;'}</div>`;
    });
    return `<div class="rounded-lg border border-surface-200 dark:border-white/10 overflow-hidden divide-y divide-surface-100 dark:divide-white/5">${lines.join('')}</div>`;
}

const PE_STATUS_BADGE = {
    pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    rejected: 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400',
};

function _renderPendingEdits(edits) {
    const list = document.getElementById('pending-edits-list');
    if (!list) return;
    if (!edits.length) {
        list.innerHTML = '<div class="text-surface-400 dark:text-surface-500 text-sm py-8 text-center">Nothing staged for approval.</div>';
        return;
    }
    list.innerHTML = edits.map(e => `
        <div class="p-4 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-surface-800">
            <div class="flex items-start justify-between gap-3 mb-2">
                <div class="min-w-0">
                    <div class="text-sm font-semibold text-surface-800 dark:text-surface-100 font-mono truncate">${escapeHtml(e.path || '(no path)')}</div>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">${escapeHtml((e.tool_name || '').toUpperCase())}</span>
                        <span class="text-[11px] text-surface-400 dark:text-surface-500">from ${escapeHtml(e.agent_id || 'unknown agent')} &middot; ${_peDateLabel(e.created_at)}</span>
                    </div>
                </div>
                ${e.status === 'pending' ? `
                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="actionPendingEdit('${e.id}', 'approve')"
                            class="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 cursor-pointer">Accept</button>
                    <button onclick="actionPendingEdit('${e.id}', 'reject')"
                            class="px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-50 dark:bg-surface-700/40 text-surface-500 dark:text-surface-400 hover:bg-surface-100 cursor-pointer">Reject</button>
                </div>` : `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${PE_STATUS_BADGE[e.status] || PE_STATUS_BADGE.rejected}">${escapeHtml(e.status.toUpperCase())}</span>`}
            </div>
            ${_renderDiffHtml(e.diff)}
            ${e.status !== 'pending' && e.result ? `
            <div class="text-[11px] text-surface-400 dark:text-surface-500 mt-2">
                Applied result: ${escapeHtml(e.result.status || '')} ${e.result.result && e.result.result.message ? '&middot; ' + escapeHtml(e.result.result.message) : ''}
            </div>` : ''}
        </div>`).join('');
}

// =====================================================================
// Inline chat card: the SAME pending edit and the SAME /api/pending-edits
// action endpoint as the dedicated page above, rendered as a card right
// after the staged tool call in the live conversation (channel/web/core/
// channel.py's tool_end payload carries pending_approval/pending_id/diff/
// path -- see chat/send.js's tool_end handler). A human reviewing mid-chat
// never has to leave for the Pending Edits page just to unblock the agent.
// =====================================================================

function _appendPendingApprovalCard(toolEl, item) {
    if (!toolEl || !toolEl.parentElement) return;
    // Avoid stacking a duplicate card if the same event is ever delivered twice.
    if (toolEl.nextElementSibling
        && toolEl.nextElementSibling.classList
        && toolEl.nextElementSibling.classList.contains('pending-approval-card')) {
        return;
    }
    const card = document.createElement('div');
    card.className = 'pending-approval-card';
    card.innerHTML = `
        <div class="pending-approval-header">
            <i class="fas fa-code-compare"></i>
            <span>Staged for your approval${item.path ? ': ' + escapeHtml(item.path) : ''}</span>
        </div>
        <div class="pending-approval-diff">${_renderDiffHtml(item.diff)}</div>
        <div class="pending-approval-actions">
            <button type="button" class="pending-approval-accept">Accept</button>
            <button type="button" class="pending-approval-reject">Reject</button>
        </div>
        <div class="pending-approval-result"></div>`;
    card.querySelector('.pending-approval-accept').addEventListener('click', () => _actionInlinePendingEdit(item.pending_id, 'approve', card));
    card.querySelector('.pending-approval-reject').addEventListener('click', () => _actionInlinePendingEdit(item.pending_id, 'reject', card));
    toolEl.parentElement.insertBefore(card, toolEl.nextElementSibling);
}

function _actionInlinePendingEdit(pendingId, action, card) {
    const buttons = card.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    fetch(`/api/pending-edits/${encodeURIComponent(pendingId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
    }).then(r => r.json()).then(data => {
        const resultEl = card.querySelector('.pending-approval-result');
        if (data.status !== 'success') {
            if (resultEl) resultEl.textContent = data.message || 'Could not update this edit.';
            buttons.forEach(b => { b.disabled = false; });
            return;
        }
        const actionsEl = card.querySelector('.pending-approval-actions');
        if (actionsEl) actionsEl.remove();
        card.classList.add('pending-approval-resolved');
        if (resultEl) resultEl.textContent = action === 'approve' ? 'Applied.' : 'Rejected.';
    }).catch(() => {
        const resultEl = card.querySelector('.pending-approval-result');
        if (resultEl) resultEl.textContent = 'Could not reach the server.';
        buttons.forEach(b => { b.disabled = false; });
    });
}

function actionPendingEdit(pendingId, action) {
    fetch(`/api/pending-edits/${encodeURIComponent(pendingId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _peStatus(data.message || 'Could not update pending edit', true); return; }
        _peStatus(action === 'approve' ? 'Change applied.' : 'Change rejected.', false);
        loadPendingEdits();
    }).catch(() => _peStatus('Could not reach the server', true));
}
