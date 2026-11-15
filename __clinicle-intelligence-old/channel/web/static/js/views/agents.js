/* Agent roster, detail drawer, avatars and core files.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Agents
// =====================================================================
let agentCatalog = [];
let channelInstances = [];
let rosterRevision = '';
let defaultAgentId = localStorage.getItem('cow_default_agent') || 'default';
let selectedAdminAgentId = '';
let selectedCoreRevision = '';
let installedSkills = [];
let agentCatalogFetchedAt = 0;

// The signed-in person's own org identity, stashed by renderTopbarProfile
// (called once at boot from core/auth.js's initApp, via /api/org/members'
// is_self entry) -- null on a legacy no-account install, where sharing does
// not apply and canManageAgent() below treats every Agent as manageable,
// same as the server does for a null user_id.
let currentOrgSelf = null;

// Whether the signed-in person may edit/share/delete this Agent: its owner,
// an org admin/owner, or -- for an Agent that predates ownership (no
// owner_user_id at all) -- anyone, exactly today's behavior. Mirrors
// channel/web/api/agents.py's _require_owner_or_admin() so the UI never
// offers a control the server would 404.
function canManageAgent(agent) {
    if (!agent || agent.owner_user_id == null) return true;
    if (!currentOrgSelf) return false;
    if (agent.owner_user_id === currentOrgSelf.id) return true;
    return currentOrgSelf.role === 'admin' || currentOrgSelf.role === 'owner';
}

// Whether this person may open the share popover for a given Agent. Sharing
// additionally calls /api/org/members, which tenancy.py's OrgMembersHandler
// gates on the "settings.users" capability -- granted to admin/owner by
// default (see agent/permission/capabilities.py's DEFAULT_ROLE_CAPABILITIES)
// but NOT to a plain member, even one who owns the Agent and so passes
// canManageAgent() above. Checking role here (the org/admin fallback
// canManageAgent() itself already uses) keeps a member-owner from seeing a
// share icon that would just 403.
function canShareAgent(agent) {
    return canManageAgent(agent) && !!currentOrgSelf &&
        (currentOrgSelf.role === 'admin' || currentOrgSelf.role === 'owner');
}

// How stale agentCatalog is allowed to get before a caller that only wants
// "is the roster loaded" (teams.js, task-board.js) forces a re-fetch. An
// agent created/renamed/deleted in another tab used to only show up once
// this array happened to be empty again -- this bounds that window instead.
// A short TTL rather than an invalidate-on-mutation bus: this is a small
// internal admin tool, not a high-traffic app.
const AGENT_CATALOG_TTL_MS = 15000;

function ensureAgentCatalog() {
    if (agentCatalog.length && (Date.now() - agentCatalogFetchedAt) < AGENT_CATALOG_TTL_MS) {
        return Promise.resolve();
    }
    return loadAgentCatalog();
}

function findAgent(agentId) {
    return agentCatalog.find(a => a.id === agentId) || null;
}

function enabledAgents() {
    return agentCatalog.filter(a => a.enabled);
}

/* An uploaded avatar reuses the same URL every time, so the browser would keep
   serving the stale bytes. The roster revision only moves when the roster's
   *content* changes, and re-uploading over an existing image leaves the field as
   the same "image" token — so we stamp each successful upload with a fresh token
   here and prefer it, which forces the one re-fetch that shows the new picture. */
const avatarVersions = {};

/* How many muted discs the initials fallback cycles through. */
const AVATAR_TONES = 6;

/* Which disc an Agent gets. Keyed off the id alone, so a face never changes
   colour once the Agent exists, and so a draft in the create modal (no id yet)
   sits on the neutral tone instead of shifting as its name is typed. */
function avatarTone(agentId) {
    const key = String(agentId || '');
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return hash % AVATAR_TONES;
}

/* The character an Agent is shown by when it has no picture. Array.from rather
   than [0] so an astral-plane character is taken whole instead of as half a
   surrogate pair; uppercased for latin, left alone for scripts without case. */
function avatarInitial(name) {
    return (Array.from(String(name || '').trim())[0] || '').toUpperCase();
}

/* Every Agent wears its own face: the image its owner uploaded, or a muted disc
   carrying the first character of its name. Initials rather than the product
   logo so a team is distinguishable at a glance, and low-saturation tones so a
   roster of them stays quiet.

   A null agent means the id no longer resolves - a conversation pinned to a
   since-deleted Agent. Fall back to the default Agent's face rather than an
   empty disc, so the deleted Agent visibly degrades to the default one. */
function agentAvatarHTML(agent, size) {
    const cls = `agent-avatar agent-avatar-${size || 32}`;
    if (!agent && defaultAgentId) {
        agent = findAgent(defaultAgentId);
    }
    if (agent && agent.avatar === 'image') {
        // Prefer the server's per-file token (avatar mtime): it changes on every
        // upload, so replacing a picture busts the cache even after a hard reload
        // when in-memory hints are gone and the roster revision hasn't moved.
        const v = avatarVersions[agent.id] || agent.avatar_rev || rosterRevision || agent.id;
        return `<img class="${cls}" src="/api/agents/${encodeURIComponent(agent.id)}/avatar?v=${encodeURIComponent(v)}" alt="">`;
    }
    // The default (first) Agent falls back to the product mark when it has no
    // uploaded picture, so the instance's own Agent wears the Clinicle face.
    // Added Agents keep the initial-disc fallback so a team stays distinguishable.
    if (agent && agent.id && agent.id === defaultAgentId) {
        return `<img class="${cls}" src="/assets/brand/clinicle-mark.svg" alt="" style="background:#fff;padding:12%;">`;
    }
    const initial = avatarInitial(agent && (agent.name || agent.id));
    return `<span class="${cls} agent-avatar-tone-${avatarTone(agent && agent.id)}">${escapeHtml(initial)}</span>`;
}

/* Same shape as agentAvatarHTML for the signed-in person's own picture
   (Settings > Profile and the topbar). `rev` is the avatar_rev an org member
   entry carries when a picture is uploaded (see channel/web/api/tenancy.py's
   OrgMembersHandler) -- null/undefined falls back to an initial disc, same
   convention as an Agent with no picture. */
function userAvatarHTML(rev, userId, email, size) {
    const cls = `agent-avatar agent-avatar-${size || 32}`;
    if (rev && userId) {
        return `<img class="${cls}" src="/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(rev)}" alt="">`;
    }
    const initial = avatarInitial(email);
    return `<span class="${cls} agent-avatar-tone-${avatarTone(email)}">${escapeHtml(initial)}</span>`;
}

/* Topbar profile button: called once at boot (core/auth.js's initApp) and
   again right after a Profile picture upload, so the change is visible
   without a reload. `self` is one org member entry -- {id, email, avatar_rev}. */
function renderTopbarProfile(self) {
    currentOrgSelf = self || null;
    const btn = document.getElementById('profile-toggle');
    if (!btn || !self) return;
    btn.innerHTML = userAvatarHTML(self.avatar_rev, self.id, self.email, 32);
    btn.title = self.email || '';
}

/* Repaint the faces on bubbles already on screen. Bubbles are rendered once and
   left alone, so an avatar changed in Settings would otherwise keep showing the
   old picture in the open conversation until reload. Each bot bubble remembers
   its speaker; the loading indicator follows the active Agent. */
function refreshBubbleAvatars() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.querySelectorAll('.bot-face').forEach(face => {
        const group = face.closest('.bot-message-group');
        // A bubble knows its speaker; the loading indicator (no group) tracks the
        // active Agent, the only one that can be mid-reply in a solo chat.
        const id = (group && group.dataset.speakerAgent) || activeAgentId;
        face.innerHTML = agentAvatarHTML(findAgent(id), 32);
    });
}

// Derive the ascii slug from a name, or '' when there is no ascii to work with
// (e.g. a name written in Chinese). Callers fall back to randomAgentId().
function slugAgentId(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

// An id for a name that yields no slug.
function randomAgentId() {
    return 'agent-' + Math.random().toString(36).slice(2, 8);
}

function loadAgentCatalog() {
    return fetch('/api/agents')
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') throw new Error(data.message || 'Failed to load Agents');
            agentCatalog = data.agents || [];
            agentCatalogFetchedAt = Date.now();
            channelInstances = data.channel_instances || [];
            rosterRevision = data.revision || '';
            defaultAgentId = data.default_agent_id || (agentCatalog[0] && agentCatalog[0].id) || 'default';
            localStorage.setItem('cow_default_agent', defaultAgentId);
            // The default Agent leads every list it appears in — menus, the grid,
            // the memory picker — so its position never depends on load order.
            agentCatalog.sort((a, b) => (b.id === defaultAgentId) - (a.id === defaultAgentId));
            const enabled = enabledAgents();
            if (!enabled.some(a => a.id === activeAgentId)) {
                activeAgentId = defaultAgentId;
                localStorage.setItem('cow_active_agent', activeAgentId);
            }
            if (!selectedAdminAgentId || !agentCatalog.some(a => a.id === selectedAdminAgentId)) {
                selectedAdminAgentId = '';
            }
            // Two-pane workbench: on a wide screen, land on the first Agent so the
            // right pane is never a blank placeholder. On a phone the list shows
            // first (the detail is a sheet), so leave nothing selected there.
            if (currentView === 'agents') _startAgentBusyPolling();
            if (!selectedAdminAgentId && currentView === 'agents'
                    && agentCatalog.length && window.innerWidth > 900) {
                openAgentDetail((enabledAgents()[0] || agentCatalog[0]).id);
                return data;
            }
            renderAgentsGrid();
            if (selectedAdminAgentId) renderAgentDetail();
            else closeAgentDetail();
            renderComposerIdentity();
            renderMemoryAgentSelect();
            // The new-chat button only sprouts a menu (and its caret) once there
            // is more than one Agent to choose between.
            document.getElementById('new-chat-caret')?.classList.toggle('hidden', !multiAgentMode());
            // A name or avatar may have changed; keep faces already on screen in
            // sync with the roster instead of only new bubbles.
            refreshBubbleAvatars();
            return data;
        })
        .catch(err => {
            const status = document.getElementById('agent-editor-status');
            if (status) status.textContent = err.message;
        });
}

