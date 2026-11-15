/* Meeting Assistant: list + detail (not a Kanban board -- the record's
 * lifecycle is draft -> processing -> review -> published, a document to
 * review/edit/publish, not a workflow to visualize). Paste or upload a
 * transcript (.vtt/.srt), a background job extracts a structured draft
 * (summary/decisions/open questions/action items), the organizer reviews
 * and resolves any "uncertain" owner/date, then publishes. See
 * channel/web/api/meetings.py's docstring for why raw audio isn't accepted.
 */

let meetingsList = [];
let activeMeetingId = '';
let activeMeetingDetail = null;
let _meetingsPollTimer = null;

function loadMeetingsView() {
    fetch('/api/meetings').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        meetingsList = data.meetings || [];
        _renderMeetingsList();
        if (activeMeetingId && meetingsList.some(m => m.id === activeMeetingId)) {
            selectMeeting(activeMeetingId);
        } else if (!activeMeetingId && meetingsList.length) {
            selectMeeting(meetingsList[0].id);
        }
    }).catch(() => {});
}

function stopMeetingsPolling() {
    if (_meetingsPollTimer) { clearInterval(_meetingsPollTimer); _meetingsPollTimer = null; }
}

function _statusLabel(status) {
    return t('meetings_status_' + status) || status;
}

function _statusClass(status) {
    return 'meeting-status meeting-status-' + status;
}

function _renderMeetingsList() {
    const emptyEl = document.getElementById('meetings-empty');
    const itemsEl = document.getElementById('meetings-list-items');
    if (!meetingsList.length) {
        emptyEl.classList.remove('hidden');
        itemsEl.innerHTML = '';
        return;
    }
    emptyEl.classList.add('hidden');
    itemsEl.innerHTML = meetingsList.map(m => `
        <div class="meeting-card${m.id === activeMeetingId ? ' meeting-card-active' : ''}" onclick="selectMeeting('${_wsAttr(m.id)}')">
            <div class="meeting-card-title">${escapeHtml(m.title)}</div>
            <div class="meeting-card-meta">
                <span class="${_statusClass(m.status)}">${escapeHtml(_statusLabel(m.status))}</span>
                ${m.job_error ? `<span class="meeting-card-error" title="${escapeHtml(m.job_error)}"><i class="fas fa-triangle-exclamation"></i></span>` : ''}
            </div>
        </div>
    `).join('');
}

function selectMeeting(meetingId) {
    activeMeetingId = meetingId;
    _renderMeetingsList();
    document.getElementById('meetings-detail').classList.remove('hidden');
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        activeMeetingDetail = data;
        _renderMeetingDetail(data);
        stopMeetingsPolling();
        if (data.meeting.status === 'processing') {
            _meetingsPollTimer = setInterval(() => {
                if (activeMeetingId !== meetingId) return stopMeetingsPolling();
                selectMeeting(meetingId);
            }, 3000);
        }
    }).catch(() => {});
}

function _spanText(spans, idx) {
    if (idx === null || idx === undefined) return '';
    const span = (spans || []).find(s => s.idx === idx);
    return span ? span.text : '';
}

