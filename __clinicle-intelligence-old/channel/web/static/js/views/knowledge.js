/* Knowledge base tree, import and relation graph.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Knowledge View
// =====================================================================
let _knowledgeTreeData = [];
let _knowledgeRootFiles = [];
let _knowledgeCurrentFile = null;
let _knowledgeGraphLoaded = false;
// Which tab is selected, and whether the base has anything to show in it.
// Both panels stay hidden behind the empty state until the list says there
// are pages; starts false so the first load shows only the loading text.
let _knowledgeTab = 'docs';
let _knowledgeHasPages = false;
const KNOWLEDGE_IMPORT_MAX_FILES = 100;
const KNOWLEDGE_IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const KNOWLEDGE_IMPORT_MAX_TOTAL_SIZE = 200 * 1024 * 1024;

// Which Agent's knowledge base the page is viewing. Persisted like the memory
// page's selector so a refresh keeps the last choice. An Agent on "shared" mode
// resolves to the shared base on the backend, so this simply scopes the view.
let knowledgeAgentId = localStorage.getItem('cow_knowledge_agent') || '';

function viewingKnowledgeAgentId() {
    return knowledgeAgentId || activeAgentId || defaultAgentId;
}

// Append the viewed Agent to a knowledge URL. The global fetch wrapper only
// injects activeAgentId when no agent_id is present, so an explicit one wins.
function _kbUrl(path) {
    const joiner = path.includes('?') ? '&' : '?';
    return `${path}${joiner}agent_id=${encodeURIComponent(viewingKnowledgeAgentId())}`;
}

function renderKnowledgeAgentSelect() {
    const el = document.getElementById('knowledge-agent-select');
    if (!el) return;
    const current = viewingKnowledgeAgentId();
    const list = agentCatalog.length ? agentCatalog : enabledAgents();
    const options = list.map(a => ({ value: a.id, label: a.name || a.id, agent: a }));
    initDropdown(el, options, current, (value) => selectKnowledgeAgent(value), { withAvatar: true });
}

function selectKnowledgeAgent(agentId) {
    knowledgeAgentId = agentId;
    localStorage.setItem('cow_knowledge_agent', agentId);
    loadKnowledgeView();
}

function loadKnowledgeView(targetPath) {
    _applyKnowledgeCopy();
    // Reset to docs tab
    switchKnowledgeTab('docs');
    _knowledgeGraphLoaded = false;
    _knowledgeCurrentFile = null;

    // Drop a deleted Agent selection so we never point at a ghost.
    if (knowledgeAgentId && agentCatalog.length && !agentCatalog.some(a => a.id === knowledgeAgentId)) {
        knowledgeAgentId = '';
        localStorage.removeItem('cow_knowledge_agent');
    }
    renderKnowledgeAgentSelect();

    fetch(_kbUrl('/api/knowledge/list')).then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        initKnowledgeImportDropZone();

        const emptyEl = document.getElementById('knowledge-empty');
        const statsEl = document.getElementById('knowledge-stats');

        const tree = data.tree || [];
        const rootFiles = data.root_files || [];
        _knowledgeTreeData = tree;
        _knowledgeRootFiles = rootFiles;
        const stats = data.stats || {};
        const totalPages = stats.pages || 0;

        statsEl.textContent = currentLang === 'ar'
            ? `${totalPages} مستند جاهز للبحث · على هذا الجهاز`
            : `${totalPages} document${totalPages === 1 ? '' : 's'} ready to search · on this device`;

        _knowledgeHasPages = !(totalPages === 0 && tree.length === 0 && rootFiles.length === 0);
        if (!_knowledgeHasPages) {
            emptyEl.querySelector('p').textContent = t('knowledge_empty_hint');
            const guideEl = document.getElementById('knowledge-empty-guide');
            if (guideEl) guideEl.classList.remove('hidden');
        }
        // Reveal the panel for the tab that is selected *now*, not the docs
        // tab: a link to /knowledge/graph switches tabs while this request is
        // still in flight, and unhiding docs here stacked both panels.
        _applyKnowledgePanels();
        if (!_knowledgeHasPages) return;

        renderKnowledgeTree(tree, rootFiles);

        // Prefer opening the just created/imported file; ensure its group is
        // expanded so the active item is visible in the tree.
        const targetTitle = targetPath ? _findKnowledgeFileTitle(targetPath) : null;
        if (targetTitle !== null) {
            _expandKnowledgeGroupFor(targetPath);
            openKnowledgeFile(targetPath, targetTitle);
            return;
        }

        // The flat list opens nothing by default; a click opens the viewer modal.
        document.getElementById('knowledge-content-placeholder').classList.add('hidden');
        document.getElementById('knowledge-content-viewer').classList.add('hidden');
    }).catch(() => {});
}

// Find a file's display title by its relative path within the knowledge tree.
// Returns the title, or null when the path is not present.
function _findKnowledgeFileTitle(path) {
    if (!path) return null;
    const rootHit = (_knowledgeRootFiles || []).find(f => f.name === path);
    if (rootHit) return rootHit.title || rootHit.name;
    const walk = (groups, parentPath) => {
        for (const group of groups || []) {
            const groupPath = parentPath ? `${parentPath}/${group.dir}` : group.dir;
            const hit = (group.files || []).find(f => `${groupPath}/${f.name}` === path);
            if (hit) return hit.title || hit.name;
            const childHit = walk(group.children, groupPath);
            if (childHit !== null) return childHit;
        }
        return null;
    };
    return walk(_knowledgeTreeData, '');
}

// Open every ancestor group of the given file path so it is visible.
function _expandKnowledgeGroupFor(path) {
    if (!path || !path.includes('/')) return;
    const target = document.querySelector(`.knowledge-tree-file[data-path="${CSS.escape(path)}"]`);
    let node = target ? target.closest('.knowledge-tree-group') : null;
    while (node) {
        node.classList.add('open');
        node = node.parentElement ? node.parentElement.closest('.knowledge-tree-group') : null;
    }
}

function renderKnowledgeTree(tree, rootFilesOrFilter, filter) {
    const container = document.getElementById('knowledge-tree');
    container.innerHTML = '';
    let rootFiles, lowerFilter;
    if (typeof rootFilesOrFilter === 'string') {
        rootFiles = _knowledgeRootFiles;
        lowerFilter = (rootFilesOrFilter || '').toLowerCase();
    } else {
        rootFiles = rootFilesOrFilter || _knowledgeRootFiles;
        lowerFilter = (filter || '').toLowerCase();
    }
    (rootFiles || []).forEach(f => {
        if (lowerFilter && !f.title.toLowerCase().includes(lowerFilter) && !f.name.toLowerCase().includes(lowerFilter)) return;
        const fbtn = document.createElement('button');
        fbtn.className = 'knowledge-tree-file' + (_knowledgeCurrentFile === f.name ? ' active' : '');
        fbtn.dataset.path = f.name;
        fbtn.innerHTML = `<i class="fas fa-file-lines text-[10px] text-surface-400"></i><span class="truncate">${escapeHtml(f.title)}</span>${_knowledgeFileActions(f.name)}`;
        fbtn.onclick = () => openKnowledgeFile(f.name, f.title);
        container.appendChild(fbtn);
    });
    _renderKnowledgeGroups(container, tree, '', lowerFilter, 0);
}

function _renderKnowledgeGroups(container, groups, parentPath, lowerFilter, depth) {
    const indent = depth * 12;
    groups.forEach(group => {
        const groupPath = parentPath ? parentPath + '/' + group.dir : group.dir;
        const files = (group.files || []).filter(f =>
            !lowerFilter || f.title.toLowerCase().includes(lowerFilter) || f.name.toLowerCase().includes(lowerFilter)
        );
        const children = group.children || [];
        const hasMatchingChildren = lowerFilter ? _hasFilterMatch(children, lowerFilter) : children.length > 0;
        if (files.length === 0 && !hasMatchingChildren && lowerFilter) return;

        const div = document.createElement('div');
        div.className = 'knowledge-tree-group open';

        const fileCount = _countFiles(group);
        const btn = document.createElement('button');
        btn.className = 'knowledge-tree-group-btn';
        btn.style.paddingLeft = (8 + indent) + 'px';
        btn.innerHTML = `<i class="fas fa-chevron-right chevron"></i><i class="fas fa-folder text-amber-400 text-[11px]"></i><span>${escapeHtml(group.dir)}</span><span class="ml-auto text-[10px] text-surface-400">${fileCount}</span>${_knowledgeCategoryActions(groupPath)}`;
        btn.onclick = () => div.classList.toggle('open');
        div.appendChild(btn);

        const items = document.createElement('div');
        items.className = 'knowledge-tree-group-items';
        files.forEach(f => {
            const fbtn = document.createElement('button');
            const fpath = groupPath + '/' + f.name;
            fbtn.className = 'knowledge-tree-file' + (_knowledgeCurrentFile === fpath ? ' active' : '');
            fbtn.dataset.path = fpath;
            fbtn.style.paddingLeft = (24 + indent) + 'px';
            fbtn.innerHTML = `<i class="fas fa-file-lines text-[10px] text-surface-400"></i><span class="truncate">${escapeHtml(f.title)}</span>${_knowledgeFileActions(fpath)}`;
            fbtn.onclick = () => openKnowledgeFile(fpath, f.title);
            items.appendChild(fbtn);
        });
        if (children.length > 0) {
            _renderKnowledgeGroups(items, children, groupPath, lowerFilter, depth + 1);
        }
        div.appendChild(items);
        container.appendChild(div);
    });
}

function _knowledgeActionButton(icon, title, handler) {
    const danger = icon === 'fa-trash' ? ' danger' : '';
    return `<span role="button" tabindex="0" title="${escapeHtml(title)}" onclick="event.stopPropagation();${handler}" class="knowledge-action${danger}"><i class="fas ${icon}"></i></span>`;
}

function _knowledgeFileActions(path) {
    if (path === 'index.md' || path === 'log.md') return '';
    const value = JSON.stringify(path).replace(/"/g, '&quot;');
    const moveLabel = currentLang === 'ar' ? 'نقل' : 'Move';
    const deleteLabel = currentLang === 'ar' ? 'حذف' : 'Delete';
    return `<span class="knowledge-actions">${_knowledgeActionButton('fa-arrow-right-arrow-left', moveLabel, `moveKnowledgeDocument(${value})`)}${_knowledgeActionButton('fa-trash', deleteLabel, `deleteKnowledgeDocument(${value})`)}</span>`;
}

function _knowledgeCategoryActions(path) {
    const value = JSON.stringify(path).replace(/"/g, '&quot;');
    const renameLabel = currentLang === 'ar' ? 'إعادة تسمية' : 'Rename';
    const deleteLabel = currentLang === 'ar' ? 'حذف' : 'Delete';
    return `<span class="knowledge-actions">${_knowledgeActionButton('fa-pen', renameLabel, `renameKnowledgeCategory(${value})`)}${_knowledgeActionButton('fa-trash', deleteLabel, `deleteKnowledgeCategory(${value})`)}</span>`;
}

async function dispatchKnowledgeAction(action, payload, openPathResolver) {
    _setKnowledgeStatus(currentLang === 'ar' ? 'جارٍ المعالجة...' : 'Working...', false, true);
    try {
        const response = await fetch('/api/knowledge/action', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action, payload, agent_id: viewingKnowledgeAgentId()}),
        });
        const result = await response.json();
        if (result.status !== 'success') {
            _setKnowledgeStatus(result.message || (currentLang === 'ar' ? 'فشلت العملية' : 'Operation failed'), true);
            loadKnowledgeView();
            return null;
        }
        _setKnowledgeStatus(_knowledgeResultMessage(action, result.payload), false);
        // Optionally auto-open the affected file after the tree refreshes.
        const openPath = openPathResolver ? openPathResolver(result.payload) : null;
        loadKnowledgeView(openPath || undefined);
        return result.payload;
    } catch (error) {
        _setKnowledgeStatus(currentLang === 'ar' ? 'فشل الطلب، يرجى المحاولة مرة أخرى لاحقاً' : 'Request failed, please try again', true);
        return null;
    }
}

function _setKnowledgeStatus(message, isError, persistent) {
    const el = document.getElementById('knowledge-action-status');
    el.textContent = message;
    el.className = `text-xs transition-opacity duration-200 ${isError ? 'text-red-500' : 'text-primary-500'}`;
    el.classList.remove('opacity-0');
    clearTimeout(el._hideTimer);
    if (!persistent) el._hideTimer = setTimeout(() => el.classList.add('opacity-0'), 3500);
}

function _knowledgeResultMessage(action, payload) {
    if (currentLang !== 'ar') {
        return action === 'create_category' ? 'Category created' :
            action === 'create_document' ? 'Document created' :
            action === 'rename_category' ? 'Category renamed' :
            action === 'delete_category' ? 'Category deleted' :
            action === 'import_documents' ? `${payload?.imported || 0} imported · ${payload?.skipped || 0} skipped · ${payload?.failed || 0} failed` :
            action === 'move_documents' ? `${payload?.moved || 0} document moved` :
            `${payload?.deleted || 0} document deleted`;
    }
    return action === 'create_category' ? 'تم إنشاء الفئة' :
        action === 'create_document' ? 'تم إنشاء المستند' :
        action === 'rename_category' ? 'تمت إعادة تسمية الفئة' :
        action === 'delete_category' ? 'تم حذف الفئة' :
        action === 'import_documents' ? `تم استيراد ${payload?.imported || 0} · تخطي ${payload?.skipped || 0} · فشل ${payload?.failed || 0}` :
        action === 'move_documents' ? `تم نقل ${payload?.moved || 0} مستند` :
        `تم حذف ${payload?.deleted || 0} مستند`;
}

function _knowledgeCategoryPaths(groups, parent = '') {
    const paths = [];
    for (const group of groups || []) {
        const path = parent ? `${parent}/${group.dir}` : group.dir;
        paths.push(path, ..._knowledgeCategoryPaths(group.children || [], path));
    }
    return paths;
}

function openKnowledgeDialog(options) {
    const overlay = document.getElementById('knowledge-dialog-overlay');
    const card = document.getElementById('knowledge-dialog-card');
    const input = document.getElementById('knowledge-dialog-input');
    const select = document.getElementById('knowledge-dialog-select');
    const textarea = document.getElementById('knowledge-dialog-textarea');
    const documentForm = document.getElementById('knowledge-document-form');
    const documentFilename = document.getElementById('knowledge-document-filename');
    const documentContent = document.getElementById('knowledge-document-content');
    const templateBtn = document.getElementById('knowledge-document-template');
    const documentPathPreview = document.getElementById('knowledge-document-path-preview');
    const submit = document.getElementById('knowledge-dialog-submit');
    const cancel = document.getElementById('knowledge-dialog-cancel');
    document.getElementById('knowledge-dialog-title').textContent = options.title;
    document.getElementById('knowledge-dialog-subtitle').textContent = options.subtitle || '';
    document.getElementById('knowledge-dialog-label').textContent = options.label;
    document.getElementById('knowledge-dialog-hint').textContent = options.hint || '';
    document.getElementById('knowledge-dialog-error').classList.add('hidden');
    document.getElementById('knowledge-dialog-icon').className = `fas ${options.icon || 'fa-folder'} text-accent-500`;
    card.classList.toggle('knowledge-document-dialog', options.type === 'document');
    input.classList.toggle('hidden', options.type === 'select' || options.type === 'textarea' || options.type === 'document');
    select.classList.toggle('hidden', options.type !== 'select');
    textarea.classList.toggle('hidden', options.type !== 'textarea');
    documentForm.classList.toggle('hidden', options.type !== 'document');
    input.value = options.value || '';
    textarea.value = options.value || '';
    documentFilename.value = options.filename || '';
    documentContent.value = options.content || '';
    document.getElementById('knowledge-document-category-label').textContent = currentLang === 'ar' ? 'الفئة الهدف' : 'Destination category';
    documentPathPreview.textContent = options.category
        ? `knowledge/${options.category}/`
        : 'knowledge/';
    documentFilename.oninput = null;
    document.getElementById('knowledge-document-filename-label').textContent = currentLang === 'ar' ? 'اسم الملف' : 'Filename';
    document.getElementById('knowledge-document-content-label').textContent = currentLang === 'ar' ? 'محتوى Markdown' : 'Markdown content';
    templateBtn.textContent = currentLang === 'ar' ? 'إدراج قالب' : 'Insert template';
    templateBtn.onclick = () => {
        if (documentContent.value.trim()) return;
        const title = (documentFilename.value || 'untitled').replace(/\.md$/i, '');
        documentContent.value = currentLang === 'ar'
            ? `# ${title}\n\n## ملخص\n\n\n## النقاط الرئيسية\n\n- \n\n## المراجع\n\n`
            : `# ${title}\n\n## Summary\n\n\n## Key points\n\n- \n\n## References\n\n`;
        documentContent.focus();
    };
    if (options.type === 'select') {
        // Use the shared custom dropdown component instead of a native
        // <select> so the arrow / menu match the rest of the console.
        const ddOptions = (options.choices || []).map(value => ({ value, label: value }));
        initDropdown(select, ddOptions, (options.choices || [])[0] || '', null);
    }
    submit.textContent = currentLang === 'ar' ? 'تأكيد' : 'Confirm';
    cancel.textContent = currentLang === 'ar' ? 'إلغاء' : 'Cancel';
    submit.disabled = options.type === 'select' && !(options.choices || []).length;

    const close = () => overlay.classList.add('hidden');
    const submitAction = async () => {
        const rawValue = options.type === 'select' ? getDropdownValue(select) :
            (options.type === 'textarea' ? textarea.value :
            (options.type === 'document' ? {
                filename: documentFilename.value.trim(),
                content: documentContent.value,
            } : input.value));
        const value = options.type === 'textarea' || options.type === 'document' ? rawValue : rawValue.trim();
        const error = options.validate ? options.validate(value) : (!value ? (currentLang === 'ar' ? 'هذا الحقل مطلوب' : 'This field is required') : '');
        if (error) {
            const errorEl = document.getElementById('knowledge-dialog-error');
            errorEl.textContent = error;
            errorEl.classList.remove('hidden');
            return;
        }
        submit.disabled = true;
        const ok = await options.onSubmit(value);
        submit.disabled = false;
        if (ok !== null) close();
    };
    submit.onclick = submitAction;
    cancel.onclick = close;
    overlay.onclick = event => { if (event.target === overlay) close(); };
    input.onkeydown = event => { if (event.key === 'Enter') submitAction(); };
    overlay.classList.remove('hidden');
    setTimeout(() => (options.type === 'select' ? select : (options.type === 'textarea' ? textarea : (options.type === 'document' ? documentFilename : input))).focus(), 0);
}

function closeKnowledgeNewMenu() {
    const list = document.getElementById('knowledge-new-menu-list');
    if (list) list.classList.add('hidden');
    document.removeEventListener('click', _knowledgeNewMenuOutside, true);
}

function _knowledgeNewMenuOutside(event) {
    const menu = document.getElementById('knowledge-new-menu');
    if (menu && !menu.contains(event.target)) closeKnowledgeNewMenu();
}

function toggleKnowledgeNewMenu(event) {
    if (event) event.stopPropagation();
    const list = document.getElementById('knowledge-new-menu-list');
    if (!list) return;
    const willOpen = list.classList.contains('hidden');
    list.classList.toggle('hidden');
    if (willOpen) {
        document.addEventListener('click', _knowledgeNewMenuOutside, true);
    } else {
        document.removeEventListener('click', _knowledgeNewMenuOutside, true);
    }
}

function createKnowledgeCategory() {
    openKnowledgeDialog({
        title: currentLang === 'ar' ? 'فئة جديدة' : 'New category',
        subtitle: currentLang === 'ar' ? 'سيتم إنشاء الفئة كمجلد ضمن knowledge/' : 'Creates a directory under knowledge/',
        label: currentLang === 'ar' ? 'مسار الفئة' : 'Category path',
        hint: currentLang === 'ar' ? 'يدعم المسارات المتداخلة، مثل research/ai' : 'Nested paths are supported, e.g. research/ai',
        icon: 'fa-folder-plus',
        onSubmit: path => dispatchKnowledgeAction('create_category', {path}),
    });
}

function createKnowledgeDocument() {
    const categories = _knowledgeCategoryPaths(_knowledgeTreeData);
    if (!categories.length) {
        _setKnowledgeStatus(currentLang === 'ar' ? 'يرجى إنشاء فئة أولاً' : 'Create a category first', true);
        return;
    }
    openKnowledgeDialog({
        title: currentLang === 'ar' ? 'مستند جديد' : 'New document',
        subtitle: currentLang === 'ar' ? 'اختر الفئة أولاً، ثم أدخل اسم الملف' : 'Choose a category, then enter a filename',
        label: currentLang === 'ar' ? 'الفئة الهدف' : 'Destination category',
        type: 'select',
        choices: categories,
        icon: 'fa-file-circle-plus',
        onSubmit: category => {
            openKnowledgeDocumentEditor(category);
            return null;
        },
    });
}

function openKnowledgeDocumentEditor(category) {
    openKnowledgeDialog({
        title: currentLang === 'ar' ? 'مستند جديد' : 'New document',
        subtitle: currentLang === 'ar' ? `الحفظ في ${category}` : `Save to ${category}`,
        label: '',
        hint: currentLang === 'ar' ? 'يمكن حذف لاحقة .md؛ ستتم مزامنة الفهرس تلقائياً بعد الحفظ.' : 'The .md suffix is optional. Index sync runs after saving.',
        type: 'document',
        category,
        filename: '',
        content: '',
        icon: 'fa-file-circle-plus',
        validate: value => {
            if (!value.filename) return currentLang === 'ar' ? 'اسم الملف مطلوب' : 'Filename is required';
            if (/\.[^.]+$/i.test(value.filename) && !/\.md$/i.test(value.filename)) {
                return currentLang === 'ar' ? 'يجب أن تكون المستندات الجديدة بصيغة .md فقط' : 'New documents must be .md files';
            }
            if (!value.content.trim()) return currentLang === 'ar' ? 'المحتوى مطلوب' : 'Content is required';
            if (new Blob([value.content]).size > KNOWLEDGE_IMPORT_MAX_FILE_SIZE) {
                return currentLang === 'ar' ? 'يجب ألا يتجاوز المحتوى 10 ميغابايت' : 'Content cannot exceed 10MB';
            }
            return '';
        },
        onSubmit: value => {
            const safeName = value.filename.endsWith('.md') ? value.filename : `${value.filename}.md`;
            return dispatchKnowledgeAction('create_document', {
                path: `${category}/${safeName}`,
                content: value.content,
                overwrite: false,
            }, payload => payload?.path || `${category}/${safeName}`);
        },
    });
}

function selectKnowledgeImportFiles() {
    const input = document.getElementById('knowledge-import-input');
    input.value = '';
    input.onchange = () => {
        if (input.files && input.files.length) openKnowledgeImportDialog(Array.from(input.files));
    };
    input.click();
}

function openKnowledgeImportDialog(files) {
    const validationError = validateKnowledgeImportFiles(files);
    if (validationError) {
        _setKnowledgeStatus(validationError, true);
        return;
    }
    const choices = _knowledgeCategoryPaths(_knowledgeTreeData);
    openKnowledgeDialog({
        title: currentLang === 'ar' ? 'استيراد مستندات' : 'Import documents',
        subtitle: currentLang === 'ar' ? `تم اختيار ${files.length} ملف(ات)` : `${files.length} file(s) selected`,
        label: currentLang === 'ar' ? 'الفئة الهدف' : 'Destination category',
        hint: choices.length ? (currentLang === 'ar' ? 'يدعم Markdown و TXT. سيتم تحويل TXT إلى مستند Markdown.' : 'Markdown and TXT are supported. TXT is converted to Markdown.') :
            (currentLang === 'ar' ? 'يرجى إنشاء فئة أولاً' : 'Create a category first'),
        type: 'select',
        choices,
        icon: 'fa-file-arrow-up',
        onSubmit: target => importKnowledgeDocuments(files, target),
    });
}

async function importKnowledgeDocuments(files, targetCategory) {
    const validationError = validateKnowledgeImportFiles(files);
    if (validationError) {
        _setKnowledgeStatus(validationError, true);
        return null;
    }
    const supported = files.filter(file => /\.(md|txt)$/i.test(file.name || ''));
    if (!supported.length) {
        _setKnowledgeStatus(currentLang === 'ar' ? 'يرجى اختيار ملفات .md أو .txt' : 'Choose .md or .txt files', true);
        return null;
    }
    const formData = new FormData();
    formData.append('target_category', targetCategory);
    formData.append('conflict_strategy', 'rename');
    supported.forEach(file => formData.append('files', file, file.name));
    _setKnowledgeStatus(currentLang === 'ar' ? 'جارٍ الاستيراد...' : 'Importing...', false, true);
    try {
        const response = await fetch(_kbUrl('/api/knowledge/import'), { method: 'POST', body: formData });
        const result = await response.json();
        if (result.status !== 'success') {
            _setKnowledgeStatus(result.message || (currentLang === 'ar' ? 'فشل الاستيراد' : 'Import failed'), true);
            loadKnowledgeView();
            return null;
        }
        _setKnowledgeStatus(_knowledgeResultMessage('import_documents', result.payload), false);
        // Auto-open the first successfully imported document.
        const firstImported = (result.payload?.results || []).find(item => item.status === 'imported');
        loadKnowledgeView(firstImported ? firstImported.path : undefined);
        return result.payload;
    } catch (error) {
        _setKnowledgeStatus(currentLang === 'ar' ? 'فشل طلب الاستيراد' : 'Import request failed', true);
        return null;
    }
}

function validateKnowledgeImportFiles(files) {
    if (!files || !files.length) return currentLang === 'ar' ? 'يرجى اختيار الملفات' : 'Choose files';
    if (files.length > KNOWLEDGE_IMPORT_MAX_FILES) {
        return currentLang === 'ar' ? `يمكن استيراد ${KNOWLEDGE_IMPORT_MAX_FILES} ملفات كحد أقصى في المرة الواحدة` : `Import at most ${KNOWLEDGE_IMPORT_MAX_FILES} files at a time`;
    }
    let total = 0;
    for (const file of files) {
        total += file.size || 0;
        if ((file.size || 0) > KNOWLEDGE_IMPORT_MAX_FILE_SIZE) {
            return currentLang === 'ar' ? `يتجاوز ${file.name} 10 ميغابايت` : `${file.name} exceeds 10MB`;
        }
    }
    if (total > KNOWLEDGE_IMPORT_MAX_TOTAL_SIZE) {
        return currentLang === 'ar' ? 'يجب ألا يتجاوز إجمالي حجم الاستيراد 200 ميغابايت' : 'Total import size cannot exceed 200MB';
    }
    return '';
}

let _knowledgeImportDropReady = false;
function initKnowledgeImportDropZone() {
    if (_knowledgeImportDropReady) return;
    const panel = document.getElementById('knowledge-panel-docs');
    if (!panel) return;
    _knowledgeImportDropReady = true;
    ['dragenter', 'dragover'].forEach(name => {
        panel.addEventListener(name, event => {
            if (!event.dataTransfer || !event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            panel.classList.add('knowledge-import-drag-over');
        });
    });
    ['dragleave', 'drop'].forEach(name => {
        panel.addEventListener(name, event => {
            if (event.type === 'drop') {
                event.preventDefault();
                const files = Array.from(event.dataTransfer?.files || []);
                if (files.length) openKnowledgeImportDialog(files);
            }
            panel.classList.remove('knowledge-import-drag-over');
        });
    });
}

function renameKnowledgeCategory(path) {
    openKnowledgeDialog({
        title: currentLang === 'ar' ? 'إعادة تسمية الفئة' : 'Rename category',
        subtitle: path,
        label: currentLang === 'ar' ? 'مسار الفئة الجديد' : 'New category path',
        value: path,
        icon: 'fa-pen',
        validate: value => value === path ? (currentLang === 'ar' ? 'يرجى إدخال مسار فئة مختلف' : 'Enter a different category path') : '',
        onSubmit: newPath => dispatchKnowledgeAction('rename_category', {path, new_path: newPath}),
    });
}

function deleteKnowledgeCategory(path) {
    showConfirmDialog({
        title: currentLang === 'ar' ? 'حذف الفئة' : 'Delete category',
        message: currentLang === 'ar' ? `تأكيد حذف "${path}" وجميع المستندات بداخلها؟` : `Confirm deleting "${path}" and all documents inside it?`,
        okText: t('confirm_yes'),
        cancelText: t('confirm_cancel'),
        onConfirm: () => dispatchKnowledgeAction('delete_category', {path, confirm: true}),
    });
}

function deleteKnowledgeDocument(path) {
    showConfirmDialog({
        title: currentLang === 'ar' ? 'حذف المستند' : 'Delete document',
        message: currentLang === 'ar' ? `تأكيد حذف "${path}"؟` : `Confirm deleting "${path}"?`,
        okText: t('confirm_yes'),
        cancelText: t('confirm_cancel'),
        onConfirm: () => dispatchKnowledgeAction('delete_documents', {paths: [path]}),
    });
}

function moveKnowledgeDocument(path) {
    const currentCategory = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
    const choices = _knowledgeCategoryPaths(_knowledgeTreeData).filter(value => value !== currentCategory);
    openKnowledgeDialog({
        title: currentLang === 'ar' ? 'نقل المستند' : 'Move document',
        subtitle: path,
        label: currentLang === 'ar' ? 'الفئة الهدف' : 'Destination category',
        hint: choices.length ? '' : (currentLang === 'ar' ? 'يرجى إنشاء فئة أخرى أولاً' : 'Create another category first'),
        type: 'select',
        choices,
        icon: 'fa-arrow-right-arrow-left',
        onSubmit: target => dispatchKnowledgeAction('move_documents', {paths: [path], target_category: target}),
    });
}

function _hasFilterMatch(groups, lowerFilter) {
    for (const g of groups) {
        for (const f of (g.files || [])) {
            if (f.title.toLowerCase().includes(lowerFilter) || f.name.toLowerCase().includes(lowerFilter)) return true;
        }
        if (_hasFilterMatch(g.children || [], lowerFilter)) return true;
    }
    return false;
}

function _countFiles(group) {
    let count = (group.files || []).length;
    for (const child of (group.children || [])) {
        count += _countFiles(child);
    }
    return count;
}

function filterKnowledgeTree(query) {
    renderKnowledgeTree(_knowledgeTreeData, _knowledgeRootFiles, query);
}

function resolveKnowledgePath(currentFilePath, relativeHref) {
    // currentFilePath: e.g. "concepts/mcp-protocol.md"
    // relativeHref: e.g. "../entities/openai.md"
    const parts = currentFilePath.split('/');
    parts.pop(); // remove filename, keep directory
    const segments = [...parts, ...relativeHref.split('/')];
    const resolved = [];
    for (const seg of segments) {
        if (seg === '..') resolved.pop();
        else if (seg !== '.' && seg !== '') resolved.push(seg);
    }
    return resolved.join('/');
}

function bindKnowledgeLinks(container, currentFilePath) {
    container.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href');
        if (!href || !href.endsWith('.md')) return;
        // Skip absolute URLs
        if (/^https?:\/\//.test(href)) return;

        a.addEventListener('click', (e) => {
            e.preventDefault();
            const resolved = resolveKnowledgePath(currentFilePath, href);
            const linkTitle = a.textContent.trim() || resolved.replace(/\.md$/, '').split('/').pop();
            openKnowledgeFile(resolved, linkTitle);
        });
        a.style.cursor = 'pointer';
        a.classList.add('text-primary-500', 'hover:underline');
    });
}

// Rewrite <img> srcs that are relative to the knowledge doc's directory into
// /api/file URLs, mirroring bindKnowledgeLinks for links. Runs on rendered
// DOM, so markdown syntax quoted inside code blocks is never touched. The
// lightbox onclick that renderMarkdown attached reads this.src at click time,
// so rewriting src alone keeps zoom working.
function bindKnowledgeImages(container, baseDir) {
    if (!baseDir) return;
    container.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src');
        // Remote / data / site-absolute srcs resolve on their own.
        if (!src || /^(?:[a-z][\w+.-]*:|\/)/i.test(src)) return;
        const combined = `${baseDir}/${src.split('?')[0]}`;
        const segments = [];
        for (const seg of combined.split('/')) {
            if (seg === '..') segments.pop();
            else if (seg !== '.' && seg !== '') segments.push(seg);
        }
        // baseDir is an absolute posix path, so restore the leading slash the
        // split() dropped — /api/file rejects non-absolute paths.
        const resolved = (combined.startsWith('/') ? '/' : '') + segments.join('/');
        img.src = '/api/file?path=' + encodeURIComponent(resolved);
    });
}

// A chat citation pill (render.js: linkifyKnowledgeCitations) lands here.
// memory_search's `Source: <path>` is relative to the workspace root, so it
// carries a leading "knowledge/" segment; every other path in this file
// (tree data, /api/knowledge/read) is relative to the knowledge dir itself
// and has no such prefix — strip it before reusing the normal open flow.
function openKnowledgeCitation(path) {
    const kbPath = path.replace(/^knowledge\//, '');
    navigateTo('knowledge');
    loadKnowledgeView(kbPath);
}

function openKnowledgeFile(path, title) {
    _knowledgeCurrentFile = path;
    // Update active state in tree via data-path
    document.querySelectorAll('.knowledge-tree-file').forEach(el => {
        el.classList.toggle('active', el.dataset.path === path);
    });

    // Immediately hide placeholder
    document.getElementById('knowledge-content-placeholder').classList.add('hidden');

    fetch(_kbUrl(`/api/knowledge/read?path=${encodeURIComponent(path)}`)).then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const viewer = document.getElementById('knowledge-content-viewer');
        document.getElementById('knowledge-viewer-title').textContent = title;
        document.getElementById('knowledge-viewer-path').textContent = path;
        const bodyEl = document.getElementById('knowledge-viewer-body');
        bodyEl.innerHTML = renderMarkdown(data.content || '');
        viewer.classList.remove('hidden');
        applyHighlighting(viewer);
        bindKnowledgeLinks(bodyEl, path);
        bindKnowledgeImages(bodyEl, data.dir);

        // Mobile: hide sidebar, show content
        if (window.innerWidth < 768) {
            document.getElementById('knowledge-sidebar').classList.add('hidden');
        }
    }).catch(() => {});
}

function knowledgeMobileBack() {
    document.getElementById('knowledge-sidebar').classList.remove('hidden');
    document.getElementById('knowledge-content-viewer').classList.add('hidden');
}

function switchKnowledgeTab(tab) {
    document.querySelectorAll('.knowledge-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('knowledge-tab-' + tab).classList.add('active');
    _knowledgeTab = tab;
    _applyKnowledgePanels();
    routeNoteTab('knowledge', tab);
}

// The one place the empty state and the two tab panels are shown or hidden.
// With no pages the empty state stands alone and both panels stay hidden
// whichever tab is selected; the tab switcher used to unhide its panel
// regardless, which put the search box and an empty tree under the "no pages
// yet" guide. The graph is fetched the first time its panel is actually shown.
function _applyKnowledgePanels() {
    const emptyEl = document.getElementById('knowledge-empty');
    const docsPanel = document.getElementById('knowledge-panel-docs');
    const graphPanel = document.getElementById('knowledge-panel-graph');
    const utilityRow = document.getElementById('knowledge-utility-row');
    const showDocs = _knowledgeHasPages && _knowledgeTab === 'docs';
    const showGraph = _knowledgeHasPages && _knowledgeTab === 'graph';

    emptyEl.classList.toggle('hidden', _knowledgeHasPages);
    if (utilityRow) utilityRow.classList.toggle('hidden', !_knowledgeHasPages);
    docsPanel.classList.toggle('hidden', !showDocs);
    graphPanel.classList.toggle('hidden', !showGraph);
    if (showGraph && !_knowledgeGraphLoaded) loadKnowledgeGraph();
}

// New header copy (product tagline, button labels, drop-zone strings) isn't
// backed by i18n.js keys yet, so it mirrors this file's existing
// currentLang-ternary pattern (see _knowledgeResultMessage) instead of
// data-i18n. Re-applied on every view load / agent switch to stay in sync
// with the active language.
function _applyKnowledgeCopy() {
    const ar = currentLang === 'ar';
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('knowledge-tagline', ar
        ? 'مستندات خاصة يجيب منها Clinicle Intelligence — مع الاستشهادات، بالكامل على جهازك، بالعربية أو الإنجليزية.'
        : 'Private documents Clinicle Intelligence answers from — with citations, fully on-device, in Arabic or English.');
    set('knowledge-clear-label', ar ? 'مسح' : 'Clear');
    set('knowledge-add-label', ar ? 'إضافة مستندات' : 'Add documents');
    set('knowledge-dropzone-title', ar ? 'أفلت الملفات لإضافتها' : 'Drop files to add them');
    set('knowledge-dropzone-hint', ar
        ? 'أو انقر للتصفح · ملفات Markdown ونصية، بالعربية أو الإنجليزية'
        : 'or click to browse · Markdown & text files, Arabic or English');
}

// Every document path currently listed, root files and nested groups alike,
// excluding the protected index/log pages the per-row delete button also
// hides (see _knowledgeFileActions).
function _knowledgeAllDocumentPaths() {
    const paths = [];
    (_knowledgeRootFiles || []).forEach(f => paths.push(f.name));
    const walk = (groups, parent) => {
        (groups || []).forEach(group => {
            const groupPath = parent ? `${parent}/${group.dir}` : group.dir;
            (group.files || []).forEach(f => paths.push(`${groupPath}/${f.name}`));
            walk(group.children, groupPath);
        });
    };
    walk(_knowledgeTreeData, '');
    return paths.filter(p => p !== 'index.md' && p !== 'log.md');
}

function clearAllKnowledgeDocuments() {
    const paths = _knowledgeAllDocumentPaths();
    if (!paths.length) return;
    showConfirmDialog({
        title: currentLang === 'ar' ? 'مسح جميع المستندات' : 'Clear all documents',
        message: currentLang === 'ar'
            ? `تأكيد حذف ${paths.length} مستند من قاعدة المعرفة؟`
            : `Delete all ${paths.length} document${paths.length === 1 ? '' : 's'} from the knowledge base?`,
        okText: t('confirm_yes'),
        cancelText: t('confirm_cancel'),
        onConfirm: () => dispatchKnowledgeAction('delete_documents', {paths}),
    });
}

let _d3LoadPromise = null;

function ensureD3Loaded() {
    if (window.d3) return Promise.resolve(window.d3);
    if (_d3LoadPromise) return _d3LoadPromise;
    _d3LoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/assets/vendor/d3/d3.min.js';
        script.async = true;
        script.onload = () => resolve(window.d3);
        script.onerror = () => reject(new Error('Failed to load d3'));
        document.head.appendChild(script);
    });
    return _d3LoadPromise;
}

function loadKnowledgeGraph() {
    _knowledgeGraphLoaded = true;
    const container = document.getElementById('knowledge-graph-container');
    container.innerHTML = '<div class="flex items-center justify-center h-full text-surface-400 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Loading graph...</div>';

    Promise.all([
        ensureD3Loaded(),
        fetch(_kbUrl('/api/knowledge/graph')).then(r => r.json()),
    ]).then(([, data]) => {
        const nodes = data.nodes || [];
        const links = data.links || [];
        if (nodes.length === 0) {
            container.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-surface-400"><i class="fas fa-diagram-project text-3xl mb-3 opacity-40"></i><p class="text-sm">${t('knowledge_empty_hint')}</p></div>`;
            return;
        }
        container.innerHTML = '';
        renderKnowledgeGraph(container, nodes, links);
    }).catch(() => {
        container.innerHTML = '<div class="flex items-center justify-center h-full text-surface-400 text-sm">Failed to load graph</div>';
    });
}

function renderKnowledgeGraph(container, nodes, links) {
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    // Order categories by node count so the dominant cluster gets the most
    // salient palette entry. Ties break by name to keep colors stable.
    const catCount = {};
    nodes.forEach(n => { catCount[n.category] = (catCount[n.category] || 0) + 1; });
    const categories = Object.keys(catCount).sort(
        (a, b) => catCount[b] - catCount[a] || a.localeCompare(b)
    );
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(categories);

    // Connection count for sizing
    const connCount = {};
    nodes.forEach(n => connCount[n.id] = 0);
    links.forEach(l => {
        connCount[l.source] = (connCount[l.source] || 0) + 1;
        connCount[l.target] = (connCount[l.target] || 0) + 1;
    });

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g');

    // Zoom with adaptive label visibility
    let currentZoomScale = 1;
    // Set once the graph is fitted to the viewport. Labels hide below it, so
    // zooming out past the default view still declutters.
    let fittedScale = 1;
    const zoom = d3.zoom()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
            currentZoomScale = event.transform.k;
            updateLabelVisibility();
        });
    svg.call(zoom);

    function updateLabelVisibility() {
        if (!label) return;
        // Fitting a graph of any size into the panel lands well below scale 1,
        // so a fixed threshold would hide every label in the default view.
        // Compare against the fitted scale instead, and keep the text a
        // constant size on screen — inside the zoomed <g>, that means dividing
        // by the scale.
        if (currentZoomScale < fittedScale * 0.9) {
            label.attr('opacity', 0);
            return;
        }
        label.attr('opacity', 1)
            .attr('font-size', 10 / currentZoomScale)
            .attr('dx', d => getNodeRadius(d) + 4 / currentZoomScale)
            .attr('dy', 3 / currentZoomScale);
    }

    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(90))
        .force('charge', d3.forceManyBody().strength(-180))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('x', d3.forceX(width / 2).strength(0.06))
        .force('y', d3.forceY(height / 2).strength(0.06))
        .force('collision', d3.forceCollide().radius(d => getNodeRadius(d) + 30));

    function getNodeRadius(d) {
        return Math.max(5, Math.min(16, 5 + (connCount[d.id] || 0) * 2));
    }

    const link = g.append('g')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke', '#7F9FB8')
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);

    const node = g.append('g')
        .selectAll('circle')
        .data(nodes)
        .join('circle')
        .attr('r', d => getNodeRadius(d))
        .attr('fill', d => colorScale(d.category))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer')
        .call(d3.drag()
            .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
            .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
        );

    const label = g.append('g')
        .selectAll('text')
        .data(nodes)
        .join('text')
        .text(d => d.label.length > 15 ? d.label.slice(0, 14) + '…' : d.label)
        .attr('font-size', 9)
        .attr('dx', d => getNodeRadius(d) + 4)
        .attr('dy', 3)
        .attr('fill', '#5A7C96')
        .style('pointer-events', 'none');

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'knowledge-graph-tooltip';
    container.style.position = 'relative';
    container.appendChild(tooltip);

    node.on('mouseover', (event, d) => {
        tooltip.textContent = d.label + ' (' + d.category + ')';
        tooltip.style.opacity = '1';
        tooltip.style.left = (event.offsetX + 12) + 'px';
        tooltip.style.top = (event.offsetY - 8) + 'px';
        // Highlight connections
        link.attr('stroke-opacity', l => (l.source.id === d.id || l.target.id === d.id) ? 0.8 : 0.1);
        node.attr('opacity', n => n.id === d.id || links.some(l => (l.source.id === d.id && l.target.id === n.id) || (l.target.id === d.id && l.source.id === n.id)) ? 1 : 0.2);
        label.attr('opacity', n => n.id === d.id || links.some(l => (l.source.id === d.id && l.target.id === n.id) || (l.target.id === d.id && l.source.id === n.id)) ? 1 : 0.1);
    }).on('mousemove', (event) => {
        tooltip.style.left = (event.offsetX + 12) + 'px';
        tooltip.style.top = (event.offsetY - 8) + 'px';
    }).on('mouseout', () => {
        tooltip.style.opacity = '0';
        link.attr('stroke-opacity', 0.3);
        node.attr('opacity', 1);
        label.attr('opacity', 1);
    }).on('click', (event, d) => {
        // Switch to docs tab and open the file
        switchKnowledgeTab('docs');
        openKnowledgeFile(d.id, d.label);
    });

    simulation.on('tick', () => {
        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        node.attr('cx', d => d.x).attr('cy', d => d.y);
        label.attr('x', d => d.x).attr('y', d => d.y);
    });

    // Auto fit-to-view when simulation settles
    simulation.on('end', () => {
        const pad = 16;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        nodes.forEach(n => {
            if (n.x < x0) x0 = n.x;
            if (n.y < y0) y0 = n.y;
            if (n.x > x1) x1 = n.x;
            if (n.y > y1) y1 = n.y;
        });
        const bw = x1 - x0 + pad * 2;
        const bh = y1 - y0 + pad * 2;
        if (bw > 0 && bh > 0) {
            const scale = Math.min(width / bw, height / bh, 4);
            fittedScale = scale;
            const tx = width / 2 - (x0 + x1) / 2 * scale;
            const ty = height / 2 - (y0 + y1) / 2 * scale;
            svg.transition().duration(500).call(
                zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale)
            );
        }
    });

    // Legend
    const legendDiv = document.createElement('div');
    legendDiv.className = 'knowledge-graph-legend';
    categories.forEach(cat => {
        const item = document.createElement('span');
        item.className = 'knowledge-graph-legend-item';
        item.innerHTML = `<span class="knowledge-graph-legend-dot" style="background:${colorScale(cat)}"></span>${escapeHtml(cat)}`;
        legendDiv.appendChild(item);
    });
    container.appendChild(legendDiv);
}

