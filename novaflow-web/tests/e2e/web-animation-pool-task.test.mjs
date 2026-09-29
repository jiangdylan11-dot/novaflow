// 动画 on the Web with a pool task (task 4ae696c0, 2026-09-30): leaving the section must not cancel
// it, a cancel must read 任务已中止 rather than 生成失败, and the bar must show the node's own
// percentage, which the node reads from ComfyUI's sampler steps.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { createComfyClient } from '../../worker/src/comfy/comfy-client.mjs';
import { patchAiSeqPoolTask } from '../../../scripts/patch-ai-seq-pool-task.mjs';

const renderer = new URL('../../renderer/', import.meta.url);
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

// ---- the page: runtime + capabilities over a control plane with two running tasks of this user
const tasks = new Map([
  ['anim-task', { id: 'anim-task', status: 'processing', progress: 15, progress_note: 'sampling', output_manifest: {} }],
  ['art-task', { id: 'art-task', status: 'processing', progress: 40, progress_note: 'sampling', output_manifest: {} }]
]);
const cancels = [];
const reply = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const sandbox = createDomSandbox({ Response, Request, Blob, FormData, AbortSignal, Event,
  NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
  fetch: async (input, init = {}) => {
    const url = new URL(String(input));
    const cancel = /^\/api\/web\/tasks\/([^/]+)\/cancel$/.exec(url.pathname);
    if (cancel) { cancels.push(cancel[1]); tasks.get(cancel[1]).status = 'cancelled'; return reply({ ok: true }); }
    if (url.pathname === '/api/web/tasks' && init.method === 'POST') return reply({ task: { ...tasks.get('anim-task') } });
    if (url.pathname === '/api/web/tasks') return reply({ tasks: [...tasks.values()].map((t) => ({ ...t })) });
    const one = /^\/api\/web\/tasks\/([^/]+)$/.exec(url.pathname);
    if (one) return reply({ task: { ...tasks.get(one[1]) } });
    throw new Error('unexpected request ' + url);
  }
});
sandbox.localStorage.setItem('novaflow_web_session_v1', JSON.stringify({ token: 'session' }));
const context = createContext(sandbox);
runInContext(await readFile(new URL('novaflow-web-runtime.js', renderer), 'utf8'), context);
runInContext(await readFile(new URL('novaflow-web-capabilities.js', renderer), 'utf8'), context);
const intent = sandbox.NovaFlowWebRuntime.serverOnly('NovaFlowAiSequenceMiniMaxH3Workflow', 'getWorkflowJson', [{ mode: 'r2v', prompt: 'x' }]);
const submitted = await (await sandbox.fetch('http://127.0.0.1:8189/prompt', { method: 'POST', body: JSON.stringify({ prompt: JSON.parse(String(intent)) }) })).json();
check(submitted.prompt_id, 'anim-task');
const history = async () => (await (await sandbox.fetch('http://127.0.0.1:8189/history/anim-task')).json())['anim-task'];

// 1. Leaving 动画 (brand runtime route exit) and a submit on the other runtime call this to free the
//    desktop sidecar. On the Web it must leave every task running.
const stopped = await sandbox.electronAPI.minimaxH3RuntimeStop({ timeoutMs: 30000, reason: 'primary-route-exit' });
check(stopped.ok, true);
check(stopped.result.cancelled, 0);
check(cancels, [], 'leaving the section cancels nothing');
check([...tasks.values()].map((t) => t.status), ['processing', 'processing']);

// 3. The history entry carries the node's percentage for the bar.
let entry = await history();
check(entry.novaflow.progress, 15);
tasks.get('anim-task').progress = 63;
entry = await history();
check([entry.status.status_str, entry.novaflow.status, entry.novaflow.progress], ['running', 'processing', 63]);

// 2. 任务中止 still cancels this panel's task (only it), and the entry says it was a cancel.
await sandbox.fetch('http://127.0.0.1:8189/interrupt', { method: 'POST' });
check(cancels, ['anim-task']);
entry = await history();
check([entry.status.status_str, entry.novaflow.status], ['error', 'cancelled']);