function renderAgentsGrid() {
    const grid = document.getElementById('agents-grid');
    if (!grid) return;
    if (!agentCatalog.length) {
        grid.innerHTML = `<div class="col-span-full text-sm text-surface-400 py-16 text-center">${escapeHtml(t('agents_empty'))}</div>`;
        return;
    }
    grid.innerHTML = agentCatalog.map(agent => {
        const selected = agent.id === selectedAdminAgentId;
        const desc = (agent.description || '').trim();
        const manageable = canManageAgent(agent);
        // A private Agent this person can see only because it was shared with
        // them (not owned, not an admin override) -- tell them apart from an
        // owned/legacy-global card so "why can't I edit this" isn't a mystery.
        const isSharedWithMe = agent.owner_user_id != null && !manageable;
        // Two distinct reasons a non-owner sees this card -- named explicitly
        // in shared_with, or the owner opened it to the whole org -- get
        // different badge text so "why do I have this" isn't a mystery either way.
        const accessBadge = !isSharedWithMe ? '' : (agent.visible_to_org
            ? `<span class="agent-card-badge" title="${escapeHtml(t('agents_org_wide_hint'))}">${escapeHtml(t('agents_org_wide_badge'))}</span>`
            : `<span class="agent-card-badge" title="${escapeHtml(t('agents_shared_with_me_hint'))}">${escapeHtml(t('agents_shared_badge'))}</span>`);
        // Status chips float in the top-right corner so a "default" or
        // "archived" card is exactly as tall as every other card.
        const corner = agent.id === defaultAgentId
            ? `<span class="agent-card-badge agent-chip-on">${escapeHtml(t('agents_default'))}</span>`
            : (!agent.enabled ? `<span class="agent-card-badge">${escapeHtml(t('agents_archived'))}</span>` : accessBadge);
        // Only the owner or an org admin can manage sharing -- and only for an
        // Agent that actually has an owner (sharing a legacy/global Agent that
        // is already visible to everyone would be a no-op control to show).
        const shareIcon = (canShareAgent(agent) && agent.owner_user_id != null)
            ? `<button type="button" class="agent-card-share" title="${escapeHtml(t('agents_share'))}"
                       onclick="toggleAgentSharePopover('${escapeHtml(agent.id)}', event)">
                   <i class="fas fa-user-plus"></i>
               </button>` : '';
        // Same "working" dot task-board.js/teams.js already use for a live
        // busy indicator -- reused here rather than a one-off class, so a
        // mid-task Agent (via Team delegate or Autopilot) doesn't look
        // identical to an idle one in the roster.
        const busyDot = _busyAgentIds.has(agent.id)
            ? '<span class="board-dot board-dot-green" title="Working"></span>' : '';
        return `<div class="agent-card${selected ? ' selected' : ''}${agent.enabled ? '' : ' archived'}" onclick="openAgentDetail('${escapeHtml(agent.id)}')">
            ${corner}
            ${shareIcon}
            <div class="agent-card-top">
                ${agentAvatarHTML(agent, 32)}
                ${busyDot}
                <div class="min-w-0 flex-1">
                    <div class="agent-card-name truncate">${escapeHtml(agent.name)}</div>
                    <div class="agent-card-desc">${desc ? escapeHtml(desc) : `<span class="agent-card-desc-empty">${escapeHtml(t('agents_no_desc'))}</span>`}</div>
            </div>
            </div>
        </div>`;
    }).join('');
}

// =====================================================================
// Share picker -- same anchored-popover shape as teams.js's
// toggleAddMemberPopover/renderAddMemberList, but a checkbox list (share is a
// set you edit and save, not a one-click add) populated from /api/org/members
// rather than an Agent catalog.
// =====================================================================
let _shareAgentId = '';
let _shareSelection = new Set();

function toggleAgentSharePopover(agentId, evt) {
    if (evt) evt.stopPropagation();
    const pop = document.getElementById('agent-share-popover');
    if (!pop) return;
    if (!pop.classList.contains('hidden') && _shareAgentId === agentId) {
        pop.classList.add('hidden');
        return;
    }
    _shareAgentId = agentId;
    const agent = findAgent(agentId);
    _shareSelection = new Set((agent && agent.shared_with) || []);
    const btn = evt && evt.currentTarget;
    if (btn) {
        const rect = btn.getBoundingClientRect();
        pop.style.top = `${rect.bottom + 6}px`;
        pop.style.left = `${Math.max(8, rect.left - 200)}px`;
    }
    pop.classList.remove('hidden');
    renderAgentShareList();
}

document.addEventListener('click', (e) => {
    const pop = document.getElementById('agent-share-popover');
    if (!pop || pop.classList.contains('hidden')) return;
    if (!pop.contains(e.target) && !e.target.closest('.agent-card-share')) pop.classList.add('hidden');
});

function renderAgentShareList() {
    const list = document.getElementById('agent-share-list');
    if (!list) return;
    fetch('/api/org/members').then(r => r.json()).then(data => {
        if (data.status !== 'success' || data.applicable === false) {
            list.innerHTML = `<div class="text-xs text-center opacity-50 py-4">${escapeHtml(t('agents_share_not_applicable'))}</div>`;
            return;
        }
        const members = (data.members || []).filter(m => !m.is_self);
        list.innerHTML = members.map(m => `
            <label class="teams-add-item" style="cursor:pointer">
                <input type="checkbox" ${_shareSelection.has(m.id) ? 'checked' : ''}
                       onchange="_toggleAgentShareSelection(${m.id}, this.checked)">
                ${userAvatarHTML(m.avatar_rev, m.id, m.email, 20)}
                <span class="truncate">${escapeHtml(m.email)}</span>
            </label>
        `).join('') || `<div class="text-xs text-center opacity-50 py-4">${escapeHtml(t('agents_share_no_members'))}</div>`;
    }).catch(() => {
        list.innerHTML = `<div class="text-xs text-center opacity-50 py-4">${escapeHtml(t('agents_share_load_failed'))}</div>`;
    });
}

function _toggleAgentShareSelection(userId, checked) {
    if (checked) _shareSelection.add(userId);
    else _shareSelection.delete(userId);
}

function saveAgentShare() {
    if (!_shareAgentId) return;
    const agent = findAgent(_shareAgentId);
    fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'share', id: _shareAgentId,
            shared_with: Array.from(_shareSelection),
            revision: rosterRevision,
        }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            _wsToast(data.message || t('agents_share_failed'));
            return;
        }
        document.getElementById('agent-share-popover').classList.add('hidden');
        loadAgentCatalog();
    }).catch(() => _wsToast(t('agents_share_failed')));
}

// =====================================================================
// Live busy/idle indicator -- same idea as teams.js's per-slot work poll
// (_startTeamWorkPolling), but fleet-wide: an Agent can be mid-task via any
// Team's delegate call or Autopilot tick, not just one Team this view has
// open. There's no per-agent "busy" endpoint, so this walks the existing
// per-team /work endpoint (team_store.get_slot_work, same one teams.js
// already polls) across every Team instead of adding a new one.
//
// No stop hook from nav.js's navigateTo (out of scope here), so the poll
// checks its own relevance each tick and retires itself on leaving the
// Agents view rather than leaking a timer.
// =====================================================================
let _agentBusyPollTimer = null;
let _busyAgentIds = new Set();

function _startAgentBusyPolling() {
    if (_agentBusyPollTimer) return;
    const poll = () => {
        if (currentView !== 'agents') { stopAgentBusyPolling(); return; }
        fetch('/api/teams').then(r => r.json()).then(data => {
            const teams = (data.status === 'success' && data.teams) || [];
            return Promise.all(teams.map(team =>
                fetch(`/api/teams/${encodeURIComponent(team.id)}/work`).then(r => r.json())
                    .then(w => ({ team, work: (w.status === 'success' && w.work) || {} }))
                    .catch(() => ({ team, work: {} }))
            ));
        }).then(results => {
            const busy = new Set();
            (results || []).forEach(({ team, work }) => {
                (team.members || []).forEach(m => { if (work[m.slot_id]) busy.add(m.agent_id); });
            });
            _busyAgentIds = busy;
            renderAgentsGrid();
        }).catch(() => {});
    };
    poll();
    _agentBusyPollTimer = setInterval(poll, 2000);
}

