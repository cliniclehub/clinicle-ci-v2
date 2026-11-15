/* Connectors view: browse and search all 1,500+ Composio connectors,
   inspect available tools and actions, manage connected accounts, and initiate
   new connections via OAuth / Composio hosted session.
   Backed by channel/web/api/connectors.py. */

let _catalogState = {
    page: 1,
    limit: 48,
    search: '',
    category: 'all',
    sortBy: 'usage',
    total: 0,
    hasMore: false,
    loading: false,
    apps: [],
    categories: [],
};
let _connectedProviders = new Set();
let _catalogSearchTimer = null;

function loadConnectorsView() {
    applyI18n();
    fetchConnectorsList();
    fetchConnectorSafety();
    fetchMcpServers();
    _catalogState.page = 1;
    _catalogState.apps = [];
    fetchConnectorsCatalog(true);
}

function _connectorsStatus(key, isError, rawMsg) {
    const el = document.getElementById('connectors-status');
    if (!el) return;
    el.textContent = rawMsg || t(key);
    el.classList.toggle('text-red-500', !!isError);
    el.classList.toggle('text-emerald-500', !isError);
    el.classList.remove('opacity-0');
    setTimeout(() => {
        if (el) el.classList.add('opacity-0');
    }, 4000);
}

function fetchConnectorsList() {
    fetch('/api/connectors')
        .then(r => r.json())
        .then(data => {
            const list = data.status === 'success' ? (data.connections || []) : [];
            _connectedProviders = new Set(list.map(c => (c.provider || '').toLowerCase()));
            const badge = document.getElementById('connectors-connected-badge');
            if (badge) badge.textContent = list.length;
            renderConnectorsList(list);
        })
        .catch(() => {
            _connectedProviders = new Set();
            renderConnectorsList([]);
        });
}

function renderConnectorsList(connections) {
    const container = document.getElementById('connectors-content');
    if (!container) return;
    if (!connections.length) {
        container.innerHTML = `<div class="text-sm text-surface-400 dark:text-surface-500 col-span-full py-4 text-center border border-dashed border-surface-200 dark:border-white/10 rounded-xl">${t('connectors_empty')}</div>`;
        return;
    }
    container.innerHTML = connections.map(c => `
        <div class="flex items-center justify-between p-3.5 rounded-xl border border-emerald-200/60 dark:border-emerald-500/20 bg-emerald-50/20 dark:bg-emerald-950/10">
            <div class="flex items-center gap-3 min-w-0">
                ${c.logo ? `<img src="${_escapeHtml(c.logo)}" alt="" class="w-8 h-8 rounded-lg shrink-0 object-contain bg-white dark:bg-surface-800 p-0.5 border border-surface-200 dark:border-white/10" onerror="this.style.display='none'">` : `<div class="w-8 h-8 rounded-lg shrink-0 bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold text-xs"><i class="fas fa-plug"></i></div>`}
                <div class="min-w-0">
                    <div class="font-semibold text-sm text-surface-800 dark:text-surface-100 truncate">${_escapeHtml(c.name || c.provider)}</div>
                    <div class="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                        <i class="fas fa-circle-check text-[10px]"></i>
                        <span>${t('connectors_connected')}</span>
                        ${c.tools_count ? `<span class="text-surface-400">· ${c.tools_count} actions</span>` : ''}
                    </div>
                </div>
            </div>
            <button onclick="disconnectConnector('${_escapeHtml(c.provider)}')"
                    class="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition-colors duration-150 shrink-0">
                ${t('connectors_disconnect')}
            </button>
        </div>
    `).join('');
}

function _escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s || '');
    return div.innerHTML;
}

function _debouncedCatalogSearch() {
    clearTimeout(_catalogSearchTimer);
    const input = document.getElementById('connector-search-input');
    const clearBtn = document.getElementById('connector-search-clear');
    const query = (input && input.value || '').trim();
    if (clearBtn) clearBtn.classList.toggle('hidden', !query);
    _catalogSearchTimer = setTimeout(() => {
        _catalogState.search = query;
        _catalogState.page = 1;
        fetchConnectorsCatalog(true);
    }, 280);
}

