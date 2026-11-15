/* Analytics view: reads /api/analytics and renders stat cards plus simple
 * CSS-bar trend charts (divs sized by height %) -- no charting library, see
 * channel/web/api/analytics.py for what each number is computed from. */

let analyticsRangeDays = 14;

function setAnalyticsRange(days) {
    analyticsRangeDays = Number(days) || 14;
    loadAnalyticsView();
}

function loadAnalyticsView() {
    const status = document.getElementById('analytics-status');
    const select = document.getElementById('an-range-select');
    if (select) select.value = String(analyticsRangeDays);
    fetch(`/api/analytics?days=${analyticsRangeDays}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            if (status) { status.textContent = data.message || 'Could not load metrics'; status.classList.remove('opacity-0'); }
            return;
        }
        if (status) status.classList.add('opacity-0');
        _renderAnalyticsMetrics(data.metrics || {});
    }).catch(() => {
        if (status) { status.textContent = 'Could not reach the server'; status.classList.remove('opacity-0'); }
    });
    _loadUsageSummary();
}

// Token/cost ledger (agent/memory/model_pricing.py, /api/usage/summary) --
// a separate fetch from /api/analytics since it reads a different table and
// can 403 independently (its own "analytics" capability check) without
// blanking out the rest of the page.
function _loadUsageSummary() {
    fetch(`/api/usage/summary?days=${analyticsRangeDays}`).then(r => r.json()).then(data => {
        const section = document.getElementById('an-usage-section');
        if (data.status !== 'success') { if (section) section.classList.add('hidden'); return; }
        if (section) section.classList.remove('hidden');
        const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        setText('an-usage-tokens', Number(data.total_tokens || 0).toLocaleString());
        setText('an-usage-cost', `$${Number(data.total_cost_usd || 0).toFixed(2)}`);

        // _renderBarTrend expects a `count` field on each point (it drives
        // both the bar height and the series max) -- reused as-is for cost
        // rather than duplicating that chart logic for one extra series shape.
        const costTrend = (data.trend || []).map(p => ({ date: p.date, count: Math.round((p.cost_usd || 0) * 100) / 100 }));
        _renderBarTrend('an-usage-chart', costTrend, 'bg-emerald-400 dark:bg-emerald-500');

        const byModel = data.by_model || [];
        const list = document.getElementById('an-usage-by-model');
        if (list) {
            list.innerHTML = byModel.map(m => `
                <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-700/40">
                    <span class="truncate text-surface-600 dark:text-surface-300">${escapeHtml(m.model || '—')}</span>
                    <span class="font-medium text-surface-500 dark:text-surface-400 shrink-0 ml-2">
                        ${Number(m.total_tokens || 0).toLocaleString()} tok · $${Number(m.cost_usd || 0).toFixed(2)}
                    </span>
                </div>`).join('');
        }
        const note = document.getElementById('an-usage-disabled-note');
        if (note) note.classList.toggle('hidden', byModel.length > 0);
    }).catch(() => {
        const section = document.getElementById('an-usage-section');
        if (section) section.classList.add('hidden');
    });
}

function _anDayLabel(isoDate) {
    try {
        const [y, m, d] = isoDate.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
        return isoDate;
    }
}

function _renderBarTrend(containerId, series, barColorClass) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!series.length) {
        el.innerHTML = '<div class="text-surface-400 text-xs self-center">No activity recorded yet.</div>';
        return;
    }
    const max = Math.max(1, ...series.map(p => p.count));
    el.innerHTML = series.map(p => `
        <div class="flex-1 flex flex-col items-center justify-end h-full group" title="${escapeHtml(p.date)}: ${p.count}">
            <div class="w-full rounded-t ${barColorClass} transition-all" style="height: ${Math.max(2, Math.round((p.count / max) * 100))}%"></div>
            <div class="text-[9px] text-surface-400 dark:text-surface-500 mt-1 whitespace-nowrap">${escapeHtml(_anDayLabel(p.date))}</div>
        </div>`).join('');
}

function _renderAnalyticsMetrics(m) {
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const days = Number(m.trend_days || 14);

    const queryTrend = m.query_trend || [];
    const queryTotal = queryTrend.reduce((sum, p) => sum + p.count, 0);
    setText('an-queries-total', queryTotal.toLocaleString());
    setText('an-queries-label', `Queries, last ${days} days`);
    _renderBarTrend('an-query-chart', queryTrend, 'bg-primary-400 dark:bg-primary-500');

    const egressTrend = m.egress_trend || [];
    const egressTotal = egressTrend.reduce((sum, p) => sum + p.count, 0);
    setText('an-egress-total', egressTotal.toLocaleString());
    setText('an-egress-label', `Egress calls, last ${days} days`);
    _renderBarTrend('an-egress-chart', egressTrend, 'bg-amber-400 dark:bg-amber-500');

    const byTool = document.getElementById('an-egress-by-tool');
    if (byTool) {
        const tools = m.egress_by_tool || [];
        byTool.innerHTML = tools.map(entry => `
            <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-50 dark:bg-surface-700/40">
                <span class="truncate text-surface-600 dark:text-surface-300">${escapeHtml(entry.tool)}</span>
                <span class="font-medium text-surface-500 dark:text-surface-400 shrink-0 ml-2">${Number(entry.count).toLocaleString()}</span>
            </div>`).join('') || '<div class="text-surface-400 py-2 text-center">No outbound calls recorded.</div>';
    }

    const taskCompletion = m.task_completion || { teams: [], total: 0, done: 0 };
    const taskRate = taskCompletion.total ? Math.round((taskCompletion.done / taskCompletion.total) * 100) : 0;
    setText('an-task-rate', `${taskRate}%`);
    setText('an-task-sub', `${taskCompletion.done}/${taskCompletion.total} tasks done, all teams`);

    const teamList = document.getElementById('an-team-list');
    if (teamList) {
        const teams = taskCompletion.teams || [];
        teamList.innerHTML = teams.map(team => {
            const pct = team.total ? Math.round((team.done / team.total) * 100) : 0;
            return `
            <div>
                <div class="flex items-center justify-between mb-1">
                    <span class="text-surface-600 dark:text-surface-300 truncate">${escapeHtml(team.team_name)}</span>
                    <span class="text-surface-400 dark:text-surface-500 shrink-0 ml-2">${team.done}/${team.total}</span>
                </div>
                <div class="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                    <div class="h-full bg-emerald-400 dark:bg-emerald-500" style="width: ${pct}%"></div>
                </div>
            </div>`;
        }).join('') || '<div class="text-surface-400 py-2 text-center">No tasks recorded yet.</div>';
    }

    const autopilot = m.autopilot_accuracy || { touched: 0, auto_done: 0, needs_review: 0 };
    if (autopilot.touched > 0) {
        const rate = Math.round((autopilot.auto_done / autopilot.touched) * 100);
        setText('an-autopilot-rate', `${rate}%`);
        setText('an-autopilot-sub', `${autopilot.auto_done}/${autopilot.touched} tasks closed without a human, ${autopilot.needs_review} flagged for review`);
    } else {
        setText('an-autopilot-rate', '—');
        setText('an-autopilot-sub', 'No Autopilot runs recorded yet');
    }

    const perAgentList = document.getElementById('an-per-agent-list');
    if (perAgentList) {
        const perAgent = m.per_agent_queries || [];
        const max = Math.max(1, ...perAgent.map(a => a.count));
        perAgentList.innerHTML = perAgent.map(a => `
            <div>
                <div class="flex items-center justify-between mb-1">
                    <span class="text-surface-600 dark:text-surface-300 truncate">${escapeHtml(a.agent_name)}</span>
                    <span class="text-surface-400 dark:text-surface-500 shrink-0 ml-2">${Number(a.count).toLocaleString()}</span>
                </div>
                <div class="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                    <div class="h-full bg-primary-400 dark:bg-primary-500" style="width: ${Math.round((a.count / max) * 100)}%"></div>
                </div>
            </div>`).join('') || '<div class="text-surface-400 py-2 text-center">No queries recorded yet.</div>';
    }
}
