/* Worktrees view: the merge-back queue for isolated sub agent runs
 * (agent/subagent/worktree.py, agent/subagent/runner.py's _run_one).
 * Same "nothing auto-actioned, only a click here decides" shape as
 * pending-edits.js -- Merge folds the branch into the project with
 * --no-ff, Discard drops it. A run with no changes never reaches this
 * queue at all (removed immediately by the backend). */

function loadWorktreesView() {
    fetch('/api/worktrees').then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wtStatus(data.message || 'Could not load worktrees', true); return; }
        _renderWorktrees(data.worktrees || []);
    }).catch(() => _wtStatus('Could not reach the server', true));
}

function _wtStatus(message, isError) {
    const el = document.getElementById('worktrees-status');
    if (!el) return;
    if (!message) { el.classList.add('opacity-0'); return; }
    el.textContent = message;
    el.className = `text-sm mb-4 transition-opacity duration-150 ${isError ? 'text-red-500' : 'text-emerald-500'}`;
}

function _wtDateLabel(unixSeconds) {
    try {
        return new Date(unixSeconds * 1000).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch (e) { return ''; }
}

const WT_STATUS_BADGE = {
    completed: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    failed: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    cancelled: 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400',
};

function _renderWorktrees(entries) {
    const list = document.getElementById('worktrees-list');
    if (!list) return;
    if (!entries.length) {
        list.innerHTML = '<div class="text-surface-400 dark:text-surface-500 text-sm py-8 text-center">Nothing waiting to merge.</div>';
        return;
    }
    list.innerHTML = entries.map(e => `
        <div class="p-4 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-surface-800">
            <div class="flex items-start justify-between gap-3 mb-2">
                <div class="min-w-0">
                    <div class="text-sm font-semibold text-surface-800 dark:text-surface-100 truncate">${escapeHtml(e.task_name || e.branch)}</div>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-medium ${WT_STATUS_BADGE[e.status] || WT_STATUS_BADGE.completed}">${escapeHtml((e.status || '').toUpperCase())}</span>
                        <span class="text-[11px] text-surface-400 dark:text-surface-500">from ${escapeHtml(e.agent_id || 'unknown agent')} &middot; ${_wtDateLabel(e.created_at)}</span>
                    </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="actionWorktree('${e.id}', 'merge')"
                            class="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 cursor-pointer">Merge</button>
                    <button onclick="actionWorktree('${e.id}', 'discard')"
                            class="px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-50 dark:bg-surface-700/40 text-surface-500 dark:text-surface-400 hover:bg-surface-100 cursor-pointer">Discard</button>
                </div>
            </div>
            <div class="text-[11px] text-surface-500 dark:text-surface-400 font-mono truncate">${escapeHtml(e.branch)} &rarr; ${escapeHtml(e.project_dir)}</div>
            ${e.summary ? `<div class="text-xs text-surface-500 dark:text-surface-400 mt-2 whitespace-pre-wrap">${escapeHtml(e.summary)}</div>` : ''}
        </div>`).join('');
}

function actionWorktree(entryId, action) {
    fetch(`/api/worktrees/${encodeURIComponent(entryId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            if (data.conflict) { wtOpenConflictModal(entryId); return; }
            _wtStatus(data.message || 'Could not update worktree', true);
            return;
        }
        _wtStatus(action === 'merge' ? 'Merged.' : 'Discarded.', false);
        _renderWorktrees(data.worktrees || []);
    }).catch(() => _wtStatus('Could not reach the server', true));
}

// =========================================================================
// Merge-conflict resolution: bounded v1 -- parse git's own conflict
// markers (channel/web/api/worktrees.py, agent/subagent/worktree.py's
// parse_conflict_markers), show ours/theirs side by side per hunk, let the
// admin click one side or type a manual replacement, then commit. Not a
// full 3-way diff engine -- built entirely on git's existing conflict
// output.
// =========================================================================

let _wtConflictEntryId = null;

function wtOpenConflictModal(entryId) {
    _wtConflictEntryId = entryId;
    fetch(`/api/worktrees/${encodeURIComponent(entryId)}/conflicts`).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wtStatus(data.message || 'Could not load conflicts', true); return; }
        _renderConflictFiles(data.files || {});
        document.getElementById('wt-conflict-modal').classList.remove('hidden');
    }).catch(() => _wtStatus('Could not reach the server', true));
}

function wtCloseConflictModal() {
    document.getElementById('wt-conflict-modal').classList.add('hidden');
    _wtConflictEntryId = null;
}

function _renderConflictFiles(files) {
    const container = document.getElementById('wt-conflict-files');
    const paths = Object.keys(files);
    if (!paths.length) {
        container.innerHTML = '<div class="text-sm text-surface-400 text-center py-6">No conflicting files found.</div>';
        return;
    }
    container.innerHTML = paths.map(path => {
        const blocks = files[path];
        if (blocks && blocks.binary) {
            return `
                <div class="wt-conflict-file" data-file="${escapeHtml(path)}" data-binary="true">
                    <div class="wt-conflict-file-name">${escapeHtml(path)} <span class="text-xs text-surface-400 font-normal">(binary)</span></div>
                    <div class="wt-conflict-binary-choice">
                        <button type="button" class="wt-conflict-binary-btn" onclick="wtChooseBinarySide(this, 'ours')" data-choice="ours">Keep ours</button>
                        <button type="button" class="wt-conflict-binary-btn" onclick="wtChooseBinarySide(this, 'theirs')" data-choice="theirs">Keep theirs</button>
                    </div>
                </div>`;
        }
        let hunkIndex = 0;
        const hunksHtml = blocks.filter(b => b.type === 'conflict').map(block => {
            const i = hunkIndex++;
            const inputId = `wt-manual-${escapeHtml(path)}-${i}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            return `
                <div class="wt-conflict-hunk" data-path="${escapeHtml(path)}" data-hunk="${i}" data-choice="ours">
                    <div class="wt-conflict-side">
                        <div>
                            <div class="wt-conflict-hunk-label">${escapeHtml(block.ours_label || 'ours')}</div>
                            <div class="wt-conflict-ours selected" onclick="wtChooseSide(this, 'ours')">${escapeHtml(block.ours)}</div>
                        </div>
                        <div>
                            <div class="wt-conflict-hunk-label">${escapeHtml(block.theirs_label || 'theirs')}</div>
                            <div class="wt-conflict-theirs" onclick="wtChooseSide(this, 'theirs')">${escapeHtml(block.theirs)}</div>
                        </div>
                    </div>
                    <textarea id="${inputId}" class="wt-conflict-manual hidden" placeholder="Or type a manual replacement..."
                              oninput="wtChooseManual(this)"></textarea>
                </div>`;
        }).join('');
        return `
            <div class="wt-conflict-file" data-file="${escapeHtml(path)}">
                <div class="wt-conflict-file-name">${escapeHtml(path)}</div>
                ${hunksHtml || '<div class="text-xs text-surface-400">No conflict hunks parsed in this file.</div>'}
            </div>`;
    }).join('');
}