function _clearCatalogSearch() {
    const input = document.getElementById('connector-search-input');
    const clearBtn = document.getElementById('connector-search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    _catalogState.search = '';
    _catalogState.page = 1;
    fetchConnectorsCatalog(true);
}

function _onConnectorSortChange(sortBy) {
    _catalogState.sortBy = sortBy || 'usage';
    _catalogState.page = 1;
    fetchConnectorsCatalog(true);
}

function _selectCategory(catId) {
    _catalogState.category = catId || 'all';
    _catalogState.page = 1;
    renderConnectorsCategories();
    fetchConnectorsCatalog(true);
}

function refreshConnectorsCatalog(force) {
    fetchConnectorsList();
    _catalogState.page = 1;
    fetchConnectorsCatalog(true);
}

function fetchConnectorsCatalog(reset) {
    if (_catalogState.loading) return;
    _catalogState.loading = true;

    const spinner = document.getElementById('connectors-loading-spinner');
    const loadMoreBtn = document.getElementById('connectors-load-more-btn');
    const allLoadedText = document.getElementById('connectors-all-loaded-text');
    if (spinner) spinner.classList.remove('hidden');
    if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
    if (allLoadedText) allLoadedText.classList.add('hidden');

    const params = new URLSearchParams({
        page: String(_catalogState.page),
        limit: String(_catalogState.limit),
        search: _catalogState.search || '',
        category: _catalogState.category === 'all' ? '' : _catalogState.category,
        sort_by: _catalogState.sortBy || 'usage',
    });

    fetch('/api/connectors/catalog?' + params.toString())
        .then(r => r.json())
        .then(data => {
            _catalogState.loading = false;
            if (spinner) spinner.classList.add('hidden');

            if (data.status !== 'success') {
                if (reset) renderConnectorsCatalog([], data.message || t('connectors_catalog_error'));
                return;
            }

            _catalogState.total = data.total || (data.apps ? data.apps.length : 0);
            _catalogState.hasMore = !!data.has_more;
            if (data.categories && data.categories.length) {
                _catalogState.categories = data.categories;
                renderConnectorsCategories();
            }

            // Update badge & counter
            const totalBadge = document.getElementById('connectors-total-badge');
            if (totalBadge && _catalogState.total) {
                totalBadge.textContent = `${_catalogState.total.toLocaleString()} Apps`;
            }

            const newApps = data.apps || [];
            if (reset) {
                _catalogState.apps = newApps;
            } else {
                _catalogState.apps = _catalogState.apps.concat(newApps);
            }

            const countEl = document.getElementById('connectors-catalog-count');
            if (countEl) {
                countEl.textContent = `(${_catalogState.apps.length} of ${_catalogState.total.toLocaleString()})`;
            }

            renderConnectorsCatalog(_catalogState.apps, null);

            // Pagination button state
            if (loadMoreBtn && allLoadedText) {
                if (_catalogState.hasMore) {
                    loadMoreBtn.classList.remove('hidden');
                    allLoadedText.classList.add('hidden');
                } else {
                    loadMoreBtn.classList.add('hidden');
                    if (_catalogState.apps.length > 0) {
                        allLoadedText.classList.remove('hidden');
                    }
                }
            }
        })
        .catch(err => {
            _catalogState.loading = false;
            if (spinner) spinner.classList.add('hidden');
            if (reset) renderConnectorsCatalog([], t('connectors_catalog_error'));
        });
}

function loadMoreConnectors() {
    if (_catalogState.loading || !_catalogState.hasMore) return;
    _catalogState.page += 1;
    fetchConnectorsCatalog(false);
}

function renderConnectorsCategories() {
    const bar = document.getElementById('connectors-categories-bar');
    if (!bar) return;

    const cats = [{ id: 'all', name: 'All' }].concat(_catalogState.categories || []);
    bar.innerHTML = cats.map(c => {
        const isCurrent = _catalogState.category === c.id;
        const activeClass = isCurrent
            ? 'bg-primary-500 text-white font-medium shadow-sm'
            : 'bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-300 border border-surface-200 dark:border-white/10 hover:bg-surface-50 dark:hover:bg-surface-700/50';
        return `
            <button onclick="_selectCategory('${_escapeHtml(c.id)}')"
                    class="px-3 py-1.5 rounded-full shrink-0 cursor-pointer transition-all duration-150 ${activeClass}">
                ${_escapeHtml(c.name)} ${c.count ? `<span class="opacity-70 text-[10px]">(${c.count})</span>` : ''}
            </button>
        `;
    }).join('');
}

function renderConnectorsCatalog(apps, errorMessage) {
    const container = document.getElementById('connectors-catalog');
    if (!container) return;
    if (errorMessage) {
        container.innerHTML = `<div class="text-sm text-red-500 text-center py-12 col-span-full border border-dashed border-red-200 dark:border-red-900/30 rounded-2xl">${_escapeHtml(errorMessage)}</div>`;
        return;
    }
    if (!apps || !apps.length) {
        container.innerHTML = `
            <div class="text-center py-16 col-span-full border border-dashed border-surface-200 dark:border-white/10 rounded-2xl">
                <i class="fas fa-search text-2xl text-surface-300 dark:text-surface-600 mb-2"></i>
                <div class="text-sm font-medium text-surface-600 dark:text-surface-300">${t('connectors_catalog_empty')}</div>
                <p class="text-xs text-surface-400 mt-1">Try another search keyword or clear filters</p>
            </div>
        `;
        return;
    }

    container.innerHTML = apps.map(a => {
        const isConnected = _connectedProviders.has((a.slug || '').toLowerCase()) || !!a.is_connected;
        const toolsCount = a.tools_count || 0;
        const logoUrl = a.logo || '';
        const fallbackInitial = (a.name || a.slug || '?').charAt(0).toUpperCase();

        return `
            <div class="flex flex-col justify-between p-4 rounded-2xl border border-surface-200/80 dark:border-white/10 bg-white dark:bg-surface-800/80 hover:shadow-md hover:border-surface-300 dark:hover:border-white/20 transition-all duration-200 group">
                <div>
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div class="w-10 h-10 rounded-xl shrink-0 p-1 bg-surface-50 dark:bg-surface-900 border border-surface-100 dark:border-white/10 flex items-center justify-center overflow-hidden">
                            ${logoUrl
                                ? `<img src="${_escapeHtml(logoUrl)}" alt="" class="w-full h-full object-contain" onerror="this.outerHTML='<span class=\\'font-bold text-sm text-surface-500\\'>${fallbackInitial}</span>'">`
                                : `<span class="font-bold text-sm text-primary-500">${fallbackInitial}</span>`}
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            ${isConnected
                                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/30">
                                       <i class="fas fa-check text-[9px]"></i>
                                       <span>Connected</span>
                                   </span>`
                                : ''}
                            ${toolsCount > 0
                                ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-100 dark:bg-white/10 text-surface-600 dark:text-surface-300">
                                       ${toolsCount} actions
                                   </span>`
                                : ''}
                        </div>
                    </div>
                    <h4 class="font-semibold text-sm text-surface-800 dark:text-surface-100 truncate group-hover:text-primary-500 transition-colors" title="${_escapeHtml(a.name || a.slug)}">
                        ${_escapeHtml(a.name || a.slug)}
                    </h4>
                    <p class="text-xs text-surface-500 dark:text-surface-400 line-clamp-2 mt-1 min-h-[2rem]" title="${_escapeHtml(a.description || '')}">
                        ${_escapeHtml(a.description || 'Seamlessly integrate this service with your AI agents.')}
                    </p>
                </div>

                <div class="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-surface-100 dark:border-white/5">
                    <button onclick="openConnectorToolsModal('${_escapeHtml(a.slug)}', '${_escapeHtml(a.name || a.slug)}', '${_escapeHtml(logoUrl)}', '${_escapeHtml(a.description || '')}')"
                            class="text-xs text-surface-500 dark:text-surface-400 hover:text-primary-500 dark:hover:text-primary-400 font-medium cursor-pointer transition-colors inline-flex items-center gap-1">
                        <i class="fas fa-list-check text-[10px]"></i>
                        <span>Actions</span>
                    </button>
                    ${isConnected
                        ? `<button onclick="disconnectConnector('${_escapeHtml(a.slug)}')"
                                   class="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition-colors">
                               ${t('connectors_disconnect')}
                           </button>`
                        : `<button onclick="startConnectorConnect('${_escapeHtml(a.slug)}')"
                                   class="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-primary-500 hover:bg-primary-600 text-white cursor-pointer shadow-sm hover:shadow transition-all shrink-0">
                               ${t('connectors_add')}
                           </button>`}
                </div>
            </div>
        `;
    }).join('');
}

function openConnectorToolsModal(slug, name, logo, desc) {
    const modal = document.getElementById('connector-tools-modal');
    if (!modal) return;

    const modalName = document.getElementById('modal-app-name');
    const modalLogo = document.getElementById('modal-app-logo');
    const modalDesc = document.getElementById('modal-app-desc');
    const modalBadge = document.getElementById('modal-app-tools-badge');
    const modalList = document.getElementById('modal-tools-list');
    const modalConnectBtn = document.getElementById('modal-connect-btn');

    if (modalName) modalName.textContent = name || slug;
    if (modalDesc) modalDesc.textContent = desc || '';
    if (modalLogo) {
        if (logo) {
            modalLogo.src = logo;
            modalLogo.style.display = 'block';
        } else {
            modalLogo.style.display = 'none';
        }
    }
    if (modalConnectBtn) {
        const isConn = _connectedProviders.has(slug.toLowerCase());
        modalConnectBtn.textContent = isConn ? 'Connected' : 'Connect';
        modalConnectBtn.disabled = isConn;
        modalConnectBtn.onclick = () => {
            closeConnectorToolsModal();
            startConnectorConnect(slug);
        };
    }

    if (modalBadge) modalBadge.textContent = 'Loading...';
    if (modalList) {
        modalList.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-surface-400">
                <i class="fas fa-spinner fa-spin text-2xl text-primary-500 mb-2"></i>
                <span class="text-xs">Fetching actions for ${name}...</span>
            </div>
        `;
    }

    modal.classList.remove('hidden');

    fetch('/api/connectors/tools?toolkit=' + encodeURIComponent(slug))
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success' || !data.tools || !data.tools.length) {
                if (modalBadge) modalBadge.textContent = '0 actions';
                if (modalList) {
                    modalList.innerHTML = `<div class="text-sm text-surface-400 text-center py-10">No specific action schemas listed for this toolkit.</div>`;
                }
                return;
            }

            if (modalBadge) modalBadge.textContent = `${data.count} actions`;
            if (modalList) {
                modalList.innerHTML = data.tools.map(tool => {
                    const props = (tool.parameters && tool.parameters.properties) ? Object.keys(tool.parameters.properties) : [];
                    return `
                        <div class="p-3.5 rounded-xl border border-surface-200/80 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/40">
                            <div class="flex items-center justify-between gap-2 mb-1">
                                <code class="font-mono font-semibold text-xs text-primary-600 dark:text-primary-400">${_escapeHtml(tool.slug || tool.name)}</code>
                                ${tool.version ? `<span class="text-[10px] text-surface-400">v${_escapeHtml(tool.version)}</span>` : ''}
                            </div>
                            <p class="text-xs text-surface-600 dark:text-surface-300 mt-1 leading-relaxed">${_escapeHtml(tool.description || 'Executes this third-party action.')}</p>
                            ${props.length ? `
                                <div class="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2 border-t border-surface-200/50 dark:border-white/5">
                                    <span class="text-[10px] text-surface-400 font-medium">Parameters:</span>
                                    ${props.slice(0, 8).map(p => `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 text-surface-600 dark:text-surface-400">${_escapeHtml(p)}</span>`).join('')}
                                    ${props.length > 8 ? `<span class="text-[10px] text-surface-400">+${props.length - 8} more</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');
            }
        })
        .catch(() => {
            if (modalBadge) modalBadge.textContent = 'Error';
            if (modalList) {
                modalList.innerHTML = `<div class="text-sm text-red-500 text-center py-8">Failed to load actions.</div>`;
            }
        });
}

function closeConnectorToolsModal() {
    const modal = document.getElementById('connector-tools-modal');
    if (modal) modal.classList.add('hidden');
}

function startConnectorConnect(provider) {
    provider = (provider || '').trim();
    if (!provider) {
        _connectorsStatus('connectors_provider_required', true);
        return;
    }
    _connectorsStatus('connectors_opening', false);

    fetch('/api/connectors/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
    })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success' || !data.connect_link) {
                _connectorsStatus('connectors_connect_failed', true, data.message);
                return;
            }
            const popup = window.open(data.connect_link, 'composio-connect', 'width=520,height=680');
            if (!popup) {
                _connectorsStatus('connectors_connect_failed', true, 'Popup blocked. Please allow popups.');
                return;
            }
            const poll = setInterval(() => {
                if (popup.closed) {
                    clearInterval(poll);
                    fetchConnectorsList();
                    fetchConnectorsCatalog(false);
                }
            }, 1000);
        })
        .catch(() => _connectorsStatus('connectors_connect_failed', true));
}

function disconnectConnector(provider) {
    fetch(`/api/connectors/${encodeURIComponent(provider)}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') {
                _connectorsStatus('connectors_disconnect_failed', true, data.message);
                return;
            }
            _connectedProviders.delete(provider.toLowerCase());
            fetchConnectorsList();
            fetchConnectorsCatalog(false);
        })
        .catch(() => _connectorsStatus('connectors_disconnect_failed', true));
}

/* Connector safety: per-toolkit on/off switches + Outlook recipient allow-list.
   Enforced server-side by agent.permission.policy.check_connector_call
   regardless of session permission mode -- this UI only edits the config
   that check reads. */

let _connectorToggles = {};

function fetchConnectorSafety() {
    fetch('/api/connectors/toggles')
        .then(r => r.json())
        .then(data => {
            _connectorToggles = (data.status === 'success' && data.toggles) || {};
            renderConnectorToggles();
        })
        .catch(() => { _connectorToggles = {}; renderConnectorToggles(); });

    fetch('/api/connectors/outlook/allowlist')
        .then(r => r.json())
        .then(data => {
            const input = document.getElementById('outlook-allowlist-input');
            if (input && data.status === 'success') {
                input.value = (data.recipients || []).join(', ');
            }
        })
        .catch(() => {});
}

function renderConnectorToggles() {
    const container = document.getElementById('connectors-toggles-list');
    if (!container) return;
    // Every connected toolkit gets a switch; a toolkit with no explicit
    // entry in _connectorToggles is enabled by default.
    const slugs = new Set([..._connectedProviders].map(p => p.toUpperCase()));
    Object.keys(_connectorToggles).forEach(k => slugs.add(k.toUpperCase()));
    if (!slugs.size) {
        container.innerHTML = `<div class="text-xs text-surface-400 dark:text-surface-500">${t('connectors_toggles_empty') || 'Connect an app to switch it on or off here.'}</div>`;
        return;
    }
    container.innerHTML = [...slugs].sort().map(slug => {
        const enabled = _connectorToggles[slug] !== false;
        return `
        <label class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-surface-200 dark:border-white/10 text-sm">
            <span class="text-surface-700 dark:text-surface-200">${_escapeHtml(slug)}</span>
            <input type="checkbox" ${enabled ? 'checked' : ''}
                   onchange="toggleConnectorToolkit('${_escapeHtml(slug)}', this.checked)"
                   class="cursor-pointer">
        </label>`;
    }).join('');
}

function toggleConnectorToolkit(toolkit, enabled) {
    fetch('/api/connectors/toggles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolkit, enabled }),
    })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') {
                _connectorsStatus('connectors_toggle_failed', true, data.message);
                fetchConnectorSafety();
                return;
            }
            _connectorToggles = data.toggles || {};
        })
        .catch(() => { _connectorsStatus('connectors_toggle_failed', true); fetchConnectorSafety(); });
}

