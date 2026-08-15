const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.resolve(__dirname, "../../particle-editor/novaflow-client-auth.js");
const source = fs.readFileSync(sourcePath, "utf8");

function parseSelector(selector) {
  const match = String(selector || "").match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
  return match ? { name: match[1], value: match[2] } : null;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this._innerHTML = "";
    this.id = "";
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    if (child.parentElement) child.parentElement.removeChild(child);
    const index = this.children.indexOf(before);
    child.parentElement = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
    return child;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  matches(selector) {
    const parsed = parseSelector(selector);
    if (!parsed) return false;
    if (!this.hasAttribute(parsed.name)) return false;
    return parsed.value == null || this.getAttribute(parsed.name) === parsed.value;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(element) {
    let current = element;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeInputElement extends FakeElement {
  constructor(ownerDocument) {
    super("input", ownerDocument);
    this.value = "";
  }
}

class FakeDocument {
  constructor() {
    this.readyState = "loading";
    this.listeners = new Map();
    this.documentElement = new FakeElement("html", this);
    this.head = new FakeElement("head", this);
    this.documentElement.appendChild(this.head);
    this.activeElement = null;
  }

  createElement(tagName) {
    return String(tagName).toLowerCase() === "input"
      ? new FakeInputElement(this)
      : new FakeElement(tagName, this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type });
  }

  querySelector(selector) {
    if (this.documentElement.matches(selector)) return this.documentElement;
    return this.documentElement.querySelector(selector);
  }

  getElementById(id) {
    const visit = (element) => {
      if (element.id === id) return element;
      for (const child of element.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.documentElement);
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }
  observe() {}
}
FakeMutationObserver.instances = [];

async function main() {
  const document = new FakeDocument();
  const modeSection = document.createElement("section");
  modeSection.setAttribute("data-novaflow-ai-mode-section", "1");
  const existingBodyItem = document.createElement("div");
  modeSection.appendChild(existingBodyItem);
  document.documentElement.appendChild(modeSection);

  const windowListeners = new Map();
  const loginCalls = [];
  const authorizeCalls = [];
  const commitCalls = [];
  const logoutCalls = [];
  const bootstrapCalls = [];
  let bootstrapBalance = 20;
  let bootstrapResponder = async () => ({
    ok: true,
    session: {
      token: "refreshed-session",
      refreshToken: "refreshed-refresh",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    user: { account: "shared-account" },
    credits: { balance: bootstrapBalance },
    providerQuotas: {},
  });
  const storage = new Map();
  const window = {
    electronAPI: {
      async clientAuthLogin(payload) {
        loginCalls.push(payload);
        return {
          ok: true,
          session: {
            token: "shared-session",
            refreshToken: "shared-refresh",
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
          user: { account: "shared-account" },
          credits: { balance: 20 },
          providerQuotas: {},
        };
      },
      async clientAuthBootstrap(payload) {
        bootstrapCalls.push(payload);
        return await bootstrapResponder(payload);
      },
      async clientAuthStatus() {
        return { ok: true, baseUrl: "https://auth.example.test" };
      },
      async clientAuthLogout() {
        logoutCalls.push(true);
        return { ok: true };
      },
      async clientAuthAiTaskAuthorize(payload) {
        authorizeCalls.push(payload);
        return { ok: true };
      },
      async clientAuthAiTaskCommitUsage(payload) {
        commitCalls.push(payload);
        return { ok: true };
      },
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    setTimeout,
    clearTimeout,
    queueMicrotask,
  };
  window.window = window;

  const context = vm.createContext({
    window,
    document,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInputElement,
    Element: FakeElement,
    MutationObserver: FakeMutationObserver,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    URL,
    TextDecoder,
    Uint8Array,
    atob,
    console,
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(source, context, { filename: sourcePath });
  document.dispatch("DOMContentLoaded");
  await Promise.resolve();

  const auth = window.NovaFlowClientAuth;
  assert.ok(auth && typeof auth.mount === "function", "client auth should expose mount(surfaceKey, element)");
  assert.equal(typeof auth.unmount, "function", "client auth should expose unmount(surfaceKey)");

  const automaticHost = modeSection.querySelector('[data-novaflow-client-auth-panel="1"]');
  assert.ok(automaticHost, "the automatic AI Sequence account host should remain mounted");
  assert.match(automaticHost.innerHTML, /NovaFlow 账号/);

  const firstHost = document.createElement("div");
  const secondHost = document.createElement("div");
  auth.mount("first-surface", firstHost);
  auth.mount("second-surface", secondHost);
  assert.match(firstHost.innerHTML, /NovaFlow 账号/, "the first registered host should render shared state");
  assert.match(secondHost.innerHTML, /NovaFlow 账号/, "the second registered host should render shared state");
  assert.equal(FakeMutationObserver.instances.length, 1, "all hosts should share one observer");
  assert.equal((document.listeners.get("click") || []).length, 1, "all hosts should share one document fallback action pipeline");
  assert.equal((windowListeners.get("focus") || []).length, 1, "all hosts should share one focus refresh pipeline");
  assert.equal((windowListeners.get("message") || []).length, 1, "all hosts should share one settlement refresh pipeline");

  const accountInput = new FakeInputElement(document);
  accountInput.setAttribute("data-nf-client-auth-input", "account");
  accountInput.value = "second-account";
  const passwordInput = new FakeInputElement(document);
  passwordInput.setAttribute("data-nf-client-auth-input", "password");
  passwordInput.value = "secret2";
  const submit = document.createElement("button");
  submit.setAttribute("data-nf-client-auth-action", "submit");
  secondHost.appendChild(accountInput);
  secondHost.appendChild(passwordInput);
  secondHost.appendChild(submit);

  const event = {
    target: submit,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
  for (const listener of secondHost.listeners.get("click") || []) listener(event);
  assert.deepEqual(
    loginCalls.map(({ account, password }) => ({ account, password })),
    [{ account: "second-account", password: "secret2" }],
    "the global handler should resolve inputs from the clicked auth host",
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bootstrapCalls.length, 0, "login should reuse the main-process bootstrap snapshot without a duplicate request");
  assert.match(firstHost.innerHTML, /shared-account/, "state changes should render the bootstrap snapshot to every registered host");
  assert.equal(secondHost.innerHTML, firstHost.innerHTML, "the clicked host should receive the same shared state");

  const bootstrapCountBeforeSettlement = bootstrapCalls.length;
  bootstrapBalance = 15.73;
  const settlementListener = (windowListeners.get("message") || [])[0];
  settlementListener({ source: window, data: { type: "novaflow-provider-usage-settled", payload: { promptId: "ui-cloud-1" } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bootstrapCalls.length, bootstrapCountBeforeSettlement + 1, "trusted settlement should refresh account state once");
  assert.equal(bootstrapCalls[0].token, "shared-session");
  assert.equal(bootstrapCalls[0].refreshToken, "shared-refresh");
  assert.ok(bootstrapCalls[0].expiresAt, "bootstrap should carry the complete persisted session");
  assert.equal(JSON.parse(storage.get("novaflow.client.auth.session.v1")).session.token, "refreshed-session");
  assert.match(firstHost.innerHTML, /15\.73/, "settlement refresh should update every mounted account card");
  settlementListener({ source: {}, data: { type: "novaflow-provider-usage-settled", payload: { promptId: "forged" } } });
  settlementListener({ source: window, data: { type: "unrelated-message" } });
  assert.equal(bootstrapCalls.length, bootstrapCountBeforeSettlement + 1, "foreign and unrelated messages must be ignored");

  let resolveOlderBootstrap;
  let resolveNewerBootstrap;
  let concurrentBootstrapCount = 0;
  bootstrapResponder = () => new Promise((resolve) => {
    concurrentBootstrapCount += 1;
    if (concurrentBootstrapCount === 1) resolveOlderBootstrap = resolve;
    else resolveNewerBootstrap = resolve;
  });
  const olderRefresh = auth.refresh();
  const newerRefresh = auth.refresh();
  resolveNewerBootstrap({ ok: true, user: { account: "shared-account" }, credits: { balance: 12 }, providerQuotas: {} });
  await newerRefresh;
  assert.match(firstHost.innerHTML, />12</, "the newest bootstrap response should update every account card");
  resolveOlderBootstrap({ ok: true, user: { account: "shared-account" }, credits: { balance: 18 }, providerQuotas: {} });
  await olderRefresh;
  assert.match(firstHost.innerHTML, />12</, "a stale bootstrap response must not overwrite the newer balance");
  assert.doesNotMatch(firstHost.innerHTML, />18</);

  assert.equal(typeof auth.createAuthorizationContext, "function", "client auth should expose an opaque task context");
  const authorizationContext = auth.createAuthorizationContext();
  assert.ok(authorizationContext, "a logged-in account should create an authorization context");
  assert.equal("token" in authorizationContext, false, "the opaque context must not expose the bearer token");
  assert.match(firstHost.innerHTML, /data-nf-client-auth-action="logout" disabled/, "active tasks should lock every shared account card");
  const lockedLogout = await auth.logout();
  assert.equal(lockedLogout.locked, true);
  assert.equal(logoutCalls.length, 0, "logout must not revoke the captured token while a task is active");
  await authorizationContext.authorizeAiTask({ providerKey: "comfyui" });
  await authorizationContext.commitAiTaskUsage({ providerKey: "comfyui", promptId: "task-a" });
  assert.equal(authorizeCalls[0].token, "refreshed-session");
  assert.equal(commitCalls[0].token, "refreshed-session");
  authorizationContext.release();
  await auth.logout();
  assert.equal(logoutCalls.length, 1, "logout should be restored after the task releases its context");
  assert.equal(storage.has("novaflow.client.auth.session.v1"), false, "logout must remove the persisted renderer session");
  assert.equal(auth.state().loggedIn, false, "logout must immediately clear the public logged-in state");
  assert.match(firstHost.innerHTML, /登录账号/, "every mounted host should return to the login form after logout");

  const reloginAccount = new FakeInputElement(document);
  reloginAccount.setAttribute("data-nf-client-auth-input", "account");
  reloginAccount.value = "second-account";
  const reloginPassword = new FakeInputElement(document);
  reloginPassword.setAttribute("data-nf-client-auth-input", "password");
  reloginPassword.value = "secret2";
  const reloginSubmit = document.createElement("button");
  reloginSubmit.setAttribute("data-nf-client-auth-action", "submit");
  firstHost.appendChild(reloginAccount);
  firstHost.appendChild(reloginPassword);
  firstHost.appendChild(reloginSubmit);
  const reloginEvent = {
    target: reloginSubmit,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
  for (const listener of document.listeners.get("click") || []) listener(reloginEvent);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(auth.state().loggedIn, true, "the test account should be logged in again before the 403 check");
  bootstrapResponder = async () => ({ ok: false, httpStatus: 403, error: "user disabled" });
  await auth.refresh();
  assert.equal(auth.state().loggedIn, false, "a 403 bootstrap response must clear the renderer session");
  assert.equal(storage.has("novaflow.client.auth.session.v1"), false, "a disabled account must not remain persisted");

  auth.unmount("second-surface");
  assert.equal(secondHost.getAttribute("data-novaflow-client-auth-panel"), null, "unmount should unregister the external host");
  assert.match(firstHost.innerHTML, /登录账号/, "unmounting one surface should not disturb the cleared 403 state");
}

main().then(() => {
  console.log("client-auth multi-host tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