function _renderMeetingDetail(data) {
    const m = data.meeting;
    const spans = data.transcript_spans || [];
    const el = document.getElementById('meetings-detail');

    if (m.status === 'draft' && !spans.length) {
        el.innerHTML = _transcriptIntakeHTML(m);
        return;
    }

    const invitees = (data.participants || []).filter(p => p.is_invitee);
    const attendees = (data.participants || []).filter(p => p.is_attendee);
    const decisions = (data.minutes || []).filter(s => s.kind === 'decision');
    const openQuestions = (data.minutes || []).filter(s => s.kind === 'open_question');

    el.innerHTML = `
        <div class="meeting-detail-head">
            <div class="min-w-0">
                <h3 class="meeting-detail-title">${escapeHtml(m.title)}</h3>
                <span class="${_statusClass(m.status)}">${escapeHtml(_statusLabel(m.status))}</span>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                ${m.job_error && m.status === 'processing' ? `<button class="meeting-btn-secondary" onclick="reprocessMeeting('${_wsAttr(m.id)}')"><i class="fas fa-rotate-right"></i> ${escapeHtml(t('meetings_reprocess'))}</button>` : ''}
                ${m.status === 'review' ? `<button class="meeting-btn-primary" onclick="publishMeeting('${_wsAttr(m.id)}')"><i class="fas fa-paper-plane"></i> ${escapeHtml(t('meetings_publish'))}</button>` : ''}
            </div>
        </div>

        ${m.status === 'processing' ? `<div class="meeting-processing-banner"><i class="fas fa-circle-notch fa-spin"></i> ${escapeHtml(_statusLabel('processing'))}...</div>` : ''}
        ${_liveCaptureBannerHTML(m)}
        ${m.job_error ? `<div class="meeting-error-banner">${escapeHtml(m.job_error)}</div>` : ''}

        ${m.summary ? `<div class="meeting-section"><h4>${escapeHtml(t('meetings_summary'))}</h4><p class="meeting-summary-text">${escapeHtml(m.summary)}</p></div>` : ''}

        <div class="meeting-section-grid">
            <div class="meeting-section">
                <h4>${escapeHtml(t('meetings_invitees'))}</h4>
                <ul class="meeting-people-list">${invitees.map(p => `<li>${escapeHtml(p.name || p.email || '')}</li>`).join('') || '<li class="meeting-empty-row">--</li>'}</ul>
            </div>
            <div class="meeting-section">
                <h4>${escapeHtml(t('meetings_attendees'))}</h4>
                <ul class="meeting-people-list">${attendees.map(p => `<li>${escapeHtml(p.name || p.email || '')}</li>`).join('') || '<li class="meeting-empty-row">--</li>'}</ul>
            </div>
        </div>

        ${decisions.length ? `<div class="meeting-section"><h4>${escapeHtml(t('meetings_decisions'))}</h4><ul class="meeting-item-list">${decisions.map(d => _minutesItemHTML(d, spans)).join('')}</ul></div>` : ''}
        ${openQuestions.length ? `<div class="meeting-section"><h4>${escapeHtml(t('meetings_open_questions'))}</h4><ul class="meeting-item-list">${openQuestions.map(q => _minutesItemHTML(q, spans)).join('')}</ul></div>` : ''}

        ${(data.action_items || []).length ? `
        <div class="meeting-section">
            <h4>${escapeHtml(t('meetings_action_items'))}</h4>
            <div class="meeting-action-items">${(data.action_items || []).map(item => _actionItemHTML(m, item, data.participants || [], spans)).join('')}</div>
        </div>` : ''}
    `;
}

function _minutesItemHTML(item, spans) {
    const evidence = _spanText(spans, item.span_idx);
    return `<li>
        <span>${escapeHtml(item.text)}</span>
        ${item.span_idx !== null && item.span_idx !== undefined ? `<button class="meeting-span-link" title="${escapeHtml(evidence)}" onclick="alert(${JSON.stringify(evidence)})">${escapeHtml(t('meetings_view_span'))}</button>` : ''}
    </li>`;
}

function _actionItemHTML(meeting, item, participants, spans) {
    const evidence = _spanText(spans, item.span_idx);
    const canEdit = meeting.status !== 'published';
    const ownerOptions = participants.map(p =>
        `<option value="${p.id}" ${item.owner_user_id && p.user_id === item.owner_user_id ? 'selected' : ''}>${escapeHtml(p.name || p.email || '')}</option>`
    ).join('');
    return `
    <div class="meeting-action-item${item.status === 'done' ? ' meeting-action-item-done' : ''}">
        <input type="checkbox" ${item.status === 'done' ? 'checked' : ''} ${canEdit ? '' : 'disabled'}
               onchange="updateActionItem('${_wsAttr(meeting.id)}', ${item.id}, {status: this.checked ? 'done' : 'open'})">
        <div class="meeting-action-item-body">
            <div class="meeting-action-item-task">${escapeHtml(item.task)}</div>
            <div class="meeting-action-item-meta">
                ${canEdit
                    ? `<select class="meeting-owner-select" onchange="updateActionItem('${_wsAttr(meeting.id)}', ${item.id}, {owner_participant_id: this.value ? Number(this.value) : null})">
                         <option value="">${escapeHtml(t('meetings_owner_uncertain'))}</option>${ownerOptions}
                       </select>`
                    : `<span>${escapeHtml(item.owner_name || t('meetings_owner_uncertain'))}</span>`}
                ${canEdit
                    ? `<input type="date" class="meeting-due-input" value="${item.due_date || ''}"
                         onchange="updateActionItem('${_wsAttr(meeting.id)}', ${item.id}, {due_date: this.value || null})">`
                    : `<span>${item.due_date ? escapeHtml(item.due_date) : escapeHtml(t('meetings_due_uncertain'))}</span>`}
                ${item.owner_uncertain ? `<span class="meeting-uncertain-chip">${escapeHtml(t('meetings_owner_uncertain'))}</span>` : ''}
                ${item.due_uncertain ? `<span class="meeting-uncertain-chip">${escapeHtml(t('meetings_due_uncertain'))}</span>` : ''}
                ${item.span_idx !== null && item.span_idx !== undefined ? `<button class="meeting-span-link" title="${escapeHtml(evidence)}" onclick="alert(${JSON.stringify(evidence)})">${escapeHtml(t('meetings_view_span'))}</button>` : ''}
            </div>
        </div>
    </div>`;
}

