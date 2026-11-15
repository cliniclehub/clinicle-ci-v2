/* Teams view: named rosters of Agents working side by side. Ported from
 * AionUi's team page onto Clinicle Intelligence's stack (see team_store.py for what
 * carried over and what didn't). Reuses the existing agents.js roster
 * (agentCatalog / findAgent / agentAvatarHTML) for the member picker, and
 * the existing single-session chat engine for each column -- a column is
 * just this same page loaded in an iframe, scoped to one member's agent id
 * + session id via ?embed=1 (see EMBED_MODE in chat/state.js).
 *
 * Identity colors: assigned per slot_id, stable once given (mirrors the
 * reference design) -- stored in localStorage per team, exactly like the
 * view-mode and active-slot keys below, all namespaced by team id so
 * separate teams never collide.
 */

let teamsList = [];
let activeTeam = null;      // the currently open team object
let activeSlotId = '';      // selected member's slot_id within activeTeam

const TEAM_COLORS = [
    '#4ABE6E', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4',
    '#8b5cf6', '#ef4444', '#10b981', '#3b82f6', '#f97316',
];

function _teamViewModeKey(teamId) { return `team-view-mode-${teamId}`; }
function _teamActiveSlotKey(teamId) { return `team-active-slot-${teamId}`; }
function _teamColorsKey(teamId) { return `team-member-colors-${teamId}`; }

function _teamColorMap(teamId) {
    try { return JSON.parse(localStorage.getItem(_teamColorsKey(teamId)) || '{}'); }
    catch (e) { return {}; }
}

function _colorForSlot(teamId, slotId) {
    const map = _teamColorMap(teamId);
    if (map[slotId] !== undefined) return TEAM_COLORS[map[slotId] % TEAM_COLORS.length];
    const used = new Set(Object.values(map));
    let idx = 0;
    while (used.has(idx) && idx < TEAM_COLORS.length) idx++;
    map[slotId] = idx;
    try { localStorage.setItem(_teamColorsKey(teamId), JSON.stringify(map)); } catch (e) {}
    return TEAM_COLORS[idx % TEAM_COLORS.length];
}

function _tintFor(hexColor) {
    // Cheap fixed low-alpha tint, not per-color math -- matches the reference
    // design's "identity color only as a light background, never a full fill".
    return hexColor + '22';
}

// =====================================================================
// Load & list
// =====================================================================
function loadTeamsView() {
    // Same pattern as channels.js / tasks.js: don't just fire the roster
    // fetch and hope it lands before the user clicks anything -- chain the
    // render behind it, so a cold load (Teams opened before Agents ever has)
    // doesn't show ids instead of names with nothing to re-render them later.
    const roster = ensureAgentCatalog();
    roster.then(() => fetch('/api/teams')).then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        teamsList = data.teams || [];
        _renderTeamsRail();
        if (activeTeam) {
            const fresh = teamsList.find(t => t.id === activeTeam.id);
            if (fresh) selectTeam(fresh.id, true);
            else { activeTeam = null; _showTeamsEmpty(); }
        } else if (teamsList.length) {
            selectTeam(teamsList[0].id);
        } else {
            _showTeamsEmpty();
        }
    }).catch(() => {});
}

function _renderTeamsRail() {
    const el = document.getElementById('teams-rail-list');
    if (!el) return;
    el.innerHTML = teamsList.map(team => `
        <div class="teams-rail-item group ${activeTeam && activeTeam.id === team.id ? 'active' : ''}"
             onclick="selectTeam('${_wsAttr(team.id)}')">
            <i class="fas fa-people-group"></i>
            <span class="truncate flex-1">${escapeHtml(team.name)}</span>
            ${team.workspace ? `<i class="fas fa-folder text-[10px] opacity-50" title="${escapeHtml(team.workspace)}"></i>` : ''}
            <span class="teams-rail-item-actions">
                <i class="fas fa-sitemap ${team.org_id ? 'text-[var(--accent)]' : ''}"
                   title="${escapeHtml(t(team.org_id ? 'team_open_org_graph' : 'team_link_org'))}"
                   onclick="teamSitemapClick('${_wsAttr(team.id)}', ${team.org_id ? 'true' : 'false'}, event)"
                   oncontextmenu="teamToggleOrgLink('${_wsAttr(team.id)}', ${team.org_id ? 'true' : 'false'}, event); event.preventDefault();"></i>
                <i class="fas fa-pen" title="${escapeHtml(t('team_rename'))}"
                   onclick="renameTeamPrompt('${_wsAttr(team.id)}', '${_wsAttr(team.name)}', event)"></i>
                <i class="fas fa-trash-can" title="${escapeHtml(t('team_delete'))}"
                   onclick="deleteTeamConfirm('${_wsAttr(team.id)}', '${_wsAttr(team.name)}', event)"></i>
            </span>
            <span class="text-[10px] opacity-60 teams-rail-item-count">${team.members.length}</span>
        </div>
    `).join('') || `<div class="text-xs text-center opacity-50 py-6">${escapeHtml(t('team_none_yet'))}</div>`;
}

