// Account in the top header, immediately after the version badge.
//
// Signed in, the brand row shows the username, the remaining balance
// ("44,128 积分") and a compact 退出. Signed out, that same spot is a 登录
// button that opens the existing full-screen gate. The old account dialog is gone.
//
// The balance is the account service's own read (clientAuthAccountDetails,
// the same call the modal used). It runs on mount, on the existing 15s poll,
// and again when a charge or refund lands (task settlement, feature quota,
// or the provider-usage message the desktop account card already listens for).

(function (root) {
  'use strict';

  const STRIP_ID = 'novaflow-web-account-header';
  const GATE_ID = 'novaflow-web-login-gate';

  const api = () => root.electronAPI || {};
  let refreshStarted = false;
  let refreshing = null;
  let refreshAgain = false;
  let liveBound = false;
  let lastAccount = null;
  let balanceTimer = 0;
  let seatTimer = 0;
  let pollBound = false;

  const styles = el('style', '', `
#novaflow-web-account-header{display:inline-flex!important;align-items:center;gap:8px;height:28px;margin-left:10px;color:#d7dbe2;font:400 12px/1 "Segoe UI","Microsoft YaHei",sans-serif;white-space:nowrap;-webkit-app-region:no-drag}
#novaflow-web-account-header[data-novaflow-account-pending="1"]{visibility:hidden!important}
#novaflow-web-account-header [data-novaflow-account-name]{display:block;max-width:140px;overflow:hidden;text-overflow:ellipsis;color:#e8eaed;font-weight:500}
#novaflow-web-account-header [data-novaflow-account-credits]{display:block;color:rgba(230,239,255,.74);font-variant-numeric:tabular-nums}
#novaflow-web-account-header button{height:24px;min-height:24px;padding:0 8px;border:1px solid #333;border-radius:6px;background:#24262a;color:#e8eaed;font:inherit;font-size:12px;font-weight:400;line-height:1;cursor:pointer;-webkit-app-region:no-drag}
#novaflow-web-account-header [data-novaflow-account-login]{border:0;background:#1ea672;color:#fff;font-weight:500}
#novaflow-web-account-header [hidden]{display:none!important}
html body [data-novaflow-client-auth-panel="1"]{display:none!important}
`);
  styles.id = 'novaflow-web-account-style';
  if (root.document && root.document.head) root.document.head.appendChild(styles);

  function el(tag, style, text) {
    const node = root.document.createElement(tag);
    if (style) node.setAttribute('style', style);
    if (text != null) node.textContent = text;
    return node;
  }

  function numeric(value) {
    if (value == null || value === '') return null;
    const text = typeof value === 'number' ? String(value) : String(value).replace(/,/g, '').trim();
    if (!text || !Number.isFinite(Number(text))) return null;
    return Number(text);
  }

  function displayNumber(value) {
    const amount = numeric(value);
    if (amount == null) return '—';
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(amount);
  }

  function creditText(value) {
    const raw = value && typeof value === 'object' ? (value.balance_text ?? value.balance) : value;
    const text = displayNumber(raw);
    return text === '—' ? '—' : text + ' 积分';
  }

  function stripNode() {
    return root.document.getElementById(STRIP_ID);
  }

  function part(strip, name) {
    return strip && typeof strip.querySelector === 'function'
      ? strip.querySelector('[data-novaflow-account-' + name + ']')
      : null;
  }

  function removeLegacyAccountModal() {
    const doc = root.document;
    if (!doc || typeof doc.getElementById !== 'function') return;
    const button = doc.getElementById('novaflow-web-account-button');
    if (button && typeof button.remove === 'function') button.remove();
    const dialog = doc.getElementById('novaflow-web-account-dialog');
    if (!dialog) return;
    try { if (dialog.open && typeof dialog.close === 'function') dialog.close(); } catch (_) {}
    if (typeof dialog.remove === 'function') dialog.remove();
  }

  function insertAfter(anchor, node) {
    if (!anchor || !node || anchor.nextElementSibling === node) return;
    const parent = anchor.parentNode;
    if (typeof anchor.after === 'function') {
      anchor.after(node);
      if (node.parentNode === parent && anchor.nextElementSibling === node) return;
    }
    if (parent && typeof parent.insertBefore === 'function' && anchor.nextSibling) parent.insertBefore(node, anchor.nextSibling);
    else if (parent && typeof parent.appendChild === 'function') parent.appendChild(node);
  }

  function ensureStrip() {
    const existing = stripNode();
    if (existing) return existing;
    const strip = el('div');
    strip.id = STRIP_ID;
    strip.setAttribute('data-novaflow-account-header', '1');
    strip.setAttribute('data-novaflow-account-pending', '1');
    const name = el('div');
    name.setAttribute('data-novaflow-account-name', '1');
    name.hidden = true;
    const credits = el('div');
    credits.setAttribute('data-novaflow-account-credits', '1');
    credits.title = '剩余积分';
    credits.hidden = true;
    const logout = el('button', '', '退出');
    logout.type = 'button';
    logout.setAttribute('data-novaflow-account-logout', '1');
    logout.setAttribute('aria-label', '退出登录');
    logout.hidden = true;
    logout.addEventListener('click', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      void logoutAccount(logout);
    });
    const login = el('button', '', '登录');
    login.type = 'button';
    login.setAttribute('data-novaflow-account-login', '1');
    login.setAttribute('aria-label', '登录');
    login.hidden = true;
    login.addEventListener('click', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      void guard();
    });
    strip.appendChild(name);
    strip.appendChild(credits);
    strip.appendChild(logout);
    strip.appendChild(login);
    return strip;
  }

  function paintBalance(balance) {
    const credits = part(stripNode(), 'credits');
    if (!credits || credits.hidden) return;
    const text = creditText(balance);
    if (credits.textContent !== text) credits.textContent = text;
  }

  function paint(account) {
    const strip = stripNode();
    if (!strip) return;
    const name = part(strip, 'name');
    const credits = part(strip, 'credits');
    const logout = part(strip, 'logout');
    const login = part(strip, 'login');
    if (!account || !account.authenticated) {
      if (name) name.hidden = true;
      if (credits) credits.hidden = true;
      if (logout) logout.hidden = true;
      if (login) login.hidden = false;
      strip.removeAttribute('data-novaflow-account-signed-in');
      return;
    }
    if (name) {
      name.hidden = false;
      const text = account.name || '已登录';
      if (name.textContent !== text) name.textContent = text;
      if (name.title !== text) name.title = text;
    }
    if (credits) {
      credits.hidden = false;
      const text = creditText(account.credits);
      if (credits.textContent !== text) credits.textContent = text;
    }
    if (logout) logout.hidden = false;
    if (login) login.hidden = true;
    strip.setAttribute('data-novaflow-account-signed-in', '1');
  }

  function reveal() {
    const strip = stripNode();
    if (strip) strip.removeAttribute('data-novaflow-account-pending');
  }

  async function currentUser() {
    try {
      const res = await api().clientAuthStatus();
      const result = res && res.result;
      return result && result.authenticated ? result : null;
    } catch (_) {
      return null;
    }
  }

  async function readAccount() {
    const who = await currentUser();
    if (!who) return { authenticated: false };
    let name = who.user && (who.user.display_name || who.user.email) || '已登录';
    let credits = who.credits || null;
    try {
      const reply = await api().clientAuthAccountDetails();
      if (reply && reply.ok !== false && reply.result) {
        const profile = reply.result;
        if (profile.user) name = profile.user.display_name || profile.user.email || name;
        if (profile.credits) credits = profile.credits;
        const prices = root.NovaFlowFeatureCreditPrices;
        if (profile.featureCreditPrices && prices && typeof prices.applyConfig === 'function') {
          prices.applyConfig(profile.featureCreditPrices);
        }
      }
    } catch (_) {}
    return { authenticated: true, name: name, credits: credits };
  }

  async function refresh() {
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = (async () => {
      try {
        do {
          refreshAgain = false;
          const account = await readAccount();
          lastAccount = account;
          paint(account);
          if (!account.authenticated) void guard();
        } while (refreshAgain);
      } finally {
        reveal();
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function stopBalancePoll() {
    if (!balanceTimer) return;
    if (typeof root.clearInterval === 'function') root.clearInterval(balanceTimer);
    balanceTimer = 0;
  }

  function documentHidden() {
    return Boolean(root.document && root.document.hidden);
  }

  function startBalancePoll() {
    stopBalancePoll();
    if (!refreshStarted || documentHidden() || typeof root.setInterval !== 'function') return;
    balanceTimer = root.setInterval(() => { void refresh(); }, 15000) || 0;
  }

  function onVisibilityChange() {
    if (!refreshStarted) return;
    if (documentHidden()) {
      stopBalancePoll();
      return;
    }
    startBalancePoll();
    void refresh();
  }

  function teardown() {
    refreshStarted = false;
    stopBalancePoll();
    if (seatTimer && typeof root.clearInterval === 'function') root.clearInterval(seatTimer);
    seatTimer = 0;
  }

  function bindPollLifecycle() {
    if (pollBound) return;
    pollBound = true;
    const doc = root.document;
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibilityChange);
    if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', teardown);
  }

  function startRefresh() {
    if (refreshStarted) return;
    refreshStarted = true;
    bindPollLifecycle();
    startBalancePoll();
    void refresh();
  }

  async function logoutAccount(button) {
    if (button) button.disabled = true;
    try {
      await api().clientAuthLogout();
      if (root.location && typeof root.location.reload === 'function') root.location.reload();
    } catch (_) {
      if (button) button.disabled = false;
    }
  }

  function bindLiveRefresh() {
    if (liveBound || typeof root.addEventListener !== 'function') return;
    liveBound = true;
    root.addEventListener('novaflow:account-balance', (event) => {
      const balance = event && event.detail ? event.detail.balance : null;
      if (balance != null && balance !== '') paintBalance(balance);
      void refresh();
    });
    // Art generation already records a settlement on this event. Re-read the
    // account balance with the same call the header uses, rather than guessing.
    root.addEventListener('novaflow:art-generate-credit-updated', (event) => {
      if (!event || !event.detail || event.detail.kind !== 'settlement') return;
      void refresh();
    });
    root.addEventListener('message', (event) => {
      if (!event || event.source !== root) return;
      if (!event.data || event.data.type !== 'novaflow-provider-usage-settled') return;
      const credits = event.data.payload && event.data.payload.credits;
      const balance = credits && (credits.balance_text ?? credits.balance);
      if (balance != null && balance !== '') paintBalance(balance);
      void refresh();
    });
  }

  // brand is the .nf-brand node when a layout pass calls this. Otherwise the
  // current brand is found. The strip is the version badge's next sibling.
  function seat(brand) {
    try {
      removeLegacyAccountModal();
      const host = brand && typeof brand.querySelector === 'function'
        ? brand
        : (root.document && typeof root.document.querySelector === 'function'
          ? root.document.querySelector('.nf-brand')
          : null);
      if (!host || typeof host.appendChild !== 'function') return false;
      const strip = ensureStrip();
      const version = typeof host.querySelector === 'function' ? host.querySelector('.nf-brand-version') : null;
      if (version) insertAfter(version, strip);
      else if (strip.parentNode !== host) host.appendChild(strip);
      // A module switch rebuilds the brand and drops the strip. Paint the last
      // read now; the balance poll and charge events keep that read current.
      if (lastAccount) {
        paint(lastAccount);
        reveal();
      }
      startRefresh();
      return true;
    } catch (_) {
      return false;
    }
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

  function removeGate() {
    const gate = root.document.getElementById(GATE_ID);
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
  }

  // Static, local icons: the login page must render before any remote service
  // is available. These labels describe capabilities; they are not navigation.
  function loginIcon(name) {
    const paths = {
      user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
      lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
      bone: '<path d="M17 10c1.7 0 3-1.3 3-3a3 3 0 0 0-3-3c0-1.7-1.3-3-3-3s-3 1.3-3 3c0 .5.1 1 .3 1.4l-5.9 5.9A3 3 0 0 0 4 11c-1.7 0-3 1.3-3 3s1.3 3 3 3c0 1.7 1.3 3 3 3s3-1.3 3-3c0-.5-.1-1-.3-1.4l5.9-5.9c.4.2.9.3 1.4.3Z"/>',
      video: '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 11h18M8 6l3 5m4-5 3 5m-8 3 5 3-5 3z"/>',
      audio: '<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',
      ui: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
      brush: '<path d="m14 6 4-4 4 4-10 10-4-4 6-6Zm-6 6c-6 0-1 7-6 9 7 1 10-2 10-5"/>',
      box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5m-9 5v9"/>',
      shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6"/>'
    };
    const icon = el('span');
    icon.className = 'nf-login-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';
    return icon;
  }

  function buildGate() {
    // The shared modal scanner may clear inline backdrop styles. Keep the
    // login screen opaque and above the editor while it is signed out.
    if (!root.document.getElementById(GATE_ID + '-style')) {
      // background-COLOR, not the `background` shorthand: this rule is injected
      // after the theme stylesheet and carries !important, so a shorthand here
      // would reset the theme's background-image and wipe the backdrop.
      const style = el('style', '', '#' + GATE_ID + '{background-color:#090c0d!important;z-index:2147483640!important}');
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
      'background-color:#090c0d', 'display:flex', 'align-items:center',
      'justify-content:center', 'overflow:hidden',
      'font:13px "Segoe UI","Microsoft YaHei",sans-serif'
    ].join(';'));
    gate.id = GATE_ID;
    gate.setAttribute('aria-label', 'Foart 登录');
    // Keep the signed-out layout independent of the editor's radius scanner.
    gate.setAttribute('data-novaflow-keep-radius', '1');

    const atmosphere = el('div'); atmosphere.className = 'nf-login-atmosphere';
    atmosphere.setAttribute('aria-hidden', 'true');
    for (const tone of ['green', 'red', 'low']) {
      const ribbon = el('div'); ribbon.className = 'nf-login-ribbon nf-login-ribbon-' + tone;
      if (tone !== 'low') {
        const [width, height] = tone === 'green' ? [920, 570] : [1240, 650];
        const flow = el('span'); flow.className = 'nf-login-flow';
        flow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" fill="none"><ellipse cx="' + width / 2 + '" cy="' + height / 2 + '" rx="' + (width / 2 - 1) + '" ry="' + (height / 2 - 1) + '" pathLength="100" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="4 21"/></svg>';
        ribbon.appendChild(flow);
      }
      atmosphere.appendChild(ribbon);
    }
    gate.appendChild(atmosphere);

    const shell = el('div'); shell.className = 'nf-login-shell';
    const header = el('header'); header.className = 'nf-login-header';
    const identity = el('div'); identity.className = 'nf-login-identity';
    const logo = el('img'); logo.className = 'nf-login-logo';
    logo.src = './assets/foart-logo-dark.svg?brand=geo-v3';
    logo.alt = 'Foart';
    logo.draggable = false;
    identity.appendChild(logo);
    const brandNote = el('span', '', 'GAME × ART × AI'); brandNote.className = 'nf-login-brand-note';
    identity.appendChild(brandNote);
    header.appendChild(identity);

    // Native disclosure keeps help usable by keyboard, without adding a
    // second modal or shipping placeholder contact/policy links.
    const support = el('details'); support.className = 'nf-login-support';
    support.appendChild(el('summary', '', '登录帮助'));
    const supportCopy = el('div'); supportCopy.className = 'nf-login-support-copy';
    supportCopy.appendChild(el('p', '', '账号由管理员开通。'));
    supportCopy.appendChild(el('p', '', '忘记密码、账号到期或无法登录，请联系为你开通账号的管理员。'));
    support.appendChild(supportCopy);
    header.appendChild(support);
    shell.appendChild(header);

    const main = el('main'); main.className = 'nf-login-main';
    const brand = el('section'); brand.className = 'nf-login-brand';
    brand.setAttribute('aria-label', 'Foart 游戏美术创作工作台');
    const eyebrow = el('div', '', 'A LITTLE IDEA. A NEW POSSIBILITY.');
    eyebrow.className = 'nf-login-eyebrow'; brand.appendChild(eyebrow);
    const headline = el('h1');
    headline.className = 'nf-login-headline';
    headline.appendChild(root.document.createTextNode('让创意'));
    headline.appendChild(el('br'));
    headline.appendChild(el('em', '', '更快'));
    headline.appendChild(root.document.createTextNode('变成作品。'));
    brand.appendChild(headline);

    const lede = el('p'); lede.className = 'nf-login-lede';
    lede.appendChild(root.document.createTextNode('游戏美术与动画的 AI 创作平台'));
    brand.appendChild(lede);

    // Descriptive labels for what is inside. They are deliberately not
    // controls: the only way in from this screen is the form on the right.
    const tags = el('div'); tags.className = 'nf-login-tags';
    tags.setAttribute('aria-label', '平台能力说明');
    for (const [icon, label] of [['bone', '骨骼动画'], ['video', 'AI 视频'], ['audio', 'AI 音频'], ['ui', 'UI 设计'], ['brush', '绘画编辑'], ['box', '常用工具']]) {
      const tag = el('div'); tag.className = 'nf-login-tag';
      tag.appendChild(loginIcon(icon));
      tag.appendChild(el('span', '', label));
      tags.appendChild(tag);
    }
    brand.appendChild(tags);

    main.appendChild(brand);

    const card = el('section'); card.className = 'nf-login-card';
    card.setAttribute('aria-label', '登录账号');
    const kicker = el('div', '', 'YOUR CREATIVE SPACE'); kicker.className = 'nf-login-card-kicker';
    card.appendChild(kicker);
    const cardTitle = el('h2', '', '欢迎回来'); cardTitle.className = 'nf-login-card-title';
    card.appendChild(cardTitle);
    const cardNote = el('p', '', '登录，继续你的创作。');
    cardNote.className = 'nf-login-card-note';
    card.appendChild(cardNote);

    const accountLabel = el('label', '', '账号');
    accountLabel.className = 'nf-login-field';
    accountLabel.htmlFor = 'novaflow-web-login-account';
    const account = el('input');
    account.className = 'nf-login-input';
    account.id = 'novaflow-web-login-account';
    account.placeholder = '请输入账号';
    account.autocomplete = 'username';
    account.name = 'username';
    account.spellcheck = false;
    account.setAttribute('autocapitalize', 'none');
    account.setAttribute('aria-required', 'true');

    const passwordLabel = el('label', '', '密码');
    passwordLabel.className = 'nf-login-field';
    passwordLabel.htmlFor = 'novaflow-web-login-password';
    const password = el('input');
    password.className = 'nf-login-input';
    password.id = 'novaflow-web-login-password';
    password.placeholder = '请输入密码';
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.name = 'password';
    password.setAttribute('aria-required', 'true');

    // The icon is drawn on the wrapper, not on the input: Chrome paints an
    // autofilled field with its own background, which would cover a
    // background-image set on the input itself.
    const wrap = (kind, field) => {
      const node = el('div');
      node.className = 'nf-login-input-wrap nf-login-input-wrap-' + kind;
      node.appendChild(loginIcon(kind));
      node.appendChild(field);
      return node;
    };

    card.appendChild(accountLabel);
    card.appendChild(wrap('user', account));
    const gap = el('div'); gap.className = 'nf-login-gap'; card.appendChild(gap);
    card.appendChild(passwordLabel);
    const passwordWrap = wrap('lock', password);
    const revealPassword = el('button'); revealPassword.className = 'nf-login-reveal';
    revealPassword.type = 'button';
    revealPassword.setAttribute('aria-label', '显示密码');
    revealPassword.setAttribute('aria-pressed', 'false');
    revealPassword.setAttribute('aria-controls', password.id);
    revealPassword.setAttribute('data-foart-button-theme', 'off');
    revealPassword.addEventListener('click', () => {
      const visible = password.type === 'password';
      password.type = visible ? 'text' : 'password';
      revealPassword.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
      revealPassword.setAttribute('aria-pressed', String(visible));
    });
    passwordWrap.appendChild(revealPassword);
    card.appendChild(passwordWrap);

    const submit = el('button', '', '进入工作台');
    submit.className = 'nf-login-submit';
    submit.type = 'button';
    submit.setAttribute('data-foart-button-theme', 'off');
    card.appendChild(submit);

    const note = el('div');
    note.className = 'nf-login-note';
    note.style.color = '#a0a0a0';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
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

    const help = el('p'); help.className = 'nf-login-help';
    help.appendChild(loginIcon('shield'));
    help.appendChild(root.document.createTextNode('账号由管理员开通'));
    card.appendChild(help);
    main.appendChild(card);
    shell.appendChild(main);
    const footer = el('footer'); footer.className = 'nf-login-footer';
    const copyright = el('div'); copyright.className = 'nf-login-copyright';
    const footerBrand = el('span', '', 'Foart'); footerBrand.className = 'nf-login-footer-brand';
    copyright.appendChild(footerBrand);
    copyright.appendChild(el('span', '', '© ' + new Date().getFullYear() + ' Foart'));
    footer.appendChild(copyright);
    footer.appendChild(el('span', '', '为创作，留一点想象。'));
    shell.appendChild(footer);

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

  bindLiveRefresh();

  let attempts = 0;
  if (typeof root.setInterval === 'function') {
    seatTimer = root.setInterval(() => {
      attempts += 1;
      if (seat() || attempts > 120) {
        if (typeof root.clearInterval === 'function') root.clearInterval(seatTimer);
        seatTimer = 0;
      }
    }, 500) || 0;
  }

  guard();

  root.NovaFlowWebAccount = { seat: seat, refresh: refresh, logout: logoutAccount, teardown: teardown, mount: seat, guard: guard, removeGate: removeGate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
