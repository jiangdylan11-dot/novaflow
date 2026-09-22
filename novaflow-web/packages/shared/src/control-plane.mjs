// NovaFlow Web - control plane.
//
// ONE implementation of the whole API, used by both deployments:
//   * supabase/functions/novaflow-web  (Deno edge function, SupabaseStore)
//   * control-local/src/server.mjs     (Node + PGlite, PgStore)
//
// Both stores call the SAME SQL functions from the migration, so the local
// tests exercise the production logic rather than a lookalike. Anything that
// differs between the two lives behind the `store` interface below and nowhere
// else.
//
// Trust model (spec 8, 17):
//   * A browser proves identity with a nfs_ session token that the EXISTING
//     novaflow-backend minted. We verify, never mint, so the Web line cannot
//     manufacture a user.
//   * A worker proves identity with worker_id + worker_secret, and then
//     carries a short-lived nfw_ token. It can only touch its own row and the
//     task currently assigned to it.
//   * Credits are computed here from validated parameters and settled here.
//     The worker reports success/failure and execution metadata, nothing else.

import {
  ERROR_CODE,
  GRANT_OP,
  GRANT_TTL_SECONDS,
  GRANT_DOWNLOAD_TTL_SECONDS,
  HEARTBEAT_TIMEOUT_SECONDS,
  ASSIGN_TIMEOUT_SECONDS,
  PROCESSING_TIMEOUT_SECONDS,
  MAX_TASK_ATTEMPTS,
  PROTOCOL_VERSION,
  TASK_STATE,
  TASK_TYPE_REQUIREMENTS,
  TTL_SECONDS,
  isKnownTaskType,
  requirementsFor
} from './protocol.mjs';

import {
  bearerToken,
  deriveWorkerGrantKey,
  hashWorkerSecret,
  issueGrantToken,
  issueWorkerToken,
  verifySessionToken,
  verifyWorkerToken,
  sha256Hex
} from './tokens.mjs';

import { priceTask } from './pricing.mjs';
import { isAllowedWorkflowCall, workflowModule } from './workflow-modules.mjs';
import { MODEL_MANIFEST } from './model-manifest.mjs';
import {
  FILE_KIND,
  FILE_URL_TTL_SECONDS,
  safeFileName,
  taskObjectPath,
  taskObjectPrefix
} from './task-files.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PROMPT_CHARS = 4000;

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

function bad(message, code = ERROR_CODE.BAD_REQUEST) {
  return new HttpError(400, code, message);
}

/** Six uppercase characters a person can read off a screen and retype. */
function randomChunk() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I/O/0/1
  const bytes = new Uint8Array(6);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Parameter validation. Everything a browser sends is clamped to a range we
// are willing to run; nothing is passed through to a workflow unexamined.
// ---------------------------------------------------------------------------
function sanitizeText(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function validateTaskParameters(taskType, raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const req = requirementsFor(taskType);
  if (!req) throw bad('unsupported task type: ' + String(taskType));

  const prompt = sanitizeText(input.prompt, MAX_PROMPT_CHARS);
  const negative = sanitizeText(input.negative_prompt ?? input.negativePrompt, MAX_PROMPT_CHARS);
  const seed = Number.isFinite(Number(input.seed)) ? Math.floor(Number(input.seed)) : -1;

  const references = Array.isArray(input.references) ? input.references.slice(0, 4) : [];
  const cleanRefs = references
    .map((r) => ({
      name: sanitizeText(r?.name, 128),
      bytes: clampInt(r?.bytes, 0, 64 * 1024 * 1024, 0),
      kind: sanitizeText(r?.kind, 32) || 'image'
    }))
    .filter((r) => r.name);

  if (req.kind === 'video') {
    const parameters = {
      prompt,
      negative_prompt: negative,
      seed,
      width: clampInt(input.width, 256, 2048, 1280),
      height: clampInt(input.height, 256, 2048, 720),
      duration_seconds: Math.min(30, Math.max(1, Number(input.duration_seconds) || 5)),
      fps: clampInt(input.fps, 8, 60, 24),
      references: cleanRefs
    };
    if (!cleanRefs.length) throw bad('an image-to-video task needs one reference image');
    return parameters;
  }

  return {
    prompt,
    negative_prompt: negative,
    seed,
    width: clampInt(input.width, 256, 4096, 1024),
    height: clampInt(input.height, 256, 4096, 1024),
    steps: clampInt(input.steps, 1, 100, 20),
    count: clampInt(input.count, 1, 10, 1),
    cfg: Math.min(20, Math.max(0, Number(input.cfg) || 1.2)),
    references: cleanRefs
  };
}


// ---------------------------------------------------------------------------
// Renderer-workflow options.
//
// These come from NovaFlow's own panels, so their shape belongs to the
// renderer, not to us. We do not try to reshape them - we bound them: a size
// cap so one task cannot carry a payload, and depth/string limits so a hostile
// client cannot hand the worker something pathological to parse.
// ---------------------------------------------------------------------------
const MAX_WORKFLOW_OPTIONS_BYTES = 128 * 1024;
const MAX_WORKFLOW_DEPTH = 12;

export function sanitizeWorkflowOptions(raw, depth = 0) {
  if (depth > MAX_WORKFLOW_DEPTH) return null;
  if (raw === null || raw === undefined) return null;
  const t = typeof raw;
  if (t === 'string') return raw.slice(0, MAX_PROMPT_CHARS);
  if (t === 'number') return Number.isFinite(raw) ? raw : 0;
  if (t === 'boolean') return raw;
  if (Array.isArray(raw)) return raw.slice(0, 256).map((v) => sanitizeWorkflowOptions(v, depth + 1));
  if (t !== 'object') return null;

  const out = {};
  for (const [key, value] of Object.entries(raw).slice(0, 256)) {
    out[String(key).slice(0, 120)] = sanitizeWorkflowOptions(value, depth + 1);
  }
  if (depth === 0) {
    const size = JSON.stringify(out).length;
    if (size > MAX_WORKFLOW_OPTIONS_BYTES) {
      throw bad('workflow options are too large (' + size + ' bytes)');
    }
  }
  return out;
}

/**
 * Pull the few fields pricing needs out of whatever shape the renderer used.
 * Anything missing falls back to the rate card's own defaults, so an unusual
 * panel is charged a sane price rather than nothing.
 */
export function pricingViewOf(options) {
  const o = options && typeof options === 'object' ? options : {};
  const res = (o.resolution && typeof o.resolution === 'object') ? o.resolution : {};
  return {
    width: Number(o.width ?? res.width ?? o.canvasWidth) || undefined,
    height: Number(o.height ?? res.height ?? o.canvasHeight) || undefined,
    steps: Number(o.steps ?? o.stepCount) || undefined,
    count: Number(o.count ?? o.batchSize ?? o.imageCount) || undefined,
    duration_seconds: Number(o.durationSeconds ?? o.duration_seconds ?? o.duration) || undefined
  };
}

export function sanitizeReferences(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).map((r) => ({
    name: String((r && r.name) || '').slice(0, 128).replace(/[^A-Za-z0-9._-]/g, '_'),
    bytes: Math.min(64 * 1024 * 1024, Math.max(0, Math.floor(Number(r && r.bytes) || 0))),
    kind: String((r && r.kind) || 'image').slice(0, 32)
  })).filter((r) => r.name);
}