function stopAgentBusyPolling() {
    if (_agentBusyPollTimer) { clearInterval(_agentBusyPollTimer); _agentBusyPollTimer = null; }
}

function openAgentDetail(agentId) {
    selectedAdminAgentId = agentId;
    document.getElementById('agent-detail')?.classList.remove('hidden');
    renderAgentsGrid();
    renderAgentDetail();
    // Reset the core-file picker to a clean state per Agent, rather than
    // carrying over whichever file/view mode was left selected for the
    // previous one.
    const fileDd = document.getElementById('agent-core-file');
    if (fileDd) fileDd._ddValue = 'AGENT.md';
    setAgentCoreViewMode('edit');
    loadAgentCoreFile();
    // The model picker is drawn from the same catalog the composer uses, which
    // depends on which providers have keys. Re-render once it has arrived.
    if (!_sessCfg) refreshSessionSettings().then(() => {
        if (selectedAdminAgentId === agentId) renderAgentDetail();
    });
}

function closeAgentDetail() {
    selectedAdminAgentId = '';
    const detail = document.getElementById('agent-detail');
    if (detail) {
        detail.classList.add('hidden');
        // The empty pane's placeholder text (desktop two-pane layout).
        detail.setAttribute('data-empty-label', t('agents_select_hint'));
    }
    renderAgentsGrid();
}

function selectAgentDetailTab(tab) {
    document.querySelectorAll('.agent-detail-tab').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });
    ['profile', 'skills', 'files'].forEach(name => {
        document.getElementById(`agent-detail-${name}`)?.classList.toggle('hidden', name !== tab);
    });
    if (tab === 'skills') renderAgentSkillsPane();
    if (tab === 'files') loadAgentCoreFile();
}

// A field label followed by a small info icon whose help shows on hover, so a
// form stays compact instead of carrying a paragraph of hint under every field.
// The tip text may contain \n to force a line break (e.g. one line per option
// of a shared/own choice) — rendered via the popup's `white-space: pre-line`.
function fieldLabelWithTip(label, tip) {
    return `<div class="agent-field-label-row">
        <label class="agent-field-label">${escapeHtml(label)}</label>
        <span class="agent-field-tip" data-tip="${escapeHtml(tip)}"><i class="fas fa-circle-info"></i></span>
    </div>`;
}

// Single popup instance fixed to <body>, positioned relative to whichever
// .agent-field-tip is hovered. Living outside every drawer/modal means it is
// never clipped by an ancestor's `overflow: auto` (unlike a CSS ::after would
// be inside the scrolling Agent detail pane).
let _fieldTipEl = null;
let _fieldTipIcon = null;  // which icon the popup currently belongs to
function _ensureFieldTipEl() {
    if (!_fieldTipEl) {
        _fieldTipEl = document.createElement('div');
        _fieldTipEl.className = 'agent-tip-popup';
        document.body.appendChild(_fieldTipEl);
    }
    return _fieldTipEl;
}

function _showFieldTip(iconEl) {
    const tip = iconEl.dataset.tip;
    if (!tip) return;
    // Already showing for this icon: don't re-measure/re-animate. Moving the
    // cursor from the <span> onto its own <i> would otherwise re-trigger the
    // whole show sequence and make the tip visibly flicker.
    if (_fieldTipIcon === iconEl && _fieldTipEl && _fieldTipEl.classList.contains('show')) return;
    _fieldTipIcon = iconEl;
    const popup = _ensureFieldTipEl();
    popup.textContent = tip;
    popup.classList.remove('show');
    popup.style.left = '0px';
    popup.style.top = '0px';
    // Measure after layout so width/height reflect the actual (possibly
    // multi-line) content before we clamp it into the viewport.
    requestAnimationFrame(() => {
        const rect = iconEl.getBoundingClientRect();
        const pw = popup.offsetWidth, ph = popup.offsetHeight;
        let left = rect.left + rect.width / 2 - pw / 2;
        const margin = 8;
        left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
        let top = rect.top - ph - 8;
        let arrowTop = false;
        if (top < margin) { top = rect.bottom + 8; arrowTop = true; } // flip below if clipped above
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.setProperty('--tip-arrow-x', `${rect.left + rect.width / 2 - left}px`);
        popup.classList.toggle('tip-arrow-top', arrowTop);
        popup.classList.add('show');
    });
}

function _hideFieldTip() {
    if (_fieldTipEl) _fieldTipEl.classList.remove('show');
    _fieldTipIcon = null;
}

document.addEventListener('mouseover', (e) => {
    const icon = e.target.closest ? e.target.closest('.agent-field-tip') : null;
    if (icon) _showFieldTip(icon);
});
document.addEventListener('mouseout', (e) => {
    const icon = e.target.closest ? e.target.closest('.agent-field-tip') : null;
    if (!icon) return;
    // mouseout fires when moving between the icon's own children (span -> <i>).
    // Only hide when the cursor actually leaves this icon's subtree, i.e. the
    // element it moved to isn't inside the same .agent-field-tip.
    const to = e.relatedTarget;
    if (to && icon.contains(to)) return;
    _hideFieldTip();
});
document.addEventListener('scroll', _hideFieldTip, true);

function renderAgentDetail() {
    const agent = findAgent(selectedAdminAgentId);
    const identity = document.getElementById('agent-detail-identity');
    const profile = document.getElementById('agent-detail-profile');
    if (!agent || !identity || !profile) return;
    identity.innerHTML = `
        ${agentAvatarHTML(agent, 56)}
        <div class="min-w-0">
            <div class="text-lg font-semibold text-surface-800 dark:text-surface-100 truncate">${escapeHtml(agent.name)}</div>
            <div class="text-xs text-surface-400 font-mono truncate">${escapeHtml(agent.id)}</div>
        </div>`;
    const isDefault = agent.id === defaultAgentId;
    // A shared (use/chat-only) user gets the same profile pane, read-only:
    // hiding Save/Delete is a UX nicety, not the access control -- the server
    // 404s any of these actions from someone who isn't the owner or an org
    // admin regardless (see agents.py's _require_owner_or_admin).
    const manageable = canManageAgent(agent);
    profile.classList.toggle('agent-detail-readonly', !manageable);
    profile.innerHTML = `
        <div class="agent-field">
            <label class="agent-field-label">${escapeHtml(t('agents_avatar'))}</label>
            <div id="agent-edit-avatar" class="agent-avatar-picker"></div>
        </div>
        <div class="agent-field">
            <label class="agent-field-label">${escapeHtml(t('agents_name'))}</label>
            <input id="agent-edit-name" value="${escapeHtml(agent.name)}" class="agent-input">
        </div>
        <div class="agent-field">
            ${fieldLabelWithTip(t('agents_description'), t('agents_description_hint'))}
            <textarea id="agent-edit-description" rows="4"
                   placeholder="${escapeHtml(t('agents_description_placeholder'))}"
                   class="agent-input agent-textarea">${escapeHtml(agent.description || '')}</textarea>
        </div>
        <div class="agent-field">
            <label class="agent-field-label">${escapeHtml(t('agents_model'))}</label>
            ${isDefault
                ? `<div class="agent-input-locked">${escapeHtml(t('agents_model_follows_global'))}</div>
                   <p class="agent-field-hint">${escapeHtml(t('agents_model_default_hint'))}</p>`
                : `<div id="agent-edit-model" class="cfg-dropdown" tabindex="0">
                       <div class="cfg-dropdown-selected">
                           <span class="cfg-dropdown-text">--</span>
                           <i class="fas fa-chevron-down cfg-dropdown-arrow"></i>
                       </div>
                       <div class="cfg-dropdown-menu"></div>
                   </div>`}
        </div>
        ${isDefault ? '' : `
        <div class="agent-field">
            ${fieldLabelWithTip(t('agents_knowledge'), t('agents_knowledge_hint'))}
            <div class="flex items-center gap-3">
                <div id="agent-knowledge-toggle" class="agent-seg" role="group">
                    <button type="button" class="agent-seg-btn ${agent.knowledge_mode !== 'own' ? 'active' : ''}" data-mode="shared" onclick="setAgentKnowledgeMode('${escapeHtml(agent.id)}','shared')">
                        <i class="fas fa-users mr-1"></i>${escapeHtml(t('agents_knowledge_shared'))}
                    </button>
                    <button type="button" class="agent-seg-btn ${agent.knowledge_mode === 'own' ? 'active' : ''}" data-mode="own" onclick="setAgentKnowledgeMode('${escapeHtml(agent.id)}','own')">
                        <i class="fas fa-box-archive mr-1"></i>${escapeHtml(t('agents_knowledge_own'))}
                    </button>
                </div>
                <span id="agent-knowledge-status" class="agent-field-hint" style="margin-top:0"></span>
            </div>
        </div>`}
        ${agent.owner_user_id == null ? '' : `
        <div class="agent-field">
            <label class="agent-field-label agent-field-checkbox">
                <input type="checkbox" id="agent-edit-visible-to-org" ${agent.visible_to_org ? 'checked' : ''}
                       onchange="setAgentVisibleToOrg('${escapeHtml(agent.id)}', this.checked)">
                ${escapeHtml(t('agents_visible_to_org'))}
            </label>
            <p class="agent-field-hint">${escapeHtml(t('agents_visible_to_org_hint'))}</p>
        </div>`}
        <div class="agent-field">
            <label class="agent-field-label agent-field-checkbox">
                <input type="checkbox" id="agent-edit-require-approval" ${agent.require_approval_for_writes ? 'checked' : ''}>
                ${escapeHtml(t('agents_require_approval'))}
            </label>
            <p class="agent-field-hint">${escapeHtml(t('agents_require_approval_hint'))}</p>
        </div>
        <div class="agent-field">
            <label class="agent-field-label">${escapeHtml(t('agents_watchdog_threshold'))}</label>
            <input type="number" min="1" id="agent-edit-watchdog-threshold" class="agent-input"
                   placeholder="${escapeHtml(t('agents_watchdog_default'))}"
                   value="${agent.watchdog_stall_threshold_seconds != null ? agent.watchdog_stall_threshold_seconds : ''}">
            <p class="agent-field-hint">${escapeHtml(t('agents_watchdog_threshold_hint'))}</p>
        </div>
        <div class="agent-field">
            <label class="agent-field-label">${escapeHtml(t('agents_watchdog_max_nudges'))}</label>
            <input type="number" min="1" id="agent-edit-watchdog-max-nudges" class="agent-input"
                   placeholder="${escapeHtml(t('agents_watchdog_default'))}"
                   value="${agent.watchdog_max_nudges != null ? agent.watchdog_max_nudges : ''}">
        </div>
        <div class="agent-field">
            <label class="agent-field-label">${escapeHtml(t('agents_watchdog_nudge_prompt'))}</label>
            <textarea id="agent-edit-watchdog-nudge-prompt" rows="3"
                   placeholder="${escapeHtml(t('agents_watchdog_nudge_prompt_placeholder'))}"
                   class="agent-input agent-textarea">${escapeHtml(agent.watchdog_nudge_prompt || '')}</textarea>
            <p class="agent-field-hint">${escapeHtml(t('agents_watchdog_nudge_prompt_hint'))}</p>
        </div>
        <div class="agent-field">
            <label class="agent-field-label">${escapeHtml(t('agents_custom_handler'))}</label>
            <input type="text" id="agent-edit-custom-handler" class="agent-input"
                   placeholder="${escapeHtml(t('agents_custom_handler_placeholder'))}"
                   value="${escapeHtml(agent.custom_handler || '')}">
            <p class="agent-field-hint">${escapeHtml(t('agents_custom_handler_hint'))}</p>
        </div>
        <div class="agent-detail-actions">
            ${manageable ? `<button type="button" onclick="saveAgentProfile()" class="agent-btn agent-btn-primary">${escapeHtml(t('save'))}</button>` : ''}
            <button type="button" onclick="startChatWithAgent('${escapeHtml(agent.id)}')" class="agent-btn agent-btn-ghost">${escapeHtml(t('agents_chat'))}</button>
            ${(manageable && !isDefault) ? `<button type="button" onclick="deleteAgent('${escapeHtml(agent.id)}')" class="agent-btn agent-btn-danger agent-detail-delete">${escapeHtml(t('agents_delete'))}</button>` : ''}
            ${manageable ? '' : `<span class="agent-field-hint" style="margin:0 0 0 auto">${escapeHtml(t('agents_shared_readonly_hint'))}</span>`}
        </div>
        <div id="agent-profile-status" class="agent-field-hint mt-3"></div>`;

    renderAvatarPicker('agent-edit-avatar', agent, (file) => uploadAgentAvatar(agent.id, file));

    if (!isDefault) {
        const dd = document.getElementById('agent-edit-model');
        const opts = agentModelDropdownOptions();
        const current = agent.model ? `${agent.bot_type || ''}|${agent.model}` : '';
        initDropdown(dd, opts, current, () => {}, { placeholder: t('agents_model_follows_global') });
    }
    // A save may re-render this pane several times; re-apply an in-flight
    // "saved" confirmation so it survives instead of being wiped.
    paintAgentSavedFlash();
}