function wtChooseSide(el, side) {
    const hunk = el.closest('.wt-conflict-hunk');
    hunk.dataset.choice = side;
    hunk.querySelector('.wt-conflict-ours').classList.toggle('selected', side === 'ours');
    hunk.querySelector('.wt-conflict-theirs').classList.toggle('selected', side === 'theirs');
    const manual = hunk.querySelector('.wt-conflict-manual');
    manual.classList.add('hidden');
}

function wtChooseManual(textarea) {
    const hunk = textarea.closest('.wt-conflict-hunk');
    hunk.dataset.choice = 'manual';
    hunk.querySelector('.wt-conflict-ours').classList.remove('selected');
    hunk.querySelector('.wt-conflict-theirs').classList.remove('selected');
    textarea.classList.remove('hidden');
}

function wtChooseBinarySide(el, side) {
    const fileEl = el.closest('.wt-conflict-file');
    fileEl.dataset.binaryChoice = side;
    fileEl.querySelectorAll('.wt-conflict-binary-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.choice === side);
    });
}

function _wtConflictStatus(message, isError) {
    const el = document.getElementById('wt-conflict-status');
    if (el) el.textContent = message || '';
    if (el) el.className = `text-xs ${isError ? 'text-red-500' : 'text-surface-400'}`;
}

function _wtResolveAllFiles() {
    const fileEls = document.querySelectorAll('#wt-conflict-files .wt-conflict-file');
    const requests = Array.from(fileEls).map(fileEl => {
        const path = fileEl.dataset.file;
        if (fileEl.dataset.binary === 'true') {
            const choice = fileEl.dataset.binaryChoice;
            if (!choice) return Promise.resolve({ status: 'error', message: `Pick ours or theirs for ${path}` });
            return fetch(`/api/worktrees/${encodeURIComponent(_wtConflictEntryId)}/resolve-binary`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, choice }),
            }).then(r => r.json());
        }
        const hunks = Array.from(fileEl.querySelectorAll('.wt-conflict-hunk'));
        const resolutions = hunks.map(hunk => {
            if (hunk.dataset.choice === 'manual') return hunk.querySelector('.wt-conflict-manual').value;
            return hunk.dataset.choice;
        });
        if (!resolutions.length) return Promise.resolve({ status: 'success' });
        return fetch(`/api/worktrees/${encodeURIComponent(_wtConflictEntryId)}/resolve`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, resolutions }),
        }).then(r => r.json());
    });
    return Promise.all(requests);
}

function wtCompleteConflict() {
    _wtConflictStatus('Resolving...', false);
    _wtResolveAllFiles().then(results => {
        const failed = results.find(r => r.status !== 'success');
        if (failed) { _wtConflictStatus(failed.message || 'Could not resolve a file', true); return; }
        return fetch(`/api/worktrees/${encodeURIComponent(_wtConflictEntryId)}/complete`, { method: 'POST' })
            .then(r => r.json()).then(data => {
                if (data.status !== 'success') { _wtConflictStatus(data.message || 'Could not complete the merge', true); return; }
                wtCloseConflictModal();
                _wtStatus('Merged.', false);
                _renderWorktrees(data.worktrees || []);
            });
    }).catch(() => _wtConflictStatus('Could not reach the server', true));
}

function wtAbortConflict() {
    fetch(`/api/worktrees/${encodeURIComponent(_wtConflictEntryId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'abort' }),
    }).then(r => r.json()).then(data => {
        wtCloseConflictModal();
        if (data.status !== 'success') { _wtStatus(data.message || 'Could not abort the merge', true); return; }
        _wtStatus('Merge aborted.', false);
        _renderWorktrees(data.worktrees || []);
    }).catch(() => _wtStatus('Could not reach the server', true));
}
