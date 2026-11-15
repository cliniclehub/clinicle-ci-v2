/* Org Graph: read-only org -> teams -> agents map. See
 * agent/workspace/org_graph.py for the {nodes, edges} shape this renders --
 * one "org" node, one "team" node per team tagged with this org (task_counts
 * summarizes that team's board, it is not a second Task Board), one "agent"
 * node per distinct agent across those teams (deduped, so an agent on two
 * teams is one node with two edges).
 *
 * Unlike views/workflows.js this canvas is never edited -- no node picker,
 * no inspector, no drag-to-connect. Only the D3 zoom/pan setup is reused
 * (see _initOgCanvasOnce, same shape as workflows.js's _initCanvasOnce);
 * everything node/edge-shaped below is written fresh for a read-only map.
 */

const OG_NODE_W = 150;
const OG_NODE_H = 50;
const OG_ROW_Y = { org: 50, team: 210, agent: 370 };

let ogSvg = null, ogZoom = null, ogZoomGroup = null, ogEdgesLayer = null, ogNodesLayer = null;
let ogGraph = { nodes: [], edges: [] };

function loadOrgGraphView() {
    fetch('/api/org/graph').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        const applicable = data.applicable !== false;
        document.getElementById('og-not-applicable').classList.toggle('hidden', applicable);
        document.getElementById('og-canvas-wrap').classList.toggle('hidden', !applicable);
        if (!applicable) return;

        ogGraph = { nodes: data.nodes || [], edges: data.edges || [] };
        const empty = ogGraph.nodes.filter(n => n.type !== 'org').length === 0;
        document.getElementById('og-empty').classList.toggle('hidden', !empty);
        _initOgCanvasOnce();
        _layoutOgGraph();
        _renderOgCanvas();
        // This is the whole org's map -- every team lands on the exact same
        // page, so a team-scoped entry point (the Teams rail's sitemap icon)
        // stashes which node to land on instead of an unfocused default view.
        const focusTeamId = window._ogFocusTeamId;
        window._ogFocusTeamId = null;
        const focusNode = focusTeamId && _ogNodeById(focusTeamId);
        if (focusNode) _focusOgNode(focusNode); else _centerOgCanvas();
    }).catch(() => {});
}

function _focusOgNode(node) {
    ogNodesLayer.selectAll('g.og-node').classed('og-node-focused', d => d.id === node.id);
    const width = ogSvg.node().clientWidth || 800;
    const height = ogSvg.node().clientHeight || 600;
    ogSvg.call(ogZoom.transform,
        d3.zoomIdentity.translate(width / 2 - node.position.x, height / 2 - node.position.y));
}

// =====================================================================
// Canvas setup (D3 zoom/pan) -- same primitive as views/workflows.js's
// _initCanvasOnce, kept separate since this view has its own layer ids
// and no shared mutable state with the editable canvas.
// =====================================================================
function _initOgCanvasOnce() {
    if (ogSvg) return;
    ogSvg = d3.select('#og-canvas');
    ogZoomGroup = ogSvg.append('g').attr('class', 'og-zoom-group');
    ogEdgesLayer = ogZoomGroup.append('g').attr('class', 'og-edges-layer');
    ogNodesLayer = ogZoomGroup.append('g').attr('class', 'og-nodes-layer');

    ogZoom = d3.zoom().scaleExtent([0.3, 2]).on('zoom', (event) => {
        ogZoomGroup.attr('transform', event.transform);
    });
    ogSvg.call(ogZoom).on('dblclick.zoom', null);
}

// _layoutOgGraph centers every row on x=0, so without an initial pan the
// leftmost half of the graph renders off the SVG's left edge (x=0 is the
// viewport's left edge, not its middle). Centers the origin in the visible
// canvas instead -- called once per view load, after the SVG has its real
// size, not from _initOgCanvasOnce (which can run before layout).
function _centerOgCanvas() {
    const width = ogSvg.node().clientWidth || 800;
    ogSvg.call(ogZoom.transform, d3.zoomIdentity.translate(width / 2, 80));
}

// A deterministic row layout, not a force simulation -- an org's map is a
// few teams and a handful of agents, not a large graph worth a physics
// engine for. Each row is centered and evenly spaced; an agent shared by
// several teams still gets exactly one slot in the agent row (ogGraph.nodes
// already deduped it), edges to it may cross other teams' edges and that is
// fine on a map this small.
function _layoutOgGraph() {
    const byType = { org: [], team: [], agent: [] };
    ogGraph.nodes.forEach(n => { (byType[n.type] || byType.agent).push(n); });
    Object.keys(byType).forEach(type => {
        const row = byType[type];
        const gap = OG_NODE_W + 40;
        const totalWidth = Math.max(0, (row.length - 1) * gap);
        row.forEach((n, i) => {
            n.position = { x: i * gap - totalWidth / 2, y: OG_ROW_Y[type] };
        });
    });
}

