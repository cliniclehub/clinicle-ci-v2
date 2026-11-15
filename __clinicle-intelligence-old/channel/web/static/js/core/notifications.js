/* Header notifications bell: polls the one aggregation endpoint
 * (/api/notifications, backed by agent/workspace/notifications.py) that
 * merges Review Queue flags, Pending Edits, worktree merge conflicts, and
 * scheduler run completions into one flat list, and renders it as a
 * dropdown off the bell in the header (channel/web/templates/layout/
 * header.html's #notif-center).
 *
 * Read/unread is tracked entirely client-side -- there is no backend
 * concept of "seen" (see notifications.py's own header comment for why).
 * Same precedent as this file's sibling notify.js, which already tracks
 * "already notified" scheduler run ids the same way: a bounded id set in
 * localStorage, synced across tabs over a BroadcastChannel so marking read
 * in one tab clears the badge in every other open tab. A SEPARATE channel
 * from notify.js's own 'cow_scheduler_notify' -- different concern (a
 * persistent inbox vs. a one-shot OS toast), kept independent on purpose.
 *
 * This poll is independent of, and does not replace, scheduler-notify.js's
 * existing 10s toast poller -- that one's tick() is welded to OS-toast-
 * specific machinery (Notification permission, manual-run-origin routing,
 * audio) that has nothing to do with a quiet inbox badge.
 */

const NOTIF_SEEN_KEY = 'cow_notifications_seen';
const NOTIF_SEEN_MAX = 500;
const NOTIF_POLL_MS = 15000;

const NOTIF_ICONS = {
    review_flag: 'fa-flag',
    pending_edit: 'fa-code-branch',
    worktree_conflict: 'fa-code-merge',
    run_done: 'fa-circle-check',
    run_error: 'fa-circle-xmark',
};

let _notifItems = [];
let _notifSeenIds = new Set();
let _notifPollStarted = false;
let _notifBus = null;

try {
    if (typeof BroadcastChannel !== 'undefined') {
        _notifBus = new BroadcastChannel('cow_notifications_seen');
        _notifBus.onmessage = (e) => {
            const id = e && e.data && e.data.seenId;
            if (id && !_notifSeenIds.has(id)) {
                _notifSeenIds.add(id);
                _renderNotificationBadge();
                _renderNotificationList();
            }
        };
    }
} catch (_) { _notifBus = null; }

function _loadSeenIds() {
    try {
        const raw = JSON.parse(localStorage.getItem(NOTIF_SEEN_KEY) || '[]');
        return new Set(Array.isArray(raw) ? raw : []);
    } catch (_) {
        return new Set();
    }
}

function _persistSeenIds() {
    try {
        // Bounded FIFO trim, same technique as notify.js's _NOTIFIED_RUNS_MAX --
        // insertion order in a Set is preserved, so the oldest entries are
        // first; a negative-length slice is a no-op when already under the cap.
        const ids = Array.from(_notifSeenIds).slice(-NOTIF_SEEN_MAX);
        localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify(ids));
    } catch (_) {}
}

function _markSeen(id) {
    if (_notifSeenIds.has(id)) return;
    _notifSeenIds.add(id);
    _persistSeenIds();
    if (_notifBus) {
        try { _notifBus.postMessage({ seenId: id }); } catch (_) {}
    }
}

// =====================================================================
// Poll
// =====================================================================

function startNotificationPolling() {
    if (_notifPollStarted) return;
    _notifPollStarted = true;
    _notifSeenIds = _loadSeenIds();

    function tick() {
        fetch('/api/notifications')
            .then(r => r.json())
            .then(data => {
                if (data && data.status === 'success' && Array.isArray(data.items)) {
                    _notifItems = data.items;
                    // GC seen-ids for items that no longer appear (resolved, or a
                    // scheduler run that aged out of the lookback window) -- keeps
                    // the localStorage set from only ever growing.
                    const live = new Set(_notifItems.map(i => i.id));
                    let changed = false;
                    for (const id of Array.from(_notifSeenIds)) {
                        if (!live.has(id)) { _notifSeenIds.delete(id); changed = true; }
                    }
                    if (changed) _persistSeenIds();
                    _renderNotificationBadge();
                    _renderNotificationList();
                }
            })
            .catch(() => { /* transient; keep polling */ })
            .finally(() => setTimeout(tick, NOTIF_POLL_MS));
    }
    tick();
}

