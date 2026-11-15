/* Home/chat view: the Approvals bar (session permission mode + Clear chat +
 * Activity toggle) and the Activity side panel (live feed of background
 * agent work).
 *
 * Permission mode reuses the exact session-settings mechanism the composer's
 * own permission chip already drives (chat/session-settings.js's `_sessCfg`
 * and `selectSessionPermission`) rather than a parallel global-only path, so
 * the two controls can never disagree.
 *
 * The Activity feed and the Autopilot toggle read/write the same team_id the
 * Task Board view uses (views/task-board.js's `board-active-team` localStorage
 * key and its `/api/board/*` endpoints) -- no second, independent Autopilot
 * flag. Card data comes from the read-only `/api/activity` endpoint, which
 * aggregates real team tasks (in_progress/review) and running subagent spawns
 * -- nothing here is mocked.
 */

const ACTIVITY_ICONS = {
    research: 'fa-magnifying-glass',
    analysis: 'fa-chart-column',
    autopilot: 'fa-bolt',
    general: 'fa-robot',
};

let _activityPollTimer = null;
let _activityTeamsCache = null; // /api/teams response, refreshed lazily
let _activityExpanded = new Set(); // ids of expanded cards, survives a re-render

function _activityPanelKey() { return 'activity-panel-open'; }

function _activityIsChatViewActive() {
    const el = document.getElementById('view-chat');
    return !!(el && el.classList.contains('active'));
}

// =====================================================================
// Approvals bar: backend status pill + permission segmented control
// =====================================================================

function _initApprovalsBar() {
    // Static placeholder: this instance has no existing health-check /
    // reachability primitive for the configured model provider to build on,
    // and adding one (resolving a model name back to a provider's base_url)
    // is a separate feature on its own. Shows "Online" unconditionally.
    // ponytail: no real reachability ping, add one if this needs to be honest
    // about a down provider.
    _renderApprovalsSegmented();
}

function _renderApprovalsSegmented() {
    const wrap = document.getElementById('approvals-segmented');
    if (!wrap) return;
    const mode = (typeof _sessCfg !== 'undefined' && _sessCfg && _sessCfg.permission && _sessCfg.permission.mode)
        || 'full-access';
    wrap.querySelectorAll('.approvals-seg-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

function setApprovalsMode(mode) {
    if (typeof selectSessionPermission !== 'function') return;
    selectSessionPermission(mode).then(() => _renderApprovalsSegmented());
    // Optimistic paint so the click feels immediate even before the request lands.
    document.querySelectorAll('#approvals-segmented .approvals-seg-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

// =====================================================================
// Activity panel: open/close
// =====================================================================

function toggleActivityPanel() {
    const panel = document.getElementById('activity-panel');
    const btn = document.getElementById('activity-toggle-btn');
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    if (btn) btn.classList.toggle('active', opening);
    try { localStorage.setItem(_activityPanelKey(), opening ? '1' : '0'); } catch (e) {}
    if (opening) _refreshActivity();
}

// =====================================================================
// Team resolution -- same team the Task Board view's Autopilot toggle
// targets (views/task-board.js), read via its own localStorage key so both
// controls always agree on which team "Autopilot" means.
// =====================================================================

function _activityLoadTeams() {
    if (_activityTeamsCache) return Promise.resolve(_activityTeamsCache);
    return fetch('/api/teams').then(r => r.json()).then(data => {
        _activityTeamsCache = (data.status === 'success' && data.teams) || [];
        return _activityTeamsCache;
    }).catch(() => []);
}

function _activityCurrentTeam() {
    return _activityLoadTeams().then(teams => {
        if (!teams.length) return null;
        // Inside a Teams pane (EMBED_MODE, see chat/state.js) Autopilot must
        // target the pane's own agent's team, never the unrelated Task Board
        // selection -- 'board-active-team' is a different feature's key and
        // means nothing to this pane. No match (shouldn't happen -- the pane
        // only exists because its agent is on some team) disables the toggle
        // rather than falling through to an unrelated team.
        if (typeof EMBED_MODE !== 'undefined' && EMBED_MODE) {
            return teams.find(t => (t.members || []).some(m => m.agent_id === EMBED_AGENT_ID)) || null;
        }
        const saved = (() => { try { return localStorage.getItem('board-active-team'); } catch (e) { return null; } })();
        return teams.find(t => t.id === saved) || teams[0];
    });
}

// =====================================================================
// Autopilot row
// =====================================================================

function _refreshActivityAutopilot() {
    const checkbox = document.getElementById('activity-autopilot-checkbox');
    const status = document.getElementById('activity-autopilot-status');
    if (!checkbox) return;
    _activityCurrentTeam().then(team => {
        if (!team) { checkbox.checked = false; checkbox.disabled = true; if (status) status.textContent = t('activity_autopilot_off'); return; }
        checkbox.disabled = false;
        fetch(`/api/board/autopilot?team_id=${encodeURIComponent(team.id)}`).then(r => r.json()).then(data => {
            const enabled = data.status === 'success' && !!data.enabled;
            checkbox.checked = enabled;
            if (!status) return;
            if (!enabled) { status.textContent = t('activity_autopilot_off'); return; }
            const current = (_activityLastItems || []).find(i => i.source === 'team_task' && i.team_id === team.id && i.status === 'in_progress');
            status.textContent = current
                ? t('activity_working').replace('{task}', current.subject)
                : t('activity_autopilot_on');
        }).catch(() => {});
    });
}

function toggleActivityAutopilot(enabled) {
    _activityCurrentTeam().then(team => {
        if (!team) return;
        fetch('/api/board/autopilot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team_id: team.id, enabled }),
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') {
                document.getElementById('activity-autopilot-checkbox').checked = !enabled;
                _wsToast(data.message || t('team_action_failed'));
            }
            _refreshActivityAutopilot();
        }).catch(() => { document.getElementById('activity-autopilot-checkbox').checked = !enabled; });
    });
}

// =====================================================================
// "Simulate an inbound email": creates a real task_board task (team_store)
// on the current team, owned by its leader, and lets Autopilot (or the
// leader picking it up by hand) run it -- see agent/tools/team/autopilot.py.
// No email/IMAP integration; this proves the same pipeline a real inbound
// trigger would use.
// =====================================================================

function simulateInboundEmail() {
    _activityCurrentTeam().then(team => {
        if (!team || !team.members || !team.members.length) {
            _wsToast(t('activity_no_team'));
            return;
        }
        const leader = team.members.find(m => m.role === 'leader') || team.members[0];
        fetch('/api/board/tasks', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                team_id: team.id,
                subject: 'Reply to a simulated inbound email',
                owner_slot_id: leader.slot_id,
            }),
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
            _refreshActivity();
        }).catch(() => _wsToast(t('team_action_failed')));
    });
}