// ---------------------------------------------------------------------------
// Control plane factory.
//
// `store` must implement the methods used below. `secrets` carries:
//   sessionSecret - the SAME NOVAFLOW_SESSION_SECRET novaflow-backend uses
//   controlSecret - Web-line only; signs worker tokens and derives grant keys
// ---------------------------------------------------------------------------
export function createControlPlane({ store, secrets, logger }) {
  const log = logger || (() => {});
  const sessionSecret = secrets?.sessionSecret || '';
  const controlSecret = secrets?.controlSecret || '';

  async function requireUser(headers) {
    const token = bearerToken(headers.authorization || headers.Authorization);
    if (!token) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'missing session token');
    let payload;
    try {
      payload = await verifySessionToken(token, sessionSecret);
    } catch (error) {
      const expired = /expired/i.test(String(error?.message || ''));
      throw new HttpError(401, expired ? ERROR_CODE.EXPIRED : ERROR_CODE.UNAUTHORIZED, String(error?.message || 'invalid session'));
    }
    const user = await store.getUserById(String(payload.sub));
    if (!user) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'unknown user');
    if (String(user.status || 'active').toLowerCase() !== 'active') {
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'user disabled');
    }
    return user;
  }

  async function requireWorker(headers) {
    const token = bearerToken(headers.authorization || headers.Authorization);
    if (!token) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'missing worker token');
    let payload;
    try {
      payload = await verifyWorkerToken(token, controlSecret);
    } catch (error) {
      const expired = /expired/i.test(String(error?.message || ''));
      throw new HttpError(401, expired ? ERROR_CODE.EXPIRED : ERROR_CODE.UNAUTHORIZED, String(error?.message || 'invalid worker token'));
    }
    const worker = await store.getWorkerById(String(payload.wid));
    if (!worker) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'unknown worker');
    return worker;
  }

  // -------------------------------------------------------------------------
  // Worker endpoints
  // -------------------------------------------------------------------------

  // Registration accepts EITHER an owner session token (the owner registering
  // their own machine) OR a one-time registration code (a friend running the
  // installer). Either way the worker never learns a Supabase key.
  async function handleWorkerRegister(body, headers) {
    const workerName = sanitizeText(body.worker_name || body.workerName, 80).trim();
    if (!workerName) throw bad('worker_name is required');

    // The installer generates the worker id once and keeps it in its config,
    // so the secret hash is computable before the row exists and a worker
    // never sits in the database with a placeholder credential.
    const workerId = sanitizeText(body.worker_id || body.workerId, 64).trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workerId)) {
      throw bad('worker_id must be a uuid generated by the installer');
    }

    const secret = sanitizeText(body.worker_secret || body.workerSecret, 400);
    if (secret.length < 32) throw bad('worker_secret must be at least 32 characters');

    // Re-registering an existing worker must prove it holds the current
    // secret. Without this, anyone holding a registration code could take over
    // a worker id that belongs to someone else's machine.
    const existing = await store.getWorkerById(workerId);
    if (existing) {
      const proof = sanitizeText(body.previous_secret || body.previousSecret, 400) || secret;
      const proofHash = await hashWorkerSecret(workerId, proof);
      if (proofHash !== existing.worker_secret_hash) {
        throw new HttpError(409, ERROR_CODE.CONFLICT,
          'this worker id is already registered; supply previous_secret to rotate its credential');
      }
    }

    let ownerId = '';
    const code = sanitizeText(body.registration_code || body.registrationCode, 200).trim();
    if (existing) {
      // An existing worker keeps its owner; a registration code cannot move it.
      ownerId = String(existing.owner_id);
    } else if (code) {
      const codeHash = await sha256Hex('novaflow-web-registration-code:v1:' + code);
      const owner = await store.consumeRegistrationCode(codeHash);
      if (!owner) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'registration code is invalid or used up');
      ownerId = String(owner.owner_id);
    } else {
      const user = await requireUser(headers);
      ownerId = String(user.id);
    }

    const hardware = body.hardware && typeof body.hardware === 'object' ? body.hardware : {};
    const secretHash = await hashWorkerSecret(workerId, secret);
    const registered = await store.registerWorker({
      workerId,
      ownerId,
      workerName,
      secretHash,
      hardware: {
        gpu_name: sanitizeText(hardware.gpu_name, 200),
        vram_mb: clampInt(hardware.vram_mb, 0, 4194304, 0),
        ram_mb: clampInt(hardware.ram_mb, 0, 16777216, 0),
        driver_version: sanitizeText(hardware.driver_version, 80),
        cuda_version: sanitizeText(hardware.cuda_version, 80),
        worker_version: sanitizeText(hardware.worker_version, 40),
        comfy_version: sanitizeText(hardware.comfy_version, 40),
        endpoint_url: sanitizeText(hardware.endpoint_url, 500),
        transport: hardware.transport === 'tunnel' ? 'tunnel' : 'direct'
      }
    });

    const token = await issueWorkerToken(registered, controlSecret, 24 * 3600);
    const grantKey = await deriveWorkerGrantKey(registered.id, controlSecret);
    log('worker registered', { workerId: registered.id, name: workerName });
    return {
      ok: true,
      worker: publicWorker(registered),
      workerToken: token,
      // The worker needs this to verify grants addressed to itself. It is
      // derived from the control secret and is useless for any other worker.
      grantKey,
      heartbeatIntervalSeconds: Math.floor(HEARTBEAT_TIMEOUT_SECONDS / 3)
    };
  }

  // Exchange worker_id + worker_secret for a fresh nfw_ token.
  async function handleWorkerLogin(body) {
    const workerId = sanitizeText(body.worker_id || body.workerId, 64);
    const secret = sanitizeText(body.worker_secret || body.workerSecret, 400);
    if (!workerId || !secret) throw bad('worker_id and worker_secret are required');
    const worker = await store.getWorkerById(workerId);
    if (!worker) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'unknown worker');
    const hash = await hashWorkerSecret(workerId, secret);
    if (hash !== worker.worker_secret_hash) {
      throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'worker secret mismatch');
    }
    const token = await issueWorkerToken(worker, controlSecret, 24 * 3600);
    const grantKey = await deriveWorkerGrantKey(worker.id, controlSecret);
    return { ok: true, worker: publicWorker(worker), workerToken: token, grantKey };
  }

  async function handleHeartbeat(body, headers) {
    const worker = await requireWorker(headers);
    const updated = await store.heartbeat({
      workerId: worker.id,
      status: sanitizeText(body.status, 20) || 'idle',
      currentTaskId: body.current_task_id || body.currentTaskId || null,
      hardware: body.hardware && typeof body.hardware === 'object' ? body.hardware : {}
    });
    return { ok: true, worker: publicWorker(updated), serverTime: new Date().toISOString() };
  }

  async function handleWorkerModels(body, headers) {
    const worker = await requireWorker(headers);
    const models = Array.isArray(body.models) ? body.models.slice(0, 64) : [];
    const count = await store.reportModels(worker.id, models.map((m) => ({
      model_id: sanitizeText(m?.model_id ?? m?.modelId, 120),
      model_version: sanitizeText(m?.model_version ?? m?.modelVersion, 80),
      status: sanitizeText(m?.status, 20) || 'missing',
      detail: m?.detail && typeof m.detail === 'object' ? m.detail : {}
    })));
    return { ok: true, accepted: count };
  }

  async function handleClaim(headers) {
    const worker = await requireWorker(headers);
    const task = await store.claimTask(worker.id, HEARTBEAT_TIMEOUT_SECONDS);
    if (!task) return { ok: true, task: null };
    const grantKey = await deriveWorkerGrantKey(worker.id, controlSecret);
    log('task claimed', { taskId: task.id, workerId: worker.id });
    return {
      ok: true,
      task: workerTaskView(task),
      grantKey
    };
  }

  async function handleWorkerProgress(taskId, body, headers) {
    const worker = await requireWorker(headers);
    const to = sanitizeText(body.status, 20) || TASK_STATE.PROCESSING;
    if (![TASK_STATE.UPLOADING, TASK_STATE.PROCESSING].includes(to)) {
      throw bad('progress may only report uploading or processing');
    }
    const task = await store.updateTaskStatus({
      taskId,
      workerId: worker.id,
      toStatus: to,
      progress: Number.isFinite(Number(body.progress)) ? Math.min(100, Math.max(0, Number(body.progress))) : null,
      note: sanitizeText(body.note, 200),
      detail: {
        actor: 'worker',
        prompt_id: sanitizeText(body.prompt_id || body.promptId, 160)
      }
    });
    return { ok: true, task: publicTask(task) };
  }

  // Completion is the ONLY place credits are charged, and the amount comes
  // from the price we quoted at creation - recomputed here from the stored
  // manifest, never from anything the worker sent (spec 17).
  async function handleWorkerComplete(taskId, body, headers) {
    const worker = await requireWorker(headers);
    const current = await store.getTask(taskId);
    if (!current) throw new HttpError(404, ERROR_CODE.NOT_FOUND, 'unknown task');
    if (String(current.assigned_worker_id) !== String(worker.id)) {
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'task is not assigned to this worker');
    }

    const promptId = sanitizeText(body.prompt_id || body.promptId, 160);
    if (!promptId) throw bad('prompt_id is required so settlement stays idempotent');

    // A worker retrying after a dropped response must get a clean answer, not
    // an error about a task it already finished. Settlement is keyed on the
    // prompt id, so replaying charges nothing extra either way.
    if (current.status === TASK_STATE.COMPLETED) {
      return { ok: true, task: publicTask(current), idempotent: true, settlement: null };
    }

    const outputs = Array.isArray(body.outputs) ? body.outputs.slice(0, 32) : [];
    const outputManifest = {
      files: outputs.map((f) => ({
        name: sanitizeText(f?.name, 128),
        kind: sanitizeText(f?.kind, 32) || 'image',
        bytes: clampInt(f?.bytes, 0, 8 * 1024 * 1024 * 1024, 0),
        width: clampInt(f?.width, 0, 16384, 0),
        height: clampInt(f?.height, 0, 16384, 0),
        duration_seconds: Number(f?.duration_seconds) || 0
      })).filter((f) => f.name),
      worker_id: String(worker.id),
      endpoint_url: String(worker.endpoint_url || ''),
      execution: {
        elapsed_ms: clampInt(body?.execution?.elapsed_ms, 0, 86_400_000, 0),
        comfy_version: sanitizeText(body?.execution?.comfy_version, 40)
      },
      expires_at: new Date(Date.now() + resultTtlSeconds(current.task_type) * 1000).toISOString()
    };

    // A task can finish before any progress ping lands (a 4-step image is
    // quick). The state machine still requires work to be marked started, so
    // walk it through processing here rather than making every worker
    // remember to.
    if ([TASK_STATE.ASSIGNED, TASK_STATE.UPLOADING].includes(current.status)) {
      await store.updateTaskStatus({
        taskId,
        workerId: worker.id,
        toStatus: TASK_STATE.PROCESSING,
        progress: null,
        note: 'started',
        detail: { actor: 'worker', prompt_id: promptId }
      });
    }

    // Recompute the price from the stored input manifest. The worker has no
    // say in it, and a replayed completion settles the same usage key.
    const parameters = current.input_manifest?.parameters || {};
    const pricing = priceTask(current.task_type, parameters);

    const task = await store.updateTaskStatus({
      taskId,
      workerId: worker.id,
      toStatus: TASK_STATE.COMPLETED,
      progress: 100,
      note: 'done',
      detail: { actor: 'worker', prompt_id: promptId, output_manifest: outputManifest }
    });

    let settlement = null;
    // Nothing to settle when nothing was charged. Calling the settlement RPC
    // with a zero amount would write a usage row implying a third party billed
    // for this, which nobody did.
    if (pricing.creditCost <= 0) {
      settlement = { ok: true, skipped: 'self_hosted', charged: 0 };
      await store.markCharged(taskId, 0);
    } else try {
      settlement = await store.settleCredits({
        userId: current.user_id,
        promptId,
        taskType: current.task_type,
        modelId: current.model_id,
        estimatedCreditCost: Number(current.estimated_credit_cost || 0),
        chargeAmount: pricing.creditCost,
        pricingSource: pricing.source,
        pricingDetails: { runtime: 'comfyui', web: true, breakdown: pricing.breakdown }
      });
      await store.markCharged(taskId, pricing.creditCost);
    } catch (error) {
      // The work really happened and the user can see the result, so we do not
      // roll the task back to failed. We record that settlement is outstanding
      // and let the operator reconcile - losing a charge is recoverable,
      // charging for a result the user cannot see is not.
      log('settlement failed', { taskId, error: String(error?.message || error) });
      settlement = { ok: false, error: String(error?.message || error) };
    }

    return { ok: true, task: publicTask(task), pricing, settlement };
  }

  async function handleWorkerFail(taskId, body, headers) {
    const worker = await requireWorker(headers);
    // No settlement on this path at all - a failed task cannot be charged
    // because there is no code here that charges (spec 16, 17).
    const task = await store.updateTaskStatus({
      taskId,
      workerId: worker.id,
      toStatus: TASK_STATE.FAILED,
      progress: null,
      note: sanitizeText(body.note, 200),
      detail: {
        actor: 'worker',
        error_code: sanitizeText(body.error_code || body.errorCode, 80) || 'worker_error',
        error_message: sanitizeText(body.error_message || body.errorMessage, 500)
      }
    });
    return { ok: true, task: publicTask(task), charged: false };
  }

  // -------------------------------------------------------------------------
  // User endpoints
  // -------------------------------------------------------------------------

  async function handleCreateTask(body, headers) {
    const user = await requireUser(headers);
    const taskType = sanitizeText(body.task_type || body.taskType, 80);

    // Two ways in. A fixed task type is the simple API. A renderer workflow
    // carries {module, method} instead, because NovaFlow's own panels decide
    // which builder to run - and the ALLOW-LIST here is what stops a browser
    // reaching a builder nobody vetted.
    const workflow = body.workflow && typeof body.workflow === 'object' ? body.workflow : null;
    let req;
    let parameters;
    let pricing;
    let inputWorkflow = null;

    if (taskType === 'renderer_workflow') {
      const moduleName = sanitizeText(workflow && workflow.module, 120);
      const method = sanitizeText(workflow && workflow.method, 80);
      if (!isAllowedWorkflowCall(moduleName, method)) {
        throw bad('workflow not available on the web: ' + moduleName + '.' + method);
      }
      const entry = workflowModule(moduleName);
      req = { modelId: entry.modelId, minVramMb: entry.minVramMb, kind: entry.kind };
      // The renderer's options are its own shape, so they are carried through
      // rather than reshaped - but the COST is still derived here, from the
      // dimensions and duration we can read out of them.
      parameters = sanitizeWorkflowOptions(body.parameters);
      pricing = priceTask(entry.price === 'video' ? 'h3_i2v' : 'qwen_t2i', pricingViewOf(parameters));
      inputWorkflow = { module: moduleName, method };
    } else {
      if (!isKnownTaskType(taskType)) throw bad('unsupported task type: ' + taskType);
      req = requirementsFor(taskType);
      parameters = validateTaskParameters(taskType, body.parameters);
      pricing = priceTask(taskType, parameters);
    }

    // A task that costs nothing is not gated on a balance. Reading credits at
    // all would only create a way for a zero-credit account to be refused work
    // its own GPU was about to do for free.
    if (pricing.creditCost > 0) {
      const balance = await store.getCreditBalance(user.id);
      if (Number(balance) < pricing.creditCost) {
        throw new HttpError(402, ERROR_CODE.INSUFFICIENT_CREDITS,
          'not enough credits for this task', { required: pricing.creditCost, balance: Number(balance) });
      }
    }

    // Fail fast when nothing online can run it, instead of parking the task in
    // a queue nobody drains.
    const capable = await store.countCapableWorkers(req.modelId, req.minVramMb, HEARTBEAT_TIMEOUT_SECONDS);
    const inputManifest = {
      parameters,
      min_vram_mb: req.minVramMb,
      protocol: PROTOCOL_VERSION,
      created_from: 'web',
      workflow: inputWorkflow,
      references: sanitizeReferences(body.references)
    };

    const task = await store.createTask({
      userId: user.id,
      taskType,
      modelId: req.modelId,
      inputManifest,
      estimatedCreditCost: pricing.creditCost,
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString()
    });

    log('task created', { taskId: task.id, taskType, capable });
    return {
      ok: true,
      task: publicTask(task),
      pricing,
      capableWorkers: capable,
      warning: capable === 0 ? 'no worker with this model is online right now; the task will wait in the queue' : null
    };
  }

  async function handleGetTask(taskId, headers) {
    const user = await requireUser(headers);
    const task = await store.getTask(taskId);
    // Another user's task is indistinguishable from a task that does not
    // exist, so probing ids leaks nothing (spec 26).
    if (!task || String(task.user_id) !== String(user.id)) {
      throw new HttpError(404, ERROR_CODE.NOT_FOUND, 'unknown task');
    }
    return { ok: true, task: publicTask(task) };
  }

  async function handleListTasks(query, headers) {
    const user = await requireUser(headers);
    const limit = clampInt(query.limit, 1, 100, 30);
    const tasks = await store.listTasks(user.id, limit);
    return { ok: true, tasks: tasks.map(publicTask) };
  }

  async function handleCancelTask(taskId, headers) {
    const user = await requireUser(headers);
    const task = await store.getTask(taskId);
    if (!task || String(task.user_id) !== String(user.id)) {
      throw new HttpError(404, ERROR_CODE.NOT_FOUND, 'unknown task');
    }
    const updated = await store.updateTaskStatus({
      taskId,
      workerId: null,
      toStatus: TASK_STATE.CANCELLED,
      progress: null,
      note: 'cancelled by user',
      detail: { actor: 'user' }
    });
    return { ok: true, task: publicTask(updated) };
  }

  // A grant is the ONLY way a browser gets to touch a worker. It is minted
  // here, bound to {user, task, worker, op}, and signed with the target
  // worker's derived key so no other worker will accept it (spec 11).
  async function handleTaskGrant(taskId, body, headers) {
    const user = await requireUser(headers);
    const task = await store.getTask(taskId);
    if (!task || String(task.user_id) !== String(user.id)) {
      throw new HttpError(404, ERROR_CODE.NOT_FOUND, 'unknown task');
    }
    if (!task.assigned_worker_id) {
      throw new HttpError(409, ERROR_CODE.CONFLICT, 'task has no assigned worker yet');
    }
    const op = sanitizeText(body.op, 20) === GRANT_OP.DOWNLOAD ? GRANT_OP.DOWNLOAD : GRANT_OP.UPLOAD;
    if (op === GRANT_OP.UPLOAD && ![TASK_STATE.ASSIGNED, TASK_STATE.UPLOADING].includes(task.status)) {
      throw new HttpError(409, ERROR_CODE.CONFLICT, 'uploads are only accepted while the task is assigned');
    }
    if (op === GRANT_OP.DOWNLOAD && task.status !== TASK_STATE.COMPLETED) {
      throw new HttpError(409, ERROR_CODE.CONFLICT, 'results are not ready');
    }
    if (op === GRANT_OP.DOWNLOAD && task.result_expired) {
      throw new HttpError(410, ERROR_CODE.EXPIRED, 'results have been cleaned up');
    }

    const worker = await store.getWorkerById(task.assigned_worker_id);
    if (!worker) throw new HttpError(409, ERROR_CODE.CONFLICT, 'assigned worker is gone');

    const grantKey = await deriveWorkerGrantKey(worker.id, controlSecret);
    const ttlSeconds = op === GRANT_OP.DOWNLOAD ? GRANT_DOWNLOAD_TTL_SECONDS : GRANT_TTL_SECONDS;
    const token = await issueGrantToken(
      { userId: user.id, taskId: task.id, workerId: worker.id, op, ttlSeconds },
      grantKey
    );
    return {
      ok: true,
      grant: {
        token,
        op,
        taskId: task.id,
        workerId: worker.id,
        endpoint: String(worker.endpoint_url || ''),
        transport: String(worker.transport || 'direct'),
        expiresAt: new Date((nowSeconds() + ttlSeconds) * 1000).toISOString()
      }
    };
  }

  // ---- task files ------------------------------------------------------
  //
  // The route a task's bytes take between a browser and a worker that cannot
  // reach each other. Both ask here for a short-lived signed URL against an
  // object store both CAN reach, so neither needs an address for the other.
  // task-files.mjs says why this exists at all.
  //
  // One handler for both callers because the rules are the same shape: you may
  // touch a task's files if you are the user who owns it or the worker it was
  // assigned to, and only in the direction and at the time that makes sense.
  async function handleTaskFiles(taskId, body, headers, actor) {
    // Authenticate BEFORE looking the task up. The other way round, a caller
    // with no credentials at all learns which task ids exist from the
    // difference between 404 and 401 - and it also makes "route is missing"
    // and "task is not there" the same answer, which is how this ordering was
    // caught: the bundle verifier could not tell them apart either.
    const user = actor === 'user' ? await requireUser(headers) : null;
    const worker = actor === 'user' ? null : await requireWorker(headers);

    const task = await store.getTask(taskId);
    if (!task) throw new HttpError(404, ERROR_CODE.NOT_FOUND, 'unknown task');

    if (user) {
      if (String(task.user_id) !== String(user.id)) {
        // Not 403: a task that is not yours should not be distinguishable from
        // one that does not exist.
        throw new HttpError(404, ERROR_CODE.NOT_FOUND, 'unknown task');
      }
    } else if (String(task.assigned_worker_id || '') !== String(worker.id)) {
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'task is not assigned to this worker');
    }

    if (!store.files) {
      throw new HttpError(501, ERROR_CODE.UNAVAILABLE, 'this control plane has no object store configured');
    }

    const op = sanitizeText(body.op, 20) === 'download' ? 'download' : 'upload';

    // Inputs only. Results never come this way: they were generated on the
    // worker's own disk and are served from it directly, which is the whole
    // point of the tunnel - a finished video has no reason to make a round
    // trip through anyone's storage, and that round trip is what would
    // exhaust a free tier.
    //
    // So this route carries the other direction, which the tunnel refuses by
    // design: nothing reachable from the internet may write to a worker's
    // disk. A reference image is a few MB and is deleted when the task ends.
    const kind = FILE_KIND.INPUT;
    if (sanitizeText(body.kind, 20) === FILE_KIND.OUTPUT) {
      throw new HttpError(403, ERROR_CODE.FORBIDDEN,
        'results are served from the worker, not from storage');
    }
    if (op === 'upload' && actor === 'worker') {
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'a worker does not upload inputs');
    }

    const names = Array.isArray(body.names) ? body.names.slice(0, 32) : [];
    if (!names.length) throw new HttpError(400, ERROR_CODE.BAD_REQUEST, 'names is required');

    const files = {};
    for (const raw of names) {
      const name = safeFileName(sanitizeText(raw, 200));
      const objectPath = taskObjectPath(task.id, kind, name);
      files[name] = op === 'upload'
        ? await store.files.signUpload(objectPath, FILE_URL_TTL_SECONDS)
        : await store.files.signDownload(objectPath, FILE_URL_TTL_SECONDS);
    }

    return {
      ok: true,
      op,
      kind,
      taskId: task.id,
      files,
      expiresAt: new Date((nowSeconds() + FILE_URL_TTL_SECONDS) * 1000).toISOString()
    };
  }

  /**
   * A worker reporting that a task's results have aged out.
   *
   * The worker already deletes its own copy on a timer. Nothing told the
   * control plane, so result_expired was never set outside the test suite -
   * and once files also live in an object store, nothing would ever delete
   * them either. A bucket that only grows is not a working product.
   *
   * A worker may only expire tasks it ran.
   */
  async function handleWorkerExpire(body, headers) {
    const worker = await requireWorker(headers);
    const ids = (Array.isArray(body.taskIds) ? body.taskIds : []).slice(0, 200);
    const mine = [];
    for (const id of ids) {
      const task = await store.getTask(sanitizeText(id, 64));
      if (task && String(task.assigned_worker_id || '') === String(worker.id)) mine.push(task.id);
    }
    if (!mine.length) return { ok: true, expired: 0 };

    await store.markResultsExpired(mine);
    if (store.files && store.files.removePrefix) {
      for (const id of mine) {
        await store.files.removePrefix(taskObjectPrefix(id)).catch(() => {});
      }
    }
    return { ok: true, expired: mine.length };
  }

  // ---- adding a compute node -------------------------------------------
  //
  // Bringing a new machine online must not require touching the database, an
  // IP, a .env or the source. An owner mints a code here, the installer takes
  // it, and the machine registers itself. A cloud GPU, a friend's PC and the
  // owner's own desktop all use this same path.
  async function handleCreateRegistrationCode(body, headers) {
    const user = await requireUser(headers);
    const label = sanitizeText(body.label, 80);
    const maxUses = clampInt(body.max_uses ?? body.maxUses, 1, 50, 1);
    const days = clampInt(body.valid_days ?? body.validDays, 1, 90, 7);

    // The plaintext is returned ONCE and never stored; the row holds a hash,
    // so a database read cannot yield a usable code.
    const code = 'NFW-' + randomChunk() + '-' + randomChunk();
    const codeHash = await sha256Hex('novaflow-web-registration-code:v1:' + code);
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

    await store.createRegistrationCode({
      ownerId: user.id, codeHash, label, maxUses, expiresAt
    });

    log('registration code minted', { owner: user.id, maxUses, days });
    return {
      ok: true,
      registration_code: code,
      label,
      max_uses: maxUses,
      expires_at: expiresAt,
      instructions: '在新机器上安装 NovaFlowWorkerSetup.exe，填入控制面地址和这个注册码，点启动即可。'
    };
  }

  async function handleListRegistrationCodes(headers) {
    const user = await requireUser(headers);
    const rows = await store.listRegistrationCodes(user.id);
    // Never the hash, and never anything from which a code could be rebuilt.
    return {
      ok: true,
      codes: rows.map((r) => ({
        label: r.label,
        max_uses: r.max_uses,
        used_count: r.used_count,
        remaining: Math.max(0, Number(r.max_uses) - Number(r.used_count)),
        expires_at: r.expires_at,
        created_at: r.created_at,
        expired: Date.parse(r.expires_at) <= Date.now()
      }))
    };
  }

  async function handleRevokeRegistrationCodes(body, headers) {
    const user = await requireUser(headers);
    const label = sanitizeText(body.label, 80);
    const count = await store.revokeRegistrationCodes(user.id, label || null);
    return { ok: true, revoked: count };
  }

  async function handleListWorkers(headers) {
    const user = await requireUser(headers);
    const workers = await store.listWorkers(user.id);
    return { ok: true, workers: workers.map(publicWorker) };
  }

  // The credit balance the Web app shows. Read here rather than from
  // novaflow-backend so the same call works against the local control plane
  // during acceptance and against Supabase in production.
  async function handleMe(headers) {
    const user = await requireUser(headers);
    const balance = await store.getCreditBalance(user.id);
    return {
      ok: true,
      user: { id: user.id, email: user.email, display_name: user.display_name || '' },
      credits: { balance: Number(balance) }
    };
  }

  // Public on purpose. The app has to be able to say "算力可用" before anyone
  // logs in, and a COUNT is all it needs: no names, no GPUs, no endpoints, no
  // owners. Whose machines they are stays behind a session.
  async function handleCapabilities() {
    const entries = Object.entries(TASK_TYPE_REQUIREMENTS);
    const counts = await Promise.all(entries.map(([, value]) =>
      store.countCapableWorkers(value.modelId, value.minVramMb, HEARTBEAT_TIMEOUT_SECONDS)
        .catch(() => 0)
    ));
    const taskTypes = entries.map(([key, value], i) => ({
      task_type: key,
      model_id: value.modelId,
      min_vram_mb: value.minVramMb,
      kind: value.kind,
      label: value.label,
      available_workers: counts[i]
    }));
    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      taskTypes,
      available_workers: Math.max(0, ...counts),
      models: MODEL_MANIFEST.map((m) => ({
        model_id: m.model_id,
        display_name: m.display_name,
        version: m.version,
        min_vram_mb: m.min_vram_mb
      }))
    };
  }

  async function handleSweep(body, headers) {
    // The sweeper is infrastructure, not a user action. It is authorised with
    // the control secret so a logged-in user cannot drive recovery timing.
    const provided = bearerToken(headers.authorization || headers.Authorization);
    if (!controlSecret || provided !== controlSecret) {
      throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'sweeper requires the control secret');
    }
    const result = await store.sweep({
      heartbeatTimeoutSeconds: clampInt(body.heartbeatTimeoutSeconds, 5, 3600, HEARTBEAT_TIMEOUT_SECONDS),
      assignTimeoutSeconds: clampInt(body.assignTimeoutSeconds, 10, 7200, ASSIGN_TIMEOUT_SECONDS),
      processingTimeoutSeconds: clampInt(body.processingTimeoutSeconds, 60, 86400, PROCESSING_TIMEOUT_SECONDS),
      maxAttempts: clampInt(body.maxAttempts, 1, 20, MAX_TASK_ATTEMPTS)
    });
    return { ok: true, sweep: result };
  }

  // -------------------------------------------------------------------------
  // Router
  // -------------------------------------------------------------------------
  async function handle(request) {
    const method = String(request.method || 'GET').toUpperCase();
    const path = normalizePath(request.path);
    const headers = request.headers || {};
    const query = request.query || {};
    const body = request.body && typeof request.body === 'object' ? request.body : {};

    try {
      if (method === 'OPTIONS') return { status: 204, body: null };
      if (method === 'GET' && path === '/health') {
        return ok({ ok: true, service: 'novaflow-web-control', protocol: PROTOCOL_VERSION, status: 'running' });
      }
      if (method === 'GET' && path === '/api/web/capabilities') return ok(await handleCapabilities());
      if (method === 'GET' && path === '/api/web/me') return ok(await handleMe(headers));

      if (method === 'POST' && path === '/api/worker/register') return ok(await handleWorkerRegister(body, headers));
      if (method === 'POST' && path === '/api/worker/login') return ok(await handleWorkerLogin(body));
      if (method === 'POST' && path === '/api/worker/heartbeat') return ok(await handleHeartbeat(body, headers));
      if (method === 'POST' && path === '/api/worker/models') return ok(await handleWorkerModels(body, headers));
      if (method === 'POST' && path === '/api/worker/claim') return ok(await handleClaim(headers));
      if (method === 'POST' && path === '/api/worker/expire') return ok(await handleWorkerExpire(body, headers));

      let m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/(progress|complete|fail)$/);
      if (m && method === 'POST') {
        const [, taskId, action] = m;
        if (action === 'progress') return ok(await handleWorkerProgress(taskId, body, headers));
        if (action === 'complete') return ok(await handleWorkerComplete(taskId, body, headers));
        return ok(await handleWorkerFail(taskId, body, headers));
      }

      if (method === 'POST' && path === '/api/web/tasks') return ok(await handleCreateTask(body, headers));
      if (method === 'GET' && path === '/api/web/tasks') return ok(await handleListTasks(query, headers));
      if (method === 'GET' && path === '/api/web/workers') return ok(await handleListWorkers(headers));
      if (method === 'POST' && path === '/api/web/workers/codes') return ok(await handleCreateRegistrationCode(body, headers));
      if (method === 'GET' && path === '/api/web/workers/codes') return ok(await handleListRegistrationCodes(headers));
      if (method === 'POST' && path === '/api/web/workers/codes/revoke') return ok(await handleRevokeRegistrationCodes(body, headers));

      m = path.match(/^\/api\/web\/tasks\/([^/]+)$/);
      if (m && method === 'GET') return ok(await handleGetTask(m[1], headers));

      m = path.match(/^\/api\/web\/tasks\/([^/]+)\/cancel$/);
      if (m && method === 'POST') return ok(await handleCancelTask(m[1], headers));

      m = path.match(/^\/api\/web\/tasks\/([^/]+)\/grant$/);
      if (m && method === 'POST') return ok(await handleTaskGrant(m[1], body, headers));

      m = path.match(/^\/api\/web\/tasks\/([^/]+)\/files$/);
      if (m && method === 'POST') return ok(await handleTaskFiles(m[1], body, headers, 'user'));

      m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/files$/);
      if (m && method === 'POST') return ok(await handleTaskFiles(m[1], body, headers, 'worker'));

      if (method === 'POST' && path === '/api/maintenance/sweep') return ok(await handleSweep(body, headers));

      return { status: 404, body: { ok: false, error: 'not found', code: ERROR_CODE.NOT_FOUND } };
    } catch (error) {
      if (error instanceof HttpError) {
        return {
          status: error.status,
          body: { ok: false, error: error.message, code: error.code, ...(error.extra || {}) }
        };
      }
      const message = String(error?.message || error);
      if (/illegal transition|is already|not assigned to this worker/i.test(message)) {
        return {
          status: 409,
          body: { ok: false, error: message.replace(/^.*?:\s*/, ''), code: ERROR_CODE.CONFLICT }
        };
      }
      log('control plane error', { path, error: String(error?.stack || error) });
      return { status: 500, body: { ok: false, error: 'internal error', code: 'internal_error' } };
    }
  }

  return { handle, validateTaskParameters, MAX_BODY_BYTES };
}

