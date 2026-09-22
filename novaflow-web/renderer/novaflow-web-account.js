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

  const api = () => root.electronAPI || {};
  let previousFocus, dialogRequest = 0;

  // Web-only presentation. Keep the shared desktop account module running for
  // authorization, but present its account controls only through the topbar.
  const styles = el('style', '', `
html body [data-novaflow-client-auth-panel="1"]{display:none!important}
#novaflow-web-account-dialog{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:20px!important;box-sizing:border-box;background:transparent!important;border:0!important;outline:0;color:#ddd;font:13px "Segoe UI",Tahoma,Geneva,Verdana,sans-serif;overflow:auto}
#novaflow-web-account-dialog[open]{display:flex!important;align-items:center;justify-content:center}
#novaflow-web-account-dialog::backdrop{background:rgba(0,0,0,.55)}
#novaflow-web-account-dialog .nf-account-card{width:420px;max-width:100%;box-sizing:border-box;background:#212121!important;border:1px solid #ffffff1a!important;border-radius:8px!important;overflow:hidden;box-shadow:none!important;color:#ddd}
#novaflow-web-account-dialog .nf-account-header{display:flex;align-items:center;gap:12px;background:#1d1d1d;border-bottom:1px solid #333;padding:12px 14px}
#novaflow-web-account-dialog .nf-account-header h2{margin:0;color:#ccc;font:600 13px/26px "Segoe UI",sans-serif;flex:1}
#novaflow-web-account-dialog .nf-account-close{background:none!important;border:0!important;color:#9a9a9a!important;font:16px/16px "Segoe UI",sans-serif;padding:1px 6px;cursor:pointer}
#novaflow-web-account-dialog .nf-account-body{padding:18px 14px 14px;display:flex;flex-direction:column;gap:14px}
#novaflow-web-account-dialog .nf-account-user{font-size:14px;color:#ddd;font-weight:600}
#novaflow-web-account-dialog .nf-account-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#novaflow-web-account-dialog .nf-account-metric{background:#191919;border:1px solid #ffffff0a;border-radius:8px;padding:14px 12px}
#novaflow-web-account-dialog .nf-account-label{font-size:12px;color:#999;margin-bottom:7px}
#novaflow-web-account-dialog .nf-account-value{font-size:22px;line-height:1.4;font-weight:600;color:#f0f0f0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
#novaflow-web-account-dialog .nf-account-caption{font-size:11px;color:#888;margin-top:5px}
#novaflow-web-account-dialog .nf-account-error{font-size:12px;color:#edac8e;line-height:1.6}
#novaflow-web-account-dialog .nf-account-actions{display:flex;gap:10px;margin-top:2px}
#novaflow-web-account-dialog .nf-account-actions button{flex:1;background:#333;color:#ddd;border:0;border-radius:8px;font:inherit;padding:10px;cursor:pointer}
#novaflow-web-account-dialog .nf-account-actions button:disabled{opacity:.5;cursor:wait}
#novaflow-web-account-dialog [hidden]{display:none!important}
`);
  styles.id = 'novaflow-web-account-style';
  root.document.head.appendChild(styles);

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
    dialogRequest++;
    const open = root.document.getElementById(DIALOG_ID);
    if (open) { if (open.open) open.close(); open.remove(); }
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }

  function show(backdrop, card) {
    backdrop.appendChild(card);
    root.document.body.appendChild(backdrop);
    backdrop.showModal(); // Native top layer also covers the app's fixed rails.
  }

  function displayNumber(value) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(Number(value));
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
    previousFocus = root.document.activeElement;
    const request = dialogRequest;
    const who = await currentUser();
    if (request !== dialogRequest) return;

    const backdrop = el('dialog');
    backdrop.id = DIALOG_ID;
    backdrop.setAttribute('aria-labelledby', 'novaflow-web-account-title');
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    const card = el('section'); card.className = 'nf-account-card';
    const head = el('header'); head.className = 'nf-account-header';
    const title = el('h2', '', who ? 'NovaFlow 账户' : '登录 NovaFlow');
    title.id = 'novaflow-web-account-title'; head.appendChild(title);
    const x = el('button', '', '×'); x.className = 'nf-account-close'; x.type = 'button'; x.setAttribute('aria-label', '关闭账户');
    x.addEventListener('click', close); head.appendChild(x); card.appendChild(head);
    const body = el('div'); body.className = 'nf-account-body'; card.appendChild(body);

    if (who) {
      const name = who.user && (who.user.display_name || who.user.email) || '已登录';
      const username = el('div', '', name); username.className = 'nf-account-user'; body.appendChild(username);
      const metrics = el('div'); metrics.className = 'nf-account-metrics'; body.appendChild(metrics);
      function metric(label, caption) {
        const box = el('div'); box.className = 'nf-account-metric';
        const labelNode = el('div', '', label); labelNode.className = 'nf-account-label'; box.appendChild(labelNode);
        const value = el('div', '', '—'); value.className = 'nf-account-value'; box.appendChild(value);
        const hint = el('div', '', caption); hint.className = 'nf-account-caption'; box.appendChild(hint);
        metrics.appendChild(box); return value;
      }
      const credits = metric('可用积分', '账户当前余额');
      credits.textContent = displayNumber(who.credits && who.credits.balance);
      const quota = metric('提示词服务', '剩余次数 / 总次数');
      const note = el('div', '', '正在读取账户信息…'); note.className = 'nf-account-error'; note.setAttribute('role', 'status'); body.appendChild(note);
      const actions = el('div'); actions.className = 'nf-account-actions'; body.appendChild(actions);
      const retry = el('button', '', '重新读取'); retry.type = 'button'; retry.hidden = true; actions.appendChild(retry);
      const out = el('button', '', '退出登录'); out.type = 'button'; actions.appendChild(out);
      out.addEventListener('click', async () => {
        out.disabled = true;
        try { await api().clientAuthLogout(); root.location.reload(); }
        catch (_) { out.disabled = false; note.hidden = false; note.textContent = '退出失败，请重试'; }
      });
      async function loadDetails() {
        retry.disabled = true; retry.hidden = true;
        note.hidden = false; note.textContent = '正在读取账户信息…';
        try {
          const reply = await api().clientAuthAccountDetails();
          if (!backdrop.isConnected) return;
          if (!reply || reply.ok === false) throw new Error((reply && reply.error) || '读取失败');
          const profile = reply.result || {};
          credits.textContent = displayNumber(profile.credits && (profile.credits.balance_text ?? profile.credits.balance));
          const promptQuota = profile.providerQuotas && profile.providerQuotas.grok;
          if (!promptQuota || promptQuota.status === 'error') throw new Error('提示词服务次数暂不可用');
          quota.textContent = displayNumber(promptQuota.remaining_count) + ' / ' + displayNumber(promptQuota.allocated_count);
          note.hidden = true;
        } catch (_) {
          if (!backdrop.isConnected) return;
          quota.textContent = '—'; note.hidden = false; note.textContent = '账户信息暂未完整读取，请重试'; retry.hidden = false;
        } finally { retry.disabled = false; }
      }
      retry.addEventListener('click', loadDetails);
      show(backdrop, card); void loadDetails();
      return;
    }

    body.appendChild(el('div', 'color:#a0a0a0;font-size:12px;line-height:1.7',
      '用你的 NovaFlow 账号登录。生成、读取积分、取回结果都需要登录后才能进行。'));

    const account = el('input', FIELD);
    account.placeholder = '账号';
    account.autocomplete = 'username';
    const password = el('input', FIELD);
    password.placeholder = '密码';
    password.type = 'password';
    password.autocomplete = 'current-password';
    body.appendChild(account);
    body.appendChild(password);

    const submit = el('button', [
      'height:36px', 'border:0', 'border-radius:8px', 'background:#1ea672',
      'color:#fff', 'font:inherit', 'font-size:13px', 'font-weight:600', 'cursor:pointer'
    ].join(';'), '登录');
    body.appendChild(submit);

    const note = el('div', 'font-size:12px;line-height:1.6;min-height:18px;color:#a0a0a0');
    body.appendChild(note);

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

    show(backdrop, card);
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

    if (root.NOVAFLOW_WEB_CONFIG?.localAssistant) {
      const local = el('button', 'margin-top:12px;width:100%;padding:10px;border:1px solid #444;border-radius:8px;background:#222;color:#eee', '返回本机使用');
      local.type = 'button';
      local.addEventListener('click', async () => {
        try { await root.NovaFlowWebRuntime.setComputeMode('local'); removeGate(); }
        catch (e) { local.textContent = e.message; }
      });
      card.appendChild(local);
    }
    gate.appendChild(card);
    setTimeout(() => { try { account.focus(); } catch (_) {} }, 80);
    return gate;
  }

  async function guard() {
    if (root.NovaFlowWebRuntime?.computeMode === 'local') { removeGate(); return; }
    if (await currentUser() || root.NovaFlowWebRuntime?.computeMode === 'local') {
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
