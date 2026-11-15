/* Task Board: a fleet-wide Kanban view over every Team's task list (see
 * agent/workspace/team_store.py's task-board section), plus the Autopilot
 * toggle that makes a Team self-triage/execute/verify its own "todo" tasks
 * (agent/tools/team/autopilot.py). Columns are backlog/todo/in_progress/
 * review/done; a card's status changes via a plain <select> (kept for touch
 * and keyboard/screen-reader access) or by dragging the card to another
 * column (_wireBoardDrag/_dropBoardTask below) -- same HTML5 drag pattern
 * as sessions.js's project-group reordering. A card Autopilot currently has
 * checked out (board-card-running) isn't draggable, so a human can't race
 * an in-flight automated status write with no version check on either side.
 *
 * "Live activity" reflects the two real phases a tick goes through --
 * dispatch (agent_reply against the task's own session) and verify (a
 * self-check turn) -- see autopilot.get_status(). There is no token-level
 * streaming: dispatch is one blocking call with no on_event hook, so the
 * panel shows the latest known phase/text rather than fabricated steps.
 */

const BOARD_COLUMNS = [
    { status: 'backlog', label: 'board_col_backlog' },
    { status: 'todo', label: 'board_col_todo' },
    { status: 'in_progress', label: 'board_col_in_progress' },
    { status: 'review', label: 'board_col_review' },
    { status: 'done', label: 'board_col_done' },
];

let boardTeams = [];
let boardActiveTeamId = '';
let boardTasks = [];
let boardActivity = null;   // { task_id, subject, phase, agent_id, team_name } | null
let boardAutopilotOn = false;
let _boardPollTimer = null;
let _dragTaskId = null;   // task id currently mid-drag, or null

function _boardTeamKey() { return 'board-active-team'; }

function loadBoardView() {
    const roster = ensureAgentCatalog();
    roster.then(() => fetch('/api/teams')).then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        boardTeams = data.teams || [];
        _renderBoardTeamSelect();
        if (!boardTeams.length) {
            document.getElementById('board-empty').classList.remove('hidden');
            document.getElementById('board-body').classList.add('hidden');
            return;
        }
        const saved = localStorage.getItem(_boardTeamKey());
        const initial = boardTeams.find(t => t.id === saved) || boardTeams[0];
        selectBoardTeam(initial.id);
    }).catch(() => {});
}

function _renderBoardTeamSelect() {
    const el = document.getElementById('board-team-select');
    el.innerHTML = boardTeams.map(t => `<option value="${_wsAttr(t.id)}">${escapeHtml(t.name)}</option>`).join('');
}

function selectBoardTeam(teamId) {
    boardActiveTeamId = teamId;
    document.getElementById('board-team-select').value = teamId;
    try { localStorage.setItem(_boardTeamKey(), teamId); } catch (e) {}
    document.getElementById('board-empty').classList.add('hidden');
    document.getElementById('board-body').classList.remove('hidden');
    _loadBoardAutopilotState();
    _loadBoardTasks();
    _startBoardPolling();
}

function _startBoardPolling() {
    if (_boardPollTimer) clearInterval(_boardPollTimer);
    _boardPollTimer = setInterval(() => {
        if (!boardActiveTeamId) return;
        _loadBoardTasks();
        _loadBoardAutopilotState();
    }, 3000);
}

function stopBoardPolling() {
    if (_boardPollTimer) { clearInterval(_boardPollTimer); _boardPollTimer = null; }
}

function _loadBoardTasks() {
    if (!boardActiveTeamId) return;
    fetch(`/api/board/tasks?team_id=${encodeURIComponent(boardActiveTeamId)}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        boardTasks = data.tasks || [];
        _renderBoardColumns();
    }).catch(() => {});
}

function _loadBoardAutopilotState() {
    if (!boardActiveTeamId) return;
    fetch(`/api/board/autopilot?team_id=${encodeURIComponent(boardActiveTeamId)}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        boardAutopilotOn = !!data.enabled;
        boardActivity = data.activity || null;
        document.getElementById('board-autopilot-checkbox').checked = boardAutopilotOn;
        _renderBoardAutopilotUI();
    }).catch(() => {});
}

function toggleBoardAutopilot(enabled) {
    if (!boardActiveTeamId) return;
    document.getElementById('board-autopilot-checkbox').checked = enabled;
    fetch('/api/board/autopilot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: boardActiveTeamId, enabled }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            document.getElementById('board-autopilot-checkbox').checked = !enabled;
            _wsToast(data.message || t('team_action_failed'));
            return;
        }
        boardAutopilotOn = enabled;
        if (!enabled) boardActivity = null;
        _renderBoardAutopilotUI();
    }).catch(() => { document.getElementById('board-autopilot-checkbox').checked = !enabled; });
}

function _agentLabelForBoard(agentId) {
    const a = findAgent(agentId);
    return a ? a.name : (agentId || '');
}