// =====================================================================
// Activity feed: real team tasks (in_progress/review) + running subagent
// spawns, from the read-only /api/activity endpoint.
// =====================================================================

let _activityLastItems = [];

function _refreshActivity() {
    fetch('/api/activity').then(r => r.json()).then(data => {
        _activityLastItems = (data.status === 'success' && data.items) || [];
        _renderActivityFeed();
        _refreshActivityAutopilot();
    }).catch(() => {});
}

function _activityAgentLabel(agentId) {
    if (typeof findAgent !== 'function') return agentId || '';
    const a = findAgent(agentId);
    return a ? a.name : (agentId || '');
}

function _activityTruncate(text, max) {
    text = String(text || '');
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function _renderActivityFeed() {
    const el = document.getElementById('activity-feed');
    if (!el) return;
    if (!_activityLastItems.length) {
        el.innerHTML = `<div class="activity-empty">${escapeHtml(t('activity_empty'))}</div>`;
        return;
    }
    el.innerHTML = _activityLastItems.map(_activityCardHTML).join('');
}

function _activityCardHTML(item) {
    const iconClass = ACTIVITY_ICONS[item.icon] || ACTIVITY_ICONS.general;
    const label = item.source === 'subagent_run'
        ? `${escapeHtml(t('menu_agents') || 'Agent')} — ${escapeHtml(item.subject)}`
        : `${escapeHtml(_activityAgentLabel(item.agent_id) || item.team_name)} — ${escapeHtml(_activityTruncate(item.subject, 60))}`;
    const statusLabel = item.status === 'in_progress' ? t('board_col_in_progress')
        : item.status === 'review' ? t('board_col_review')
        : item.status;
    const expanded = _activityExpanded.has(item.id);
    const cursor = item.active ? '<span class="activity-cursor"></span>' : '';
    const preview = item.preview
        ? `<div class="activity-card-preview" title="${escapeHtml(item.preview)}">${escapeHtml(_activityTruncate(item.preview, 90))}</div>`
        : '';
    return `
    <div class="activity-card${expanded ? ' expanded' : ''}" onclick="_toggleActivityCard('${_wsAttr(item.id)}')">
        <div class="activity-card-head">
            <i class="fas ${iconClass} activity-card-icon${item.icon === 'autopilot' ? ' activity-icon-autopilot' : ''}"></i>
            <span class="activity-card-label">${label}</span>
            <button type="button" class="activity-card-toggle" aria-label="Expand"><i class="fas fa-chevron-right"></i></button>
        </div>
        ${preview}
        <div class="activity-card-sub">${escapeHtml(statusLabel)}${cursor}</div>
    </div>`;
}

function _toggleActivityCard(id) {
    if (_activityExpanded.has(id)) _activityExpanded.delete(id);
    else _activityExpanded.add(id);
    _renderActivityFeed();
}

// =====================================================================
// Boot: init once, then poll only while the chat view is on screen and the
// panel is open (the approvals bar's permission pill is kept in sync
// whenever the chat view is active, panel open or not).
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
    _initApprovalsBar();
    try {
        // Closed by default -- only reopen if the user explicitly opened it
        // in a past session (recorded as '1'; anything else, including
        // never-set, stays closed).
        if (localStorage.getItem(_activityPanelKey()) === '1') toggleActivityPanel();
    } catch (e) {}

    _activityPollTimer = setInterval(() => {
        if (!_activityIsChatViewActive()) return;
        _renderApprovalsSegmented();
        const panel = document.getElementById('activity-panel');
        if (panel && !panel.classList.contains('hidden')) _refreshActivity();
    }, 5000);
});
