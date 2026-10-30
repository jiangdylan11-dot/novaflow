// Verify the Web account dialog reads quota data from the account service.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';

const source = await readFile(new URL('../../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
let checks = 0, status = 200;
const requests = [];
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const profile = { ok: true, user: { plan: 'pro' }, credits: { balance: 5000.125 }, providerQuotas: { grok: { status: 'connected', remaining_count: 12, allocated_count: 30 } } };
const sandbox = createDomSandbox({
  Response, Request, Blob, FormData,
  NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test', authUrl: 'https://account.test' },
  fetch: async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(status === 200 ? profile : { error: 'quota temporarily unavailable' }), { status });
  }
});
sandbox.localStorage.setItem('novaflow_web_session_v1', JSON.stringify({ token: 'test-token' }));
runInContext(source, createContext(sandbox));
const api = sandbox.electronAPI;
const account = await api.clientAuthAccountDetails();
check(account.ok, true);
check(account.result.credits.balance, 5000.125);
check(account.result.user.plan, 'pro'); // The dialog shows the tier the account service holds.
check(account.result.providerQuotas.grok.remaining_count, 12);
check(account.result.providerQuotas.grok.allocated_count, 30);
// The runtime probes capabilities on load, so find the account read by URL.
const bootstrap = requests.find((r) => r.url === 'https://account.test/api/client/bootstrap');
check(bootstrap.init.method, 'GET');
check(bootstrap.init.headers.Authorization, 'Bearer test-token');
status = 503;
const unavailable = await api.clientAuthAccountDetails();
check(unavailable.ok, false);
check(unavailable.httpStatus, 503);
check(unavailable.result, undefined); // A failed read never invents zero quota.
check(!!sandbox.localStorage.getItem('novaflow_web_session_v1'), true);
await api.clientAuthLogout();
const before = requests.length;
check((await api.clientAuthAccountDetails()).httpStatus, 401);
check(requests.length, before);
// A Web status poll may fail while the control plane is temporarily offline.
// Keep the stored token, including the copy held by the shared account panel,
// and clear both stores only after an explicit authentication rejection.
let controlStatus = 503;
const recoveryRequests = [];
const recovering = createDomSandbox({
  Response, Request, Blob, FormData,
  NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
  fetch: async (url, init) => {
    recoveryRequests.push({ url: String(url), init });
    return new Response(JSON.stringify(controlStatus === 200
      ? { user: { display_name: 'Dylan' }, credits: { balance: 1 } }
      : { error: controlStatus === 401 ? 'invalid session' : 'temporarily unavailable' }), { status: controlStatus });
  }
});
recovering.localStorage.setItem('novaflow.client.auth.session.v1', JSON.stringify({
  session: { token: 'recovered-token' }, user: { display_name: 'Dylan' }
}));
runInContext(source, createContext(recovering));
check((await recovering.electronAPI.clientAuthStatus()).result.authenticated, true);
check(recoveryRequests.at(-1).init.headers.Authorization, 'Bearer recovered-token');
check(!!recovering.localStorage.getItem('novaflow.client.auth.session.v1'), true);
controlStatus = 200;
check((await recovering.electronAPI.clientAuthStatus()).result.user.display_name, 'Dylan');
controlStatus = 401;
check((await recovering.electronAPI.clientAuthStatus()).result.authenticated, false);
check(recovering.localStorage.getItem('novaflow.client.auth.session.v1'), null);
check(recovering.localStorage.getItem('novaflow_web_session_v1'), null);
// A local assistant's missing control-plane address is a configuration error,
// not an expired account. Never send the account probe to its paired API.
const missingControlRequests = [];
const missingControl = createDomSandbox({
  Response, Request, Blob, FormData,
  NOVAFLOW_WEB_CONFIG: { controlUrl: '', localAssistant: true },
  fetch: async (url) => {
    missingControlRequests.push(String(url));
    return new Response(JSON.stringify({ error: 'local pairing required' }), { status: 401 });
  }
});
missingControl.localStorage.setItem('novaflow.client.auth.session.v1', JSON.stringify({
  session: { token: 'still-valid-account-token' }, user: { display_name: 'Dylan' }
}));
runInContext(source, createContext(missingControl));
const missingStatus = await missingControl.electronAPI.clientAuthStatus();
check(missingStatus.result.authenticated, true);
check(missingStatus.result.temporarilyUnavailable, true);
check(missingControlRequests.some(url => url.endsWith('/api/web/me')), false);
check(!!missingControl.localStorage.getItem('novaflow.client.auth.session.v1'), true);
// A tab that was open before login must pick up the token written by a second tab.
recovering.localStorage.setItem('novaflow.client.auth.session.v1', JSON.stringify({
  session: { token: 'new-tab-token' }, user: { display_name: 'Dylan' }
}));
controlStatus = 200;
check((await recovering.electronAPI.clientAuthStatus()).result.authenticated, true);
check(recoveryRequests.at(-1).init.headers.Authorization, 'Bearer new-tab-token');
recovering.localStorage.removeItem('novaflow.client.auth.session.v1');
check((await recovering.electronAPI.clientAuthStatus()).result.authenticated, false);
// Local authorization must not bypass the same account login screen.
const accountSource = await readFile(new URL('../../renderer/novaflow-web-account.js', import.meta.url), 'utf8');
for (const computeMode of ['local', 'shared']) {
  let authenticated = false;
  const gateSandbox = createDomSandbox({
    NovaFlowWebRuntime: { computeMode },
    electronAPI: { clientAuthStatus: async () => ({ ok: true, result: { authenticated } }) },
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {}
  });
  const mounted = new Map();
  gateSandbox.document.getElementById = id => mounted.get(id) || null;
  gateSandbox.document.body.appendChild = node => { mounted.set(node.id, node); node.parentNode = gateSandbox.document.body; return node; };
  gateSandbox.document.body.removeChild = node => { mounted.delete(node.id); node.parentNode = null; return node; };
  runInContext(accountSource, createContext(gateSandbox));
  await gateSandbox.NovaFlowWebAccount.guard();
  check(!!gateSandbox.document.getElementById('novaflow-web-login-gate'), true);
  authenticated = true;
  await gateSandbox.NovaFlowWebAccount.guard();
  check(!!gateSandbox.document.getElementById('novaflow-web-login-gate'), false);
}
// Header strip: name, live balance and 退出 sit after the version. The modal is gone.
function headerDocument() {
  const ids = new Map();
  function relink(parent) {
    const kids = parent.children || [];
    kids.forEach((child, index) => {
      child.parentNode = parent;
      child.parentElement = parent;
      child.previousSibling = kids[index - 1] || null;
      child.nextSibling = kids[index + 1] || null;
      child.previousElementSibling = kids[index - 1] || null;
      child.nextElementSibling = kids[index + 1] || null;
    });
  }
  function register(node) {
    if (node && node.id) ids.set(node.id, node);
    for (const child of node.children || []) register(child);
  }
  function matches(node, selector) {
    if (selector.startsWith('.')) return String(node.className || '').split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const attr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!attr) return false;
    const value = node.attrs && node.attrs[attr[1]];
    if (value == null) return false;
    return attr[2] == null || value === attr[2];
  }
  function query(node, selector) {
    const found = [];
    (function walk(current) {
      for (const child of current.children || []) {
        if (matches(child, selector)) found.push(child);
        walk(child);
      }
    })(node);
    return found[0] || null;
  }
  function make(tag) {
    let idValue = '';
    const node = {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      hidden: false,
      disabled: false,
      type: '',
      title: '',
      value: '',
      placeholder: '',
      autocomplete: '',
      open: false,
      children: [],
      parentNode: null,
      parentElement: null,
      nextSibling: null,
      nextElementSibling: null,
      attrs: {},
      style: { color: '', setProperty() {}, removeProperty() {} },
      nodeListeners: {},
      setAttribute(name, value) { node.attrs[String(name)] = String(value); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(node.attrs, String(name)) ? node.attrs[String(name)] : null; },
      removeAttribute(name) { delete node.attrs[String(name)]; },
      hasAttribute(name) { return Object.prototype.hasOwnProperty.call(node.attrs, String(name)); },
      addEventListener(type, fn) { (node.nodeListeners[type] ||= []).push(fn); },
      removeEventListener() {},
      appendChild(child) {
        if (child.parentNode && child.parentNode.children) {
          const index = child.parentNode.children.indexOf(child);
          if (index >= 0) child.parentNode.children.splice(index, 1);
          relink(child.parentNode);
        }
        node.children.push(child);
        relink(node);
        register(child);
        return child;
      },
      insertBefore(child, before) {
        const index = before ? node.children.indexOf(before) : -1;
        node.children.splice(index < 0 ? node.children.length : index, 0, child);
        relink(node);
        register(child);
        return child;
      },
      removeChild(child) {
        const index = node.children.indexOf(child);
        if (index >= 0) node.children.splice(index, 1);
        child.parentNode = null;
        child.parentElement = null;
        relink(node);
        return child;
      },
      after(child) {
        const parent = node.parentNode;
        if (!parent) return;
        const index = parent.children.indexOf(node);
        parent.children.splice(index + 1, 0, child);
        relink(parent);
        register(child);
      },
      remove() {
        if (node.id) ids.delete(node.id);
        if (node.parentNode && typeof node.parentNode.removeChild === 'function') node.parentNode.removeChild(node);
      },
      close() { node.open = false; },
      focus() {},
      click() {
        for (const fn of node.nodeListeners.click || []) fn({ preventDefault() {}, stopPropagation() {}, target: node });
      },
      querySelector(selector) { return query(node, selector); },
      contains(other) {
        let current = other;
        while (current) {
          if (current === node) return true;
          current = current.parentNode;
        }
        return false;
      }
    };
    Object.defineProperty(node, 'id', {
      get() { return idValue; },
      set(value) {
        if (idValue) ids.delete(idValue);
        idValue = String(value || '');
        if (idValue) ids.set(idValue, node);
      }
    });
    return node;
  }
  const body = make('body');
  const head = make('head');
  const doc = make('#document');
  doc.body = body;
  doc.head = head;
  doc.children = [head, body];
  relink(doc);
  doc.createElement = (tag) => make(tag);
  doc.createTextNode = (text) => Object.assign(make('#text'), { textContent: String(text) });
  doc.getElementById = (id) => ids.get(String(id)) || null;
  doc.querySelector = (selector) => query(doc, selector);
  const brand = make('div');
  brand.className = 'nf-brand';
  const version = make('span');
  version.className = 'nf-brand-version';
  version.textContent = 'v2.0.135';
  brand.appendChild(version);
  const legacyButton = make('button');
  legacyButton.id = 'novaflow-web-account-button';
  legacyButton.textContent = 'dylan';
  const legacyDialog = make('dialog');
  legacyDialog.id = 'novaflow-web-account-dialog';
  legacyDialog.open = true;
  body.appendChild(brand);
  body.appendChild(legacyButton);
  body.appendChild(legacyDialog);
  return { doc, brand, version };
}

