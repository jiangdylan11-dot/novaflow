import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { createWorker } from '../../worker/src/worker-core.mjs';
import { MATTING_TASK_TYPE } from '../../packages/shared/src/protocol.mjs';

let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
const runtimeSource = await readFile(new URL('../../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
const ts = createRequire(import.meta.url)('../../node_modules/typescript');
const ast = ts.createSourceFile('runtime.js', runtimeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let uploadSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'putTaskInput') uploadSource = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(uploadSource);
let puts = [], grants = 0, failures = 1, failureStatus = 0, retries = [];
const task = { id: 'own-task', status: 'uploading' }, bytes = new Blob(['exact-frame-pack']);
const uploadContext = createContext({
  waitForAssignment: async id => { assert.equal(id, task.id); return task; },
  grantFor: async current => { assert.equal(current, task); return { endpoint: 'https://node-' + (++grants) + '.test', token: 'fixture' }; },
  mimeFor: () => 'application/octet-stream',
  setTimeout: fn => { fn(); },
  fetch: async (url, options) => {
    puts.push({ url, options });
    if (failures-- > 0) {
      if (failureStatus) return { ok: false, status: failureStatus };
      throw new TypeError('Failed to fetch');
    }
    return { ok: true };
  }
});
runInContext(uploadSource, uploadContext);
check(await uploadContext.putTaskInput(task.id, 'frames-0.bin', bytes, null, { retryConnection: true, onRetry: n => retries.push(n) }), task, 'transient upload recovers');
check(puts.length, 2, 'only failed file upload is retried');
check(grants, 2, 'each attempt refreshes the node endpoint and grant');
check(puts.every(p => p.options.body === bytes && p.options.method === 'PUT' && p.url.endsWith('/gw/tasks/own-task/input/frames-0.bin')), true, 'retry keeps identical bytes and task/file');
check(retries, [1], 'retry progress is emitted');
puts = []; failures = 10; failureStatus = 0;
await assert.rejects(uploadContext.putTaskInput(task.id, 'frames-0.bin', bytes, null, { retryConnection: true }), /Failed to fetch/);
check(puts.length, 3, 'network retries are bounded');
puts = []; failures = 10; failureStatus = 403;
await assert.rejects(uploadContext.putTaskInput(task.id, 'frames-0.bin', bytes, null, { retryConnection: true }), /403/);
check(puts.length, 1, 'authorization errors are not retried');

const adapterSource = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');
let cancelPaths = [], cancelFailures = 1, events = [];
const sandbox = createDomSandbox({
  console, atob, btoa, Blob, Response, DecompressionStream,
  setTimeout: fn => { fn(); }, electronAPI: {},
  NovaFlowWebRuntime: {
    control: async (method, path) => {
      if (path.endsWith('/cancel')) {
        cancelPaths.push(path);
        if (cancelFailures-- > 0) throw new TypeError('Failed to fetch');
        return { ok: true };
      }
      return { task: { id: 'own-task' } };
    },
    putTaskInput: async () => { throw new TypeError('Failed to fetch'); }
  }
});
runInContext(adapterSource, createContext(sandbox));
sandbox.electronAPI.onAiSeqRembgBatchProgress(event => events.push(event));
const payload = { kind: 'video', jobId: 'own-job', rendererFrameWidth: 16, rendererFrameHeight: 16, fps: 16, totalFrames: 1,
  rendererDecodedFrames: [{ decodedFrameIndex: 0, mediaTime: 0, bytes: new Uint8Array([1, 2, 3]) }] };
let result = await sandbox.electronAPI.aiSeqRembgBatch(payload);
check(result.ok, false, 'upload failure is reported');
check(result.error.includes('上传视频帧失败'), true, 'error identifies the failed stage');
check(cancelPaths, ['/api/web/tasks/own-task/cancel', '/api/web/tasks/own-task/cancel'], 'failed cancellation retries only this task');
check(events.at(-1).state, 'error', 'progress terminates on failure');
check(result.error.includes('取消尚未确认'), false, 'confirmed cancellation does not show an unconfirmed warning');
cancelPaths = []; cancelFailures = 10;
result = await sandbox.electronAPI.aiSeqRembgBatch(payload);
check(cancelPaths.length, 3, 'cancellation retries are bounded');
check(result.error.includes('任务取消尚未确认'), true, 'unconfirmed cancellation is visible');

// Real worker queue and HTTP control plane: the browser cancels after the
// initial upload status, while no frames arrive at the gateway.
const queued = [{ id: 'cancel-during-upload', task_type: MATTING_TASK_TYPE,
  parameters: { references: [{ name: 'frames-0.bin', kind: 'frames', bytes: 11 }] } }];
const heartbeats = [], progressIds = [];
let cancelledAt = 0, probes = 0;
const control = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text || '{}');
  const send = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
  if (req.url === '/api/worker/register') return send({ workerToken: 'fixture', grantKey: 'fixture-grant-key-long-enough' });
  if (req.url === '/api/worker/claim') return send({ task: queued.shift() || null });
  if (req.url.endsWith('/progress')) {
    progressIds.push(req.url);
    if (!cancelledAt) { cancelledAt = Date.now(); return send({ ok: true }); }
    probes++; res.statusCode = 409; return send({ error: 'task is already cancelled' });
  }
  if (req.url === '/api/worker/heartbeat') heartbeats.push(body);
  return send({ ok: true });
});
const comfy = createServer((req, res) => { res.statusCode = 404; res.end('{}'); });
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return 'http://127.0.0.1:' + server.address().port; };
const dataDir = await mkdtemp(join(tmpdir(), 'novaflow-cutout-cancel-'));
const worker = createWorker({ controlUrl: await listen(control), dataDir, configPath: join(dataDir, 'identity.json'),
  workflowDir: dataDir, modelsRoot: dataDir, comfyImageUrl: await listen(comfy), gatewayPort: 0,
  gatewayHost: '127.0.0.1', tunnel: false, pollIntervalMs: 30, logger: () => {} });
try {
  await worker.start();
  const deadline = Date.now() + 7000;
  while (!(probes && !worker.getState().currentTaskId && heartbeats.some(h => h.status === 'idle' && h.current_task_id === null))) {
    if (Date.now() > deadline) throw new Error('cancelled upload did not release worker in 7 seconds');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const elapsed = Date.now() - cancelledAt;
  check(elapsed < 6000, true, 'remote cancellation releases worker without waiting for the 120-second upload timeout');
  check(worker.getState().status, 'idle', 'worker becomes idle');
  check(worker.getState().currentTaskId, null, 'active task is cleared');
  check(progressIds.every(path => path.includes('/cancel-during-upload/')), true, 'cancellation probe targets only the active task');
  check(heartbeats.some(h => h.status === 'idle' && h.current_task_id === null), true, 'idle heartbeat clears the control-plane busy state');
  console.log('cutout-transfer-recovery: ' + checks + ' passed; cancelled upload released in ' + elapsed + ' ms');
} finally {
  await worker.stop();
  await Promise.all([new Promise(resolve => control.close(resolve)), new Promise(resolve => comfy.close(resolve))]);
  await rm(dataDir, { recursive: true, force: true });
}