function _transcriptIntakeHTML(meeting) {
    return `
        <div class="meeting-detail-head">
            <div class="min-w-0">
                <h3 class="meeting-detail-title">${escapeHtml(meeting.title)}</h3>
                <span class="${_statusClass(meeting.status)}">${escapeHtml(_statusLabel(meeting.status))}</span>
            </div>
        </div>
        <div class="meeting-section">
            <h4>${escapeHtml(t('meetings_transcript'))}</h4>
            <p class="meeting-empty-row">${escapeHtml(t('meetings_no_transcript'))}</p>
            <textarea id="meeting-transcript-paste" rows="6" placeholder="${escapeHtml(t('meetings_transcript_placeholder'))}"
                      class="meeting-transcript-textarea"></textarea>
            <div class="flex items-center gap-2 mt-2">
                <button class="meeting-btn-primary" onclick="submitTranscriptPaste('${_wsAttr(meeting.id)}')">
                    <i class="fas fa-paste"></i> ${escapeHtml(t('meetings_paste_transcript'))}
                </button>
                <label class="meeting-btn-secondary meeting-upload-label">
                    <i class="fas fa-upload"></i> ${escapeHtml(t('meetings_upload_transcript'))}
                    <input type="file" accept=".vtt,.srt" class="hidden" onchange="submitTranscriptUpload('${_wsAttr(meeting.id)}', this)">
                </label>
                <button class="meeting-btn-secondary" onclick="promptCalendarPrefill('${_wsAttr(meeting.id)}')">
                    <i class="fas fa-calendar-days"></i> ${escapeHtml(t('meetings_calendar_prefill'))}
                </button>
            </div>
        </div>`;
}

function submitTranscriptPaste(meetingId) {
    const content = document.getElementById('meeting-transcript-paste').value.trim();
    if (!content) return;
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/transcript`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_type: 'text', content }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        selectMeeting(meetingId);
        loadMeetingsView();
    }).catch(() => _wsToast(t('team_action_failed')));
}

function submitTranscriptUpload(meetingId, inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const sourceType = ext === 'vtt' ? 'vtt' : ext === 'srt' ? 'srt' : '';
    if (!sourceType) { _wsToast('meetings_upload_transcript'); return; }
    const form = new FormData();
    form.append('file', file);
    form.append('source_type', sourceType);
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/transcript`, { method: 'POST', body: form })
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
            selectMeeting(meetingId);
            loadMeetingsView();
        }).catch(() => _wsToast(t('team_action_failed')));
}

function promptCalendarPrefill(meetingId) {
    const eventId = window.prompt(t('meetings_calendar_event_id'));
    if (!eventId) return;
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/calendar_prefill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        selectMeeting(meetingId);
    }).catch(() => _wsToast(t('team_action_failed')));
}

function publishMeeting(meetingId) {
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/publish`, { method: 'POST' })
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
            selectMeeting(meetingId);
            loadMeetingsView();
        }).catch(() => _wsToast(t('team_action_failed')));
}

function reprocessMeeting(meetingId) {
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/reprocess`, { method: 'POST' })
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
            selectMeeting(meetingId);
        }).catch(() => _wsToast(t('team_action_failed')));
}

function updateActionItem(meetingId, itemId, fields) {
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/action_items/${itemId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        selectMeeting(meetingId);
    }).catch(() => _wsToast(t('team_action_failed')));
}

function _liveCaptureBannerHTML(m) {
    if (m.capture_mode !== 'live_bot' || m.status !== 'draft') return '';
    let text, icon = 'fa-video';
    if (!m.bot_id) {
        text = m.job_error ? t('meetings_bot_error') : t('meetings_bot_scheduled');
    } else {
        text = t('meetings_bot_recording');
        icon = 'fa-circle-notch fa-spin';
    }
    return `<div class="meeting-processing-banner">
        <i class="fas ${icon}"></i> ${escapeHtml(text)}
        ${m.meeting_url ? `<span class="meeting-url-pill">${escapeHtml(m.meeting_url)}</span>` : ''}
        ${m.bot_id ? `<button class="meeting-span-link" onclick="cancelMeetingBot('${_wsAttr(m.id)}')">${escapeHtml(t('meetings_bot_cancel'))}</button>` : ''}
    </div>`;
}