function loadAccount(sandbox) {
  runInContext(accountSource, createContext(sandbox));
}

{

  let balance = 44128;
  let displayName = 'dylan';
  let logoutCalls = 0;
  let reloaded = 0;
  const appliedPrices = [];
  const { doc, version } = headerDocument();
  const sandbox = {
    document: doc,
    Intl, Promise, Number, String, Object,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { reload() { reloaded += 1; } },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval() {},
    addEventListener(type, fn) { (sandbox.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(event) {
      for (const fn of sandbox.listeners[event.type] || []) fn(event);
      return true;
    },
    listeners: {},
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; Object.assign(this, init || {}); }
    },
    NovaFlowFeatureCreditPrices: { applyConfig(next) { appliedPrices.push(next); } },
    electronAPI: {
      clientAuthStatus: async () => ({ ok: true, result: { authenticated: true, user: { display_name: displayName }, credits: { balance } } }),
      clientAuthAccountDetails: async () => ({
        ok: true,
        result: { user: { display_name: displayName }, credits: { balance }, featureCreditPrices: { prices: { online_chat_turn: 4 } } }
      }),
      clientAuthLogout: async () => { logoutCalls += 1; return { ok: true }; }
    }
  };
  sandbox.window = sandbox;
  const context = createContext(sandbox);
  runInContext(accountSource, context);
  runInContext('globalThis.__nfRoot = globalThis;', context);
  check(sandbox.NovaFlowWebAccount.seat(doc.querySelector('.nf-brand')), true);
  await sandbox.NovaFlowWebAccount.refresh();
  const strip = version.nextElementSibling;
  check(strip && strip.id, 'novaflow-web-account-header');
  check(strip.querySelector('[data-novaflow-account-name]').textContent, 'dylan');
  check(strip.querySelector('[data-novaflow-account-credits]').textContent, '44,128 积分');
  check(strip.querySelector('[data-novaflow-account-logout]').textContent, '退出');
  check(strip.querySelector('[data-novaflow-account-logout]').hidden, false);
  check(strip.querySelector('[data-novaflow-account-login]').hidden, true);
  check(strip.hasAttribute('data-novaflow-account-pending'), false);
  check(doc.getElementById('novaflow-web-account-dialog'), null);
  check(doc.getElementById('novaflow-web-account-button'), null);
  check(appliedPrices.length > 0, true);
  // A layout pass calls seat() again. Even assigning the same textContent
  // creates a browser childList mutation, so count writes rather than only
  // checking that the rendered string still looks right.
  const namePart = strip.querySelector('[data-novaflow-account-name]');
  const creditsPart = strip.querySelector('[data-novaflow-account-credits]');
  const headerWrites = { name: 0, title: 0, credits: 0 };
  for (const [node, property, counter] of [[namePart, 'textContent', 'name'], [namePart, 'title', 'title'], [creditsPart, 'textContent', 'credits']]) {
    let current = node[property];
    Object.defineProperty(node, property, {
      configurable: true, enumerable: true,
      get() { return current; },
      set(value) { headerWrites[counter]++; current = value; }
    });
  }
  for (let pass = 0; pass < 100; pass++) sandbox.NovaFlowWebAccount.seat(doc.querySelector('.nf-brand'));
  check(headerWrites, { name: 0, title: 0, credits: 0 });
  check(version.nextElementSibling, strip);
  balance = 44056;
  await sandbox.NovaFlowWebAccount.refresh();
  check(creditsPart.textContent, '44,056 积分');
  check(headerWrites, { name: 0, title: 0, credits: 1 });
  displayName = 'new-dylan';
  await sandbox.NovaFlowWebAccount.refresh();
  check(namePart.textContent, 'new-dylan');
  check(namePart.title, 'new-dylan');
  check(headerWrites, { name: 1, title: 1, credits: 1 });
  for (let pass = 0; pass < 100; pass++) sandbox.NovaFlowWebAccount.seat(doc.querySelector('.nf-brand'));
  check(headerWrites, { name: 1, title: 1, credits: 1 });
  // Restore the starting account for the charge/refund and remount checks.
  balance = 44128;
  displayName = 'dylan';
  await sandbox.NovaFlowWebAccount.refresh();
  strip.querySelector('[data-novaflow-account-name]').click();
  strip.querySelector('[data-novaflow-account-credits]').click();
  check(doc.getElementById('novaflow-web-account-dialog'), null);
  check(typeof sandbox.NovaFlowWebAccount.open, 'undefined');
  // A layout pass (module switch) drops the strip. seat() puts it back and does not throw.
  strip.remove();
  check(sandbox.NovaFlowWebAccount.seat(), true);
  const restored = version.nextElementSibling;
  check(restored.id, 'novaflow-web-account-header');
  check(restored.querySelector('[data-novaflow-account-name]').textContent, 'dylan');
  check(restored.querySelector('[data-novaflow-account-credits]').textContent, '44,128 积分');
  await sandbox.NovaFlowWebAccount.refresh();
  check(restored.querySelector('[data-novaflow-account-name]').textContent, 'dylan');
  // Charges and refunds reuse the account-details read.
  balance = 40000;
  sandbox.dispatchEvent(new sandbox.CustomEvent('novaflow:account-balance', { detail: { source: 'charge', balance: 40000 } }));
  check(restored.querySelector('[data-novaflow-account-credits]').textContent, '40,000 积分');
  await sandbox.NovaFlowWebAccount.refresh();
  check(restored.querySelector('[data-novaflow-account-credits]').textContent, '40,000 积分');
  balance = 44128;
  sandbox.dispatchEvent(new sandbox.CustomEvent('novaflow:art-generate-credit-updated', { detail: { kind: 'settlement', promptId: 'prompt-1' } }));
  await sandbox.NovaFlowWebAccount.refresh();
  check(restored.querySelector('[data-novaflow-account-credits]').textContent, '44,128 积分');
  balance = 43000;
  for (const fn of sandbox.listeners.message || []) {
    fn({ source: sandbox.__nfRoot, data: { type: 'novaflow-provider-usage-settled', payload: { credits: { balance: 43000 } } } });
  }
  check(restored.querySelector('[data-novaflow-account-credits]').textContent, '43,000 积分');
  await sandbox.NovaFlowWebAccount.refresh();
  check(restored.querySelector('[data-novaflow-account-credits]').textContent, '43,000 积分');
  restored.querySelector('[data-novaflow-account-logout]').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  check(logoutCalls, 1);
  check(reloaded, 1);
  check(doc.getElementById('novaflow-web-account-dialog'), null);
}