function _showTeamsEmpty() {
    document.getElementById('teams-empty').classList.remove('hidden');
    document.getElementById('teams-active').classList.add('hidden');
}

function selectTeam(teamId, silent) {
    const team = teamsList.find(t => t.id === teamId);
    if (!team) return;
    activeTeam = team;
    activeSlotId = localStorage.getItem(_teamActiveSlotKey(teamId))
        || (team.members.find(m => m.role === 'leader') || team.members[0]).slot_id;
    if (!team.members.some(m => m.slot_id === activeSlotId)) {
        activeSlotId = (team.members.find(m => m.role === 'leader') || team.members[0]).slot_id;
    }
    document.getElementById('teams-empty').classList.add('hidden');
    document.getElementById('teams-active').classList.remove('hidden');
    const mode = localStorage.getItem(_teamViewModeKey(teamId)) === 'single' ? 'single' : 'grid';
    _renderTeamsRail();
    _renderTeamPills();
    _renderTeamGrid();
    setTeamViewMode(mode, true);
    _startTeamWorkPolling();
}

// =====================================================================
// Live "working" indicator -- mirrors AionUi's per-slot ITeamSlotWork.state
// (idle/running) driving a Spin icon in its Sider. Clinicle Intelligence has no WebSocket
// event stream for this, so it's polled: team_manage(delegate) marks a slot
// running for the duration of its single blocking agent_reply() call (see
// team_store.mark_slot_running), and this polls that back every 1s.
// ponytail: still poll-based, so a delegate call that starts and finishes
// strictly inside one poll gap is still missed -- closing that fully needs a
// backend push/run-counter signal (get_slot_work is a plain presence map),
// out of scope for a frontend-only fix. Tightened from 2s to shrink the gap.
// =====================================================================
let _teamWorkPollTimer = null;
let _teamWorkPollTick = 0;

function _startTeamWorkPolling() {
    stopTeamWorkPolling();
    if (!activeTeam) return;
    _teamWorkPollTick = 0;
    const poll = () => {
        if (!activeTeam) return;
        fetch(`/api/teams/${encodeURIComponent(activeTeam.id)}/work`).then(r => r.json()).then(data => {
            if (data.status !== 'success') return;
            _applyTeamWork(data.work || {});
        }).catch(() => {});
        // Same timer, every 6th tick (~6s): pick up a roster change made
        // elsewhere -- another tab/user adding or removing a member -- rather
        // than only ever refreshing on nav back into Teams. A separate timer
        // for this would just be the same fetch cadence twice.
        _teamWorkPollTick++;
        if (_teamWorkPollTick % 6 === 0) _refreshActiveTeamRoster();
    };
    poll();
    _teamWorkPollTimer = setInterval(poll, 1000);
}

function stopTeamWorkPolling() {
    if (_teamWorkPollTimer) { clearInterval(_teamWorkPollTimer); _teamWorkPollTimer = null; }
}

function _refreshActiveTeamRoster() {
    if (!activeTeam) return;
    const teamId = activeTeam.id;
    fetch(`/api/teams/${encodeURIComponent(teamId)}`).then(r => r.json()).then(data => {
        // The team may have been closed, deleted, or switched away from
        // while this was in flight.
        if (data.status !== 'success' || !activeTeam || activeTeam.id !== teamId) return;
        const fresh = data.team;
        const membershipChanged = JSON.stringify((activeTeam.members || []).map(m => m.slot_id))
            !== JSON.stringify((fresh.members || []).map(m => m.slot_id));
        const idx = teamsList.findIndex(x => x.id === teamId);
        if (idx >= 0) teamsList[idx] = fresh;
        activeTeam = fresh;
        _renderTeamsRail();
        if (!membershipChanged) return;
        // Only rebuild the pills/grid (which reloads every member's iframe)
        // when membership actually moved -- never on every poll tick, so an
        // in-progress column isn't reset out from under the user, and never
        // while the add-member popover is mid-interaction with its own copy
        // of the candidate list.
        if (!fresh.members.some(m => m.slot_id === activeSlotId)) {
            activeSlotId = (fresh.members.find(m => m.role === 'leader') || fresh.members[0]).slot_id;
        }
        _renderTeamPills();
        _renderTeamGrid();
    }).catch(() => {});
}

