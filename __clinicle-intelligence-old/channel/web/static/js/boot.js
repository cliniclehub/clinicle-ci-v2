/* Startup: theme, i18n, auth gate, initial fetches. Loads last.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// A Teams grid column is this same page loaded in an iframe (see
// views/teams.js + EMBED_MODE in state.js): hide the app chrome so only the
// message thread + composer show, and accept a prefill from the parent frame
// for "tell the Leader" (never auto-sends -- the user still has to hit send).
if (typeof EMBED_MODE !== 'undefined' && EMBED_MODE) {
    document.documentElement.classList.add('embed-mode');
    window.addEventListener('message', (e) => {
        if (e.origin !== location.origin || e.source !== window.parent) return;
        if (!e.data || e.data.type !== 'clinicle-intelligence-team-prefill') return;
        if (!chatInput) return;
        chatInput.value = String(e.data.text || '');
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        chatInput.focus();
    });
}

// Called by applyI18n() (see i18n.js) on every initial render and language
// switch, same as relocalizeWorkspacePanel -- a Teams grid column swaps the
// generic empty-state subtitle for a role-specific greeting (Leader vs
// teammate -- matches AionUi's own two greetings), and that swap isn't a
// data-i18n attribute so the normal walk never touches it.
function relocalizeTeamLeaderGreeting() {
    if (typeof EMBED_MODE === 'undefined' || !EMBED_MODE) return;
    const role = _embedParams.get('role');
    if (role !== 'leader' && role !== 'teammate') return;
    const el = document.getElementById('welcome-subtitle');
    if (el) el.textContent = t(role === 'leader' ? 'team_leader_greeting' : 'team_teammate_greeting');
}

// Everything below reads protected endpoints, so it waits for the auth gate:
// fired before login it only collects 401s, and the login path never retries
// it, which left the chat empty after signing in until the next reload.
requestAuthGatedStart(loadAgentCatalog);
requestAuthGatedStart(() => {
    fetch('/config').then(r => r.json()).then(data => {
        if (data.status === 'success') {
            appConfig = data;
            const title = data.title || 'Clinicle Intelligence';
            document.getElementById('welcome-title').textContent = title;
            initConfigView(data);
        }
        loadHistory(1);
    }).catch(() => { loadHistory(1); });
});

// Start polling so scheduler/push messages are received.
requestAuthGatedStart(startPolling);
// =====================================================================
// Initialization
// =====================================================================
applyTheme();
applyI18n();

fetch('/auth/check').then(r => r.json()).then(data => {
    if (data.auth_required && !data.authenticated) {
        // The server already redirects an unauthenticated top-level load to
        // /login (see ChatHandler), so this only fires for the embed case
        // (a Teams grid iframe never navigates away) or a rare race where the
        // session expired between page load and this check. Keep background
        // pollers parked until login succeeds either way (openAuthGate is
        // called from the login handler), so they don't spam 401s meanwhile.
        redirectToLoginUnlessEmbedded();
    } else {
        if (data.auth_required) {
            const logoutBtn = document.getElementById('logout-btn-header');
            if (logoutBtn) logoutBtn.classList.remove('hidden');
        }
        openAuthGate();
        initApp();
    }
}).catch(() => {
    // No auth info available (e.g. request failed): fall back to running so a
    // password-less deployment still works.
    openAuthGate();
    initApp();
});

requestAnimationFrame(() => {
    document.body.classList.add('transition-colors', 'duration-200');
});

