// NovaFlow GPU Worker - core loop.
//
// Lifecycle:
//   load/create identity -> register -> report models -> heartbeat forever
//                                                     -> claim -> run -> report
//
// Everything the worker is allowed to do is scoped to itself and to the task
// currently assigned to it (spec 8). It holds no Supabase key, no Grok key and
// no admin token; its only credential is its own worker secret.

import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createGateway, sweepTaskFiles } from './gateway/gateway.mjs';
import { createTunnel } from './tunnel.mjs';
import { createComfyClient, collectOutputs, assertLocalOnly } from './comfy/comfy-client.mjs';
import { videoRuntimeUrl } from './runtime-services.mjs';
import { loadWorkflow, buildGraph, resolvedSeed, videoFrameLength } from './comfy/workflow-runner.mjs';
import { createWorkflowHost } from './comfy/workflow-host.mjs';
import { workflowModule } from '../../packages/shared/src/workflow-modules.mjs';
import { inspectAllModels, inspectViaComfy, detectQwenImage21 } from './models/model-manager.mjs';
import { createWorkerLoraCatalog } from './models/lora-catalog.mjs';
import { MODEL_MANIFEST, QWEN21_MODEL_ID, runtimeFor } from '../../packages/shared/src/model-manifest.mjs';
import { detectGpu, detectSystem } from './hardware.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import {
  HEARTBEAT_INTERVAL_SECONDS,
  MATTING_TASK_TYPE,
  PROMPT_ASSISTANT_MODEL_ID,
  PROMPT_ASSISTANT_REQUEST_FILE,
  PROMPT_ASSISTANT_RESULT_FILE,
  PROMPT_ASSISTANT_TASK_TYPE,
  TASK_STATE,
  TTL_SECONDS,
  isSafeFilename,
  requirementsFor
} from '../../packages/shared/src/protocol.mjs';
import { runMatting, probeMatting } from './matting.mjs';

// Read from package.json, which is also what electron-builder stamps into the
// installer. Two hand-maintained version constants had already drifted apart
// (0.2.0 here, 0.1.0 there) and neither moved when the gateway was fixed - so
// "is this the build with the fix?" had no answer you could see.
export const WORKER_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return String(JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version || '0.0.0');
  } catch {
    return '0.0.0';
  }
})();

/**
 * Point the renderer's recorded options at the files that actually landed in
 * ComfyUI's input folder. The renderer named them before upload; the worker
 * renamed them to keep one task's inputs out of another's way.
 *
 * A positional builder names its inputs wherever its signature puts them: a
 * bare argument (inpaint image and mask), an object of named uploads (万物迁移),
 * an array (the art builder). Every string equal to a reference name is
 * replaced, wherever it sits; assertGraphLoadsTaskInputs then checks the graph
 * itself reads nothing but this task's files.
 */
export function withReferences(parameters, filenames, references = [], method = '') {
  const rename = (value) => {
    if (typeof value === 'string') {
      const found = references.findIndex((ref) => ref.name === value);
      return found >= 0 && filenames[found] ? filenames[found] : value;
    }
    if (Array.isArray(value)) return value.map(rename);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = rename(item);
      return out;
    }
    return value;
  };
  if (Array.isArray(parameters.__args)) {
    const args = structuredClone(parameters.__args);
    if (method === 'buildArtGenerateRunWorkflow') {
      args[2] = (args[2] || []).map((name) => {
        const found = references.findIndex((ref) => ref.name === name);
        if (found < 0 || !filenames[found]) throw new Error('workflow input is not an uploaded task reference');
        return filenames[found];
      });
      return { ...parameters, __args: args };
    }
    if (method === 'defaultQwenInpaintWorkflow' || method === 'defaultRemovalInpaintWorkflow') {
      for (const index of [1, 2]) {
        const found = references.findIndex((ref) => ref.name === args[index]);
        if (found < 0 || !filenames[found]) throw new Error('workflow input is not an uploaded task reference');
      }
    }
    // 局部编辑 and 智能补全 both run on 2.1 and read the undug crop to see what they change or
    // continue. The engine choice is the node's, never the task's, so it is dropped; the undug crop is
    // kept only when this task uploaded it.
    const inpaintOptions = method === 'defaultQwenInpaintWorkflow' ? args[5] : null;
    if (inpaintOptions && typeof inpaintOptions === 'object') {
      const { inpaintEngine, latentInputName, ...rest } = inpaintOptions;
      const keepLatent = references.some((ref, index) => ref.name === latentInputName && filenames[index]);
      if (inpaintEngine !== undefined || latentInputName !== undefined) args[5] = keepLatent ? { ...rest, latentInputName } : rest;
    }
    return { ...parameters, __args: rename(args) };
  }
  if (!filenames || !filenames.length) return parameters;
  // Option objects name their uploads under their own keys (H3's referenceImages / referenceVideo /
  // referenceAudio, the AI-effects sourceVideo / referenceImage): every string equal to a staged name
  // becomes the worker's name for that file, wherever it sits.
  const next = rename(parameters);
  next.__novaflowReferenceFiles = filenames;
  if (Array.isArray(next.references)) {
    next.references = next.references.map((r, i) => (
      filenames[i] ? { ...r, name: filenames[i], uploadedName: filenames[i] } : r
    ));
  }
  // The H3 builders read these two directly.
  if (filenames[0]) { next.firstFrame = filenames[0]; next.first_frame = filenames[0]; }
  if (filenames[1]) { next.lastFrame = filenames[1]; next.last_frame = filenames[1]; }
  return next;
}

/**
 * A replayed graph may load only the files this task uploaded. Without this a page could name any
 * file in the node's input folder and have it read into a result.
 */
export function assertGraphLoadsTaskInputs(graph, filenames) {
  const allowed = new Set((filenames || []).filter(Boolean));
  for (const [id, node] of Object.entries(graph && typeof graph === 'object' ? graph : {})) {
    const type = String(node && node.class_type || '');
    if (!/^(LoadImage|LoadImageMask|LoadVideo|LoadAudio)$/.test(type)) continue;
    const inputs = node && node.inputs && typeof node.inputs === 'object' ? node.inputs : {};
    for (const key of ['image', 'video', 'audio', 'file', 'filename']) {
      const value = inputs[key];
      if (typeof value === 'string' && !allowed.has(value)) {
        throw new Error(type + ' node ' + id + ' names a file this task did not upload: ' + value);
      }
    }
  }
}

