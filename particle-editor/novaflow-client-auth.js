(function () {
  "use strict";

  const STORAGE_KEY = "novaflow.client.auth.session.v1";
  const HOST_ATTR = "data-novaflow-client-auth-panel";
  const STYLE_ID = "novaflow-client-auth-style";
  const SESSION_REFRESH_EARLY_MS = 2 * 60 * 1000;
  const SESSION_REFRESH_RETRY_MS = 30 * 1000;
  const PROVIDERS = [
    { key: "grok", label: "提示词服务" }
  ];

  const state = {
    account: "",
    password: "",
    loading: false,
    message: "",
    messageKind: "muted",
    bridgeReady: false,
    backendBaseUrl: "",
    backendStatus: "checking",
    session: null,
    user: null,
    credits: null,
    providerQuotas: {}
  };

  let host = null;
  const mountedHosts = new Map();
  let observer = null;
  let refreshTimer = 0;
  let sessionRefreshTimer = 0;
  let globalActionClickBound = false;
  let focusRefreshBound = false;
  let providerSettlementRefreshBound = false;
  let lastFocusRefreshAt = 0;
  let activeAuthorizationContextCount = 0;
  let mountedNotificationScheduled = false;
  let sessionRevision = 0;
  let bootstrapRequestRevision = 0;
  let lastDirectAction = { action: "", at: 0 };
  const MOUNTED_EVENT = "novaflow-client-auth-mounted";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatNumber(value) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? Math.round(num).toLocaleString() : "0";
  }

  function formatCreditAmount(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return "0";
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6
    }).format(num);
  }

  function isLocalBackendBaseUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.toLowerCase();
      return host === "127.0.0.1" || host === "localhost" || host === "::1";
    } catch {
      return false;
    }
  }

  function accountNameFromEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    const suffix = "@accounts.novaflow.local";
    if (!email.endsWith(suffix)) return email;
    const local = email.slice(0, -suffix.length);
    const prefix = "acct_";
    if (!local.startsWith(prefix)) return local;
    try {
      const base64 = local.slice(prefix.length).replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const account = new TextDecoder().decode(bytes) || "";
      return /^[a-z0-9._-]{2,64}$/.test(account) ? account : email;
    } catch {
      return email;
    }
  }

  function userAccountLabel(user) {
    return String(user?.account || accountNameFromEmail(user?.email) || user?.email || "");
  }

  function normalizeProviderQuotas(value) {
    const source = value && typeof value === "object" ? value : {};
    const normalized = {};
    PROVIDERS.forEach((provider) => {
      const record = source[provider.key];
      normalized[provider.key] = record && typeof record === "object"
        ? record
        : {
            status: "empty",
            allocated_count: 0,
            used_count: 0,
            remaining_count: 0
          };
    });
    return normalized;
  }

  function backendServiceLabel() {
    if (!state.backendBaseUrl) return "账号验证";
    return isLocalBackendBaseUrl(state.backendBaseUrl) ? "本机测试验证" : "Supabase Auth";
  }

  function getBridge() {
    const api = window.electronAPI;
    if (!api || typeof api !== "object") return null;
    if (typeof api.clientAuthLogin !== "function") return null;
    if (typeof api.clientAuthBootstrap !== "function") return null;
    return api;
  }

  function applyProfileSnapshot(result) {
    if (!result || result.ok === false) return false;
    if (result.baseUrl) state.backendBaseUrl = String(result.baseUrl);
    state.backendStatus = "ready";
    if (result.session && typeof result.session.token === "string" && result.session.token) {
      state.session = {
        ...(state.session || {}),
        ...result.session
      };
    }
    if (result.user) {
      state.user = result.user;
      state.account = userAccountLabel(state.user) || state.account;
    }
    if (result.credits && typeof result.credits === "object") {
      applyCreditsSnapshot(result.credits);
    }
    state.providerQuotas = normalizeProviderQuotas(result.providerQuotas);
    saveStoredSession();
    scheduleSessionRefresh();
    return true;
  }

  function applyCreditsSnapshot(credits) {
    if (!credits || typeof credits !== "object") return false;
    const nextCredits = {
      ...(state.credits || {}),
      ...credits
    };
    if (Object.prototype.hasOwnProperty.call(credits, "balance") &&
        !Object.prototype.hasOwnProperty.call(credits, "balance_text")) {
      delete nextCredits.balance_text;
    }
    state.credits = nextCredits;
    return true;
  }

  function applyProviderQuotaSnapshot(providerKey, quota) {
    const key = String(providerKey || quota?.provider_key || quota?.providerKey || "").trim().toLowerCase();
    if (!key || !quota || typeof quota !== "object") return false;
    state.providerQuotas = normalizeProviderQuotas({
      ...(state.providerQuotas || {}),
      [key]: quota
    });
    saveStoredSession();
    render();
    return true;
  }

  function loadStoredSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;
      if (saved.session && typeof saved.session.token === "string") state.session = saved.session;
      if (saved.user && typeof saved.user === "object") {
        state.user = saved.user;
        state.account = String(saved.user.account || accountNameFromEmail(saved.user.email) || state.account || "");
      }
      if (saved.credits && typeof saved.credits === "object") state.credits = saved.credits;
      if (saved.providerQuotas && typeof saved.providerQuotas === "object") state.providerQuotas = normalizeProviderQuotas(saved.providerQuotas);
    } catch {
      state.session = null;
    }
  }

  function saveStoredSession() {
    try {
      if (!state.session || !state.session.token) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        session: state.session,
        user: state.user,
        credits: state.credits,
        providerQuotas: state.providerQuotas
      }));
    } catch {
      void 0;
    }
  }

  function sessionExpiryMs(value) {
    if (value == null || value === "") return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function clearSessionRefreshTimer() {
    if (!sessionRefreshTimer) return;
    window.clearTimeout(sessionRefreshTimer);
    sessionRefreshTimer = 0;
  }

  function scheduleSessionRefresh() {
    clearSessionRefreshTimer();
    if (!state.session?.token || !state.session?.refreshToken) return;
    const expireMs = sessionExpiryMs(state.session.expiresAt);
    if (!expireMs) return;
    const delay = Math.min(
      2_147_483_647,
      Math.max(SESSION_REFRESH_RETRY_MS, expireMs - Date.now() - SESSION_REFRESH_EARLY_MS)
    );
    sessionRefreshTimer = window.setTimeout(() => {
      sessionRefreshTimer = 0;
      if (state.session?.token) void refreshBootstrap("session-refresh");
    }, delay);
    sessionRefreshTimer?.unref?.();
  }

  function clearStoredSession() {
    clearSessionRefreshTimer();
    sessionRevision += 1;
    state.loading = false;
    state.session = null;
    state.user = null;
    state.credits = null;
    state.providerQuotas = {};
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      void 0;
    }
  }

  function setMessage(message, kind) {
    state.message = String(message || "");
    state.messageKind = kind || "muted";
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${HOST_ATTR}="1"] {
        display: grid !important;
        gap: 8px !important;
        margin: 0 0 8px 0 !important;
        padding: 10px !important;
        border-radius: 8px !important;
        background: rgba(255, 255, 255, 0.035) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        color: rgba(238, 244, 252, 0.94) !important;
        font-size: 12px !important;
        line-height: 1.35 !important;
        box-sizing: border-box !important;
        pointer-events: auto !important;
        -webkit-app-region: no-drag !important;
      }
      [${HOST_ATTR}="1"] * {
        box-sizing: border-box !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-head,
      [${HOST_ATTR}="1"] .nf-client-auth-row,
      [${HOST_ATTR}="1"] .nf-client-auth-actions,
      [${HOST_ATTR}="1"] .nf-client-auth-metrics {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        min-width: 0 !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-head {
        justify-content: space-between !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-title {
        font-weight: 900 !important;
        color: #ffffff !important;
        white-space: nowrap !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-pill {
        height: 20px !important;
        padding: 0 8px !important;
        border-radius: 999px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 10px !important;
        font-weight: 900 !important;
        white-space: nowrap !important;
        background: rgba(255, 255, 255, 0.07) !important;
        color: rgba(238, 244, 252, 0.84) !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-pill.ok {
        background: rgba(30, 166, 114, 0.22) !important;
        color: #bfffe0 !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-pill.warn {
        background: rgba(245, 158, 11, 0.20) !important;
        color: #fde68a !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-pill.error {
        background: rgba(239, 68, 68, 0.20) !important;
        color: #fecaca !important;
      }
      [${HOST_ATTR}="1"] input {
        height: 32px !important;
        min-width: 0 !important;
        padding: 0 9px !important;
        border-radius: 8px !important;
        border: 1px solid rgba(255, 255, 255, 0.10) !important;
        background: #111111 !important;
        color: #ffffff !important;
        font-size: 12px !important;
        pointer-events: auto !important;
        user-select: text !important;
        -webkit-user-select: text !important;
        -webkit-app-region: no-drag !important;
      }
      [${HOST_ATTR}="1"] input::placeholder {
        color: rgba(255, 255, 255, 0.36) !important;
      }
      [${HOST_ATTR}="1"] button {
        height: 32px !important;
        min-width: 0 !important;
        border: 0 !important;
        border-radius: 8px !important;
        padding: 0 10px !important;
        background: #2f2f2f !important;
        color: #ffffff !important;
        font-size: 12px !important;
        font-weight: 900 !important;
        cursor: pointer !important;
        white-space: nowrap !important;
      }
      [${HOST_ATTR}="1"] button.primary {
        background: #1ea672 !important;
      }
      [${HOST_ATTR}="1"] button.ghost {
        background: rgba(255, 255, 255, 0.06) !important;
        color: rgba(238, 244, 252, 0.88) !important;
      }
      [${HOST_ATTR}="1"] button:disabled {
        opacity: 0.48 !important;
        cursor: not-allowed !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-row > input {
        flex: 1 1 auto !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-actions {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-actions.single {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-mode {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 6px !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-mode button[aria-pressed="true"] {
        background: #1ea672 !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-message {
        min-height: 16px !important;
        color: rgba(238, 244, 252, 0.62) !important;
        font-size: 11px !important;
        overflow-wrap: anywhere !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-message.ok {
        color: #bfffe0 !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-message.warn {
        color: #fde68a !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-message.error {
        color: #fecaca !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-account {
        display: grid !important;
        gap: 7px !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-email {
        min-width: 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        color: #ffffff !important;
        font-weight: 900 !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-metrics {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 6px !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-metric {
        min-width: 0 !important;
        border-radius: 8px !important;
        padding: 7px 8px !important;
        background: rgba(0, 0, 0, 0.20) !important;
        border: 1px solid rgba(255, 255, 255, 0.06) !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-metric-label {
        font-size: 10px !important;
        color: rgba(238, 244, 252, 0.54) !important;
        margin-bottom: 3px !important;
      }
      [${HOST_ATTR}="1"] .nf-client-auth-metric-value {
        color: #ffffff !important;
        font-size: 12px !important;
        font-weight: 900 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
    `;
    document.head.appendChild(style);
  }

  function findModeSection() {
    return document.querySelector('[data-novaflow-ai-mode-section="1"]');
  }

  function findModeBodyFirstItem(modeSection) {
    if (!(modeSection instanceof HTMLElement)) return null;
    return Array.from(modeSection.children).find((child) => {
      if (!(child instanceof HTMLElement)) return false;
      if (child === host || child.getAttribute(HOST_ATTR) === "1") return false;
      return true;
    }) || null;
  }

  function placeHost(modeSection) {
    const before = findModeBodyFirstItem(modeSection);
    if (before instanceof HTMLElement) {
      if (host.parentElement !== modeSection || host.nextElementSibling !== before) {
        modeSection.insertBefore(host, before);
      }
      return;
    }
    if (host.parentElement !== modeSection) {
      modeSection.appendChild(host);
    }
  }

  function removeHost() {
    if (host instanceof HTMLElement && host.parentElement) {
      host.parentElement.removeChild(host);
    }
  }

  function authHosts(automaticHost = host) {
    const targets = [];
    if (automaticHost instanceof HTMLElement) targets.push(automaticHost);
    mountedHosts.forEach((target) => {
      if (target instanceof HTMLElement && !targets.includes(target)) targets.push(target);
    });
    return targets;
  }

  function isAuthHostReady(target) {
    return Boolean(
      target instanceof HTMLElement &&
      target.isConnected &&
      target.querySelector(".nf-client-auth-title") instanceof HTMLElement
    );
  }

  function ensureAutomaticAuthHostMounted(automaticHost, renderOwner = render, isReady = isAuthHostReady) {
    if (typeof isReady !== "function") return false;
    if (isReady(automaticHost)) return true;
    if (typeof renderOwner === "function") renderOwner();
    return isReady(automaticHost);
  }

  function scheduleMountedNotification() {
    if (mountedNotificationScheduled) return;
    mountedNotificationScheduled = true;
    window.queueMicrotask(() => {
      mountedNotificationScheduled = false;
      if (!authHosts().some(isAuthHostReady)) return;
      window.dispatchEvent(new Event(MOUNTED_EVENT));
    });
  }

  function clearExternalHost(target) {
    if (!(target instanceof HTMLElement)) return;
    target.removeAttribute(HOST_ATTR);
    target.innerHTML = "";
  }

  function mount(surfaceKey, element) {
    const key = String(surfaceKey || "").trim();
    if (!key) throw new TypeError("NovaFlowClientAuth surfaceKey is required");
    if (!(element instanceof HTMLElement)) throw new TypeError("NovaFlowClientAuth host must be an HTMLElement");
    const previous = mountedHosts.get(key);
    mountedHosts.set(key, element);
    if (previous instanceof HTMLElement && previous !== element && !Array.from(mountedHosts.values()).includes(previous)) {
      clearExternalHost(previous);
    }
    element.setAttribute(HOST_ATTR, "1");
    injectStyle();
    render();
    return element;
  }

  function unmount(surfaceKey) {
    const key = String(surfaceKey || "").trim();
    const target = mountedHosts.get(key);
    if (!(target instanceof HTMLElement)) return false;
    mountedHosts.delete(key);
    if (!Array.from(mountedHosts.values()).includes(target)) clearExternalHost(target);
    return true;
  }

  function ensureHost() {
    const modeSection = findModeSection();
    if (!(modeSection instanceof HTMLElement)) return null;
    injectStyle();
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("div");
      host.setAttribute(HOST_ATTR, "1");
      host.setAttribute("data-novaflow-ai-mode-body-item", "1");
    }
    placeHost(modeSection);
    return host;
  }

  function statusPill() {
    const bridge = getBridge();
    state.bridgeReady = Boolean(bridge);
    if (!bridge) return { text: "桌面桥未启用", cls: "warn" };
    if (state.session && state.user) return { text: "已登录", cls: "ok" };
    if (state.backendStatus === "error") return { text: "账号验证未就绪", cls: "error" };
    if (state.backendStatus === "ready") return { text: backendServiceLabel(), cls: "ok" };
    return { text: "未登录", cls: "warn" };
  }

  function quotaText(key) {
    const quota = state.providerQuotas && state.providerQuotas[key] ? state.providerQuotas[key] : null;
    if (!quota || quota.status === "error") return "0 / 0";
    const remaining = Number(quota.remaining_count || 0);
    const allocated = Number(quota.allocated_count || 0);
    return `${formatNumber(remaining)} / ${formatNumber(allocated)}`;
  }

  function render() {
    if (!getBridge()) {
      removeHost();
      mountedHosts.forEach((target) => {
        if (target instanceof HTMLElement) target.innerHTML = "";
      });
      return;
    }
    const targets = authHosts(ensureHost());
    if (!targets.length) return;
    const pill = statusPill();
    const disabled = state.loading || activeAuthorizationContextCount > 0 ? "disabled" : "";
    const loggedIn = Boolean(state.session && state.session.token && state.user);
    const defaultMessage = state.backendBaseUrl
      ? (isLocalBackendBaseUrl(state.backendBaseUrl) ? "本机测试验证已就绪" : "账号验证已就绪")
      : "登录后读取积分和提示词服务次数";
    const message = state.message || defaultMessage;
    const providerMetrics = PROVIDERS.map((item) => `
      <div class="nf-client-auth-metric">
        <div class="nf-client-auth-metric-label">${escapeHtml(item.label)} 次数</div>
        <div class="nf-client-auth-metric-value">${escapeHtml(quotaText(item.key))}</div>
      </div>
    `).join("");
    const content = `
      <div class="nf-client-auth-head">
        <div class="nf-client-auth-title">NovaFlow 账号</div>
        <div class="nf-client-auth-pill ${pill.cls}">${escapeHtml(pill.text)}</div>
      </div>
      ${loggedIn ? `
        <div class="nf-client-auth-account">
          <div class="nf-client-auth-email" title="${escapeHtml(userAccountLabel(state.user))}">${escapeHtml(userAccountLabel(state.user) || "已登录用户")}</div>
          <div class="nf-client-auth-metrics">
            <div class="nf-client-auth-metric">
              <div class="nf-client-auth-metric-label">可用积分</div>
              <div class="nf-client-auth-metric-value">${escapeHtml(formatCreditAmount(state.credits?.balance_text ?? state.credits?.balance))}</div>
            </div>
            ${providerMetrics}
          </div>
          <div class="nf-client-auth-actions">
            <button type="button" class="primary" data-nf-client-auth-action="refresh" ${disabled}>刷新</button>
            <button type="button" class="ghost" data-nf-client-auth-action="logout" ${disabled}>退出</button>
          </div>
        </div>
      ` : `
        <div class="nf-client-auth-row">
          <input data-nf-client-auth-input="account" type="text" autocomplete="username" placeholder="账号" value="${escapeHtml(state.account)}" />
        </div>
        <div class="nf-client-auth-row">
          <input data-nf-client-auth-input="password" type="password" autocomplete="current-password" placeholder="密码（至少 6 位）" value="${escapeHtml(state.password)}" />
        </div>
        <div class="nf-client-auth-actions single">
          <button type="button" class="primary" data-nf-client-auth-action="submit" ${disabled}>登录账号</button>
        </div>
      `}
      <div class="nf-client-auth-message ${escapeHtml(state.messageKind)}">${escapeHtml(message)}</div>
    `;
    targets.forEach((target) => {
      target.setAttribute(HOST_ATTR, "1");
      target.innerHTML = content;
      bindHostEvents(target);
    });
    scheduleMountedNotification();
  }

  function syncInputsFromHost(target) {
    const account = target.querySelector('[data-nf-client-auth-input="account"]');
    const password = target.querySelector('[data-nf-client-auth-input="password"]');
    if (account instanceof HTMLInputElement) state.account = account.value.trim();
    if (password instanceof HTMLInputElement) state.password = password.value;
  }

  function triggerClientAuthAction(action, target) {
    if (target instanceof HTMLElement) syncInputsFromHost(target);
    if (action === "submit") void submitPasswordAuth();
    if (action === "refresh") void refreshBootstrap("manual");
    if (action === "logout") void logout();
  }

  function handleGlobalActionClick(event) {
    const source = event.target;
    if (!(source instanceof Element)) return;
    const actionButton = source.closest("[data-nf-client-auth-action]");
    if (!(actionButton instanceof HTMLElement)) return;
    const target = actionButton.closest(`[${HOST_ATTR}="1"]`);
    if (!(target instanceof HTMLElement) || !authHosts().includes(target)) return;
    if (actionButton.hasAttribute("disabled")) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    triggerClientAuthAction(actionButton.getAttribute("data-nf-client-auth-action"), target);
  }

  function bindGlobalActionCapture() {
    if (globalActionClickBound) return;
    globalActionClickBound = true;
    document.addEventListener("click", handleGlobalActionClick);
  }

  function bindHostEvents(target) {
    if (target.getAttribute("data-nf-client-auth-bound") === "1") return;
    target.setAttribute("data-nf-client-auth-bound", "1");

    const handleHostAction = (event) => {
      const source = event.target;
      if (!(source instanceof Element)) return false;
      const actionButton = source.closest("[data-nf-client-auth-action]");
      if (!(actionButton instanceof HTMLElement) || !target.contains(actionButton)) return false;
      if (actionButton.hasAttribute("disabled")) return true;
      const action = String(actionButton.getAttribute("data-nf-client-auth-action") || "");
      const now = Date.now();
      const duplicate = lastDirectAction.action === action && now - lastDirectAction.at < 600;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      if (!duplicate) {
        lastDirectAction = { action, at: now };
        triggerClientAuthAction(action, target);
      }
      return true;
    };

    target.addEventListener("click", (event) => {
      if (handleHostAction(event)) return;
      const source = event.target;
      if (!(source instanceof Element)) return;
      if (source.closest("[data-nf-client-auth-input]")) {
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      }
    }, true);

    ["pointerdown", "mousedown", "mouseup", "pointerup"].forEach((eventName) => {
      target.addEventListener(eventName, (event) => {
        if (eventName === "pointerup" && handleHostAction(event)) return;
        const source = event.target;
        if (!(source instanceof Element)) return;
        if (!source.closest("[data-nf-client-auth-input]")) return;
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      }, true);
    });

    ["keydown", "keypress", "keyup", "beforeinput", "compositionstart", "compositionupdate", "compositionend"].forEach((eventName) => {
      target.addEventListener(eventName, (event) => {
        const source = event.target;
        if (!(source instanceof Element)) return;
        if (!source.closest("[data-nf-client-auth-input]")) return;
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      }, true);
    });

    target.addEventListener("input", (event) => {
      const source = event.target;
      if (!(source instanceof HTMLElement)) return;
      if (!source.matches("[data-nf-client-auth-input]")) return;
      syncInputsFromHost(target);
    }, true);
  }

  async function callBridge(method, payload) {
    const bridge = getBridge();
    if (!bridge || typeof bridge[method] !== "function") {
      throw new Error("仅桌面版支持账号登录");
    }
    return await bridge[method](payload || {});
  }

  function validAccount(account) {
    const value = String(account || "").trim();
    return value.length >= 2 && value.length <= 64 && /^[a-z0-9._-]+$/.test(value);
  }

  function authErrorMessage(result, fallback) {
    const status = Number(result?.httpStatus || result?.statusCode || 0);
    const raw = String(result?.error || fallback || "");
    if (status === 401) return "账号或密码错误";
    if (status === 403) return "账号已停用，请联系管理员";
    if (status === 410) return "主程序不开放注册，请联系管理员开通账号";
    if (/invalid login credentials/i.test(raw)) return "账号或密码错误";
    if (/self registration is disabled/i.test(raw)) return "主程序不开放注册，请联系管理员开通账号";
    return raw || fallback;
  }

  async function submitPasswordAuth() {
    if (!validAccount(state.account)) {
      setMessage("请输入有效账号", "warn");
      render();
      return;
    }
    if (!state.password || state.password.length < 6) {
      setMessage("请输入至少 6 位密码", "warn");
      render();
      return;
    }
    state.loading = true;
    setMessage("正在登录...", "muted");
    render();
    try {
      const result = await callBridge("clientAuthLogin", { account: state.account, password: state.password });
      state.backendBaseUrl = result && result.baseUrl ? String(result.baseUrl) : state.backendBaseUrl;
      if (!result || result.ok === false || !result.session || !result.session.token) {
        throw new Error(authErrorMessage(result, "登录失败"));
      }
      state.session = result.session;
      sessionRevision += 1;
      applyProfileSnapshot(result);
      setMessage("登录成功", "ok");
    } catch (err) {
      setMessage(String(err?.message || err || "登录失败"), "error");
    } finally {
      state.password = "";
      state.loading = false;
      render();
    }
  }

  async function refreshBootstrap(source) {
    if (!state.session || !state.session.token) {
      render();
      return;
    }
    const requestSession = { ...state.session };
    const requestToken = String(requestSession.token || "");
    const requestRevision = sessionRevision;
    const requestSequence = ++bootstrapRequestRevision;
    state.loading = true;
    if (source === "manual") setMessage("正在刷新后台状态...", "muted");
    render();
    try {
      const result = await callBridge("clientAuthBootstrap", requestSession);
      if (requestSequence !== bootstrapRequestRevision || requestRevision !== sessionRevision || requestToken !== String(state.session?.token || "")) return;
      state.backendBaseUrl = result && result.baseUrl ? String(result.baseUrl) : state.backendBaseUrl;
      if (!result || result.ok === false) {
        const status = Number(result?.httpStatus || result?.statusCode || 0);
        if (status === 401 || status === 403) {
          clearStoredSession();
          state.backendStatus = "ready";
          setMessage(status === 403 ? "账号已停用，请联系管理员" : "登录已过期，请重新登录", "error");
          render();
          return;
        }
        throw new Error(authErrorMessage(result, "后台状态读取失败"));
      }
      applyProfileSnapshot(result);
      setMessage(source === "manual" ? "账号状态已刷新" : "", source === "manual" ? "ok" : "muted");
    } catch (err) {
      if (requestSequence !== bootstrapRequestRevision || requestRevision !== sessionRevision) return;
      if (!/登录已过期|账号或密码错误|账号已停用/.test(String(err?.message || err || ""))) {
        state.backendStatus = "error";
      }
      setMessage(String(err?.message || err || "后台状态读取失败"), "error");
      scheduleSessionRefresh();
    } finally {
      if (requestSequence === bootstrapRequestRevision && requestRevision === sessionRevision) {
        state.loading = false;
        render();
      }
    }
  }

  function isCurrentAuthorizationToken(token) {
    return !!token && token === String(state.session && state.session.token || "");
  }

  async function authorizeAiTaskWithToken(token, payload) {
    if (!token) {
      return { ok: false, httpStatus: 401, error: "请先登录账号后再使用可灵/即梦本地工作流" };
    }
    try {
      const result = await callBridge("clientAuthAiTaskAuthorize", { ...(payload || {}), token });
      const currentSession = isCurrentAuthorizationToken(token);
      if (Number(result?.httpStatus || result?.status || 0) === 401 && currentSession) clearStoredSession();
      if (currentSession && result && result.ok !== false && result.credits && typeof result.credits === "object") {
        applyCreditsSnapshot(result.credits);
        saveStoredSession();
        render();
      }
      return result;
    } catch (err) {
      return { ok: false, error: String(err?.message || err || "本地工作流授权失败") };
    }
  }

  async function authorizeAiTask(payload) {
    return await authorizeAiTaskWithToken(String(state.session && state.session.token || ""), payload);
  }

  async function commitAiTaskUsageWithToken(token, payload) {
    if (!token) {
      return { ok: false, httpStatus: 401, error: "请先登录账号后再记录可灵/即梦本地工作流次数" };
    }
    try {
      const result = await callBridge("clientAuthAiTaskCommitUsage", { ...(payload || {}), token });
      const currentSession = isCurrentAuthorizationToken(token);
      if (Number(result?.httpStatus || result?.status || 0) === 401 && currentSession) clearStoredSession();
      if (currentSession && result && result.ok !== false) {
        if (result.credits && typeof result.credits === "object") {
          applyCreditsSnapshot(result.credits);
          saveStoredSession();
          render();
        }
        if (result.providerQuotas && typeof result.providerQuotas === "object") {
          state.providerQuotas = normalizeProviderQuotas({
            ...(state.providerQuotas || {}),
            ...result.providerQuotas
          });
          saveStoredSession();
          render();
        } else {
          applyProviderQuotaSnapshot(payload?.providerKey || payload?.provider || result.provider?.providerKey, result.quota);
        }
      }
      return result;
    } catch (err) {
      return { ok: false, error: String(err?.message || err || "本地工作流次数记录失败") };
    }
  }

  async function commitAiTaskUsage(payload) {
    return await commitAiTaskUsageWithToken(String(state.session && state.session.token || ""), payload);
  }

  function createAuthorizationContext() {
    let capturedToken = String(state.session && state.session.token || "").trim();
    if (!capturedToken) return null;
    let released = false;
    activeAuthorizationContextCount += 1;
    render();
    const ensureActive = () => !released && !!capturedToken;
    return Object.freeze({
      authorizeAiTask: (payload) => ensureActive()
        ? authorizeAiTaskWithToken(capturedToken, payload)
        : Promise.resolve({ ok: false, error: "authorization context released" }),
      commitAiTaskUsage: (payload) => ensureActive()
        ? commitAiTaskUsageWithToken(capturedToken, payload)
        : Promise.resolve({ ok: false, error: "authorization context released" }),
      release() {
        if (released) return;
        released = true;
        capturedToken = "";
        activeAuthorizationContextCount = Math.max(0, activeAuthorizationContextCount - 1);
        render();
      }
    });
  }

  async function logout() {
    if (activeAuthorizationContextCount > 0) {
      setMessage("生成任务进行中，账号暂时锁定", "warn");
      render();
      return { ok: false, locked: true };
    }
    const token = state.session && state.session.token;
    clearStoredSession();
    setMessage("已退出登录", "muted");
    render();
    if (token) {
      try {
        const result = await callBridge("clientAuthLogout", { token });
        return result && result.ok === false ? result : { ok: true };
      } catch {
        return { ok: true, localOnly: true };
      }
    }
    return { ok: true };
  }

  async function checkBackendStatus() {
    const bridge = getBridge();
    if (!bridge || typeof bridge.clientAuthStatus !== "function") {
      state.backendStatus = "error";
      setMessage("仅桌面版支持账号登录", "warn");
      render();
      return;
    }
    try {
      const result = await bridge.clientAuthStatus();
      state.backendBaseUrl = result && result.baseUrl ? String(result.baseUrl) : state.backendBaseUrl;
      state.backendStatus = result && result.ok ? "ready" : "error";
      if (!result || !result.ok) setMessage(result?.health?.error || "Supabase Auth 未就绪", "warn");
      render();
    } catch (err) {
      state.backendStatus = "error";
      setMessage(String(err?.message || err || "Supabase Auth 未就绪"), "warn");
      render();
    }
  }

  function scheduleRender() {
    if (refreshTimer) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      const active = document.activeElement;
      if (active instanceof HTMLElement && authHosts().some((target) => target.contains(active)) && active.matches("[data-nf-client-auth-input]")) {
        return;
      }
      render();
    }, 80);
  }

  function startObserver() {
    if (observer || typeof MutationObserver !== "function") return;
    observer = new MutationObserver(scheduleRender);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-novaflow-ai-mode-section"] });
  }

  function handleWindowFocusRefresh() {
    if (!state.session || !state.session.token || state.loading) return;
    const now = Date.now();
    if (now - lastFocusRefreshAt < 2500) return;
    lastFocusRefreshAt = now;
    void refreshBootstrap("focus");
  }

  function bindFocusRefresh() {
    if (focusRefreshBound) return;
    focusRefreshBound = true;
    window.addEventListener("focus", handleWindowFocusRefresh);
  }

  function handleProviderUsageSettlement(event) {
    if (event?.source !== window) return;
    if (event?.data?.type !== "novaflow-provider-usage-settled") return;
    if (!state.session || !state.session.token) return;
    void refreshBootstrap("settlement");
  }

  function bindProviderSettlementRefresh() {
    if (providerSettlementRefreshBound) return;
    providerSettlementRefreshBound = true;
    window.addEventListener("message", handleProviderUsageSettlement);
  }

  function init() {
    loadStoredSession();
    bindGlobalActionCapture();
    bindFocusRefresh();
    bindProviderSettlementRefresh();
    render();
    startObserver();
    if (state.session && state.session.token) {
      void refreshBootstrap("startup");
    } else {
      void checkBackendStatus();
    }
  }

  window.NovaFlowClientAuth = {
    mount,
    unmount,
    ensureMounted() {
      const automaticHost = ensureHost();
      return ensureAutomaticAuthHostMounted(automaticHost);
    },
    createAuthorizationContext,
    refresh: () => refreshBootstrap("manual"),
    logout,
    authorizeAiTask,
    commitAiTaskUsage,
    state: () => ({
      account: userAccountLabel(state.user) || state.account || "",
      loggedIn: Boolean(state.session && state.user),
      credits: state.credits || null,
      providerQuotas: state.providerQuotas || {},
      backendStatus: state.backendStatus,
      backendBaseUrl: state.backendBaseUrl
    })
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
