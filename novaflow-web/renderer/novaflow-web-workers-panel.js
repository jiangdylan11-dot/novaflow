// 我的算力节点 - the panel that makes adding a compute node a UI action.
//
// Bringing a new machine online must not require touching the database, an IP,
// a .env or the source. This panel is the whole loop:
//
//   mint a one-time code  ->  install NovaFlowWorkerSetup.exe on the machine
//   ->  paste the code    ->  it registers itself, detects GPU/ComfyUI/models
//   ->  heartbeats        ->  Online  ->  the scheduler starts giving it work
//
// A cloud GPU, a friend's PC and the owner's own desktop all use this path.
//
// It is a Web-line patch module: it injects its own button and dialog, so it
// adds a surface the desktop renderer does not have without altering any of
// the renderer's own code.

(function (root) {
  'use strict';

  const BUTTON_ID = 'novaflow-web-workers-button';
  const DIALOG_ID = 'novaflow-web-workers-dialog';
  const POLL_MS = 8000;

  const runtime = () => root.NovaFlowWebRuntime;
  let pollTimer = 0;

  const STATUS_TEXT = { idle: '空闲', busy: '工作中', offline: '离线', maintenance: '维护中' };
  const STATUS_COLOR = {
    idle: 'rgba(126,232,181,0.95)',
    busy: 'rgba(250,204,21,0.95)',
    offline: 'rgba(255,255,255,0.45)',
    maintenance: 'rgba(255,255,255,0.45)'
  };

  function el(tag, style, text) {
    const node = root.document.createElement(tag);
    if (style) node.setAttribute('style', style);
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, primary) {
    return el('button', [
      'height:30px', 'padding:0 12px', 'border:0', 'border-radius:7px',
      'cursor:pointer', 'font:inherit', 'font-size:12px',
      primary ? 'background:#1ea672;color:#fff;font-weight:600' : 'background:#333;color:#e5e7eb'
    ].join(';'), label);
  }

  // -------------------------------------------------------------------------
  function closeDialog() {
    const existing = root.document.getElementById(DIALOG_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
  }

  async function openDialog() {
    closeDialog();

    const backdrop = el('div', [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:2147483600'
    ].join(';'));
    backdrop.id = DIALOG_ID;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDialog(); });

    const card = el('div', [
      'width:560px', 'max-width:calc(100vw - 32px)', 'max-height:80vh', 'overflow:auto',
      'background:#1c1c1c', 'border:1px solid #2c2c2c', 'border-radius:12px',
      'padding:20px', 'color:#e5e7eb',
      'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
      'box-shadow:0 18px 48px rgba(0,0,0,0.48)'
    ].join(';'));

    const head = el('div', 'display:flex;align-items:center;gap:10px;margin-bottom:14px');
    head.appendChild(el('div', 'font-size:16px;font-weight:600', '我的算力节点'));
    head.appendChild(el('div', 'flex:1'));
    const closeBtn = button('关闭');
    closeBtn.addEventListener('click', closeDialog);
    head.appendChild(closeBtn);
    card.appendChild(head);

    const workersBox = el('div', 'display:flex;flex-direction:column;gap:6px;margin-bottom:16px');
    card.appendChild(workersBox);

    // ---- add a machine ----------------------------------------------------
    const addBox = el('div', 'background:#171717;border-radius:9px;padding:14px;display:flex;flex-direction:column;gap:10px');
    addBox.appendChild(el('div', 'font-weight:600;font-size:13px', '接入一台新机器'));
    addBox.appendChild(el('div', 'color:#a0a0a0;font-size:12px;line-height:1.7',
      '生成一个一次性注册码，在新机器上安装 NovaFlowWorkerSetup.exe，' +
      '填入下面的控制面地址和注册码，点「启动」即可。' +
      '云 GPU、朋友的电脑和你自己的电脑用的是同一套流程，不需要改数据库、配 IP 或改代码。'));

    const controlRow = el('div', 'display:flex;gap:8px;align-items:center');
    controlRow.appendChild(el('span', 'color:#a0a0a0;font-size:12px;flex:none', '控制面地址'));
    const controlInput = el('input', [
      'flex:1', 'background:#070707', 'color:#e5e7eb', 'border:1px solid #2a2a2a',
      'border-radius:6px', 'padding:6px 8px', 'font:inherit', 'font-size:12px'
    ].join(';'));
    controlInput.value = (runtime() && runtime().config.controlUrl) || '';
    controlInput.readOnly = true;
    const copyControl = button('复制');
    copyControl.addEventListener('click', async () => {
      await copy(controlInput.value, copyControl, '复制');
    });
    controlRow.appendChild(controlInput);
    controlRow.appendChild(copyControl);
    addBox.appendChild(controlRow);

    const labelRow = el('div', 'display:flex;gap:8px;align-items:center');
    labelRow.appendChild(el('span', 'color:#a0a0a0;font-size:12px;flex:none', '备注'));
    const labelInput = el('input', [
      'flex:1', 'background:#070707', 'color:#e5e7eb', 'border:1px solid #2a2a2a',
      'border-radius:6px', 'padding:6px 8px', 'font:inherit', 'font-size:12px'
    ].join(';'));
    labelInput.placeholder = '例如：老王的 4090';
    const mintBtn = button('生成注册码', true);
    labelRow.appendChild(labelInput);
    labelRow.appendChild(mintBtn);
    addBox.appendChild(labelRow);

    const codeBox = el('div', 'display:none;flex-direction:column;gap:6px');
    addBox.appendChild(codeBox);
    card.appendChild(addBox);

    mintBtn.addEventListener('click', async () => {
      mintBtn.disabled = true;
      mintBtn.textContent = '生成中…';
      try {
        const res = await runtime().control('POST', '/api/web/workers/codes', {
          label: labelInput.value.trim(), max_uses: 1, valid_days: 7
        });
        codeBox.style.display = 'flex';
        codeBox.textContent = '';

        const codeRow = el('div', 'display:flex;gap:8px;align-items:center');
        const code = el('div', [
          'flex:1', 'background:#0b0b0b', 'border:1px solid #1ea672', 'border-radius:6px',
          'padding:9px 10px', 'font:600 15px ui-monospace,Consolas,monospace',
          'letter-spacing:1px', 'color:#7ce8b5', 'user-select:all'
        ].join(';'), res.registration_code);
        const copyBtn = button('复制', true);
        copyBtn.addEventListener('click', () => copy(res.registration_code, copyBtn, '复制'));
        codeRow.appendChild(code);
        codeRow.appendChild(copyBtn);
        codeBox.appendChild(codeRow);
        codeBox.appendChild(el('div', 'color:#a0a0a0;font-size:11px;line-height:1.6',
          '只显示这一次，请立刻复制。一次性使用，' +
          new Date(res.expires_at).toLocaleString() + ' 过期。'));
      } catch (error) {
        codeBox.style.display = 'flex';
        codeBox.textContent = '';
        codeBox.appendChild(el('div',
          'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;' +
          'border-radius:6px;padding:8px 10px;font-size:12px',
          '生成失败：' + (error && error.message ? error.message : error)));
      } finally {
        mintBtn.disabled = false;
        mintBtn.textContent = '生成注册码';
      }
    });

    backdrop.appendChild(card);
    root.document.body.appendChild(backdrop);

    await refreshWorkers(workersBox);
    pollTimer = setInterval(() => { refreshWorkers(workersBox).catch(() => {}); }, POLL_MS);
  }

  async function copy(text, btn, restore) {
    try {
      await root.navigator.clipboard.writeText(text);
      btn.textContent = '已复制';
    } catch (_) {
      btn.textContent = '复制失败';
    }
    setTimeout(() => { btn.textContent = restore; }, 1400);
  }

  async function refreshWorkers(box) {
    let workers = [];
    try {
      const res = await runtime().control('GET', '/api/web/workers');
      workers = res.workers || [];
    } catch (error) {
      box.textContent = '';
      box.appendChild(el('div', 'color:#fca5a5;font-size:12px',
        '读取算力节点失败：' + (error && error.message ? error.message : error)));
      return;
    }

    box.textContent = '';
    if (!workers.length) {
      box.appendChild(el('div', 'color:#6b7280;font-size:12px;padding:10px 0',
        '还没有算力节点。生成一个注册码，在有显卡的机器上接入。'));
      return;
    }

    for (const w of workers) {
      const row = el('div', [
        'display:flex', 'align-items:center', 'gap:10px',
        'background:#171717', 'border-radius:7px', 'padding:9px 11px'
      ].join(';'));
      const dot = el('span', [
        'width:8px', 'height:8px', 'border-radius:50%', 'flex:none',
        'background:' + (STATUS_COLOR[w.status] || '#555')
      ].join(';'));
      const name = el('div', 'flex:1;min-width:0');
      name.appendChild(el('div', 'font-weight:500', w.worker_name));
      name.appendChild(el('div', 'color:#6b7280;font-size:11px;margin-top:2px',
        (w.gpu_name || 'GPU 未知') +
        (w.vram_mb ? ' · ' + Math.round(w.vram_mb / 1024) + 'GB' : '') +
        (w.comfy_version ? ' · ComfyUI ' + w.comfy_version : '') +
        ' · 完成 ' + (w.total_completed || 0) + ' / 失败 ' + (w.total_failed || 0)));
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(el('span', 'color:' + (STATUS_COLOR[w.status] || '#555') + ';font-size:12px;flex:none',
        STATUS_TEXT[w.status] || w.status));
      box.appendChild(row);
    }
  }

  // -------------------------------------------------------------------------
  // The button goes INSIDE the topbar's AI runtime status box, next to 释放内存.
  // That is where a user already looks to ask "is there GPU available", and it
  // is the one place the brand runtime will not fight over: that box is
  // repositioned on a timer relative to .nf-topbar-right, so a sibling inserted
  // beside it gets reordered on the next tick, while a child does not. Its
  // children are only ever read, never replaced.
  function mountButton() {
    if (root.document.getElementById(BUTTON_ID)) return true;
    const host = root.document.getElementById('novaflow-topbar-ai-runtime-status');
    if (!host) return false;

    const btn = root.document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = '算力节点';
    btn.title = '查看算力节点，或生成注册码接入一台新机器';
    // The app forces its own button styling through !important rules, so these
    // have to be declared the same way to survive.
    const styles = {
      height: '30px', 'min-height': '30px', 'max-height': '30px',
      padding: '0 10px', border: '0', 'border-radius': '8px',
      background: '#333333', 'background-color': '#333333', 'background-image': 'none',
      color: '#ffffff', 'font-size': '12px', 'line-height': '1',
      'box-shadow': 'none', 'white-space': 'nowrap', cursor: 'pointer',
      '-webkit-app-region': 'no-drag'
    };
    for (const [prop, value] of Object.entries(styles)) btn.style.setProperty(prop, value, 'important');
    btn.addEventListener('click', openDialog);
    host.appendChild(btn);
    return true;
  }

  // The topbar is built by the renderer after its own boot, so this retries
  // until the anchor exists rather than assuming a moment.
  let attempts = 0;
  const mountTimer = setInterval(() => {
    attempts += 1;
    if (mountButton() || attempts > 120) clearInterval(mountTimer);
  }, 500);

  root.NovaFlowWebWorkersPanel = { open: openDialog, close: closeDialog, mount: mountButton };
})(typeof globalThis !== 'undefined' ? globalThis : this);