/* A live preview beside an upload button, in the page's own styling rather than
   a raw file input. The default is the Agent's initial; uploading swaps it for
   the chosen image. `onUpload` may be null when the Agent does not exist yet
   (the create modal), leaving just the preview. */
function renderAvatarPicker(containerId, agent, onUpload) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = `
        <div class="agent-avatar-picker-preview">${agentAvatarHTML(agent, 56)}</div>
        <div class="agent-avatar-picker-body">
            ${onUpload ? `<button type="button" class="agent-avatar-upload">
                <i class="fas fa-arrow-up-from-bracket"></i><span>${escapeHtml(t('agents_avatar_upload'))}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            </button>` : ''}
        </div>`;
    const upload = box.querySelector('.agent-avatar-upload');
    if (upload && onUpload) {
        const input = upload.querySelector('input');
        upload.addEventListener('click', () => input.click());
        input.addEventListener('change', () => onUpload(input.files && input.files[0]));
    }
}

/* Flattened for the styled dropdown: one row per model, its provider carried in
   the value (a model asked of the wrong vendor is an error), its brand shown as
   a dim hint. The first row clears the choice back to the configured model. */
function agentModelDropdownOptions() {
    const opts = [{ value: '', label: t('agents_model_follows_global') }];
    const providers = (_sessCfg && _sessCfg.model && _sessCfg.model.providers) || [];
    providers.forEach(p => {
        (p.models || []).forEach(m => {
            opts.push({ value: `${p.id}|${m}`, label: m, hint: localizedLabel(p.label) });
        });
    });
    // A local runtime, not a hosted API -- no key/base to configure here, so
    // it never goes through the provider list above (see models/
    // claude_code_cli_bot.py's own docstring for what this actually governs).
    // "cli" is a placeholder model id the bot itself never reads; it only
    // exists because a non-empty model is what keeps admin.update_agent from
    // clearing bot_type back out on save.
    opts.push({ value: 'claude_code_cli|cli', label: t('agents_model_claude_code_cli'), hint: t('agents_model_local') });
    opts.push({ value: 'codex_cli|cli', label: t('agents_model_codex_cli'), hint: t('agents_model_local') });
    return opts;
}

// Persist an Agent's skill selection. Writes are serialized per Agent and
// coalesce to the latest desired state, so ticking several boxes quickly sends
// them in order (each with the revision the previous one returned) instead of
// racing and tripping the stale-roster guard. No catalog reload happens, so the
// grid, composer and avatars never flicker and the checkboxes never jump.
//   null  -> use every installed skill (the "use all" master toggle)
//   [...] -> exactly this subset ([] means none)
const _skillSaveState = {};  // agentId -> { inflight: bool, pending: skills|undefined }

function saveAgentSkills(agent, skills) {
    agent.skills = skills;  // optimistic; the pane already reflects it
    const st = _skillSaveState[agent.id] || (_skillSaveState[agent.id] = { inflight: false, pending: undefined });
    if (st.inflight) { st.pending = skills; return; }  // newest wins; drop stale intermediate
    st.inflight = true;
    fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: agent.id, revision: rosterRevision, skills }),
    }).then(r => r.json()).then(data => {
        if (data.status === 'success') {
            if (data.revision) rosterRevision = data.revision;
        } else {
            const status = document.getElementById('agent-editor-status');
            if (status) status.textContent = data.message || 'Update failed';
        }
    }).catch(() => {}).then(() => {
        st.inflight = false;
        if (st.pending !== undefined) {
            const next = st.pending;
            st.pending = undefined;
            saveAgentSkills(agent, next);  // flush the latest queued state
        }
    });
}

// Switch an Agent between the shared knowledge base and its own. This is a
// filesystem toggle (symlink vs a real knowledge/ dir), so it applies at once
// rather than waiting for the profile "save".
async function setAgentKnowledgeMode(agentId, mode) {
    const agent = findAgent(agentId);
    if (!agent || agent.knowledge_mode === mode) return;
    const status = document.getElementById('agent-knowledge-status');
    const paintActive = (m) => document.querySelectorAll('#agent-knowledge-toggle .agent-seg-btn')
        .forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    const prev = agent.knowledge_mode || 'shared';
    agent.knowledge_mode = mode;  // optimistic
    paintActive(mode);
    if (status) status.textContent = t('agents_knowledge_working') || '...';
    try {
        const res = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_knowledge_mode', id: agentId, mode }),
        });
        const data = await res.json();
        if (data.status === 'success') {
            agent.knowledge_mode = (data.mode || mode);
            paintActive(agent.knowledge_mode);
            if (status) status.textContent = '';
        } else {
            agent.knowledge_mode = prev;  // roll back
            paintActive(prev);
            if (status) status.textContent = data.message || t('agents_knowledge_failed') || 'Failed';
        }
    } catch (e) {
        agent.knowledge_mode = prev;
        paintActive(prev);
        if (status) status.textContent = t('agents_knowledge_failed') || 'Failed';
    }
}

