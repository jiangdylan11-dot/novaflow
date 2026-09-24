// NovaFlow Web: the 算力源 picker in the topbar.
//
// The brand runtime draws 「AI 已连接 / AI 未连接」 as a plain label. On the
// Web that spot becomes a button: click it to see every machine in the compute
// pool, whether each is free right now, and pin your work to one of them. The
// label the brand runtime keeps refreshing stays in the DOM, hidden; this chip
// mirrors its phase (the dot colour) and adds which node is pinned:
//
//   nothing pinned      AI 已连接              (the launcher's default source)
//   pinned, online      已链接 AI-studio-5090
//   pinned, offline     AI-studio-5090 未连接
//
// Who may pin: a 高级账户. A 普通账户 sees the same list, greyed, and a note to
// contact the administrator; its work stays on its own machine (the control
// plane refuses it anyway - see docs/WEB_ACCOUNT_COMPUTE_TIERS_20260924.md).
//
// The pin itself lives in novaflow-web-runtime.js (computeNode): every task
// carries the node id and every capability probe asks about that node alone.
(function (root) {
  'use strict';

  const HOST_ID = 'novaflow-topbar-ai-runtime-status';
  const LABEL_SELECTOR = '[data-novaflow-topbar-ai-runtime-state="1"]';
  const CHIP_ID = 'novaflow-web-compute-node-chip';
  const DIALOG_ID = 'novaflow-web-compute-node-dialog';
  const STYLE_ID = 'novaflow-web-compute-node-style';
  const CONTACT_ADMIN = '普通账户只能使用本机算力。需要使用其他算力节点，请联系管理员开通高级账户。';
  const STATUS_TEXT = { idle: '空闲', busy: '忙碌', offline: '离线', local: '本机', auto: '自动' };

  const runtime = () => root.NovaFlowWebRuntime || null;
  const api = () => root.electronAPI || {};
  const doc = () => root.document;

  const CSS = [
    '#' + CHIP_ID + '{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px;border:1px solid #333333;border-radius:7px;background:#171717;color:#a0a0a0;font:inherit;font-size:11px;line-height:1;white-space:nowrap;cursor:pointer;-webkit-app-region:no-drag}',
    '#' + CHIP_ID + ':hover{border-color:#4a4a4a;color:#e5e7eb}',
    '#' + CHIP_ID + '::before{content:"";width:4px;height:4px;border-radius:50%;background:#6b6b6b;flex:0 0 auto}',
    '#' + CHIP_ID + '[data-phase="connected"]{color:#88c6b4}',
    '#' + CHIP_ID + '[data-phase="connected"]::before{background:#49c7a4}',
    '#' + CHIP_ID + '[data-phase="starting"]{color:#e3c25a}',
    '#' + CHIP_ID + '[data-phase="starting"]::before{background:#facc15}',
    '#' + DIALOG_ID + '{border:0;padding:0;background:transparent;color:#e5e7eb;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '#' + DIALOG_ID + '::backdrop{background:rgba(0,0,0,.62)}',
    '#' + DIALOG_ID + ' .nf-node-card{width:420px;max-width:calc(100vw - 32px);background:#141414;border:1px solid #2a2a2a;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5)}',
    '#' + DIALOG_ID + ' .nf-node-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #222222}',
    '#' + DIALOG_ID + ' .nf-node-header h2{margin:0;font-size:14px;font-weight:600;color:#e5e7eb}',
    '#' + DIALOG_ID + ' .nf-node-close{width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:#a0a0a0;font:inherit;font-size:18px;line-height:1;cursor:pointer}',
    '#' + DIALOG_ID + ' .nf-node-close:hover{background:#222222;color:#ffffff}',
    '#' + DIALOG_ID + ' .nf-node-body{padding:12px 16px 16px;display:grid;gap:10px}',
    '#' + DIALOG_ID + ' .nf-node-list{display:grid;gap:6px;max-height:min(52vh,420px);overflow:auto}',
    '#' + DIALOG_ID + ' .nf-node-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #262626;border-radius:8px;background:#191919;color:#e5e7eb;font:inherit;text-align:left;cursor:pointer}',
    '#' + DIALOG_ID + ' .nf-node-row:hover{border-color:#3d3d3d;background:#1f1f1f}',
    '#' + DIALOG_ID + ' .nf-node-row[aria-current="true"]{border-color:#1ea672;background:#15261f}',
    '#' + DIALOG_ID + ' .nf-node-row[aria-disabled="true"]{opacity:.55;cursor:not-allowed}',
    '#' + DIALOG_ID + ' .nf-node-name{font-size:13px;font-weight:600}',
    '#' + DIALOG_ID + ' .nf-node-hint{margin-top:2px;font-size:11px;color:#8d8d8d}',
    '#' + DIALOG_ID + ' .nf-node-badge{flex:0 0 auto;padding:3px 8px;border-radius:999px;font-size:11px;background:#2a2a2a;color:#a0a0a0}',
    '#' + DIALOG_ID + ' .nf-node-badge[data-status="idle"]{background:#153b2e;color:#7ce8b5}',
    '#' + DIALOG_ID + ' .nf-node-badge[data-status="busy"]{background:#3a2f12;color:#facc15}',
    '#' + DIALOG_ID + ' .nf-node-badge[data-status="local"],#' + DIALOG_ID + ' .nf-node-badge[data-status="auto"]{background:#1e2a3a;color:#93c5fd}',
    '#' + DIALOG_ID + ' .nf-node-note{font-size:12px;line-height:1.7;color:#a0a0a0}',
    '#' + DIALOG_ID + ' .nf-node-note.nf-node-warn{color:#fca5a5}'
  ].join('\n');

  function el(tag, className, text) {
    const node = doc().createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function ensureStyle() {
    if (doc().getElementById(STYLE_ID)) return;
    const style = el('style', '', CSS);
    style.id = STYLE_ID;
    doc().head.appendChild(style);
  }

  // ------------------------------------------------------------------ data
  /** The chip's wording, given the pinned node and the brand runtime's phase. */
  function chipText(node, phase, brandLabel) {
    if (node && node.name) {
      if (phase === 'connected') return '已链接 AI-' + node.name;
      if (phase === 'starting') return 'AI-' + node.name + ' 启动中';
      return 'AI-' + node.name + ' 未连接';
    }
    return brandLabel || (phase === 'connected' ? 'AI 已连接' : 'AI 未连接');
  }

  function vramText(mb) {
    const n = Number(mb) || 0;
    return n >= 1024 ? Math.round(n / 1024) + ' GB 显存' : n > 0 ? n + ' MB 显存' : '';
  }

  /**
   * The rows of the picker, as data. `reply` is GET /api/web/nodes; `current`
   * the pinned node; `localAssistant` whether this page was opened by the
   * local assistant (then the first row is that machine, otherwise the pool).
   */
  function buildRows(reply, current, localAssistant) {
    const allowed = !!(reply && reply.compute && reply.compute.shared);
    const nodes = (reply && Array.isArray(reply.nodes)) ? reply.nodes : [];
    const rows = [];
    if (localAssistant) {
      rows.push({ id: null, name: '本机', hint: '启动NovaFlow 的这台电脑', status: 'local', locked: false, selected: !current });
    } else {
      rows.push({ id: null, name: '自动分配', hint: '任意空闲的算力节点', status: 'auto', locked: !allowed, selected: !current });
    }
    for (const n of nodes) {
      const status = ['idle', 'busy', 'offline'].includes(String(n.status)) ? String(n.status) : (n.online ? 'busy' : 'offline');
      rows.push({
        id: String(n.id),
        name: String(n.name || '未命名节点'),
        hint: [n.gpu_name, vramText(n.vram_mb)].filter(Boolean).join(' · ') || '算力节点',
        status,
        locked: !allowed,
        selected: !!(current && String(current.id) === String(n.id))
      });
    }
    return { allowed, rows };
  }

  // ------------------------------------------------------------------ chip
  let previousFocus = null;

  function phaseOf(host) {
    const phase = host.getAttribute('data-novaflow-topbar-ai-runtime-phase');
    if (phase) return phase;
    return host.getAttribute('data-novaflow-topbar-ai-runtime-connected') === '1' ? 'connected' : 'disconnected';
  }

  function render() {
    const host = doc().getElementById(HOST_ID);
    const chip = doc().getElementById(CHIP_ID);
    if (!host || !chip) return;
    const label = host.querySelector(LABEL_SELECTOR);
    const phase = phaseOf(host);
    const node = runtime() ? runtime().computeNode : null;
    chip.textContent = chipText(node, phase, label ? label.textContent : '');
    chip.setAttribute('data-phase', phase);
    chip.title = node ? '当前算力源：' + node.name + '（点击更换）' : '点击选择 AI 算力源';
  }

  // Right after a switch, ask once instead of waiting for the 15 s poll.
  async function probe() {
    try {
      const status = typeof api().runtimeGetStatus === 'function' ? await api().runtimeGetStatus() : null;
      const host = doc().getElementById(HOST_ID);
      if (!host || !status) return;
      const connected = !!(status.running || status.connected);
      host.setAttribute('data-novaflow-topbar-ai-runtime-connected', connected ? '1' : '0');
      host.setAttribute('data-novaflow-topbar-ai-runtime-phase', connected ? 'connected' : (status.status === 'starting' ? 'starting' : 'disconnected'));
      render();
    } catch (_) { /* the poll will catch up */ }
  }

  // ---------------------------------------------------------------- dialog
  function close() {
    const open = doc().getElementById(DIALOG_ID);
    if (open) { if (open.open) open.close(); open.remove(); }
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    previousFocus = null;
  }

  function rowNode(row, onPick) {
    const btn = el('button', 'nf-node-row');
    btn.type = 'button';
    btn.setAttribute('data-node-id', row.id || '');
    if (row.selected) btn.setAttribute('aria-current', 'true');
    if (row.locked) btn.setAttribute('aria-disabled', 'true');
    const main = el('div', 'nf-node-main');
    main.appendChild(el('div', 'nf-node-name', row.name));
    main.appendChild(el('div', 'nf-node-hint', row.hint));
    btn.appendChild(main);
    const badge = el('span', 'nf-node-badge', STATUS_TEXT[row.status] || row.status);
    badge.setAttribute('data-status', row.status);
    btn.appendChild(badge);
    btn.addEventListener('click', () => onPick(row));
    return btn;
  }

  async function open() {
    close();
    const rt = runtime();
    if (!rt) return;
    ensureStyle();
    previousFocus = doc().activeElement;

    const backdrop = el('dialog');
    backdrop.id = DIALOG_ID;
    backdrop.setAttribute('aria-labelledby', DIALOG_ID + '-title');
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    const card = el('section', 'nf-node-card');
    const head = el('header', 'nf-node-header');
    const title = el('h2', '', '选择 AI 算力源');
    title.id = DIALOG_ID + '-title';
    const x = el('button', 'nf-node-close', '×');
    x.type = 'button'; x.setAttribute('aria-label', '关闭');
    x.addEventListener('click', close);
    head.appendChild(title); head.appendChild(x); card.appendChild(head);
    const body = el('div', 'nf-node-body'); card.appendChild(body);
    const list = el('div', 'nf-node-list'); body.appendChild(list);
    const note = el('div', 'nf-node-note', '正在读取算力节点…');
    note.setAttribute('role', 'status'); body.appendChild(note);
    backdrop.appendChild(card);
    doc().body.appendChild(backdrop);
    if (typeof backdrop.showModal === 'function') backdrop.showModal(); else backdrop.setAttribute('open', '');

    let reply;
    try { reply = await rt.listComputeNodes(); }
    catch (error) {
      if (!backdrop.isConnected) return;
      note.classList.add('nf-node-warn');
      note.textContent = error && (error.status === 401 || error.status === 403)
        ? '请先登录 NovaFlow 账号，再选择算力源。'
        : '读取算力节点失败：' + String((error && error.message) || error);
      return;
    }
    if (!backdrop.isConnected) return;

    const { allowed, rows } = buildRows(reply, rt.computeNode, rt.localAssistant);
    const pick = (row) => {
      if (row.locked) { note.classList.add('nf-node-warn'); note.textContent = CONTACT_ADMIN; return; }
      rt.setComputeNode(row.id ? { id: row.id, name: row.name } : null);
      close();
      render();
      void probe();
    };
    for (const row of rows) list.appendChild(rowNode(row, pick));
    if (!allowed) {
      note.classList.add('nf-node-warn');
      note.textContent = CONTACT_ADMIN;
    } else {
      note.textContent = rows.length > 1
        ? '点击节点即切换。「空闲」表示现在就能开始，「忙碌」会排队等它，「离线」要等它重新上线。'
        : '算力池里还没有其他节点。';
    }
  }

  // ----------------------------------------------------------------- mount
  function mount() {
    if (doc().getElementById(CHIP_ID)) return true;
    const host = doc().getElementById(HOST_ID);
    if (!host) return false;
    const label = host.querySelector(LABEL_SELECTOR);
    if (!label) return false;
    ensureStyle();
    // The brand runtime keeps writing this label; it stays as the source of
    // the phase and the wording, hidden behind the chip.
    label.style.setProperty('display', 'none', 'important');
    const chip = el('button');
    chip.id = CHIP_ID;
    chip.type = 'button';
    chip.addEventListener('click', open);
    host.insertBefore(chip, label);
    if (typeof root.MutationObserver === 'function') {
      const observer = new root.MutationObserver(render);
      observer.observe(host, { attributes: true, attributeFilter: ['data-novaflow-topbar-ai-runtime-phase', 'data-novaflow-topbar-ai-runtime-connected'] });
      observer.observe(label, { childList: true, characterData: true, subtree: true });
    }
    if (typeof root.addEventListener === 'function') root.addEventListener('novaflow:compute-node', render);
    render();
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (mount() || attempts > 120) clearInterval(timer);
  }, 500);

  root.NovaFlowWebComputeNode = { open, close, mount, render, chipText, buildRows, CONTACT_ADMIN };
})(typeof globalThis !== 'undefined' ? globalThis : this);