function saveOutlookAllowlist() {
    const input = document.getElementById('outlook-allowlist-input');
    if (!input) return;
    const recipients = input.value.split(',').map(s => s.trim()).filter(Boolean);
    fetch('/api/connectors/outlook/allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients }),
    })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') {
                _connectorsStatus('connectors_outlook_allowlist_failed', true, data.message);
                return;
            }
            input.value = (data.recipients || []).join(', ');
            _connectorsStatus('connectors_outlook_allowlist_saved', false);
        })
        .catch(() => _connectorsStatus('connectors_outlook_allowlist_failed', true));
}

/* MCP Servers: raw mcp.json entries (agent/tools/tool_manager.py's
   _load_mcp_configs()) -- separate from the Composio catalog above.
   Backed by /api/connectors/mcp[/<name>]. */

const _MCP_STATUS_STYLE = {
    ready: { dot: 'bg-emerald-500', label: 'Connected' },
    pending: { dot: 'bg-amber-500', label: 'Starting…' },
    needs_auth: { dot: 'bg-primary-500', label: 'Needs authorization' },
    failed: { dot: 'bg-red-500', label: 'Failed' },
    unknown: { dot: 'bg-surface-400', label: 'Not loaded yet' },
};

function fetchMcpServers() {
    fetch('/api/connectors/mcp')
        .then(r => r.json())
        .then(data => renderMcpServers(data.status === 'success' ? (data.servers || []) : []))
        .catch(() => renderMcpServers([]));
}

