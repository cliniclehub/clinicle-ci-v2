/* Settings shell: sub-nav switching between the panes that each used to be
 * their own top-level .view (config, security-access, agents-org,
 * connectors, channels, skills, sovereignty), plus two new panes
 * (Permissions, Activity) backed by the org capability system in
 * agent/permission/capabilities.py + channel/web/api/tenancy.py.
 *
 * Entered via nav.js's navigateTo('settings', tab) -> loadSettingsView(tab).
 * Each pane's own load*View() function (defined in its own view file) is
 * still what actually populates it -- this file only owns the shell: which
 * pane is visible, the sub-nav's active state, and capability-based hiding
 * of nav items a member role can't use. */

let _settingsCapabilitiesLoaded = false;
let myCapabilities = new Set();
let myOrgRole = null;

function loadSettingsView(tab) {
    _loadMyCapabilities(() => {
        _applySettingsCapabilityGating();
        switchSettingsPane(tab || 'general');
    });
}

function _loadMyCapabilities(then) {
    // Cheap to skip re-fetching every time Settings is re-entered in the same
    // session -- a role/capability change made by an admin elsewhere in the
    // same tab is rare enough that a reload before it matters is acceptable,
    // same trade-off defaultAgentId and other session-lifetime caches make.
    if (_settingsCapabilitiesLoaded) { then(); return; }
    fetch('/api/me/capabilities').then(r => r.json()).then(data => {
        if (data.status === 'success') {
            myCapabilities = new Set(data.capabilities || []);
            myOrgRole = data.role || null;
        }
        _settingsCapabilitiesLoaded = true;
        then();
    }).catch(() => { _settingsCapabilitiesLoaded = true; then(); });
}

function _applySettingsCapabilityGating() {
    // Owner (or a legacy no-account install, where myOrgRole is null but
    // every capability is granted) sees everything; anyone else only sees
    // the sub-nav items their resolved capability set actually grants.
    document.querySelectorAll('#view-settings .settings-nav-item[data-capability]').forEach(item => {
        const cap = item.dataset.capability;
        const allowed = myOrgRole === 'owner' || myCapabilities.has(cap);
        item.classList.toggle('hidden', !allowed);
    });
}

function switchSettingsPane(pane) {
    const nav = document.querySelector(`#view-settings .settings-nav-item[data-settings-pane="${pane}"]`);
    // A member without the capability for the requested/default pane lands
    // on the first pane they can actually see instead of a blank panel.
    if (nav && nav.classList.contains('hidden')) {
        const firstVisible = document.querySelector('#view-settings .settings-nav-item[data-settings-pane]:not(.hidden)');
        if (firstVisible) { switchSettingsPane(firstVisible.dataset.settingsPane); return; }
    }
    document.querySelectorAll('#view-settings .settings-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.settingsPane === pane);
    });
    document.querySelectorAll('#view-settings .settings-pane').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.settingsPane === pane);
    });

    // Each pane's own existing load function -- unchanged from when these
    // were top-level views, just invoked from here instead of nav.js.
    if (pane === 'profile') loadSettingsProfilePane();
    else if (pane === 'general') { loadConfigView(); switchConfigTab('basic'); }
    else if (pane === 'security-access') loadSecurityAccessView();
    else if (pane === 'agents-org') loadAgentsOrgView();
    else if (pane === 'permissions') loadSettingsPermissionsPane();
    else if (pane === 'activity') loadSettingsActivityPane();
    else if (pane === 'connectors') loadConnectorsView();
    else if (pane === 'channels') loadChannelsView();
    else if (pane === 'skills') { resetSkillViewer(); loadSkillsView(); }
    else if (pane === 'sovereignty') loadSovereigntyView();
    routeNoteTab('settings', pane);
}
window.switchSettingsPane = switchSettingsPane;

// -- Profile pane (own account: email/role, password, MFA) -----------------
// MFA functions moved here from agents-org.js -- self-account management
// belongs in Profile, not mixed into the org member roster.

function _settingsProfileStatus(message, isError) {
    const status = document.getElementById('settings-profile-status');
    if (!status) return;
    if (!message) { status.classList.add('opacity-0'); return; }
    status.textContent = message;
    status.className = `text-sm mb-4 transition-opacity duration-150 ${isError ? 'text-red-500' : 'text-emerald-500'}`;
}

function loadSettingsProfilePane() {
    fetch('/api/org/members').then(r => r.json()).then(data => {
        if (data.status !== 'success' || data.applicable === false) return;
        const self = (data.members || []).find(m => m.is_self);
        if (!self) return;
        const emailEl = document.getElementById('settings-profile-email');
        const roleEl = document.getElementById('settings-profile-role');
        if (emailEl) emailEl.textContent = self.email;
        if (roleEl) roleEl.textContent = self.role;
        _renderProfileMfa(!!self.mfa_enabled);
        _renderProfileAvatarPicker(self);
    }).catch(() => {});
}

