/* Workflows: n8n/Make.com-style node/edge canvas. A trigger node starts a
 * run, edges carry it forward, a logic.condition node has two outputs
 * (true/false) so a graph genuinely branches -- see
 * agent/tools/workflows/engine.py for the server-side DAG walk this canvas
 * edits. Built on D3 v7 (vendored, channel/web/static/vendor/d3) for
 * zoom/pan/drag; nodes and edges are plain SVG, no diagramming library.
 */

const WF_NODE_W = 170;
const WF_NODE_H = 56;

const WF_NODE_META = {
    'trigger.schedule':      { label: 'Schedule',       icon: 'fa-clock',            color: '#8b5cf6', trigger: true,
                                category: 'Triggers', description: 'Starts the workflow on a cron schedule or interval.' },
    'trigger.webhook':       { label: 'Webhook',         icon: 'fa-satellite-dish',   color: '#8b5cf6', trigger: true,
                                category: 'Triggers', description: 'Starts the workflow when an external system calls its URL.' },
    'action.team_task':      { label: 'Team Task',       icon: 'fa-people-group',     color: '#2E9FDC', trigger: false,
                                category: 'Actions', description: 'Creates a task for a team member to work on.' },
    'action.connector_call': { label: 'Connector Call',  icon: 'fa-plug',             color: '#2E9FDC', trigger: false,
                                category: 'Actions', description: 'Calls any connected app (Slack, GitHub, Google, 1,500+ more).' },
    'action.list_connected_apps': { label: 'List Connected Apps', icon: 'fa-list-check', color: '#2E9FDC', trigger: false,
                                category: 'Actions', description: 'Lists every app currently connected on the Connectors page.' },
    'logic.condition':       { label: 'Condition',       icon: 'fa-code-branch',      color: '#f59e0b', trigger: false, branches: true,
                                category: 'Logic', description: 'Branches the workflow true/false based on a prior node’s result.' },
};

let wfList = [];
let activeWorkflow = null;   // full workflow object as last loaded/saved from the server
let wfNodes = [];            // local, mutable working copy
let wfEdges = [];            // local, mutable working copy
let wfDirty = false;
let wfSelectedNodeId = null;
let wfSelectedEdgeId = null;
let wfSvg = null, wfZoomGroup = null, wfNodesLayer = null, wfEdgesLayer = null;
let wfPendingConnection = null;  // {sourceId, sourceHandle, x, y} while dragging a new edge
let wfNodeSeq = 0;

function loadWorkflowsView() {
    fetch('/api/workflows').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        wfList = data.workflows || [];
        _renderWfList();
        if (activeWorkflow && wfList.some(w => w.id === activeWorkflow.id)) {
            selectWorkflow(activeWorkflow.id);
        }
    }).catch(() => {});
}

function _renderWfList() {
    const emptyEl = document.getElementById('workflows-empty');
    const itemsEl = document.getElementById('wf-list-items');
    if (!wfList.length) {
        emptyEl.classList.remove('hidden');
        itemsEl.innerHTML = '';
        return;
    }
    emptyEl.classList.add('hidden');
    itemsEl.innerHTML = wfList.map(w => `
        <div class="meeting-card${activeWorkflow && w.id === activeWorkflow.id ? ' meeting-card-active' : ''}" onclick="selectWorkflow('${_wsAttr(w.id)}')">
            <div class="meeting-card-title">${escapeHtml(w.name)}</div>
            <div class="meeting-card-meta">
                <span class="meeting-status ${w.active ? 'meeting-status-published' : 'meeting-status-draft'}">${w.active ? 'Active' : 'Inactive'}</span>
                <span class="wf-card-meta-text">${(w.nodes || []).length} nodes</span>
            </div>
        </div>
    `).join('');
}