function _applyTeamWork(work) {
    // A delegate call runs on a background thread, straight into the
    // teammate's own conversation store -- it never touches that column's
    // iframe, which only ever loaded /api/history once on mount. Without
    // this the teammate's pane stays showing the empty state forever, even
    // though /api/history for their session already has the real turn in
    // it. Reload the iframe the moment its slot stops running so it picks
    // that turn up -- cheap stand-in for AionUi's live WebSocket push.
    document.querySelectorAll('#teams-grid .teams-col').forEach(col => {
        const isWorking = !!work[col.dataset.slotId];
        const wasWorking = col.classList.contains('working');
        col.classList.toggle('working', isWorking);
        if (wasWorking && !isWorking) {
            const frame = col.querySelector('.teams-col-frame');
            if (frame) frame.src = frame.src;
        }
    });
}

// =====================================================================
// Member pills + grid
// =====================================================================
function _agentLabel(agentId) {
    const a = findAgent(agentId);
    return a ? a.name : agentId;
}

// Edge-fade "there's more" cue (PRD §2): shown on whichever side still has
// unscrolled pills, hidden once you've scrolled all the way to that edge.
function _updateTeamPillFade() {
    const el = document.getElementById('teams-pills');
    const wrap = el && el.parentElement;
    if (!el || !wrap) return;
    wrap.classList.toggle('fade-start', el.scrollLeft > 4);
    wrap.classList.toggle('fade-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
}

function _renderTeamPills() {
    const el = document.getElementById('teams-pills');
    if (!el || !activeTeam) return;
    el.innerHTML = activeTeam.members.map(m => {
        const color = _colorForSlot(activeTeam.id, m.slot_id);
        const selected = m.slot_id === activeSlotId;
        return `
        <div class="teams-pill ${selected ? 'selected' : ''}"
             style="${selected ? `--team-color:${color};--team-tint:${_tintFor(color)}` : ''}"
             onclick="selectTeamMember('${_wsAttr(m.slot_id)}')" title="${escapeHtml(_agentLabel(m.agent_id))}">
            ${m.role === 'leader' ? '<i class="fas fa-crown teams-pill-crown"></i>' : ''}
            ${agentAvatarHTML(findAgent(m.agent_id), 18)}
            <span class="truncate max-w-[96px]">${escapeHtml(_agentLabel(m.agent_id))}</span>
            <span class="teams-pill-status online"></span>
            ${m.role !== 'leader' ? `<i class="fas fa-xmark teams-pill-remove" onclick="event.stopPropagation(); teamRemoveMember('${_wsAttr(m.slot_id)}')"></i>` : ''}
        </div>`;
    }).join('');
    // innerHTML rebuild resets scroll metrics -- recompute after layout settles.
    requestAnimationFrame(_updateTeamPillFade);
}

function _paneSrc(member) {
    const params = new URLSearchParams({ embed: '1', agent_id: member.agent_id, session_id: member.session_id });
    // Both roles get their own empty-state greeting (see boot.js) -- the
    // param is read there, never trusted for anything more than that swap.
    params.set('role', member.role === 'leader' ? 'leader' : 'teammate');
    return `/?${params.toString()}`;
}

function _renderTeamGrid() {
    const el = document.getElementById('teams-grid');
    if (!el || !activeTeam) return;
    el.innerHTML = activeTeam.members.map(m => {
        const color = _colorForSlot(activeTeam.id, m.slot_id);
        const selected = m.slot_id === activeSlotId;
        return `
        <div class="teams-col ${selected ? 'selected' : ''}" data-slot-id="${_wsAttr(m.slot_id)}"
             style="${selected ? `--team-color:${color};--team-tint:${_tintFor(color)}` : ''}"
             onclick="selectTeamMember('${_wsAttr(m.slot_id)}')">
            <div class="teams-col-head">
                ${m.role === 'leader' ? '<i class="fas fa-crown teams-pill-crown"></i>' : ''}
                <span class="truncate">${escapeHtml(_agentLabel(m.agent_id))}</span>
                <span class="teams-col-working-spin" title="${escapeHtml(t('team_member_working'))}"></span>
                <i class="fas fa-expand teams-col-expand" title="${escapeHtml(t('team_expand_column'))}"
                   onclick="event.stopPropagation(); expandTeamColumn('${_wsAttr(m.slot_id)}')"></i>
            </div>
            <iframe class="teams-col-frame" src="${_paneSrc(m)}" loading="lazy"></iframe>
        </div>`;
    }).join('');
}

function selectTeamMember(slotId) {
    if (!activeTeam) return;
    activeSlotId = slotId;
    try { localStorage.setItem(_teamActiveSlotKey(activeTeam.id), slotId); } catch (e) {}
    _renderTeamPills();
    document.querySelectorAll('.teams-col').forEach(col => {
        const sel = col.dataset.slotId === slotId;
        col.classList.toggle('selected', sel);
        const member = activeTeam.members.find(m => m.slot_id === col.dataset.slotId);
        if (sel && member) {
            const color = _colorForSlot(activeTeam.id, slotId);
            col.style.setProperty('--team-color', color);
            col.style.setProperty('--team-tint', _tintFor(color));
        }
    });
}

function setTeamViewMode(mode, silent) {
    if (!activeTeam) return;
    const grid = document.getElementById('teams-grid');
    grid.classList.toggle('single', mode === 'single');
    document.getElementById('teams-view-grid-btn').classList.toggle('active', mode === 'grid');
    document.getElementById('teams-view-single-btn').classList.toggle('active', mode === 'single');
    if (!silent) { try { localStorage.setItem(_teamViewModeKey(activeTeam.id), mode); } catch (e) {} }
}

// A column's own expand icon (matches the reference design's per-column
// fullscreen control): select that member and jump straight to single-chat,
// one click instead of select-then-toggle-view.
function expandTeamColumn(slotId) {
    selectTeamMember(slotId);
    setTeamViewMode('single');
}

// Links/unlinks a team to the acting user's own org (see
// OrgTeamAssignHandler's docstring -- the request never names an org_id, the
// server resolves it from the session). Toggled from the rail row's icon, no
// confirm dialog for the common case: unlike delete this is reversible with
// one more click. The one exception is real multi-org contention (the team
// is already linked elsewhere) -- the server 409s and this asks before
// retrying with force, rather than silently pulling a team out from under
// another org.
// Left-click on the rail row's sitemap icon jumps to the Org Graph (its
// natural meaning -- a sitemap icon is a shortcut to the org map, not a
// hidden link/unlink toggle). An unlinked team has no place on that map, so
// it links first, then opens the graph either way. Unlink is still reachable,
// just moved off the primary click onto right-click (see oncontextmenu above).
function teamSitemapClick(teamId, currentlyLinked, event) {
    if (event) event.stopPropagation();
    // /api/org/graph returns the whole org's map, not a per-team slice --
    // every team's icon opens the SAME page. Stash which node to focus so
    // org-graph.js can highlight/center it instead of landing on an
    // identical, unfocused canvas no matter which team you came from.
    window._ogFocusTeamId = teamId;
    if (currentlyLinked) { navigateTo('org-graph'); return; }
    teamToggleOrgLink(teamId, currentlyLinked, event);
    navigateTo('org-graph');
}

function teamToggleOrgLink(teamId, currentlyLinked, event, force) {
    if (event) event.stopPropagation();
    const body = { linked: !currentlyLinked };
    if (force) body.force = true;
    fetch(`/api/org/teams/${encodeURIComponent(teamId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            if (data.code === 'org_contention') {
                showConfirmModal(t('team_org_contention_title'), t('team_org_contention_confirm'), () => {
                    teamToggleOrgLink(teamId, currentlyLinked, null, true);
                });
                return;
            }
            _wsToast(data.message || t('team_link_org_failed'));
            return;
        }
        const idx = teamsList.findIndex(x => x.id === teamId);
        if (idx >= 0) teamsList[idx] = data.team;
        if (activeTeam && activeTeam.id === teamId) activeTeam = data.team;
        _renderTeamsRail();
    }).catch(() => _wsToast(t('team_link_org_failed')));
}

function teamRemoveMember(slotId) {
    if (!activeTeam) return;
    const member = activeTeam.members.find(m => m.slot_id === slotId);
    const label = member ? _agentLabel(member.agent_id) : '';
    showConfirmModal(t('team_remove_member_title'), t('team_remove_member_confirm').replace('{name}', label), () => {
        fetch(`/api/teams/${encodeURIComponent(activeTeam.id)}/members/${encodeURIComponent(slotId)}`, { method: 'DELETE' })
            .then(r => r.json()).then(data => {
                if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
                if (activeSlotId === slotId) {
                    activeSlotId = (data.team.members.find(m => m.role === 'leader') || data.team.members[0]).slot_id;
                }
                const idx = teamsList.findIndex(x => x.id === activeTeam.id);
                if (idx >= 0) teamsList[idx] = data.team;
                activeTeam = data.team;
                _renderTeamsRail();
                _renderTeamPills();
                _renderTeamGrid();
            }).catch(() => _wsToast(t('team_action_failed')));
    });
}

// =====================================================================
// Add member popover -- dashed pill, always visible at the end of the row.
// =====================================================================
function toggleAddMemberPopover(evt) {
    const pop = document.getElementById('teams-add-popover');
    const btn = document.getElementById('teams-add-pill-btn');
    if (!pop.classList.contains('hidden')) { pop.classList.add('hidden'); return; }
    const rect = btn.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.left = `${Math.max(8, rect.left)}px`;
    pop.classList.remove('hidden');
    document.getElementById('teams-add-search-input').value = '';
    renderAddMemberList();
    document.getElementById('teams-add-search-input').focus();
    if (evt) evt.stopPropagation();
}

document.addEventListener('click', (e) => {
    const pop = document.getElementById('teams-add-popover');
    if (!pop || pop.classList.contains('hidden')) return;
    if (!pop.contains(e.target) && e.target.id !== 'teams-add-pill-btn') pop.classList.add('hidden');
});

function renderAddMemberList() {
    const list = document.getElementById('teams-add-list');
    const q = (document.getElementById('teams-add-search-input').value || '').toLowerCase();
    const already = new Set((activeTeam ? activeTeam.members : []).map(m => m.agent_id));
    const candidates = agentCatalog.filter(a =>
        a.enabled && !already.has(a.id) && (!q || (a.name || '').toLowerCase().includes(q))
    );
    list.innerHTML = candidates.map(a => `
        <div class="teams-add-item" onclick="teamAddMember('${_wsAttr(a.id)}')">
            ${agentAvatarHTML(a, 20)}
            <span class="truncate">${escapeHtml(a.name)}</span>
        </div>
    `).join('') || `<div class="text-xs text-center opacity-50 py-4">${escapeHtml(t('team_no_candidates'))}</div>`;
}

function teamAddMember(agentId) {
    if (!activeTeam) return;
    fetch(`/api/teams/${encodeURIComponent(activeTeam.id)}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        const idx = teamsList.findIndex(x => x.id === activeTeam.id);
        if (idx >= 0) teamsList[idx] = data.team;
        activeTeam = data.team;
        document.getElementById('teams-add-popover').classList.add('hidden');
        _renderTeamsRail();
        _renderTeamPills();
        _renderTeamGrid();
    }).catch(() => _wsToast(t('team_action_failed')));
}

