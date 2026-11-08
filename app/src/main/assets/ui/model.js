/* Pure presentation helpers. Session validation always remains in core. */
(function (root) {
  'use strict';
  function lineage(nodes, leaf) {
    const byId = new Map(nodes.map(n => [n.id, n])), path = [], seen = new Set();
    while (leaf && byId.has(leaf) && !seen.has(leaf)) {
      seen.add(leaf); const n = byId.get(leaf); path.unshift(n); leaf = n.parent_id;
    }
    return path;
  }
  function layoutTree(nodes, trunk, collapsed = new Set(), showArchived = false) {
    const visible = nodes.filter(n => showArchived || n.status !== 'archived');
    const byId = new Map(visible.map(n => [n.id, n])), children = new Map();
    const trunkIds = new Set(lineage(nodes, trunk).map(n => n.id));
    for (const n of visible) {
      const parent = byId.has(n.parent_id) ? n.parent_id : null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(n);
    }
    for (const list of children.values()) list.sort((a, b) => Number(trunkIds.has(b.id)) - Number(trunkIds.has(a.id)) || a.seq - b.seq);
    let column = 0, depthMax = 0;
    const positions = new Map(), visiting = new Set();
    function walk(node, depth) {
      if (visiting.has(node.id)) return null;
      visiting.add(node.id); depthMax = Math.max(depth, depthMax);
      const descendants = collapsed.has(node.id) ? [] : (children.get(node.id) || []);
      const xs = descendants.map(child => walk(child, depth + 1)).filter(x => x !== null);
      const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : column++ * 204;
      positions.set(node.id, {x: x + 34, y: depth * 128 + 38, node, children: (children.get(node.id) || []).length});
      return x;
    }
    for (const node of children.get(null) || []) walk(node, 0);
    return {positions, trunkIds, width: Math.max(300, column * 204 + 34), height: (depthMax + 1) * 128 + 36};
  }
  function tokens(n) { return n >= 1000000 ? (n / 1000000).toFixed(1) + 'm' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n || 0)); }
  function usageTotal(u) { return ['input_uncached', 'cache_write', 'cache_read', 'output'].reduce((n, key) => n + (Number((u || {})[key]) || 0), 0); }
  const api = {lineage, layoutTree, tokens, usageTotal};
  if (typeof module !== 'undefined') module.exports = api;
  else root.KaipiModel = api;
})(typeof window === 'undefined' ? globalThis : window);