// =====================================================================
// Autopilot toggle card + live-activity panel
// =====================================================================
function _renderBoardAutopilotUI() {
    const caption = document.getElementById('board-autopilot-caption');
    const panel = document.getElementById('board-activity-panel');
    const pill = document.getElementById('board-working-pill');
    const pillText = document.getElementById('board-working-pill-text');

    if (!boardAutopilotOn) {
        caption.textContent = 'Off — tasks stay put until you turn Autopilot on.';
        panel.classList.add('hidden');
        pill.classList.add('hidden');
        return;
    }

    if (!boardActivity) {
        caption.textContent = 'Working now (idle — waiting for a dispatchable task). Results land in chat and Telegram.';
        panel.classList.add('hidden');
        pill.classList.add('hidden');
        return;
    }

    const phaseText = boardActivity.phase === 'verify' ? 'self-checking' : 'working';
    caption.textContent = `Working now (${phaseText} “${boardActivity.subject}”). Results land in chat and Telegram.`;

    pill.classList.remove('hidden');
    pillText.textContent = `● working: ${boardActivity.subject}`;

    panel.classList.remove('hidden');
    document.getElementById('board-activity-project-pill').textContent = `📚 Project: ${boardActivity.team_name || ''}`;
    document.getElementById('board-activity-task').textContent = boardActivity.subject;

    const step1Icon = document.getElementById('board-step1-icon');
    const step1Label = document.getElementById('board-step1-label');
    if (boardActivity.phase === 'verify') {
        step1Icon.className = 'fas fa-check board-step-icon board-step-done';
        step1Label.textContent = `Dispatched to ${_agentLabelForBoard(boardActivity.agent_id)}`;
        document.getElementById('board-progress-bar').style.width = '85%';
    } else {
        step1Icon.className = 'fas fa-circle-notch fa-spin board-step-icon';
        step1Label.textContent = `Dispatching to ${_agentLabelForBoard(boardActivity.agent_id)}...`;
        document.getElementById('board-progress-bar').style.width = '40%';
    }

    const streamText = boardActivity.phase === 'verify'
        ? `Self-checking "${boardActivity.subject}"...`
        : `Working on "${boardActivity.subject}"...`;
    document.getElementById('board-activity-stream-text').textContent = streamText;
}

function _toggleBoardStep(headerEl) {
    const body = headerEl.nextElementSibling;
    if (body) body.classList.toggle('hidden');
    const chevron = headerEl.querySelector('.board-step-chevron');
    if (chevron) chevron.classList.toggle('fa-chevron-up');
}

function steerBoardAutopilot() {
    const input = document.getElementById('board-steer-input');
    const instruction = (input.value || '').trim();
    if (!instruction) return;
    if (!boardActivity) { _wsToast('Autopilot is not mid-task right now.'); return; }
    const team = boardTeams.find(tm => tm.id === boardActiveTeamId);
    const owner = team && team.members.find(m => m.agent_id === boardActivity.agent_id);
    if (!owner) { _wsToast('Could not find the running task\'s owner session.'); return; }

    // Reuses the same /message steer fast-path the chat composer's steer
    // button uses (see channel/web/core/channel.py's steer_requested branch)
    // -- no parallel steering pathway.
    fetch('/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session_id: owner.session_id, agent_id: owner.agent_id,
            steer: true, message: instruction, stream: false,
        }),
    }).then(r => r.json()).then(data => {
        if (data.status === 'success' && data.steered) {
            input.value = '';
            _wsToast('Steering instruction sent.');
        } else {
            _wsToast((data && data.inline_reply) || 'Could not steer the running task.');
        }
    }).catch(() => _wsToast('Could not steer the running task.'));
}

// =====================================================================
// Kanban columns
// =====================================================================
function _renderBoardColumns() {
    const el = document.getElementById('board-columns');
    const team = boardTeams.find(t => t.id === boardActiveTeamId);
    const doneIds = new Set(boardTasks.filter(t => t.status === 'done').map(t => t.id));
    const runningTaskId = boardActivity ? boardActivity.task_id : null;
    el.innerHTML = BOARD_COLUMNS.map(col => {
        const cards = boardTasks.filter(t => t.status === col.status);
        const isActiveCol = col.status === 'in_progress' && cards.some(c => c.id === runningTaskId);
        return `
        <div class="board-column${isActiveCol ? ' board-column-active' : ''}">
            <div class="board-column-head">
                <span data-i18n="${col.label}">${escapeHtml(t(col.label).toUpperCase())}</span>
                <span class="board-column-count">${cards.length}</span>
            </div>
            <div class="board-column-body" data-status="${col.status}">
                ${cards.map(task => _boardCardHTML(task, team, doneIds, runningTaskId)).join('') ||
                    `<div class="board-column-empty">${escapeHtml(t('board_col_empty'))}</div>`}
            </div>
        </div>`;
    }).join('');
    _wireBoardDrag();
}