// "Not the right one? Tell the Leader" -- switches to the Leader's pane in
// single-chat view and prefills (never sends) a request to hand-pick a
// member, matching the reference design's fallback.
function tellTheLeaderToAddMember() {
    if (!activeTeam) return;
    document.getElementById('teams-add-popover').classList.add('hidden');
    const leader = activeTeam.members.find(m => m.role === 'leader');
    if (!leader) return;
    selectTeamMember(leader.slot_id);
    setTeamViewMode('single');
    const frame = document.querySelector(`.teams-col[data-slot-id="${CSS.escape(leader.slot_id)}"] .teams-col-frame`);
    const text = t('team_tell_leader_prefill');
    const send = () => frame.contentWindow.postMessage({ type: 'clinicle-intelligence-team-prefill', text }, location.origin);
    if (frame && frame.contentDocument && frame.contentDocument.readyState === 'complete') send();
    else if (frame) frame.addEventListener('load', send, { once: true });
}

// =====================================================================
// Create-team modal
// =====================================================================
let _createTeamSelection = {}; // agent_id -> role ('leader' | 'teammate')

function openCreateTeamModal() {
    _createTeamSelection = {};
    document.getElementById('team-create-name').value = '';
    document.getElementById('team-create-workspace').value = '';
    const roster = ensureAgentCatalog();
    roster.then(() => _renderCreateTeamMembers());
    _renderCreateTeamMembers();
    document.getElementById('team-create-modal').classList.remove('hidden');
    document.getElementById('team-create-modal').classList.add('flex');
}