/* Same picker widget as agents.js's renderAvatarPicker (shared CSS,
   .agent-avatar-picker), pointed at the signed-in user's own picture instead
   of an Agent's. */
function _renderProfileAvatarPicker(self) {
    const box = document.getElementById('settings-profile-avatar');
    if (!box) return;
    box.innerHTML = `
        <div class="agent-avatar-picker-preview">${userAvatarHTML(self.avatar_rev, self.id, self.email, 56)}</div>
        <div class="agent-avatar-picker-body">
            <button type="button" class="agent-avatar-upload">
                <i class="fas fa-arrow-up-from-bracket"></i><span data-i18n="agents_avatar_upload">Upload image</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            </button>
        </div>`;
    const upload = box.querySelector('.agent-avatar-upload');
    const input = upload.querySelector('input');
    upload.addEventListener('click', () => input.click());
    input.addEventListener('change', () => _uploadProfileAvatar(input.files && input.files[0], self));
}

function _uploadProfileAvatar(file, self) {
    if (!file) return;
    const box = document.getElementById('settings-profile-avatar');
    if (box) box.classList.add('is-uploading');
    const form = new FormData();
    form.append('avatar', file);
    fetch('/api/users/me/avatar', { method: 'POST', body: form })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') { _settingsProfileStatus(data.message || 'Upload failed', true); return; }
            self.avatar_rev = data.avatar_rev;
            _renderProfileAvatarPicker(self);
            renderTopbarProfile(self);
            _settingsProfileStatus('Picture updated', false);
        })
        .catch(() => _settingsProfileStatus('Could not reach the server', true))
        .then(() => { if (box) box.classList.remove('is-uploading'); });
}

function _settingsChangePassword() {
    const oldInput = document.getElementById('settings-profile-old-password');
    const newInput = document.getElementById('settings-profile-new-password');
    const oldPassword = oldInput ? oldInput.value : '';
    const newPassword = newInput ? newInput.value : '';
    if (!oldPassword || !newPassword) { _settingsProfileStatus('Both fields are required', true); return; }
    fetch('/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _settingsProfileStatus(data.message || 'Failed to change password', true); return; }
        _settingsProfileStatus('Password updated', false);
        if (oldInput) oldInput.value = '';
        if (newInput) newInput.value = '';
    }).catch(() => _settingsProfileStatus('Could not reach the server', true));
}

function _renderProfileMfa(enabled) {
    const container = document.getElementById('settings-profile-mfa');
    if (!container) return;
    if (enabled) {
        container.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="inline-flex items-center gap-1.5 text-sm text-emerald-500"><i class="fas fa-circle-check text-xs"></i>Enabled</span>
                <button onclick="_disableProfileMfa()" class="text-xs text-red-500 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">Disable</button>
            </div>`;
        return;
    }
    container.innerHTML = `<button onclick="_enrollProfileMfa()" class="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white">Enable MFA</button>`;
}

function _enrollProfileMfa() {
    fetch('/auth/mfa/enroll', { method: 'POST' }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _settingsProfileStatus(data.message || 'Failed to start enrollment', true); return; }
        const container = document.getElementById('settings-profile-mfa');
        if (!container) return;
        container.innerHTML = `
            <div class="space-y-2 text-sm">
                <p class="text-surface-500 dark:text-surface-400">Scan this in your authenticator app, then enter the 6-digit code:</p>
                <code class="block text-xs break-all p-2 rounded-lg bg-surface-50 dark:bg-surface-700/50">${escapeHtml(data.otpauth_uri)}</code>
                <div class="flex items-center gap-2">
                    <input id="settings-profile-mfa-code" type="text" inputmode="numeric" maxlength="6" placeholder="000000"
                           class="text-sm rounded-lg border border-surface-200 dark:border-white/10 bg-white dark:bg-surface-700 px-2 py-1.5 w-28">
                    <button onclick="_confirmProfileMfa()" class="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white">Confirm</button>
                </div>
            </div>`;
    }).catch(() => _settingsProfileStatus('Could not reach the server', true));
}

function _confirmProfileMfa() {
    const input = document.getElementById('settings-profile-mfa-code');
    const code = input ? input.value.trim() : '';
    fetch('/auth/mfa/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _settingsProfileStatus(data.message || 'Invalid code', true); return; }
        _settingsProfileStatus('MFA enabled', false);
        loadSettingsProfilePane();
    }).catch(() => _settingsProfileStatus('Could not reach the server', true));
}

function _disableProfileMfa() {
    const password = prompt('Enter your password to disable MFA:');
    if (!password) return;
    fetch('/auth/mfa/disable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _settingsProfileStatus(data.message || 'Failed to disable MFA', true); return; }
        _settingsProfileStatus('MFA disabled', false);
        loadSettingsProfilePane();
    }).catch(() => _settingsProfileStatus('Could not reach the server', true));
}

// -- Permissions pane ------------------------------------------------------

function _settingsPermissionsStatus(message, isError) {
    const status = document.getElementById('settings-permissions-status');
    if (!status) return;
    if (!message) { status.classList.add('opacity-0'); return; }
    status.textContent = message;
    status.className = `text-sm mb-4 transition-opacity duration-150 ${isError ? 'text-red-500' : 'text-emerald-500'}`;
}

function loadSettingsPermissionsPane() {
    const rows = document.getElementById('settings-permissions-rows');
    if (!rows) return;
    rows.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-sm text-surface-400"><i class="fas fa-spinner fa-spin text-xs mr-1"></i>Loading...</td></tr>`;

    fetch('/api/org/capabilities').then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            rows.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-sm text-red-400">${escapeHtml(data.message || 'Failed to load permissions')}</td></tr>`;
            return;
        }
        if (data.applicable === false) {
            rows.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-sm text-surface-400">Not applicable on this install</td></tr>`;
            return;
        }
        _renderSettingsPermissions(data.capabilities || [], data.matrix || {});
    }).catch(() => {
        rows.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-sm text-red-400">Could not reach the server</td></tr>`;
    });
}