// Fires immediately on toggle, same as setAgentKnowledgeMode above, rather
// than waiting for the big Save button -- a single boolean doesn't need a
// round trip through the rest of the profile form's fields to commit.
async function setAgentVisibleToOrg(agentId, checked) {
    const agent = findAgent(agentId);
    if (!agent) return;
    const prev = !!agent.visible_to_org;
    agent.visible_to_org = checked;  // optimistic
    try {
        const res = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', id: agentId, visible_to_org: checked, revision: rosterRevision }),
        });
        const data = await res.json();
        if (data.status === 'success') {
            if (data.revision) rosterRevision = data.revision;
            loadAgentCatalog();
        } else {
            agent.visible_to_org = prev;
            const checkbox = document.getElementById('agent-edit-visible-to-org');
            if (checkbox) checkbox.checked = prev;
            _wsToast(data.message || t('agents_share_failed'));
        }
    } catch (e) {
        agent.visible_to_org = prev;
        const checkbox = document.getElementById('agent-edit-visible-to-org');
        if (checkbox) checkbox.checked = prev;
        _wsToast(t('agents_share_failed'));
    }
}

function renderAgentSkillsPane() {
    const pane = document.getElementById('agent-detail-skills');
    const agent = findAgent(selectedAdminAgentId);
    if (!pane || !agent) return;
    const render = () => {
        const all = agent.skills == null;
        const picked = new Set(all ? [] : agent.skills);
        pane.innerHTML = `
            <label class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300 mb-3">
                <input type="checkbox" id="agent-skills-all" ${all ? 'checked' : ''}>
                <span>${escapeHtml(t('agents_skills_all'))}</span>
            </label>
            <p class="text-xs text-surface-400 mb-3">${escapeHtml(t('agents_skills_pick'))}</p>
            ${(installedSkills || []).map(skill => {
                const name = skill.name || skill.id;
                const checked = all || picked.has(name);
                return `<label class="agent-skill-row">
                    <input type="checkbox" class="agent-skill-item" value="${escapeHtml(name)}" ${checked ? 'checked' : ''} ${all ? 'disabled' : ''}>
                    <div>
                        <div class="text-sm text-surface-700 dark:text-surface-200">${escapeHtml(skill.display_name || name)}</div>
                        <div class="text-xs text-surface-400">${escapeHtml(skill.description || '')}</div>
                    </div>
                </label>`;
            }).join('')}`;
        document.getElementById('agent-skills-all')?.addEventListener('change', (e) => {
            // Toggle only flips ALL <-> empty subset. Turning it off starts from
            // an empty list so the user picks up exactly what they want, and the
            // stored value is [] rather than a full enumeration.
            const next = e.target.checked ? null : [];
            saveAgentSkills(agent, next);
            render();  // repaint in place — no page-wide reload, no flicker
        });
        pane.querySelectorAll('.agent-skill-item').forEach(box => {
            box.addEventListener('change', () => {
                const names = Array.from(pane.querySelectorAll('.agent-skill-item:checked')).map(el => el.value);
                saveAgentSkills(agent, names);
            });
        });
    };
    if (installedSkills.length) {
        render();
        return;
    }
    fetch('/api/skills').then(r => r.json()).then(data => {
        installedSkills = data.skills || [];
        render();
    }).catch(() => {
        pane.innerHTML = `<p class="text-sm text-surface-400">${escapeHtml(t('agents_skills_all'))}</p>`;
    });
}

// Held between opening the create modal and a successful create: the chosen
// avatar has nowhere to live server-side until the Agent exists, so we keep the
// File and its preview URL client-side and upload once creation returns.
let _pendingCreateAvatar = null;
let _createKnowledgeMode = 'shared';

// What the Agent being filled in would look like: no id yet, so the disc is the
// neutral tone and only the initial follows the name.
function createAvatarDraft() {
    const name = document.getElementById('agent-create-name');
    return { id: '', name: (name && name.value) || '', avatar: '' };
}

// Repaint just the preview disc as the name is typed. The whole picker is not
// re-rendered because that would rebind the upload input on every keystroke.
function refreshCreateAvatarPreview() {
    if (_pendingCreateAvatar) return;
    const slot = document.querySelector('#agent-create-avatar .agent-avatar-picker-preview');
    if (slot) slot.innerHTML = agentAvatarHTML(createAvatarDraft(), 56);
}

// The create modal's avatar picker: same look as the edit one, but the upload
// is staged locally (preview from an object URL) instead of POSTed immediately.
function renderCreateAvatarPicker() {
    const box = document.getElementById('agent-create-avatar');
    if (!box) return;
    const preview = _pendingCreateAvatar
        ? `<img class="agent-avatar agent-avatar-56" src="${_pendingCreateAvatar.url}" alt="">`
        : agentAvatarHTML(createAvatarDraft(), 56);
    box.innerHTML = `
        <div class="agent-avatar-picker-preview">${preview}</div>
        <div class="agent-avatar-picker-body">
            <button type="button" class="agent-avatar-upload">
                <i class="fas fa-arrow-up-from-bracket"></i><span>${escapeHtml(t('agents_avatar_upload'))}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            </button>
        </div>`;
    const upload = box.querySelector('.agent-avatar-upload');
    const input = upload.querySelector('input');
    upload.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (_pendingCreateAvatar && _pendingCreateAvatar.url) URL.revokeObjectURL(_pendingCreateAvatar.url);
        _pendingCreateAvatar = { file, url: URL.createObjectURL(file) };
        renderCreateAvatarPicker();
    });
}

function openAgentCreateForm() {
    const form = document.getElementById('agent-create-form');
    if (!form) return;
    form.classList.remove('hidden');
    const name = document.getElementById('agent-create-name');
    // The id is typed by hand or left blank on purpose; nothing writes to it
    // while the form is open. A blank one is filled in once, at submit.
    const id = document.getElementById('agent-create-id');
    const description = document.getElementById('agent-create-description');
    [name, id, description].forEach(el => { if (el) el.value = ''; });
    document.getElementById('agent-create-status').textContent = '';

    // The Agent has no home to store an avatar in yet, so the upload is held in
    // memory and previewed locally; it is POSTed the moment creation succeeds.
    _pendingCreateAvatar = null;
    renderCreateAvatarPicker();
    if (name && !name.dataset.avatarBound) {
        name.dataset.avatarBound = '1';
        // Without an upload the face is the name's first character, so the
        // preview has to follow what is being typed.
        name.addEventListener('input', refreshCreateAvatarPreview);
    }

    // Knowledge defaults to shared; reset the segmented control on every open.
    _createKnowledgeMode = 'shared';
    document.querySelectorAll('#agent-create-knowledge .agent-seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'shared');
        if (!b.dataset.bound) {
            b.dataset.bound = '1';
            b.addEventListener('click', () => {
                _createKnowledgeMode = b.dataset.mode;
                document.querySelectorAll('#agent-create-knowledge .agent-seg-btn')
                    .forEach(x => x.classList.toggle('active', x === b));
            });
        }
    });

    const clone = document.getElementById('agent-create-clone');
    if (clone) {
        // Options carry the agent so both the row and the trigger show its
        // avatar + name; "blank" (no clone) has no face.
        const opts = [{ value: '', label: t('agents_clone_none') }].concat(
            enabledAgents().map(a => ({
                value: a.id,
                label: a.name || a.id,
                agent: a,
            }))
        );
        initDropdown(clone, opts, '', () => {});
    }
}

function closeAgentCreateForm() {
    document.getElementById('agent-create-form')?.classList.add('hidden');
    if (_pendingCreateAvatar && _pendingCreateAvatar.url) URL.revokeObjectURL(_pendingCreateAvatar.url);
    _pendingCreateAvatar = null;
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('composer-agent-menu');
    const btn = document.getElementById('composer-agent-btn');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
        menu.classList.add('hidden');
    }
    const modal = document.getElementById('agent-create-form');
    if (modal && !modal.classList.contains('hidden') && e.target === modal) {
        closeAgentCreateForm();
    }
    const newMenu = document.getElementById('new-chat-menu');
    const newWrap = document.querySelector('.session-panel-new-wrap');
    if (newMenu && !newMenu.classList.contains('hidden') && newWrap && !newWrap.contains(e.target)) {
        newMenu.classList.add('hidden');
    }
});

function createAgentWorkspace() {
    const name = document.getElementById('agent-create-name').value.trim();
    const status = document.getElementById('agent-create-status');
    if (!name) {
        status.textContent = t('agents_name_required');
        return;
    }
    // A hand-typed id is used as given; blank falls back to the name's slug,
    // and then to a random one when the name has no ascii to slug (e.g. it is
    // written in Chinese). Generated here rather than while typing so the field
    // stays exactly as the user left it.
    const typed = document.getElementById('agent-create-id').value.trim();
    const id = typed || slugAgentId(name) || randomAgentId();
    // Mirrors the server's rule, so a bad id is caught before the round trip.
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
        status.textContent = t('agents_id_invalid');
        return;
    }
    fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'create',
            id,
            name,
            description: document.getElementById('agent-create-description')?.value.trim() || '',
            clone_from: getDropdownValue(document.getElementById('agent-create-clone')) || null,
            knowledge_mode: _createKnowledgeMode,
            revision: rosterRevision,
        }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            throw new Error(data.code === 'stale_roster' ? t('agents_stale') : (data.message || 'Create failed'));
        }
        if (data.revision) rosterRevision = data.revision;
        // Now that the workspace exists, push the staged avatar (if any) before
        // reloading, so the roster arrives already carrying the new image.
        const avatarStep = _pendingCreateAvatar
            ? uploadAgentAvatar(id, _pendingCreateAvatar.file).catch(() => {})
            : Promise.resolve();
        closeAgentCreateForm();
        return avatarStep.then(() => loadAgentCatalog()).then(() => openAgentDetail(id));
    }).catch(err => { status.textContent = err.message; });
}

