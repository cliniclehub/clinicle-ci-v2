/* Security & Access view: Secrets Vault (list/add/delete, values always
 * masked and never displayed again after creation), the default agent
 * permission mode (reuses /api/config -- see channel/web/api/config.py --
 * rather than a parallel endpoint), and a read-only org-wide MFA coverage
 * summary (/api/security/mfa-coverage). */

const SECURITY_ACCESS_PERMISSION_MODES = [
    { value: 'read-only', labelKey: 'security_access_mode_read_only', label: 'Manual', descKey: 'security_access_mode_read_only_desc', desc: 'Look, don’t touch' },
    { value: 'workspace-write', labelKey: 'security_access_mode_workspace_write', label: 'Accept edits', descKey: 'security_access_mode_workspace_write_desc', desc: 'Free rein in the workspace' },
    { value: 'full-access', labelKey: 'security_access_mode_full_access', label: 'Full-auto', descKey: 'security_access_mode_full_access_desc', desc: 'No confinement' },
];

function loadSecurityAccessView() {
    _secAccessLoadVault();
    _secAccessLoadPermissionMode();
    _secAccessLoadSessions();
    _secAccessLoadMfaCoverage();
    const form = document.getElementById('sec-vault-add-form');
    if (form && !form.dataset.bound) {
        form.dataset.bound = '1';
        form.addEventListener('submit', _secAccessSubmitAddSecret);
    }
}

function _secAccessStatus(message, isError) {
    const status = document.getElementById('security-access-status');
    if (!status) return;
    if (!message) { status.classList.add('opacity-0'); return; }
    status.textContent = message;
    status.className = `text-sm mb-4 transition-opacity duration-150 ${isError ? 'text-red-500' : 'text-emerald-500'}`;
}

function _secAccessLoadVault() {
    fetch('/api/secrets').then(r => r.json()).then(data => {
        if (data.status !== 'success') { _secAccessStatus(data.message || 'Could not load secrets', true); return; }
        _renderSecVaultList(data.secrets || []);
    }).catch(() => _secAccessStatus('Could not reach the server', true));
}

function _renderSecVaultList(secrets) {
    const list = document.getElementById('sec-vault-list');
    const count = document.getElementById('sec-vault-count');
    if (count) count.textContent = String(secrets.length);
    if (!list) return;
    if (!secrets.length) {
        list.innerHTML = '<div class="text-surface-400 dark:text-surface-500 text-xs py-2 text-center">No secrets stored yet.</div>';
        return;
    }
    list.innerHTML = secrets.map(s => `
        <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-50 dark:bg-surface-700/40">
            <span class="flex items-center gap-2 text-surface-600 dark:text-surface-300 font-mono text-xs">
                <i class="fas fa-key text-[10px] opacity-50"></i>
                ${escapeHtml(s.name)}
            </span>
            <span class="flex items-center gap-3">
                <span class="text-surface-400 dark:text-surface-500 text-xs tracking-widest">••••••••</span>
                <button type="button" onclick="_secAccessDeleteSecret('${escapeHtml(s.name).replace(/'/g, "\\'")}')"
                        class="text-surface-400 hover:text-red-500 cursor-pointer" title="Delete">
                    <i class="fas fa-trash text-xs"></i>
                </button>
            </span>
        </div>`).join('');
}

function _secAccessSubmitAddSecret(e) {
    e.preventDefault();
    const nameEl = document.getElementById('sec-vault-name');
    const valueEl = document.getElementById('sec-vault-value');
    const name = (nameEl && nameEl.value || '').trim();
    const value = valueEl && valueEl.value || '';
    if (!name || !value) { _secAccessStatus('Name and value are required', true); return; }
    fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _secAccessStatus(data.message || 'Could not store secret', true); return; }
        if (nameEl) nameEl.value = '';
        if (valueEl) valueEl.value = '';
        _secAccessStatus(`Secret "${name}" stored.`, false);
        _secAccessLoadVault();
    }).catch(() => _secAccessStatus('Could not reach the server', true));
}

