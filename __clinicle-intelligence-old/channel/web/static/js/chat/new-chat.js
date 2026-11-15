/* New chat and multi-agent team chat.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

/* The session-panel "New chat" button. With a single Agent there is nobody to
   choose between, so it just starts a chat. With several, it opens a menu: pick
   an Agent for a solo chat, or open the team picker for a group chat. */
function onNewChatButton(event) {
    if (!multiAgentMode()) { newChat(true); return; }
    if (event) event.stopPropagation();
    const menu = document.getElementById('new-chat-menu');
    if (!menu) { newChat(true); return; }
    if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
    const rows = enabledAgents().map(agent => `
        <button type="button" class="new-chat-item" onclick="startSoloChat('${escapeHtml(agent.id)}')">
            ${agentAvatarHTML(agent, 22)}
            <span>${escapeHtml(agent.name)}</span>
        </button>`).join('');
    menu.innerHTML = `
        <div class="new-chat-section">${rows}</div>
        <div class="new-chat-sep"></div>
        <button type="button" class="new-chat-item new-chat-team" onclick="openTeamChatModal()">
            <span class="new-chat-team-ico"><i class="fas fa-user-group"></i></span>
            <span>${escapeHtml(t('new_team_chat'))}</span>
        </button>`;
    menu.classList.remove('hidden');
}

function startSoloChat(agentId) {
    document.getElementById('new-chat-menu')?.classList.add('hidden');
    if (!agentId) { newChat(true); return; }
    activeAgentId = agentId;
    localStorage.setItem('cow_active_agent', activeAgentId);
    newChat(true);
    if (typeof resetWorkspaceToAgentRoot === 'function') resetWorkspaceToAgentRoot();
    renderComposerIdentity();
}

// Starting a group used to open this file's own name-less picker (first pick
// = owner, rest = guests, invited onto a shared thread). One feature now
// (agent.workspace.team_store): this is the exact same action as the Teams
// page's own "+ New Team", so it just opens that instead of keeping a second,
// slightly different picker UI in sync with it. The function name stays so
// the "New team chat" menu item above needs no change.
function openTeamChatModal() {
    document.getElementById('new-chat-menu')?.classList.add('hidden');
    navigateTo('teams');
    if (typeof openCreateTeamModal === 'function') openCreateTeamModal();
}