export const SEE_THROUGH_SPLIT_METHOD = 'buildSeeThroughSplitWorkflow';

/**
 * One 一键拆图 run's files, read out of ComfyUI's output folder by name.
 *
 * See-through does not report its layers through the prompt history: SavePSD writes the layer PNGs
 * and `<prefix>_<ts>_<uid>_layers.json` and points the shared `seethrough_psd_info.log` at that json;
 * NovaFlow's head node adds `<prefix>_head.json` (+ its PNG) when it ran. The page fetches each of
 * these by exactly these names, so they are kept, and the log is written per task so a later run
 * cannot repoint it.
 */
export async function collectSeeThroughOutputs(comfy, prefix) {
  const safePrefix = String(prefix || '');
  if (!safePrefix || !isSafeFilename(safePrefix)) throw new Error('拆图任务缺少有效的输出前缀');
  const view = (filename) => comfy.viewFile({ filename, subfolder: '', type: 'output' });
  let infoName = '';
  try { infoName = String(await view('seethrough_psd_info.log')).trim(); } catch { throw new Error('See-through 未写入图层信息'); }
  if (!infoName.startsWith(safePrefix) || !isSafeFilename(infoName)) throw new Error('See-through 图层信息不是本次任务输出');
  const infoBytes = await view(infoName);
  let info = null;
  try { info = JSON.parse(String(infoBytes)); } catch { throw new Error('See-through 图层信息无法解析'); }
  const infoFile = { name: infoName, kind: 'file', bytes: infoBytes };
  const files = [{ name: 'seethrough_psd_info.log', kind: 'file', bytes: Buffer.from(infoName) }, infoFile];
  const served = new Set();
  for (const layer of Array.isArray(info?.layers) ? info.layers : []) {
    const original = String(layer?.filename || '');
    if (!original.startsWith(safePrefix)) continue;
    // See-through names a layer file after its tag, spaces included ("back hair"). The gateway serves
    // safe names only, so the file is stored, and listed in the json the page reads, under one.
    const name = original.replace(/[^A-Za-z0-9._-]+/g, '_');
    if (!isSafeFilename(name) || served.has(name)) continue;
    served.add(name);
    layer.filename = name;
    files.push({ name, kind: 'image', bytes: await view(original) });
  }
  infoFile.bytes = Buffer.from(JSON.stringify(info));
  const headName = safePrefix + '_head.json';
  let head = null;
  try { head = JSON.parse(String(await view(headName))); } catch { head = null; }
  if (head && typeof head === 'object') {
    files.push({ name: headName, kind: 'file', bytes: Buffer.from(JSON.stringify(head)) });
    const png = String(head.layer?.filename || '');
    if (head.ok === true && png.startsWith(safePrefix) && isSafeFilename(png)) files.push({ name: png, kind: 'image', bytes: await view(png) });
  }
  return files;
}

function nowIso() {
  return new Date().toISOString();
}