function selectWorkflow(workflowId) {
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}`).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        activeWorkflow = data.workflow;
        wfNodes = JSON.parse(JSON.stringify(activeWorkflow.nodes || []));
        wfEdges = JSON.parse(JSON.stringify(activeWorkflow.edges || []));
        wfDirty = false;
        wfSelectedNodeId = null;
        wfSelectedEdgeId = null;
        document.getElementById('wf-editor').classList.remove('hidden');
        document.getElementById('wf-name-input').value = activeWorkflow.name;
        document.getElementById('wf-active-checkbox').checked = !!activeWorkflow.active;
        _initCanvasOnce();
        renderWfCanvas();
        _renderWfList();
        _closeInspector();
    }).catch(() => _wsToast(t('team_action_failed')));
}

// =====================================================================
// Canvas setup (D3 zoom/pan)
// =====================================================================
function _initCanvasOnce() {
    if (wfSvg) return;
    wfSvg = d3.select('#wf-canvas');
    wfZoomGroup = wfSvg.append('g').attr('class', 'wf-zoom-group');
    wfEdgesLayer = wfZoomGroup.append('g').attr('class', 'wf-edges-layer');
    wfNodesLayer = wfZoomGroup.append('g').attr('class', 'wf-nodes-layer');

    const zoom = d3.zoom().scaleExtent([0.3, 2]).on('zoom', (event) => {
        wfZoomGroup.attr('transform', event.transform);
    });
    wfSvg.call(zoom).on('dblclick.zoom', null);

    wfSvg.on('mousedown', (event) => {
        if (event.target === wfSvg.node()) { wfSelectedNodeId = null; wfSelectedEdgeId = null; _closeInspector(); renderWfCanvas(); }
    });
    wfSvg.on('mousemove', (event) => {
        if (!wfPendingConnection) return;
        const [x, y] = d3.pointer(event, wfZoomGroup.node());
        wfPendingConnection.x = x; wfPendingConnection.y = y;
        _renderPendingConnection();
    });
    wfSvg.on('mouseup', () => { wfPendingConnection = null; _renderPendingConnection(); });
}

function _portPositions(node) {
    const meta = WF_NODE_META[node.type] || {};
    const input = { x: node.position.x - WF_NODE_W / 2, y: node.position.y };
    if (meta.branches) {
        return {
            input,
            outputs: [
                { handle: 'true', x: node.position.x + WF_NODE_W / 2, y: node.position.y - 14 },
                { handle: 'false', x: node.position.x + WF_NODE_W / 2, y: node.position.y + 14 },
            ],
        };
    }
    return { input, outputs: meta.trigger || !meta.trigger ? [{ handle: null, x: node.position.x + WF_NODE_W / 2, y: node.position.y }] : [] };
}

function _edgePath(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

// =====================================================================
// Render
// =====================================================================
function renderWfCanvas() {
    document.getElementById('wf-canvas-empty').classList.toggle('hidden', wfNodes.length > 0);
    _renderWfEdges();
    _renderWfNodes();
}

function _renderWfEdges() {
    const nodesById = Object.fromEntries(wfNodes.map(n => [n.id, n]));
    const sel = wfEdgesLayer.selectAll('path.wf-edge').data(wfEdges, d => d.id);
    sel.exit().remove();
    const merged = sel.enter().append('path')
        .attr('class', 'wf-edge')
        .on('click', (event, d) => { event.stopPropagation(); wfSelectedEdgeId = d.id; wfSelectedNodeId = null; _closeInspector(); renderWfCanvas(); })
        .merge(sel);
    merged
        .attr('class', d => 'wf-edge' + (d.id === wfSelectedEdgeId ? ' wf-edge-selected' : '') + (d.source_handle === 'false' ? ' wf-edge-false' : ''))
        .attr('d', d => {
            const source = nodesById[d.source], target = nodesById[d.target];
            if (!source || !target) return '';
            const ports = _portPositions(source);
            const out = ports.outputs.find(o => o.handle === d.source_handle) || ports.outputs[0] || { x: source.position.x, y: source.position.y };
            const inPort = _portPositions(target).input;
            return _edgePath(out.x, out.y, inPort.x, inPort.y);
        });
}

function _renderPendingConnection() {
    wfEdgesLayer.selectAll('path.wf-edge-pending').remove();
    if (!wfPendingConnection) return;
    const source = wfNodes.find(n => n.id === wfPendingConnection.sourceId);
    if (!source) return;
    const ports = _portPositions(source);
    const out = ports.outputs.find(o => o.handle === wfPendingConnection.sourceHandle) || ports.outputs[0];
    wfEdgesLayer.append('path').attr('class', 'wf-edge wf-edge-pending')
        .attr('d', _edgePath(out.x, out.y, wfPendingConnection.x, wfPendingConnection.y));
}

function _renderWfNodes() {
    const sel = wfNodesLayer.selectAll('g.wf-node').data(wfNodes, d => d.id);
    sel.exit().remove();

    const entered = sel.enter().append('g').attr('class', 'wf-node');
    entered.append('rect').attr('class', 'wf-node-rect');
    entered.append('text').attr('class', 'wf-node-icon').attr('font-family', "'Font Awesome 6 Free'").attr('font-weight', 900);
    entered.append('text').attr('class', 'wf-node-label');
    entered.append('circle').attr('class', 'wf-port wf-port-input');
    // Output port(s) added per-node below since a condition node needs two.

    const merged = entered.merge(sel);
    merged.attr('class', d => 'wf-node' + (d.id === wfSelectedNodeId ? ' wf-node-selected' : ''));
    merged.attr('transform', d => `translate(${d.position.x - WF_NODE_W / 2}, ${d.position.y - WF_NODE_H / 2})`);
    merged.select('rect.wf-node-rect')
        .attr('width', WF_NODE_W).attr('height', WF_NODE_H).attr('rx', 10)
        .attr('stroke', d => (WF_NODE_META[d.type] || {}).color || '#7F9FB8');
    merged.select('text.wf-node-icon')
        .attr('x', 14).attr('y', WF_NODE_H / 2 + 5).attr('fill', d => (WF_NODE_META[d.type] || {}).color || '#7F9FB8')
        .text(d => _faUnicode((WF_NODE_META[d.type] || {}).icon));
    merged.select('text.wf-node-label')
        .attr('x', 38).attr('y', WF_NODE_H / 2 + 5)
        .text(d => (WF_NODE_META[d.type] || {}).label || d.type);
    merged.select('circle.wf-port-input')
        .attr('cx', 0).attr('cy', WF_NODE_H / 2).attr('r', 6)
        .style('display', d => (WF_NODE_META[d.type] || {}).trigger ? 'none' : null)
        .on('mouseup', (event, d) => { event.stopPropagation(); _completeConnection(d.id); });

    // Output ports: re-derive each render since a condition node needs 2.
    merged.each(function (d) {
        const g = d3.select(this);
        g.selectAll('circle.wf-port-output').remove();
        g.selectAll('text.wf-port-label').remove();
        const meta = WF_NODE_META[d.type] || {};
        if (meta.branches) {
            g.append('circle').attr('class', 'wf-port wf-port-output wf-port-true')
                .attr('cx', WF_NODE_W).attr('cy', WF_NODE_H / 2 - 14).attr('r', 6)
                .on('mousedown', (event) => { event.stopPropagation(); _startConnection(d.id, 'true'); });
            g.append('text').attr('class', 'wf-port-label').attr('x', WF_NODE_W - 14).attr('y', WF_NODE_H / 2 - 18).text('T');
            g.append('circle').attr('class', 'wf-port wf-port-output wf-port-false')
                .attr('cx', WF_NODE_W).attr('cy', WF_NODE_H / 2 + 14).attr('r', 6)
                .on('mousedown', (event) => { event.stopPropagation(); _startConnection(d.id, 'false'); });
            g.append('text').attr('class', 'wf-port-label').attr('x', WF_NODE_W - 14).attr('y', WF_NODE_H / 2 + 26).text('F');
        } else {
            g.append('circle').attr('class', 'wf-port wf-port-output')
                .attr('cx', WF_NODE_W).attr('cy', WF_NODE_H / 2).attr('r', 6)
                .on('mousedown', (event) => { event.stopPropagation(); _startConnection(d.id, null); });
        }
    });

    merged.on('click', (event, d) => { event.stopPropagation(); selectNode(d.id); });
    merged.call(
        d3.drag()
            .on('start', function () { d3.select(this).raise(); })
            .on('drag', (event, d) => {
                d.position.x = event.x; d.position.y = event.y;
                wfDirty = true;
                renderWfCanvas();
            })
    );
}

function _startConnection(sourceId, sourceHandle) {
    wfPendingConnection = { sourceId, sourceHandle, x: 0, y: 0 };
}

function _completeConnection(targetId) {
    if (!wfPendingConnection) return;
    const { sourceId, sourceHandle } = wfPendingConnection;
    wfPendingConnection = null;
    _renderPendingConnection();
    if (sourceId === targetId) return;
    if (wfEdges.some(e => e.source === sourceId && e.source_handle === sourceHandle && e.target === targetId)) return;
    wfEdges.push({ id: 'local_' + (wfNodeSeq++), source: sourceId, source_handle: sourceHandle, target: targetId });
    wfDirty = true;
    renderWfCanvas();
}

function _faUnicode(iconClass) {
    // Font Awesome ligature fallback isn't wired for arbitrary classes in an
    // SVG <text>; simplest reliable path is a small manual map for the 5
    // icons this view actually uses.
    const map = {
        'fa-clock': '', 'fa-satellite-dish': '', 'fa-people-group': '',
        'fa-plug': '', 'fa-code-branch': '',
    };
    return map[iconClass] || '';
}

// =====================================================================
// Node lifecycle
// =====================================================================
function addNode(type) {
    if (!activeWorkflow) return;
    // New nodes cascade left-to-right with real spacing past whatever's
    // already on the canvas (n8n's default flow direction), never stacked
    // near-atop each other -- WF_NODE_W (170) + a gap is the minimum that
    // keeps two nodes visually distinct at 1x zoom.
    const rightmostX = wfNodes.length ? Math.max(...wfNodes.map(n => n.position.x)) : 200 - (WF_NODE_W + 90);
    const node = {
        id: 'local_' + (wfNodeSeq++),
        type,
        position: { x: rightmostX + WF_NODE_W + 90, y: 200 },
        config: type === 'trigger.schedule' ? { schedule: { type: 'interval', seconds: 3600 } } : {},
    };
    wfNodes.push(node);
    wfDirty = true;
    renderWfCanvas();
    selectNode(node.id);
}

// =====================================================================
// Node picker: n8n-style searchable panel, grouped by category
// =====================================================================
function openNodePicker() {
    if (!activeWorkflow) return;
    document.getElementById('wf-node-search').value = '';
    renderNodePickerList();
    document.getElementById('wf-node-picker').classList.remove('hidden');
    document.getElementById('wf-node-search').focus();
}

function closeNodePicker() {
    document.getElementById('wf-node-picker').classList.add('hidden');
}

function pickNodeType(type) {
    closeNodePicker();
    addNode(type);
}

function renderNodePickerList() {
    const query = (document.getElementById('wf-node-search').value || '').trim().toLowerCase();
    const entries = Object.entries(WF_NODE_META).filter(([type, meta]) =>
        !query || meta.label.toLowerCase().includes(query) || meta.description.toLowerCase().includes(query)
    );
    const byCategory = {};
    entries.forEach(([type, meta]) => { (byCategory[meta.category] = byCategory[meta.category] || []).push([type, meta]); });

    const list = document.getElementById('wf-node-picker-list');
    if (!entries.length) {
        list.innerHTML = `<div class="meeting-empty-row">No matching nodes.</div>`;
        return;
    }
    list.innerHTML = Object.entries(byCategory).map(([category, items]) => `
        <div class="wf-node-picker-category">${escapeHtml(category)}</div>
        ${items.map(([type, meta]) => `
            <button class="wf-node-picker-item" onclick="pickNodeType('${type}')">
                <span class="wf-node-picker-icon" style="color:${meta.color}"><i class="fas ${meta.icon}"></i></span>
                <span class="wf-node-picker-text">
                    <span class="wf-node-picker-label">${escapeHtml(meta.label)}</span>
                    <span class="wf-node-picker-desc">${escapeHtml(meta.description)}</span>
                </span>
            </button>
        `).join('')}
    `).join('');
}

function selectNode(nodeId) {
    wfSelectedNodeId = nodeId;
    wfSelectedEdgeId = null;
    renderWfCanvas();
    _renderInspector();
}

function deleteSelectedNode() {
    if (!wfSelectedNodeId) return;
    wfNodes = wfNodes.filter(n => n.id !== wfSelectedNodeId);
    wfEdges = wfEdges.filter(e => e.source !== wfSelectedNodeId && e.target !== wfSelectedNodeId);
    wfSelectedNodeId = null;
    wfDirty = true;
    renderWfCanvas();
    _closeInspector();
}

function deleteSelectedEdge() {
    if (!wfSelectedEdgeId) return;
    wfEdges = wfEdges.filter(e => e.id !== wfSelectedEdgeId);
    wfSelectedEdgeId = null;
    wfDirty = true;
    renderWfCanvas();
}

document.addEventListener('keydown', (event) => {
    if (document.getElementById('view-workflows') && !document.getElementById('view-workflows').classList.contains('active')) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        if (wfSelectedNodeId) deleteSelectedNode();
        else if (wfSelectedEdgeId) deleteSelectedEdge();
    }
});

// =====================================================================
// Inspector (node config form)
// =====================================================================
function _closeInspector() {
    document.getElementById('wf-inspector').classList.add('hidden');
}

function _renderInspector() {
    const node = wfNodes.find(n => n.id === wfSelectedNodeId);
    const panel = document.getElementById('wf-inspector');
    if (!node) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const meta = WF_NODE_META[node.type] || {};
    let fieldsHtml = '';

    if (node.type === 'trigger.schedule') {
        const sched = node.config.schedule || {};
        fieldsHtml = `
            <label class="wf-field-label">Schedule type</label>
            <select class="wf-field-input" onchange="updateNodeConfig('schedule.type', this.value)">
                <option value="interval" ${sched.type === 'interval' ? 'selected' : ''}>Interval (seconds)</option>
                <option value="cron" ${sched.type === 'cron' ? 'selected' : ''}>Cron expression</option>
            </select>
            ${sched.type === 'cron'
                ? `<label class="wf-field-label">Cron expression</label><input class="wf-field-input" value="${escapeHtml(sched.expression || '')}" onchange="updateNodeConfig('schedule.expression', this.value)" placeholder="0 9 * * MON">`
                : `<label class="wf-field-label">Every N seconds</label><input type="number" class="wf-field-input" value="${sched.seconds || 3600}" onchange="updateNodeConfig('schedule.seconds', Number(this.value))">`}
        `;
    } else if (node.type === 'trigger.webhook') {
        const url = node.config.token ? `${window.location.origin}/api/workflows/webhook/${node.config.token}` : '(save the workflow once to generate a URL)';
        fieldsHtml = `
            <label class="wf-field-label">Webhook URL</label>
            <input class="wf-field-input" readonly value="${escapeHtml(url)}" onclick="this.select()">
            <p class="wf-field-hint">POST any JSON body to this URL to start the workflow. Only works while the workflow is Active.</p>
        `;
    } else if (node.type === 'action.team_task') {
        fieldsHtml = `
            <label class="wf-field-label">Team ID</label>
            <input class="wf-field-input" value="${escapeHtml(node.config.team_id || '')}" onchange="updateNodeConfig('team_id', this.value)" placeholder="team_abc123">
            <label class="wf-field-label">Task subject</label>
            <input class="wf-field-input" value="${escapeHtml(node.config.subject || '')}" onchange="updateNodeConfig('subject', this.value)">
        `;
    } else if (node.type === 'action.connector_call') {
        fieldsHtml = `
            <label class="wf-field-label">Tool slug</label>
            <input class="wf-field-input" value="${escapeHtml(node.config.tool_slug || '')}" onchange="updateNodeConfig('tool_slug', this.value)" placeholder="SLACK_SEND_MESSAGE">
            <label class="wf-field-label">Arguments (JSON)</label>
            <textarea class="wf-field-input wf-field-textarea" onchange="updateNodeConfigJSON('arguments', this.value)">${escapeHtml(JSON.stringify(node.config.arguments || {}, null, 2))}</textarea>
        `;
    } else if (node.type === 'action.list_connected_apps') {
        fieldsHtml = `
            <p class="wf-field-hint">No configuration needed — lists every app currently connected on the Connectors page. Reference this node's output (<code>apps</code>) from a later node.</p>
        `;
    } else if (node.type === 'logic.condition') {
        fieldsHtml = `
            <label class="wf-field-label">Source node ID (or "trigger")</label>
            <input class="wf-field-input" value="${escapeHtml(node.config.source_node_id || '')}" onchange="updateNodeConfig('source_node_id', this.value)">
            <label class="wf-field-label">Field path</label>
            <input class="wf-field-input" value="${escapeHtml(node.config.path || '')}" onchange="updateNodeConfig('path', this.value)" placeholder="status.code">
            <label class="wf-field-label">Operator</label>
            <select class="wf-field-input" onchange="updateNodeConfig('operator', this.value)">
                ${['eq', 'neq', 'gt', 'lt', 'contains', 'exists', 'not_exists'].map(op =>
                    `<option value="${op}" ${node.config.operator === op ? 'selected' : ''}>${op}</option>`).join('')}
            </select>
            <label class="wf-field-label">Compare value</label>
            <input class="wf-field-input" value="${escapeHtml(node.config.value ?? '')}" onchange="updateNodeConfig('value', this.value)">
        `;
    }

    panel.innerHTML = `
        <div class="wf-inspector-head">
            <span style="color:${meta.color}"><i class="fas ${meta.icon}"></i></span>
            <span class="wf-inspector-title">${escapeHtml(meta.label || node.type)}</span>
            <button class="wf-inspector-close" onclick="_closeInspector(); wfSelectedNodeId=null; renderWfCanvas();"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="wf-inspector-body">${fieldsHtml}</div>
        <button class="meeting-btn-secondary wf-inspector-delete" onclick="deleteSelectedNode()"><i class="fas fa-trash"></i> Delete node</button>
    `;
}

function updateNodeConfig(path, value) {
    const node = wfNodes.find(n => n.id === wfSelectedNodeId);
    if (!node) return;
    const parts = path.split('.');
    let cursor = node.config;
    for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = cursor[parts[i]] || {};
        cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
    wfDirty = true;
    _renderInspector();
}

function updateNodeConfigJSON(field, rawText) {
    const node = wfNodes.find(n => n.id === wfSelectedNodeId);
    if (!node) return;
    try {
        node.config[field] = JSON.parse(rawText || '{}');
        wfDirty = true;
    } catch (e) {
        _wsToast('Invalid JSON');
    }
}

// =====================================================================
// Workflow-level actions
// =====================================================================
function saveActiveGraph() {
    if (!activeWorkflow) return;
    fetch(`/api/workflows/${encodeURIComponent(activeWorkflow.id)}/graph`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: wfNodes, edges: wfEdges }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        activeWorkflow = data.workflow;
        wfNodes = JSON.parse(JSON.stringify(activeWorkflow.nodes || []));
        wfEdges = JSON.parse(JSON.stringify(activeWorkflow.edges || []));
        wfDirty = false;
        _wsToast('Saved.');
        renderWfCanvas();
        if (wfSelectedNodeId) _renderInspector();
        // Update the left-list card's node count in place -- a full
        // loadWorkflowsView() would re-select this workflow and close the
        // inspector panel just opened above.
        const listEntry = wfList.find(w => w.id === activeWorkflow.id);
        if (listEntry) { listEntry.nodes = activeWorkflow.nodes; listEntry.active = activeWorkflow.active; }
        _renderWfList();
    }).catch(() => _wsToast(t('team_action_failed')));
}

function toggleWorkflowActive(checked) {
    if (!activeWorkflow) return;
    fetch(`/api/workflows/${encodeURIComponent(activeWorkflow.id)}/active`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: checked }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') {
            document.getElementById('wf-active-checkbox').checked = !checked;
            _wsToast(data.message || t('team_action_failed'));
            return;
        }
        activeWorkflow = data.workflow;
        loadWorkflowsView();
    }).catch(() => { document.getElementById('wf-active-checkbox').checked = !checked; });
}

function runActiveWorkflow() {
    if (!activeWorkflow) return;
    if (wfDirty) { _wsToast('Save before running.'); return; }
    fetch(`/api/workflows/${encodeURIComponent(activeWorkflow.id)}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        const failed = (data.results || []).filter(r => r.status === 'error').length;
        _wsToast(`${(data.results || []).length} node(s) ran, ${failed} failed.`);
    }).catch(() => _wsToast(t('team_action_failed')));
}

