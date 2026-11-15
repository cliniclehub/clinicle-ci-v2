/* Add/edit modal for OpenAI-compatible providers.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Custom (OpenAI-compatible) provider modal — add / edit
// =====================================================================
// State for the dedicated custom-provider modal. `editId` is empty when
// adding and set to the provider id when editing.
let customProviderModalState = { editId: '' };

// Named OpenAI-compatible endpoints for the "Quick fill" dropdown -- pure
// convenience over the generic CUSTOM provider type, which already supports
// any of these by hand. Every base_url here was verified live against the
// provider's own docs (not guessed) since a wrong preset is worse than none.
// AWS Bedrock and self-hosted gateways (e.g. NewAPI) are deliberately
// excluded: they don't expose a fixed, Bearer-token OpenAI-compatible
// endpoint the way these do.
const CUSTOM_PROVIDER_PRESETS = [
    { name: 'Tencent Hunyuan', api_base: 'https://api.hunyuan.cloud.tencent.com/v1' },
    { name: 'Lingyi Wanwu (01.AI)', api_base: 'https://api.lingyiwanwu.com/v1' },
    { name: 'StepFun', api_base: 'https://api.stepfun.com/v1' },
    { name: 'SiliconFlow', api_base: 'https://api.siliconflow.cn/v1' },
    { name: 'PPIO', api_base: 'https://api.ppio.com/openai' },
    { name: 'Volcengine Ark', api_base: 'https://ark.cn-beijing.volces.com/api/v3' },
    { name: 'Poe', api_base: 'https://api.poe.com/v1' },
    { name: 'Novita AI', api_base: 'https://api.novita.ai/openai/v1' },
    { name: 'OpenRouter', api_base: 'https://openrouter.ai/api/v1' },
    { name: 'xAI (Grok)', api_base: 'https://api.x.ai/v1' },
    { name: 'InfiniAI', api_base: 'https://cloud.infini-ai.com/maas/v1' },
];

function _renderCustomProviderPresetOptions() {
    const select = document.getElementById('custom-provider-preset');
    if (!select) return;
    const placeholder = select.options[0];
    select.innerHTML = '';
    select.appendChild(placeholder);
    CUSTOM_PROVIDER_PRESETS.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = p.name;
        select.appendChild(opt);
    });
}

function applyCustomProviderPreset(index) {
    if (index === '') return;
    const preset = CUSTOM_PROVIDER_PRESETS[parseInt(index, 10)];
    if (!preset) return;
    document.getElementById('custom-provider-name').value = preset.name;
    document.getElementById('custom-provider-base').value = preset.api_base;
    document.getElementById('custom-provider-key').focus();
}

function openCustomProviderModal(providerId) {
    const editing = !!providerId;
    customProviderModalState = { editId: editing ? providerId : '' };

    const card = editing ? getCustomProviderCards().find(p => p.custom_id === providerId) : null;

    const overlay = document.getElementById('custom-provider-modal-overlay');
    if (!overlay) return;

    document.getElementById('custom-provider-modal-title').textContent =
        editing ? t('models_custom_edit_title') : t('models_custom_add_title');

    // Quick-fill presets only make sense while adding: an existing provider
    // already has its own name/base the user chose, so overwriting it from a
    // preset dropdown on open (or leaving a stale selection visible) would be
    // more confusing than useful.
    const presetWrap = document.getElementById('custom-provider-preset-wrap');
    if (presetWrap) presetWrap.classList.toggle('hidden', editing);
    if (!editing) {
        _renderCustomProviderPresetOptions();
        document.getElementById('custom-provider-preset').value = '';
    }

    const nameInput = document.getElementById('custom-provider-name');
    const baseInput = document.getElementById('custom-provider-base');
    const keyInput = document.getElementById('custom-provider-key');

    nameInput.value = card ? (card.custom_name || '') : '';
    baseInput.value = card ? (card.api_base || '') : '';

    // Surface the masked key as the value for configured providers so the
    // "already set" state is unambiguous; an untouched masked value means
    // "keep the existing key" on save (mirrors the vendor modal contract).
    if (card && card.configured && card.api_key_masked) {
        keyInput.value = card.api_key_masked;
        keyInput.dataset.masked = '1';
        keyInput.dataset.maskedVal = card.api_key_masked;
    } else {
        keyInput.value = '';
        keyInput.dataset.masked = '';
        keyInput.dataset.maskedVal = '';
    }
    keyInput.oninput = function () {
        if (keyInput.dataset.masked === '1' && keyInput.value !== keyInput.dataset.maskedVal) {
            keyInput.dataset.masked = '';
        }
    };

    const statusEl = document.getElementById('custom-provider-modal-status');
    if (statusEl) { statusEl.textContent = ''; statusEl.classList.add('opacity-0'); }

    overlay.classList.remove('hidden');
    document.getElementById('custom-provider-modal-cancel').onclick = closeCustomProviderModal;
    document.getElementById('custom-provider-modal-save').onclick = saveCustomProviderModal;

    // Delete is only available when editing an existing provider.
    const deleteBtn = document.getElementById('custom-provider-modal-delete');
    if (deleteBtn) {
        deleteBtn.classList.toggle('hidden', !editing);
        deleteBtn.onclick = editing ? () => deleteCustomProvider(providerId) : null;
    }

    function onOverlayClick(e) {
        if (e.target === overlay) {
            closeCustomProviderModal();
            overlay.removeEventListener('click', onOverlayClick);
        }
    }
    overlay.addEventListener('click', onOverlayClick);

    // Model catalog rows: a custom endpoint has no preset list, so these are
    // entirely user-authored (or auto-filled by "Fetch from API" below). Only
    // meaningful when editing an existing card — a brand new card has no
    // provider id yet, so its rows are saved right after the provider is
    // created (see saveCustomProviderModal).
    bindCatalogControls('custom-provider', editing ? 'custom:' + providerId : '');
    fillCatalogForProvider('custom-provider', editing ? 'custom:' + providerId : '');

    const fetchBtn = document.getElementById('custom-provider-catalog-fetch');
    if (fetchBtn) fetchBtn.onclick = fetchCustomProviderModels;
    const fetchStatus = document.getElementById('custom-provider-catalog-fetch-status');
    if (fetchStatus) { fetchStatus.textContent = ''; fetchStatus.classList.remove('text-red-500'); }

    nameInput.focus();
}

/** "Fetch from API": GET {api_base}/models on the endpoint the user just
 *  typed (or is editing) and merge any new model ids into the catalog draft
 *  as plain "text" rows, so the user only has to touch the ones that need a
 *  capability change or a custom budget. Never overwrites an existing row. */
