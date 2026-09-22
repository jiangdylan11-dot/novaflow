// Verify the Web account dialog reads quota data from the account service.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';

const source = await readFile(new URL('../../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
let checks = 0, status = 200;
const requests = [];
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const profile = { ok: true, credits: { balance: 5000.125 }, providerQuotas: { grok: { status: 'connected', remaining_count: 12, allocated_count: 30 } } };
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
check(account.result.providerQuotas.grok.remaining_count, 12);
check(account.result.providerQuotas.grok.allocated_count, 30);
check(requests[0].url, 'https://account.test/api/client/bootstrap');
check(requests[0].init.method, 'GET');
check(requests[0].init.headers.Authorization, 'Bearer test-token');
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
console.log(checks + ' passed, 0 failed: Web account quota source, errors and session preservation');
