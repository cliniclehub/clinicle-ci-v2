/* Overview view: a landing dashboard aggregating real state from existing
 * endpoints -- sovereignty metrics, the task board, the agent roster,
 * connectors and recent activity. Reuses each endpoint's own aggregation;
 * this file only fetches and renders. */

const OV_BOARD_COLUMNS = ['backlog', 'todo', 'in_progress', 'review', 'done'];
const OV_BOARD_LABELS = {
    backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done',
};
// Fixed categorical order/colors for the board's stacked-bar segments and
// legend -- never reassigned by count or filter, per the dataviz skill's
// "color follows the entity, never its rank" rule. Reuses hues already load-
// bearing elsewhere in this app (primary/amber/emerald) plus violet, which
// isn't used as a status color anywhere else in this app.
const OV_BOARD_COLORS = {
    backlog: 'bg-surface-300 dark:bg-surface-600',
    todo: 'bg-primary-400 dark:bg-primary-500',
    in_progress: 'bg-amber-400 dark:bg-amber-500',
    review: 'bg-violet-400 dark:bg-violet-500',
    done: 'bg-emerald-400 dark:bg-emerald-500',
};
const OV_BOARD_DOT_COLORS = {
    backlog: 'bg-surface-400 dark:bg-surface-500',
    todo: 'bg-primary-500', in_progress: 'bg-amber-500', review: 'bg-violet-500', done: 'bg-emerald-500',
};

const OV_GAUGE_CIRCUMFERENCE = 100.53; // 2 * PI * r(16), the SVG ring's own r in overview.html
let _ovSystemPollTimer = null;

// Polls while this view is on screen, same lifecycle as teams.js's
// _startTeamWorkPolling / board's stopBoardPolling -- nav.js's navigateTo()
// calls stopOverviewSystemPolling() when leaving, same as those.
function _startSystemPolling() {
    if (_ovSystemPollTimer) return;
    const poll = () => {
        if (currentView !== 'overview') { stopOverviewSystemPolling(); return; }
        fetch('/api/system/metrics').then(r => r.json()).then(data => {
            if (data.status !== 'success') return;
            const m = data.metrics || {};
            _renderSystemGauge('cpu', m.cpu_percent);
            _renderSystemGauge('gpu', m.gpu_percent);
            _renderSystemGauge('mem', m.memory_percent);
            _renderSystemGauge('disk', m.storage_percent);
        }).catch(() => {});
    };
    poll();
    _ovSystemPollTimer = setInterval(poll, 3000);
}

function stopOverviewSystemPolling() {
    if (_ovSystemPollTimer) { clearInterval(_ovSystemPollTimer); _ovSystemPollTimer = null; }
}
window.stopOverviewSystemPolling = stopOverviewSystemPolling;

function _renderSystemGauge(key, pct) {
    const ring = document.getElementById(`ov-${key}-ring`);
    const numEl = document.getElementById(`ov-${key}-pct`);
    if (!ring || !numEl) return;
    numEl.classList.remove('mc-skeleton');
    const gauge = ring.closest('.mc-gauge');
    const card = document.getElementById(`ov-${key}-card`);
    if (card) card.classList.remove('hidden');
    if (pct === null || pct === undefined) {
        numEl.textContent = 'N/A';
        ring.style.strokeDashoffset = OV_GAUGE_CIRCUMFERENCE;
        if (gauge) gauge.classList.add('mc-gauge-unavailable');
        return;
    }
    if (gauge) gauge.classList.remove('mc-gauge-unavailable');
    const clamped = Math.max(0, Math.min(100, pct));
    numEl.textContent = `${Math.round(clamped)}%`;
    ring.style.strokeDashoffset = String(OV_GAUGE_CIRCUMFERENCE * (1 - clamped / 100));
    ring.classList.remove('mc-gauge-fill-warn', 'mc-gauge-fill-danger');
    if (clamped >= 90) ring.classList.add('mc-gauge-fill-danger');
    else if (clamped >= 70) ring.classList.add('mc-gauge-fill-warn');
}

