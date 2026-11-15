/* Sidebar routing: navigateTo plus the per-view lazy loading hook.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Sidebar & Navigation
// =====================================================================
const VIEW_META = {
    chat:     { group: 'menu_home',    page: 'menu_home' },
    board:    { group: 'nav_workspace', page: 'menu_board' },
    teams:    { group: 'nav_workspace', page: 'menu_teams' },
    meetings: { group: 'nav_workspace', page: 'menu_meetings' },
    'review-queue': { group: 'nav_review', page: 'menu_review_queue' },
    'pending-edits': { group: 'nav_review', page: 'menu_pending_edits' },
    worktrees: { group: 'nav_review', page: 'menu_worktrees' },
    agents:   { group: 'nav_automation', page: 'menu_agents' },
    workflows:{ group: 'nav_automation', page: 'menu_workflows' },
    'org-graph': { group: 'nav_workspace', page: 'menu_org_graph' },
    knowledge:{ group: 'nav_knowledge', page: 'menu_knowledge_base' },
    memory:   { group: 'nav_knowledge', page: 'menu_memory' },
    tasks:    { group: 'nav_workspace', page: 'menu_scheduled' },
    overview: { group: 'menu_overview', page: 'menu_overview' },
    alerts:   { group: 'nav_insights', page: 'menu_alerts' },
    analytics: { group: 'nav_insights', page: 'menu_analytics' },
    logs:     { group: 'nav_system',   page: 'menu_logs' },
    // Settings used to be 8 separate top-level entries (config/skills/
    // connectors/channels/agents-org/sovereignty/security-access), each with
    // its own VIEW_META row and navigateTo() branch below. They're now one
    // shell (settings.js's switchSettingsPane) with its own internal sub-nav
    // -- see templates/views/settings.html.
    settings: { group: 'menu_settings', page: 'menu_settings' },
};

// Not 'overview' (the actual landing view) -- router.js's routeApply() skips
// navigateTo() entirely when parsed.view === currentView, on the assumption
// that view is already fully loaded. That's true for a mid-session
// navigation, but not for the very first paint: the HTML ships with
// #view-overview pre-marked active so there's no flash of the wrong view,
// but its data-loading dispatch (loadOverviewView()) still needs to run.
// Starting on a value no real view id ever equals forces that first
// routeApply() through the real navigateTo() path instead of the shortcut.
let currentView = null;

// The view switch itself. Callers want navigateTo() below, which wraps this
// with the unsaved-edit guard and the per-view lazy loading.
function _switchToView(viewId) {
    if (!VIEW_META[viewId]) return;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + viewId);
    if (target) target.classList.add('active');
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewId);
    });
    const meta = VIEW_META[viewId];
    document.getElementById('breadcrumb-group').textContent = t(meta.group);
    document.getElementById('breadcrumb-group').dataset.i18n = meta.group;
    document.getElementById('breadcrumb-page').textContent = t(meta.page);
    document.getElementById('breadcrumb-page').dataset.i18n = meta.page;
    const breadcrumb = document.getElementById('header-breadcrumb');
    if (breadcrumb) breadcrumb.style.display = (viewId === 'chat' || viewId === 'overview') ? 'none' : '';
    const leavingChat = currentView === 'chat' && viewId !== 'chat';
    const enteringChat = viewId === 'chat' && currentView !== 'chat';
    currentView = viewId;
    // The Agent detail is a fixed drawer, so it would otherwise hang over
    // whatever view you navigate to. It only belongs to the Agent Team page.
    if (viewId !== 'agents') closeAgentDetail();
    if (viewId === 'agents') loadAgentCatalog();
    // The History panel belongs to the chat view only. Tuck it away on exit
    // and put it back on return (only if the user hadn't already toggled it
    // themselves in the meantime).
    if (leavingChat) {
        _sessionPanelWasOpen = sessionPanelOpen;
        if (sessionPanelOpen) closeSessionPanel(true);
    } else if (enteringChat && _sessionPanelWasOpen) {
        _sessionPanelWasOpen = false;
        openSessionPanel();
    }
    
    // Clear status messages when navigating away
    document.querySelectorAll('[id$="-status"]').forEach(el => {
        el.classList.add('opacity-0');
    });
    
    if (window.innerWidth < 1024) closeSidebar();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = !sidebar.classList.contains('-translate-x-full');
    if (isOpen) {
        closeSidebar();
    } else {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    }
}

function closeSidebar() {
    document.getElementById('sidebar').classList.add('-translate-x-full');
    document.getElementById('sidebar-overlay').classList.add('hidden');
}

document.querySelectorAll('.menu-group > button').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.parentElement.classList.toggle('open');
    });
});

document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.view));
});

// The logo goes home, same as the sidebar items do: through navigateTo, so the
// address bar, the unsaved-edit guard and the mobile drawer all behave as they
// do for any other destination. It is not a .sidebar-item because it must not
// pick up the active highlight the chat entry already carries.
const sidebarHome = document.getElementById('sidebar-home');
if (sidebarHome) {
    sidebarHome.addEventListener('click', () => navigateTo('overview'));
    // role="button" without this is a lie to anyone not using a mouse.
    sidebarHome.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigateTo('overview');
        }
    });
}

window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
        document.getElementById('sidebar').classList.remove('-translate-x-full');
        document.getElementById('sidebar-overlay').classList.add('hidden');
    } else {
        if (!document.getElementById('sidebar').classList.contains('-translate-x-full')) {
            closeSidebar();
        }
    }
});

// =====================================================================
// View Navigation
// =====================================================================
// Everything routes through here: the sidebar, the breadcrumb and the
// navigateTo() calls in generated onclick handlers.
// `tab` is optional and comes from the address bar; a caller that does not
// name one gets the view's usual landing tab. Returns false when the guard
// below refused to leave the current view, which is what lets the router put
// the address bar back after a Back it could not honour.
function navigateTo(viewId, tab) {
    // An open document editor is about to be replaced by another view, which
    // would drop the edit with nothing on screen to say so.
    if (!docGuardUnsaved(() => navigateTo(viewId, tab))) return false;

    // Stop log stream when leaving logs view
    if (currentView === 'logs' && viewId !== 'logs') stopLogStream();
    // Stop the Teams grid's live "working" poll when leaving the Teams view
    if (currentView === 'teams' && viewId !== 'teams') stopTeamWorkPolling();
    // Same idea for the Task Board's task-list poll.
    if (currentView === 'board' && viewId !== 'board') stopBoardPolling();
    // Same idea for the Dashboard's live system-metrics poll.
    if (currentView === 'overview' && viewId !== 'overview') stopOverviewSystemPolling();
    // Same idea for a meeting's "processing..." status poll.
    if (currentView === 'meetings' && viewId !== 'meetings') stopMeetingsPolling();

    _switchToView(viewId);
    // The address bar follows the view, so a reload lands back here.
    routeEnterView(viewId);

    // Lazy-load view data
    if (viewId === 'settings') loadSettingsView(tab);
    else if (viewId === 'memory') {
        memoryEditor.forget();
        document.getElementById('memory-panel-viewer').classList.add('hidden');
        document.getElementById('memory-panel-list').classList.remove('hidden');
        // Keep the last viewed Agent across refreshes, but drop it if that
        // Agent has since been deleted so we don't point at a ghost.
        if (memoryAgentId && agentCatalog.length && !agentCatalog.some(a => a.id === memoryAgentId)) {
            memoryAgentId = '';
            localStorage.removeItem('cow_memory_agent');
        }
        if (!memoryAgentId) memoryAgentId = activeAgentId || defaultAgentId;
        renderMemoryAgentSelect();
        switchMemoryTab(tab || 'files');
    }
    // loadKnowledgeView lands on the docs tab itself, so unlike the views
    // above there is no default to pass -- only a route-named tab to override
    // it with.
    else if (viewId === 'knowledge') { loadKnowledgeView(); if (tab) switchKnowledgeTab(tab); }
    else if (viewId === 'teams') loadTeamsView();
    else if (viewId === 'tasks') { switchTasksTab(tab || 'tasks'); loadTasksView(); }
    else if (viewId === 'overview') loadOverviewView();
    else if (viewId === 'alerts') loadAlertsView();
    else if (viewId === 'analytics') loadAnalyticsView();
    else if (viewId === 'workflows') loadWorkflowsView();
    else if (viewId === 'org-graph') loadOrgGraphView();
    else if (viewId === 'board') loadBoardView();
    else if (viewId === 'meetings') loadMeetingsView(tab);
    else if (viewId === 'review-queue') loadReviewQueue();
    else if (viewId === 'pending-edits') loadPendingEdits();
    else if (viewId === 'worktrees') loadWorktreesView();
    else if (viewId === 'logs') startLogStream();
    return true;
}

