/* Alerts view: reads /api/alerts and renders a severity-ranked feed of
 * genuine audit-log signals (failed logins, chain breaks, role/secret
 * changes, failed background tasks, ...). See channel/web/api/alerts.py
 * for the severity mapping and what is deliberately excluded as noise. */

const _ALERT_SEVERITY_STYLE = {
    critical: { icon: 'fa-circle-exclamation', badge: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' },
    high: { icon: 'fa-triangle-exclamation', badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
    medium: { icon: 'fa-circle-info', badge: 'bg-surface-200 dark:bg-surface-600 text-surface-600 dark:text-surface-300' },
    info: { icon: 'fa-circle-check', badge: 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400' },
};

function loadAlertsView() {
    const status = document.getElementById('alerts-status');
    fetch('/api/alerts').then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            if (status) { status.textContent = data.message || 'Could not load alerts'; status.classList.remove('opacity-0'); }
            return;
        }
        if (status) status.classList.add('opacity-0');
        _renderAlerts(data.alerts || [], data.counts || {});
    }).catch(() => {
        if (status) { status.textContent = 'Could not reach the server'; status.classList.remove('opacity-0'); }
    });
}

function _alertTimeLabel(unixSeconds) {
    if (!unixSeconds) return 'unknown time';
    try {
        return new Date(unixSeconds * 1000).toLocaleString();
    } catch (e) {
        return '';
    }
}

function _renderAlerts(alerts, counts) {
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    setText('alerts-count-critical', Number(counts.critical || 0).toLocaleString());
    setText('alerts-count-high', Number(counts.high || 0).toLocaleString());
    setText('alerts-count-medium', Number(counts.medium || 0).toLocaleString());
    setText('alerts-count-info', Number(counts.info || 0).toLocaleString());
    setText('alerts-feed-count', `${alerts.length.toLocaleString()} alert${alerts.length === 1 ? '' : 's'}`);

    const list = document.getElementById('alerts-list');
    if (!list) return;
    list.innerHTML = alerts.map(a => {
        const style = _ALERT_SEVERITY_STYLE[a.severity] || _ALERT_SEVERITY_STYLE.info;
        return `
            <div class="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-surface-50 dark:bg-surface-700/40">
                <span class="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 mt-0.5 ${style.badge}">
                    <i class="fas ${style.icon} text-[11px]"></i>
                </span>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-medium text-surface-700 dark:text-surface-200">${escapeHtml(a.description)}</span>
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${style.badge}">${escapeHtml(a.severity)}</span>
                    </div>
                    <div class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                        ${escapeHtml(_alertTimeLabel(a.ts))} &middot; ${escapeHtml(a.actor || 'unknown')} &middot; ${escapeHtml(a.event_type)}
                    </div>
                </div>
            </div>`;
    }).join('') || '<div class="text-surface-400 py-6 text-center">No alerts. Everything looks quiet.</div>';
}