{

  const { doc, version } = headerDocument();
  const sandbox = {
    document: doc,
    Intl, Promise, Number, String, Object,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { reload() {} },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    electronAPI: {
      clientAuthStatus: async () => ({ ok: true, result: { authenticated: false } }),
      clientAuthAccountDetails: async () => ({ ok: false, httpStatus: 401, error: '请先登录账号' }),
      clientAuthLogout: async () => ({ ok: true })
    }
  };
  loadAccount(sandbox);
  await sandbox.NovaFlowWebAccount.guard();
  check(sandbox.NovaFlowWebAccount.seat(), true);
  await sandbox.NovaFlowWebAccount.refresh();
  const strip = version.nextElementSibling;
  check(strip.querySelector('[data-novaflow-account-login]').hidden, false);
  check(strip.querySelector('[data-novaflow-account-login]').textContent, '登录');
  check(strip.querySelector('[data-novaflow-account-name]').hidden, true);
  check(strip.querySelector('[data-novaflow-account-credits]').hidden, true);
  check(strip.querySelector('[data-novaflow-account-logout]').hidden, true);
  strip.querySelector('[data-novaflow-account-login]').click();
  await sandbox.NovaFlowWebAccount.guard();
  check(!!doc.getElementById('novaflow-web-login-gate'), true);
  check(doc.getElementById('novaflow-web-account-dialog'), null);
  const gates = doc.body.children.filter((node) => node.id === 'novaflow-web-login-gate');
  check(gates.length, 1);
}