function _boardCardHTML(task, team, doneIds, runningTaskId) {
    const owner = team && team.members.find(m => m.slot_id === task.owner);
    const blocked = (task.blocked_by || []).some(id => !doneIds.has(id));
    const isRunning = task.id === runningTaskId;
    return `
    <div class="board-card${isRunning ? ' board-card-running' : ''}" data-task-id="${_wsAttr(task.id)}"
         draggable="${isRunning ? 'false' : 'true'}" ${isRunning ? `title="${escapeHtml(t('board_locked_running'))}"` : ''}>
        <div class="board-card-subject">${escapeHtml(task.subject)}</div>
        <div class="board-card-meta">
            ${team ? `<span class="board-card-tag">${escapeHtml(team.name)}</span>` : ''}
            ${owner ? `<span class="board-card-owner">${agentAvatarHTML(findAgent(owner.agent_id), 16)}<span class="truncate">${escapeHtml(_agentLabelForBoard(owner.agent_id))}</span></span>` : ''}
        </div>
        ${blocked ? `<div class="board-card-blocked"><i class="fas fa-lock"></i> ${escapeHtml(t('board_blocked'))}</div>` : ''}
        ${task.verify_note ? `<div class="board-card-note" title="${escapeHtml(task.verify_note)}">${escapeHtml(task.verify_note)}</div>` : ''}
        <select class="board-card-status" onchange="moveBoardTask('${_wsAttr(task.id)}', this.value)">
            ${BOARD_COLUMNS.map(c => `<option value="${c.status}" ${c.status === task.status ? 'selected' : ''}>${escapeHtml(t(c.label))}</option>`).join('')}
        </select>
    </div>`;
}

function moveBoardTask(taskId, status) {
    fetch(`/api/board/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: boardActiveTeamId, status }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); }
        _loadBoardTasks();
    }).catch(() => _wsToast(t('team_action_failed')));
}

// =====================================================================
// Drag-and-drop: move a card between columns (status change only, no
// in-column reordering -- tasks have no manual position field). Optimistic
// with rollback, matching sessions.js's toggleSessionPin convention: a task
// move is real workflow state, not cosmetic ordering, so a failed write
// snaps the card back rather than silently drifting from the server.
// =====================================================================
function _wireBoardDrag() {
    document.querySelectorAll('.board-card[draggable="true"]').forEach(card => {
        card.addEventListener('dragstart', (e) => {
            _dragTaskId = card.dataset.taskId;
            card.classList.add('dragging');
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _dragTaskId); } catch (err) {}
        });
        card.addEventListener('dragend', () => {
            _dragTaskId = null;
            card.classList.remove('dragging');
            document.querySelectorAll('.board-column-body.drop-target')
                .forEach(el => el.classList.remove('drop-target'));
        });
    });
    document.querySelectorAll('.board-column-body').forEach(body => {
        body.addEventListener('dragover', (e) => {
            if (_dragTaskId === null) return;
            e.preventDefault();
            body.classList.add('drop-target');
        });
        body.addEventListener('dragleave', () => body.classList.remove('drop-target'));
        body.addEventListener('drop', (e) => {
            e.preventDefault();
            body.classList.remove('drop-target');
            if (_dragTaskId === null) return;
            _dropBoardTask(_dragTaskId, body.dataset.status);
        });
    });
}

function _dropBoardTask(taskId, status) {
    const task = boardTasks.find(t => t.id === taskId);
    if (!task || task.status === status) return;
    const previousStatus = task.status;
    task.status = status;
    _renderBoardColumns();

    fetch(`/api/board/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: boardActiveTeamId, status }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            task.status = previousStatus;
            _renderBoardColumns();
            _wsToast(data.message || t('team_action_failed'));
        }
    }).catch(() => {
        task.status = previousStatus;
        _renderBoardColumns();
        _wsToast(t('team_action_failed'));
    });
}

// =====================================================================
// New-task modal
// =====================================================================
function openBoardTaskModal() {
    const team = boardTeams.find(t => t.id === boardActiveTeamId);
    if (!team) { _wsToast(t('board_empty_hint')); return; }
    document.getElementById('board-task-subject').value = '';
    const ownerSelect = document.getElementById('board-task-owner');
    ownerSelect.innerHTML = team.members.map(m =>
        `<option value="${_wsAttr(m.slot_id)}">${escapeHtml(_agentLabelForBoard(m.agent_id))}${m.role === 'leader' ? ' (Leader)' : ''}</option>`
    ).join('');
    document.getElementById('board-task-modal').classList.remove('hidden');
    document.getElementById('board-task-modal').classList.add('flex');
}

function closeBoardTaskModal() {
    document.getElementById('board-task-modal').classList.add('hidden');
    document.getElementById('board-task-modal').classList.remove('flex');
}

function submitBoardTask() {
    const subject = document.getElementById('board-task-subject').value.trim();
    const ownerSlotId = document.getElementById('board-task-owner').value;
    if (!subject) { _wsToast(t('board_task_subject')); return; }
    fetch('/api/board/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: boardActiveTeamId, subject, owner_slot_id: ownerSlotId }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        closeBoardTaskModal();
        _loadBoardTasks();
    }).catch(() => _wsToast(t('team_action_failed')));
}
