// GENERATED COPY - do not edit here.
// Source: packages/shared/src/control-plane.mjs
// Regenerate with: npm run sync:edge
import { commonLoraCatalog } from './lora-catalog.mjs';
import { RELEASE_VERSION } from './release.mjs';
import { createArtKnowledgeRoutes } from './art-knowledge.mjs';
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
  AUDIO_LIMITS,
  TASK_TYPE,
  MATTING_TASK_TYPE,
  PROMPT_ASSISTANT_ACTIONS,
  PROMPT_ASSISTANT_REQUEST_FILE,
  PROMPT_ASSISTANT_TASK_TYPE,
  MAX_TASK_ATTEMPTS,
  PROTOCOL_VERSION,
  TASK_STATE,
  TASK_TYPE_REQUIREMENTS,
  TTL_SECONDS,
  canUseSharedCompute,
  canUsePremiumNodes,
  estimateQueueWait,
  isKnownTaskType,
  normalizeNodeTier,
  planAllowsNode,
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
import { isAllowedWorkflowCall, workflowModule, workflowModelId } from './workflow-modules.mjs';
import { MODEL_MANIFEST, QWEN21_MODEL_ID, findModel } from './model-manifest.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PROMPT_CHARS = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Matting is tagged kind:'video' so the scheduler treats it as video work,
  // but it is not a generation: there is no prompt, no seed, and the frame
  // size is whatever the user's clip already is rather than something we pick.
  // It has to be answered before the generation branch below, which would
  // clamp the real dimensions to its own range and reject the job for having
  // no reference IMAGE.
  if (taskType === MATTING_TASK_TYPE) {
    // Not clampInt: clamping to [1, 300] turns a missing or zero count into 1
    // and a 400-frame request into 300, and either one then disagrees with the
    // frame times packed below - the worker would matte a different number of
    // frames than the panel is waiting for. A count we cannot honour exactly
    // is a refusal, not something to round.
    const frameCount = Math.floor(Number(input.frame_count));
    if (!Number.isFinite(frameCount) || frameCount < 1) throw bad('a matting task needs frame_count');
    if (frameCount > 300) throw bad('a matting task is limited to 300 frames, got ' + frameCount);
    if (!cleanRefs.length) throw bad('a matting task needs the source video');
    if (input.input_encoding !== 'png-frames-v1') throw bad('a matting task needs verified renderer frames');
    if (cleanRefs.some(ref => ref.kind !== 'frames')) throw bad('invalid matting frame pack');

    // One base64 f32 per frame, not an array: sanitizeWorkflowOptions caps
    // arrays at 256 entries and the panel's own ceiling is 300 frames, so an
    // array of times would be silently truncated for any clip over ~8.5s.
    const times = sanitizeText(input.frame_times_f32, MAX_PROMPT_CHARS);
    if (!times) throw bad('a matting task needs frame_times_f32');
    let timeBytes;
    try { timeBytes = Uint8Array.from(atob(times), c => c.charCodeAt(0)); } catch { throw bad('invalid frame_times_f32'); }
    if (timeBytes.length !== frameCount * 4) throw bad('frame_times_f32 does not match frame_count');
    const timeView = new DataView(timeBytes.buffer);
    for (let i = 0; i < frameCount; i++) {
      const time = timeView.getFloat32(i * 4, true);
      if (!Number.isFinite(time) || time < 0) throw bad('invalid frame_times_f32 timestamp');
    }
    const width = Number(input.width), height = Number(input.height);
    if (![width, height].every(n => Number.isInteger(n) && n >= 16 && n <= 8192)) throw bad('invalid matting dimensions');

    return {
      width,
      height,
      fps: Number(input.fps) || 0,
      frame_count: frameCount,
      frame_times_f32: times,
      input_encoding: 'png-frames-v1',
      return_mask_only: input.return_mask_only !== false,
      source_name: sanitizeText(input.source_name, 128) || 'input.mp4',
      references: cleanRefs
    };
  }

  // 提示词助手: no prompt, no size, no seed. The whole request (it can hold a
  // dozen reference frames) is the one uploaded JSON file; only the action is
  // a parameter, so the body stays far under MAX_BODY_BYTES.
  if (taskType === PROMPT_ASSISTANT_TASK_TYPE) {
    const action = sanitizeText(input.action, 40);
    if (!PROMPT_ASSISTANT_ACTIONS.includes(action)) throw bad('unsupported prompt assistant action: ' + action);
    if (cleanRefs.length !== 1 || cleanRefs[0].name !== PROMPT_ASSISTANT_REQUEST_FILE || cleanRefs[0].kind !== 'json') {
      throw bad('a prompt assistant task carries its request as ' + PROMPT_ASSISTANT_REQUEST_FILE);
    }
    return { action, references: cleanRefs };
  }

  // 音频: an English caption the panel composed, a length, and for music the
  // loop settings. No reference files, no size.
  if (req.kind === 'audio') {
    if (!prompt) throw bad('an audio task needs a description');
    const music = taskType === TASK_TYPE.AUDIO_MUSIC;
    const limits = music ? AUDIO_LIMITS.music : AUDIO_LIMITS.sfx;
    const duration = Math.min(limits.maxSeconds, Math.max(limits.minSeconds, Number(input.duration_seconds) || limits.defaultSeconds));
    return {
      prompt,
      negative_prompt: negative,
      seed,
      duration_seconds: Math.round(duration * 10) / 10,
      loop: music && input.loop !== false,
      reprompt: input.reprompt !== false,
      bpm: music ? clampInt(input.bpm, 0, 300, 0) : 0,
      crossfade_ms: music ? clampInt(input.crossfade_ms, AUDIO_LIMITS.minCrossfadeMs, AUDIO_LIMITS.maxCrossfadeMs, AUDIO_LIMITS.defaultCrossfadeMs) : 0,
      references: []
    };
  }

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