function saveAgentProfile() {
    const agent = findAgent(selectedAdminAgentId);
    if (!agent) return;
    const payload = {
        name: document.getElementById('agent-edit-name')?.value.trim(),
        description: document.getElementById('agent-edit-description')?.value.trim() || '',
        require_approval_for_writes: !!document.getElementById('agent-edit-require-approval')?.checked,
    };
    // Absent for the default Agent, which follows the configured model.
    const picker = document.getElementById('agent-edit-model');
    if (picker) {
        const [provider, model] = (getDropdownValue(picker) || '').split('|');
        payload.model = model || '';
        payload.bot_type = provider || '';
    }
    // Empty field -> null (fall back to the watchdog task's own/global default).
    const thresholdVal = document.getElementById('agent-edit-watchdog-threshold')?.value;
    payload.watchdog_stall_threshold_seconds = thresholdVal ? parseInt(thresholdVal, 10) : null;
    const maxNudgesVal = document.getElementById('agent-edit-watchdog-max-nudges')?.value;
    payload.watchdog_max_nudges = maxNudgesVal ? parseInt(maxNudgesVal, 10) : null;
    const nudgePromptVal = document.getElementById('agent-edit-watchdog-nudge-prompt')?.value.trim();
    payload.watchdog_nudge_prompt = nudgePromptVal || null;
    const customHandlerVal = document.getElementById('agent-edit-custom-handler')?.value.trim();
    payload.custom_handler = customHandlerVal || null;
    // The write itself is quick; the follow-up catalog reload is what's slow
    // (the default Agent carries a large skill list). Confirm optimistically so
    // the feedback is instant, and only override it if the save actually fails.
    flashAgentProfileStatus();
    updateAgentWorkspace(agent.id, payload).then(ok => {
        if (!ok) {
            _agentSavedFlashUntil = 0;
            const status = document.getElementById('agent-profile-status');
            if (status) {
                status.textContent = t('agents_save_failed');
                status.classList.remove('agent-status-ok');
            }
        }
    });
}

/* A brief inline confirmation on the detail pane's status line. A save reloads
   the catalog and can re-render this pane more than once (the model catalog
   arrives async), so the confirmation is kept as a deadline that every render
   re-applies, rather than a one-shot write a later render would wipe. */
let _agentSavedFlashUntil = 0;

function paintAgentSavedFlash() {
    const status = document.getElementById('agent-profile-status');
    if (!status) return;
    if (Date.now() < _agentSavedFlashUntil) {
        status.textContent = t('agents_saved');
        status.classList.add('agent-status-ok');
    }
}

function flashAgentProfileStatus() {
    _agentSavedFlashUntil = Date.now() + 2200;
    paintAgentSavedFlash();
    clearTimeout(flashAgentProfileStatus._t);
    flashAgentProfileStatus._t = setTimeout(() => {
        _agentSavedFlashUntil = 0;
        const status = document.getElementById('agent-profile-status');
        if (!status) return;
        status.textContent = '';
        status.classList.remove('agent-status-ok');
    }, 2200);
}

function uploadAgentAvatar(agentId, file) {
    if (!file) return;
    const picker = document.getElementById('agent-edit-avatar');
    if (picker) picker.classList.add('is-uploading');
    const status = document.getElementById('agent-profile-status');
    if (status) { status.classList.remove('agent-status-ok'); status.textContent = ''; }
    const form = new FormData();
    form.append('avatar', file);
    return fetch(`/api/agents/${encodeURIComponent(agentId)}/avatar`, { method: 'POST', body: form })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') throw new Error(data.message || 'Upload failed');
            // The image already persisted server-side. Patch the local catalog in
            // place and repaint just the affected surfaces, rather than reloading
            // the whole roster (slow when the default Agent carries many skills).
            avatarVersions[agentId] = String(Date.now());
            if (data.revision) rosterRevision = data.revision;
            const agent = findAgent(agentId);
            if (agent) agent.avatar = 'image';
            renderAgentsGrid();
            if (selectedAdminAgentId === agentId) renderAgentDetail();
            renderComposerIdentity();
            refreshBubbleAvatars();
            flashAgentProfileStatus();
        })
        .catch(err => {
            const s = document.getElementById('agent-profile-status');
            if (s) { s.classList.remove('agent-status-ok'); s.textContent = err.message; }
        })
        .then(() => {
            const p = document.getElementById('agent-edit-avatar');
            if (p) p.classList.remove('is-uploading');
        });
}

function updateAgentWorkspace(agentId, updates, _retried) {
    return fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: agentId, revision: rosterRevision, ...updates }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            // Two quick edits race: the second still carried the revision from
            // before the first landed. Re-sync and retry once, silently, so a
            // fast click just works instead of showing a lock error.
            if (data.code === 'stale_roster' && !_retried) {
                return loadAgentCatalog().then(() => updateAgentWorkspace(agentId, updates, true));
            }
            throw new Error(data.code === 'stale_roster' ? t('agents_stale') : (data.message || 'Update failed'));
        }
        return loadAgentCatalog().then(() => true);
    }).catch(err => {
        const status = document.getElementById('agent-profile-status') || document.getElementById('agent-editor-status');
        if (status) status.textContent = err.message;
        return false;
    });
}

function deleteAgent(agentId) {
    const agent = findAgent(agentId);
    if (!agent) return;
    if (agentId === defaultAgentId) return; // the default Agent is the instance
    showConfirmDialog({
        title: t('agents_delete_title'),
        message: t('agents_delete_confirm').replace('{name}', agent.name || agentId),
        okText: t('agents_delete'),
        cancelText: t('cancel'),
        onConfirm: () => _performAgentDelete(agentId),
    });
}

function _performAgentDelete(agentId, _retried) {
    return fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: agentId, revision: rosterRevision }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            if (data.code === 'stale_roster' && !_retried) {
                return loadAgentCatalog().then(() => _performAgentDelete(agentId, true));
            }
            throw new Error(data.code === 'stale_roster' ? t('agents_stale') : (data.message || 'Delete failed'));
        }
        // Leaving the detail open on a now-deleted Agent would show a ghost.
        if (selectedAdminAgentId === agentId) closeAgentDetail();
        // A conversation owned by the deleted Agent falls back to the default.
        if (activeAgentId === agentId) {
            activeAgentId = defaultAgentId;
            localStorage.setItem('cow_active_agent', activeAgentId);
        }
        // Drop the deleted Agent's remembered session id — its conversations
        // went with the workspace, so the pinned id would only re-pin a ghost.
        localStorage.removeItem(`${SESSION_ID_KEY}:${agentId}`);
        return loadAgentCatalog().then(() => {
            renderComposerIdentity();
            // The Agent's sessions were removed server-side; refresh the open
            // list so its rows don't linger until the next unrelated reload.
            if (typeof loadSessionList === 'function') loadSessionList();
            return true;
        });
    }).catch(err => {
        const status = document.getElementById('agent-profile-status');
        if (status) status.textContent = err.message;
        else alert(err.message);
        return false;
    });
}

// The four core files an Agent can be edited through. BOOTSTRAP.md exists on
// disk for internal use but isn't meant for hand-editing, so it's left out of
// the picker entirely. Each option carries a short hint (rendered on the
// right of the dropdown row) so the raw filename isn't the only clue to what
// it holds.
function _agentCoreFileOptions() {
    return [
        { value: 'AGENT.md', label: 'AGENT.md', hint: t('agents_core_file_agent') },
        { value: 'USER.md', label: 'USER.md', hint: t('agents_core_file_user') },
        { value: 'RULE.md', label: 'RULE.md', hint: t('agents_core_file_rule') },
        { value: 'MEMORY.md', label: 'MEMORY.md', hint: t('agents_core_file_memory') },
    ];
}

let agentCoreViewMode = 'edit';

function initAgentCoreFileDropdown() {
    const el = document.getElementById('agent-core-file');
    if (!el) return;
    const current = el._ddValue || 'AGENT.md';
    initDropdown(el, _agentCoreFileOptions(), current, () => loadAgentCoreFile());
}

function currentAgentCoreFile() {
    const el = document.getElementById('agent-core-file');
    return (el && el._ddValue) || 'AGENT.md';
}

