/* Android application layer. No terminal commands and no surface-specific server. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const M = window.KaipiModel;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const markdown = window.KaipiRender.markdown;
let state = null, connected = false, requestId = 0, explore = false, sending = false;
let selected = null, zoom = 1, treeLayout = null, collapsed = new Set(), dialogFocus = null;
let attachments = [], live = null, liveFrame = 0, toastTimer, modelConfig, drafts = {}, fileSession = null;
let lastFocus = null, pointerPan = null, pendingAppearance = null;
const pendingRequests = new Map();

function request(op, body = {}) {
  if (!connected) return Promise.reject(new Error('本地引擎尚未连接，请稍候或重新连接。'));
  const id = String(++requestId);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingRequests.delete(id); reject(new Error('操作等待超时，请重新连接后检查状态。')); }, op.startsWith('catalog.') ? 25000 : 30000);
    pendingRequests.set(id, {resolve, reject, timer});
    const json = JSON.stringify({id, op, body});
    if (window.Native) Native.request(json);
    else reject(new Error('请在 Android 应用中打开，或启动开发预览。'));
  });
}
function toast(text) {
  clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}
function fail(error) { toast(error.message || String(error)); }
function rejectPending(text) {
  for (const task of pendingRequests.values()) { clearTimeout(task.timer); task.reject(new Error(text)); }
  pendingRequests.clear();
}
function receive(json) {
  let message;
  try { message = typeof json === 'string' ? JSON.parse(json) : json; } catch { return; }
  if (message.id === 'reconnect') { connected = true; stateReceived(message.result); $('connection').hidden = true; return; }
  if (message.id && pendingRequests.has(String(message.id))) {
    const task = pendingRequests.get(String(message.id)); pendingRequests.delete(String(message.id)); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error)); else task.resolve(message.result);
    return;
  }
  switch (message.event) {
    case 'initializing':
      $('connection').hidden = false; $('connection').className = 'connection';
      $('connection').innerHTML = `<span class="spinner"></span><span>正在准备本地引擎 · ${Math.min(100, Math.max(0, Number(message.data) || 0))}%</span>`;
      break;
    case 'ready':
      if (message.protocol !== 1) return disconnected('运行时版本不兼容，请更新应用。');
      connected = true; $('connection').hidden = true; stateReceived(message.data); break;
    case 'settled': {
      const error = live && live.error;
      live = null; sending = false; stateReceived(message.data);
      if (error) toast(error);
      break;
    }
    case 'turn': turnEvent(message.data); break;
    case 'fatal': disconnected(message.error); break;
    case 'disconnected': disconnected(message.data); break;
    case 'files':
      if (fileSession && fileSession !== state?.session) toast('对话已切换，请重新添加附件。');
      else addAttachments(message.data);
      fileSession = null; break;
    case 'fileError': toast(message.data); break;
    case 'workspaces': workspaceDialog(message.data); break;
  }
}
function disconnected(text) {
  connected = false; sending = false; rejectPending(text); updateComposer();
  $('connection').hidden = false; $('connection').className = 'connection error';
  $('connection').innerHTML = `<span>${esc(text)}</span><button id="retry-engine">重新连接</button>`;
  $('retry-engine').onclick = () => { $('connection').innerHTML = '<span class="spinner"></span><span>正在重新连接…</span>'; if (window.Native) Native.retry(); };
}
function saveDraft() {
  if (!state) return;
  drafts[state.session] = {text: $('draft').value, attachments, explore};
  try { localStorage.setItem('kaipi.drafts', JSON.stringify(Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [id, {text: draft.text, explore: draft.explore}])))); } catch { }
}
function stateReceived(next) {
  if (!next || !next.nodes) return;
  const changed = state && next.session !== state.session;
  const follow = nearBottom() || !state || changed;
  if (changed) { saveDraft(); live = null; sending = false; selected = null; collapsed.clear(); }
  if (pendingAppearance && connected) {
    const value = pendingAppearance; pendingAppearance = null; next.appearance = value;
    request('appearance', value).catch(error => { pendingAppearance = value; fail(error); });
  }
  state = next;
  if (next.appearance) KaipiTheme.apply(next.appearance);
  if (changed || !lastFocus) {
    const draft = drafts[next.session] || {};
    $('draft').value = draft.text || ''; attachments = draft.attachments || []; explore = !!draft.explore;
    lastFocus = next.session; resizeDraft(); renderAttachments();
  }
  renderHeader(); renderSessions(); renderHistory(); renderPending(); updateComposer();
  if ($('app').classList.contains('tree-open')) { renderTree(); if (selected) inspectNode(selected, false); }
  if (follow) scrollBottom(false);
}
function nearBottom() { return $('scroll').scrollHeight - $('scroll').scrollTop - $('scroll').clientHeight < 100; }
function scrollBottom(smooth = true) { requestAnimationFrame(() => { $('scroll').scrollTo({top: $('scroll').scrollHeight, behavior: smooth ? 'smooth' : 'auto'}); }); }
function renderHeader() {
  const status = state.status || {};
  $('model-picker').innerHTML = `<span>${esc(state.configured ? status.model : '选择模型')}</span>${icon('down')}`;
  $('node-count').textContent = state.nodes.length;
  $('tree-total').textContent = String(state.nodes.length).padStart(2, '0');
  const empty = !state.nodes.length;
  $('conversation-heading').hidden = empty;
  $('chat-title').textContent = state.name || '新的对话';
  const path = M.lineage(state.nodes, state.leaf);
  $('chat-subtitle').textContent = `${path.length} 个节点在当前上下文中 · ${state.nodes.length > path.length ? `${state.nodes.length - path.length} 个节点留在分支上` : '为思路留出更多空间'}`;
  const onTrunk = state.leaf === state.trunk && !explore;
  const node = state.nodes.find(n => n.id === state.leaf);
  $('cursor-chip').classList.toggle('exploring', !onTrunk);
  $('cursor-chip').innerHTML = `<span class="status-dot"></span><span>${node ? `${esc(node.label)} · ${onTrunk ? '主干' : '探索分支'}` : '新的起点'}</span>${icon('down')}`;
  $('context-size').textContent = `主干上下文 ${M.tokens(state.burden)} tokens`;
  $('spend').textContent = state.cost > 0 ? `累计 $${Number(state.cost).toFixed(4)}` : 'kaipi · 本地运行';
  $('new-chat').disabled = state.busy;
  $('rename').disabled = state.busy;
  $('welcome').hidden = !empty || !!live;
}
function renderSessions() {
  if (!state) return;
  const query = $('session-search').value.trim().toLowerCase();
  const sessions = state.sessions.filter(s => s.name.toLowerCase().includes(query));
  $('session-count').textContent = state.sessions.length;
  $('sessions').innerHTML = sessions.length ? sessions.map(s => `<button class="session-item ${s.current ? 'active' : ''}" data-session="${esc(s.id)}" ${state.busy ? 'disabled' : ''} ${s.current ? 'aria-current="page"' : ''}>${icon('chat')}<span>${esc(s.name || '新的对话')}</span><small>${s.turns || ''}</small></button>`).join('') : `<p class="session-empty">${query ? '没有找到这个对话' : '新的思路，会留在这里。'}</p>`;
}
function contentHTML(content) {
  let html = '';
  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (item.kind === 'text') html += `<div class="markdown">${markdown(item.text)}</div>`;
    else if (item.kind === 'cmd') {
      const output = content[i + 1] && content[i + 1].kind === 'out' ? content[++i].text : '';
      html += `<details class="tool"><summary>${icon('code')}<code>${esc(item.text)}</code>${icon('down')}</summary><pre>${esc(output || '执行中…')}</pre></details>`;
    }
  }
  return html;
}
function assistantMeta(label, id) { return `<div class="assistant-meta"><span class="assistant-mark">${icon('branch')}</span><strong>kaipi</strong>${id ? `<button class="node-link" data-node="${esc(id)}">${esc(label)} ${icon('tree')}</button>` : '<span class="soft-label">正在思考</span>'}</div>`; }
function renderHistory() {
  if (!state) return;
  const openTools = new Set([...$('messages').querySelectorAll('details[open] summary code')].map(n => n.textContent));
  $('messages').innerHTML = state.history.map(turn => `<article class="turn" data-turn="${esc(turn.id)}"><div class="turn-question"><div class="question-bubble">${esc(turn.input)}</div></div>${assistantMeta(turn.label, turn.id)}${contentHTML(turn.content)}${turn.status === 'aborted' ? '<div class="turn-aborted">已停止，此节点不进入后续上下文。</div>' : ''}<div class="turn-actions"><button class="icon-button" data-copy-turn="${esc(turn.id)}" aria-label="复制回答">${icon('copy')}</button><button class="icon-button" data-branch="${esc(turn.id)}" aria-label="从这里探索">${icon('branch')}</button><button class="icon-button" data-node="${esc(turn.id)}" aria-label="在上下文树中查看">${icon('tree')}</button><span class="turn-cost">${M.tokens(M.usageTotal(turn.usage))} tokens${turn.cost > 0 ? ` · $${turn.cost.toFixed(4)}` : ''}</span></div></article>`).join('');
  $('messages').querySelectorAll('details').forEach(d => { if (openTools.has(d.querySelector('summary code')?.textContent)) d.open = true; });
  decorateCode($('messages'));
  if (live) renderLive();
}
function decorateCode(parent) {
  parent.querySelectorAll('.markdown pre').forEach(pre => {
    if (pre.querySelector('.copy-code')) return;
    const button = document.createElement('button'); button.className = 'copy-code'; button.setAttribute('aria-label', '复制代码'); button.innerHTML = icon('copy');
    button.onclick = () => copy(pre.querySelector('code')?.textContent || ''); pre.prepend(button);
  });
}
function renderLive() {
  if (!live) return;
  const follow = nearBottom();
  let article = $('live-turn');
  if (!article) { article = document.createElement('article'); article.id = 'live-turn'; article.className = 'turn'; $('messages').append(article); }
  article.innerHTML = `<div class="turn-question"><div class="question-bubble">${esc(live.text)}</div></div>${assistantMeta('', '')}<div class="live-content">${contentHTML(live.content)}</div><div class="live-phase" role="status"><span class="pulse-dot"></span><span class="busy-shimmer">${esc(live.phase || '正在思考…')}</span></div>`;
  decorateCode(article);
  if (follow) scrollBottom(false);
}
function turnEvent(event) {
  if (!live) live = {text: '', content: [], phase: '', error: ''};
  switch (event.kind) {
    case 'start': if (state) state.busy = true; break;
    case 'text': live.content.push({kind: 'text', text: event.text}); break;
    case 'cmd': live.content.push({kind: 'cmd', text: event.text}); live.phase = '正在执行命令'; break;
    case 'out': live.content.push({kind: 'out', text: event.text}); break;
    case 'phase': live.phase = event.text; break;
    case 'wait': live.phase = event.text; break;
    case 'error': live.error = event.text; live.phase = '正在保存会话'; break;
    case 'aborted': live.phase = '已停止，正在保存'; break;
    case 'completed': live.phase = '正在整理上下文'; break;
    case 'guard': toast('探索分支修改了工作区文件。请检查变更后再继续。'); break;
    case 'summary_failed': toast('摘要暂不可用，本次将使用节点问答。'); break;
    case 'unpriced': toast('这个模型尚无价格记录，费用显示为估算。'); break;
  }
  if (!liveFrame) liveFrame = requestAnimationFrame(() => { liveFrame = 0; renderLive(); renderHeader(); updateComposer(); });
}
function renderPending() {
  $('pending').innerHTML = state.pending.map(e => {
    const node = state.nodes.find(n => n.id === e.src_id);
    return `<span class="graft-chip">${icon('graft')}<span>嫁接 ${esc(node?.label || e.src_id)} · ${{leaf:'问答','leaf+summary':'问答与摘要',branch:'整条分支'}[e.depth]}</span><button data-unstage="${esc(e.src_id)}" aria-label="移除嫁接" ${state.busy ? 'disabled' : ''}>${icon('close')}</button></span>`;
  }).join('');
}
function renderAttachments() {
  $('attachments').innerHTML = attachments.map((a, index) => `<span class="attachment-chip">${icon('paperclip')}<span>${esc(a.name)}</span><button data-remove-file="${index}" type="button" aria-label="移除 ${esc(a.name)}">${icon('close')}</button></span>`).join('');
  updateComposer();
}
function resizeDraft() { $('draft').style.height = 'auto'; $('draft').style.height = Math.min(180, $('draft').scrollHeight) + 'px'; }
function updateComposer() {
  const busy = !!(state?.busy || sending);
  $('send').disabled = !connected || (!busy && !$('draft').value.trim() && !attachments.length);
  $('send').classList.toggle('stopping', busy);
  $('send').innerHTML = icon(busy ? 'stop' : 'arrow');
  $('send').setAttribute('aria-label', busy ? '停止生成' : '发送消息');
  $('explore-toggle').setAttribute('aria-pressed', String(explore));
  $('explore-toggle').disabled = busy;
  $('attach').disabled = busy || !connected;
  $('draft').placeholder = busy ? '正在生成，你也可以先写下一个想法…' : '写下你的想法…';
}
async function send(event) {
  event.preventDefault();
  if (state?.busy || sending) { await request('stop').catch(fail); return; }
  const text = $('draft').value.trim();
  if (!text && !attachments.length) return;
  if (!state.configured) { toast('先连接一个模型，让对话开始。'); openSettings(); return; }
  const submitted = {text, attachments: attachments.slice(), explore};
  sending = true; updateComposer();
  live = {text: text || submitted.attachments.map(a => a.name).join('、'), content: [], phase: '正在准备上下文'};
  $('welcome').hidden = true; renderLive(); scrollBottom();
  try {
    await request('turn', submitted);
    if ($('draft').value.trim() === text) { $('draft').value = ''; attachments = []; resizeDraft(); renderAttachments(); saveDraft(); }
  } catch (error) {
    sending = false; live = null; renderHistory(); updateComposer(); fail(error);
    request('state').then(stateReceived).catch(() => {});
  }
}
async function mutate(op, body = {}, message = '') {
  const result = await request(op, body);
  stateReceived(result);
  if (message) toast(message);
  return result;
}
function rail(open) { $('app').classList.toggle('rail-open', open); $('app').classList.toggle('rail-hidden', !open); $('sidebar-toggle').setAttribute('aria-expanded', String(open)); }
function tree(open) {
  $('app').classList.toggle('tree-open', open);
  $('tree-toggle').setAttribute('aria-expanded', String(open));
  $('context-panel').inert = !open;
  if (open) { if (matchMedia('(max-width:800px)').matches) rail(false); renderTree(); setTimeout(() => { if (selected) centerNode(selected); else if (state?.leaf) centerNode(state.leaf); }, 370); $('tree-close').focus({preventScroll:true}); }
  else { $('tree-toggle').focus({preventScroll:true}); }
}
function renderTree() {
  if (!state) return;
  treeLayout = M.layoutTree(state.nodes, state.trunk, collapsed, $('show-archived').checked);
  const {positions, trunkIds, width, height} = treeLayout;
  const scaledWidth = width * zoom, scaledHeight = height * zoom;
  const stage = $('tree-stage');
  stage.style.width = scaledWidth + 'px'; stage.style.height = scaledHeight + 'px';
  $('tree-empty').hidden = positions.size > 0;
  if (!positions.size) { stage.innerHTML = ''; return; }
  let edges = '';
  for (const [id, p] of positions) {
    const parent = positions.get(p.node.parent_id);
    if (parent) {
      const x1 = (parent.x + 85) * zoom, y1 = (parent.y + 83) * zoom, x2 = (p.x + 85) * zoom, y2 = p.y * zoom, mid = (y1 + y2) / 2;
      edges += `<path class="tree-edge ${trunkIds.has(id) && trunkIds.has(parent.node.id) ? 'trunk' : ''}" d="M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}"/>`;
    }
  }
  for (const edge of state.edges) {
    const src = positions.get(edge.src_id), dst = positions.get(edge.dst_id);
    if (src && dst) {
      const x1 = (src.x + 170) * zoom, y1 = (src.y + 42) * zoom, x2 = (dst.x + 170) * zoom, y2 = (dst.y + 42) * zoom, curve = Math.max(x1, x2) + 40 * zoom;
      edges += `<path class="tree-edge reference" d="M${x1},${y1} C${curve},${y1} ${curve},${y2} ${x2},${y2}"/>`;
    }
  }
  stage.innerHTML = `<svg aria-hidden="true">${edges}</svg>` + [...positions].map(([id, p]) => {
    const n = p.node, isCurrent = id === state.leaf;
    return `<div style="position:absolute;left:${p.x * zoom}px;top:${p.y * zoom}px;transform:scale(${zoom});transform-origin:0 0;width:170px;height:83px"><button class="tree-node ${isCurrent ? 'current' : ''} ${selected === id ? 'selected' : ''} ${trunkIds.has(id) ? '' : 'off-trunk'} ${esc(n.status)}" data-tree-node="${esc(id)}" aria-label="${esc(n.label)} ${esc(n.input)}${isCurrent ? '，当前位置' : ''}" aria-pressed="${selected === id}"><span class="tree-node-top"><span class="node-number">${esc(n.label)}</span>${id === state.trunk ? `<span class="node-pin">${icon('pin')}主干</span>` : `<span>${n.status === 'archived' ? '已归档' : n.status === 'aborted' ? '已停止' : trunkIds.has(id) ? '主干路径' : '探索'}</span>`}</span><span class="tree-node-title">${esc(n.input || '未完成的回合')}</span><span class="tree-node-bottom"><span>${M.tokens(n.ctx)} ctx</span>${isCurrent ? '<span class="node-current">你在这里</span>' : `<span>${n.grafts.length ? `↳ ${n.grafts.length} 嫁接` : M.tokens(n.own) + ' tokens'}</span>`}</span></button>${p.children ? `<button class="node-collapse" data-collapse="${esc(id)}" aria-label="${collapsed.has(id) ? '展开' : '折叠'} ${esc(n.label)} 的子节点">${collapsed.has(id) ? '+' + p.children : '−'}</button>` : ''}</div>`;
  }).join('');
  $('zoom-level').textContent = Math.round(zoom * 100) + '%';
}
function centerNode(id) {
  const position = treeLayout?.positions.get(id); if (!position) return;
  $('tree-viewport').scrollTo({left: (position.x + 85) * zoom - $('tree-viewport').clientWidth / 2, top: (position.y + 42) * zoom - $('tree-viewport').clientHeight / 2, behavior: 'smooth'});
}
function fitTree() {
  if (!treeLayout?.positions.size) return;
  zoom = Math.max(.45, Math.min(1, ($('tree-viewport').clientWidth - 20) / treeLayout.width, ($('tree-viewport').clientHeight - 20) / treeLayout.height));
  renderTree(); $('tree-viewport').scrollTo({left:0, top:0, behavior:'smooth'});
}
async function inspectNode(id, focus = true) {
  selected = id;
  if (!$('app').classList.contains('tree-open')) tree(true);
  renderTree();
  const n = state.nodes.find(n => n.id === id); if (!n) { $('inspector').hidden = true; return; }
  const s = state.session;
  $('inspector').hidden = false;
  $('inspector').innerHTML = `<div class="inspector-head"><span class="inspector-label">${esc(n.label)}<span>${n.status === 'live' ? (id === state.trunk ? '主干' : '探索节点') : n.status === 'archived' ? '已归档' : '不进入上下文'}</span></span><button id="inspector-close" class="icon-button" aria-label="关闭节点详情">${icon('close')}</button></div><h3>${esc(n.input || '未完成的回合')}</h3><div class="inspector-content"><div class="markdown">${markdown(n.answer || '这个回合没有保存最终回答。')}</div></div><div class="inspector-stats"><span>${M.tokens(n.ctx)} 上下文 tokens</span><span>${n.cost > 0 ? '$' + n.cost.toFixed(4) : M.tokens(n.own) + ' tokens'}</span></div><div class="node-actions"><button class="primary" data-node-action="go" ${n.status !== 'live' || state.busy ? 'disabled' : ''}>${icon('chat')}从这里继续</button><button data-node-action="explore" ${n.status !== 'live' || state.busy ? 'disabled' : ''}>${icon('branch')}从这里探索</button><button data-node-action="graft" ${n.status !== 'live' || state.busy ? 'disabled' : ''}>${icon('graft')}嫁接到当前上下文</button><button data-node-action="pin" ${n.status !== 'live' || state.busy ? 'disabled' : ''}>${icon('pin')}设为主干</button></div><div class="secondary-actions"><button data-node-action="detail">${icon('more')}完整内容</button><button data-node-action="${n.status === 'archived' ? 'restore' : 'archive'}" ${state.busy || !['live','archived'].includes(n.status) ? 'disabled' : ''}>${icon('archive')}${n.status === 'archived' ? '恢复分支' : '归档分支'}</button><button data-node-action="rewind" ${state.busy ? 'disabled' : ''}>${icon('undo')}回退</button></div>`;
  $('inspector-close').onclick = () => { selected = null; $('inspector').hidden = true; renderTree(); };
  if (focus) centerNode(id);
  try {
    const detail = await request('node', {id});
    if (state.session === s && selected === id) $('inspector').dataset.detail = JSON.stringify(detail);
  } catch (error) { if (focus) fail(error); }
}
async function nodeAction(action) {
  const id = selected; if (!id) return;
  try {
    if (action === 'go' || action === 'explore') {
      await mutate('go', {id}); explore = action === 'explore'; renderHeader(); updateComposer(); tree(false); $('draft').focus();
      toast(explore ? '在这里开启探索，主干保持原位。' : '已切换上下文，工作区文件保持原样。');
    } else if (action === 'graft') graftDialog(id);
    else if (action === 'pin') confirmDialog('把这条思路设为主干？', '下一次输入将从这个节点继续，主干可以修改工作区文件。已有的对话和其他分支会保留。', '设为主干', async () => { await mutate('pin', {id}); explore = false; renderHeader(); updateComposer(); toast('已设为主干。'); });
    else if (action === 'archive') confirmDialog('归档这条分支？', '该节点及其子节点将移出上下文。历史和费用记录保留，随时可以恢复。', '归档分支', () => mutate('archive', {id}, '分支已归档，可开启「显示归档」找回。'));
    else if (action === 'restore') await mutate('restore', {id}, '分支已恢复。');
    else if (action === 'rewind') rewindDialog(id);
    else if (action === 'detail') {
      const detail = await request('node', {id});
      showDialog('节点内容', `<p class="dialog-description">${esc(detail.input)}</p>${contentHTML(detail.content)}`, true);
      decorateCode($('dialog'));
    }
  } catch (error) { fail(error); }
}
function showDialog(title, html, wide = false) {
  lastDialogFocus();
  $('overlay').hidden = false; $('dialog').className = 'dialog' + (wide ? ' wide' : '');
  $('dialog').innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${esc(title)}</h2><button id="dialog-close" class="icon-button" aria-label="关闭对话框">${icon('close')}</button></div>${html}`;
  $('dialog-close').onclick = closeDialog;
  $('app').inert = true;
  requestAnimationFrame(() => { const target = $('dialog').querySelector('input:not([type=radio]),textarea') || $('dialog'); target.focus({preventScroll:true}); });
}
function lastDialogFocus() { if ($('overlay').hidden) dialogFocus = document.activeElement; }
function closeDialog() { $('overlay').hidden = true; $('app').inert = false; if (dialogFocus?.isConnected) dialogFocus.focus({preventScroll:true}); }
function confirmDialog(title, description, label, action, danger = false) {
  showDialog(title, `<p class="dialog-description">${esc(description)}</p><div id="dialog-error" class="error-message" role="alert"></div><div class="dialog-footer"><button id="cancel" class="button">取消</button><button id="confirm" class="button ${danger ? 'danger' : 'primary'}">${esc(label)}</button></div>`);
  $('cancel').onclick = closeDialog;
  $('confirm').onclick = async () => {
    $('confirm').disabled = true;
    try { await action(); closeDialog(); } catch (error) { $('dialog-error').textContent = error.message; $('confirm').disabled = false; }
  };
}
async function graftDialog(id) {
  try {
    const preview = await request('preview', {id});
    const label = state.nodes.find(n => n.id === id)?.label || '';
    showDialog('把发现带回当前思路', `<p class="dialog-description">将 ${esc(label)} 的内容带入下一回合。原分支会保留，历史内容不会改写。</p><form id="graft-form">${[['leaf','问答','只带入这个节点的问题与最终回答。'],['leaf+summary','问答与路径摘要','保留发现，以及通往发现的必要背景。'],['branch','整条分支','带入公共祖先之后的全部问答，省略工具输出。']].map(([value,title,desc]) => `<label class="choice"><input type="radio" name="depth" value="${value}" ${value === 'leaf+summary' ? 'checked' : ''}><span>${title}<small>${desc}</small></span><em>${M.tokens(preview.sizes[value])} tokens</em></label>`).join('')}<div id="dialog-error" class="error-message" role="alert"></div><div class="dialog-footer"><button type="button" id="cancel" class="button">取消</button><button class="button primary" type="submit">${icon('graft')}添加嫁接</button></div></form>`);
    $('cancel').onclick = closeDialog;
    $('graft-form').onsubmit = async event => {
      event.preventDefault(); const button = event.submitter || $('graft-form').querySelector('[type=submit]'); button.disabled = true;
      try { await mutate('graft', {id, depth: new FormData($('graft-form')).get('depth')}); closeDialog(); toast('发现已加入下一回合的上下文。'); }
      catch (error) { $('dialog-error').textContent = error.message; button.disabled = false; }
    };
  } catch (error) { fail(error); }
}
async function rewindDialog(id) {
  try {
    const detail = await request('node', {id});
    showDialog('回到这个节点', `<p class="dialog-description">选择要回退的部分。代码回退只影响后续回合修改过的文件，同一文件中的手工修改也会被覆盖。</p><form id="rewind-form">${[['conversation','只回退对话','切换上下文，不修改文件。',detail.status !== 'live'],['code','只回退代码','恢复文件，对话位置不变。',!detail.has_snapshot],['both','对话与代码','从这个节点的对话和文件状态继续。',!detail.has_snapshot || detail.status !== 'live']].map(([value,title,desc,disabled]) => `<label class="choice"><input type="radio" name="mode" value="${value}" ${value === (detail.status === 'live' ? 'conversation' : 'code') ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${title}<small>${desc}${disabled ? ' 当前节点不可用。' : ''}</small></span></label>`).join('')}<div class="path-list">${esc(detail.paths.length ? detail.paths.join('\n') : '没有需要恢复的文件。')}</div><div id="dialog-error" class="error-message" role="alert"></div><div class="dialog-footer"><button id="cancel" type="button" class="button">取消</button><button type="submit" class="button danger">确认回退</button></div></form>`);
    $('cancel').onclick = closeDialog;
    $('rewind-form').onsubmit = async event => {
      event.preventDefault(); const mode = new FormData($('rewind-form')).get('mode');
      if (!mode) return;
      const button = event.submitter || $('rewind-form').querySelector('[type=submit]'); button.disabled = true;
      try { await mutate('rewind', {id, mode}, '已回到选定状态。'); closeDialog(); } catch (error) { $('dialog-error').textContent = error.message; button.disabled = false; }
    };
  } catch (error) { fail(error); }
}
async function openModelPicker() {
  try {
    modelConfig = await request('configuration');
    if (!modelConfig.models.length) return openSettings();
    showDialog('选择模型', `<p class="dialog-description">为下一回合选择模型，历史记录保持原样。</p>${modelConfig.models.map((m, i) => `<button class="model-option ${modelConfig.active === m.provider + '/' + m.id ? 'selected' : ''}" data-model="${i}"><span>${esc(m.id)}<small>${esc(m.provider)}</small></span>${modelConfig.active === m.provider + '/' + m.id ? icon('check') : ''}</button>`).join('')}<div class="dialog-footer"><button id="manage-models" class="button">${icon('settings')}管理模型与服务商</button></div>`);
    $('manage-models').onclick = openSettings;
    $('dialog').querySelectorAll('[data-model]').forEach(button => button.onclick = async () => {
      const m = modelConfig.models[button.dataset.model];
      try { await mutate('model', {provider:m.provider, model:m.id}); closeDialog(); } catch (error) { fail(error); }
    });
  } catch (error) { fail(error); }
}
const providerName = id => ({anthropic:'Anthropic',openai:'OpenAI',gemini:'Google Gemini',deepseek:'DeepSeek',kimi:'Kimi',ollama:'Ollama'}[id] || id);
async function openSettings() {
  if (state?.busy) return toast('先停止或等待当前回合结束，再修改模型设置。');
  try {
    modelConfig = await request('configuration');
    showDialog('模型与设置', `<p class="dialog-description">连接你选择的模型。配置保存在本机，只有模型请求会发送到你配置的服务商。</p><div class="provider-tabs"><select id="provider-select" aria-label="服务商">${modelConfig.providers.map(p => `<option value="${esc(p.id)}">${esc(providerName(p.id))}${p.configured ? ' · 已连接' : ''}</option>`).join('')}</select></div><div id="provider-fields"></div><div class="settings-divider"></div><div class="inline-note">kaipi 0.2.0 · 本地核心<br>对话和工作区文件保存在此设备。图片与 Office 附件的部分原生解析依赖尚未移植，发送前会验证文件支持情况。</div>`);
    const currentProvider = modelConfig.active.split('/')[0];
    if (modelConfig.providers.some(p => p.id === currentProvider)) $('provider-select').value = currentProvider;
    $('provider-select').onchange = providerFields; providerFields();
  } catch (error) { fail(error); }
}
function providerFields() {
  const p = modelConfig.providers.find(item => item.id === $('provider-select').value);
  $('provider-fields').innerHTML = `<form id="provider-form" class="provider-form"><label class="field">服务地址<input id="provider-url" type="url" value="${esc(p.url)}" spellcheck="false" autocomplete="off" required></label><label class="field">API key<input id="provider-key" type="password" autocomplete="new-password" placeholder="${p.has_key ? '已保存 · 留空保留现有 key' : p.needs_key ? '填写服务商提供的 API key' : '此服务无需 key'}"><small>保存在应用私有目录，不进入对话或工作区。</small></label><label class="field">模型 ID<textarea id="provider-models" rows="2" spellcheck="false" placeholder="${esc(p.suggested.slice(0,3).join(', '))}">${esc(p.models.length ? p.models.join(', ') : p.suggested.slice(0,3).join(', '))}</textarea><small>使用英文逗号分隔。可填写服务商支持的自定义模型 ID。</small></label><div id="provider-error" class="error-message" role="alert"></div><button id="provider-save" class="button primary" type="submit">${icon('check')}保存连接</button></form><div class="provider-actions"><button id="catalog-refresh">刷新模型与价格</button>${p.configured ? '<button id="provider-remove" class="remove-provider">移除连接</button>' : ''}</div>`;
  $('provider-form').onsubmit = async event => {
    event.preventDefault(); $('provider-save').disabled = true;
    try {
      await mutate('provider.save', {provider:p.id, url:$('provider-url').value.trim(), key:$('provider-key').value, models:$('provider-models').value});
      closeDialog(); toast('连接已保存。可以开始对话了。');
    } catch (error) { $('provider-error').textContent = error.message; $('provider-save').disabled = false; }
  };
  $('provider-remove')?.addEventListener('click', () => confirmDialog('移除服务商连接？', '删除本机保存的地址、key 和模型列表。历史对话仍然保留。', '移除连接', () => mutate('provider.remove', {provider:p.id}), true));
  $('catalog-refresh').onclick = async () => {
    $('catalog-refresh').disabled = true; $('catalog-refresh').textContent = '正在获取模型目录…';
    try {
      const preview = await request('catalog.preview', {provider:p.id});
      confirmDialog('更新模型目录', `将保留现有与自定义模型，更新后的列表包含 ${preview.models.length} 个模型。确认后保存模型与价格。`, '保存更新', () => mutate('catalog.save', preview, '模型与价格已更新。'));
    } catch (error) { $('provider-error').textContent = error.message; $('catalog-refresh').disabled = false; $('catalog-refresh').textContent = '刷新模型与价格'; }
  };
}
function openAppearance() {
  showDialog('外观与色彩', `<p class="dialog-description">选择一种舒服的阅读氛围。更改即时生效，也会保存下来。</p><div class="appearance-label">明暗模式</div><div class="appearance-modes" id="appearance-modes"></div><div class="appearance-label">强调色</div><div class="appearance-colors" id="appearance-colors"></div><div class="appearance-preview"><span class="preview-tag">${icon('branch')} 为思路留出空间</span><h3>让一个想法，自由生长。</h3><p>在分支中探索，在主干上创造。<br>让界面退后，让内容走到前面。</p></div><p class="theme-note" id="theme-note"></p>`);
  renderAppearance();
}
function renderAppearance() {
  const preference = KaipiTheme.current();
  $('appearance-modes').innerHTML = [['system','system','跟随系统'],['light','sun','浅色'],['dark','moon','深色']].map(([mode,symbol,label]) => `<button class="appearance-mode ${preference.mode === mode ? 'selected' : ''}" data-mode="${mode}" aria-pressed="${preference.mode === mode}">${icon(symbol)}${label}</button>`).join('');
  $('appearance-colors').innerHTML = [['forest','松绿','#547849'],['indigo','靛蓝','#53648e'],['clay','陶土','#91634b']].map(([color,label,swatch]) => `<button class="color-option ${preference.color === color ? 'selected' : ''}" data-color="${color}" aria-pressed="${preference.color === color}"><span class="color-swatch" style="--swatch:${swatch}">${preference.color === color ? icon('check') : ''}</span>${label}</button>`).join('');
  $('theme-note').textContent = preference.mode === 'system' ? '将随系统自动切换浅色与深色。' : '主题已应用，关闭后仍会保留。';
  $('appearance-modes').querySelectorAll('button').forEach(button => button.onclick = () => changeAppearance({...KaipiTheme.current(),mode:button.dataset.mode}));
  $('appearance-colors').querySelectorAll('button').forEach(button => button.onclick = () => changeAppearance({...KaipiTheme.current(),color:button.dataset.color}));
}
async function changeAppearance(value) {
  KaipiTheme.apply(value); renderAppearance();
  if (state) state.appearance = value;
  if (!connected) pendingAppearance = value;
  else try { await request('appearance', value); } catch (error) { pendingAppearance = value; fail(error); }
}

function renameDialog() {
  if (!state || state.busy) return;
  showDialog('给这段思路起个名字', `<form id="rename-form"><label class="field">对话名称<input id="rename-input" value="${esc(state.name || '')}" maxlength="80" required></label><div id="dialog-error" class="error-message" role="alert"></div><div class="dialog-footer"><button id="cancel" type="button" class="button">取消</button><button type="submit" class="button primary">保存名称</button></div></form>`);
  $('cancel').onclick = closeDialog;
  $('rename-form').onsubmit = async event => { event.preventDefault(); try { await mutate('rename', {name:$('rename-input').value}); closeDialog(); } catch (error) { $('dialog-error').textContent = error.message; } };
}
function workspaceDialog(items) {
  if (!items.length) return toast('当前只有一个本地工作区。');
  showDialog('本地工作区', `<p class="dialog-description">旧版终端的工作区与历史都已保留。切换工作区后，可在对话列表继续原来的思路。</p>${items.map(w => `<button class="model-option" data-workspace="${esc(w.id)}">${icon('folder')}<span>${esc(w.name)}</span>${icon('right')}</button>`).join('')}`);
  $('dialog').querySelectorAll('[data-workspace]').forEach(button => button.onclick = () => {
    if (state?.busy) return toast('请先结束当前回合再切换工作区。');
    saveDraft(); connected = false; rejectPending('正在切换工作区'); closeDialog();
    $('connection').hidden = false; $('connection').className = 'connection'; $('connection').innerHTML = '<span class="spinner"></span><span>正在打开工作区…</span>';
    Native.workspace(button.dataset.workspace);
  });
}
async function addAttachments(files) {
  const targetSession = state?.session;
  if (attachments.length + files.length > 8) return toast('每条消息最多添加 8 个附件。');
  try {
    const all = [...attachments, ...files];
    await request('attachments', {attachments:all});
    if (targetSession !== state?.session) return toast('对话已切换，请重新添加附件。');
    attachments = all; renderAttachments(); saveDraft();
  } catch (error) { fail(error); }
}
async function readFiles(files) {
  const targetSession = state?.session;
  if (files.length + attachments.length > 8) return toast('每条消息最多添加 8 个附件。');
  let total = attachments.reduce((sum,a) => sum + a.data.length * .75, 0);
  const result = [];
  try {
    for (const file of files) {
      total += file.size;
      if (file.size > 20 * 1024 * 1024 || total > 40 * 1024 * 1024) throw new Error('附件过大：单个最多 20 MiB，合计最多 40 MiB。');
      const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      result.push({name:file.name || '附件', data});
    }
    if (state?.session !== targetSession) return toast('对话已切换，请重新添加附件。');
    await addAttachments(result);
  } catch (error) { fail(error); }
}
async function copy(text) {
  try {
    if (window.Native?.copy) Native.copy(text);
    else await navigator.clipboard.writeText(text);
    toast('已复制。');
  } catch { toast('复制暂不可用。'); }
}
function back() {
  if (!$('overlay').hidden) closeDialog();
  else if ($('app').classList.contains('tree-open')) tree(false);
  else if ($('app').classList.contains('rail-open')) rail(false);
  else if (document.activeElement === $('draft')) $('draft').blur();
  else return false;
  return true;
}
$('composer').onsubmit = send;
$('draft').oninput = () => { resizeDraft(); updateComposer(); saveDraft(); };
$('draft').onkeydown = event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !matchMedia('(pointer:coarse)').matches) { event.preventDefault(); if (state?.busy || sending) toast('当前回合结束后可以发送，草稿会保留。'); else send(event); }
};
$('explore-toggle').onclick = () => { explore = !explore; updateComposer(); if (state) renderHeader(); saveDraft(); };
$('sidebar-toggle').onclick = () => rail(!$('app').classList.contains('rail-open'));
$('sidebar-close').onclick = () => rail(false); $('scrim').onclick = () => rail(false);
$('tree-toggle').onclick = () => tree(!$('app').classList.contains('tree-open'));
$('tree-close').onclick = () => tree(false); $('welcome-tree').onclick = () => tree(true); $('cursor-chip').onclick = () => { tree(true); if (state?.leaf) inspectNode(state.leaf); };
$('new-chat').onclick = async () => { try { saveDraft(); await mutate('new'); rail(false); $('draft').focus(); } catch (error) { fail(error); } };
$('settings').onclick = openSettings; $('appearance-button').onclick = openAppearance; $('model-picker').onclick = openModelPicker; $('rename').onclick = renameDialog;
$('session-search').oninput = renderSessions;
$('workspace').onclick = () => { if (window.Native?.workspaces) Native.workspaces(); else toast('本地工作区'); };
$('sessions').onclick = async event => { const button = event.target.closest('[data-session]'); if (!button) return; try { saveDraft(); await mutate('resume', {id:button.dataset.session}); rail(false); } catch (error) { fail(error); } };
$('messages').onclick = async event => {
  const node = event.target.closest('[data-node]'), branch = event.target.closest('[data-branch]'), copyTurn = event.target.closest('[data-copy-turn]');
  if (node) inspectNode(node.dataset.node);
  if (branch) { selected = branch.dataset.branch; await nodeAction('explore'); }
  if (copyTurn) { const turn = state.history.find(t => t.id === copyTurn.dataset.copyTurn); if (turn) copy(turn.content.filter(c => c.kind === 'text').map(c => c.text).join('\n\n')); }
};
$('tree-stage').onclick = event => {
  const button = event.target.closest('[data-tree-node]'), collapse = event.target.closest('[data-collapse]');
  if (button) inspectNode(button.dataset.treeNode);
  if (collapse) { const id = collapse.dataset.collapse; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); renderTree(); }
};
$('inspector').onclick = event => { const button = event.target.closest('[data-node-action]'); if (button && !button.disabled) nodeAction(button.dataset.nodeAction); };
$('pending').onclick = event => { const button = event.target.closest('[data-unstage]'); if (button) mutate('unstage', {id:button.dataset.unstage}).catch(fail); };
$('attachments').onclick = event => { const button = event.target.closest('[data-remove-file]'); if (button) { attachments.splice(Number(button.dataset.removeFile),1); renderAttachments(); saveDraft(); } };
$('zoom-out').onclick = () => { zoom = Math.max(.4, zoom - .15); renderTree(); };
$('zoom-in').onclick = () => { zoom = Math.min(1.6, zoom + .15); renderTree(); };
$('tree-fit').onclick = fitTree;
$('tree-current').onclick = () => { if (state?.leaf) { collapsed.clear(); renderTree(); centerNode(state.leaf); } };
$('show-archived').onchange = renderTree;
$('overlay').onclick = event => { if (event.target === $('overlay')) closeDialog(); };
$('attach').onclick = () => { fileSession = state?.session; if (window.Native?.pickFile) Native.pickFile(); else $('file-input').click(); };
$('file-input').onchange = () => { readFiles([...$('file-input').files]); $('file-input').value = ''; };
document.querySelectorAll('.starter').forEach(button => button.onclick = () => { $('draft').value = button.dataset.prompt; resizeDraft(); updateComposer(); $('draft').focus(); saveDraft(); });
$('scroll').onscroll = () => { $('jump-bottom').hidden = nearBottom(); };
$('jump-bottom').onclick = () => scrollBottom();
$('tree-viewport').addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.target.closest('button')) return;
  pointerPan = {x:event.clientX,y:event.clientY,left:$('tree-viewport').scrollLeft,top:$('tree-viewport').scrollTop}; $('tree-viewport').setPointerCapture(event.pointerId);
});
$('tree-viewport').addEventListener('pointermove', event => { if (pointerPan) { $('tree-viewport').scrollLeft = pointerPan.left - event.clientX + pointerPan.x; $('tree-viewport').scrollTop = pointerPan.top - event.clientY + pointerPan.y; } });
$('tree-viewport').addEventListener('pointerup', () => { pointerPan = null; });
$('tree-viewport').addEventListener('pointercancel', () => { pointerPan = null; });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') back();
  if (event.key === 'Tab' && !$('overlay').hidden) {
    const focusable = [...$('dialog').querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select,a[href]')];
    const first = focusable[0], last = focusable[focusable.length-1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === $('dialog'))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
document.addEventListener('click', event => { const anchor = event.target.closest('.markdown a'); if (anchor) { event.preventDefault(); copy(anchor.getAttribute('href')); } });
document.addEventListener('paste', event => { if (event.clipboardData?.files.length && $('overlay').hidden) { event.preventDefault(); readFiles([...event.clipboardData.files]); } });
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', event => { event.preventDefault(); document.body.classList.remove('dragging'); if (event.dataTransfer.files.length) readFiles([...event.dataTransfer.files]); });
window.addEventListener('beforeunload', saveDraft);
try { drafts = JSON.parse(localStorage.getItem('kaipi.drafts') || '{}'); } catch { }
window.kaipi = {receive, back};
if (matchMedia('(min-width:801px)').matches) rail(true);
if (window.Native) Native.ready();
else disconnected('请在 Android 应用中打开，或连接本地开发预览。');
})();
