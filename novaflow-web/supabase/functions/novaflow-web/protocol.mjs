// GENERATED COPY - do not edit here.
// Source: packages/shared/src/protocol.mjs
// Regenerate with: npm run sync:edge
// NovaFlow Web - shared protocol.
// One source of truth for task states, task types, token prefixes and the
// worker/control-plane wire contract. Imported unchanged by the browser app,
// the worker, the local control plane and the Supabase edge function, so a
// contract drift becomes a test failure rather than a runtime mystery.

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Task state machine (spec 15). Every transition carries a timestamp column.
// ---------------------------------------------------------------------------
export const TASK_STATE = Object.freeze({
  CREATED: 'created',
  QUEUED: 'queued',
  ASSIGNED: 'assigned',
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
});

export const TERMINAL_TASK_STATES = Object.freeze([
  TASK_STATE.COMPLETED,
  TASK_STATE.FAILED,
  TASK_STATE.CANCELLED,
  TASK_STATE.EXPIRED
]);

// Allowed transitions. Anything not listed here is rejected by the control
// plane, which is what keeps unexplainable intermediate states from existing.
export const TASK_TRANSITIONS = Object.freeze({
  [TASK_STATE.CREATED]: [TASK_STATE.QUEUED, TASK_STATE.CANCELLED, TASK_STATE.FAILED],
  [TASK_STATE.QUEUED]: [TASK_STATE.ASSIGNED, TASK_STATE.CANCELLED, TASK_STATE.EXPIRED, TASK_STATE.FAILED],
  // ASSIGNED -> QUEUED is the requeue path used by heartbeat/assign timeout recovery.
  [TASK_STATE.ASSIGNED]: [TASK_STATE.UPLOADING, TASK_STATE.PROCESSING, TASK_STATE.QUEUED, TASK_STATE.CANCELLED, TASK_STATE.FAILED, TASK_STATE.EXPIRED],
  [TASK_STATE.UPLOADING]: [TASK_STATE.PROCESSING, TASK_STATE.QUEUED, TASK_STATE.CANCELLED, TASK_STATE.FAILED, TASK_STATE.EXPIRED],
  [TASK_STATE.PROCESSING]: [TASK_STATE.COMPLETED, TASK_STATE.FAILED, TASK_STATE.CANCELLED, TASK_STATE.QUEUED, TASK_STATE.EXPIRED],
  [TASK_STATE.COMPLETED]: [],
  [TASK_STATE.FAILED]: [],
  [TASK_STATE.CANCELLED]: [],
  [TASK_STATE.EXPIRED]: []
});

export function canTransition(from, to) {
  const allowed = TASK_TRANSITIONS[String(from || '')];
  return Array.isArray(allowed) && allowed.includes(String(to || ''));
}

export function isTerminalState(state) {
  return TERMINAL_TASK_STATES.includes(String(state || ''));
}

// ---------------------------------------------------------------------------
// Worker lifecycle (spec 5).
// ---------------------------------------------------------------------------
export const WORKER_STATUS = Object.freeze({
  IDLE: 'idle',
  BUSY: 'busy',
  OFFLINE: 'offline',
  MAINTENANCE: 'maintenance'
});

export const WORKER_MODEL_STATUS = Object.freeze({
  READY: 'ready',
  MISSING: 'missing',
  INVALID: 'invalid',
  UPDATING: 'updating'
});

// Heartbeat cadence and the timeout the sweeper uses (spec 14).
export const HEARTBEAT_INTERVAL_SECONDS = 20;
export const HEARTBEAT_TIMEOUT_SECONDS = 75;
// A task that is ASSIGNED but never picked up goes back to the queue.
export const ASSIGN_TIMEOUT_SECONDS = 120;
// A task stuck in PROCESSING with no progress for this long is requeued once
// and then failed.
export const PROCESSING_TIMEOUT_SECONDS = 1800;
// How many times a task may be requeued after a worker dies under it.
export const MAX_TASK_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Token prefixes. Each token type is a distinct namespace so a token can never
// be replayed as a different kind of credential.
// ---------------------------------------------------------------------------
export const TOKEN_PREFIX = Object.freeze({
  SESSION: 'nfs_',   // user session, minted by the existing novaflow-backend
  WORKER: 'nfw_',    // worker identity, minted by the control plane
  GRANT: 'nfg_'      // short-lived browser<->worker file grant
});

export const GRANT_OP = Object.freeze({
  UPLOAD: 'upload',
  DOWNLOAD: 'download'
});

export const GRANT_TTL_SECONDS = 900;           // 15 min upload window
export const GRANT_DOWNLOAD_TTL_SECONDS = 3600; // 1 h result playback window

// ---------------------------------------------------------------------------
// Task types -> workflow files. The browser NEVER sees a ComfyUI graph; it
// sends a task_type plus business parameters and the worker picks the graph
// (spec 10).
// ---------------------------------------------------------------------------
export const TASK_TYPE = Object.freeze({
  QWEN_T2I: 'qwen_t2i',
  QWEN_EDIT: 'qwen2511_edit',
  H3_I2V: 'h3_i2v'
});