function fetchCustomProviderModels() {
    const btn = document.getElementById('custom-provider-catalog-fetch');
    const statusEl = document.getElementById('custom-provider-catalog-fetch-status');
    const apiBase = document.getElementById('custom-provider-base').value.trim();
    const keyInput = document.getElementById('custom-provider-key');

    if (!apiBase) {
        document.getElementById('custom-provider-base').focus();
        return;
    }

    const untouchedMasked = keyInput.dataset.masked === '1'
        && keyInput.value.trim() === (keyInput.dataset.maskedVal || '');
    const payload = { action: 'fetch_provider_models', api_base: apiBase };
    if (untouchedMasked) {
        // Let the backend resolve the already-stored key for this provider.
        payload.id = customProviderModalState.editId;
    } else {
        payload.api_key = keyInput.value.trim();
    }

    if (btn) btn.disabled = true;
    if (statusEl) {
        statusEl.classList.remove('text-red-500');
        statusEl.textContent = t('models_catalog_fetching');
    }

    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(data => {
        if (btn) btn.disabled = false;
        if (data.status !== 'success' || !Array.isArray(data.models)) {
            if (statusEl) {
                statusEl.classList.add('text-red-500');
                statusEl.textContent = data.message || t('models_catalog_fetch_failed');
            }
            return;
        }
        const prefix = 'custom-provider';
        const rows = _catalogRows(prefix);
        const existing = new Set(rows.map(r => r.name));
        let added = 0;
        data.models.forEach(name => {
            if (!name || existing.has(name)) return;
            existing.add(name);
            rows.push({ name, capabilities: ['text'], context_window: '', max_output_tokens: '' });
            added++;
        });
        renderCatalogRows(prefix);
        setCatalogSectionOpen(prefix, true);
        if (statusEl) {
            statusEl.classList.remove('text-red-500');
            statusEl.textContent = added
                ? t('models_catalog_fetch_done').replace('{n}', added)
                : t('models_catalog_fetch_none');
        }
    }).catch(() => {
        if (btn) btn.disabled = false;
        if (statusEl) {
            statusEl.classList.add('text-red-500');
            statusEl.textContent = t('models_catalog_fetch_failed');
        }
    });
}

