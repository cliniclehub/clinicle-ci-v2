/* Review Queue view: the shared list of AI-raised flags (Quality Supervisor,
 * Revenue Optimizer, VAT Compliance, Financial Controller) a human reviews.
 * Nothing here is auto-actioned -- Approve/Dismiss are the only state
 * changes, and they only happen from a click in this UI. */

const RQ_CATEGORY_LABELS = {
    quality: 'Quality', revenue: 'Revenue', vat_compliance: 'VAT Compliance',
    financial: 'Financial', inventory: 'Inventory', other: 'Other',
};
const RQ_SEVERITY_COLORS = {
    critical: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
    medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    low: 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400',
};

function loadReviewQueue() {
    const status = document.getElementById('rq-status-filter').value;
    const category = document.getElementById('rq-category-filter').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    fetch(`/api/review-queue?${params.toString()}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _rqStatus(data.message || 'Could not load review queue', true); return; }
        _renderReviewQueue(data.flags || []);
    }).catch(() => _rqStatus('Could not reach the server', true));
}

function _rqStatus(message, isError) {
    const el = document.getElementById('review-queue-status');
    if (!el) return;
    if (!message) { el.classList.add('opacity-0'); return; }
    el.textContent = message;
    el.className = `text-sm mb-4 transition-opacity duration-150 ${isError ? 'text-red-500' : 'text-emerald-500'}`;
}

function _rqDateLabel(unixSeconds) {
    try {
        return new Date(unixSeconds * 1000).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch (e) { return ''; }
}

function _renderReviewQueue(flags) {
    const list = document.getElementById('review-queue-list');
    if (!list) return;
    if (!flags.length) {
        list.innerHTML = '<div class="text-surface-400 dark:text-surface-500 text-sm py-8 text-center">Nothing here yet.</div>';
        return;
    }
    list.innerHTML = flags.map(f => `
        <div class="p-4 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-surface-800">
            <div class="flex items-start justify-between gap-3 mb-1.5">
                <div class="min-w-0">
                    <div class="text-sm font-semibold text-surface-800 dark:text-surface-100">${escapeHtml(f.title)}</div>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-medium ${RQ_SEVERITY_COLORS[f.severity] || RQ_SEVERITY_COLORS.medium}">${escapeHtml((f.severity || 'medium').toUpperCase())}</span>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">${escapeHtml(RQ_CATEGORY_LABELS[f.category] || f.category)}</span>
                        <span class="text-[11px] text-surface-400 dark:text-surface-500">from ${escapeHtml(f.source_agent_id)} &middot; ${_rqDateLabel(f.created_at)}</span>
                    </div>
                </div>
                ${f.status === 'open' ? `
                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="actionFlag('${f.id}', 'approved')"
                            class="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 cursor-pointer">Approve</button>
                    <button onclick="actionFlag('${f.id}', 'dismissed')"
                            class="px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-50 dark:bg-surface-700/40 text-surface-500 dark:text-surface-400 hover:bg-surface-100 cursor-pointer">Dismiss</button>
                </div>` : `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${f.status === 'approved' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'}">${escapeHtml(f.status.toUpperCase())}</span>`}
            </div>
            ${f.detail ? `<div class="text-xs text-surface-500 dark:text-surface-400 mt-1">${escapeHtml(f.detail)}</div>` : ''}
            ${f.evidence_ref ? `<div class="text-[11px] text-surface-400 dark:text-surface-500 mt-1 font-mono">Evidence: ${escapeHtml(f.evidence_ref)}</div>` : ''}
        </div>`).join('');
}

function actionFlag(flagId, status) {
    fetch(`/api/review-queue/${encodeURIComponent(flagId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _rqStatus(data.message || 'Could not update flag', true); return; }
        _rqStatus(`Flag ${status}.`, false);
        loadReviewQueue();
    }).catch(() => _rqStatus('Could not reach the server', true));
}