export const TASK_TYPE_WORKFLOW = Object.freeze({
  [TASK_TYPE.QWEN_T2I]: 'qwen_t2i.json',
  [TASK_TYPE.QWEN_EDIT]: 'qwen2511_edit.json',
  [TASK_TYPE.H3_I2V]: 'h3_i2v.json'
});

// Which model each task type needs, and the VRAM floor the scheduler enforces
// before it hands the task to a worker.
// `billing` is the rule that decides whether a task costs credits at all.
//
//   'self_hosted' - it runs on a GPU in this pool: the owner's machine, a
//     friend's, a rented one. Nobody is invoiced for it, so NovaFlow does not
//     invoice for it either. Credits exist to meter what a third party bills
//     for, not to tax someone's own hardware.
//
//   'provider' - it goes out to a paid API (Grok, GPT, Google). That is real
//     money leaving, and that is what credits are for.
//
// Every task type NovaFlow Web runs today is self-hosted. The metered path is
// kept wired, and priced, for the provider-backed types that will use it.
export const BILLING = Object.freeze({ SELF_HOSTED: 'self_hosted', PROVIDER: 'provider' });

export const TASK_TYPE_REQUIREMENTS = Object.freeze({
  [TASK_TYPE.QWEN_T2I]: { modelId: 'qwen-image-2511', minVramMb: 16000, kind: 'image', label: '绘图', billing: BILLING.SELF_HOSTED },
  [TASK_TYPE.QWEN_EDIT]: { modelId: 'qwen-image-2511', minVramMb: 16000, kind: 'image', label: '图生图', billing: BILLING.SELF_HOSTED },
  [TASK_TYPE.H3_I2V]: { modelId: 'minimax-h3', minVramMb: 15000, kind: 'video', label: 'AI序列', billing: BILLING.SELF_HOSTED }
});

/** Does this task type cost the user credits? */
export function isMetered(taskType) {
  const req = TASK_TYPE_REQUIREMENTS[String(taskType || '')];
  return Boolean(req) && req.billing === BILLING.PROVIDER;
}

export function requirementsFor(taskType) {
  return TASK_TYPE_REQUIREMENTS[String(taskType || '')] || null;
}

export function isKnownTaskType(taskType) {
  return Object.prototype.hasOwnProperty.call(TASK_TYPE_REQUIREMENTS, String(taskType || ''));
}

// ---------------------------------------------------------------------------
// Result TTL defaults (spec 13). Configurable per deployment; these are the
// values the worker ships with.
// ---------------------------------------------------------------------------
export const TTL_SECONDS = Object.freeze({
  input: 24 * 3600,
  image: 72 * 3600,
  video: 48 * 3600
});

// ---------------------------------------------------------------------------
// Control-plane routes. Written once so the worker, the browser and both
// server implementations cannot disagree about a path.
// ---------------------------------------------------------------------------
export const ROUTES = Object.freeze({
  health: '/health',
  // user-facing (needs a nfs_ session token)
  createTask: '/api/web/tasks',
  listTasks: '/api/web/tasks',
  getTask: (id) => '/api/web/tasks/' + id,
  cancelTask: (id) => '/api/web/tasks/' + id + '/cancel',
  taskGrant: (id) => '/api/web/tasks/' + id + '/grant',
  workers: '/api/web/workers',
  capabilities: '/api/web/capabilities',
  me: '/api/web/me',
  // worker-facing (needs a nfw_ worker token, except register)
  workerRegister: '/api/worker/register',
  workerHeartbeat: '/api/worker/heartbeat',
  workerClaim: '/api/worker/claim',
  workerModels: '/api/worker/models',
  workerProgress: (id) => '/api/worker/tasks/' + id + '/progress',
  workerComplete: (id) => '/api/worker/tasks/' + id + '/complete',
  workerFail: (id) => '/api/worker/tasks/' + id + '/fail',
  // maintenance sweeper, callable by cron or by the local runner
  sweep: '/api/maintenance/sweep'
});

// Worker gateway routes (served by the worker itself, reachable by browsers).
export const GATEWAY_ROUTES = Object.freeze({
  health: '/gw/health',
  upload: (taskId, name) => '/gw/tasks/' + taskId + '/input/' + name,
  output: (taskId, name) => '/gw/tasks/' + taskId + '/output/' + name,
  preview: (taskId, name) => '/gw/tasks/' + taskId + '/preview/' + name
});

export const ERROR_CODE = Object.freeze({
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  EXPIRED: 'token_expired',
  NOT_FOUND: 'not_found',
  BAD_REQUEST: 'bad_request',
  CONFLICT: 'conflict',
  INSUFFICIENT_CREDITS: 'insufficient_credits',
  NO_WORKER: 'no_capable_worker',
  RATE_LIMITED: 'rate_limited'
});

// Filenames the gateway will serve. Anything outside this shape is refused
// before it ever reaches the filesystem.
export const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeFilename(name) {
  const value = String(name || '');
  if (!SAFE_FILENAME_RE.test(value)) return false;
  return !value.includes('..');
}