function _ogNodeById(id) {
    return ogGraph.nodes.find(n => n.id === id);
}

const OG_TYPE_META = {
    org:   { icon: 'fa-building', color: '#8b5cf6' },
    team:  { icon: 'fa-people-group', color: '#2E9FDC' },
    agent: { icon: 'fa-robot', color: '#22c55e' },
};

function _renderOgCanvas() {
    _renderOgEdges();
    _renderOgNodes();
}

function _renderOgEdges() {
    const sel = ogEdgesLayer.selectAll('path.og-edge').data(ogGraph.edges, (d, i) => `${d.source}->${d.target}-${i}`);
    sel.exit().remove();
    sel.enter().append('path').attr('class', 'og-edge')
        .merge(sel)
        .attr('d', d => {
            const source = _ogNodeById(d.source), target = _ogNodeById(d.target);
            if (!source || !target) return '';
            const x1 = source.position.x, y1 = source.position.y + OG_NODE_H / 2;
            const x2 = target.position.x, y2 = target.position.y - OG_NODE_H / 2;
            const midY = (y1 + y2) / 2;
            return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
        });
}

function _ogTaskBadge(node) {
    if (node.type !== 'team' || !node.task_counts) return '';
    const total = Object.values(node.task_counts).reduce((a, b) => a + b, 0);
    if (!total) return '';
    const done = node.task_counts.done || 0;
    return `<span class="og-task-badge">${done}/${total}</span>`;
}

function _renderOgNodes() {
    const sel = ogNodesLayer.selectAll('g.og-node').data(ogGraph.nodes, d => d.id);
    sel.exit().remove();
    const entered = sel.enter().append('g').attr('class', d => `og-node og-node-${d.type}`);
    entered.append('rect').attr('width', OG_NODE_W).attr('height', OG_NODE_H).attr('rx', 10);
    entered.append('text').attr('class', 'og-node-icon').attr('x', 14).attr('y', OG_NODE_H / 2 + 5);
    entered.append('text').attr('class', 'og-node-label').attr('x', 38).attr('y', OG_NODE_H / 2 + 5);
    // Right-aligned next to the label, not stacked below it -- OG_NODE_H is
    // too short to stack a second row without overlapping the label text.
    // D3's append('xhtml:div') creates a plain <div> in the HTML namespace;
    // its actual tag name has no "xhtml:" prefix, so re-selecting it with
    // that prefix in the selector matches nothing and .html() silently no-ops.
    entered.append('foreignObject').attr('class', 'og-node-badge-wrap')
        .attr('x', OG_NODE_W - 46).attr('y', OG_NODE_H / 2 - 10).attr('width', 42).attr('height', 20)
        .append('xhtml:div');

    const merged = entered.merge(sel);
    merged.attr('transform', d => `translate(${d.position.x - OG_NODE_W / 2}, ${d.position.y - OG_NODE_H / 2})`);
    merged.select('rect').attr('fill', d => (OG_TYPE_META[d.type] || {}).color || '#64748b')
        .attr('fill-opacity', 0.12).attr('stroke', d => (OG_TYPE_META[d.type] || {}).color || '#64748b');
    merged.select('.og-node-icon').text(d => _faUnicodeForOg((OG_TYPE_META[d.type] || {}).icon));
    merged.select('.og-node-label').each(function (d) { _fitOgLabel(this, d.label); });
    merged.select('.og-node-badge-wrap div').html(d => _ogTaskBadge(d));
}

// Labels are free-text agent/team names of arbitrary length, but the box is
// a fixed OG_NODE_W -- without clipping, a long name overflows the rect and
// overlaps neighboring nodes (see screenshot: "AI Financial Controller &
// Internal Audit" bleeding into the next box). Truncate to the node's
// actual available width with an ellipsis, and keep the full name in a
// <title> tooltip so nothing is actually lost.
const OG_LABEL_X = 38;
const OG_LABEL_RIGHT_PAD = 8;
function _fitOgLabel(textNode, label) {
    const el = d3.select(textNode);
    el.selectAll('title').remove();
    el.text(label);
    const maxWidth = OG_NODE_W - OG_LABEL_X - OG_LABEL_RIGHT_PAD;
    if (textNode.getComputedTextLength() <= maxWidth) return;
    el.append('title').text(label);
    let truncated = label;
    while (truncated.length > 1 && textNode.getComputedTextLength() > maxWidth) {
        truncated = truncated.slice(0, -1);
        el.text(truncated + '…');
    }
}

// Font Awesome glyphs via CSS content normally, but this canvas draws plain
// SVG <text> for icons (same approach as workflows.js's _faUnicode) rather
// than embedding an <i> tag inside SVG.
const OG_ICON_UNICODE = { 'fa-building': '', 'fa-people-group': '', 'fa-robot': '' };
function _faUnicodeForOg(iconClass) {
    return OG_ICON_UNICODE[iconClass] || '';
}