function ok(body) {
  return { status: 200, body };
}

function normalizePath(path) {
  let value = String(path || '/');
  const q = value.indexOf('?');
  if (q >= 0) value = value.slice(0, q);
  // Supabase serves an edge function under /functions/v1/<name>/...; strip that
  // prefix so the same routes work locally and deployed.
  value = value.replace(/^\/functions\/v1\/novaflow-web/, '');
  if (!value.startsWith('/')) value = '/' + value;
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function resultTtlSeconds(taskType) {
  const req = requirementsFor(taskType);
  if (req?.kind === 'video') return TTL_SECONDS.video;
  return TTL_SECONDS.image;
}

// The secret hash never leaves the server.
function publicWorker(worker) {
  if (!worker) return null;
  return {
    id: worker.id,
    worker_name: worker.worker_name,
    status: worker.status,
    gpu_name: worker.gpu_name,
    vram_mb: worker.vram_mb,
    ram_mb: worker.ram_mb,
    worker_version: worker.worker_version,
    comfy_version: worker.comfy_version,
    endpoint_url: worker.endpoint_url,
    transport: worker.transport,
    current_task_id: worker.current_task_id,
    last_heartbeat: worker.last_heartbeat,
    total_assigned: worker.total_assigned,
    total_completed: worker.total_completed,
    total_failed: worker.total_failed,
    created_at: worker.created_at
  };
}

function publicTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    task_type: task.task_type,
    model_id: task.model_id,
    status: task.status,
    progress: Number(task.progress || 0),
    progress_note: task.progress_note || '',
    assigned_worker_id: task.assigned_worker_id || null,
    output_manifest: task.output_manifest || {},
    // The full input manifest stays server-side; the browser gets back only
    // the parameters it already sent.
    parameters: task.input_manifest?.parameters || {},
    estimated_credit_cost: Number(task.estimated_credit_cost || 0),
    charged_credit_cost: Number(task.charged_credit_cost || 0),
    credit_settled: Boolean(task.credit_settled),
    attempt_count: Number(task.attempt_count || 0),
    error_code: task.error_code || '',
    error_message: task.error_message || '',
    result_expired: Boolean(task.result_expired),
    created_at: task.created_at,
    queued_at: task.queued_at,
    assigned_at: task.assigned_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
    failed_at: task.failed_at,
    expires_at: task.expires_at
  };
}

// What a worker is allowed to see about the task it just claimed: the business
// parameters it needs to fill a workflow, and nothing about the user.
function workerTaskView(task) {
  return {
    id: task.id,
    task_type: task.task_type,
    model_id: task.model_id,
    status: task.status,
    parameters: task.input_manifest?.parameters || {},
    // Which of NovaFlow's own builders to run, when the task came from the
    // renderer rather than from a fixed task type.
    workflow: task.input_manifest?.workflow || null,
    references: task.input_manifest?.references || [],
    attempt_count: Number(task.attempt_count || 0),
    assigned_at: task.assigned_at,
    expires_at: task.expires_at
  };
}

export { HttpError, publicTask, publicWorker };
