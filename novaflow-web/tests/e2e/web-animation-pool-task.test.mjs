// 动画 on the Web with a pool task (task 4ae696c0, 2026-09-30): leaving the section must not cancel
// it, a cancel must read 任务已中止 rather than 生成失败, and the bar must show the node's own
// percentage, which the node reads from ComfyUI's sampler steps. With 动画 left running, each
// panel's 任务中止 must stop that panel's own task, every time it is pressed.
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

function panel() {
  const state = { job: null, progress: { active: false, value: 0, max: 0, node: '', queueRemaining: 0 } };
  return Object.assign(state, {
    setAiSeqJob: (next) => { state.job = next; },
    setAiSeqComfyProgress: (update) => { state.progress = update(state.progress); }
  });
}

// ---- the page: runtime + capabilities over a control plane that holds this user's tasks
const tasks = new Map();
const cancels = [];
const nextIds = ['anim-task', 'art-task', 'art-task-2', 'fx-task', 'anim-task-2', 'anim-task-3'];
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const RUNNING = ['created', 'queued', 'assigned', 'uploading', 'processing'];
const sandbox = createDomSandbox({ Response, Request, Blob, FormData, AbortSignal, Event,
  NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
  fetch: async (input, init = {}) => {
    const url = new URL(String(input));
    const cancel = /^\/api\/web\/tasks\/([^/]+)\/cancel$/.exec(url.pathname);
    if (cancel) {
      const task = tasks.get(cancel[1]);
      // As the control plane: a task that already ended cannot be cancelled again.
      if (!RUNNING.includes(task.status)) return reply({ ok: false, error: 'illegal transition ' + task.status + ' -> cancelled' }, 409);
      cancels.push(cancel[1]);
      task.status = 'cancelled';
      return reply({ ok: true, task: { ...task } });
    }
    if (url.pathname === '/api/web/tasks' && init.method === 'POST') {
      const id = nextIds.shift();
      tasks.set(id, { id, status: 'processing', progress: 15, progress_note: 'sampling', output_manifest: {} });
      return reply({ task: { ...tasks.get(id) } });
    }
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
const ANIM = 'http://127.0.0.1:8189', ART = 'http://127.0.0.1:8188';
const submit = async (base) => {
  const intent = sandbox.NovaFlowWebRuntime.serverOnly('NovaFlowAiSequenceMiniMaxH3Workflow', 'getWorkflowJson', [{ mode: 'r2v', prompt: 'x' }]);
  return (await (await sandbox.fetch(base + '/prompt', { method: 'POST', body: JSON.stringify({ prompt: JSON.parse(String(intent)) }) })).json()).prompt_id;
};
// The 美工 panel's stop (brand runtime cancelArtGenerateRun), with or without its prompt id.
const artStop = (promptId) => sandbox.electronAPI.runtimeRequestJson({ baseUrl: ART, path: '/interrupt',
  init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(promptId ? { prompt_id: promptId } : {}) } });
const statuses = () => [...tasks.values()].map((t) => t.id + '=' + t.status);
const history = async (id = 'anim-task') => (await (await sandbox.fetch(ANIM + '/history/' + id)).json())[id];

check(await submit(ANIM), 'anim-task');

// 1. Leaving 动画 (brand runtime route exit) and a submit on the other runtime call this to free the
//    desktop sidecar. On the Web it must leave every task running.
const stopped = await sandbox.electronAPI.minimaxH3RuntimeStop({ timeoutMs: 30000, reason: 'primary-route-exit' });
check(stopped.ok, true);
check(stopped.result.cancelled, 0);
check(cancels, [], 'leaving the section cancels nothing');
check(await submit(ART), 'art-task', 'a 美工 run while 动画 keeps going');

// 3. The history entry carries the node's percentage for the bar.
let entry = await history();
check(entry.novaflow.progress, 15);
tasks.get('anim-task').progress = 63;
entry = await history();
check([entry.status.status_str, entry.novaflow.status, entry.novaflow.progress], ['running', 'processing', 63]);

// 2a. 任务中止 in 美工 stops the 美工 run, never the 动画 run still going in the background.
check((await artStop('art-task')).ok, true);
check(cancels, ['art-task'], '美工 stop with its prompt id');
check(statuses(), ['anim-task=processing', 'art-task=cancelled']);
// ...also when a caller names no prompt: the newest run it sent to the same runtime (8188), and a
// second stop in the same session reaches the new run, not the one already cancelled.
check(await submit(ART), 'art-task-2');
check((await artStop()).ok, true);
check(cancels, ['art-task', 'art-task-2'], 'second stop in one session, no prompt id');
check((await artStop()).ok, true, 'nothing left to stop on 8188 is not an error');
check(cancels, ['art-task', 'art-task-2']);
// A task that ended between the panel's last poll and its stop: the stop is done, not failed.
check(await submit(ANIM), 'fx-task');
tasks.get('fx-task').status = 'completed';
check((await sandbox.electronAPI.runtimeRequestJson({ baseUrl: ANIM, path: '/interrupt',
  init: { method: 'POST', body: JSON.stringify({ prompt_id: 'fx-task' }) } })).ok, true);
check(cancels, ['art-task', 'art-task-2'], 'a named task that already ended cancels nothing else');
check(tasks.get('anim-task').status, 'processing');

// 2b. The 动画 stop handler of the prebuilt bundle, run against the runtime: it names its prompt, so
//     it stops the 动画 task and reads 任务已中止.
const bundle = await readFile(new URL('assets/index-BbIa-2NM.js', renderer), 'utf8');
check(patchAiSeqPoolTask(bundle), bundle, 'the shipped bundle carries the pool task patch');
const stopAt = bundle.indexOf('A=async()=>{try{e.aiSeqRunTokenRef.current+=1');
const stopSource = 'return ' + bundle.slice(stopAt + 2, bundle.indexOf('j=async nfH3SubmitOptions', stopAt)).trim().replace(/,$/, '');
const pressAnimStop = (view, promptId) => new Function('e', 'O', 'f', stopSource)(
  Object.assign(view, { aiSeqRunTokenRef: { current: 4 }, aiSeqComfyWsRef: { current: null }, aiSeqComfyPromptIdRef: { current: promptId }, aiComfyBaseUrl: ANIM }),
  async () => ({ ok: true }),
  // The bundle's own fetch path for the H3 runtime, which the runtime's fetch shim answers on the Web.
  async (path, init) => { const res = await sandbox.fetch(ANIM + path, init); return { ok: res.ok, status: res.status, data: await res.json() }; }
)();
check(await submit(ANIM), 'anim-task-2', 'a newer 动画 run on the same runtime');
const animPanel = panel();
await pressAnimStop(animPanel, 'anim-task');
check(cancels, ['art-task', 'art-task-2', 'anim-task'], 'the 动画 stop names its own task');
check([animPanel.job.state, animPanel.job.message], ['done', '任务已中止']);
check(tasks.get('anim-task-2').status, 'processing');
entry = await history();
check([entry.status.status_str, entry.novaflow.status], ['error', 'cancelled']);

// 2c. 任务中止 while a 多参 run still waits for a node to take its reference image (the pool is busy):
//     the stop cancels that run (and no other), and what /prompt answers afterwards - the failed
//     upload wait - does not turn the panel's 任务已中止 into 下发失败 or back into 生成中.
const ref = (await sandbox.electronAPI.runtimeUploadImage({ baseUrl: ANIM, fileName: 'ref1.png', dataBase64: 'iVBORw0KGgo=' })).result.name;
const inertTimeout = sandbox.setTimeout;
sandbox.setTimeout = (fn) => setTimeout(fn, 10); // the runtime polls the task while it waits for a node
const intent3 = sandbox.NovaFlowWebRuntime.serverOnly('NovaFlowAiSequenceMiniMaxH3Workflow', 'getWorkflowJson', [{ mode: 'r2v', prompt: 'x', images: [ref] }]);
const waiting = sandbox.fetch(ANIM + '/prompt', { method: 'POST', body: JSON.stringify({ prompt: JSON.parse(String(intent3)) }) });
while (sandbox.NovaFlowWebRuntime.lastTask?.id !== 'anim-task-3') await new Promise((r) => setTimeout(r, 10));
await sandbox.fetch(ANIM + '/interrupt', { method: 'POST', body: '{}' });
const late = await waiting;
sandbox.setTimeout = inertTimeout;
check(cancels.slice(-1), ['anim-task-3']);
check(tasks.get('anim-task-2').status, 'processing');
const submitAt = bundle.indexOf('let k=await f(`/prompt`');
const afterSubmit = new Function('e', 't', 'f', 'T', 'u', 'return (async()=>{' + bundle.slice(submitAt, bundle.indexOf('let A=String(k?.data?.prompt_id', submitAt)) +
  'e.setAiSeqJob({state:`running`,message:`生成中…`})})()');
const lateReply = { ok: late.ok, status: late.status, data: await late.json() };
check(lateReply.status, 500, 'the runtime still reports the failed upload wait');
const stoppedPanel = panel();
stoppedPanel.job = { state: 'done', message: '任务已中止' };
await afterSubmit(Object.assign(stoppedPanel, { aiSeqRunTokenRef: { current: 5 } }), 4, async () => lateReply, 'c', {});
check(stoppedPanel.job.message, '任务已中止', 'a stopped run ignores its late /prompt answer');
const livePanel = panel();
await afterSubmit(Object.assign(livePanel, { aiSeqRunTokenRef: { current: 4 } }), 4, async () => lateReply, 'c', {});
check([livePanel.job.state, livePanel.job.message.slice(0, 5)], ['error', '下发失败：'], 'a run nobody stopped still reports it');

// ---- the 动画 poll loop in the prebuilt bundle, run on those entries
const tickAt = bundle.indexOf('nfPoolProgress=');
const tick = new Function('o', 'e', 'let ' + bundle.slice(tickAt, bundle.indexOf(',c=e=>{', tickAt)) + ';');
const jobAt = bundle.indexOf('e.setAiSeqJob({state:o?.novaflow?.status===`cancelled`');
const job = new Function('o', 'e', 'f', 'A', bundle.slice(jobAt, bundle.indexOf('}),I=!0;break}', jobAt) + 2));
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