function renderMcpServers(servers) {
    const container = document.getElementById('mcp-servers-list');
    if (!container) return;
    if (!servers.length) {
        container.innerHTML = `<div class="text-xs text-surface-400 dark:text-surface-500">No MCP servers configured yet.</div>`;
        return;
    }
    container.innerHTML = servers.map(s => {
        const style = _MCP_STATUS_STYLE[s.status] || _MCP_STATUS_STYLE.unknown;
        const detail = s.type === 'stdio'
            ? `${s.command || ''} ${(s.args || []).join(' ')}`.trim()
            : (s.url || '');
        return `
        <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-surface-200 dark:border-white/10 text-sm">
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="w-2 h-2 rounded-full shrink-0 ${style.dot}" title="${_escapeHtml(style.label)}"></span>
                <div class="min-w-0">
                    <div class="font-medium text-surface-700 dark:text-surface-200 truncate">${_escapeHtml(s.name)}</div>
                    <div class="text-[11px] text-surface-400 dark:text-surface-500 truncate">${_escapeHtml(s.type)} · ${_escapeHtml(detail)}</div>
                </div>
            </div>
            <button onclick="removeMcpServer('${_escapeHtml(s.name)}')"
                    class="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer shrink-0">
                Remove
            </button>
        </div>`;
    }).join('');
}

