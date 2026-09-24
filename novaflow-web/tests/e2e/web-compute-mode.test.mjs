import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
const source = await readFile(new URL('../../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
let checks = 0;
const check = (a, b) => { assert.equal(a, b); checks++; };
const requests = [];
let rejectLocal = false;
const pair = 'a'.repeat(64);
const storage = new Map();
const sandbox = createDomSandbox({ Response, Request, Blob, FormData, AbortSignal, Event,
  location: { hash: '#local-pair=' + pair, pathname: '/', search: '' },
  history: { replaceState() {} },
  sessionStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
  NOVAFLOW_WEB_CONFIG: { localAssistant: true, localOrigin: 'http://127.0.0.1:4784', controlUrl: 'https://control.test' },
  fetch: async (url, init) => {
    requests.push({ url: String(url), init });
    const error = rejectLocal && String(url).startsWith('http://127.0.0.1:4784');
    return new Response(JSON.stringify(error ? { error: 'local unavailable' } : String(url).endsWith('/tasks') ? { task: { id: 'private-task', status: 'queued' } } : {}), { status: error ? 503 : 200 });
  }
});
sandbox.localStorage.setItem('novaflow_web_session_v1', JSON.stringify({ token: 'cloud-session' }));
runInContext(source, createContext(sandbox));
const runtime = sandbox.NovaFlowWebRuntime;
check(runtime.computeMode, 'local');
await runtime.control('GET', '/api/web/capabilities');
check(requests.at(-1).url, 'http://127.0.0.1:4784/api/web/capabilities');
check(requests.at(-1).init.headers['x-novaflow-local'], pair);
check(requests.at(-1).init.headers.Authorization, undefined);
await runtime.control('POST', '/api/web/tasks', {});
check(runtime.setComputeMode, undefined);
await runtime.control('GET', '/api/web/me');
check(requests.at(-1).url, 'https://control.test/api/web/me');
check(requests.at(-1).init.headers['x-novaflow-local'], undefined);
await runtime.control('POST', '/api/web/tasks/private-task/grant', { op: 'download' });
check(requests.at(-1).url, 'http://127.0.0.1:4784/api/web/tasks/private-task/grant');
const before = requests.length; rejectLocal = true;
await assert.rejects(runtime.control('POST', '/api/web/tasks', {}), /local unavailable/); checks++;
check(requests.length, before + 1);
check(requests.at(-1).url.startsWith('http://127.0.0.1:4784'), true);
const cloud = createDomSandbox({ Response, Request, Blob, FormData, AbortSignal, Event,
  NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
  fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response('{}'); }
});
cloud.localStorage.setItem('novaflow_web_session_v1', JSON.stringify({ token: 'cloud-session' }));
runInContext(source, createContext(cloud));
check(cloud.NovaFlowWebRuntime.computeMode, 'shared');
check(cloud.NovaFlowWebRuntime.setComputeMode, undefined);
await cloud.NovaFlowWebRuntime.control('POST', '/api/web/tasks', {});
check(requests.at(-1).url, 'https://control.test/api/web/tasks');
check(requests.at(-1).init.headers['x-novaflow-local'], undefined);
// Pinning a pool node: every task names it, capabilities ask about it alone, the
// pin survives a reload, and clearing it goes back to the whole pool.
const studio = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
cloud.NovaFlowWebRuntime.setComputeNode({ id: studio, name: 'studio-5090' });
check(cloud.NovaFlowWebRuntime.computeNode.id, studio);
check(cloud.NovaFlowWebRuntime.computeNode.name, 'studio-5090');
await cloud.NovaFlowWebRuntime.control('POST', '/api/web/tasks', { task_type: 'qwen_t2i' });
check(JSON.parse(requests.at(-1).init.body).target_worker_id, studio);
await cloud.NovaFlowWebRuntime.control('GET', '/api/web/capabilities');
check(requests.at(-1).url, 'https://control.test/api/web/capabilities?worker=' + studio);
check(JSON.parse(cloud.localStorage.getItem('novaflow.web.compute.node.v1')).id, studio);
check(cloud.NovaFlowWebRuntime.setComputeNode({ id: 'not-a-node', name: 'x' }), null); // a bad id clears the pin
await cloud.NovaFlowWebRuntime.control('POST', '/api/web/tasks', {});
check(JSON.parse(requests.at(-1).init.body).target_worker_id, undefined);
// The page the local assistant opened pins a remote node the same way: its tasks then
// leave the machine, and clearing the pin brings them back.
const friend = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
rejectLocal = false;
runtime.setComputeNode({ id: friend, name: 'friend-4090' });
check(runtime.computeMode, 'shared');
await runtime.control('POST', '/api/web/tasks', {});
check(requests.at(-1).url, 'https://control.test/api/web/tasks');
check(JSON.parse(requests.at(-1).init.body).target_worker_id, friend);
check(requests.at(-1).init.headers.Authorization, 'Bearer cloud-session');
runtime.setComputeNode(null);
check(runtime.computeMode, 'local');
await runtime.control('POST', '/api/web/tasks', {});
check(requests.at(-1).url, 'http://127.0.0.1:4784/api/web/tasks');
// Only an explicit server shutdown closes the local browser editor.
let onLoad, closeCalls = 0;
const closing = createDomSandbox({ Response, Request, Blob, FormData, AbortSignal, Event, TextDecoder,
  NOVAFLOW_WEB_CONFIG: { localAssistant: true, localOrigin: 'http://127.0.0.1:4784' },
  addEventListener: (name, fn) => { if (name === 'load') onLoad = fn; },
  close: () => { closeCalls++; },
  fetch: async () => new Response('data: ready\n\ndata: closed\n\n')
});
runInContext(source, createContext(closing));
await onLoad();
check(closeCalls, 1);
closing.fetch = async () => { throw new Error('temporary connection failure'); };
await onLoad();
check(closeCalls, 1);
console.log(checks + ' passed, 0 failed: browser compute routing and private task isolation');