function renameActiveWorkflow() {
    if (!activeWorkflow) return;
    const name = document.getElementById('wf-name-input').value.trim();
    if (!name) return;
    fetch(`/api/workflows/${encodeURIComponent(activeWorkflow.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        activeWorkflow.name = data.workflow.name;
        loadWorkflowsView();
    }).catch(() => _wsToast(t('team_action_failed')));
}

function deleteActiveWorkflow() {
    if (!activeWorkflow) return;
    if (!window.confirm(`Delete "${activeWorkflow.name}"? This cannot be undone.`)) return;
    fetch(`/api/workflows/${encodeURIComponent(activeWorkflow.id)}`, { method: 'DELETE' })
        .then(r => r.json()).then(data => {
            if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
            activeWorkflow = null;
            document.getElementById('wf-editor').classList.add('hidden');
            loadWorkflowsView();
        }).catch(() => _wsToast(t('team_action_failed')));
}

// =====================================================================
// Create modal
// =====================================================================
function openWorkflowCreateModal() {
    document.getElementById('workflow-name').value = '';
    document.getElementById('workflow-description').value = '';
    document.getElementById('workflow-create-modal').classList.remove('hidden');
    document.getElementById('workflow-create-modal').classList.add('flex');
}

function closeWorkflowCreateModal() {
    document.getElementById('workflow-create-modal').classList.add('hidden');
    document.getElementById('workflow-create-modal').classList.remove('flex');
}

function saveWorkflowCreate() {
    const name = document.getElementById('workflow-name').value.trim();
    if (!name) { _wsToast(t('workflows_name')); return; }
    const description = document.getElementById('workflow-description').value.trim();
    fetch('/api/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
    }).then(r => r.json()).then(data => {
        if (data.status !== 'success') { _wsToast(data.message || t('team_action_failed')); return; }
        closeWorkflowCreateModal();
        loadWorkflowsView();
        selectWorkflow(data.workflow.id);
    }).catch(() => _wsToast(t('team_action_failed')));
}