if (typeof window !== 'undefined') {
    window.addEventListener('load', () => requestAuthGatedStart(startNotificationPolling));
}

// =====================================================================
// Render
// =====================================================================

function _notificationUnreadCount() {
    return _notifItems.reduce((n, it) => n + (_notifSeenIds.has(it.id) ? 0 : 1), 0);
}

function _renderNotificationBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const count = _notificationUnreadCount();
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.classList.toggle('hidden', count === 0);
}

function _notificationRelativeTime(epochSeconds) {
    const diff = Math.max(0, Date.now() / 1000 - (epochSeconds || 0));
    if (diff < 60) return t('notif_time_now') || 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
}

function _notificationCardHTML(item) {
    const unseen = !_notifSeenIds.has(item.id);
    const icon = NOTIF_ICONS[item.type] || 'fa-bell';
    return `
    <div class="activity-card" onclick="_openNotification('${_wsAttr(item.id)}')">
        <div class="activity-card-head">
            ${unseen ? '<span class="activity-inbox-dot"></span>' : ''}
            <i class="fas ${icon} activity-card-icon"></i>
            <span class="activity-card-label">${escapeHtml(item.title || '')}</span>
            <span class="text-[10px] text-surface-400 dark:text-surface-500 flex-shrink-0">${_notificationRelativeTime(item.created_at)}</span>
        </div>
        ${item.detail ? `<div class="activity-card-sub" style="display:block">${escapeHtml(item.detail)}</div>` : ''}
    </div>`;
}

function _renderNotificationList() {
    const listEl = document.getElementById('notif-list');
    const emptyEl = document.getElementById('notif-empty');
    if (!listEl) return;
    if (!_notifItems.length) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    listEl.innerHTML = _notifItems.map(_notificationCardHTML).join('');
}

// =====================================================================
// Click-to-navigate
// =====================================================================

function _openNotification(id) {
    const item = _notifItems.find(i => i.id === id);
    if (!item) return;
    _markSeen(id);
    _renderNotificationBadge();
    _renderNotificationList();
    closeNotificationMenu();
    if (item.target_view) {
        navigateTo(item.target_view, item.target_tab || undefined);
    } else if (item.target_session_id) {
        // A run isn't a navigateTo() target -- same as the existing scheduler-
        // run OS toast's own click handler (notify.js's popNotification).
        broadcastOpenSession(item.target_session_id, item.target_agent_id || '');
    }
}

// =====================================================================
// Dropdown open/close -- mirrors version.js's toggleUpdateMenu: ARIA state,
// outside-click listener attached only while open.
// =====================================================================

function toggleNotificationMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('notif-menu');
    const btn = document.getElementById('notif-toggle');
    if (!menu) return;
    const willOpen = menu.classList.contains('hidden');
    if (willOpen) {
        menu.classList.remove('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        setTimeout(() => document.addEventListener('click', _closeNotificationMenuOnOutside), 0);
    } else {
        closeNotificationMenu();
    }
}

function closeNotificationMenu() {
    const menu = document.getElementById('notif-menu');
    const btn = document.getElementById('notif-toggle');
    if (menu) menu.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', _closeNotificationMenuOnOutside);
}

function _closeNotificationMenuOnOutside(event) {
    const menu = document.getElementById('notif-menu');
    const btn = document.getElementById('notif-toggle');
    if (!menu) return;
    if (menu.contains(event.target) || (btn && btn.contains(event.target))) return;
    closeNotificationMenu();
}