function closeCreateTeamModal() {
    document.getElementById('team-create-modal').classList.add('hidden');
    document.getElementById('team-create-modal').classList.remove('flex');
}

function _renderCreateTeamMembers() {
    const el = document.getElementById('team-create-members');
    el.innerHTML = agentCatalog.map(a => {
        const role = _createTeamSelection[a.id];
        return `
        <label class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-50 dark:hover:bg-white/5 cursor-pointer text-sm">
            <input type="checkbox" ${role ? 'checked' : ''} onchange="_toggleCreateMember('${_wsAttr(a.id)}', this.checked)">
            ${agentAvatarHTML(a, 20)}
            <span class="flex-1 truncate">${escapeHtml(a.name)}</span>
            ${role ? `
                <button type="button" class="text-[10px] px-2 py-0.5 rounded-full ${role === 'leader' ? 'bg-amber-100 text-amber-700' : 'bg-surface-100 text-surface-500'}"
                        onclick="event.preventDefault(); _setCreateLeader('${_wsAttr(a.id)}')">
                    ${role === 'leader' ? `<i class="fas fa-crown"></i> ${escapeHtml(t('team_leader'))}` : escapeHtml(t('team_make_leader'))}
                </button>` : ''}
        </label>`;
    }).join('');
}

function _toggleCreateMember(agentId, checked) {
    if (checked) {
        const hasLeader = Object.values(_createTeamSelection).includes('leader');
        _createTeamSelection[agentId] = hasLeader ? 'teammate' : 'leader';
    } else {
        const wasLeader = _createTeamSelection[agentId] === 'leader';
        delete _createTeamSelection[agentId];
        if (wasLeader) {
            const nextId = Object.keys(_createTeamSelection)[0];
            if (nextId) _createTeamSelection[nextId] = 'leader';
        }
    }
    _renderCreateTeamMembers();
}

