// Verify the Web account dialog reads quota data from the account service.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
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
console.log(checks + ' passed, 0 failed: Web account quota source, errors and session preservation');