function closeCustomProviderModal() {
    const overlay = document.getElementById('custom-provider-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function saveCustomProviderModal() {
    const name = document.getElementById('custom-provider-name').value.trim();
    const apiBase = document.getElementById('custom-provider-base').value.trim();
    const keyInput = document.getElementById('custom-provider-key');

    if (!name) {
        showStatus('custom-provider-modal-status', 'models_custom_name_required', true);
        document.getElementById('custom-provider-name').focus();
        return;
    }
    const editing = !!customProviderModalState.editId;
    if (!editing && !apiBase) {
        showStatus('custom-provider-modal-status', 'models_custom_base_required', true);
        document.getElementById('custom-provider-base').focus();
        return;
    }

    // Key handling (the custom provider's key is optional):
    //  - masked + untouched  => keep existing, omit from payload
    //  - non-empty typed value => set it
    //  - explicitly cleared on edit => send "" so the backend clears it
    const untouchedMasked =
        keyInput.dataset.masked === '1' && keyInput.value.trim() === (keyInput.dataset.maskedVal || '');
    const apiKey = untouchedMasked ? '' : keyInput.value.trim();

    const payload = {
        action: 'set_custom_provider',
        name: name,
        api_base: apiBase,
    };
    if (untouchedMasked) {
        // omit api_key entirely => backend keeps the stored key
    } else {
        // Send the value (possibly "") so an explicit clear is honored.
        payload.api_key = apiKey;
    }
    if (editing) payload.id = customProviderModalState.editId;

    const btn = document.getElementById('custom-provider-modal-save');
    btn.disabled = true;
    fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            btn.disabled = false;
            showStatus('custom-provider-modal-status', 'models_save_failed', true);
            return;
        }
        // The backend assigns the id on create, so the catalog can only be
        // written once we know which provider it belongs to.
        const finalId = data.id ? 'custom:' + data.id : ('custom:' + customProviderModalState.editId);
        return saveCatalogForProvider('custom-provider', finalId).then(ok => {
            btn.disabled = false;
            if (!ok) {
                showStatus('custom-provider-modal-status', 'models_save_failed', true);
                return;
            }
            closeCustomProviderModal();
            loadModelsView();
        });
    }).catch(() => {
        btn.disabled = false;
        showStatus('custom-provider-modal-status', 'models_save_failed', true);
    });
}

function deleteCustomProvider(providerId) {
    showConfirmDialog({
        title: t('models_custom_delete_confirm_title'),
        message: t('models_custom_delete_confirm_msg'),
        okText: t('models_custom_delete'),
        cancelText: t('cancel'),
        onConfirm: () => {
            fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete_custom_provider', id: providerId }),
            }).then(r => r.json()).then(data => {
                if (data.status === 'success') {
                    closeCustomProviderModal();
                    loadModelsView();
                }
            }).catch(() => { /* noop */ });
        }
    });
}

