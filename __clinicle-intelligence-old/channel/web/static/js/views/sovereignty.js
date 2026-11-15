/* Sovereignty & Trust view: reads /api/sovereignty/metrics and renders the
 * proof-point tiles, data-residency checklist, tamper-evident audit panel
 * and egress ledger. "Sovereign Export" and "Print view" are plain links
 * (see sovereignty.html), so they need no JS of their own beyond window.print(). */

function loadSovereigntyView() {
    const status = document.getElementById('sovereignty-status');
    fetch('/api/sovereignty/metrics').then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            if (status) { status.textContent = data.message || 'Could not load metrics'; status.classList.remove('opacity-0'); }
            return;
        }
        if (status) status.classList.add('opacity-0');
        _renderSovereigntyMetrics(data.metrics || {});
    }).catch(() => {
        if (status) { status.textContent = 'Could not reach the server'; status.classList.remove('opacity-0'); }
    });
    _loadRetentionSetting();
}

// -- Data retention ---------------------------------------------------------
// Deletes whole conversations, never audit-chain entries -- see the card's
// own copy in sovereignty.html for why. Purge is a manual, confirmed action,
// never an automatic background sweep.

function _loadRetentionSetting() {
    fetch('/api/sovereignty/retention').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const input = document.getElementById('sov-retention-days');
        if (input) input.value = data.retention_days || 0;
        const pending = document.getElementById('sov-retention-pending');
        if (pending) {
            pending.textContent = data.retention_days > 0
                ? `${data.sessions_pending_purge} conversation(s) would be deleted right now`
                : 'Retention is disabled -- nothing will be purged';
        }
    }).catch(() => {});
}

function saveRetentionSetting() {
    const input = document.getElementById('sov-retention-days');
    const days = Number(input ? input.value : 0) || 0;
    fetch('/api/sovereignty/retention', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retention_days: days }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        _wsToast('Retention setting saved.');
        _loadRetentionSetting();
    }).catch(() => _wsToast(t('team_action_failed')));
}

function runRetentionPurge() {
    const input = document.getElementById('sov-retention-days');
    const days = Number(input ? input.value : 0) || 0;
    if (days <= 0) { _wsToast('Set a retention window above zero first.'); return; }
    if (!window.confirm(`This permanently deletes every conversation inactive for more than ${days} day(s). This cannot be undone. Continue?`)) return;
    fetch('/api/sovereignty/purge', { method: 'POST' }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        _wsToast(`${data.sessions_deleted} conversation(s) deleted.`);
        _loadRetentionSetting();
    }).catch(() => _wsToast(t('team_action_failed')));
}

function _sovDateLabel(unixSeconds) {
    if (!unixSeconds) return '';
    try {
        return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
        return '';
    }
}

function _renderSovereigntyMetrics(m) {
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    setText('sov-cost-avoided', `$${Number(m.cloud_cost_avoided_usd || 0).toFixed(2)}`);
    const benchmark = Number(m.benchmark_price_per_1m_tokens_usd || 0);
    setText('sov-cost-benchmark', `benchmarked vs a comparable hosted model ($${benchmark.toFixed(2)}/1M tokens)`);
    setText('sov-tokens-in', `${Number(m.tokens_in || 0).toLocaleString()} tokens in`);
    setText('sov-tokens-out', `${Number(m.tokens_out || 0).toLocaleString()} tokens out`);

    setText('sov-queries', Number(m.queries_served || 0).toLocaleString());
    const firstQueryLabel = _sovDateLabel(m.first_query_at);
    setText('sov-queries-sub', firstQueryLabel ? `since ${firstQueryLabel}` : ' ');

    setText('sov-tokens', Number(m.tokens_processed || 0).toLocaleString());
    setText('sov-documents', Number(m.documents_indexed || 0).toLocaleString());
    setText('sov-documents-sub', `${Number(m.documents_indexed || 0).toLocaleString()} indexed`);
    setText('sov-egress-total', Number(m.egress_call_count || 0).toLocaleString());
    setText('sov-egress-count', `${Number(m.egress_call_count || 0).toLocaleString()} outbound calls`);

    const residency = document.getElementById('sov-residency');
    if (residency) {
        const labels = {
            conversations: 'Conversations', model_weights: 'Model weights',
            logs: 'Logs & audit trail', documents: 'Documents',
        };
        const entries = Object.entries(m.data_residency || {});
        residency.innerHTML = entries.map(([key, ok]) => {
            const suffix = key === 'documents'
                ? `${Number(m.documents_indexed || 0).toLocaleString()} indexed`
                : (ok ? 'on-device' : 'not confirmed');
            return `
            <div class="flex items-center gap-2">
                <i class="fas ${ok ? 'fa-circle-check text-emerald-500' : 'fa-circle-xmark text-red-500'} text-xs"></i>
                <span class="text-surface-600 dark:text-surface-300">${escapeHtml(labels[key] || key)}</span>
                <span class="text-surface-400 dark:text-surface-500 ml-auto">${escapeHtml(suffix)}</span>
            </div>`;
        }).join('') || '<div class="text-surface-400">No data</div>';
    }

    const chainOk = !!m.tamper_evident_chain_verified;
    const chainPill = document.getElementById('sov-chain-pill');
    if (chainPill) {
        chainPill.className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${chainOk ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`;
        chainPill.innerHTML = `<i class="fas ${chainOk ? 'fa-check' : 'fa-triangle-exclamation'} text-[9px]"></i><span>${chainOk ? 'intact' : 'broken'}</span>`;
    }
    setText('sov-chain-count', Number(m.audit_entry_count || 0).toLocaleString());

    const list = document.getElementById('sov-egress-list');
    if (list) {
        const ledger = m.egress_ledger || [];
        list.innerHTML = ledger.map(entry => `
            <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-700/40">
                <span class="truncate text-surface-600 dark:text-surface-300 flex items-center gap-1.5">
                    <i class="fas fa-globe text-[10px] opacity-50"></i>
                    ${escapeHtml(entry.tool)}${entry.target ? ' &rarr; ' + escapeHtml(entry.target) : ''}
                </span>
                <span class="font-medium text-surface-500 dark:text-surface-400 shrink-0 ml-2">${Number(entry.count).toLocaleString()}</span>
            </div>`).join('') || '<div class="text-surface-400 py-2 text-center">No outbound calls recorded.</div>';
    }
}
