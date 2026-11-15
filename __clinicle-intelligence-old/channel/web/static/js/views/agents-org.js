/* Agents & Org view: org member roster (role change / remove, admin-gated
 * server-side by has_role() in channel/web/api/tenancy.py) and the signed-in
 * user's own MFA enrollment (channel/web/api/auth.py's existing endpoints). */

const AGENTS_ORG_ROLES = ['member', 'admin', 'owner'];

function loadAgentsOrgView() {
    _loadOrgMembers();
    _loadOrgInvites();
}

function _agentsOrgStatus(message, isError) {
    const status = document.getElementById('agents-org-status');
    if (!status) return;
    if (!message) { status.classList.add('opacity-0'); return; }
    status.textContent = message;
    status.className = `text-sm mb-4 transition-opacity duration-150 ${isError ? 'text-red-500' : 'text-emerald-500'}`;
}

function _loadOrgMembers() {
    const container = document.getElementById('agents-org-members');
    if (!container) return;
    container.innerHTML = '<div class="py-6 text-center text-sm text-surface-400 dark:text-surface-500"><i class="fas fa-spinner fa-spin text-xs mr-1"></i>Loading...</div>';

    fetch('/api/org/members').then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            container.innerHTML = `<div class="py-6 text-center text-sm text-red-400">${escapeHtml(data.message || 'Failed to load members')}</div>`;
            return;
        }
        _renderOrgMembers(data.members || []);
    }).catch(() => {
        container.innerHTML = '<div class="py-6 text-center text-sm text-red-400">Could not reach the server</div>';
    });
}

function _renderOrgMembers(members) {
    const container = document.getElementById('agents-org-members');
    if (!container) return;
    if (members.length === 0) {
        container.innerHTML = '<div class="py-6 text-center text-sm text-surface-400">No members</div>';
        return;
    }
    const selfMember = members.find(m => m.is_self);
    const canManage = !!selfMember && AGENTS_ORG_ROLES.indexOf(selfMember.role) >= AGENTS_ORG_ROLES.indexOf('admin');

    container.innerHTML = members.map(m => `
        <div class="flex items-center justify-between gap-3 py-3">
            <div class="min-w-0">
                <div class="text-sm font-medium text-surface-700 dark:text-surface-200 truncate">${escapeHtml(m.email)}${m.is_self ? ' <span class="text-xs text-surface-400">(you)</span>' : ''}</div>
                <div class="flex items-center gap-2 mt-1">
                    <span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">${escapeHtml(m.role)}</span>
                    <span class="inline-flex items-center gap-1 text-[11px] ${m.mfa_enabled ? 'text-emerald-500' : 'text-surface-400'}">
                        <i class="fas ${m.mfa_enabled ? 'fa-shield-halved' : 'fa-shield'} text-[10px]"></i>${m.mfa_enabled ? 'MFA on' : 'MFA off'}
                    </span>
                </div>
            </div>
            ${canManage && !m.is_self ? `
            <div class="flex items-center gap-2 shrink-0">
                <select onchange="_changeOrgMemberRole(${m.id}, this.value)"
                        class="text-xs rounded-lg border border-surface-200 dark:border-white/10 bg-white dark:bg-surface-700 text-surface-600 dark:text-surface-300 px-2 py-1">
                    ${AGENTS_ORG_ROLES.map(r => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
                <button onclick="_removeOrgMember(${m.id})"
                        class="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                    Remove
                </button>
            </div>` : ''}
        </div>`).join('');
}

function _changeOrgMemberRole(memberId, role) {
    fetch(`/api/org/members/${memberId}/role`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _agentsOrgStatus(data.message || 'Failed to change role', true); return; }
        _agentsOrgStatus('Role updated', false);
        _loadOrgMembers();
    }).catch(() => _agentsOrgStatus('Could not reach the server', true));
}

function _removeOrgMember(memberId) {
    if (!confirm('Remove this member from the org?')) return;
    fetch(`/api/org/members/${memberId}`, { method: 'DELETE' }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _agentsOrgStatus(data.message || 'Failed to remove member', true); return; }
        _agentsOrgStatus('Member removed', false);
        _loadOrgMembers();
    }).catch(() => _agentsOrgStatus('Could not reach the server', true));
}

// -- Invites --------------------------------------------------------------
// No email is sent automatically (no such infrastructure exists in this
// app) -- the admin copies the returned link and sends it themselves.

function openInviteModal() {
    document.getElementById('invite-email').value = '';
    document.getElementById('invite-role').value = 'member';
    document.getElementById('invite-result').classList.add('hidden');
    document.getElementById('invite-submit-btn').classList.remove('hidden');
    document.getElementById('invite-modal').classList.remove('hidden');
    document.getElementById('invite-modal').classList.add('flex');
}

function closeInviteModal() {
    document.getElementById('invite-modal').classList.add('hidden');
    document.getElementById('invite-modal').classList.remove('flex');
    _loadOrgInvites();
}

function submitInvite() {
    const email = document.getElementById('invite-email').value.trim();
    const role = document.getElementById('invite-role').value;
    if (!email) { _agentsOrgStatus('Email is required', true); return; }
    fetch('/api/org/invites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _agentsOrgStatus(data.message || 'Could not create invite', true); return; }
        document.getElementById('invite-result-url').value = data.invite.accept_url;
        document.getElementById('invite-result').classList.remove('hidden');
        document.getElementById('invite-submit-btn').classList.add('hidden');
        _agentsOrgStatus(`Invite created for ${email}`, false);
    }).catch(() => _agentsOrgStatus('Could not reach the server', true));
}

function _loadOrgInvites() {
    fetch('/api/org/invites').then(r => r.json()).then(data => {
        const card = document.getElementById('agents-org-invites-card');
        if (data.status !== 'success') { if (card) card.classList.add('hidden'); return; }
        const invites = data.invites || [];
        if (card) card.classList.toggle('hidden', invites.length === 0);
        const container = document.getElementById('agents-org-invites');
        if (!container) return;
        container.innerHTML = invites.map(inv => `
            <div class="flex items-center justify-between gap-3 py-3">
                <div class="min-w-0">
                    <div class="text-sm font-medium text-surface-700 dark:text-surface-200 truncate">${escapeHtml(inv.email)}</div>
                    <span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">${escapeHtml(inv.role)}</span>
                </div>
                <button onclick="_revokeInvite('${escapeHtml(inv.token)}')"
                        class="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0">
                    Revoke
                </button>
            </div>`).join('');
    }).catch(() => {});
}

function _revokeInvite(token) {
    fetch(`/api/org/invites/${encodeURIComponent(token)}`, { method: 'DELETE' }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _agentsOrgStatus(data.message || 'Could not revoke invite', true); return; }
        _loadOrgInvites();
    }).catch(() => _agentsOrgStatus('Could not reach the server', true));
}
