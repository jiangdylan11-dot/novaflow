// The account control in the topbar.
//
// Everything on the Web needs a signed-in account: creating a task, reading
// credits, minting a file grant. Without one the control plane answers
// "missing session token" and the panels surface that raw, so a stranger who
// opens the site sees
//
//   missing session token
//   NovaFlow AI Runtime 未连接: 200
//   下发失败：503（HTTP 503）
//
// three different noises for one cause, and no way to act on any of them. The
// login the renderer already ships is real and works, but it lives inside
// 动画 → 模式选择 → NovaFlow 账号, which is not where someone looks when the
// app says "503".
//
// So the topbar says whether you are signed in, and clicking it signs you in.
// It is a Web-line patch module: it adds its own control and never edits the
// renderer.

(function (root) {
  'use strict';

  const BUTTON_ID = 'novaflow-web-account-button';
  const DIALOG_ID = 'novaflow-web-account-dialog';

  const runtime = () => root.NovaFlowWebRuntime;
  const api = () => root.electronAPI || {};

  function el(tag, style, text) {
    const node = root.document.createElement(tag);
    if (style) node.setAttribute('style', style);
    if (text != null) node.textContent = text;
    return node;
  }

  const FIELD = [
    'width:100%', 'box-sizing:border-box', 'background:#0b0b0b', 'color:#e5e7eb',
    'border:1px solid #2a2a2a', 'border-radius:7px', 'padding:9px 10px',
    'font:inherit', 'font-size:13px'
  ].join(';');

  function close() {
    const open = root.document.getElementById(DIALOG_ID);
    if (open && open.parentNode) open.parentNode.removeChild(open);
  }

  async function currentUser() {
    try {
      const res = await api().clientAuthStatus();
      const r = res && res.result;
      return r && r.authenticated ? r : null;
    } catch (_) {
      return null;
    }
  }

  async function open() {
    close();
    const who = await currentUser();

    const backdrop = el('div', [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:2147483600'
    ].join(';'));
    backdrop.id = DIALOG_ID;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    const card = el('div', [
      'width:380px', 'max-width:calc(100vw - 32px)', 'background:#1c1c1c',
      'border:1px solid #2c2c2c', 'border-radius:12px', 'padding:20px',
      'color:#e5e7eb', 'display:flex', 'flex-direction:column', 'gap:10px',
      'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
      'box-shadow:0 18px 48px rgba(0,0,0,0.48)'
    ].join(';'));

    const head = el('div', 'display:flex;align-items:center;margin-bottom:4px');
    head.appendChild(el('div', 'font-size:16px;font-weight:600;flex:1',
      who ? 'NovaFlow 账号' : '登录 NovaFlow'));
    const x = el('button', 'background:transparent;border:0;color:#6b7280;font-size:20px;cursor:pointer;line-height:1', '×');
    x.addEventListener('click', close);
    head.appendChild(x);
    card.appendChild(head);

    if (who) {
      const name = who.user && (who.user.display_name || who.user.email) || '已登录';
      card.appendChild(el('div', 'color:#e5e7eb;font-size:14px', name));
      card.appendChild(el('div', 'color:#6b7280;font-size:12px',
        '积分 ' + ((who.credits && who.credits.balance) ?? 0) +
        '（自有算力出图不计积分，只有 Grok / GPT / Google 才扣）'));
      const out = el('button', [
        'margin-top:8px', 'height:34px', 'border:0', 'border-radius:8px',
        'background:#333', 'color:#e5e7eb', 'font:inherit', 'font-size:13px', 'cursor:pointer'
      ].join(';'), '退出登录');
      out.addEventListener('click', async () => {
        try { await api().clientAuthLogout(); } catch (_) {}
        root.location.reload();
      });
      card.appendChild(out);
      backdrop.appendChild(card);
      root.document.body.appendChild(backdrop);
      return;
    }

    card.appendChild(el('div', 'color:#a0a0a0;font-size:12px;line-height:1.7',
      '用你的 NovaFlow 账号登录。生成、读取积分、取回结果都需要登录后才能进行。'));

    const account = el('input', FIELD);
    account.placeholder = '账号';
    account.autocomplete = 'username';
    const password = el('input', FIELD);
    password.placeholder = '密码';
    password.type = 'password';
    password.autocomplete = 'current-password';
    card.appendChild(account);
    card.appendChild(password);

    const submit = el('button', [
      'height:36px', 'border:0', 'border-radius:8px', 'background:#1ea672',
      'color:#fff', 'font:inherit', 'font-size:13px', 'font-weight:600', 'cursor:pointer'
    ].join(';'), '登录');
    card.appendChild(submit);

    const note = el('div', 'font-size:12px;line-height:1.6;min-height:18px;color:#a0a0a0');
    card.appendChild(note);

    async function login() {
      const name = account.value.trim();
      if (!name || !password.value) {
        note.style.color = '#fca5a5';
        note.textContent = '请填账号和密码。';
        return;
      }
      submit.disabled = true;
      submit.textContent = '登录中…';
      note.style.color = '#a0a0a0';
      note.textContent = '';
      try {
        const res = await api().clientAuthLogin({ account: name, password: password.value });
        if (!res || res.ok === false) throw new Error((res && res.error) || '登录失败');
        note.style.color = '#7ce8b5';
        note.textContent = '已登录，正在刷新…';
        setTimeout(() => root.location.reload(), 400);
      } catch (error) {
        note.style.color = '#fca5a5';
        note.textContent = String((error && error.message) || error);
        submit.disabled = false;
        submit.textContent = '登录';
      }
    }
    submit.addEventListener('click', login);
    password.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    account.addEventListener('keydown', (e) => { if (e.key === 'Enter') password.focus(); });

    backdrop.appendChild(card);
    root.document.body.appendChild(backdrop);
    setTimeout(() => { try { account.focus(); } catch (_) {} }, 50);
  }

  // -------------------------------------------------------------------------
  // The button sits in the topbar's AI status box, next to 「AI 已连接」 - the
  // one place in the topbar that already reports whether you can generate.
  async function refresh(btn) {
    const who = await currentUser();
    const label = who
      ? (who.user && (who.user.display_name || who.user.email) || '已登录')
      : '登录';
    if (btn.textContent !== label) btn.textContent = label;
    const colour = who ? '#e5e7eb' : '#ffffff';
    const background = who ? '#333333' : '#1ea672';
    btn.style.setProperty('color', colour, 'important');
    btn.style.setProperty('background', background, 'important');
    btn.style.setProperty('background-color', background, 'important');
  }

  function mount() {
    if (root.document.getElementById(BUTTON_ID)) return true;
    const host = root.document.getElementById('novaflow-topbar-ai-runtime-status');
    if (!host) return false;

    const btn = root.document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = '登录';
    btn.title = 'NovaFlow 账号';
    const styles = {
      height: '30px', 'min-height': '30px', 'max-height': '30px',
      padding: '0 12px', border: '0', 'border-radius': '8px',
      background: '#1ea672', 'background-image': 'none',
      color: '#ffffff', 'font-size': '12px', 'font-weight': '600',
      'line-height': '1', 'box-shadow': 'none', 'white-space': 'nowrap',
      cursor: 'pointer', '-webkit-app-region': 'no-drag'
    };
    for (const [k, v] of Object.entries(styles)) btn.style.setProperty(k, v, 'important');
    btn.addEventListener('click', open);
    host.appendChild(btn);

    refresh(btn);
    setInterval(() => refresh(btn), 15000);
    return true;
  }

  // -------------------------------------------------------------------------
  // The gate.
  //
  // Nothing in the app works signed out, so letting someone in and then failing
  // every action with an API error is the wrong order. Ask first.
  //
  // It covers the app rather than replacing it: the renderer boots underneath
  // exactly as it always does, which keeps this a patch module and not a fork
  // of the startup path.
  const GATE_ID = 'novaflow-web-login-gate';

  function removeGate() {
    const gate = root.document.getElementById(GATE_ID);
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
  }

  function buildGate() {
    // The shared modal scanner may clear inline backdrop styles. Keep the
    // login screen opaque and above the editor while it is signed out.
    if (!root.document.getElementById(GATE_ID + '-style')) {
      const style = el('style', '', '#' + GATE_ID + '{background:#0b0b0b!important;z-index:2147483640!important}');
      style.id = GATE_ID + '-style';
      root.document.head.appendChild(style);
    }
    const gate = el('div', [
      'position:fixed', 'inset:0', 'z-index:2147483640',
      'background:#0b0b0b', 'display:flex', 'align-items:center',
      'justify-content:center', 'flex-direction:column', 'gap:22px',
      'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif'
    ].join(';'));
    gate.id = GATE_ID;

    const logo = el('img', [
      'display:block', 'width:320px', 'max-width:calc(100vw - 64px)',
      'height:auto', 'object-fit:contain'
    ].join(';'));
    logo.src = './assets/logo.png';
    logo.alt = 'NovaFlow';
    logo.draggable = false;
    gate.appendChild(logo);

    const card = el('div', [
      'width:340px', 'max-width:calc(100vw - 32px)', 'background:#161616',
      'border:1px solid #242424', 'border-radius:12px', 'padding:22px',
      'display:flex', 'flex-direction:column', 'gap:10px', 'color:#e5e7eb'
    ].join(';'));

    card.appendChild(el('div', 'color:#a0a0a0;font-size:12px;line-height:1.7;margin-bottom:2px',
      '请使用 NovaFlow 账号登录。没有账号请找管理员开通。'));

    const account = el('input', FIELD);
    account.placeholder = '账号';
    account.autocomplete = 'username';
    const password = el('input', FIELD);
    password.placeholder = '密码';
    password.type = 'password';
    password.autocomplete = 'current-password';
    card.appendChild(account);
    card.appendChild(password);

    const submit = el('button', [
      'height:38px', 'border:0', 'border-radius:8px', 'background:#1ea672',
      'color:#fff', 'font:inherit', 'font-size:14px', 'font-weight:600',
      'cursor:pointer', 'margin-top:4px'
    ].join(';'), '登录');
    card.appendChild(submit);

    const note = el('div', 'font-size:12px;line-height:1.6;min-height:18px;color:#a0a0a0');
    card.appendChild(note);

    async function login() {
      const name = account.value.trim();
      if (!name || !password.value) {
        note.style.color = '#fca5a5';
        note.textContent = '请填账号和密码。';
        return;
      }
      submit.disabled = true;
      submit.textContent = '登录中…';
      note.style.color = '#a0a0a0';
      note.textContent = '';
      try {
        const res = await api().clientAuthLogin({ account: name, password: password.value });
        if (!res || res.ok === false) throw new Error((res && res.error) || '登录失败');
        note.style.color = '#7ce8b5';
        note.textContent = '已登录，正在进入…';
        // Reload rather than just lifting the gate: panels read the session at
        // boot, and a half-initialised app is worse than a second of waiting.
        setTimeout(() => root.location.reload(), 400);
      } catch (error) {
        note.style.color = '#fca5a5';
        note.textContent = String((error && error.message) || error);
        submit.disabled = false;
        submit.textContent = '登录';
      }
    }
    submit.addEventListener('click', login);
    password.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    account.addEventListener('keydown', (e) => { if (e.key === 'Enter') password.focus(); });

    gate.appendChild(card);
    setTimeout(() => { try { account.focus(); } catch (_) {} }, 80);
    return gate;
  }

  async function guard() {
    if (await currentUser()) {
      removeGate();
      return;
    }
    if (root.document.getElementById(GATE_ID)) return;
    if (!root.document.body) { setTimeout(guard, 120); return; }
    root.document.body.appendChild(buildGate());
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (mount() || attempts > 120) clearInterval(timer);
  }, 500);

  guard();

  root.NovaFlowWebAccount = { open: open, close: close, mount: mount, guard: guard, removeGate: removeGate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