function newChat(optimistic = true, inherit = true) {
    // Inside a Teams pane (EMBED_MODE, see chat/state.js) this session is
    // pinned to one member's slot -- minting a fresh sessionId here would
    // detach the pane from that delegation target. Clear the session's
    // context in place instead, same as the composer's own clear-context
    // button (chat/context-usage.js -> views/sessions.js's clearContext()).
    if (typeof EMBED_MODE !== 'undefined' && EMBED_MODE) {
        if (typeof clearContext === 'function') clearContext();
        return;
    }

    // A fresh session resets the preview panel, discarding an open editor.
    if (typeof wsGuardUnsaved === 'function'
        && !wsGuardUnsaved(() => newChat(optimistic, inherit))) return;

    // Do NOT close active streams: other sessions keep streaming in the
    // background (each stream self-guards against the foreign view) and their
    // replies still complete and persist.

    // Generate a fresh session and persist it so the next page load also starts clean
    sessionId = generateSessionId();
    localStorage.setItem(activeSessionStorageKey(), sessionId);
    refreshWorkspaceSelector();  // a fresh session starts on the default workspace
    refreshSessionSettings();    // ... and on the global model / permission
    if (typeof wsOnSessionSwitch === 'function') wsOnSessionSwitch();
    resetSendBtnSendMode();  // fresh session has no in-flight reply
    startPolling();  // bump generation so old loop self-cancels, new loop uses fresh sessionId
    if (typeof resetTimeline === 'function') resetTimeline();
    messagesDiv.innerHTML = '';
    const ws = document.createElement('div');
    ws.id = 'welcome-screen';
    ws.className = 'flex flex-col items-center justify-center h-full px-6 pb-16';
    ws.style.paddingTop = '6vh';
    ws.innerHTML = `
        <div class="w-16 h-16 rounded-2xl mb-6 shadow-lg shadow-primary-500/20 bg-white flex items-center justify-center overflow-hidden shrink-0" role="img" aria-label="Clinicle Intelligence">
            <svg width="40" height="40" viewBox="0 0 100 100">
                <circle cx="20" cy="62" r="9" fill="#4DB8F0"/>
                <circle cx="50" cy="44" r="13" fill="#2E9FDC"/>
                <circle cx="80" cy="56" r="8" fill="#5EDEC8"/>
            </svg>
        </div>
        <h1 class="text-2xl font-bold text-surface-800 dark:text-surface-100 mb-3">${appConfig.title || 'Clinicle Intelligence'}</h1>
        <p class="text-surface-500 dark:text-surface-400 text-center max-w-lg mb-10 leading-relaxed" data-i18n="welcome_subtitle">${t('welcome_subtitle')}</p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-2xl">
            <div class="example-card group bg-white dark:bg-[#1A1A1A] border border-surface-200 dark:border-white/10 rounded-xl p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all duration-200">
                <div class="flex items-center gap-2 mb-2">
                    <div class="w-7 h-7 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
                        <i class="fas fa-folder-open text-primary-500 text-xs"></i>
                    </div>
                    <span class="font-medium text-sm text-surface-700 dark:text-surface-200" data-i18n="example_sys_title">${t('example_sys_title')}</span>
                </div>
                <p class="text-sm text-surface-500 dark:text-surface-400 leading-relaxed" data-i18n="example_sys_text">${t('example_sys_text')}</p>
            </div>
            <div class="example-card group bg-white dark:bg-[#1A1A1A] border border-surface-200 dark:border-white/10 rounded-xl p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all duration-200">
                <div class="flex items-center gap-2 mb-2">
                    <div class="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                        <i class="fas fa-clock text-amber-500 text-xs"></i>
                    </div>
                    <span class="font-medium text-sm text-surface-700 dark:text-surface-200" data-i18n="example_task_title">${t('example_task_title')}</span>
                </div>
                <p class="text-sm text-surface-500 dark:text-surface-400 leading-relaxed" data-i18n="example_task_text">${t('example_task_text')}</p>
            </div>
            <div class="example-card group bg-white dark:bg-[#1A1A1A] border border-surface-200 dark:border-white/10 rounded-xl p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all duration-200">
                <div class="flex items-center gap-2 mb-2">
                    <div class="w-7 h-7 rounded-lg bg-accent-50 dark:bg-accent-900/30 flex items-center justify-center">
                        <i class="fas fa-code text-accent-500 text-xs"></i>
                    </div>
                    <span class="font-medium text-sm text-surface-700 dark:text-surface-200" data-i18n="example_code_title">${t('example_code_title')}</span>
                </div>
                <p class="text-sm text-surface-500 dark:text-surface-400 leading-relaxed" data-i18n="example_code_text">${t('example_code_text')}</p>
            </div>
            <div class="example-card group bg-white dark:bg-[#1A1A1A] border border-surface-200 dark:border-white/10 rounded-xl p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all duration-200">
                <div class="flex items-center gap-2 mb-2">
                    <div class="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
                        <i class="fas fa-book text-violet-500 text-xs"></i>
                    </div>
                    <span class="font-medium text-sm text-surface-700 dark:text-surface-200" data-i18n="example_knowledge_title">${t('example_knowledge_title')}</span>
                </div>
                <p class="text-sm text-surface-500 dark:text-surface-400 leading-relaxed" data-i18n="example_knowledge_text">${t('example_knowledge_text')}</p>
            </div>
            <div class="example-card group bg-white dark:bg-[#1A1A1A] border border-surface-200 dark:border-white/10 rounded-xl p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all duration-200">
                <div class="flex items-center gap-2 mb-2">
                    <div class="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center">
                        <i class="fas fa-puzzle-piece text-rose-500 text-xs"></i>
                    </div>
                    <span class="font-medium text-sm text-surface-700 dark:text-surface-200" data-i18n="example_skill_title">${t('example_skill_title')}</span>
                </div>
                <p class="text-sm text-surface-500 dark:text-surface-400 leading-relaxed" data-i18n="example_skill_text">${t('example_skill_text')}</p>
            </div>
            <div class="example-card group bg-white dark:bg-[#1A1A1A] border border-surface-200 dark:border-white/10 rounded-xl p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all duration-200" data-send="/help">
                <div class="flex items-center gap-2 mb-2">
                    <div class="w-7 h-7 rounded-lg bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
                        <i class="fas fa-terminal text-surface-500 text-xs"></i>
                    </div>
                    <span class="font-medium text-sm text-surface-700 dark:text-surface-200" data-i18n="example_web_title">${t('example_web_title')}</span>
                </div>
                <p class="text-sm text-surface-500 dark:text-surface-400 leading-relaxed" data-i18n="example_web_text">${t('example_web_text')}</p>
            </div>
        </div>
    `;
    messagesDiv.appendChild(ws);
    renderComposerIdentity();
    ws.querySelectorAll('.example-card').forEach(card => {
        card.addEventListener('click', () => {
            const sendText = card.dataset.send;
            if (sendText) {
                chatInput.value = sendText;
                chatInput.dispatchEvent(new Event('input'));
                chatInput.focus();
                return;
            }
            const textEl = card.querySelector('[data-i18n*="text"]');
            if (textEl) {
                chatInput.value = textEl.textContent;
                chatInput.dispatchEvent(new Event('input'));
                chatInput.focus();
            }
        });
    });
    if (currentView !== 'chat') navigateTo('chat');

    // Show panel and load full session list, then prepend the new session on top
    const panel = document.getElementById('session-panel');
    if (panel && !sessionPanelOpen) {
        sessionPanelOpen = true;
        panel.classList.remove('hidden');
        _showSessionOverlay();
        _persistPanelState();
    }
    // Only prepend an optimistic "new chat" item when this is a real new-chat
    // action. When called after deleting the current session, skip it: the
    // fresh session has no backend record yet, so inserting it would leave an
    // empty, undeletable item in the list (deleting it just spawns another).
    const newSid = sessionId;
    if (optimistic) {
        loadSessionList(() => _addOptimisticSessionItem(newSid));
    } else {
        loadSessionList();
    }
}