function _secAccessDeleteSecret(name) {
    if (!confirm(`Delete secret "${name}"? This cannot be undone.`)) return;
    fetch(`/api/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _secAccessStatus(data.message || 'Could not delete secret', true); return; }
        _secAccessStatus(`Secret "${name}" deleted.`, false);
        _secAccessLoadVault();
    }).catch(() => _secAccessStatus('Could not reach the server', true));
}

function _secAccessLoadPermissionMode() {
    fetch('/config').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        _renderSecPermissionModes(data.agent_permission_mode || 'full-access');
    }).catch(() => {});
}

function _renderSecPermissionModes(current) {
    const container = document.getElementById('sec-permission-modes');
    if (!container) return;
    container.innerHTML = SECURITY_ACCESS_PERMISSION_MODES.map(mode => {
        const active = mode.value === current;
        return `
        <button type="button" onclick="_secAccessSetPermissionMode('${mode.value}')"
                class="text-left p-3 rounded-lg border transition-colors cursor-pointer ${active
                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-500'
                    : 'border-surface-200 dark:border-white/10 hover:border-surface-300 dark:hover:border-white/20'}">
            <div class="flex items-center gap-2 text-sm font-medium text-surface-700 dark:text-surface-200">
                ${active ? '<i class="fas fa-circle-check text-primary-500 text-xs"></i>' : '<i class="far fa-circle text-surface-300 dark:text-surface-600 text-xs"></i>'}
                ${escapeHtml(mode.label)}
            </div>
            <div class="text-[11px] text-surface-400 dark:text-surface-500 mt-1">${escapeHtml(mode.desc)}</div>
        </button>`;
    }).join('');
}

function _secAccessSetPermissionMode(mode) {
    fetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { agent_permission_mode: mode } }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _secAccessStatus(data.message || 'Could not update permission mode', true); return; }
        _secAccessStatus('Default agent behavior updated.', false);
        _renderSecPermissionModes(mode);
    }).catch(() => _secAccessStatus('Could not reach the server', true));
}

function _secAccessSessionDateLabel(unixSeconds) {
    if (!unixSeconds) return 'never signed in';
    try {
        return new Date(unixSeconds * 1000).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch (e) {
        return '';
    }
}

function _secAccessLoadSessions() {
    fetch('/api/security/sessions').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        _renderSecSessionsList(data.sessions || [], data.applicable);
    }).catch(() => {});
}

function _renderSecSessionsList(sessions, applicable) {
    const list = document.getElementById('sec-sessions-list');
    const note = document.getElementById('sec-sessions-note');
    if (note) {
        note.textContent = applicable
            ? ''
            : 'No organization is set up on this install yet -- sessions apply once accounts exist.';
    }
    if (!list) return;
    if (!sessions.length) {
        list.innerHTML = '<div class="text-surface-400 dark:text-surface-500 text-xs py-2 text-center">No members yet.</div>';
        return;
    }
    list.innerHTML = sessions.map(s => `
        <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-50 dark:bg-surface-700/40">
            <span class="flex flex-col">
                <span class="text-surface-600 dark:text-surface-300 text-xs font-medium">${escapeHtml(s.email)}${s.is_self ? ' <span class="text-surface-400 dark:text-surface-500">(you)</span>' : ''}</span>
                <span class="text-surface-400 dark:text-surface-500 text-[11px]">Last sign-in: ${escapeHtml(_secAccessSessionDateLabel(s.last_login_at))}</span>
            </span>
            <button type="button" onclick="_secAccessRevokeSessions(${s.user_id}, '${escapeHtml(s.email).replace(/'/g, "\\'")}')"
                    class="text-xs font-medium px-2.5 py-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer shrink-0">
                Sign out everywhere
            </button>
        </div>`).join('');
}

function _secAccessRevokeSessions(userId, email) {
    if (!confirm(`Sign "${email}" out everywhere? They'll need to sign in again on every device.`)) return;
    fetch(`/api/security/sessions/${userId}/revoke`, { method: 'POST' }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _secAccessStatus(data.message || 'Could not revoke sessions', true); return; }
        _secAccessStatus(`${email} signed out everywhere.`, false);
        _secAccessLoadSessions();
    }).catch(() => _secAccessStatus('Could not reach the server', true));
}

function _secAccessLoadMfaCoverage() {
    fetch('/api/security/mfa-coverage').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const cov = data.mfa_coverage || {};
        const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        setText('sec-mfa-total', String(cov.total_members || 0));
        setText('sec-mfa-enabled', String(cov.mfa_enabled || 0));
        setText('sec-mfa-disabled', String(cov.mfa_disabled || 0));
        const note = document.getElementById('sec-mfa-note');
        if (note) {
            note.textContent = cov.applicable
                ? ''
                : 'No organization is set up on this install yet -- MFA coverage applies once accounts exist.';
        }
    }).catch(() => {});
}
