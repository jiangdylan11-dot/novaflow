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
#novaflow-web-account-dialog .nf-account-tier{margin:-6px 0 12px;font-size:12px;line-height:1.6;color:#a0a0a0}
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

  function tierText(plan) {
    if (!plan) return '账户类型读取中…';
    const key = String(plan).trim().toLowerCase();
    if (key === 'pro' || key === 'team') return '高级账户 · 可使用所有算力节点（普通和高级），也可使用本机算力';
    if (key === 'standard') return '中级账户 · 可使用普通算力节点，也可使用本机算力；高级算力节点需要高级账户';
    return '普通账户 · 只能使用本机算力（在本地助手点击“启动NovaFlow”）';
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
      // The tier decides where work may run: a 普通账户 only on the machine the
      // local assistant opened, a 高级账户 also on other people's nodes.
      const tier = el('div', '', tierText(who.user && who.user.plan)); tier.className = 'nf-account-tier'; body.appendChild(tier);
      const metrics = el('div'); metrics.className = 'nf-account-metrics'; body.appendChild(metrics);
      function metric(label, caption) {
        const box = el('div'); box.className = 'nf-account-metric';
        const labelNode = el('div', '', label); labelNode.className = 'nf-account-label'; box.appendChild(labelNode);
        const value = el('div', '', '—'); value.className = 'nf-account-value'; box.appendChild(value);
        const hint = el('div', '', caption); hint.className = 'nf-account-caption'; box.appendChild(hint);
        metrics.appendChild(box); return value;
      }
      const credits = metric('剩余积分', '账户当前余额');
      credits.textContent = displayNumber(who.credits && who.credits.balance);
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
          if (profile.user && profile.user.plan) tier.textContent = tierText(profile.user.plan);
          credits.textContent = displayNumber(profile.credits && (profile.credits.balance_text ?? profile.credits.balance));
          if (profile.featureCreditPrices && globalThis.NovaFlowFeatureCreditPrices && typeof globalThis.NovaFlowFeatureCreditPrices.applyConfig === 'function') {
            globalThis.NovaFlowFeatureCreditPrices.applyConfig(profile.featureCreditPrices);
          }
          note.hidden = true;
        } catch (_) {
          if (!backdrop.isConnected) return;
          note.hidden = false; note.textContent = '账户信息暂未完整读取，请重试'; retry.hidden = false;
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
        // The account service and the compute control plane are separate
        // services with separate trust. clientAuthStatus re-presents the new
        // token to the control plane and DROPS the session if it is refused,
        // so without this check a refused token reloads straight back to an
        // empty form with nothing said. Ask here instead, and say why.
        const status = await api().clientAuthStatus();
        if (!(status && status.ok !== false && status.result && status.result.authenticated)) {
          throw new Error('账号已通过验证，但算力控制面不接受这个会话。请确认控制面与账号服务使用同一套会话密钥。');
        }
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
    if (!who) void guard();
    const label = who
      ? (who.user && (who.user.display_name || who.user.email) || '已登录')
      : '登录';
    if (btn.textContent !== label) btn.textContent = label;
    // Signed in this is a quiet chip, exactly as the reference draws it;
    // signed out it is the one action on the screen, so it keeps the green.
    const colour = who ? '#e5e7eb' : '#ffffff';
    const background = who ? '#171717' : '#1ea672';
    const border = who ? '1px solid #333333' : '0';
    btn.style.setProperty('color', colour, 'important');
    btn.style.setProperty('background', background, 'important');
    btn.style.setProperty('background-color', background, 'important');
    btn.style.setProperty('border', border, 'important');
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
      height: '28px', 'min-height': '28px', 'max-height': '28px',
      padding: '0 13px', border: '0', 'border-radius': '7px',
      background: '#1ea672', 'background-image': 'none',
      color: '#ffffff', 'font-size': '12px', 'font-weight': '500',
      'line-height': '1', 'box-shadow': 'none', 'white-space': 'nowrap',
      cursor: 'pointer', '-webkit-app-region': 'no-drag'
    };
    for (const [k, v] of Object.entries(styles)) btn.style.setProperty(k, v, 'important');
    btn.addEventListener('click', open);
    // Until the first status answer the chip can only say 登录, in green, and
    // a moment later it became the account name: a flash on every start. The
    // status box stays hidden until the chip knows (or for 1.5s at most).
    host.setAttribute('data-novaflow-account-pending', '1');
    const reveal = () => host.removeAttribute('data-novaflow-account-pending');
    const revealTimer = setTimeout(reveal, 1500);
    host.appendChild(btn);

    refresh(btn).then(reveal, reveal).then(() => clearTimeout(revealTimer));
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
      // background-COLOR, not the `background` shorthand: this rule is injected
      // after the theme stylesheet and carries !important, so a shorthand here
      // would reset the theme's background-image and wipe the backdrop.
      const style = el('style', '', '#' + GATE_ID + '{background-color:#0b0b0c!important;z-index:2147483640!important}');
      style.id = GATE_ID + '-style';
      root.document.head.appendChild(style);
    }
    // Two columns at a desktop width: what the product is on the left, the
    // sign-in form on the right. The inline rules here are the ones that must
    // hold even if the stylesheet has not arrived - it covers the running app,
    // so it may not be transparent or scrollable-behind for a frame.
    const gate = el('div', [
      'position:fixed', 'inset:0', 'z-index:2147483640',
      // Colour only, for the same reason as the rule above: the shorthand
      // would take the theme's backdrop layers with it.
      'background-color:#0b0b0c', 'display:flex', 'align-items:center',
      'justify-content:center', 'overflow:hidden',
      'font:13px "Segoe UI","Microsoft YaHei",sans-serif'
    ].join(';'));
    gate.id = GATE_ID;
    // Keep the signed-out layout independent of the editor's radius scanner.
    gate.setAttribute('data-novaflow-keep-radius', '1');

    const artwork = el('img'); artwork.className = 'nf-login-art';
    artwork.src = './assets/login-game-art.png';
    artwork.alt = '';
    artwork.draggable = false;
    artwork.setAttribute('aria-hidden', 'true');
    artwork.decoding = 'async';
    gate.appendChild(artwork);

    const shell = el('div'); shell.className = 'nf-login-shell';

    const brand = el('div'); brand.className = 'nf-login-brand';
    const logo = el('img'); logo.className = 'nf-login-logo';
    logo.src = './assets/logo.png';
    logo.alt = 'NovaFlow';
    logo.draggable = false;
    brand.appendChild(logo);

    const headline = el('h1', '', '让游戏灵感，成为作品。');
    headline.className = 'nf-login-headline';
    brand.appendChild(headline);

    const lede = el('p'); lede.className = 'nf-login-lede';
    lede.appendChild(root.document.createTextNode('NovaFlow 游戏美术创作工作台'));
    brand.appendChild(lede);

    // Descriptive labels for what is inside. They are deliberately not
    // controls: the only way in from this screen is the form on the right.
    const tags = el('div'); tags.className = 'nf-login-tags';
    for (const label of ['AI 绘图', 'UI 设计', '智能拆图', '动画与特效']) {
      const tag = el('div'); tag.className = 'nf-login-tag';
      tag.appendChild(el('span', '', label));
      tags.appendChild(tag);
    }
    brand.appendChild(tags);

    shell.appendChild(brand);

    const card = el('div'); card.className = 'nf-login-card';
    const cardTitle = el('h2', '', '欢迎回来'); cardTitle.className = 'nf-login-card-title';
    card.appendChild(cardTitle);
    const cardNote = el('p', '', '登录你的创作工作空间');
    cardNote.className = 'nf-login-card-note';
    card.appendChild(cardNote);

    const accountLabel = el('label', '', '账号');
    accountLabel.className = 'nf-login-field';
    accountLabel.htmlFor = 'novaflow-web-login-account';
    const account = el('input');
    account.className = 'nf-login-input';
    account.id = 'novaflow-web-login-account';
    account.placeholder = '账号';
    account.autocomplete = 'username';

    const passwordLabel = el('label', '', '密码');
    passwordLabel.className = 'nf-login-field';
    passwordLabel.htmlFor = 'novaflow-web-login-password';
    const password = el('input');
    password.className = 'nf-login-input';
    password.id = 'novaflow-web-login-password';
    password.placeholder = '密码';
    password.type = 'password';
    password.autocomplete = 'current-password';

    // The icon is drawn on the wrapper, not on the input: Chrome paints an
    // autofilled field with its own background, which would cover a
    // background-image set on the input itself.
    const wrap = (kind, field) => {
      const node = el('div');
      node.className = 'nf-login-input-wrap nf-login-input-wrap-' + kind;
      node.appendChild(field);
      return node;
    };

    card.appendChild(accountLabel);
    card.appendChild(wrap('user', account));
    const gap = el('div'); gap.className = 'nf-login-gap'; card.appendChild(gap);
    card.appendChild(passwordLabel);
    const passwordWrap = wrap('lock', password);
    const reveal = el('button'); reveal.className = 'nf-login-reveal';
    reveal.type = 'button';
    reveal.setAttribute('aria-label', '显示密码');
    reveal.setAttribute('aria-pressed', 'false');
    reveal.setAttribute('aria-controls', password.id);
    reveal.addEventListener('click', () => {
      const visible = password.type === 'password';
      password.type = visible ? 'text' : 'password';
      reveal.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
      reveal.setAttribute('aria-pressed', String(visible));
    });
    passwordWrap.appendChild(reveal);
    card.appendChild(passwordWrap);

    const submit = el('button', '', '进入工作台');
    submit.className = 'nf-login-submit';
    submit.type = 'button';
    card.appendChild(submit);
    const help = el('p', '', '账号由管理员开通'); help.className = 'nf-login-help';
    card.appendChild(help);

    const note = el('div');
    note.className = 'nf-login-note';
    note.style.color = '#a0a0a0';
    note.setAttribute('role', 'status');
    card.appendChild(note);
    // Why the last session ended, when the server said: 账号已在其他设备登录 / 账号已到期.
    try {
      const reason = root.sessionStorage.getItem('novaflow.web.signout-reason');
      if (reason) {
        root.sessionStorage.removeItem('novaflow.web.signout-reason');
        note.style.color = '#fca5a5';
        note.textContent = reason;
      }
    } catch (_) {}

    shell.appendChild(card);

    async function login() {
      if (submit.disabled) return;
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
        submit.textContent = '进入工作台';
      }
    }
    submit.addEventListener('click', login);
    password.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    account.addEventListener('keydown', (e) => { if (e.key === 'Enter') password.focus(); });

    gate.appendChild(shell);
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