function _renderSettingsPermissions(capabilities, matrix) {
    const rows = document.getElementById('settings-permissions-rows');
    if (!rows) return;
    let lastGroup = null;
    rows.innerHTML = capabilities.map(cap => {
        const groupHeader = cap.group !== lastGroup
            ? `<tr><td colspan="3" class="pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">${escapeHtml(cap.group)}</td></tr>`
            : '';
        lastGroup = cap.group;
        const adminChecked = !!(matrix.admin && matrix.admin[cap.key]);
        const memberChecked = !!(matrix.member && matrix.member[cap.key]);
        return `${groupHeader}
            <tr class="border-t border-surface-100 dark:border-white/5">
                <td class="py-2 pr-4 text-surface-700 dark:text-surface-200">${escapeHtml(cap.label)}</td>
                <td class="py-2 px-4 text-center">
                    <input type="checkbox" ${adminChecked ? 'checked' : ''}
                           onchange="_setSettingsPermission('admin', '${cap.key}', this.checked)"
                           class="cursor-pointer accent-primary-500">
                </td>
                <td class="py-2 px-4 text-center">
                    <input type="checkbox" ${memberChecked ? 'checked' : ''}
                           onchange="_setSettingsPermission('member', '${cap.key}', this.checked)"
                           class="cursor-pointer accent-primary-500">
                </td>
            </tr>`;
    }).join('');
}

function _setSettingsPermission(role, capability, granted) {
    fetch('/api/org/capabilities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, capability, granted }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _settingsPermissionsStatus(data.message || 'Failed to save', true); return; }
        _settingsPermissionsStatus('Saved', false);
    }).catch(() => _settingsPermissionsStatus('Could not reach the server', true));
}

// -- Activity pane -----------------------------------------------------

function loadSettingsActivityPane() {
    const list = document.getElementById('settings-activity-list');
    const empty = document.getElementById('settings-activity-empty');
    const filterSelect = document.getElementById('settings-activity-user-filter');
    if (!list) return;

    // Populate the user filter once -- repopulating on every fetch would
    // reset the operator's selection mid-use.
    if (filterSelect && filterSelect.dataset.loaded !== '1') {
        filterSelect.dataset.loaded = '1';
        fetch('/api/org/members').then(r => r.json()).then(data => {
            if (data.status !== 'success') return;
            (data.members || []).forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.email;
                opt.textContent = m.email;
                filterSelect.appendChild(opt);
            });
        }).catch(() => {});
    }

    const actor = filterSelect ? filterSelect.value : '';
    list.innerHTML = '<div class="py-6 text-center text-sm text-surface-400"><i class="fas fa-spinner fa-spin text-xs mr-1"></i>Loading...</div>';
    if (empty) empty.classList.add('hidden');

    fetch(`/api/org/audit?limit=100${actor ? `&actor=${encodeURIComponent(actor)}` : ''}`)
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') {
                list.innerHTML = `<div class="py-6 text-center text-sm text-red-400">${escapeHtml(data.message || 'Failed to load activity')}</div>`;
                return;
            }
            const events = data.events || [];
            if (events.length === 0) {
                list.innerHTML = '';
                if (empty) empty.classList.remove('hidden');
                return;
            }
            list.innerHTML = events.map(e => `
                <div class="py-2.5 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <span class="text-surface-700 dark:text-surface-200 font-medium">${escapeHtml(e.event_type || '')}</span>
                        <span class="text-surface-400 dark:text-surface-500"> &middot; ${escapeHtml(e.actor || 'unknown')}</span>
                    </div>
                    <span class="text-xs text-surface-400 dark:text-surface-500 shrink-0">${e.ts ? new Date(e.ts * 1000).toLocaleString() : ''}</span>
                </div>`).join('');
        }).catch(() => {
            list.innerHTML = '<div class="py-6 text-center text-sm text-red-400">Could not reach the server</div>';
        });
}
window.loadSettingsActivityPane = loadSettingsActivityPane;
