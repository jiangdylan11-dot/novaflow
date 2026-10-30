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
  const CONTACT_ADMIN = '普通账户只能使用本机算力。需要使用其他算力节点，请联系管理员开通中级或高级账户。';
  const PREMIUM_LOCKED = '中级账户只能使用普通算力节点。需要使用高级算力节点，请联系管理员升级为高级账户。';
  const STATUS_TEXT = { idle: '空闲', busy: '忙碌', offline: '离线', local: '本机', auto: '自动' };
  const TIER_TEXT = { standard: '普通节点', premium: '高级节点', own: '本人设备' };
  // The pool is shown in two groups. A 中级账户 may pick from the first only;
  // a 高级账户 from both. The order is the order of the tiers.
  const TIER_GROUPS = [
    { tier: 'own', title: '我的算力', hint: '后台为本人开通的设备' },
    { tier: 'standard', title: '普通算力节点', hint: '中级及以上账户可用' },
    { tier: 'premium', title: '高级算力节点', hint: '仅高级账户可用' }
  ];

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
    '#' + DIALOG_ID + '{border:0;padding:0;background:transparent;color:#dddddd;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}',
    '#' + DIALOG_ID + ',#' + DIALOG_ID + ' *{box-sizing:border-box}',
    '#' + DIALOG_ID + '::backdrop{background:rgba(0,0,0,.62)}',
    '#' + DIALOG_ID + ' .nf-node-card{width:420px;max-width:calc(100vw - 32px);background:#212121;border:1px solid #393939;border-radius:8px;overflow:hidden;box-shadow:none}',
    '#' + DIALOG_ID + ' .nf-node-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#1d1d1d;border-bottom:1px solid #333333}',
    '#' + DIALOG_ID + ' .nf-node-header h2{margin:0;font-size:14px;font-weight:500;line-height:28px;color:#dedede}',
    '#' + DIALOG_ID + ' .nf-node-close{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:#999999;font:inherit;font-size:18px;line-height:1;cursor:pointer}',
    '#' + DIALOG_ID + ' .nf-node-close:hover{background:#303030;color:#e1e1e1}',
    '#' + DIALOG_ID + ' .nf-node-body{padding:14px 16px 16px;display:grid;gap:13px}',
    '#' + DIALOG_ID + ' .nf-node-list{display:grid;gap:6px;max-height:min(52vh,420px);overflow:auto}',
    // Keep this dialog's selection border above the global transparent-button border.
    '#' + DIALOG_ID + ' .nf-node-row{appearance:none;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:11px 12px;border:1px solid #353535!important;border-radius:6px;background:#282828;color:#dddddd;font:inherit;text-align:left;cursor:pointer}',
    '#' + DIALOG_ID + ' .nf-node-row:not([aria-disabled="true"]):hover{border-color:#505050!important;background:#2e2e2e}',
    '#' + DIALOG_ID + ' .nf-node-row[aria-current="true"]{border-color:#399b80!important;background:#252b29}',
    '#' + DIALOG_ID + ' .nf-node-row[aria-disabled="true"]{opacity:.55;cursor:not-allowed}',
    '#' + DIALOG_ID + ' .nf-node-main{min-width:0}',
    '#' + DIALOG_ID + ' .nf-node-name{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:13px;font-weight:500;color:#e4e4e4}',
    '#' + DIALOG_ID + ' .nf-node-hint{margin-top:3px;font-size:11px;line-height:17px;color:#a7a7a7;overflow-wrap:anywhere}',
    '#' + DIALOG_ID + ' .nf-node-group{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:2px 12px;padding:8px 1px 1px;font-size:11px;color:#949494}',
    '#' + DIALOG_ID + ' .nf-node-group b{font-size:12px;font-weight:500;color:#c5c5c5}',
    '#' + DIALOG_ID + ' .nf-node-tier{display:inline-block;padding:1px 5px;border:1px solid #414141;border-radius:4px;font-size:11px;font-weight:400;line-height:15px;background:#2c2c2c;color:#b3b3b3;white-space:nowrap}',
    '#' + DIALOG_ID + ' .nf-node-badge{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:4px;font-size:11px;line-height:16px;background:#333333;color:#bcbcbc;white-space:nowrap}',
    '#' + DIALOG_ID + ' .nf-node-badge[data-status="idle"]::before,#' + DIALOG_ID + ' .nf-node-badge[data-status="busy"]::before,#' + DIALOG_ID + ' .nf-node-badge[data-status="offline"]::before{content:"";width:4px;height:4px;border-radius:50%;background:#878787}',
    '#' + DIALOG_ID + ' .nf-node-badge[data-status="idle"]::before{background:#49b895}',
    '#' + DIALOG_ID + ' .nf-node-badge[data-status="busy"]::before{background:#c8ad66}',
    '#' + DIALOG_ID + ' .nf-node-note{margin:0 1px;font-size:12px;line-height:1.75;color:#a3a3a3}',
    '#' + DIALOG_ID + ' .nf-node-note.nf-node-warn{color:#d1a093}'
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
   *
   * `allowed` is whether this account may pin any pool node (中级 or 高级);
   * `premium` whether it may also pin a 高级 node. Pool rows carry their tier
   * and come back grouped by it, so the dialog can head each group.
   */
  function buildRows(reply, current, localAssistant) {
    const allowed = !!(reply && reply.compute && reply.compute.shared);
    const premium = allowed && !!(reply.compute.premium);
    const nodes = (reply && Array.isArray(reply.nodes)) ? reply.nodes : [];
    const hasOwn = nodes.some((node) => node.is_owner && node.can_use !== false);
    const rows = [];
    if (localAssistant) {
      rows.push({ id: null, name: '本机', hint: '启动Foart 的这台电脑', status: 'local', locked: false, selected: !current });
    } else {
      rows.push({
        id: null,
        name: '自动分配',
        hint: !allowed && hasOwn ? '自动使用本人可用的算力' : premium ? '任意空闲的算力节点' : '任意空闲的普通算力节点',
        status: 'auto',
        locked: !allowed && !hasOwn,
        selected: !current
      });
    }
    for (const n of nodes) {
      const status = ['idle', 'busy', 'offline'].includes(String(n.status)) ? String(n.status) : (n.online ? 'busy' : 'offline');
      const tier = String(n.tier) === 'premium' ? 'premium' : 'standard';
      rows.push({
        id: String(n.id),
        name: String(n.name || '未命名节点'),
        hint: [n.is_owner ? '本人设备' : '', n.gpu_name, vramText(n.vram_mb)].filter(Boolean).join(' · ') || '算力节点',
        tier: n.is_owner ? 'own' : tier,
        status,
        locked: n.can_use === false || (!n.is_owner && (!allowed || (tier === 'premium' && !premium))),
        selected: !!(current && String(current.id) === String(n.id))
      });
    }
    const groups = TIER_GROUPS
      .map((group) => ({ tier: group.tier, title: group.title, hint: group.hint, rows: rows.filter((r) => r.id && r.tier === group.tier) }))
      .filter((group) => group.rows.length);
    return { allowed, premium, rows, groups };
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
    const name = el('div', 'nf-node-name', row.name);
    if (row.tier) {
      const tier = el('span', 'nf-node-tier', TIER_TEXT[row.tier] || row.tier);
      tier.setAttribute('data-tier', row.tier);
      name.appendChild(tier);
    }
    main.appendChild(name);
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
        ? '请先登录 Foart 账号，再选择算力源。'
        : '读取算力节点失败：' + String((error && error.message) || error);
      return;
    }
    if (!backdrop.isConnected) return;

    const { allowed, premium, rows, groups } = buildRows(reply, rt.computeNode, rt.localAssistant);
    const pick = (row) => {
      if (row.locked) {
        note.classList.add('nf-node-warn');
        note.textContent = allowed && row.tier === 'premium' ? PREMIUM_LOCKED : CONTACT_ADMIN;
        return;
      }
      rt.setComputeNode(row.id ? { id: row.id, name: row.name } : null);
      close();
      render();
      void probe();
    };
    // The default source first, then the pool in its two tiers, each headed.
    list.appendChild(rowNode(rows[0], pick));
    for (const group of groups) {
      const head = el('div', 'nf-node-group');
      head.appendChild(el('b', '', group.title));
      head.appendChild(el('span', '', group.hint));
      list.appendChild(head);
      for (const row of group.rows) list.appendChild(rowNode(row, pick));
    }
    if (!allowed && rows.some((row) => row.id && !row.locked)) {
      note.textContent = '可以使用后台为你开通的本人设备。对外分享由管理员单独设置。';
    } else if (!allowed) {
      note.classList.add('nf-node-warn');
      note.textContent = CONTACT_ADMIN;
    } else if (rows.length <= 1) {
      note.textContent = '算力池里还没有其他节点。';
    } else if (!premium) {
      note.textContent = '点击节点即切换。中级账户只能选普通算力节点，「自动分配」也只会落到普通节点；高级算力节点需要高级账户。';
    } else {
      note.textContent = '点击节点即切换。「空闲」表示现在就能开始，「忙碌」会排队等它，「离线」要等它重新上线。';
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

  root.NovaFlowWebComputeNode = { open, close, mount, render, chipText, buildRows, CONTACT_ADMIN, PREMIUM_LOCKED, TIER_TEXT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
