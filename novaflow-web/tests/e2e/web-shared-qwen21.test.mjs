import { approveComputeWorker } from '../helpers.mjs';
// The website (shared pool) draws and designs UI on Qwen-Image-2.1 exactly when a node that can build
// it is online: the node reports the model, the control plane queues 2.1 runs for that model and says
// so in its capabilities, the 2.1 LoRA list comes from those nodes, and the page asks the pool. While
// nobody is online the page keeps the 2.1 layout, as the local assistant shows it; only a drawing
// node without 2.1 switches it to the 2511 layout.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import { workflowModelId, QWEN21_EDIT_LORA_CAPABILITY } from '../../packages/shared/src/workflow-modules.mjs';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { createWorker } from '../../worker/src/worker-core.mjs';

let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const M = 'novaflow-brand-runtime';
const run = (state, options = {}, provider = 'local') =>
  ({ __args: [provider, 'txt2img', [], 'NovaFlow', 'prompt', '', 'client', [], state, undefined, options] });

// ---- the model a run is queued for: the conditions the node builds 2.1 under -------------------
// One 2.1 line since 2026-11-06: every 2.1 run is queued for the Turbo model.
equal(workflowModelId(M, run({ localDrawEngine: 'qwen-2.1' })), 'qwen-image-2.1-turbo');
equal(workflowModelId(M, run({ localUiEngine: 'qwen-2.1' }, { taskProfile: 'ui-design' })), 'qwen-image-2.1-turbo');
equal(workflowModelId(M, run({ localUiEngine: 'qwen-2.1', localQwen21Variant: 'turbo' }, { taskProfile: 'ui-design' })), 'qwen-image-2.1-turbo');
equal(workflowModelId(M, run({ localDrawEngine: 'qwen-2.1', localQwen21Variant: 'turbo' })), 'qwen-image-2.1-turbo');
equal(workflowModelId(M, run({})), 'qwen-image-2.1-turbo');
equal(workflowModelId(M, run({ nsfw: true })), 'qwen-image-2.1-turbo');
equal(workflowModelId(M, run({ localDrawEngine: 'qwen-2.1' }, { taskProfile: 'ui-design' })), 'qwen-image-2.1-turbo');
equal(workflowModelId(M, run({ localUiEngine: 'qwen-2.1' })), 'qwen-image-2.1-turbo');
equal(workflowModelId('spine-split-runtime', run({ localDrawEngine: 'qwen-2.1' })), 'qwen-image-2.1-turbo');

// ---- control plane ------------------------------------------------------------------------------
const lora = (qwen21) => ({ version: 1, updated_at: new Date().toISOString(),
  qwen: { ok: true, items: [{ name: 'qwen/style.safetensors' }] }, qwen_nsfw: { ok: true, items: [] },
  qwen21: { ok: true, items: qwen21.map((name) => ({ name })) } });