export const MAX_TASK_OUTPUT_FILES = 96;

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

// A UI-design run on a Qwen-Image-2.1 node uploads up to 15 references; the
// rest is headroom.
export const MAX_TASK_REFERENCES = 20;

export function sanitizeReferences(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_TASK_REFERENCES).map((r) => ({
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
/** @param {{store:any,secrets:any,logger?:(...args:any[])=>void,companion?:{reply:(input:any)=>Promise<any>}|null}} options */
export function createControlPlane({ store, secrets, logger=()=>{}, companion=null }) {
  const log = logger || (() => {});
  const sessionSecret = secrets?.sessionSecret || '';
  const controlSecret = secrets?.controlSecret || '';
  const artKnowledge = createArtKnowledgeRoutes({store,requireUser,requireWorker,HttpError});

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
    // A token minted before user_sessions existed has no sid and stays valid
    // until its own exp. A sid whose row is gone or revoked was pushed out by
    // a newer login on the same account (or a password change).
    const userId = String(payload.sub);
    const sessionId = payload.sid ? String(payload.sid) : '';
    const [user, session] = await Promise.all([
      store.getUserById(userId),
      sessionId ? store.getUserSession(sessionId) : null
    ]);
    if (!user) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'unknown user');
    if (String(user.status || 'active').toLowerCase() !== 'active') {
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'user disabled');
    }
    const expiresAt = Date.parse(String(user.expires_at || ''));
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      throw new HttpError(403, ERROR_CODE.ACCOUNT_EXPIRED, '账号已到期，请联系管理员');
    }
    if (sessionId && (!session || String(session.user_id) !== userId || session.revoked_at)) {
      throw new HttpError(401, ERROR_CODE.SESSION_REPLACED, '账号已在其他设备登录');
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
    // The code that admits a machine also says which tier it joins as (普通 /
    // 高级节点). An owner registering their own machine gets 普通; the
    // administrator can change either later.
    let tier = '';
    const code = sanitizeText(body.registration_code || body.registrationCode, 200).trim();
    if (existing) {
      // An existing worker keeps its owner; a registration code cannot move it.
      ownerId = String(existing.owner_id);
    } else if (code) {
      const codeHash = await sha256Hex('novaflow-web-registration-code:v1:' + code);
      const owner = await store.consumeRegistrationCode(codeHash);
      if (!owner) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'registration code is invalid or used up');
      ownerId = String(owner.owner_id);
      tier = normalizeNodeTier(owner.tier);
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
        transport: hardware.transport === 'tunnel' ? 'tunnel' : 'direct',
        registration_profile: body.profile === 'compute-only' ? 'compute-only' : 'legacy'
      }
    });

    // Re-registration keeps whatever tier the administrator set; only a fresh
    // machine takes the tier from its code.
    if (!existing && tier) {
      const retiered = await store.setWorkerTier(registered.id, tier);
      if (retiered) Object.assign(registered, retiered);
    }

    const token = await issueWorkerToken(registered, controlSecret, 24 * 3600);
    const grantKey = await deriveWorkerGrantKey(registered.id, controlSecret);
    log('worker registered', { workerId: registered.id, name: workerName, tier: normalizeNodeTier(registered.tier) });
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
    let task = await store.claimTask(worker.id, HEARTBEAT_TIMEOUT_SECONDS);
    // A restarted worker reports idle, but the old task may still be assigned
    // to its identity. The scheduler then refuses every new task indefinitely.
    // Only recover when the worker has no current task, and re-read that state
    // after the failed claim so a concurrent heartbeat cannot be mistaken for
    // a restart.
    if (!task && worker.status === 'idle' && !worker.current_task_id) {
      const current = await store.getWorkerById(worker.id);
      if (current?.status === 'idle' && !current.current_task_id) {
        const abandoned = await store.listActiveAssignedTasks(worker.id);
        for (const oldTask of abandoned) {
          try {
            await store.updateTaskStatus({
              taskId: oldTask.id,
              workerId: worker.id,
              toStatus: TASK_STATE.FAILED,
              progress: null,
              note: '算力节点已重启，请重新提交任务',
              detail: {
                actor: 'scheduler',
                error_code: 'worker_restarted',
                error_message: '算力节点已重启，原任务无法继续，请重新提交'
              }
            });
            log('abandoned task failed after worker restart', { taskId: oldTask.id, workerId: worker.id });
          } catch (error) {
            // A concurrent terminal transition is harmless. Keep the claim
            // endpoint available and retry on the next normal poll.
            log('abandoned task recovery deferred', { taskId: oldTask.id, workerId: worker.id, error: String(error?.message || error) });
          }
        }
        if (abandoned.length) task = await store.claimTask(worker.id, HEARTBEAT_TIMEOUT_SECONDS);
      }
    }
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

    // 一键拆图 returns about two dozen files and an AI-effects run one clip plus its frames.
    const outputs = Array.isArray(body.outputs) ? body.outputs.slice(0, MAX_TASK_OUTPUT_FILES) : [];
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
    // Website users may use their own authorized machines independently of
    // pool membership; shared nodes still require the existing account tier.
    const requestedTarget = sanitizeText(body.target_worker_id || body.targetWorkerId, 80);
    const ownTarget = UUID_RE.test(requestedTarget) ? await store.getWorkerById(requestedTarget) : null;
    const hasOwnCompute = !canUseSharedCompute(user.plan) && !requestedTarget
      && (await store.listWorkers(user.id)).some(worker => workerAllowsUser(worker, user));
    if (!canUseSharedCompute(user.plan) && !hasOwnCompute && !(ownTarget && String(ownTarget.owner_id) === String(user.id) && workerAllowsUser(ownTarget, user))) {
      throw new HttpError(403, ERROR_CODE.PLAN_REQUIRED,
        '此账号没有获准使用的本人算力机器，请先接入助手并联系管理员设置机器归属和本人使用权限。使用其他算力节点需要中级或高级账户。',
        { plan: String(user.plan || 'trial') });
    }
    // A 中级账户 may use 普通 nodes only; the scheduler reads this flag off the
    // task so a 高级 node never picks its work up, pinned or not.
    const allowPremiumNodes = canUsePremiumNodes(user.plan) || Boolean(ownTarget && String(ownTarget.owner_id) === String(user.id));
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
      // The renderer's options are its own shape, so they are carried through
      // rather than reshaped - but the COST is still derived here, from the
      // dimensions and duration we can read out of them.
      parameters = sanitizeWorkflowOptions(body.parameters);
      req = { modelId: workflowModelId(moduleName, parameters, method), minVramMb: entry.minVramMb, kind: entry.kind };
      pricing = priceTask(entry.price === 'video' ? 'h3_i2v' : 'qwen_t2i', pricingViewOf(parameters));
      inputWorkflow = { module: moduleName, method };
    } else {
      if (!isKnownTaskType(taskType)) throw bad('unsupported task type: ' + taskType);
      req = requirementsFor(taskType);
      parameters = validateTaskParameters(taskType, taskType === MATTING_TASK_TYPE || taskType === PROMPT_ASSISTANT_TASK_TYPE
        ? { ...body.parameters, references: sanitizeReferences(body.references) }
        : body.parameters);
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

    // The topbar's 算力源 picker may pin the task to one node. The scheduler
    // (novaflow_web_claim_task) then lets only that node claim it.
    let target = null;
    const targetId = sanitizeText(body.target_worker_id || body.targetWorkerId, 80);
    if (targetId) {
      if (!UUID_RE.test(targetId)) throw bad('invalid compute node id');
      target = await store.getWorkerById(targetId);
      if (!target) throw new HttpError(404, ERROR_CODE.NOT_FOUND, '所选算力节点不存在或已移除，请重新选择算力源');
      if (!workerAllowsUser(target, user)) {
        const tierDenied = String(target.owner_id) !== String(user.id) && !planAllowsNode(user.plan, target.tier);
        throw new HttpError(403, tierDenied ? ERROR_CODE.NODE_TIER_REQUIRED : ERROR_CODE.FORBIDDEN,
          tierDenied ? '中级账户只能使用普通算力节点；使用高级算力节点需要高级账户。' : '此账号没有使用该算力机器的权限，请联系管理员。',
          { plan: String(user.plan || 'trial'), node_tier: normalizeNodeTier(target.tier) });
      }
    }

    // Fail fast when nothing online can run it, instead of parking the task in
    // a queue nobody drains. Pinned work counts its node alone; a 中级账户
    // counts 普通 nodes alone.
    const capable = await store.countCapableWorkers(req.modelId, req.minVramMb, HEARTBEAT_TIMEOUT_SECONDS,
      target ? target.id : null, allowPremiumNodes, user.id, canUseSharedCompute(user.plan));
    const inputManifest = {
      parameters,
      min_vram_mb: req.minVramMb,
      protocol: PROTOCOL_VERSION,
      created_from: 'web',
      workflow: inputWorkflow,
      references: sanitizeReferences(body.references),
      target_worker_id: target ? target.id : null,
      target_worker_name: target ? target.worker_name : null,
      allow_premium_nodes: allowPremiumNodes
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
      target: target ? { id: target.id, name: target.worker_name } : null,
      warning: capable === 0
        ? (target ? 'the chosen node is not online with this model right now; the task will wait for it'
          : 'no worker with this model is online right now; the task will wait in the queue')
        : null
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
    const queue = await queueView(task);
    return { ok: true, task: queue ? { ...publicTask(task), queue } : publicTask(task) };
  }

  // A task still waiting for a node gets its place in line: the tasks of the same model
  // running now and queued ahead of it, the nodes that can take it, and roughly when it
  // starts (estimateQueueWait over that model's recent runs). The page polls every second,
  // so the per-model part is kept a few seconds. Counts only, never whose tasks they are.
  const QUEUE_STATS_TTL_MS = 5000;
  const queueStatsCache = new Map();
  async function queueView(task) {
    if (![TASK_STATE.CREATED, TASK_STATE.QUEUED].includes(task.status)) return null;
    if (typeof store.queueSnapshot !== 'function' || typeof store.queueStats !== 'function') return null;
    try {
      const manifest = task.input_manifest || {};
      const target = manifest.target_worker_id || null;
      const key = [task.user_id, task.model_id, target || '', manifest.allow_premium_nodes === false ? 'n' : 'p'].join('|');
      let stats = queueStatsCache.get(key);
      if (!stats || Date.now() - stats.at > QUEUE_STATS_TTL_MS) {
        const [recent, workers] = await Promise.all([
          store.queueStats({ modelId: task.model_id }),
          store.countCapableWorkers(task.model_id, Number(manifest.min_vram_mb) || 0, HEARTBEAT_TIMEOUT_SECONDS,
            target, manifest.allow_premium_nodes !== false, task.user_id, true)
        ]);
        const runs = (recent.recentRuns || [])
          .map((run) => (Date.parse(run.completed_at) - Date.parse(run.started_at)) / 1000)
          .filter((seconds) => seconds > 0 && seconds < PROCESSING_TIMEOUT_SECONDS);
        stats = {
          at: Date.now(),
          workers: Number(workers) || 0,
          runningStartedAt: recent.runningStartedAt || [],
          averageSeconds: runs.length ? runs.reduce((sum, seconds) => sum + seconds, 0) / runs.length : 0
        };
        queueStatsCache.set(key, stats);
      }
      const { queuedAhead } = await store.queueSnapshot({ modelId: task.model_id, createdAt: task.created_at });
      const runningElapsed = (stats.runningStartedAt || [])
        .map((at) => (Date.now() - Date.parse(at)) / 1000).filter((seconds) => Number.isFinite(seconds));
      return {
        ahead: (Number(queuedAhead) || 0) + runningElapsed.length,
        workers: stats.workers,
        eta_seconds: stats.workers > 0
          ? estimateQueueWait({ queuedAhead, runningElapsed, averageSeconds: stats.averageSeconds, workers: stats.workers })
          : null
      };
    } catch (error) {
      log('queue view failed', { taskId: task.id, error: String(error?.message || error) });
      return null;
    }
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

  /**
   * A worker reporting that a task's results have aged out.
   *
   * The worker already deletes its own copy on a timer. Nothing told the
   * control plane, so result_expired was never set outside the test suite,
   * and the control plane went on offering a download for bytes that were
   * already gone.
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

    // Which tier the machines this code admits join as: 普通 unless asked.
    const tier = normalizeNodeTier(body.tier ?? body.node_tier ?? body.nodeTier);
    await store.createRegistrationCode({
      ownerId: user.id, codeHash, label, maxUses, expiresAt, tier
    });

    log('registration code minted', { owner: user.id, maxUses, days, tier });
    return {
      ok: true,
      registration_code: code,
      label,
      tier,
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
        tier: normalizeNodeTier(r.tier),
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

  // Every machine in the pool, for the topbar's 算力源 picker: a name, the GPU
  // and whether it is free right now. No endpoint, no owner, no secret - and
  // whether THIS account may pin one (a 高级账户), so the page can say so.
  async function handleListNodes(headers) {
    const user = await requireUser(headers);
    const rows = await store.listPoolWorkers();
    const since = Date.now() - HEARTBEAT_TIMEOUT_SECONDS * 1000;
    const rank = { idle: 0, busy: 1, offline: 2 };
    const nodes = rows.filter(w => workerAllowsUser(w, user)).map((w) => {
      const beat = w.last_heartbeat ? new Date(w.last_heartbeat).getTime() : 0;
      const online = beat > since && ['idle', 'busy'].includes(String(w.status));
      return {
        id: w.id,
        name: w.worker_name,
        gpu_name: w.gpu_name || '',
        vram_mb: Number(w.vram_mb) || 0,
        tier: normalizeNodeTier(w.tier),
        is_owner: String(w.owner_id) === String(user.id),
        can_use: true,
        policy: workerPolicy(w, String(w.owner_id) === String(user.id)),
        status: online ? String(w.status) : 'offline',
        online,
        last_heartbeat: w.last_heartbeat || null
      };
    }).sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
    return {
      ok: true,
      nodes,
      // shared: may pin any 普通 node; premium: may also pin a 高级 node.
      compute: { shared: canUseSharedCompute(user.plan), premium: canUsePremiumNodes(user.plan) }
    };
  }

  // The credit balance the Web app shows. Read here rather than from
  // novaflow-backend so the same call works against the local control plane
  // during acceptance and against Supabase in production.
  async function handleMe(headers) {
    const user = await requireUser(headers);
    const balance = await store.getCreditBalance(user.id);
    return {
      ok: true,
      user: { id: user.id, email: user.email, display_name: user.display_name || '', plan: String(user.plan || 'trial') },
      credits: { balance: Number(balance) },
      compute: { shared: canUseSharedCompute(user.plan), premium: canUsePremiumNodes(user.plan) }
    };
  }

  // Public on purpose. The app has to be able to say "算力可用" before anyone
  // logs in, and a COUNT is all it needs: no names, no GPUs, no endpoints, no
  // owners. Whose machines they are stays behind a session.
  async function handleCapabilities(query, headers = {}) {
    const user = (headers.authorization || headers.Authorization) ? await requireUser(headers) : null;
    // ?worker=<id> narrows every count to one node, for a page that pinned its
    // work there: 「AI 已连接」 then speaks for that node, not for the pool.
    const workerId = UUID_RE.test(String(query && query.worker || '')) ? String(query.worker) : null;
    const entries = Object.entries(TASK_TYPE_REQUIREMENTS);
    const counts = await Promise.all(entries.map(([, value]) =>
      store.countCapableWorkers(value.modelId, value.minVramMb, HEARTBEAT_TIMEOUT_SECONDS, workerId,
        user ? canUsePremiumNodes(user.plan) : true, user?.id || null, user ? canUseSharedCompute(user.plan) : true)
        .catch(() => 0)
    ));
    // The drawing and UI-design panels use Qwen-Image-2.1 while a node that can build it is online;
    // their runs then queue for that model (workflowModelId), so only such a node takes them.
    const qwen21 = await store.countCapableWorkers(QWEN21_MODEL_ID, findModel(QWEN21_MODEL_ID).min_vram_mb,
      HEARTBEAT_TIMEOUT_SECONDS, workerId, user ? canUsePremiumNodes(user.plan) : true, user?.id || null,
      user ? canUseSharedCompute(user.plan) : true).catch(() => 0);
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
      features: { qwenImage21: qwen21 > 0 },
      models: MODEL_MANIFEST.map((m) => ({
        model_id: m.model_id,
        display_name: m.display_name,
        version: m.version,
        min_vram_mb: m.min_vram_mb
      }))
    };
  }

  async function handleLoraCatalog(kind, query, headers, selection) {
    const user = await requireUser(headers);
    if (!['qwen', 'h3'].includes(kind)) throw bad('invalid LoRA kind');
    const mode = String(query.mode || 'i2v');
    const steps = Number(query.steps || 4);
    if (kind === 'h3' && (!['t2v','i2v','fl2v','r2v'].includes(mode) || !Number.isInteger(steps) || steps < 1 || steps > 100)) throw bad('invalid LoRA context');
    // A 2.1 run takes the LoRAs every 2.1 node can load, checked against its own 2.1 model.
    const engine = kind === 'qwen' && query.engine === 'qwen-2.1' ? 'qwen-2.1' : '';
    const modelId = kind === 'h3' ? 'minimax-h3' : engine ? QWEN21_MODEL_ID : 'qwen-image-2511';
    const rows = await store.listCapableModelDetails(modelId, kind === 'h3' ? 15000 : 16000, HEARTBEAT_TIMEOUT_SECONDS, user.id, canUsePremiumNodes(user.plan), canUseSharedCompute(user.plan));
    let items;
    try { items = commonLoraCatalog(rows, { kind, mode, steps, engine, nsfw: query.nsfw === 'true' || query.nsfw === true }); }
    catch (error) { throw new HttpError(503, 'lora_catalog_unavailable', error.message); }
    if (selection) {
      const item = items.find(item => item.name === selection.name && item.fingerprint === selection.fingerprint);
      const strength = Number(selection.strength);
      if (!item || !Number.isFinite(strength) || strength < 0 || strength > 2) throw bad('LoRA 已变化或不兼容，请重新选择');
      return { ok: true, item, strength };
    }
    return { ok: true, items };
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
      if(method==='POST'&&path==='/api/web/companion/chat'){
        const user=await requireUser(headers);
        if(!companion)throw new HttpError(503,'companion-unavailable','在线参考分析服务尚未启用');
        try{return ok({ok:true,...await companion.reply({user,payload:body})});}
        catch(error){if(error.status)throw new HttpError(error.status,'companion-failed',error.message);throw error;}
      }
      if (path.startsWith('/api/web/art-knowledge')) return ok(await artKnowledge.handle({method,path,headers,query,body}));
      if (method === 'GET' && path === '/health') {
        return ok({ ok: true, service: 'novaflow-web-control', protocol: PROTOCOL_VERSION, status: 'running', releaseVersion: RELEASE_VERSION });
      }
      if (method === 'GET' && path === '/api/web/capabilities') return ok(await handleCapabilities(query, headers));
      if (method === 'GET' && path === '/api/web/me') return ok(await handleMe(headers));
      if (method === 'GET' && path === '/api/web/loras/qwen') return ok(await handleLoraCatalog('qwen', query, headers));
      if (method === 'GET' && path === '/api/web/loras/h3') return ok(await handleLoraCatalog('h3', query, headers));
      if (method === 'POST' && path === '/api/web/loras/h3/validate') return ok(await handleLoraCatalog('h3', body, headers, body));

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
      if (method === 'GET' && path === '/api/web/nodes') return ok(await handleListNodes(headers));
      if (method === 'POST' && path === '/api/web/workers/codes') return ok(await handleCreateRegistrationCode(body, headers));
      if (method === 'GET' && path === '/api/web/workers/codes') return ok(await handleListRegistrationCodes(headers));
      if (method === 'POST' && path === '/api/web/workers/codes/revoke') return ok(await handleRevokeRegistrationCodes(body, headers));

      m = path.match(/^\/api\/web\/tasks\/([^/]+)$/);
      if (m && method === 'GET') return ok(await handleGetTask(m[1], headers));

      m = path.match(/^\/api\/web\/tasks\/([^/]+)\/cancel$/);
      if (m && method === 'POST') return ok(await handleCancelTask(m[1], headers));

      m = path.match(/^\/api\/web\/tasks\/([^/]+)\/grant$/);
      if (m && method === 'POST') return ok(await handleTaskGrant(m[1], body, headers));

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
export function workerPolicy(worker, includeAllowed = true) {
  return {
    enabled: worker.enabled !== false,
    owner_enabled: worker.owner_enabled !== false,
    sharing_enabled: worker.sharing_enabled !== false,
    sharing_scope: worker.sharing_scope === 'selected' ? 'selected' : 'pool',
    ...(includeAllowed ? { allowed_user_ids: Array.isArray(worker.allowed_user_ids) ? worker.allowed_user_ids : [] } : {})
  };
}

export function workerAllowsUser(worker, user) {
  const policy = workerPolicy(worker);
  if (!policy.enabled) return false;
  if (user && String(worker.owner_id) === String(user.id)) return policy.owner_enabled;
  return Boolean(user && canUseSharedCompute(user.plan) && planAllowsNode(user.plan, worker.tier)
    && policy.sharing_enabled && (policy.sharing_scope === 'pool' || policy.allowed_user_ids.includes(String(user.id))));
}

function publicWorker(worker) {
  if (!worker) return null;
  return {
    id: worker.id,
    worker_name: worker.worker_name,
    status: worker.status,
    tier: normalizeNodeTier(worker.tier),
    policy: workerPolicy(worker),
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