function loadOverviewView() {
    const status = document.getElementById('overview-status');
    const fail = () => { if (status) { status.textContent = 'Could not reach the server'; status.classList.remove('opacity-0'); } };

    _startSystemPolling();

    fetch('/api/sovereignty/metrics').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const m = data.metrics || {};
        _ovCountTo('ov-queries', Number(m.queries_served || 0));
        const chainEl = document.getElementById('ov-chain');
        if (chainEl) {
            chainEl.textContent = m.tamper_evident_chain_verified ? 'Intact' : 'Broken';
            chainEl.className = `mc-stat-pill ${m.tamper_evident_chain_verified ? 'mc-stat-pill-good' : 'mc-stat-pill-bad'}`;
        }

        const costEl = document.getElementById('ov-sov-cost-avoided');
        if (costEl) {
            costEl.classList.remove('mc-skeleton');
            costEl.textContent = `$${Number(m.cloud_cost_avoided_usd || 0).toFixed(2)}`;
        }
        const benchEl = document.getElementById('ov-sov-cost-benchmark');
        if (benchEl) {
            const benchmark = Number(m.benchmark_price_per_1m_tokens_usd || 0);
            benchEl.textContent = `benchmarked vs a comparable hosted model ($${benchmark.toFixed(2)}/1M tokens)`;
        }
        const tokensInEl = document.getElementById('ov-sov-tokens-in');
        if (tokensInEl) tokensInEl.textContent = `${Number(m.tokens_in || 0).toLocaleString()} tokens in`;
        const tokensOutEl = document.getElementById('ov-sov-tokens-out');
        if (tokensOutEl) tokensOutEl.textContent = `${Number(m.tokens_out || 0).toLocaleString()} tokens out`;

        _ovCountTo('ov-sov-queries', Number(m.queries_served || 0));
        _ovCountTo('ov-sov-tokens', Number(m.tokens_processed || 0));
        _ovCountTo('ov-sov-documents', Number(m.documents_indexed || 0));
        _ovCountTo('ov-sov-egress', Number(m.egress_call_count || 0));
    }).catch(fail);

    fetch('/api/board/tasks').then(r => r.json()).then(data => {
        const tasks = data.status === 'success' ? (data.tasks || []) : [];
        _renderOverviewBoard(tasks);
    }).catch(fail);

    fetch('/api/agents').then(r => r.json()).then(data => {
        const agents = data.status === 'success' ? (data.agents || []) : [];
        _renderOverviewRoster(agents);
    }).catch(fail);

    fetch('/api/connectors').then(r => r.json()).then(data => {
        const list = data.status === 'success' ? (data.connections || []) : [];
        _ovCountTo('ov-connectors', list.length);
    }).catch(fail);

    fetch('/api/activity').then(r => r.json()).then(data => {
        const items = data.status === 'success' ? (data.items || []) : [];
        _renderOverviewActivity(items);
    }).catch(fail);

    fetch('/api/review-queue?status=open').then(r => r.json()).then(data => {
        const flags = data.status === 'success' ? (data.flags || []) : [];
        _ovCountTo('ov-review-queue-open', flags.length);
        const el = document.getElementById('ov-review-queue-open');
        if (el) {
            const hasUrgent = flags.some(f => f.severity === 'critical' || f.severity === 'high');
            el.classList.toggle('text-red-500', flags.length > 0 && hasUrgent);
            el.classList.toggle('text-amber-500', flags.length > 0 && !hasUrgent);
        }
    }).catch(fail);

    fetch('/api/alerts').then(r => r.json()).then(data => {
        const alerts = data.status === 'success' ? (data.alerts || []) : [];
        const counts = (data.status === 'success' && data.counts) || {};
        _ovCountTo('ov-alerts-open', alerts.length);
        const el = document.getElementById('ov-alerts-open');
        if (el) el.classList.toggle('text-amber-500', Number(counts.critical || 0) + Number(counts.high || 0) > 0);
        _renderOverviewAlertsFeed(alerts);
    }).catch(fail);

    // App-wide coverage row -- one count per other product area, same
    // list-and-count each area's own view already fetches for itself.
    fetch('/api/workflows').then(r => r.json()).then(data => {
        const list = data.status === 'success' ? (data.workflows || []) : [];
        _ovCountTo('ov-workflows', list.length);
    }).catch(fail);

    fetch('/api/teams').then(r => r.json()).then(data => {
        const list = data.status === 'success' ? (data.teams || []) : [];
        _ovCountTo('ov-teams', list.length);
    }).catch(fail);

    fetch('/api/meetings').then(r => r.json()).then(data => {
        const list = data.status === 'success' ? (data.meetings || []) : [];
        _ovCountTo('ov-meetings', list.length);
    }).catch(fail);

    fetch('/api/knowledge/list').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const count = (data.tree || []).length + (data.root_files || []).length;
        _ovCountTo('ov-knowledge', count);
    }).catch(fail);

    fetch('/api/channels').then(r => r.json()).then(data => {
        const instances = data.status === 'success' ? (data.instances || []) : [];
        _ovCountTo('ov-channels', instances.length);
    }).catch(fail);

    fetch('/api/skills').then(r => r.json()).then(data => {
        const list = data.status === 'success' ? (data.skills || []) : [];
        _ovCountTo('ov-skills', list.length);
    }).catch(fail);

    // Same source Analytics' own charts read -- reuses its _renderBarTrend
    // renderer (analytics.js loads before this ever runs).
    fetch('/api/analytics?days=14').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const m = data.metrics || {};
        const days = Number(m.trend_days || 14);
        _renderOverviewQueryTrend(m.query_trend || [], days);

        const egressTrend = m.egress_trend || [];
        const egressTotal = egressTrend.reduce((sum, p) => sum + p.count, 0);
        const egressTotalEl = document.getElementById('ov-egress-trend-total');
        if (egressTotalEl) egressTotalEl.textContent = egressTotal.toLocaleString();
        if (typeof _renderBarTrend === 'function') {
            _renderBarTrend('ov-egress-chart', egressTrend, 'bg-amber-400 dark:bg-amber-500');
        }

        const taskCompletion = m.task_completion || { total: 0, done: 0 };
        const rate = taskCompletion.total ? Math.round((taskCompletion.done / taskCompletion.total) * 100) : 0;
        const rateEl = document.getElementById('ov-task-rate');
        if (rateEl) rateEl.textContent = `${rate}%`;
    }).catch(fail);
}