// ---- the 动画 poll loop in the prebuilt bundle, run on those entries
const bundle = await readFile(new URL('assets/index-BbIa-2NM.js', renderer), 'utf8');
check(patchAiSeqPoolTask(bundle), bundle, 'the shipped bundle carries the pool task patch');
const tickAt = bundle.indexOf('nfPoolProgress=');
const tick = new Function('o', 'e', 'let ' + bundle.slice(tickAt, bundle.indexOf(',c=e=>{', tickAt)) + ';');
const jobAt = bundle.indexOf('e.setAiSeqJob({state:o?.novaflow?.status===`cancelled`');
const job = new Function('o', 'e', 'f', 'A', bundle.slice(jobAt, bundle.indexOf('}),I=!0;break}', jobAt) + 2));
const panel = () => {
  const state = { job: null, progress: { active: false, value: 0, max: 0, node: '', queueRemaining: 0 } };
  return Object.assign(state, {
    setAiSeqJob: (next) => { state.job = next; },
    setAiSeqComfyProgress: (update) => { state.progress = update(state.progress); }
  });
};
let view = panel();
tick({ status: { status_str: 'running' }, novaflow: { status: 'processing', progress: 63 } }, view);
check([view.progress.active, view.progress.value, view.progress.max], [true, 63, 100], 'the bar shows 63%');
view = panel();
tick({ status: { status_str: 'running' } }, view);
check(view.progress.max, 0, 'a ComfyUI entry leaves the websocket-fed bar alone');
view = panel();
job(entry, view, 'error', 'anim-task');
check([view.job.state, view.job.message], ['done', '任务已中止']);
view = panel();
job({ status: { status_str: 'error' }, novaflow: { status: 'failed' } }, view, 'error', 'anim-task');
check([view.job.state, view.job.message], ['error', '生成失败且未发现输出文件（请检查工作流执行日志）']);
view = panel();
job({ status: { status_str: 'error' } }, view, 'error', 'p1');
check([view.job.state, view.job.message], ['error', '生成失败且未发现输出文件（请检查工作流执行日志）'], 'desktop wording unchanged');

// ---- the node: sampler steps from ComfyUI's websocket become the reported percentage
const frame = (text) => {
  const payload = Buffer.from(text);
  const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([head, payload]);
};
const script = [
  { type: 'status', data: { status: { exec_info: { queue_remaining: 1 } } } },
  { type: 'progress', data: { value: 1, max: 1, prompt_id: 'p1', node: '4' } },
  { type: 'progress', data: { value: 1, max: 4, prompt_id: 'p1', node: '10', pad: 'x'.repeat(200) } },
  { type: 'progress', data: { value: 9, max: 10, prompt_id: 'other', node: '10' } },
  { type: 'progress', data: { value: 2, max: 4, prompt_id: 'p1', node: '10' } },
  { type: 'progress', data: { value: 4, max: 4, prompt_id: 'p1', node: '10' } },
  { type: 'progress', data: { value: 0, max: 2, prompt_id: 'p1', node: '11' } }
];
let socket = null, sent = 0, polls = 0, clientId = '';
const comfy = createServer((req, res) => {
  const path = req.url.split('?')[0];
  res.setHeader('content-type', 'application/json');
  if (path === '/prompt') return res.end(JSON.stringify({ prompt_id: 'p1' }));
  if (path === '/history/p1') {
    // Done one poll after the last message, or after 25 polls when nobody listens.
    const done = (sent >= script.length && polls > sent) || polls > 25;
    return res.end(JSON.stringify(done ? { p1: { status: { completed: true, status_str: 'success' }, outputs: {} } } : {}));
  }
  if (path === '/queue') {
    // One scripted message per poll, each behind a binary preview frame the node must skip.
    polls += 1;
    if (socket && sent < script.length) socket.write(Buffer.concat([Buffer.from([0x82, 3, 1, 2, 3]), frame(JSON.stringify(script[sent++]))]));
    return res.end(JSON.stringify({ queue_running: [[0, 'p1']], queue_pending: [] }));
  }
  res.statusCode = 404; res.end('{}');
});
comfy.on('upgrade', (req, upgraded) => {
  clientId = new URL(req.url, 'http://x').searchParams.get('clientId');
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  upgraded.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket = upgraded;
  upgraded.on('error', () => {});
});
await new Promise((resolve) => comfy.listen(0, '127.0.0.1', resolve));
const client = createComfyClient({ baseUrl: 'http://127.0.0.1:' + comfy.address().port });
const promptId = await client.queuePrompt({
  4: { class_type: 'NovaFlowH3PrepareReferenceImage', inputs: { image: ['3', 0] } },
  7: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
  10: { class_type: 'SamplerCustomAdvanced', inputs: { sampler: ['7', 0], latent_image: ['5', 1] } },
  11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0] } }
});
const reported = [];
await client.waitForPrompt(promptId, { pollMs: 40, onProgress: (pct, note) => { reported.push([pct, note]); } });
check(clientId, client.clientId, 'the node listens as the client that queued the prompt');
check(reported.map(([pct]) => pct), [15, 34, 53, 90, 100], 'steps of the sampling node, never another node or prompt');
check(reported.at(-2)[1], 'decoding');
// The node hangs up once the prompt is done (a socket left open would hang this test).
await new Promise((resolve) => (socket.readableEnded ? resolve() : socket.once('end', resolve)));
socket.destroy();
await new Promise((resolve) => comfy.close(resolve));

console.log(checks + ' passed, 0 failed: 动画 pool task survives leaving the section, cancel reads 任务已中止, node progress reaches the bar');