function setAgentCoreViewMode(mode) {
    agentCoreViewMode = mode;
    document.querySelectorAll('#agent-core-mode .agent-seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    const editor = document.getElementById('agent-core-editor');
    const preview = document.getElementById('agent-core-preview');
    if (!editor || !preview) return;
    if (mode === 'preview') {
        preview.innerHTML = renderMarkdown(editor.value || '');
        // Same post-processing chat messages get: syntax highlighting plus the
        // language label + copy button on each code block (renderMarkdown only
        // produces the raw <pre>; the headers are added to the live DOM after).
        if (typeof applyHighlighting === 'function') applyHighlighting(preview);
        editor.classList.add('hidden');
        preview.classList.remove('hidden');
    } else {
        preview.classList.add('hidden');
        editor.classList.remove('hidden');
    }
}

function loadAgentCoreFile() {
    if (!selectedAdminAgentId) return;
    initAgentCoreFileDropdown();
    const filename = currentAgentCoreFile();
    if (!filename) return;
    _paintCoreFileStatus('pending', '…');
    fetch(`/api/agents/${encodeURIComponent(selectedAdminAgentId)}/files/${encodeURIComponent(filename)}`)
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') throw new Error(data.message || t('agents_save_failed'));
            selectedCoreRevision = data.revision;
            document.getElementById('agent-core-editor').value = data.content || '';
            document.getElementById('agent-editor-label').textContent = `${selectedAdminAgentId} / ${filename}`;
            // The revision hash meant nothing to a human reader; a blank status
            // (nothing to report) reads better than a stray hex fragment.
            _paintCoreFileStatus('pending', '');
            // Refresh the preview in place if that's the active view, so
            // switching files while in preview mode doesn't show stale content.
            if (agentCoreViewMode === 'preview') setAgentCoreViewMode('preview');
        }).catch(err => { _paintCoreFileStatus('error', err.message); });
}

// Paint the save status with a colour + icon, not just bare text, so success
// and failure actually read differently at a glance. Success fades back to
// blank after a bit; failure stays until the next attempt so it isn't missed.
//
// Every other `*-status` element in this console is hidden via the shared
// `opacity-0` convention (see navigateTo/setLanguage, which blanket-fade any
// `[id$="-status"]` element on navigation). This one has the same id suffix
// so it gets caught by that same sweep — it must toggle `opacity-0` itself
// too, or a stray earlier sweep leaves it permanently invisible no matter
// what innerHTML is painted into it afterwards.
function _paintCoreFileStatus(kind, text) {
    const status = document.getElementById('agent-editor-status');
    if (!status) return;
    clearTimeout(_paintCoreFileStatus._t);
    status.classList.remove('agent-status-ok', 'agent-status-error');
    if (kind === 'ok') {
        status.innerHTML = `<i class="fas fa-check mr-1"></i>${escapeHtml(text)}`;
        status.classList.add('agent-status-ok');
        status.classList.remove('opacity-0');
        _paintCoreFileStatus._t = setTimeout(() => {
            status.textContent = '';
            status.classList.remove('agent-status-ok');
            status.classList.add('opacity-0');
        }, 2200);
    } else if (kind === 'error') {
        status.innerHTML = `<i class="fas fa-triangle-exclamation mr-1"></i>${escapeHtml(text)}`;
        status.classList.add('agent-status-error');
        status.classList.remove('opacity-0');
    } else {
        status.textContent = text || '';
        if (text) status.classList.remove('opacity-0');
    }
}

function saveAgentCoreFile() {
    if (!selectedAdminAgentId) return;
    const filename = currentAgentCoreFile();
    const btn = document.querySelector('#agent-detail-files button[onclick="saveAgentCoreFile()"]');
    _paintCoreFileStatus('pending', '…');
    if (btn) btn.disabled = true;
    fetch(`/api/agents/${encodeURIComponent(selectedAdminAgentId)}/files/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: document.getElementById('agent-core-editor').value, revision: selectedCoreRevision }),
    }).then(async r => ({ ok: r.ok, data: await r.json() })).then(({ ok, data }) => {
        if (!ok || data.status !== 'success') throw new Error(data.message || t('agents_save_failed'));
        selectedCoreRevision = data.revision;
        _paintCoreFileStatus('ok', t('agents_saved'));
    }).catch(err => {
        _paintCoreFileStatus('error', err.message);
    }).finally(() => {
        if (btn) btn.disabled = false;
    });
}

function startChatWithAgent(agentId) {
    if (!agentId) return;
    activeAgentId = agentId;
    localStorage.setItem('cow_active_agent', activeAgentId);
    newChat(true);
    navigateTo('chat');
    renderComposerIdentity();
}

function conversationHasMessages() {
    return !!document.querySelector('#chat-messages .user-message-group, #chat-messages .bot-message-group');
}

/** A roster of one behaves exactly like the console did before Agents existed:
 *  no face on the composer, no faces in the session list, no @ mentions. */
function multiAgentMode() {
    return enabledAgents().length > 1;
}

/** True once this conversation holds more than its owner. Until then it is an
 *  ordinary chat and is drawn like one. */
function sharedConversation() {
    return multiAgentMode() && currentTeamIds().length > 0;
}

// Who is answering each in-flight request, as reported when it was accepted.
// Lets a streaming bubble carry the right name before anything is persisted.
const _liveSpeakers = {};

function rememberLiveSpeaker(data) {
    if (data && data.request_id && data.speaker) {
        _liveSpeakers[data.request_id] = data.speaker;
    }
}

/** Repaint a still-visible loading indicator with the resolved speaker's face,
 *  once /message has said who took the turn. No-op if streaming already
 *  replaced the dots with a bubble. */
function setLoadingSpeaker(loadingEl, requestId) {
    if (!loadingEl || !loadingEl.isConnected) return;
    const face = loadingEl.querySelector('.bot-face');
    if (face) face.innerHTML = agentAvatarHTML(liveSpeakerAgent(requestId), 32);
}

/** The Agent to draw on a reply, or null to keep the product's own face. */
function botSpeakerAgent(msg, requestId) {
    if (!sharedConversation()) return null;
    const id = (msg && msg.extras && msg.extras.agent_id)
        || (requestId && _liveSpeakers[requestId])
        || activeAgentId;
    return findAgent(id) || null;
}

/** The Agent answering a live request, for the streaming bubble and the loading
 *  dots. Unlike botSpeakerAgent this also resolves in a solo chat, so a single
 *  Agent's own uploaded avatar shows while it streams instead of the logo. */
function liveSpeakerAgent(requestId) {
    const id = (requestId && _liveSpeakers[requestId]) || activeAgentId;
    return findAgent(id) || null;
}

/** Turn a written-out mention into a chip, so a name reads as a name instead
 *  of as an id someone pasted. Runs on the rendered bubble rather than on the
 *  markdown source, which keeps code spans untouched. */
function highlightMentions(root) {
    const roster = sessionRoster();
    if (!root || roster.length < 2) return;
    const byLabel = new Map();
    roster.forEach(agent => {
        [agent.name, agent.id].forEach(label => {
            if (label) byLabel.set(String(label).toLowerCase(), agent);
        });
    });
    const alternation = Array.from(byLabel.keys())
        .sort((a, b) => b.length - a.length)
        .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const re = new RegExp('@(' + alternation + ')(?=[\\s，,：:、]|$)', 'gi');

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.parentElement
            && node.parentElement.closest('code, pre, .mention-tag')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
    });
    const targets = [];
    let node;
    while ((node = walker.nextNode())) {
        re.lastIndex = 0;
        if (re.test(node.nodeValue)) targets.push(node);
    }
    targets.forEach(text => {
        const value = text.nodeValue;
        const frag = document.createDocumentFragment();
        let cursor = 0;
        let match;
        re.lastIndex = 0;
        while ((match = re.exec(value))) {
            if (match.index > cursor) {
                frag.appendChild(document.createTextNode(value.slice(cursor, match.index)));
            }
            const agent = byLabel.get(match[1].toLowerCase());
            const tag = document.createElement('span');
            tag.className = 'mention-tag';
            if (agent) {
                // A chip that looks like the teammate it names: their face, then
                // their name. Falls back to plain text for an unknown label.
                tag.innerHTML = `<span class="mention-tag-face">${agentAvatarHTML(agent, 16)}</span><span class="mention-tag-name">${escapeHtml(agent.name || agent.id)}</span>`;
            } else {
                tag.textContent = '@' + match[1];
            }
            frag.appendChild(tag);
            cursor = match.index + match[0].length;
        }
        if (cursor < value.length) {
            frag.appendChild(document.createTextNode(value.slice(cursor)));
        }
        text.parentNode.replaceChild(frag, text);
    });
}

function renderComposerIdentity() {
    const wrap = document.getElementById('composer-identity');
    const btn = document.getElementById('composer-agent-btn');
    if (!wrap || !btn) return;
    // A single-Agent install keeps the composer exactly as it always was: no
    // avatar, no menu. The identity chip only appears once there is more than
    // one Agent and thus an actual choice to make.
    if (!multiAgentMode()) {
        wrap.classList.add('hidden');
        document.getElementById('composer-agent-menu')?.classList.add('hidden');
        return;
    }
    wrap.classList.remove('hidden');
    const agent = findAgent(activeAgentId) || { id: activeAgentId || defaultAgentId, name: activeAgentId || 'Agent' };
    const others = currentTeamIds().length;
    btn.innerHTML = agentAvatarHTML(agent, 22)
        + (others ? `<span class="composer-agent-count">${others + 1}</span>` : '');
    const face = btn.querySelector('.agent-avatar');
    if (face) face.id = 'composer-agent-avatar';
    // The owner can only be swapped before the first turn, but joining is
    // allowed at any point, so the button itself never goes dead.
    btn.classList.toggle('locked', conversationHasMessages());
    btn.dataset.tooltip = agent.name || agent.id;
}

function toggleComposerAgentMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('composer-agent-menu');
    if (!menu) return;
    if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        return;
    }
    _closeComposerMenus(menu);
    renderComposerAgentMenu();
    menu.classList.remove('hidden');
}

/** Paint the agent menu's body: who you're talking to, and everyone you
 *  could start a Team with. One feature for multi-Agent collaboration now
 *  (see agent.workspace.team_store) -- there is no more in-place "invite
 *  into this thread" roster here; starting one with someone always opens
 *  the Teams page, same as clicking + New Team there. An existing shared
 *  conversation from before this change keeps working exactly as it did
 *  (its messages still route the same way, its sidebar icon is unchanged)
 *  but is no longer editable from the composer -- manage it from Teams. */
function renderComposerAgentMenu() {
    const menu = document.getElementById('composer-agent-menu');
    if (!menu) return;
    const sections = [];

    const current = findAgent(activeAgentId)
        || { id: activeAgentId, name: activeAgentId };
    sections.push(
        `<div class="composer-menu-title">${escapeHtml(t('composer_current_agent'))}</div>`
        + `<div class="composer-menu-item agent-row current">
                ${agentAvatarHTML(current, 24)}
                <span>${escapeHtml(current.name || current.id)}</span>
                <i class="fas fa-check ml-auto text-[11px]"></i>
            </div>`
    );

    const candidates = enabledAgents().filter(a => a.id !== activeAgentId);
    const invitable = candidates.map(agent => `
        <button type="button" class="composer-menu-item agent-row"
                onclick="startTeamWith('${escapeHtml(agent.id)}')">
            ${agentAvatarHTML(agent, 24)}
            <span>${escapeHtml(agent.name)}</span>
            <i class="fas fa-people-group ml-auto text-[11px] text-surface-400"></i>
        </button>`).join('');
    if (invitable) {
        sections.push(
            `<div class="composer-menu-title">${escapeHtml(t('team_start_with'))}</div>${invitable}`
        );
    }

    // Always offer a way to make a new Agent, so a single-Agent user discovers
    // the team feature straight from the composer.
    sections.push(
        `<button type="button" class="composer-menu-item agent-row composer-menu-create"
                onclick="openAgentCreateFromComposer()">
            <span class="composer-menu-create-icon"><i class="fas fa-plus"></i></span>
            <span>${escapeHtml(t('agents_create'))}</span>
        </button>`
    );

    menu.innerHTML = sections.join('<div class="composer-menu-sep"></div>');
}

/** Jump from the composer straight into agent creation: close the menu, land on
 *  the team tab, and open the create form. */
function openAgentCreateFromComposer() {
    document.getElementById('composer-agent-menu')?.classList.add('hidden');
    navigateTo('agents');
    if (typeof openAgentCreateForm === 'function') openAgentCreateForm();
}

/** Start a real Team with this Agent -- creates one (you as Leader, them as
 *  the first teammate) via the same API the Teams page's own "New Team"
 *  form uses, then takes you straight there. The one way to begin
 *  multi-Agent collaboration now, wherever you click "+" to start it from. */
function startTeamWith(agentId) {
    document.getElementById('composer-agent-menu')?.classList.add('hidden');
    const leader = findAgent(activeAgentId) || { id: activeAgentId, name: activeAgentId };
    const teammate = findAgent(agentId) || { id: agentId, name: agentId };
    fetch('/api/teams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: `${leader.name} + ${teammate.name}`,
            members: [
                { agent_id: leader.id, role: 'leader' },
                { agent_id: teammate.id, role: 'teammate' },
            ],
        }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        navigateTo('teams');
        if (typeof teamsList !== 'undefined') teamsList.unshift(data.team);
        if (typeof selectTeam === 'function') selectTeam(data.team.id);
    }).catch(() => _wsToast(t('team_action_failed')));
}

/** Everyone addressable in this conversation, owner first. */
function sessionRoster() {
    const owner = findAgent(activeAgentId);
    const members = (_sessCfg && _sessCfg.team && _sessCfg.team.members) || [];
    const roster = owner ? [owner] : [];
    members.forEach(m => {
        if (!roster.some(a => a.id === m.id)) roster.push(findAgent(m.id) || m);
    });
    return roster;
}

/** The teammate a message hands the turn to, or '' for nobody.
 *  Mirrors the server's rule: a leading mention only. */
function addressedAgentId(text) {
    const stripped = String(text || '').replace(/^\s+/, '');
    if (!stripped.startsWith('@')) return '';
    const labels = [];
    sessionRoster().forEach(agent => {
        [agent.name, agent.id].forEach(label => {
            if (label) labels.push([String(label), agent.id]);
        });
    });
    labels.sort((a, b) => b[0].length - a[0].length);
    for (const [label, id] of labels) {
        const re = new RegExp('^@' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s，,：:、]|$)', 'i');
        // The owner is addressable too; the server treats "@owner" as the owner
        // simply taking the turn, so no special-casing here.
        if (re.test(stripped)) return id;
    }
    return '';
}

function mentionedAgentIds(text) {
    const id = addressedAgentId(text);
    return id ? [id] : [];
}

function currentTeamIds() {
    return ((_sessCfg && _sessCfg.team && _sessCfg.team.members) || []).map(m => m.id);
}

function setTeamMembers(ids) {
    const unique = Array.from(new Set(ids.filter(id => id && id !== activeAgentId)));
    return fetch(`/api/sessions/${encodeURIComponent(sessionId)}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: unique.length ? unique : null }),
    }).then(r => r.json()).then(data => {
        if (data.status === 'success') {
            _sessCfg = { model: data.model, permission: data.permission, team: data.team };
            renderComposerIdentity();
            // Inviting or removing someone changes whether one model can speak
            // for this conversation, and whether @ can address an Agent.
            _renderModelChip();
            _renderInputPlaceholder();
            // Keep the session list's faces in step with the roster we just
            // changed, which it cannot read from the API until the first message.
            if (typeof setSessionParticipants === 'function') {
                setSessionParticipants(sessionId, data.team);
            }
        }
    });
}

