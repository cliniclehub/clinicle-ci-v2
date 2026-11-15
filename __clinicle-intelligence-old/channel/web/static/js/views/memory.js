/* Memory file list.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Memory View
// =====================================================================
let memoryPage = 1;
let memoryCategory = 'memory';   // 'memory' | 'evolution'
const memoryPageSize = 10;

function switchMemoryTab(tab) {
    document.querySelectorAll('.memory-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('memory-tab-' + tab).classList.add('active');
    // The "dreams" tab now surfaces self-evolution logs (merged with dream diaries).
    memoryCategory = tab === 'dreams' ? 'evolution' : 'memory';
    loadMemoryView(1);
    routeNoteTab('memory', tab);
}

function renderMemoryIndexStatus(status) {
    // Not part of templates/views/memory.html — created on first use and
    // inserted right above the file list, so the banner needs no template
    // change to ship.
    let el = document.getElementById('memory-index-status');
    if (!el) {
        const emptyEl = document.getElementById('memory-empty');
        if (!emptyEl) return;
        el = document.createElement('div');
        el.id = 'memory-index-status';
        el.className = 'hidden text-xs text-surface-400 dark:text-surface-500 mb-3';
        emptyEl.parentNode.insertBefore(el, emptyEl);
    }
    if (!status || status.chunk_count === null || status.chunk_count === undefined) {
        el.textContent = '';
        el.classList.add('hidden');
        return;
    }
    const parts = [`${status.chunk_count.toLocaleString()} chunks`];
    if (status.embedded_count !== null && status.embedded_count !== undefined) {
        parts.push(`${status.embedded_count.toLocaleString()} embedded`);
    }
    if (status.embedding_provider) parts.push(status.embedding_provider);
    if (status.last_synced) parts.push(`synced ${status.last_synced}`);
    el.textContent = 'Index: ' + parts.join(' · ');
    el.classList.remove('hidden');
}

function loadMemoryView(page) {
    page = page || 1;
    memoryPage = page;
    const agent = viewingMemoryAgentId();
    fetch(`/api/memory?page=${page}&page_size=${memoryPageSize}&category=${memoryCategory}&agent_id=${encodeURIComponent(agent || '')}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        renderMemoryIndexStatus(data.index_status);
        const emptyEl = document.getElementById('memory-empty');
        const listEl = document.getElementById('memory-list');
        const files = data.list || [];
        const total = data.total || 0;

        if (total === 0) {
            const emptyIcon = emptyEl.querySelector('i');
            const emptyTitle = emptyEl.querySelector('p');
            if (memoryCategory === 'evolution') {
                emptyIcon.className = 'fas fa-seedling text-accent-400 text-xl';
                emptyTitle.textContent = currentLang === 'ar' ? 'لا توجد سجلات تطور بعد' : 'No evolution records yet';
            } else {
                emptyIcon.className = 'fas fa-brain text-purple-400 text-xl';
                emptyTitle.textContent = currentLang === 'ar' ? 'لا توجد ملفات ذاكرة' : 'No memory files';
            }
            emptyEl.classList.remove('hidden');
            listEl.classList.add('hidden');
            return;
        }
        emptyEl.classList.add('hidden');
        listEl.classList.remove('hidden');

        const tbody = document.getElementById('memory-table-body');
        tbody.innerHTML = '';
        files.forEach(f => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-surface-100 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/5 cursor-pointer transition-colors';
            // In the merged evolution tab, resolve each file by its own origin
            // (evolution logs vs dream diaries live in different dirs).
            const fileCategory = (f.type === 'dream' || f.type === 'evolution') ? f.type : memoryCategory;
            tr.onclick = () => openMemoryFile(f.filename, fileCategory);
            let typeLabel;
            if (f.type === 'global') {
                typeLabel = '<span class="px-2 py-0.5 rounded-full text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">Global</span>';
            } else if (f.type === 'evolution') {
                typeLabel = '<span class="px-2 py-0.5 rounded-full text-xs bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400">Evolution</span>';
            } else if (f.type === 'dream') {
                typeLabel = '<span class="px-2 py-0.5 rounded-full text-xs bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">Dream</span>';
            } else {
                typeLabel = '<span class="px-2 py-0.5 rounded-full text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">Daily</span>';
            }
            const sizeStr = f.size < 1024 ? f.size + ' B' : (f.size / 1024).toFixed(1) + ' KB';
            tr.innerHTML = `
                <td class="px-4 py-3 text-sm font-mono text-surface-700 dark:text-surface-200">${escapeHtml(f.filename)}</td>
                <td class="px-4 py-3 text-sm">${typeLabel}</td>
                <td class="px-4 py-3 text-sm text-surface-500 dark:text-surface-400">${sizeStr}</td>
                <td class="px-4 py-3 text-sm text-surface-500 dark:text-surface-400">${escapeHtml(f.updated_at)}</td>`;
            tbody.appendChild(tr);
        });

        // Pagination
        const totalPages = Math.ceil(total / memoryPageSize);
        const pagEl = document.getElementById('memory-pagination');
        if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
        let pagHtml = `<span>${page} / ${totalPages}</span><div class="flex gap-2">`;
        if (page > 1) pagHtml += `<button onclick="loadMemoryView(${page - 1})" class="px-3 py-1 rounded-lg border border-surface-200 dark:border-white/10 hover:bg-surface-100 dark:hover:bg-white/10 text-xs">Prev</button>`;
        if (page < totalPages) pagHtml += `<button onclick="loadMemoryView(${page + 1})" class="px-3 py-1 rounded-lg border border-surface-200 dark:border-white/10 hover:bg-surface-100 dark:hover:bg-white/10 text-xs">Next</button>`;
        pagHtml += '</div>';
        pagEl.innerHTML = pagHtml;
    }).catch(() => {});
}

