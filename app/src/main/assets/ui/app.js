/* Android application layer. No terminal commands and no surface-specific server. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const M = window.KaipiModel;
const {text:uiText,html:uiHtml} = window.KaipiLocale;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const markdown = window.KaipiRender.markdown;
let state = null, connected = false, requestId = 0, explore = false, sending = false;
let selected = null, zoom = 1, treeLayout = null, collapsed = new Set(), dialogFocus = null;
let attachments = [], live = null, liveFrame = 0, toastTimer, modelConfig, drafts = {}, fileSession = null;
let lastFocus = null, pointerPan = null, pendingAppearance = null;
const pendingRequests = new Map();
let onboardingStep = null, chosenLanguage = null, pendingPreferences = null, preferenceWrite = null;
let providerSelection = null, providerDrafts = new Map(), providerEpoch = 0;

function request(op, body = {}) {
  if (!connected) return Promise.reject(new Error(uiText('本地引擎尚未连接，请稍候或重新连接。')));
  const id = String(++requestId);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingRequests.delete(id); reject(new Error(uiText('操作等待超时，请重新连接后检查状态。'))); }, op.startsWith('catalog.') ? 25000 : 30000);
    pendingRequests.set(id, {resolve, reject, timer});
    const json = JSON.stringify({id, op, body});
    if (window.Native) Native.request(json);
    else reject(new Error(uiText('请在 Android 应用中打开，或启动开发预览。')));
  });
}
function toast(text) {
  text = uiText(text);
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
      if (!connected) renderEngineStatus();
      break;
    case 'ready':
      if (message.protocol !== 1) return disconnected(uiText('运行时版本不兼容，请更新应用。'));
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
      if (fileSession && fileSession !== state?.session) toast(uiText('对话已切换，请重新添加附件。'));
      else addAttachments(message.data);
      fileSession = null; break;
    case 'fileError': toast(message.data); break;
    case 'workspaces': workspaceDialog(message.data); break;
  }
}
function disconnected(text) {
  connected = false; sending = false; rejectPending(text); updateComposer();
  $('connection').hidden = false; $('connection').className = 'connection error';
  toast(uiText(text));
  $('connection').innerHTML = uiHtml`<span>引擎连接中断</span><button id="retry-engine">重新连接</button>`;
  $('retry-engine').onclick = () => { renderEngineStatus(); if (window.Native) Native.retry(); };
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
  reconcilePreferences(next.preferences);
  if (next.appearance) KaipiTheme.apply(next.appearance);
  if (changed || !lastFocus) {
    const draft = drafts[next.session] || {};
    $('draft').value = draft.text || ''; attachments = draft.attachments || []; explore = !!draft.explore;
    lastFocus = next.session; resizeDraft(); renderAttachments();
  }
  renderHeader(); renderSessions(); renderHistory(); renderPending(); updateComposer();
  if ($('app').classList.contains('tree-open')) { renderTree(); if (selected) inspectNode(selected, false); }
  if (follow) scrollBottom(false);
  updateOnboarding();
}
function nearBottom() { return $('scroll').scrollHeight - $('scroll').scrollTop - $('scroll').clientHeight < 100; }
function scrollBottom(smooth = true) { requestAnimationFrame(() => { $('scroll').scrollTo({top: $('scroll').scrollHeight, behavior: smooth ? 'smooth' : 'auto'}); }); }
function renderHeader() {
  const status = state.status || {};
  $('model-picker').innerHTML = `<span>${esc(state.configured ? status.model : uiText('选择模型'))}</span>${icon('down')}`;
  $('node-count').textContent = state.nodes.length;
  $('tree-total').textContent = String(state.nodes.length).padStart(2, '0');
  const empty = !state.nodes.length;
  $('conversation-heading').hidden = empty;
  $('chat-title').textContent = state.name || uiText('新的对话');
  const path = M.lineage(state.nodes, state.leaf);
  $('chat-subtitle').textContent = uiHtml`${path.length} 个节点在当前上下文中 · ${state.nodes.length > path.length ? uiHtml`${state.nodes.length - path.length} 个节点留在分支上` : uiText('为思路留出更多空间')}`;
  const onTrunk = state.leaf === state.trunk && !explore;
  const node = state.nodes.find(n => n.id === state.leaf);
  $('cursor-chip').classList.toggle('exploring', !onTrunk);
  $('cursor-chip').innerHTML = `<span class="status-dot"></span><span>${node ? `${esc(node.label)} · ${onTrunk ? uiText('主干') : uiText('探索分支')}` : uiText('新的起点')}</span>${icon('down')}`;
  $('context-size').textContent = uiHtml`主干上下文 ${M.tokens(state.burden)} tokens`;
  $('spend').textContent = state.cost > 0 ? uiHtml`累计 $${Number(state.cost).toFixed(4)}` : uiText('kaipi · 本地运行');
  $('new-chat').disabled = state.busy;
  $('rename').disabled = state.busy;
  $('welcome').hidden = !empty || !!live;
}
function renderSessions() {
  if (!state) return;
  const query = $('session-search').value.trim().toLowerCase();
  const sessions = state.sessions.filter(s => s.name.toLowerCase().includes(query));
  $('session-count').textContent = state.sessions.length;
  $('sessions').innerHTML = sessions.length ? sessions.map(s => `<button class="session-item ${s.current ? 'active' : ''}" data-session="${esc(s.id)}" ${state.busy ? 'disabled' : ''} ${s.current ? 'aria-current="page"' : ''}>${icon('chat')}<span>${esc(s.name || uiText('新的对话'))}</span><small>${s.turns || ''}</small></button>`).join('') : `<p class="session-empty">${query ? uiText('没有找到这个对话') : uiText('新的思路，会留在这里。')}</p>`;
}
function contentHTML(content) {
  let html = '';
  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (item.kind === 'text') html += `<div class="markdown">${markdown(item.text)}</div>`;
    else if (item.kind === 'cmd') {
      const output = content[i + 1] && content[i + 1].kind === 'out' ? content[++i].text : '';
      html += `<details class="tool"><summary>${icon('code')}<code>${esc(item.text)}</code>${icon('down')}</summary><pre>${esc(output || uiText('执行中…'))}</pre></details>`;
    }
  }
  return html;
}
function assistantMeta(label, id) { return `<div class="assistant-meta"><span class="assistant-mark">${brandImage()}</span><strong>kaipi</strong>${id ? `<button class="node-link" data-node="${esc(id)}">${esc(label)} ${icon('tree')}</button>` : uiText('<span class="soft-label">正在思考</span>')}</div>`; }
function renderHistory() {
  if (!state) return;
  const openTools = new Set([...$('messages').querySelectorAll('details[open] summary code')].map(n => n.textContent));
  $('messages').innerHTML = state.history.map(turn => uiHtml`<article class="turn" data-turn="${esc(turn.id)}"><div class="turn-question"><div class="question-bubble">${esc(turn.input)}</div></div>${assistantMeta(turn.label, turn.id)}${contentHTML(turn.content)}${turn.status === 'aborted' ? uiText('<div class="turn-aborted">已停止，此节点不进入后续上下文。</div>') : ''}<div class="turn-actions"><button class="icon-button" data-copy-turn="${esc(turn.id)}" aria-label="复制回答">${icon('copy')}</button><button class="icon-button" data-branch="${esc(turn.id)}" aria-label="从这里探索">${icon('branch')}</button><button class="icon-button" data-node="${esc(turn.id)}" aria-label="在上下文树中查看">${icon('tree')}</button><span class="turn-cost">${M.tokens(M.usageTotal(turn.usage))} tokens${turn.cost > 0 ? ` · $${turn.cost.toFixed(4)}` : ''}</span></div></article>`).join('');
  $('messages').querySelectorAll('details').forEach(d => { if (openTools.has(d.querySelector('summary code')?.textContent)) d.open = true; });
  decorateCode($('messages'));
  if (live) renderLive();
}
function decorateCode(parent) {
  parent.querySelectorAll('.markdown pre').forEach(pre => {
    if (pre.querySelector('.copy-code')) return;
    const button = document.createElement('button'); button.className = 'copy-code'; button.setAttribute('aria-label', uiText('复制代码')); button.innerHTML = icon('copy');
    button.onclick = () => copy(pre.querySelector('code')?.textContent || ''); pre.prepend(button);
  });
}
function renderLive() {
  if (!live) return;
  const follow = nearBottom();
  let article = $('live-turn');
  if (!article) { article = document.createElement('article'); article.id = 'live-turn'; article.className = 'turn'; $('messages').append(article); }
  article.innerHTML = `<div class="turn-question"><div class="question-bubble">${esc(live.text)}</div></div>${assistantMeta('', '')}<div class="live-content">${contentHTML(live.content)}</div><div class="live-phase" role="status"><span class="pulse-dot"></span><span class="busy-shimmer">${esc(live.phase || uiText('正在思考…'))}</span></div>`;
  decorateCode(article);
  if (follow) scrollBottom(false);
}
function turnEvent(event) {
  if (!live) live = {text: '', content: [], phase: '', error: ''};
  switch (event.kind) {
    case 'start': if (state) state.busy = true; break;
    case 'text': live.content.push({kind: 'text', text: event.text}); break;
    case 'cmd': live.content.push({kind: 'cmd', text: event.text}); live.phase = uiText('正在执行命令'); break;
    case 'out': live.content.push({kind: 'out', text: event.text}); break;
    case 'phase': live.phase = uiText(event.text); break;
    case 'wait': live.phase = event.text; break;
    case 'error': live.error = event.text; live.phase = uiText('正在保存会话'); break;
    case 'aborted': live.phase = uiText('已停止，正在保存'); break;
    case 'completed': live.phase = uiText('正在整理上下文'); break;
    case 'guard': toast(uiText('探索分支修改了工作区文件。请检查变更后再继续。')); break;
    case 'summary_failed': toast(uiText('摘要暂不可用，本次将使用节点问答。')); break;
    case 'unpriced': toast(uiText('这个模型尚无价格记录，费用显示为估算。')); break;
  }
  if (!liveFrame) liveFrame = requestAnimationFrame(() => { liveFrame = 0; renderLive(); renderHeader(); updateComposer(); });
}
function renderPending() {
  $('pending').innerHTML = state.pending.map(e => {
    const node = state.nodes.find(n => n.id === e.src_id);
    return uiHtml`<span class="graft-chip">${icon('graft')}<span>嫁接 ${esc(node?.label || e.src_id)} · ${{leaf:uiText('问答'),'leaf+summary':uiText('问答与摘要'),branch:uiText('整条分支')}[e.depth]}</span><button data-unstage="${esc(e.src_id)}" aria-label="移除嫁接" ${state.busy ? 'disabled' : ''}>${icon('close')}</button></span>`;
  }).join('');
}
function renderAttachments() {
  $('attachments').innerHTML = attachments.map((a, index) => uiHtml`<span class="attachment-chip">${icon('paperclip')}<span>${esc(a.name)}</span><button data-remove-file="${index}" type="button" aria-label="移除 ${esc(a.name)}">${icon('close')}</button></span>`).join('');
  updateComposer();
}
function resizeDraft() { $('draft').style.height = 'auto'; $('draft').style.height = Math.min(180, $('draft').scrollHeight) + 'px'; }
function updateComposer() {
  $('cursor-chip').hidden = !connected;
  $('context-size').hidden = !connected || !state?.configured;
  $('provider-reminder').hidden = !connected || !!state?.configured;
  const busy = !!(state?.busy || sending);
  $('send').disabled = !connected || (!busy && !$('draft').value.trim() && !attachments.length);
  $('send').classList.toggle('stopping', busy);
  $('send').innerHTML = icon(busy ? 'stop' : 'arrow');
  $('send').setAttribute('aria-label', busy ? uiText('停止生成') : uiText('发送消息'));
  $('explore-toggle').setAttribute('aria-pressed', String(explore));
  $('explore-toggle').disabled = busy;
  $('attach').disabled = busy || !connected;
  $('draft').placeholder = busy ? uiText('正在生成，你也可以先写下一个想法…') : uiText('写下你的想法…');
}
async function send(event) {
  event.preventDefault();
  if (state?.busy || sending) { await request('stop').catch(fail); return; }
  const text = $('draft').value.trim();
  if (!text && !attachments.length) return;
  if (!state.configured) { toast(uiText('先连接一个模型，让对话开始。')); openSettings(); return; }
  const submitted = {text, attachments: attachments.slice(), explore};
  sending = true; updateComposer();
  live = {text: text || submitted.attachments.map(a => a.name).join('、'), content: [], phase: uiText('正在准备上下文')};
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
    return `<div style="position:absolute;left:${p.x * zoom}px;top:${p.y * zoom}px;transform:scale(${zoom});transform-origin:0 0;width:170px;height:83px"><button class="tree-node ${isCurrent ? 'current' : ''} ${selected === id ? 'selected' : ''} ${trunkIds.has(id) ? '' : 'off-trunk'} ${esc(n.status)}" data-tree-node="${esc(id)}" aria-label="${esc(n.label)} ${esc(n.input)}${isCurrent ? uiText('，当前位置') : ''}" aria-pressed="${selected === id}"><span class="tree-node-top"><span class="node-number">${esc(n.label)}</span>${id === state.trunk ? uiHtml`<span class="node-pin">${icon('pin')}主干</span>` : `<span>${n.status === 'archived' ? uiText('已归档') : n.status === 'aborted' ? uiText('已停止') : trunkIds.has(id) ? uiText('主干路径') : uiText('探索')}</span>`}</span><span class="tree-node-title">${esc(n.input || uiText('未完成的回合'))}</span><span class="tree-node-bottom"><span>${M.tokens(n.ctx)} ctx</span>${isCurrent ? uiText('<span class="node-current">你在这里</span>') : `<span>${n.grafts.length ? uiHtml`↳ ${n.grafts.length} 嫁接` : M.tokens(n.own) + ' tokens'}</span>`}</span></button>${p.children ? uiHtml`<button class="node-collapse" data-collapse="${esc(id)}" aria-label="${collapsed.has(id) ? uiText('展开') : uiText('折叠')} ${esc(n.label)} 的子节点">${collapsed.has(id) ? '+' + p.children : '−'}</button>` : ''}</div>`;
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
  $('inspector').innerHTML = uiHtml`<div class="inspector-head"><span class="inspector-label">${esc(n.label)}<span>${n.status === 'live' ? (id === state.trunk ? uiText('主干') : uiText('探索节点')) : n.status === 'archived' ? uiText('已归档') : uiText('不进入上下文')}</span></span><button id="inspector-close" class="icon-button" aria-label="关闭节点详情">${icon('close')}</button></div><h3>${esc(n.input || uiText('未完成的回合'))}</h3><div class="inspector-content"><div class="markdown">${markdown(n.answer || uiText('这个回合没有保存最终回答。'))}</div></div><div class="inspector-stats"><span>${M.tokens(n.ctx)} 上下文 tokens</span><span>${n.cost > 0 ? '$' + n.cost.toFixed(4) : M.tokens(n.own) + ' tokens'}</span></div><div class="node-actions"><button class="primary" data-node-action="go" ${n.status !== 'live' || state.busy ? 'disabled' : ''}>${icon('chat')}从这里继续</button><button data-node-action="explore" ${n.status !== 'live' || state.busy ? 'disabled' : ''}>${icon('branch')}从这里探索</button><button data-node-action="graft" ${n.status !== 'live' || state.busy ? 'disabled' : ''}>${icon('graft')}嫁接到当前上下文</button><button data-node-action="pin" ${n.status !== 'live' || state.busy ? 'disabled' : ''}>${icon('pin')}设为主干</button></div><div class="secondary-actions"><button data-node-action="detail">${icon('more')}完整内容</button><button data-node-action="${n.status === 'archived' ? 'restore' : 'archive'}" ${state.busy || !['live','archived'].includes(n.status) ? 'disabled' : ''}>${icon('archive')}${n.status === 'archived' ? uiText('恢复分支') : uiText('归档分支')}</button><button data-node-action="rewind" ${state.busy ? 'disabled' : ''}>${icon('undo')}回退</button></div>`;
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
      toast(explore ? uiText('在这里开启探索，主干保持原位。') : uiText('已切换上下文，工作区文件保持原样。'));
    } else if (action === 'graft') graftDialog(id);
    else if (action === 'pin') confirmDialog(uiText('把这条思路设为主干？'), uiText('下一次输入将从这个节点继续，主干可以修改工作区文件。已有的对话和其他分支会保留。'), uiText('设为主干'), async () => { await mutate('pin', {id}); explore = false; renderHeader(); updateComposer(); toast(uiText('已设为主干。')); });
    else if (action === 'archive') confirmDialog(uiText('归档这条分支？'), uiText('该节点及其子节点将移出上下文。历史和费用记录保留，随时可以恢复。'), uiText('归档分支'), () => mutate('archive', {id}, uiText('分支已归档，可开启「显示归档」找回。')));
    else if (action === 'restore') await mutate('restore', {id}, uiText('分支已恢复。'));
    else if (action === 'rewind') rewindDialog(id);
    else if (action === 'detail') {
      const detail = await request('node', {id});
      showDialog(uiText('节点内容'), `<p class="dialog-description">${esc(detail.input)}</p>${contentHTML(detail.content)}`, true);
      decorateCode($('dialog'));
    }
  } catch (error) { fail(error); }
}
function showDialog(title, html, wide = false) {
  if (onboardingStep) return;
  lastDialogFocus();
  $('overlay').hidden = false; $('dialog').className = 'dialog' + (wide ? ' wide' : '');
  $('dialog').innerHTML = uiHtml`<div class="dialog-header"><h2 id="dialog-title">${esc(title)}</h2><button id="dialog-close" class="icon-button" aria-label="关闭对话框">${icon('close')}</button></div>${html}`;
  $('dialog-close').onclick = closeDialog;
  $('app').inert = true;
  requestAnimationFrame(() => { const target = $('dialog').querySelector('input:not([type=radio]),textarea') || $('dialog'); target.focus({preventScroll:true}); });
}
function lastDialogFocus() { if ($('overlay').hidden) dialogFocus = document.activeElement; }
function closeDialog() { if (onboardingStep) return; $('overlay').classList.remove('onboarding-overlay'); $('overlay').hidden = true; $('app').inert = false; if (dialogFocus?.isConnected) dialogFocus.focus({preventScroll:true}); }
function confirmDialog(title, description, label, action, danger = false) {
  showDialog(title, uiHtml`<p class="dialog-description">${esc(description)}</p><div id="dialog-error" class="error-message" role="alert"></div><div class="dialog-footer"><button id="cancel" class="button">取消</button><button id="confirm" class="button ${danger ? 'danger' : 'primary'}">${esc(label)}</button></div>`);
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
    showDialog(uiText('把发现带回当前思路'), uiHtml`<p class="dialog-description">将 ${esc(label)} 的内容带入下一回合。原分支会保留，历史内容不会改写。</p><form id="graft-form">${[['leaf',uiText('问答'),uiText('只带入这个节点的问题与最终回答。')],['leaf+summary',uiText('问答与路径摘要'),uiText('保留发现，以及通往发现的必要背景。')],['branch',uiText('整条分支'),uiText('带入公共祖先之后的全部问答，省略工具输出。')]].map(([value,title,desc]) => `<label class="choice"><input type="radio" name="depth" value="${value}" ${value === 'leaf+summary' ? 'checked' : ''}><span>${title}<small>${desc}</small></span><em>${M.tokens(preview.sizes[value])} tokens</em></label>`).join('')}<div id="dialog-error" class="error-message" role="alert"></div><div class="dialog-footer"><button type="button" id="cancel" class="button">取消</button><button class="button primary" type="submit">${icon('graft')}添加嫁接</button></div></form>`);
    $('cancel').onclick = closeDialog;
    $('graft-form').onsubmit = async event => {
      event.preventDefault(); const button = event.submitter || $('graft-form').querySelector('[type=submit]'); button.disabled = true;
      try { await mutate('graft', {id, depth: new FormData($('graft-form')).get('depth')}); closeDialog(); toast(uiText('发现已加入下一回合的上下文。')); }
      catch (error) { $('dialog-error').textContent = error.message; button.disabled = false; }
    };
  } catch (error) { fail(error); }
}
async function rewindDialog(id) {
  try {
    const detail = await request('node', {id});
    showDialog(uiText('回到这个节点'), uiHtml`<p class="dialog-description">选择要回退的部分。代码回退只影响后续回合修改过的文件，同一文件中的手工修改也会被覆盖。</p><form id="rewind-form">${[['conversation',uiText('只回退对话'),uiText('切换上下文，不修改文件。'),detail.status !== 'live'],['code',uiText('只回退代码'),uiText('恢复文件，对话位置不变。'),!detail.has_snapshot],['both',uiText('对话与代码'),uiText('从这个节点的对话和文件状态继续。'),!detail.has_snapshot || detail.status !== 'live']].map(([value,title,desc,disabled]) => `<label class="choice"><input type="radio" name="mode" value="${value}" ${value === (detail.status === 'live' ? 'conversation' : 'code') ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${title}<small>${desc}${disabled ? uiText(' 当前节点不可用。') : ''}</small></span></label>`).join('')}<div class="path-list">${esc(detail.paths.length ? detail.paths.join('\n') : uiText('没有需要恢复的文件。'))}</div><div id="dialog-error" class="error-message" role="alert"></div><div class="dialog-footer"><button id="cancel" type="button" class="button">取消</button><button type="submit" class="button danger">确认回退</button></div></form>`);
    $('cancel').onclick = closeDialog;
    $('rewind-form').onsubmit = async event => {
      event.preventDefault(); const mode = new FormData($('rewind-form')).get('mode');
      if (!mode) return;
      const button = event.submitter || $('rewind-form').querySelector('[type=submit]'); button.disabled = true;
      try { await mutate('rewind', {id, mode}, uiText('已回到选定状态。')); closeDialog(); } catch (error) { $('dialog-error').textContent = error.message; button.disabled = false; }
    };
  } catch (error) { fail(error); }
}
async function openModelPicker() {
  try {
    modelConfig = await request('configuration');
    if (!modelConfig.models.length) return openSettings();
    showDialog(uiText('选择模型'), uiHtml`<p class="dialog-description">为下一回合选择模型，历史记录保持原样。</p>${modelConfig.models.map((m, i) => `<button class="model-option ${modelConfig.active === m.provider + '/' + m.id ? 'selected' : ''}" data-model="${i}"><span>${esc(m.id)}<small>${esc(m.provider)}</small></span>${modelConfig.active === m.provider + '/' + m.id ? icon('check') : ''}</button>`).join('')}<div class="dialog-footer"><button id="manage-models" class="button">${icon('settings')}管理模型与服务商</button></div>`);
    $('manage-models').onclick = openSettings;
    $('dialog').querySelectorAll('[data-model]').forEach(button => button.onclick = async () => {
      const m = modelConfig.models[button.dataset.model];
      try { await mutate('model', {provider:m.provider, model:m.id}); closeDialog(); } catch (error) { fail(error); }
    });
  } catch (error) { fail(error); }
}
const providerName = id => {
  const names={anthropic:'Anthropic',openai:'OpenAI',gemini:'Google Gemini',deepseek:'DeepSeek',kimi:'Kimi',ollama:'Ollama',glm:'GLM',qwen:'Qwen',openrouter:'OpenRouter',groq:'Groq',opencode:'OpenCode Zen'};
  const base=id.split('-')[0];
  return (id==='opencode-go' || id.startsWith('opencode-go-') ? 'OpenCode Go' : names[base] || base)+(id.includes('-anthropic')?' · Anthropic':'')+(id.endsWith('-cn')?' · CN':'');
};
async function openSettings() {
  if (onboardingStep) return;
  if (state?.busy) return toast(uiText('先停止或等待当前回合结束，再修改模型设置。'));
  try {
    modelConfig = await request('configuration');
    providerDrafts.clear();
    showDialog(uiText('模型与设置'), uiHtml`<p class="dialog-description">连接你选择的模型。配置保存在本机，只有模型请求会发送到你配置的服务商。</p><div id="provider-editor"></div>`);
    renderProviderEditor(false);
  } catch (error) { fail(error); }
}
function providerMark(p) {
  const id = p.id.split('-')[0];
  const marks = {anthropic:'A',openai:'O',gemini:'G',deepseek:'D',kimi:'K',glm:'Z',ollama:'O',qwen:'Q',openrouter:'R',groq:'G',opencode:'C'};
  return `<span class="provider-mark" data-vendor="${esc(id)}" aria-hidden="true">${marks[id] || p.id[0].toUpperCase()}</span>`;
}
function renderProviderEditor(onboarding) {
  const active = modelConfig.active.split('/')[0];
  if (!modelConfig.providers.some(p => p.id === providerSelection)) providerSelection = modelConfig.providers.some(p => p.id === active) ? active : 'anthropic';
  $('provider-editor').innerHTML = `<div class="provider-picker"><span class="field-caption">${uiText('服务商')}</span><button type="button" id="provider-select" class="provider-trigger" aria-haspopup="listbox" aria-controls="provider-options" aria-expanded="false"></button><section id="provider-browser" class="provider-browser" hidden><div class="provider-search-row">${icon('search')}<input id="provider-search" placeholder="${uiText('搜索服务商')}" autocomplete="off" aria-label="${uiText('搜索服务商')}"><button type="button" id="provider-browser-close" class="icon-button" aria-label="${uiText('返回')}">${icon('close')}</button></div><div id="provider-options" class="provider-options" role="listbox" aria-label="${uiText('选择你的服务商')}"></div></section></div><div id="provider-fields"></div>`;
  $('provider-select').onclick = () => $('provider-browser').hidden ? openProviderPicker() : closeProviderPicker();
  $('provider-select').onkeydown = event => { if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); openProviderPicker(); $('provider-options').querySelector('[aria-selected=true]')?.focus(); } };
  $('provider-search').oninput = renderProviderOptions;
  $('provider-browser-close').onclick = closeProviderPicker;
  $('provider-options').onkeydown = event => {
    const options = [...$('provider-options').querySelectorAll('button')];
    const index = options.indexOf(document.activeElement);
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0,Math.min(options.length-1,index+(event.key==='ArrowDown'?1:-1)));
      options[next]?.focus();
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeProviderPicker(); }
  };
  providerFields(onboarding);
}
function openProviderPicker() {
  $('provider-browser').hidden = false; $('provider-select').setAttribute('aria-expanded','true');
  $('provider-fields').hidden = true; $('provider-search').value = ''; renderProviderOptions();
  $('provider-search').focus({preventScroll:true});
}
function closeProviderPicker() {
  if (!$('provider-browser')) return;
  $('provider-browser').hidden = true; $('provider-fields').hidden = false;
  $('provider-select').setAttribute('aria-expanded','false'); $('provider-select').focus({preventScroll:true});
}
function renderProviderOptions() {
  const query = $('provider-search').value.trim().toLowerCase();
  const list = modelConfig.providers.filter(p => (providerName(p.id)+' '+p.id+' '+p.protocol).toLowerCase().includes(query));
  $('provider-options').innerHTML = list.length ? list.map(p => `<button type="button" class="provider-option" role="option" aria-selected="${p.id===providerSelection}" data-provider="${esc(p.id)}">${providerMark(p)}<span class="provider-option-copy"><strong>${esc(providerName(p.id))}</strong><small>${esc(p.protocol || p.id)}</small></span>${p.configured ? `<span class="provider-connected">${uiText('已连接')}</span>` : ''}<span class="provider-option-check">${p.id===providerSelection?icon('check'):''}</span></button>`).join('') : `<p class="provider-empty">${uiText('没有找到服务商')}</p>`;
  $('provider-options').querySelectorAll('button').forEach(button => button.onclick = () => {
    if ($('provider-url')) providerDrafts.set(providerSelection,{url:$('provider-url').value,key:$('provider-key').value,models:$('provider-models').value});
    providerSelection = button.dataset.provider; closeProviderPicker(); providerFields(onboardingStep==='provider');
  });
}
function providerFields(onboarding = false) {
  const p = modelConfig.providers.find(item => item.id === providerSelection);
  const draft = providerDrafts.get(p.id);
  $('provider-select').innerHTML = `${providerMark(p)}<span class="provider-trigger-copy"><strong>${esc(providerName(p.id))}</strong><small>${esc(p.protocol || p.id)}</small></span><span class="provider-trigger-chevron">${icon('down')}</span>`;
  $('provider-fields').innerHTML = uiHtml`<form id="provider-form" class="provider-form" novalidate><label class="field">服务地址<input id="provider-url" type="url" value="${esc(draft?.url ?? p.url)}" spellcheck="false" autocomplete="off"></label><label class="field">API key<input id="provider-key" type="password" autocomplete="new-password" placeholder="${p.has_key ? uiText('已保存 · 留空保留现有 key') : p.needs_key ? uiText('填写服务商提供的 API key') : uiText('此服务无需 key')}"><small>保存在应用私有目录，不进入对话或工作区。</small></label><label class="field">模型 ID<textarea id="provider-models" rows="2" spellcheck="false" placeholder="${esc(p.suggested.slice(0,3).join(', '))}">${esc(draft?.models ?? (p.models.length ? p.models.join(', ') : p.suggested.slice(0,3).join(', ')))}</textarea><small>使用英文逗号分隔。可填写服务商支持的自定义模型 ID。</small></label><div id="provider-error" class="error-message" role="alert"></div><button id="provider-save" class="button primary" type="submit" ${!connected?'disabled':''}>${icon('check')}${uiText(onboarding?'保存并开始':'保存连接')}</button></form>${onboarding ? '' : uiHtml`<div class="provider-actions"><button id="catalog-refresh">刷新模型与价格</button>${p.configured ? uiHtml`<button id="provider-remove" class="remove-provider">移除连接</button>` : ''}</div>`}`;
  $('provider-key').value = draft?.key || '';
  $('provider-form').onsubmit = async event => {
    event.preventDefault(); if (!connected) return;
    const fields = {provider:p.id,url:$('provider-url').value.trim(),key:$('provider-key').value,models:$('provider-models').value};
    $('provider-save').disabled = true;
    try {
      await mutate('provider.save', fields); providerDrafts.clear();
      if (onboarding) finishOnboarding(false); else { closeDialog(); toast(uiText('连接已保存。可以开始对话了。')); }
    } catch (error) { if ($('provider-error')) $('provider-error').textContent = uiText(error.message); if ($('provider-save')) $('provider-save').disabled = false; }
  };
  $('provider-remove')?.addEventListener('click', () => confirmDialog(uiText('移除服务商连接？'),uiText('删除本机保存的地址、key 和模型列表。历史对话仍然保留。'),uiText('移除连接'),()=>mutate('provider.remove',{provider:p.id}),true));
  if ($('catalog-refresh')) $('catalog-refresh').onclick = async () => {
    $('catalog-refresh').disabled = true; $('catalog-refresh').textContent = uiText('正在获取模型目录…');
    try {
      const preview = await request('catalog.preview',{provider:p.id});
      confirmDialog(uiText('更新模型目录'),uiHtml`将保留现有与自定义模型，更新后的列表包含 ${preview.models.length} 个模型。确认后保存模型与价格。`,uiText('保存更新'),()=>mutate('catalog.save',preview,uiText('模型与价格已更新。')));
    } catch(error) { $('provider-error').textContent=uiText(error.message); $('catalog-refresh').disabled=false; $('catalog-refresh').textContent=uiText('刷新模型与价格'); }
  };
}
function renderEngineStatus() {
  $('cursor-chip').hidden = !connected;
  $('connection').hidden = connected;
  if (connected) return;
  $('connection').className = 'connection';
  $('connection').innerHTML = `<span class="engine-sprout" aria-hidden="true"><i></i><i></i><i></i></span><span>${uiText('正在加载kaipi引擎')}</span>`;
}
function savePreferences(value) {
  const preferences = KaipiLocale.apply(value);
  pendingPreferences = preferences;
  if (state) state.preferences = preferences;
  flushPreferences();
  return preferences;
}
function flushPreferences() {
  if (!connected || !pendingPreferences || preferenceWrite) return;
  preferenceWrite = (async () => {
    while (pendingPreferences && connected) {
      const value = pendingPreferences; pendingPreferences = null;
      try { await request('preferences',value); }
      catch(error) { if (!pendingPreferences) pendingPreferences = value; throw error; }
    }
  })().catch(fail).finally(()=>{ preferenceWrite=null; });
}
function reconcilePreferences(remote) {
  if (!pendingPreferences && !preferenceWrite && remote?.android_language_confirmed && ['zh','en'].includes(remote.language)) KaipiLocale.apply(remote);
  else if (!remote?.android_language_confirmed && KaipiLocale.current().android_language_confirmed && !preferenceWrite) pendingPreferences = KaipiLocale.current();
  flushPreferences();
}
function updateOnboarding() {
  const p = KaipiLocale.current();
  if (p.android_onboarding_complete && p.android_language_confirmed && p.language) {
    if (onboardingStep) { onboardingStep=null; $('overlay').classList.remove('onboarding-overlay'); closeDialog(); }
    return;
  }
  if (!p.android_language_confirmed || !p.language) { if (onboardingStep!=='language') showLanguageWelcome(); }
  else if (onboardingStep!=='provider') showProviderWelcome();
  else if (connected && !$('provider-editor')?.querySelector('#provider-form')) loadWelcomeProviders();
}
function welcomeShell(step) {
  if (!onboardingStep) lastDialogFocus();
  onboardingStep=step;
  $('overlay').hidden=false; $('overlay').classList.add('onboarding-overlay');
  $('dialog').className='dialog onboarding-dialog'; $('dialog').dataset.step=step; $('app').inert=true;
  $('dialog').scrollTop=0;
}
function showLanguageWelcome() {
  welcomeShell('language'); chosenLanguage=null;
  $('dialog').innerHTML=`<div class="welcome-brand">${brandImage()}<span>kaipi<span class="brand-dot">.</span></span></div><div class="onboarding-progress" aria-label="Step 1 of 2"><span class="active"></span><span></span></div><div class="onboarding-eyebrow">01 &nbsp; LANGUAGE · 语言</div><h1 id="dialog-title" class="onboarding-title">选择你的语言<span>Choose your language</span></h1><p class="onboarding-copy bilingual-copy">用你习惯的语言，让思路自由生长。<span>A little room for your ideas, in your own language.</span></p><div id="welcome-languages" class="language-choices" role="radiogroup" aria-label="界面语言 / Interface language"><button type="button" class="language-choice" role="radio" aria-checked="false" data-language="zh"><span class="language-glyph">中</span><strong>简体中文</strong><small>Chinese, Simplified</small><span class="language-check">${icon('check')}</span></button><button type="button" class="language-choice" role="radio" aria-checked="false" data-language="en"><span class="language-glyph latin">Aa</span><strong>English</strong><small>英文</small><span class="language-check">${icon('check')}</span></button></div><button id="language-continue" class="button primary onboarding-primary" disabled>继续 <span class="bilingual-separator">/</span> Continue ${icon('right')}</button><p class="onboarding-footnote">稍后可在设置中切换语言。<span>You can change this later in settings.</span></p>`;
  $('welcome-languages').querySelectorAll('button').forEach(button=>button.onclick=()=>{
    chosenLanguage=button.dataset.language;
    $('welcome-languages').querySelectorAll('button').forEach(item=>item.setAttribute('aria-checked',String(item===button)));
    $('language-continue').disabled=false;
  });
  $('welcome-languages').onkeydown=event=>{
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const options=[...$('welcome-languages').querySelectorAll('button')];
    const current=options.indexOf(document.activeElement);const next=options[(current+1)%options.length];next.focus();next.click();
  };
  $('language-continue').onclick=()=>{
    if (!chosenLanguage) return;
    savePreferences({language:chosenLanguage,android_language_confirmed:true,android_onboarding_complete:false});
    refreshLanguageUI(); showProviderWelcome();
  };
  $('dialog').focus({preventScroll:true});
}
function brandImage() { return '<span class="official-mark"><img class="official-light" src="kaipi-logo.svg" alt=""><img class="official-dark" src="kaipi-logo-dark.svg" alt=""></span>'; }
function showProviderWelcome() {
  welcomeShell('provider'); providerDrafts.clear(); modelConfig=null;
  $('dialog').innerHTML=`<div class="welcome-brand compact">${brandImage()}<span>kaipi<span class="brand-dot">.</span></span><button type="button" id="welcome-back" class="text-button">${uiText('返回')}</button></div><div class="onboarding-progress" aria-label="Step 2 of 2"><span class="complete"></span><span class="active"></span></div><div class="onboarding-eyebrow">02 &nbsp; ${uiText('连接你的模型')}</div><h1 id="dialog-title" class="onboarding-title single">${uiText('连接你的模型')}</h1><p class="onboarding-copy">${uiText('使用你自己的 API key，连接你信任的服务商。')}</p><div id="provider-editor"><div class="provider-wait"><span class="engine-sprout" aria-hidden="true"><i></i><i></i><i></i></span><span>${uiText('正在读取服务商配置…')}</span></div></div><div class="welcome-provider-footer"><p>${uiText('也可以稍后设置，但首次对话前仍需配置供应商。')}</p><button id="provider-skip" class="text-button" type="button">${uiText('稍后配置')}${icon('right')}</button></div>`;
  $('welcome-back').onclick=()=>{providerEpoch++;showLanguageWelcome();};
  $('provider-skip').onclick=()=>finishOnboarding(true);
  if (connected) loadWelcomeProviders();
  $('dialog').focus({preventScroll:true});
}
async function loadWelcomeProviders() {
  if (!connected || onboardingStep!=='provider' || $('provider-editor')?.dataset.loading==='true') return;
  const epoch=++providerEpoch;
  $('provider-editor').dataset.loading='true';
  try {
    const config=await request('configuration');
    if (onboardingStep!=='provider' || epoch!==providerEpoch) return;
    modelConfig=config; renderProviderEditor(true);
    $('provider-skip').textContent=uiText(config.models.length?'继续使用当前连接':'稍后配置');
  } catch(error) { if(onboardingStep==='provider' && epoch===providerEpoch) { $('provider-editor').dataset.loading='false'; $('provider-editor').innerHTML=`<p class="error-message">${esc(uiText(error.message))}</p><button id="retry-providers" class="button">${uiText('重新连接')}</button>`; $('retry-providers').onclick=loadWelcomeProviders; } }
}
function finishOnboarding(skipped) {
  savePreferences({...KaipiLocale.current(),android_onboarding_complete:true});
  providerEpoch++; onboardingStep=null; providerDrafts.clear();
  $('overlay').classList.remove('onboarding-overlay'); closeDialog();
  if(skipped && !state?.configured) toast(uiText('已跳过。首次对话前仍需配置供应商。'));
  updateComposer();
}
function refreshLanguageUI() {
  if (state) { renderHeader();renderSessions();renderHistory();renderPending(); if($('app').classList.contains('tree-open'))renderTree(); }
  updateComposer(); if(!connected)renderEngineStatus();
}
function openLanguageSettings() {
  const current=KaipiLocale.current().language;
  showDialog(uiText('界面语言'),`<p class="dialog-description">${uiText('选择你习惯的语言，内容和代码保持原样。')}</p><div class="language-settings">${[['zh','简体中文','Chinese, Simplified'],['en','English','英文']].map(([id,name,detail])=>`<button type="button" class="model-option ${current===id?'selected':''}" data-language-setting="${id}"><span>${name}<small>${detail}</small></span>${current===id?icon('check'):''}</button>`).join('')}</div>`);
  $('dialog').querySelectorAll('[data-language-setting]').forEach(button=>button.onclick=()=>{
    savePreferences({...KaipiLocale.current(),language:button.dataset.languageSetting}); refreshLanguageUI(); closeDialog(); toast(uiText('语言已保存。'));
  });
}

function openAppearance() {
  showDialog(uiText('外观与色彩'), uiHtml`<p class="dialog-description">选择一种舒服的阅读氛围。更改即时生效，也会保存下来。</p><div class="appearance-label">明暗模式</div><div class="appearance-modes" id="appearance-modes"></div><div class="appearance-label">强调色</div><div class="appearance-colors" id="appearance-colors"></div><div class="appearance-preview"><span class="preview-tag">${icon('branch')} 为思路留出空间</span><h3>让一个想法，自由生长。</h3><p>在分支中探索，在主干上创造。<br>让界面退后，让内容走到前面。</p></div><p class="theme-note" id="theme-note"></p>`);
  renderAppearance();
}
function renderAppearance() {
  const preference = KaipiTheme.current();
  $('appearance-modes').innerHTML = [['system','system',uiText('跟随系统')],['light','sun',uiText('浅色')],['dark','moon',uiText('深色')]].map(([mode,symbol,label]) => `<button class="appearance-mode ${preference.mode === mode ? 'selected' : ''}" data-mode="${mode}" aria-pressed="${preference.mode === mode}">${icon(symbol)}${label}</button>`).join('');
  $('appearance-colors').innerHTML = [['forest',uiText('松绿'),'#547849'],['indigo',uiText('靛蓝'),'#53648e'],['clay',uiText('陶土'),'#91634b']].map(([color,label,swatch]) => `<button class="color-option ${preference.color === color ? 'selected' : ''}" data-color="${color}" aria-pressed="${preference.color === color}"><span class="color-swatch" style="--swatch:${swatch}">${preference.color === color ? icon('check') : ''}</span>${label}</button>`).join('');
  $('theme-note').textContent = preference.mode === 'system' ? uiText('将随系统自动切换浅色与深色。') : uiText('主题已应用，关闭后仍会保留。');
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
  showDialog(uiText('给这段思路起个名字'), uiHtml`<form id="rename-form" novalidate><label class="field">对话名称<input id="rename-input" value="${esc(state.name || '')}" maxlength="80" required></label><div id="dialog-error" class="error-message" role="alert"></div><div class="dialog-footer"><button id="cancel" type="button" class="button">取消</button><button type="submit" class="button primary">保存名称</button></div></form>`);
  $('cancel').onclick = closeDialog;
  $('rename-form').onsubmit = async event => { event.preventDefault(); try { await mutate('rename', {name:$('rename-input').value}); closeDialog(); } catch (error) { $('dialog-error').textContent = error.message; } };
}
function workspaceDialog(items) {
  if (!items.length) return toast(uiText('当前只有一个本地工作区。'));
  showDialog(uiText('本地工作区'), uiHtml`${items.map(w => `<button class="model-option" data-workspace="${esc(w.id)}">${icon('folder')}<span>${esc(w.is_default ? uiText('默认工作区') : w.name)}</span>${icon('right')}</button>`).join('')}`);
  $('dialog').querySelectorAll('[data-workspace]').forEach(button => button.onclick = () => {
    if (state?.busy) return toast(uiText('请先结束当前回合再切换工作区。'));
    saveDraft(); connected = false; rejectPending(uiText('正在切换工作区')); closeDialog();
    renderEngineStatus();
    Native.workspace(button.dataset.workspace);
  });
}
async function addAttachments(files) {
  const targetSession = state?.session;
  if (attachments.length + files.length > 8) return toast(uiText('每条消息最多添加 8 个附件。'));
  try {
    const all = [...attachments, ...files];
    await request('attachments', {attachments:all});
    if (targetSession !== state?.session) return toast(uiText('对话已切换，请重新添加附件。'));
    attachments = all; renderAttachments(); saveDraft();
  } catch (error) { fail(error); }
}
async function readFiles(files) {
  const targetSession = state?.session;
  if (files.length + attachments.length > 8) return toast(uiText('每条消息最多添加 8 个附件。'));
  let total = attachments.reduce((sum,a) => sum + a.data.length * .75, 0);
  const result = [];
  try {
    for (const file of files) {
      total += file.size;
      if (file.size > 20 * 1024 * 1024 || total > 40 * 1024 * 1024) throw new Error(uiText('附件过大：单个最多 20 MiB，合计最多 40 MiB。'));
      const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      result.push({name:file.name || uiText('附件'), data});
    }
    if (state?.session !== targetSession) return toast(uiText('对话已切换，请重新添加附件。'));
    await addAttachments(result);
  } catch (error) { fail(error); }
}
async function copy(text) {
  try {
    if (window.Native?.copy) Native.copy(text);
    else await navigator.clipboard.writeText(text);
    toast(uiText('已复制。'));
  } catch { toast(uiText('复制暂不可用。')); }
}
function back() {
  if (!$('provider-browser')?.hidden && $('provider-browser')) { closeProviderPicker(); return true; }
  if (onboardingStep) return true;
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
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !matchMedia('(pointer:coarse)').matches) { event.preventDefault(); if (state?.busy || sending) toast(uiText('当前回合结束后可以发送，草稿会保留。')); else send(event); }
};
$('explore-toggle').onclick = () => { explore = !explore; updateComposer(); if (state) renderHeader(); saveDraft(); };
$('sidebar-toggle').onclick = () => rail(!$('app').classList.contains('rail-open'));
$('sidebar-close').onclick = () => rail(false); $('scrim').onclick = () => rail(false);
$('tree-toggle').onclick = () => tree(!$('app').classList.contains('tree-open'));
$('tree-close').onclick = () => tree(false); $('welcome-tree').onclick = () => tree(true); $('cursor-chip').onclick = () => { tree(true); if (state?.leaf) inspectNode(state.leaf); };
$('new-chat').onclick = async () => { try { saveDraft(); await mutate('new'); rail(false); $('draft').focus(); } catch (error) { fail(error); } };
$('settings').onclick = openSettings; $('language-settings').onclick = openLanguageSettings; $('provider-reminder').onclick = openSettings; $('appearance-button').onclick = openAppearance; $('model-picker').onclick = openModelPicker; $('rename').onclick = renameDialog;
$('session-search').oninput = renderSessions;
$('workspace').onclick = () => { if (window.Native?.workspaces) Native.workspaces(); else toast(uiText('本地工作区')); };
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
  if (event.key === 'Escape') { event.preventDefault(); back(); }
  if (event.key === 'Tab' && !$('overlay').hidden) {
    const focusable = [...$('dialog').querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select,a[href]')].filter(node => node.offsetParent !== null);
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
KaipiLocale.initStatic($('app'));
window.kaipi = {receive, back};
updateOnboarding();
renderEngineStatus();
if (matchMedia('(min-width:801px)').matches) rail(true);
if (window.Native) Native.ready();
else disconnected(uiText('请在 Android 应用中打开，或连接本地开发预览。'));
})();