function addTeamMember(agentId) {
    if (!agentId || agentId === activeAgentId) return Promise.resolve();
    const ids = currentTeamIds();
    if (ids.includes(agentId)) return Promise.resolve();
    return setTeamMembers([...ids, agentId]);
}

function removeTeamMember(agentId) {
    return setTeamMembers(currentTeamIds().filter(id => id !== agentId))
        .then(refreshComposerAgentMenuIfOpen);
}

/** Repaint the agent menu if it is still open, so add/remove show immediately. */
function refreshComposerAgentMenuIfOpen() {
    const menu = document.getElementById('composer-agent-menu');
    if (menu && !menu.classList.contains('hidden')) renderComposerAgentMenu();
}

async function syncTeamFromText(text) {
    const extra = mentionedAgentIds(text);
    if (!extra.length) return;
    await setTeamMembers([...currentTeamIds(), ...extra]);
}

// Point a channel instance at an Agent. Binding lives on the instance itself
// (channel_instances[].agent_id); an empty agentId means "follow the default
// Agent". instanceId defaults to the channel type for a single-instance channel.
function bindChannelAgent(channelType, agentId, instanceId, members) {
    const defaultId = defaultAgentId;
    const bound = (agentId && agentId !== defaultId) ? agentId : '';
    const iid = instanceId || channelType;
    const payload = {
        action: 'bind_channel_instance',
        channel_type: channelType,
        instance_id: iid,
        agent_id: bound,
    };
    // Only send members when we mean to set the team; omitting it leaves the
    // stored roster untouched (a plain owner-only rebind).
    if (Array.isArray(members)) payload.members = members;
    return fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') throw new Error(data.message || 'Save failed');
        // Rebinding is a hot swap on the server (no channel restart), and the
        // dropdown already reflects the new value locally, so only the roster
        // catalog needs refreshing. Re-rendering the channels view here would
        // rebuild the cards and reset the scan/manual tab state for no reason.
        if (Array.isArray(channelInstancesView)) {
            const rec = channelInstancesView.find(i => i.instance_id === iid);
            if (rec) {
                rec.agent_id = bound;
                if (data.result && Array.isArray(data.result.members)) {
                    rec.members = data.result.members.slice();
                }
            }
        }
        return loadAgentCatalog();
    }).catch(err => _wsToast(err.message));
}

function channelBoundAgentId(channelType) {
    const inst = channelInstances.find(i =>
        (i.channel_type || '').toLowerCase() === channelType
    );
    return inst ? (inst.agent_id || '') : '';
}

let memoryAgentId = localStorage.getItem('cow_memory_agent') || '';

function viewingMemoryAgentId() {
    return memoryAgentId || activeAgentId || defaultAgentId;
}

function renderMemoryAgentSelect() {
    const el = document.getElementById('memory-agent-select');
    if (!el) return;
    const current = viewingMemoryAgentId();
    const list = agentCatalog.length ? agentCatalog : enabledAgents();
    const options = list.map(a => ({ value: a.id, label: a.name || a.id, agent: a }));
    initDropdown(el, options, current, (value) => selectMemoryAgent(value), { withAvatar: true });
}

function selectMemoryAgent(agentId) {
    memoryAgentId = agentId;
    localStorage.setItem('cow_memory_agent', agentId);
    closeMemoryViewer();
    loadMemoryView(1);
}