function _renderOverviewAlertsFeed(alerts) {
    const el = document.getElementById('ov-alerts-feed');
    if (!el) return;
    if (!alerts.length) {
        el.innerHTML = '<div class="text-surface-400 py-4 text-center">No alerts. Everything looks quiet.</div>';
        return;
    }
    const styles = typeof _ALERT_SEVERITY_STYLE !== 'undefined' ? _ALERT_SEVERITY_STYLE : {};
    const fallback = { icon: 'fa-circle-info', badge: 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400' };
    el.innerHTML = alerts.slice(0, 5).map(a => {
        const style = styles[a.severity] || fallback;
        return `
            <div class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-700/40">
                <span class="inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${style.badge}">
                    <i class="fas ${style.icon} text-[10px]"></i>
                </span>
                <span class="truncate text-surface-600 dark:text-surface-300 flex-1">${escapeHtml(a.description)}</span>
            </div>`;
    }).join('');
}

// Animated count-up: re-running loadOverviewView() on a later visit counts
// from the number already on screen, not from 0, so a small refresh doesn't
// look like every stat reset -- only the very first render starts at 0.
function _ovCountTo(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('mc-skeleton');
    target = Number(target) || 0;
    const start = Number(el.dataset.countTo || 0);
    el.dataset.countTo = target;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = target.toLocaleString();
        return;
    }
    const duration = 600;
    const startTime = performance.now();
    function tick(now) {
        const p = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(start + (target - start) * eased).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

function _renderOverviewBoard(tasks) {
    const el = document.getElementById('ov-board');
    if (!el) return;
    const counts = {};
    OV_BOARD_COLUMNS.forEach(c => { counts[c] = 0; });
    tasks.forEach(t => { if (counts[t.status] !== undefined) counts[t.status] += 1; });
    el.innerHTML = OV_BOARD_COLUMNS.map(col => `
        <div>
            <div class="text-xl font-bold text-surface-800 dark:text-surface-100">${counts[col]}</div>
            <div class="text-[11px] text-surface-400 dark:text-surface-500 mt-0.5">${escapeHtml(OV_BOARD_LABELS[col])}</div>
        </div>`).join('');

    const total = tasks.length;
    const bar = document.getElementById('ov-board-bar');
    if (bar) {
        bar.innerHTML = total === 0 ? '' : OV_BOARD_COLUMNS
            .filter(col => counts[col] > 0)
            .map(col => `<div class="${OV_BOARD_COLORS[col]} transition-all" style="width:${(counts[col] / total) * 100}%" title="${escapeHtml(OV_BOARD_LABELS[col])}: ${counts[col]}"></div>`)
            .join('<div class="w-0.5 bg-white dark:bg-surface-800"></div>');
    }
    const legend = document.getElementById('ov-board-legend');
    if (legend) {
        legend.innerHTML = OV_BOARD_COLUMNS.map(col => `
            <span class="inline-flex items-center gap-1.5 text-surface-500 dark:text-surface-400">
                <span class="w-2 h-2 rounded-full ${OV_BOARD_DOT_COLORS[col]}"></span>${escapeHtml(OV_BOARD_LABELS[col])}
            </span>`).join('');
    }
}

function _renderOverviewQueryTrend(trend, days) {
    const totalEl = document.getElementById('ov-query-trend-total');
    if (totalEl) {
        const total = trend.reduce((sum, p) => sum + p.count, 0);
        totalEl.textContent = `${total.toLocaleString()} in last ${days} days`;
    }
    if (typeof _renderBarTrend === 'function') {
        _renderBarTrend('ov-query-chart', trend, 'bg-primary-400 dark:bg-primary-500');
    }
}

function _renderOverviewRoster(agents) {
    _ovCountTo('ov-agents', agents.length);
    const el = document.getElementById('ov-roster');
    if (!el) return;
    if (!agents.length) {
        el.innerHTML = '<div class="text-surface-400">No agents configured.</div>';
        return;
    }
    el.innerHTML = agents.slice(0, 6).map(a => `
        <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-700/40">
            <span class="truncate text-surface-600 dark:text-surface-300">${escapeHtml(a.name || a.id)}</span>
            <span class="text-[11px] font-medium ${a.enabled ? 'text-emerald-500' : 'text-surface-400'} shrink-0 ml-2">${a.enabled ? 'enabled' : 'disabled'}</span>
        </div>`).join('') + (agents.length > 6 ? `<div class="text-[11px] text-surface-400 pt-1">+${agents.length - 6} more</div>` : '');
}

function _renderOverviewActivity(items) {
    const el = document.getElementById('ov-activity');
    if (!el) return;
    if (!items.length) {
        el.innerHTML = '<div class="text-surface-400 py-2 text-center">No recent activity.</div>';
        return;
    }
    el.innerHTML = items.slice(0, 10).map(i => `
        <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-700/40">
            <span class="truncate text-surface-600 dark:text-surface-300">${escapeHtml(i.subject || i.team_name || 'Activity')}</span>
            <span class="text-surface-400 dark:text-surface-500 shrink-0 ml-2">${escapeHtml(OV_BOARD_LABELS[i.status] || (i.status || '').replace(/_/g, ' '))}</span>
        </div>`).join('');
}