const ctx = await startLocalControlPlane({ port: 0 });
async function request(path, method = 'GET', body, token) {
  const res = await fetch(ctx.url + path, { method, headers: { 'content-type': 'application/json',
    ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
try {
  const token = (await request('/dev/login', 'POST', { email: 'qwen21@novaflow.local', balance: 0 })).body.session.token;
  async function node(name, models) {
    const reg = await request('/api/worker/register', 'POST', { worker_id: crypto.randomUUID(), worker_name: name,
      worker_secret: generateWorkerSecret(), hardware: { vram_mb: 16376 } }, token);
    await approveComputeWorker(ctx.db,reg.body.worker.id);
    await request('/api/worker/models', 'POST', { models }, reg.body.workerToken);
    return reg.body.workerToken;
  }
  const claim = async (wt) => {
    await request('/api/worker/heartbeat', 'POST', { status: 'idle' }, wt);
    return (await request('/api/worker/claim', 'POST', {}, wt)).body.task;
  };
  const create = (parameters) => request('/api/web/tasks', 'POST', { task_type: 'renderer_workflow',
    workflow: { module: M, method: 'buildArtGenerateRunWorkflow' }, parameters }, token);

  // The shared-mode page asks the pool on load; an empty pool keeps the 2.1 layout.
  const sandbox = createDomSandbox({ Response, Request, Blob, FormData, NOVAFLOW_WEB_CONFIG: { controlUrl: ctx.url }, fetch });
  sandbox.localStorage.setItem('novaflow_web_session_v1', JSON.stringify({ token }));
  runInContext(await readFile(new URL('../../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8'), createContext(sandbox));
  equal(sandbox.NovaFlowWebRuntime.computeMode, 'shared');
  equal(sandbox.electronAPI.runtimeFeaturesSync().qwenImage21, true);
  equal((await request('/api/web/capabilities')).body.features.qwenImage21, false);
  equal((await sandbox.electronAPI.runtimeFeatures()).qwenImage21, true);

  // A node that still reports the retired model changes nothing: the page stays on 2.1.
  const older = await node('2511', [{ model_id: 'qwen-image-2511', status: 'ready', detail: { lora_catalog: lora([]) } }]);
  equal((await request('/api/web/capabilities')).body.features.qwenImage21, false);
  equal((await sandbox.electronAPI.runtimeFeatures()).qwenImage21, true);
  const task21 = await create(run({ localDrawEngine: 'qwen-2.1' }));
  equal(task21.body.capableWorkers, 0);
  equal(await claim(older), null);

  // Since 2026-11-06 a 2.1 node reports both ids for the same INT8 Turbo files, and every 2.1 run is
  // queued for the Turbo model.
  const newer = await node('2.1', ['qwen-image-2.1', 'qwen-image-2.1-turbo'].map((model_id) =>
    ({ model_id, status: 'ready', detail: { lora_catalog: lora(['qwen/q21.safetensors']) } })));
  const caps = (await request('/api/web/capabilities')).body;
  equal(caps.features.qwenImage21, true);
  const claimed = await claim(newer);
  equal([claimed.id, claimed.model_id], [task21.body.task.id, 'qwen-image-2.1-turbo']);
  const fallback = await create(run({}));
  equal(fallback.body.task.model_id, 'qwen-image-2.1-turbo');
  equal(await claim(older), null);
  const turbo = await node('turbo', [{ model_id: 'qwen-image-2.1-turbo', status: 'ready' }]);
  await request('/api/worker/heartbeat', 'POST', { status: 'idle' }, turbo);
  equal((await claim(turbo)).id, fallback.body.task.id);

  // Turbo alone does not prove that an older worker understands the new
  // editing switch: it must never claim a request carrying that switch.
  const oldTurbo = await node('old turbo', [{ model_id: 'qwen-image-2.1-turbo', status: 'ready' }]);
  await request('/api/worker/heartbeat', 'POST', { status: 'idle' }, oldTurbo);
  const newEdit = () => request('/api/web/tasks', 'POST', { task_type: 'renderer_workflow',
    workflow: { module: 'spine-split-runtime', method: 'defaultQwenLoraInpaintWorkflow' },
    parameters: { __args: ['', 'source.png', 'mask.png', 'test', 'edit', { inpaintMode: 'edit', inpaintProvider: true }] } }, token);
  const unavailable = await newEdit();
  equal(unavailable.status, 409);
  assert.match(String(unavailable.body.error?.message || unavailable.body.message || unavailable.body.error), /LoRA/);
  const legacy = await request('/api/web/tasks', 'POST', { task_type: 'renderer_workflow',
    workflow: { module: 'spine-split-runtime', method: 'defaultQwenInpaintWorkflow' },
    parameters: { __args: ['', 'source.png', 'mask.png', 'test', 'edit', { inpaintMode: 'edit', inpaintProvider: true }] } }, token);
  equal(legacy.status, 400);
  assert.match(String(legacy.body.error?.message || legacy.body.message || legacy.body.error), /退役/);
  const capable = await node('new editor', [{ model_id: QWEN21_EDIT_LORA_CAPABILITY, status: 'ready' }]);
  await request('/api/worker/heartbeat', 'POST', { status: 'idle' }, capable);
  const editTask = await newEdit();
  equal(editTask.status, 200);
  equal(editTask.body.task.model_id, QWEN21_EDIT_LORA_CAPABILITY);
  equal(await claim(oldTurbo), null);
  equal((await claim(capable)).id, editTask.body.task.id);

  equal((await request('/api/web/loras/qwen?nsfw=false&engine=qwen-2.1', 'GET', undefined, token)).body.items,
    [{ name: 'qwen/q21.safetensors' }]);
  equal((await request('/api/web/loras/qwen?nsfw=false', 'GET', undefined, token)).status, 400);

  // With the 2.1 node online the page is back on 2.1 and gets the 2.1 LoRA list.
  equal((await sandbox.electronAPI.runtimeFeatures()).qwenImage21, true);
  equal((await sandbox.electronAPI.qwenLoraCatalog({ nsfw: false, engine: 'qwen-2.1' })).items, [{ name: 'qwen/q21.safetensors' }]);
} finally {
  await new Promise((resolve) => ctx.server.close(resolve));
  await ctx.db.close();
}

// ---- the node reports 2.1 when it can build the graph --------------------------------------------
const io = (...names) => Object.fromEntries(names.map((name) => [name, ['*']]));
const qwen21Nodes = {
  UNETLoader: { input: { required: { unet_name: [['Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors']], weight_dtype: [['default']] } } },
  ManualSigmas: { input: { required: io('sigmas') } },
  SamplerCustom: { input: { required: io('model', 'sigmas') } },
  KSamplerSelect: { input: { required: io('sampler_name') } },
  CLIPLoader: { input: { required: { clip_name: [['qwen3vl_8b_bf16_heretic.safetensors']], type: [['qwen_image']] } } },
  VAELoader: { input: { required: { vae_name: [['qwen_image_2.1_vae_bf16.safetensors']] } } },
  TextEncodeQwenImage21: { input: { required: io('clip', 'prompt') } },
  EmptyLatentImage: { input: { required: io('width', 'height', 'batch_size') } },
  SplitImageWithAlpha: { input: { required: io('image') } },
  ImageScale: { input: { required: io('image', 'width', 'height') } },
  ImageCrop: { input: { required: io('image', 'width', 'height', 'x', 'y') } }
};
let nodes = qwen21Nodes;
const reports = [];
const servers = [];
async function serve(kind) {
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let result = {};
    if (kind === 'control') {
      if (req.url === '/api/worker/register') result = { workerToken: 'fixture-token', grantKey: 'fixture-key' };
      if (req.url === '/api/worker/models') reports.push(JSON.parse(Buffer.concat(chunks).toString()).models);
    } else if (req.url === '/system_stats') result = { system: {}, devices: [] };
    else {
      const node = decodeURIComponent(req.url.split('/object_info/')[1] || '');
      result = nodes[node] ? { [node]: nodes[node] } : {};
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return 'http://127.0.0.1:' + server.address().port;
}
const dir = await mkdtemp(join(tmpdir(), 'nf-shared-qwen21-'));
const worker = createWorker({ controlUrl: await serve('control'), comfyImageUrl: await serve('image'),
  comfyVideoUrl: 'http://127.0.0.1:9', dataDir: dir, configPath: join(dir, 'identity.json'),
  gatewayPort: 0, gatewayHost: '127.0.0.1', tunnel: false, workflowDir: '', pollIntervalMs: 60000, logger() {} });
const reported = () => reports.at(-1).find((model) => model.model_id === 'qwen-image-2.1');
try {
  await worker.start();
  equal(reported().status, 'ready');
  equal(worker.getState().features.qwenImage21, true);
  nodes = { ...qwen21Nodes, TextEncodeQwenImage21: undefined };
  await worker.reportModels();
  equal([reported().status, reported().detail.reason], ['missing', 'qwen_image_21_unavailable']);
  equal(worker.getState().features.qwenImage21, false);
} finally {
  await worker.stop();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(dir, { recursive: true, force: true });
}

console.log(checks + ' passed, 0 failed: the shared pool routes Qwen-Image-2.1 runs to nodes that report it');