function _onMcpTypeChange(type) {
    const isStdio = type === 'stdio';
    const stdioFields = document.getElementById('mcp-stdio-fields');
    const urlField = document.getElementById('mcp-url-input');
    if (stdioFields) stdioFields.classList.toggle('hidden', !isStdio);
    if (urlField) urlField.classList.toggle('hidden', isStdio);
}

function addMcpServer() {
    const nameInput = document.getElementById('mcp-name-input');
    const typeSelect = document.getElementById('mcp-type-select');
    const name = (nameInput && nameInput.value || '').trim();
    const type = typeSelect ? typeSelect.value : 'stdio';

    if (!name) {
        _connectorsStatus('connectors_mcp_add_failed', true, 'Server name is required');
        return;
    }

    const payload = { name, type };
    if (type === 'stdio') {
        const command = document.getElementById('mcp-command-input');
        const args = document.getElementById('mcp-args-input');
        const env = document.getElementById('mcp-env-input');
        payload.command = (command && command.value || '').trim();
        const argsRaw = (args && args.value || '').trim();
        payload.args = argsRaw ? argsRaw.split(/\s+/) : [];
        const envRaw = (env && env.value || '').trim();
        if (envRaw) {
            const envMap = {};
            envRaw.split(',').forEach(pair => {
                const idx = pair.indexOf('=');
                if (idx > 0) envMap[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
            });
            payload.env = envMap;
        }
    } else {
        const url = document.getElementById('mcp-url-input');
        payload.url = (url && url.value || '').trim();
    }

    fetch('/api/connectors/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') {
                _connectorsStatus('connectors_mcp_add_failed', true, data.message);
                return;
            }
            ['mcp-name-input', 'mcp-command-input', 'mcp-args-input', 'mcp-env-input', 'mcp-url-input'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            fetchMcpServers();
        })
        .catch(() => _connectorsStatus('connectors_mcp_add_failed', true));
}

function removeMcpServer(name) {
    fetch(`/api/connectors/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') {
                _connectorsStatus('connectors_mcp_remove_failed', true, data.message);
                return;
            }
            fetchMcpServers();
        })
        .catch(() => _connectorsStatus('connectors_mcp_remove_failed', true));
}