function _setCreateLeader(agentId) {
    for (const id in _createTeamSelection) {
        _createTeamSelection[id] = id === agentId ? 'leader' : 'teammate';
    }
    _renderCreateTeamMembers();
}

// =====================================================================
// Rename / delete a team (rail hover actions)
// =====================================================================
function renameTeamPrompt(teamId, currentName, evt) {
    if (evt) evt.stopPropagation();
    showPromptModal(t('team_rename_title'), currentName, (name) => {
        if (name === null || !name.trim()) return;
        fetch(`/api/teams/${encodeURIComponent(teamId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() }),
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
            const idx = teamsList.findIndex(x => x.id === teamId);
            if (idx >= 0) teamsList[idx] = data.team;
            if (activeTeam && activeTeam.id === teamId) activeTeam = data.team;
            _renderTeamsRail();
        }).catch(() => _wsToast(t('team_action_failed')));
    });
}

function deleteTeamConfirm(teamId, name, evt) {
    if (evt) evt.stopPropagation();
    showConfirmModal(
        t('team_delete_title'),
        t('team_delete_confirm').replace('{name}', name),
        () => {
            fetch(`/api/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' })
                .then(r => r.json()).then(data => {
                    if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
                    teamsList = teamsList.filter(x => x.id !== teamId);
                    if (activeTeam && activeTeam.id === teamId) activeTeam = null;
                    _renderTeamsRail();
                    if (!activeTeam) {
                        if (teamsList.length) selectTeam(teamsList[0].id);
                        else _showTeamsEmpty();
                    }
                }).catch(() => _wsToast(t('team_action_failed')));
        }
    );
}

function submitCreateTeam() {
    const name = document.getElementById('team-create-name').value.trim();
    const workspace = document.getElementById('team-create-workspace').value.trim();
    const members = Object.entries(_createTeamSelection).map(([agent_id, role]) => ({ agent_id, role }));
    if (!name) { _wsToast(t('team_name_required')); return; }
    if (!members.length) { _wsToast(t('team_select_member')); return; }
    fetch('/api/teams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, members, workspace: workspace || undefined }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        closeCreateTeamModal();
        teamsList.unshift(data.team);
        selectTeam(data.team.id);
    }).catch(() => _wsToast(t('team_action_failed')));
}