{

  const events = [];
  let taskCost = 0;
  let taskSettled = false;
  const chargeSandbox = createDomSandbox({
    Response, Request, Blob, FormData,
    NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test', authUrl: 'https://account.test' },
    dispatchEvent(event) { events.push(event); return true; },
    fetch: async (url) => {
      const target = String(url);
      if (target.endsWith('/api/client/bootstrap')) {
        return new Response(JSON.stringify({ ok: true, user: { display_name: 'dylan' }, credits: { balance: 10 } }), { status: 200 });
      }
      if (target.includes('/api/client/grok/prompt-optimize')) {
        return new Response(JSON.stringify({ quota: { balance_after: 6 } }), { status: 200 });
      }
      if (target.includes('/api/web/tasks/')) {
        return new Response(JSON.stringify({ task: { id: 'task-1', status: 'processing', charged_credit_cost: taskCost, credit_settled: taskSettled } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  chargeSandbox.localStorage.setItem('novaflow_web_session_v1', JSON.stringify({ token: 'test-token' }));
  runInContext(source, createContext(chargeSandbox));
  events.length = 0;
  await chargeSandbox.electronAPI.clientAuthAccountDetails();
  check(events.filter((event) => event.type === 'novaflow:account-balance').length, 0);
  await chargeSandbox.electronAPI.smartAiPromptOptimize({});
  const charged = events.filter((event) => event.type === 'novaflow:account-balance');
  check(charged.length, 1);
  check(charged[0].detail.balance, 6);
  check(charged[0].detail.source, 'charge');
  events.length = 0;
  await chargeSandbox.NovaFlowWebRuntime.control('GET', '/api/web/tasks/task-1');
  check(events.filter((event) => event.type === 'novaflow:account-balance').length, 0);
  taskCost = 12;
  taskSettled = true;
  await chargeSandbox.NovaFlowWebRuntime.control('GET', '/api/web/tasks/task-1');
  const settled = events.filter((event) => event.type === 'novaflow:account-balance');
  check(settled.length, 1);
  check(settled[0].detail.source, 'task');
  check(settled[0].detail.balance, undefined);
  events.length = 0;
  await chargeSandbox.NovaFlowWebRuntime.control('GET', '/api/web/tasks/task-1');
  check(events.filter((event) => event.type === 'novaflow:account-balance').length, 0);
  taskCost = 0;
  taskSettled = false;
  await chargeSandbox.NovaFlowWebRuntime.control('GET', '/api/web/tasks/task-1');
  const refunded = events.filter((event) => event.type === 'novaflow:account-balance');
  check(refunded.length, 1);
  check(refunded[0].detail.source, 'task');
}

{
  const timers = new Map();
  let nextTimer = 1;
  let refreshes = 0;
  const { doc, version } = headerDocument();
  const listeners = {};
  doc.hidden = false;
  doc.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
  doc.removeEventListener = () => {};
  doc.dispatch = (type) => { for (const fn of listeners[type] || []) fn(); };
  const sandbox = {
    document: doc,
    Intl, Promise, Number, String, Object,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { reload() {} },
    setTimeout: () => 0,
    setInterval(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    addEventListener(type, fn) { (sandbox.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    listeners: {},
    electronAPI: {
      clientAuthStatus: async () => { refreshes += 1; return { ok: true, result: { authenticated: true, user: { display_name: 'dylan' }, credits: { balance: 10 } } }; },
      clientAuthAccountDetails: async () => ({ ok: true, result: { user: { display_name: 'dylan' }, credits: { balance: 10 } } }),
      clientAuthLogout: async () => ({ ok: true })
    }
  };
  loadAccount(sandbox);
  check(sandbox.NovaFlowWebAccount.seat(), true);
  await sandbox.NovaFlowWebAccount.refresh();
  check(version.nextElementSibling.id, 'novaflow-web-account-header');
  const balanceTimers = () => [...timers.values()].filter((timer) => timer.ms === 15000);
  check(balanceTimers().length, 1);
  const beforeHide = refreshes;
  doc.hidden = true;
  doc.dispatch('visibilitychange');
  check(balanceTimers().length, 0);
  check(refreshes, beforeHide);
  doc.hidden = false;
  doc.dispatch('visibilitychange');
  check(balanceTimers().length, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(refreshes > beforeHide, true);
  sandbox.NovaFlowWebAccount.teardown();
  check(balanceTimers().length, 0);
  check([...timers.values()].some((timer) => timer.ms === 500), false);
}

{
  check(/showModal|NovaFlow 账户|novaflow-web-account-title/.test(accountSource), false);
  check(typeof accountSource === 'string' && accountSource.includes('novaflow-web-account-header'), true);
  const brand = await readFile(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
  check(/accountHeader\.seat\(brand\)/.test(brand), true);
  check(/novaflow-web-account-dialog|novaflow-web-account-title|NovaFlowWebAccount\.open|nf-account-card/.test(brand), false);
  const theme = await readFile(new URL('../../renderer/novaflow-ui-theme.css', import.meta.url), 'utf8');
  check(/novaflow-web-account-dialog|novaflow-web-account-title|nf-account-card|nf-account-close/.test(theme), false);
  const rendererDir = fileURLToPath(new URL('../../renderer/', import.meta.url));
  const names = await readdir(rendererDir);
  const leftovers = [];
  for (const name of names) {
    if (!/\.(js|css)$/.test(name) || name === 'novaflow-web-account.js') continue;
    const text = await readFile(new URL('../../renderer/' + name, import.meta.url), 'utf8');
    if (/novaflow-web-account-dialog|novaflow-web-account-button|novaflow-web-account-title|NovaFlowWebAccount\.open|NovaFlowWebAccount\.close|nf-account-card|nf-account-close/.test(text)) {
      leftovers.push(name);
    }
  }
  check(leftovers, []);
  const adminAccountTest = await readFile(new URL('../../admin/tests/art-knowledge-ui.cjs', import.meta.url), 'utf8');
  check(/NovaFlowWebAccount\.open\(/.test(adminAccountTest), false);
}

console.log(checks + ' passed, 0 failed: Web account quota source, header strip, logout and live balance');