export function createWorker(options) {
  const {
    controlUrl,
    dataDir,
    workflowDir,
    configPath,
    comfyImageUrl = 'http://127.0.0.1:8188',
    comfyVideoUrl: configuredVideoUrl = '',
    modelsRoot = '',
    gatewayPort = 8790,
    gatewayHost = '0.0.0.0',
    publicEndpoint = '',
    tunnel: tunnelEnabled = true,
    workerName = 'novaflow-worker',
    rendererDir = '',
    registrationCode = '',
    ownerSessionToken = '',
    pollIntervalMs = 2000,
    localTasks = null,
    // The node's 提示词助手 (a function, because the assistant is created after
    // the worker it shares the GPU with). Absent on a node without one.
    promptAssistant = null,
    logger
  } = options;
  const promptAssistantRef = () => (typeof promptAssistant === 'function' ? promptAssistant() : promptAssistant) || null;
  // Video (MiniMax H3) runs on the image runtime since 2026-09-26; see videoRuntimeUrl.
  const comfyVideoUrl = videoRuntimeUrl(configuredVideoUrl, comfyImageUrl);

  // Refuse to run if ComfyUI is configured off loopback (spec 9).
  assertLocalOnly(comfyImageUrl);
  assertLocalOnly(comfyVideoUrl);

  const log = logger || ((msg, meta) => console.log('[worker] ' + msg, meta ? JSON.stringify(meta) : ''));
  const listeners = new Set();
  let activeRegistrationCode = registrationCode;
  let activeTask = null;
  let shareEpoch = 0;
  function checkCancelled(taskId) {
    if ((activeTask?.id === taskId && activeTask.controller.signal.aborted) || localTasks?.get(taskId)?.status === 'cancelled') {
      throw new Error('任务已被停止操作取消');
    }
  }
  async function cancelActiveTask() {
    const task = activeTask;
    if (!task) return;
    task.controller.abort();
    if (task.promptId) await task.comfy.cancelPrompt(task.promptId);
  }

  const state = {
    workerId: '',
    workerSecret: '',
    workerToken: '',
    grantKey: '',
    status: 'offline',
    currentTaskId: null,
    gpu: null,
    system: null,
    models: [],
    endpointUrl: publicEndpoint,
    localEndpointUrl: '',
    transport: 'direct',
    lastError: '',
    lastHeartbeatAt: null,
    startedAt: nowIso(),
    comfy: { image: false, video: false },
    features: { qwenImage21: false },
    stats: { completed: 0, failed: 0 }
  };

  function emit() {
    const snapshot = snapshotState();
    for (const fn of listeners) {
      try { fn(snapshot); } catch { /* a UI listener must not break the loop */ }
    }
  }

  function snapshotState() {
    return {
      workerId: state.workerId,
      workerName,
      status: state.status,
      currentTaskId: state.currentTaskId,
      gpu: state.gpu,
      system: state.system,
      models: state.models.map((m) => ({ model_id: m.model_id, status: m.status })),
      endpointUrl: state.endpointUrl,
      localEndpointUrl: state.localEndpointUrl,
      transport: state.transport,
      comfy: state.comfy,
      features: { ...state.features },
      lastError: state.lastError,
      lastHeartbeatAt: state.lastHeartbeatAt,
      startedAt: state.startedAt,
      stats: { ...state.stats },
      version: WORKER_VERSION,
      boundAccount: state.boundAccount || null,
      localRunning, sharing, draining, queuedLocal: localTasks?.pendingCount() || 0
    };
  }

  // The renderer's own graph builders, running here instead of in a browser.
  // Loaded lazily: a worker that only ever runs fixed task types never pays
  // for it, and a renderer directory that is missing is not fatal.
  const workflowHosts = new Map();
  function workflowHost(runtime) {
    if (!rendererDir) return null;
    if (!workflowHosts.has(runtime)) {
      const promise = createWorkflowHost({ rendererDir, logger: log, comfy: comfyFor(runtime) })
        .catch((error) => {
          log('workflow host unavailable', { error: String(error?.message || error) });
          return null;
        });
      workflowHosts.set(runtime, promise);
    }
    return workflowHosts.get(runtime);
  }

  const comfyImage = createComfyClient({ baseUrl: comfyImageUrl, logger: log });
  const comfyVideo = createComfyClient({ baseUrl: comfyVideoUrl, logger: log });

  const loraCatalog = createWorkerLoraCatalog({ modelsRoot, image: comfyImage, video: comfyVideo });
  let lastModelReportAt = 0;
  let lastFeatureProbeAt = 0;

  let lastRuntimeKind = '';

  function comfyFor(runtime) {
    return runtime === 'video' ? comfyVideo : comfyImage;
  }

  // -------------------------------------------------------------------------
  // Identity: generated once, kept in the worker's own config file.
  // -------------------------------------------------------------------------
  async function loadIdentity() {
    try {
      const raw = JSON.parse(await readFile(configPath, 'utf8'));
      if (raw.workerId && raw.workerSecret) {
        state.workerId = String(raw.workerId);
        state.workerSecret = String(raw.workerSecret);
        state.boundAccount = raw.boundAccount || null;
        return true;
      }
    } catch { /* first run */ }
    state.workerId = randomUUID();
    state.workerSecret = generateWorkerSecret();
    await saveIdentity();
    return false;
  }

  async function saveIdentity() {
    await mkdir(join(configPath, '..'), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      workerId: state.workerId,
      workerSecret: state.workerSecret,
      workerName,
      boundAccount: state.boundAccount || null,
      controlUrl,
      savedAt: nowIso()
    }, null, 2), 'utf8');
  }

  // -------------------------------------------------------------------------
  // Control-plane calls
  // -------------------------------------------------------------------------
  async function callControl(method, path, { body, token } = {}) {
    const localId = /^\/api\/worker\/tasks\/([^/]+)\//.exec(path)?.[1];
    if (localId && localTasks?.has(localId)) return localTasks.report(localId, path.split('/').pop(), body);
    const res = await fetch(controlUrl + path, {
      method,
      signal: AbortSignal.timeout(20000),
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!res.ok) {
      const err = new Error(String(parsed?.error || ('control plane ' + res.status)));
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  }

  async function register({ sessionToken = ownerSessionToken } = {}) {
    state.gpu = await detectGpu();
    state.system = await detectSystem();
    state.comfy.image = await comfyImage.isUp();
    state.comfy.video = await comfyVideo.isUp();

    const hardware = {
      gpu_name: state.gpu.name,
      vram_mb: state.gpu.vramMb,
      ram_mb: state.system.ramMb,
      driver_version: state.gpu.driverVersion,
      cuda_version: state.gpu.cudaVersion,
      worker_version: WORKER_VERSION,
      comfy_version: state.comfy.video
        ? (await comfyVideo.systemStats().catch(() => null))?.system?.comfyui_version || ''
        : (await comfyImage.systemStats().catch(() => null))?.system?.comfyui_version || '',
      endpoint_url: state.endpointUrl,
      transport: state.transport || 'direct'
    };

    const body = {
      worker_id: state.workerId,
      worker_name: workerName,
      worker_secret: state.workerSecret,
      hardware
    };
    if (activeRegistrationCode && !sessionToken) body.registration_code = activeRegistrationCode;

    const res = await callControl('POST', '/api/worker/register', {
      body,
      token: sessionToken || undefined
    });
    state.workerToken = res.workerToken;
    state.grantKey = res.grantKey;
    state.status = 'idle';
    log('registered', { workerId: state.workerId, gpu: state.gpu.name, vramMb: state.gpu.vramMb });
    emit();
    return res;
  }

  async function reportModels(onProgress = () => {}) {
    onProgress(75, '正在检测可用模型');
    const byId = new Map();
    for (const runtime of ['image', 'video']) {
      if (!state.comfy[runtime]) continue;
      const found = await inspectViaComfy(comfyFor(runtime)).catch(() => null);
      for (const model of found || []) {
        // Advertise a model only through the runtime runTask will select for it (both are the same
        // ComfyUI unless a node configured video elsewhere).
        if (runtimeFor(model.model_id) === runtime) byId.set(model.model_id, model);
      }
    }
    const diskModels = modelsRoot ? await inspectAllModels(modelsRoot).catch(() => []) : [];
    const qwen21 = state.comfy.image ? await detectQwenImage21(comfyImage).catch(() => false) : false;
    const models = MODEL_MANIFEST.map((spec) => {
      const found = byId.get(spec.model_id) || diskModels.find(m => m.model_id === spec.model_id);
      // Qwen-Image-2.1 is ready when this node can build its graph: the builder's own check, which
      // also covers the other quantisations and text encoders it accepts.
      if (spec.model_id === QWEN21_MODEL_ID) {
        return { ...(found || {}), model_id: spec.model_id, model_version: spec.version, status: qwen21 ? 'ready' : 'missing',
          detail: { ...(found?.detail || {}), ...(qwen21 ? {} : { reason: 'qwen_image_21_unavailable' }) } };
      }
      // A 'local' model is not loaded by ComfyUI, so no node catalogue can
      // vouch for it. The loop above only ever asks the 'image' and 'video'
      // runtimes, which left state.comfy['local'] undefined and every such
      // model permanently 'missing' - and the claim SQL matches on
      // status = 'ready', so the task could never be assigned to anybody.
      // Disk inspection is the whole answer here, exactly as it is the
      // fallback for the ComfyUI-served models.
      if (spec.runtime === 'local') {
        return found || { model_id: spec.model_id, model_version: spec.version, status: 'missing',
          detail: { reason: 'model_files_not_found' } };
      }
      if (state.comfy[spec.runtime] && byId.has(spec.model_id)) return found;
      return { ...(found || {}), model_id: spec.model_id, model_version: spec.version, status: 'missing',
        detail: { ...(found?.detail || {}), reason: state.comfy[spec.runtime] ? 'runtime_model_catalog_unavailable' : 'runtime_offline' } };
    });
    const matting = models.find(model => model.model_id === 'birefnet-matting');
    if (matting?.status === 'ready') {
      const capability = await probeMatting(modelsRoot);
      matting.detail = { ...matting.detail, matting: capability };
      if (!capability.ok) matting.status = 'missing';
    }
    // The model file alone is not the assistant: the Python service and its
    // runtime must be here too, and only the assistant knows.
    const prompt = models.find(model => model.model_id === PROMPT_ASSISTANT_MODEL_ID);
    if (prompt) {
      const assistant = promptAssistantRef();
      let status = null;
      try { status = assistant && typeof assistant.status === 'function' ? assistant.status() : null; } catch (_) { status = null; }
      const enabled = Boolean(status && (status.enabled || status.reverseModelEnabled));
      prompt.detail = { ...(prompt.detail || {}), prompt_assistant: status
        ? { enabled, runtimeStatus: status.runtimeStatus || '', error: status.error || '' }
        : { enabled: false, reason: 'no_prompt_assistant' } };
      if (!enabled) prompt.status = 'missing';
    }
    onProgress(82, '正在检测 LoRA 兼容性');
    for (const model of models) {
      // LoRA catalogues come from ComfyUI, so a model that is not served by
      // ComfyUI has none to report. Asking anyway sends a pointless
      // /object_info query and files a failed lookup under a model that was
      // never going to have one.
      const runtime = runtimeFor(model.model_id);
      if (model.status === 'ready' && runtime !== 'local') {
        model.detail = { ...(model.detail || {}), lora_catalog: await loraCatalog.report(runtime) };
      }
    }
    state.models = models;
    state.features.qwenImage21 = qwen21;
    lastFeatureProbeAt = Date.now();
    if (state.workerToken) await callControl('POST', '/api/worker/models', { body: { models }, token: state.workerToken });
    lastModelReportAt = Date.now();
    log('models reported', { ready: models.filter((m) => m.status === 'ready').map((m) => m.model_id) });
    emit();
    return models;
  }

  async function heartbeat() {
    try {
      if (tunnel) state.endpointUrl = tunnel.url || '';
      const previous = { ...state.comfy };
      state.comfy.image = await comfyImage.isUp();
      state.comfy.video = await comfyVideo.isUp();
      if (previous.image !== state.comfy.image || previous.video !== state.comfy.video || Date.now() - lastModelReportAt > 120000) await reportModels();
      await callControl('POST', '/api/worker/heartbeat', {
        token: state.workerToken,
        body: {
            status: sharing && (!tunnel || tunnel.url) && !localTasks?.has(state.currentTaskId) ? state.status : 'maintenance',
          current_task_id: localTasks?.has(state.currentTaskId) ? null : state.currentTaskId,
          hardware: {
            vram_mb: state.gpu?.vramMb,
            ram_mb: state.system?.ramMb,
            worker_version: WORKER_VERSION,
            endpoint_url: state.endpointUrl
          }
        }
      });
      state.lastHeartbeatAt = nowIso();
      state.lastError = '';
    } catch (error) {
      // A 401 means our token aged out; re-register rather than going quiet.
      if (error.status === 401) {
        log('worker token rejected, re-registering');
        await register().catch((e) => { state.lastError = String(e?.message || e); });
      } else {
        state.lastError = String(error?.message || error);
      }
    }
    emit();
  }

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------
  async function reportProgress(taskId, status, progress, note, promptId) {
    checkCancelled(taskId);
    try {
      await callControl('POST', '/api/worker/tasks/' + taskId + '/progress', {
        token: state.workerToken,
        body: { status, progress, note, prompt_id: promptId }
      });
    } catch (error) {
      log('progress report failed', { taskId, error: String(error?.message || error) });
    }
  }

  // Two minutes covers the usual one to three references; a multi-reference UI
  // run (up to 16) gets ten more seconds per extra file.
  async function waitForInputs(taskId, expected, { timeoutMs = 120000 + Math.max(0, expected.length - 3) * 10000 } = {}) {
    if (!expected.length) return [];
    const dir = join(dataDir, 'tasks', taskId, 'input');
    const started = Date.now();
    for (;;) {
      checkCancelled(taskId);
      let present = [];
      try {
        present = (await readdir(dir)).filter((n) => expected.some((e) => e.name === n));
      } catch { present = []; }
      if (present.length >= expected.length) return present;
      if (Date.now() - started > timeoutMs) {
        throw new Error('timed out waiting for the browser to upload ' + expected.length + ' input file(s)');
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function runTask(task) {
    checkCancelled(task.id);

    // AI 抠图 is the one task that is not a ComfyUI graph: it runs BiRefNet in
    // a Python process. Everything below this line belongs to ComfyUI -
    // loadWorkflow throws outright for a type that names no graph file, and
    // comfy.isUp() would refuse a job on a machine that can cut out perfectly
    // well without a generation runtime running. So the branch goes first.
    if (task.task_type === MATTING_TASK_TYPE) return runMattingTask(task);
    if (task.task_type === PROMPT_ASSISTANT_TASK_TYPE) return runPromptAssistantTask(task);

    // Two shapes of task. A renderer workflow names one of NovaFlow's own
    // builders and we run it here; a fixed task type uses a template file.
    const intent = task.workflow && task.workflow.module ? task.workflow : null;
    const moduleSpec = intent ? workflowModule(intent.module) : null;

    const req = intent
      ? { kind: moduleSpec?.kind || 'image', modelId: moduleSpec?.modelId }
      : requirementsFor(task.task_type);
    const template = intent ? null : await loadWorkflow(workflowDir, task.task_type);
    const runtime = intent
      ? (moduleSpec?.runtime || 'image')
      : (template.comfy === 'video' ? 'video' : 'image');
    const comfy = comfyFor(runtime);
    const parameters = task.parameters || {};

    if (!await comfy.isUp()) {
      state.comfy[runtime] = false;
      await reportModels();
      throw new Error((runtime === 'video' ? '视频' : '图像') + '算力服务未启动或已断开：' + comfy.baseUrl + '，请启动本地算力服务后重试');
    }

    // Image and video share one ComfyUI (H3 moved onto the 0.37 runtime). Its own eviction only makes
    // room in VRAM and keeps the evicted weights in RAM, and H3 (32B text encoder) next to Qwen-Image-2.1
    // does not fit a 16 GB card either way: unload everything whenever the task kind changes, and keep
    // the models loaded between tasks of the same kind.
    if (lastRuntimeKind && lastRuntimeKind !== runtime) {
      await reportProgress(task.id, TASK_STATE.PROCESSING, 1, 'freeing memory for the ' + runtime + ' models');
      await comfy.freeMemory().catch((error) => log('free failed', { error: String(error?.message || error) }));
    }
    lastRuntimeKind = runtime;

    checkCancelled(task.id);
    state.currentTaskId = task.id;
    state.status = 'busy';
    emit();

    const outDir = join(dataDir, 'tasks', task.id, 'output');
    await mkdir(outDir, { recursive: true });

    // 1. Inputs. The browser uploads straight to this worker's gateway -
    //    through the tunnel when it is somebody else's browser. Nothing about
    //    a task's files goes through storage in either direction.
    const expectedRefs = Array.isArray(task.references) && task.references.length
      ? task.references
      : (Array.isArray(parameters.references) ? parameters.references : []);
    const referenceFilenames = [];
    if (expectedRefs.length) {
      await reportProgress(task.id, TASK_STATE.UPLOADING, 2, 'waiting for reference upload');
      const names = await waitForInputs(task.id, expectedRefs);
      for (let i = 0; i < expectedRefs.length; i += 1) {
        checkCancelled(task.id);
        const name = names.find((n) => n === expectedRefs[i].name) || names[i];
        if (!name) continue;
        const bytes = await readFile(join(dataDir, 'tasks', task.id, 'input', name));
        const target = 'nfweb-' + task.id.slice(0, 8) + '-' + i + '-' + name;
        await comfy.uploadImage(target, bytes);
        referenceFilenames[i] = target;
      }
    }

    await reportProgress(task.id, TASK_STATE.PROCESSING, 8, 'submitting to ComfyUI');

    // 2. Build the graph. The browser never saw or supplied any of this.
    let graph;
    let seed = null;
    if (intent) {
      const host = await workflowHost(runtime);
      if (!host) throw new Error('this worker has no renderer workflow host configured');
      // The browser recorded WHICH builder and WHAT options; the builder
      // itself has never left this machine.
      //
      // This MUST be awaited: buildGraph reads the ComfyUI node catalogue
      // before it emits, so it is async. Without the await `graph` is a
      // promise - and a rejected one takes the whole node down instead of
      // failing the one task.
      graph = await host.buildGraph({
        module: intent.module,
        method: intent.method,
        options: withReferences(parameters, referenceFilenames, expectedRefs, intent.method)
      });
      assertGraphLoadsTaskInputs(graph, referenceFilenames);
    } else {
      const extra = { referenceFilenames };
      if (req?.kind === 'video') {
        extra.length = videoFrameLength(parameters.duration_seconds, parameters.fps);
      }
      graph = buildGraph(template, parameters, extra);
      seed = resolvedSeed(template, graph);
    }

    await loraCatalog.validateGraph(graph, parameters);

    // 3. Run.
    const startedAt = Date.now();
    checkCancelled(task.id);
    const promptId = await comfy.queuePrompt(graph);
    activeTask.comfy = comfy; activeTask.promptId = promptId;
    if (activeTask.controller.signal.aborted || localTasks?.get(task.id)?.status === 'cancelled') await comfy.cancelPrompt(promptId);
    checkCancelled(task.id);
    await reportProgress(task.id, TASK_STATE.PROCESSING, 12, 'queued in ComfyUI', promptId);

    const history = await comfy.waitForPrompt(promptId, {
      signal: activeTask.controller.signal,
      onProgress: async (pct, note) => {
        await reportProgress(task.id, TASK_STATE.PROCESSING, pct, note, promptId);
      }
    });

    // 4. Pull results out of ComfyUI and into this task's folder, so the
    //    browser fetches them from the gateway and never touches ComfyUI.
    checkCancelled(task.id);
    const produced = collectOutputs(history);
    if (!produced.length) throw new Error('ComfyUI finished without producing a file');

    const outputs = [];
    for (let i = 0; i < produced.length; i += 1) {
      checkCancelled(task.id);
      const item = produced[i];
      const bytes = await comfy.viewFile(item);
      const ext = (item.filename.match(/\.[A-Za-z0-9]+$/) || ['.png'])[0];
      // The art editor matches history outputs by its request prefix. Renaming
      // every result to out_0001 makes a completed task look empty forever.
      // Add task identity as a suffix so simultaneous tasks cannot collide.
      const stem = item.filename.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 90);
      const safeName = stem + '-' + task.id.slice(0, 8) + '-' + (i + 1) + ext;
      await writeFile(join(outDir, safeName), bytes);
      const info = await stat(join(outDir, safeName));
      outputs.push({
        name: safeName,
        kind: /\.(mp4|webm)$/i.test(ext) ? 'video' : 'image',
        bytes: info.size,
        width: Number(parameters.width) || 0,
        height: Number(parameters.height) || 0,
        duration_seconds: req?.kind === 'video' ? Number(parameters.duration_seconds) || 0 : 0
      });
    }

    // 一键拆图 keeps its layers outside the prompt history; copy them by name (collectSeeThroughOutputs).
    if (intent && intent.method === SEE_THROUGH_SPLIT_METHOD) {
      const prefix = String(parameters.__args?.[2]?.prefix || '');
      for (const file of await collectSeeThroughOutputs(comfy, prefix)) {
        checkCancelled(task.id);
        await writeFile(join(outDir, file.name), file.bytes);
        outputs.push({ name: file.name, kind: file.kind, bytes: file.bytes.length, width: 0, height: 0, duration_seconds: 0 });
      }
    }

    // 5. Report. The worker reports success and execution metadata; the
    //    control plane decides what it costs (spec 17).
    const comfyVersion = (await comfy.systemStats().catch(() => null))?.system?.comfyui_version || '';
    checkCancelled(task.id);
    const result = await callControl('POST', '/api/worker/tasks/' + task.id + '/complete', {
      token: state.workerToken,
      body: {
        prompt_id: promptId,
        outputs,
        execution: {
          elapsed_ms: Date.now() - startedAt,
          comfy_version: comfyVersion,
          seed
        }
      }
    });

    state.stats.completed += 1;
    log('task completed', { taskId: task.id, outputs: outputs.length, ms: Date.now() - startedAt });
    return result;
  }

  /**
   * AI 抠图 - the only task type that never touches ComfyUI.
   *
   * It reuses every part of the pipeline that is not ComfyUI's: the same
   * cancellation token, the same wait for the browser's upload, the same
   * progress reports, the same completion POST. Only the middle step differs,
   * and that step is BiRefNet driven by the same birefnet-runner.py the
   * desktop app has shipped all along - so the mattes a Web user gets are
   * produced by the identical model and transform as the desktop's.
   */
  async function runMattingTask(task) {
    const startedAt = Date.now();
    checkCancelled(task.id);
    state.currentTaskId = task.id;
    state.status = 'busy';
    emit();

    const parameters = task.parameters || {};
    const taskDir = join(dataDir, 'tasks', task.id);
    const outDir = join(taskDir, 'output');
    await mkdir(outDir, { recursive: true });

    const expectedRefs = Array.isArray(task.references) && task.references.length
      ? task.references
      : (Array.isArray(parameters.references) ? parameters.references : []);
    if (!expectedRefs.length) throw new Error('抠图任务没有声明源视频');

    await reportProgress(task.id, TASK_STATE.UPLOADING, 2, '等待浏览器上传源视频');
    const names = await waitForInputs(task.id, expectedRefs);
    checkCancelled(task.id);

    const sourceName = names.find((n) => n === expectedRefs[0].name) || names[0];
    if (!sourceName) throw new Error('源视频没有送达');

    await reportProgress(task.id, TASK_STATE.PROCESSING, 8, '正在解码帧');
    let progressReports = Promise.resolve();
    const produced = await runMatting({
      sourcePath: join(taskDir, 'input', sourceName),
      framePacks: expectedRefs.map(ref => join(taskDir, 'input', ref.name)),
      workDir: taskDir,
      outDir,
      parameters,
      modelsRoot,
      log,
      onProgress: (percent, note) => {
        progressReports = progressReports.then(() => reportProgress(task.id, TASK_STATE.PROCESSING, percent, note))
          .catch(error => log('matting progress failed', { error: error.message }));
      },
      isCancelled: () => {
        try { checkCancelled(task.id); return false; } catch (_) { return true; }
      }
    });
    // Completion must not overtake the final progress request on a slow link.
    await progressReports;

    const outputs = [];
    for (const name of produced) {
      const info = await stat(join(outDir, name));
      outputs.push({
        name,
        kind: /\.(mp4|webm)$/i.test(name) ? 'video' : 'mask',
        bytes: info.size,
        width: Number(parameters.width) || 0,
        height: Number(parameters.height) || 0,
        duration_seconds: 0
      });
    }

    checkCancelled(task.id);
    const result = await callControl('POST', '/api/worker/tasks/' + task.id + '/complete', {
      token: state.workerToken,
      body: {
        // The control plane requires a prompt_id and there is no ComfyUI
        // prompt behind this task, so it carries the job's own identity.
        prompt_id: 'matting-' + task.id,
        outputs,
        execution: { elapsed_ms: Date.now() - startedAt, comfy_version: '', seed: null }
      }
    });

    state.stats.completed += 1;
    log('matting completed', { taskId: task.id, outputs: outputs.length, ms: Date.now() - startedAt });
    return result;
  }

  /**
   * 提示词助手 for the pool: the same Python service the local page talks to,
   * asked by a task. The request is the one uploaded JSON file, the reply is
   * the one output file - ok:false replies included, so the page shows the
   * assistant's own message exactly as the local route would.
   */
  const PROMPT_ASSISTANT_METHODS = {
    'optimize-prompt': 'optimizePrompt',
    'reverse-image-prompt': 'reverseImagePrompt',
    'describe-art-style': 'describeArtStyle'
  };
  async function runPromptAssistantTask(task) {
    const startedAt = Date.now();
    checkCancelled(task.id);
    state.currentTaskId = task.id;
    state.status = 'busy';
    emit();

    const assistant = promptAssistantRef();
    if (!assistant || typeof assistant.runForTask !== 'function') throw new Error('此算力节点没有提示词助手');
    const parameters = task.parameters || {};
    const method = PROMPT_ASSISTANT_METHODS[String(parameters.action || '')];
    if (!method) throw new Error('未知的提示词助手操作：' + String(parameters.action || ''));
    const taskDir = join(dataDir, 'tasks', task.id);
    const outDir = join(taskDir, 'output');
    await mkdir(outDir, { recursive: true });

    const expectedRefs = Array.isArray(task.references) && task.references.length
      ? task.references
      : (Array.isArray(parameters.references) ? parameters.references : []);
    if (!expectedRefs.length) throw new Error('提示词任务没有声明请求文件');
    await reportProgress(task.id, TASK_STATE.UPLOADING, 2, '等待浏览器上传请求');
    const names = await waitForInputs(task.id, expectedRefs);
    checkCancelled(task.id);
    const requestName = names.find((n) => n === PROMPT_ASSISTANT_REQUEST_FILE) || names[0];
    if (!requestName) throw new Error('提示词请求没有送达');
    let request;
    try { request = JSON.parse(await readFile(join(taskDir, 'input', requestName), 'utf8')); }
    catch (error) { throw new Error('提示词请求不是有效的 JSON：' + String(error.message || error)); }

    await reportProgress(task.id, TASK_STATE.PROCESSING, 10, '本地模型推理中');
    const reply = await assistant.runForTask(task.id, method, request && typeof request === 'object' ? request : {});
    checkCancelled(task.id);
    const bytes = Buffer.from(JSON.stringify(reply ?? { ok: false, error: '提示词助手没有返回结果' }));
    await writeFile(join(outDir, PROMPT_ASSISTANT_RESULT_FILE), bytes);

    const result = await callControl('POST', '/api/worker/tasks/' + task.id + '/complete', {
      token: state.workerToken,
      body: {
        prompt_id: 'prompt-' + task.id,
        outputs: [{ name: PROMPT_ASSISTANT_RESULT_FILE, kind: 'json', bytes: bytes.length, width: 0, height: 0, duration_seconds: 0 }],
        execution: { elapsed_ms: Date.now() - startedAt, comfy_version: '', seed: null }
      }
    });

    state.stats.completed += 1;
    log('prompt assistant completed', { taskId: task.id, action: parameters.action, ok: reply?.ok !== false, ms: Date.now() - startedAt });
    return result;
  }

  async function claimAndRun() {
    if (claimBusy || state.currentTaskId) return false;
    claimBusy = true;
    try { return await claimAndRunLocked(); }
    finally {
      claimBusy = false;
      // A stop may arrive during an empty cloud claim, before a task exists.
      if (draining && !state.currentTaskId) { draining = false; emit(); }
    }
  }

  async function claimAndRunLocked() {
    const epoch = shareEpoch;
    let claim;
    const local = localRunning && localTasks?.next();
    if (local) claim = { task: local };
    else if (!sharing || !running || (tunnel && !tunnel.url)) return false;
    try {
      if (!claim) claim = await callControl('POST', '/api/worker/claim', { token: state.workerToken });
    } catch (error) {
      if (error.status === 401) await register().catch(() => {});
      return false;
    }
    if (!claim?.task) return false;
    if (claim.grantKey) state.grantKey = claim.grantKey;

    const task = claim.task;
    activeTask = { id: task.id, controller: new AbortController(), promptId: '', comfy: null };
    if (!local && (!sharing || epoch !== shareEpoch)) activeTask.controller.abort();
    // Mark the reservation before async model/health checks so closing the
    // local editor cannot tear down a task that is still preparing.
    state.currentTaskId = task.id;
    state.status = 'busy';
    emit();
    try {
      await runTask(task);
    } catch (error) {
      const message = String(error?.message || error);
      log('task failed', { taskId: task.id, error: message });
      const cancelled = activeTask?.controller.signal.aborted;
      if (!cancelled) state.stats.failed += 1;
      try {
        await callControl('POST', '/api/worker/tasks/' + task.id + '/fail', {
          token: state.workerToken,
          body: {
            error_code: cancelled ? 'worker_stopped' : /timed out/i.test(message) ? 'timeout' : 'worker_error',
            error_message: message.slice(0, 500)
          }
        });
      } catch (reportError) {
        // If we cannot even report the failure, the control plane's heartbeat
        // sweeper will requeue the task. Nothing is charged either way.
        log('failure report failed', { taskId: task.id, error: String(reportError?.message || reportError) });
      }
    } finally {
      activeTask = null;
      state.currentTaskId = null;
      state.status = 'idle';
      draining = false;
      if (state.workerToken) await heartbeat();
      emit();
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // TTL cleanup (spec 13)
  // -------------------------------------------------------------------------
  async function sweepFiles(ttl = TTL_SECONDS) {
    // The task this worker is running right now has an empty output folder
    // until ComfyUI finishes. Tell the sweeper, or it will delete it.
    const active = [state.currentTaskId, ...(localTasks?.list().map(t => t.id) || [])].filter(Boolean);
    const result = await sweepTaskFiles({ dataDir, ttlSeconds: ttl, activeTaskIds: active });
    if (result.removedFiles) {
      log('ttl sweep', { files: result.removedFiles, bytes: result.removedBytes });
    }
    // Tell the control plane, so the task is marked expired and its copies in
    // the object store go too. Without this the local files vanish and the
    // remote ones stay forever, which is the worst of both.
    if (result.expiredTasks && result.expiredTasks.length && state.workerToken) {
      try {
        await callControl('POST', '/api/worker/expire', {
          token: state.workerToken,
          body: { taskIds: result.expiredTasks }
        });
      } catch (error) {
        log('could not report expired tasks', { error: String(error.message || error) });
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  let gateway = null;
  let tunnel = null;
  let timers = [];
  let running = false;
  let starting = null;
  let localRunning = false;
  let localTimer = null;
  let localHealthTimer = null;
  let checkingHealth = false;
  let sharing = false;
  let draining = false;
  let claimBusy = false;

  async function startLocal({ onProgress = () => {} } = {}) {
    if (localRunning) return snapshotState();
    await mkdir(join(dataDir, 'tasks'), { recursive: true });
    await loadIdentity();
    onProgress(45, '正在检测显卡和系统');
    state.gpu = await detectGpu();
    state.system = await detectSystem();
    onProgress(60, '正在连接图像和视频服务');
    state.comfy.image = await comfyImage.isUp();
    state.comfy.video = await comfyVideo.isUp();
    await reportModels(onProgress);
    localRunning = true;
    state.status = state.currentTaskId ? 'busy' : 'idle';
    localTimer = setInterval(() => { claimAndRun().catch(e => log('local task error', { error: String(e.message) })); }, 500);
    localHealthTimer = setInterval(async () => {
      if (checkingHealth || !localRunning) return;
      checkingHealth = true;
      try {
        const previous = JSON.stringify(state.comfy);
        state.comfy.image = await comfyImage.isUp();
        state.comfy.video = await comfyVideo.isUp();
        if (previous !== JSON.stringify(state.comfy)) await reportModels();
        else if (state.comfy.image && !state.features.qwenImage21 && Date.now() - lastFeatureProbeAt > 60000) {
          // A probe that timed out at start, or weights added later, should not need a restart.
          lastFeatureProbeAt = Date.now();
          state.features.qwenImage21 = await detectQwenImage21(comfyImage).catch(() => false);
        }
        emit();
      } catch (e) { log('local health check failed', { error: String(e.message) }); }
      finally { checkingHealth = false; }
    }, 15000);
    emit();
    return snapshotState();
  }

  async function stopSharing() {
    sharing = false;
    shareEpoch++;
    draining = false;
    if (activeTask && !localTasks?.has(activeTask.id)) await cancelActiveTask();
    if (state.workerToken) heartbeat().catch(() => {});
    // Keep the authenticated file gateway alive: completed tasks still need
    // to download their results. Only stop() closes it.
    emit();
    return snapshotState();
  }

  async function stopLocal() {
    localRunning = false;
    clearInterval(localTimer);
    clearInterval(localHealthTimer);
    localTimer = null;
    localHealthTimer = null;
    // Each switch cancels only its own jobs, including private queued tasks.
    for (const task of localTasks?.list() || []) {
      if (!['completed', 'failed', 'cancelled', 'expired'].includes(task.status)) await cancelLocalTask(task.id);
    }
    state.status = state.currentTaskId ? 'busy' : sharing ? 'idle' : 'offline';
    emit();
    return snapshotState();
  }

  async function bindAccount(sessionToken) {
    if (!localRunning || sharing || claimBusy) throw new Error('请在本地服务空闲且未分享时绑定账号');
    if (!controlUrl || !sessionToken) throw new Error('请先配置控制面地址并登录 NovaFlow 账号');
    const me = await callControl('GET', '/api/web/me', { token: sessionToken });
    if (!me.user?.id) throw new Error('账号验证失败');
    if (state.boundAccount?.id && state.boundAccount.id !== me.user.id) throw new Error('此设备已绑定其他账号，请先由原账号处理解绑');
    await register({ sessionToken });
    await heartbeat();
    const mine = await callControl('GET', '/api/web/workers', { token: sessionToken });
    if (!mine.workers?.some(w => w.id === state.workerId)) throw new Error('此算力节点已属于其他账号，不能转移绑定');
    state.boundAccount = { id: me.user.id, account: me.user.email || me.user.account || me.user.id };
    await saveIdentity();
    emit();
    return { account: state.boundAccount };
  }

  async function cancelLocalTask(id) {
    const task = localTasks?.get(id);
    if (!task) throw new Error('本机任务不存在');
    await localTasks.cancel(id);
    if (activeTask?.id === id) await cancelActiveTask();
    emit();
    return task;
  }

  async function start({ registrationCode: code, onProgress = () => {} } = {}) {
    if (code !== undefined) activeRegistrationCode = String(code);
    if (starting) return starting;
    if (running) { sharing = true; draining = false; await heartbeat(); emit(); return snapshotState(); }
    starting = startResources(onProgress).catch(async (error) => {
      await closeSharing().catch(() => {});
      if (error.message === 'missing session token' || error.message === 'unknown worker') {
        error.message = '云端没有此节点的注册记录，请在设置中填写新的注册码，保存后重新启动';
      } else if (error.message === 'registration code is invalid or used up') {
        error.message = '注册码无效、已过期或已使用，请填写新的注册码，保存后重新启动';
      }
      state.lastError = String(error.message || error);
      emit();
      throw error;
    });
    try { return await starting; }
    finally { starting = null; }
  }

  async function startResources(onProgress = () => {}) {
    running = true;
    state.lastError = '';

    await mkdir(join(dataDir, 'tasks'), { recursive: true });
    await loadIdentity();

    onProgress(45, '正在启动算力网关');
    gateway = createGateway({
      workerId: state.workerId,
      dataDir,
      getGrantKey: () => state.grantKey,
      logger: log
    });
    const port = await gateway.listen(gatewayPort, gatewayHost);
    state.localEndpointUrl = 'http://127.0.0.1:' + port;
    log('gateway listening', { port, endpoint: state.localEndpointUrl });

    // A public address for a machine that has none. Without one this node can
    // only serve a browser running on this very machine - which is the owner
    // and nobody else. See tunnel.mjs.
    // Tests turn this off: a suite that reaches the internet to pass is a
    // suite that fails for reasons that have nothing to do with the code.
    // `npm run verify:tunnel` opens a real one and fetches a real file
    // through it.
    if (!state.endpointUrl && tunnelEnabled !== false) {
      onProgress(55, '正在建立外网共享连接');
      tunnel = createTunnel({ port, logger: log });
      const publicUrl = await tunnel.start();
      if (!publicUrl) throw new Error('外网共享连接未能建立，请检查网络后重试；本地使用不受影响');
      state.endpointUrl = publicUrl || state.localEndpointUrl;
      state.transport = publicUrl ? 'tunnel' : 'direct';
      if (!publicUrl) {
        log('no public address: only a browser on this machine can fetch results');
      }
    } else if (!state.endpointUrl) {
      state.endpointUrl = state.localEndpointUrl;
    }

    onProgress(65, '正在检测硬件并注册算力节点');
    await register();
    await reportModels(onProgress);
    if (state.currentTaskId) state.status = 'busy';
    sharing = true;
    draining = false;

    timers.push(setInterval(() => { heartbeat().catch(() => {}); }, HEARTBEAT_INTERVAL_SECONDS * 1000));
    timers.push(setInterval(() => { claimAndRun().catch(() => {}); }, pollIntervalMs));
    timers.push(setInterval(() => { reportModels().catch(() => {}); }, 10 * 60 * 1000));
    timers.push(setInterval(() => { sweepFiles().catch(() => {}); }, 15 * 60 * 1000));

    emit();
    return snapshotState();
  }

  async function stop() {
    await stopSharing();
    await stopLocal();
    while (claimBusy) await new Promise(resolve => setTimeout(resolve, 100));
    await closeSharing();
    state.status = 'offline';
    emit();
  }

  async function closeSharing() {
    running = false;
    sharing = false;
    draining = false;
    for (const t of timers) clearInterval(t);
    timers = [];
    state.status = state.currentTaskId ? 'busy' : localRunning ? 'idle' : 'offline';
    try {
      if (state.workerToken) {
        await callControl('POST', '/api/worker/heartbeat', {
          token: state.workerToken,
          body: { status: 'offline', current_task_id: null }
        });
      }
    } catch { /* going offline quietly is acceptable */ }
    if (tunnel) tunnel.stop();
    tunnel = null;
    if (gateway) await gateway.close();
    gateway = null;
    state.workerToken = '';
    state.grantKey = '';
    state.endpointUrl = publicEndpoint;
    state.localEndpointUrl = '';
    state.transport = 'direct';
    emit();
  }

  return {
    start,
    startLocal,
    stopLocal,
    bindAccount,
    cancelLocalTask,
    startSharing: start,
    stopSharing,
    readLoraCatalog: (kind, input) => loraCatalog.read(kind, input),
    stop,
    heartbeat,
    reportModels,
    claimAndRun,
    sweepFiles,
    register,
    getState: snapshotState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get identity() { return { workerId: state.workerId, workerName }; },
    get gatewayEndpoint() { return state.endpointUrl; },
    get localEndpoint() { return state.localEndpointUrl; },
    get transport() { return state.transport; }
  };
}
