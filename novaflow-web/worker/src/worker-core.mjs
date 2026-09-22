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
import { loadWorkflow, buildGraph, resolvedSeed, videoFrameLength } from './comfy/workflow-runner.mjs';
import { createWorkflowHost } from './comfy/workflow-host.mjs';
import { workflowModule } from '../../packages/shared/src/workflow-modules.mjs';
import { inspectAllModels, inspectViaComfy } from './models/model-manager.mjs';
import { detectGpu, detectSystem } from './hardware.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import {
  HEARTBEAT_INTERVAL_SECONDS,
  TASK_STATE,
  TTL_SECONDS,
  requirementsFor
} from '../../packages/shared/src/protocol.mjs';

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
 */
function withReferences(parameters, filenames) {
  if (!filenames || !filenames.length) return parameters;
  const next = { ...parameters };
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
    comfyVideoUrl = 'http://127.0.0.1:8189',
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
    logger
  } = options;

  // Refuse to run if ComfyUI is configured off loopback (spec 9).
  assertLocalOnly(comfyImageUrl);
  assertLocalOnly(comfyVideoUrl);

  const log = logger || ((msg, meta) => console.log('[worker] ' + msg, meta ? JSON.stringify(meta) : ''));
  const listeners = new Set();

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
      lastError: state.lastError,
      lastHeartbeatAt: state.lastHeartbeatAt,
      startedAt: state.startedAt,
      stats: { ...state.stats },
      version: WORKER_VERSION
    };
  }

  // The renderer's own graph builders, running here instead of in a browser.
  // Loaded lazily: a worker that only ever runs fixed task types never pays
  // for it, and a renderer directory that is missing is not fatal.
  let workflowHostPromise = null;
  function workflowHost() {
    if (!rendererDir) return null;
    if (!workflowHostPromise) {
      workflowHostPromise = createWorkflowHost({ rendererDir, logger: log })
        .catch((error) => {
          log('workflow host unavailable', { error: String(error?.message || error) });
          return null;
        });
    }
    return workflowHostPromise;
  }

  const comfyImage = createComfyClient({ baseUrl: comfyImageUrl, logger: log });
  const comfyVideo = createComfyClient({ baseUrl: comfyVideoUrl, logger: log });

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
      controlUrl,
      savedAt: nowIso()
    }, null, 2), 'utf8');
  }

  // -------------------------------------------------------------------------
  // Control-plane calls
  // -------------------------------------------------------------------------
  async function callControl(method, path, { body, token } = {}) {
    const res = await fetch(controlUrl + path, {
      method,
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

  async function register() {
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
    if (registrationCode) body.registration_code = registrationCode;

    const res = await callControl('POST', '/api/worker/register', {
      body,
      token: ownerSessionToken || undefined
    });
    state.workerToken = res.workerToken;
    state.grantKey = res.grantKey;
    state.status = 'idle';
    log('registered', { workerId: state.workerId, gpu: state.gpu.name, vramMb: state.gpu.vramMb });
    emit();
    return res;
  }

  async function reportModels() {
    // Prefer what ComfyUI says it can load over what the filesystem suggests.
    let models = null;
    if (state.comfy.image) models = await inspectViaComfy(comfyImage).catch(() => null);
    if (state.comfy.video) {
      const videoModels = await inspectViaComfy(comfyVideo).catch(() => null);
      if (videoModels) {
        const byId = new Map((models || []).map((m) => [m.model_id, m]));
        for (const m of videoModels) {
          const existing = byId.get(m.model_id);
          // A model counts as ready if EITHER runtime can load it.
          if (!existing || m.status === 'ready') byId.set(m.model_id, m);
        }
        models = [...byId.values()];
      }
    }
    if (!models && modelsRoot) models = await inspectAllModels(modelsRoot);
    if (!models) models = [];

    state.models = models;
    await callControl('POST', '/api/worker/models', { body: { models }, token: state.workerToken });
    log('models reported', { ready: models.filter((m) => m.status === 'ready').map((m) => m.model_id) });
    emit();
    return models;
  }

  async function heartbeat() {
    try {
      state.comfy.image = await comfyImage.isUp();
      state.comfy.video = await comfyVideo.isUp();
      await callControl('POST', '/api/worker/heartbeat', {
        token: state.workerToken,
        body: {
          status: state.status,
          current_task_id: state.currentTaskId,
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
    try {
      await callControl('POST', '/api/worker/tasks/' + taskId + '/progress', {
        token: state.workerToken,
        body: { status, progress, note, prompt_id: promptId }
      });
    } catch (error) {
      log('progress report failed', { taskId, error: String(error?.message || error) });
    }
  }

  async function waitForInputs(taskId, expected, { timeoutMs = 120000 } = {}) {
    if (!expected.length) return [];
    const dir = join(dataDir, 'tasks', taskId, 'input');
    const started = Date.now();
    for (;;) {
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
      const host = await workflowHost();
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
        options: withReferences(parameters, referenceFilenames)
      });
    } else {
      const extra = { referenceFilenames };
      if (req?.kind === 'video') {
        extra.length = videoFrameLength(parameters.duration_seconds, parameters.fps);
      }
      graph = buildGraph(template, parameters, extra);
      seed = resolvedSeed(template, graph);
    }

    // 3. Run.
    const startedAt = Date.now();
    const promptId = await comfy.queuePrompt(graph);
    await reportProgress(task.id, TASK_STATE.PROCESSING, 12, 'queued in ComfyUI', promptId);

    const history = await comfy.waitForPrompt(promptId, {
      onProgress: async (pct, note) => {
        await reportProgress(task.id, TASK_STATE.PROCESSING, pct, note, promptId);
      }
    });

    // 4. Pull results out of ComfyUI and into this task's folder, so the
    //    browser fetches them from the gateway and never touches ComfyUI.
    const produced = collectOutputs(history);
    if (!produced.length) throw new Error('ComfyUI finished without producing a file');

    const outputs = [];
    for (let i = 0; i < produced.length; i += 1) {
      const item = produced[i];
      const bytes = await comfy.viewFile(item);
      const ext = (item.filename.match(/\.[A-Za-z0-9]+$/) || ['.png'])[0];
      const safeName = 'out_' + String(i + 1).padStart(4, '0') + ext;
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

    // 5. Report. The worker reports success and execution metadata; the
    //    control plane decides what it costs (spec 17).
    const result = await callControl('POST', '/api/worker/tasks/' + task.id + '/complete', {
      token: state.workerToken,
      body: {
        prompt_id: promptId,
        outputs,
        execution: {
          elapsed_ms: Date.now() - startedAt,
          comfy_version: (await comfy.systemStats().catch(() => null))?.system?.comfyui_version || '',
          seed
        }
      }
    });

    state.stats.completed += 1;
    log('task completed', { taskId: task.id, outputs: outputs.length, ms: Date.now() - startedAt });
    return result;
  }

  async function claimAndRun() {
    if (state.currentTaskId) return false;
    let claim;
    try {
      claim = await callControl('POST', '/api/worker/claim', { token: state.workerToken });
    } catch (error) {
      if (error.status === 401) await register().catch(() => {});
      return false;
    }
    if (!claim?.task) return false;
    if (claim.grantKey) state.grantKey = claim.grantKey;

    const task = claim.task;
    try {
      await runTask(task);
    } catch (error) {
      const message = String(error?.message || error);
      log('task failed', { taskId: task.id, error: message });
      state.stats.failed += 1;
      try {
        await callControl('POST', '/api/worker/tasks/' + task.id + '/fail', {
          token: state.workerToken,
          body: {
            error_code: /timed out/i.test(message) ? 'timeout' : 'worker_error',
            error_message: message.slice(0, 500)
          }
        });
      } catch (reportError) {
        // If we cannot even report the failure, the control plane's heartbeat
        // sweeper will requeue the task. Nothing is charged either way.
        log('failure report failed', { taskId: task.id, error: String(reportError?.message || reportError) });
      }
    } finally {
      state.currentTaskId = null;
      state.status = 'idle';
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
    const active = [state.currentTaskId].filter(Boolean);
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

  async function start() {
    if (running) return snapshotState();
    running = true;

    await mkdir(join(dataDir, 'tasks'), { recursive: true });
    await loadIdentity();

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
      tunnel = createTunnel({ port, logger: log });
      const publicUrl = await tunnel.start();
      state.endpointUrl = publicUrl || state.localEndpointUrl;
      state.transport = publicUrl ? 'tunnel' : 'direct';
      if (!publicUrl) {
        log('no public address: only a browser on this machine can fetch results');
      }
    } else if (!state.endpointUrl) {
      state.endpointUrl = state.localEndpointUrl;
    }

    await register();
    await reportModels();

    timers.push(setInterval(() => { heartbeat().catch(() => {}); }, HEARTBEAT_INTERVAL_SECONDS * 1000));
    timers.push(setInterval(() => { claimAndRun().catch(() => {}); }, pollIntervalMs));
    timers.push(setInterval(() => { reportModels().catch(() => {}); }, 10 * 60 * 1000));
    timers.push(setInterval(() => { sweepFiles().catch(() => {}); }, 15 * 60 * 1000));

    emit();
    return snapshotState();
  }

  async function stop() {
    running = false;
    for (const t of timers) clearInterval(t);
    timers = [];
    state.status = 'offline';
    try {
      await callControl('POST', '/api/worker/heartbeat', {
        token: state.workerToken,
        body: { status: 'offline', current_task_id: null }
      });
    } catch { /* going offline quietly is acceptable */ }
    if (tunnel) tunnel.stop();
    tunnel = null;
    if (gateway) await gateway.close();
    gateway = null;
    emit();
  }

  return {
    start,
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