function cancelMeetingBot(meetingId) {
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/cancel_bot`, { method: 'POST' })
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
            selectMeeting(meetingId);
        }).catch(() => _wsToast(t('team_action_failed')));
}

// =====================================================================
// Calendar tab: day/month/year grid merged from every connected calendar
// (Google Calendar + Outlook, best-effort -- see calendar_sources.py),
// click an event to opt it into bot capture (or jump to its meeting record
// if already enabled).
// =====================================================================
let calMode = 'month';
let calAnchor = new Date();
let calEvents = [];

function switchMeetingsTab(tab) {
    const isList = tab === 'list';
    document.getElementById('meetings-list-tab').classList.toggle('hidden', !isList);
    document.getElementById('meetings-calendar-tab').classList.toggle('hidden', isList);
    document.getElementById('meetings-tab-list').classList.toggle('meetings-tab-active', isList);
    document.getElementById('meetings-tab-calendar').classList.toggle('meetings-tab-active', !isList);
    if (!isList) loadCalendarEvents();
}

function setCalendarMode(mode) {
    calMode = mode;
    document.querySelectorAll('.meetings-cal-mode-btn').forEach(btn => {
        btn.classList.toggle('meetings-cal-mode-active', btn.dataset.calMode === mode);
    });
    loadCalendarEvents();
}

function calendarNav(direction) {
    const d = new Date(calAnchor);
    if (calMode === 'day') d.setDate(d.getDate() + direction);
    else if (calMode === 'month') d.setMonth(d.getMonth() + direction);
    else d.setFullYear(d.getFullYear() + direction);
    calAnchor = d;
    loadCalendarEvents();
}

function calendarToday() {
    calAnchor = new Date();
    loadCalendarEvents();
}

function _calRangeForMode() {
    const a = calAnchor;
    if (calMode === 'day') {
        const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
        const end = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1);
        return [start, end];
    }
    if (calMode === 'year') {
        return [new Date(a.getFullYear(), 0, 1), new Date(a.getFullYear() + 1, 0, 1)];
    }
    // month: cover the full 6x7 grid, including the leading/trailing days
    // from adjacent months the grid displays.
    const firstOfMonth = new Date(a.getFullYear(), a.getMonth(), 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 42);
    return [gridStart, gridEnd];
}

function loadCalendarEvents() {
    const [start, end] = _calRangeForMode();
    const grid = document.getElementById('meetings-cal-grid');
    grid.innerHTML = '<div class="meeting-empty-row">...</div>';
    fetch(`/api/meetings/calendar?start=${start.getTime() / 1000}&end=${end.getTime() / 1000}`)
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') { grid.innerHTML = `<div class="meeting-empty-row">${escapeHtml(data.message || '')}</div>`; return; }
            calEvents = data.events || [];
            renderCalendarGrid();
        }).catch(() => { grid.innerHTML = `<div class="meeting-empty-row">${escapeHtml(t('team_action_failed'))}</div>`; });
}

function _calDayKey(date) { return date.toISOString().slice(0, 10); }

function _eventsByDay(events) {
    const map = {};
    events.forEach(ev => {
        const key = _calDayKey(new Date(ev.starts_at * 1000));
        (map[key] = map[key] || []).push(ev);
    });
    return map;
}

function _eventChipHTML(ev) {
    const cls = ev.already_enabled ? 'meetings-cal-chip meetings-cal-chip-enabled' : 'meetings-cal-chip';
    const action = ev.already_enabled
        ? `selectMeetingFromCalendar('${_wsAttr(ev.meeting_id)}')`
        : `enableBotCapture(${JSON.stringify(ev).replace(/'/g, "&#39;")})`;
    const time = ev.all_day ? '' : new Date(ev.starts_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    // onclick is single-quoted on purpose: `action` embeds JSON.stringify()
    // output, which is full of double quotes that would otherwise close a
    // double-quoted attribute early.
    return `<button class="${cls}" title="${escapeHtml(ev.title)}" onclick='${action}'>
        ${time ? `<span class="meetings-cal-chip-time">${escapeHtml(time)}</span>` : ''}
        <span class="truncate">${escapeHtml(ev.title)}</span>
    </button>`;
}

function selectMeetingFromCalendar(meetingId) {
    switchMeetingsTab('list');
    activeMeetingId = meetingId;
    loadMeetingsView();
}

function renderCalendarGrid() {
    const label = document.getElementById('meetings-cal-label');
    if (calMode === 'day') label.textContent = calAnchor.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    else if (calMode === 'month') label.textContent = calAnchor.toLocaleDateString([], { year: 'numeric', month: 'long' });
    else label.textContent = String(calAnchor.getFullYear());

    if (calMode === 'day') return _renderDayGrid();
    if (calMode === 'year') return _renderYearGrid();
    return _renderMonthGrid();
}

function _renderDayGrid() {
    const grid = document.getElementById('meetings-cal-grid');
    const key = _calDayKey(calAnchor);
    const events = (_eventsByDay(calEvents)[key] || []).slice().sort((a, b) => a.starts_at - b.starts_at);
    if (!events.length) {
        grid.innerHTML = `<div class="meeting-empty-row">${escapeHtml(t('meetings_cal_no_events'))}</div>`;
        return;
    }
    grid.innerHTML = `<div class="meetings-cal-day-list">${events.map(ev => `
        <div class="meetings-cal-day-row">
            ${_eventChipHTML(ev)}
            <span class="meeting-card-meta">${escapeHtml(t('meetings_cal_source_' + ev.source) || ev.source)}</span>
        </div>
    `).join('')}</div>`;
}

function _renderMonthGrid() {
    const grid = document.getElementById('meetings-cal-grid');
    const byDay = _eventsByDay(calEvents);
    const a = calAnchor;
    const firstOfMonth = new Date(a.getFullYear(), a.getMonth(), 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
    const todayKey = _calDayKey(new Date());

    let cells = '';
    const cursor = new Date(gridStart);
    for (let i = 0; i < 42; i++) {
        const key = _calDayKey(cursor);
        const dayEvents = (byDay[key] || []).sort((a, b) => a.starts_at - b.starts_at);
        const inMonth = cursor.getMonth() === a.getMonth();
        const isToday = key === todayKey;
        const shown = dayEvents.slice(0, 3);
        const overflow = dayEvents.length - shown.length;
        cells += `<div class="meetings-cal-month-cell${inMonth ? '' : ' meetings-cal-month-cell-out'}${isToday ? ' meetings-cal-month-cell-today' : ''}">
            <div class="meetings-cal-month-daynum">${cursor.getDate()}</div>
            ${shown.map(_eventChipHTML).join('')}
            ${overflow > 0 ? `<div class="meetings-cal-more">${escapeHtml(t('meetings_cal_more').replace('{n}', overflow))}</div>` : ''}
        </div>`;
        cursor.setDate(cursor.getDate() + 1);
    }
    grid.innerHTML = `<div class="meetings-cal-month-grid">${cells}</div>`;
}

function _renderYearGrid() {
    const grid = document.getElementById('meetings-cal-grid');
    const byDay = _eventsByDay(calEvents);
    const year = calAnchor.getFullYear();
    let months = '';
    for (let m = 0; m < 12; m++) {
        const first = new Date(year, m, 1);
        const daysInMonth = new Date(year, m + 1, 0).getDate();
        let dayCells = '';
        for (let d = 1; d <= daysInMonth; d++) {
            const key = _calDayKey(new Date(year, m, d));
            const has = !!(byDay[key] && byDay[key].length);
            dayCells += `<div class="meetings-cal-year-day${has ? ' meetings-cal-year-day-active' : ''}"
                onclick="calMode='day'; calAnchor=new Date(${year},${m},${d}); setCalendarMode('day')">${d}</div>`;
        }
        months += `<div class="meetings-cal-year-month">
            <div class="meetings-cal-year-month-label">${escapeHtml(first.toLocaleDateString([], { month: 'long' }))}</div>
            <div class="meetings-cal-year-days">${dayCells}</div>
        </div>`;
    }
    grid.innerHTML = `<div class="meetings-cal-year-grid">${months}</div>`;
}

function enableBotCapture(event) {
    fetch('/api/meetings/upcoming', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        loadCalendarEvents();
        activeMeetingId = data.meeting.id;
    }).catch(() => _wsToast(t('team_action_failed')));
}

// =====================================================================
// Recall.ai platform setup (admin-only server-side)
// =====================================================================
function openRecallaiSetupModal() {
    document.getElementById('recallai-setup-modal').classList.remove('hidden');
    document.getElementById('recallai-setup-modal').classList.add('flex');
}

function closeRecallaiSetupModal() {
    document.getElementById('recallai-setup-modal').classList.add('hidden');
    document.getElementById('recallai-setup-modal').classList.remove('flex');
}

function _postSetup(url, body) {
    return fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).then(r => r.json()).then(data => {
        _wsToast(data.status === 'success' ? t('meetings_setup_saved') : (data.message || t('meetings_setup_failed')));
        return data;
    }).catch(() => _wsToast(t('meetings_setup_failed')));
}

function submitZoomAppSetup() {
    _postSetup('/api/meetings/settings/recallai/zoom_app', {
        kind: document.getElementById('recallai-zoom-kind').value,
        client_id: document.getElementById('recallai-zoom-client-id').value.trim(),
        client_secret: document.getElementById('recallai-zoom-client-secret').value.trim(),
        webhook_secret: document.getElementById('recallai-zoom-webhook-secret').value.trim(),
    });
}

function submitGoogleGroupSetup() {
    _postSetup('/api/meetings/settings/recallai/google_login/group', {
        name: document.getElementById('recallai-google-group-name').value.trim(),
        login_mode: document.getElementById('recallai-google-login-mode').value,
    }).then(data => {
        if (data && data.status === 'success' && data.result && data.result.id) {
            document.getElementById('recallai-google-group-id').value = data.result.id;
        }
    });
}

function submitGoogleAccountSetup() {
    _postSetup('/api/meetings/settings/recallai/google_login/account', {
        email: document.getElementById('recallai-google-email').value.trim(),
        group_id: document.getElementById('recallai-google-group-id').value.trim(),
        sso_v2_cert: document.getElementById('recallai-google-cert').value.trim(),
        sso_v2_private_key: document.getElementById('recallai-google-key').value.trim(),
        sso_v2_workspace_domain: document.getElementById('recallai-google-domain').value.trim(),
    });
}

function openMeetingCreateModal() {
    document.getElementById('meeting-create-title').value = '';
    document.getElementById('meeting-create-attendees').value = '';
    document.getElementById('meeting-create-modal').classList.remove('hidden');
    document.getElementById('meeting-create-modal').classList.add('flex');
    // agentCatalog / loadAgentCatalog are globals owned by agents.js (same
    // roster teams.js's member picker already reuses) -- no new endpoint.
    (typeof agentCatalog !== 'undefined' && agentCatalog.length ? Promise.resolve() : loadAgentCatalog())
        .then(_renderMeetingAttendeePicker).catch(_renderMeetingAttendeePicker);
}

function closeMeetingCreateModal() {
    document.getElementById('meeting-create-modal').classList.add('hidden');
    document.getElementById('meeting-create-modal').classList.remove('flex');
}

function _renderMeetingAttendeePicker() {
    const list = document.getElementById('meeting-create-picker-list');
    if (!list) return;
    if (!agentCatalog.length) {
        list.innerHTML = `<div class="meeting-empty-row">${escapeHtml(t('meetings_no_agents'))}</div>`;
        return;
    }
    list.innerHTML = agentCatalog.map(a => `
        <label class="meeting-picker-item">
            <input type="checkbox" value="${escapeHtml(a.id)}" data-name="${escapeHtml(a.name || a.id)}">
            <span class="truncate">${escapeHtml(a.name || a.id)}</span>
        </label>
    `).join('');
}

function submitMeetingCreate() {
    const title = document.getElementById('meeting-create-title').value.trim();
    if (!title) { _wsToast(t('meetings_field_title')); return; }
    const pickedAttendees = Array.from(
        document.querySelectorAll('#meeting-create-picker-list input[type="checkbox"]:checked')
    ).map(cb => ({ email: cb.value, name: cb.dataset.name || cb.value }));
    const textAttendees = document.getElementById('meeting-create-attendees').value
        .split('\n').map(line => line.trim()).filter(Boolean)
        .map(email => ({ email, name: email }));
    const seenEmails = new Set();
    const attendees = pickedAttendees.concat(textAttendees).filter(a => {
        const key = a.email.toLowerCase();
        if (seenEmails.has(key)) return false;
        seenEmails.add(key);
        return true;
    });
    fetch('/api/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, attendees }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        closeMeetingCreateModal();
        activeMeetingId = data.meeting.id;
        loadMeetingsView();
    }).catch(() => _wsToast(t('team_action_failed')));
}
