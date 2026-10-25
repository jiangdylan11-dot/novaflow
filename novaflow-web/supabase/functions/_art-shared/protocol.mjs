// GENERATED COPY - source: packages/shared/src/protocol.mjs
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
// A task's place in line (2026-10-15, user: 节点忙碌时弹框提示排队、已等多久、预计多久，能取消排队).
// A task still waiting for a node gets `task.queue` from the control plane (or the
// local queue); a node whose runtime is still drawing other prompts says so in its
// progress note as "<note> [queue ahead=2 eta=180]". The page reads the marker into
// task.queue and strips it, so no panel shows it.
// ---------------------------------------------------------------------------
export const QUEUE_NOTE_RE = /\s*\[queue ahead=(\d+)(?: eta=(\d+))?\]\s*$/;

export function withQueueNote(note, { ahead, eta } = {}) {
  const base = String(note || '').replace(QUEUE_NOTE_RE, '');
  if (!Number.isFinite(Number(ahead)) || ahead === null) return base;
  const seconds = eta === null || eta === undefined || !Number.isFinite(Number(eta)) ? '' : ' eta=' + Math.max(0, Math.round(eta));
  return base + ' [queue ahead=' + Math.max(0, Math.round(ahead)) + seconds + ']';
}

/**
 * Rough seconds until a waiting task starts: what the running ones still need plus one
 * average run per task queued ahead, shared by the nodes that can take them. No recent
 * run to go by: null (the page says it cannot estimate yet).
 */
export function estimateQueueWait({ queuedAhead = 0, runningElapsed = [], averageSeconds = 0, workers = 1 } = {}) {
  const average = Number(averageSeconds) || 0;
  if (!(average > 0)) return null;
  const left = runningElapsed.reduce((sum, elapsed) => sum + Math.max(average * 0.1, average - (Number(elapsed) || 0)), 0);
  return Math.round((left + Math.max(0, Number(queuedAhead) || 0) * average) / Math.max(1, Number(workers) || 1));
}

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
  H3_I2V: 'h3_i2v',
  // 音频: game background music (looped) and sound effects, text to audio.
  AUDIO_MUSIC: 'audio_music',
  AUDIO_SFX: 'audio_sfx'
});

export const TASK_TYPE_WORKFLOW = Object.freeze({
  [TASK_TYPE.QWEN_T2I]: 'qwen_t2i.json',
  [TASK_TYPE.QWEN_EDIT]: 'qwen2511_edit.json',
  [TASK_TYPE.H3_I2V]: 'h3_i2v.json',
  [TASK_TYPE.AUDIO_MUSIC]: 'audio_music.json',
  [TASK_TYPE.AUDIO_SFX]: 'audio_sfx.json'
});

// 音频 limits, shared by the validator, the worker and the panel.
export const AUDIO_LIMITS = Object.freeze({
  music: { minSeconds: 8, maxSeconds: 300, defaultSeconds: 30 },
  sfx: { minSeconds: 1, maxSeconds: 30, defaultSeconds: 2 },
  minCrossfadeMs: 100, maxCrossfadeMs: 4000, defaultCrossfadeMs: 800
});
export const AUDIO_MUSIC_MODEL_ID = 'audio-music';
export const AUDIO_SFX_MODEL_ID = 'audio-sfx';

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

// 'video_matting' is deliberately absent from TASK_TYPE and
// TASK_TYPE_WORKFLOW above. Membership there means "this type names a ComfyUI
// graph file", which the worker's loadWorkflow() then insists on loading and
// tests/e2e/protocol.test.mjs asserts exists. AI 抠图 runs BiRefNet in a
// Python process and never opens ComfyUI at all, so it belongs only here -
// isKnownTaskType() reads THIS table, which is what admits it to the queue.
export const MATTING_TASK_TYPE = 'video_matting';

// 提示词助手 (优化 / 反推 / 画风描述) is the desktop's Python service, which every
// compute node ships. On the shared pool it runs as this task: the request
// travels as one uploaded JSON file, the reply comes back as one output file.
// Like matting it names no ComfyUI graph, so it lives only in this table.
export const PROMPT_ASSISTANT_TASK_TYPE = 'prompt_assistant';
export const PROMPT_ASSISTANT_MODEL_ID = 'prompt-assistant';
export const PROMPT_ASSISTANT_ACTIONS = Object.freeze(['optimize-prompt', 'reverse-image-prompt', 'describe-art-style']);
export const PROMPT_ASSISTANT_REQUEST_FILE = 'request.json';
export const PROMPT_ASSISTANT_RESULT_FILE = 'result.json';

export const TASK_TYPE_REQUIREMENTS = Object.freeze({
  [TASK_TYPE.QWEN_T2I]: { modelId: 'qwen-image-2511', minVramMb: 16000, kind: 'image', label: '绘图', billing: BILLING.SELF_HOSTED },
  [TASK_TYPE.QWEN_EDIT]: { modelId: 'qwen-image-2511', minVramMb: 16000, kind: 'image', label: '图生图', billing: BILLING.SELF_HOSTED },
  [TASK_TYPE.H3_I2V]: { modelId: 'minimax-h3', minVramMb: 15000, kind: 'video', label: 'AI序列', billing: BILLING.SELF_HOSTED },
  // 音频 is light: the music model peaks under 7 GB, the effects model under 3 GB.
  [TASK_TYPE.AUDIO_MUSIC]: { modelId: AUDIO_MUSIC_MODEL_ID, minVramMb: 8000, kind: 'audio', label: '音乐', billing: BILLING.SELF_HOSTED },
  [TASK_TYPE.AUDIO_SFX]: { modelId: AUDIO_SFX_MODEL_ID, minVramMb: 4000, kind: 'audio', label: '音效', billing: BILLING.SELF_HOSTED },
  // Matting is segmentation, not generation: BiRefNet runs at a fixed
  // 1024x1024 whatever the clip is, so the VRAM floor is far below the
  // generation types and a machine that cannot draw can still cut out.
  [MATTING_TASK_TYPE]: { modelId: 'birefnet-matting', minVramMb: 4000, kind: 'video', label: '抠图', billing: BILLING.SELF_HOSTED },
  // A 7B VL model in fp8; the node frees its drawing runtime's memory first.
  [PROMPT_ASSISTANT_TASK_TYPE]: { modelId: PROMPT_ASSISTANT_MODEL_ID, minVramMb: 8000, kind: 'text', label: '提示词助手', billing: BILLING.SELF_HOSTED }
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
  video: 48 * 3600,
  audio: 72 * 3600
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

// Account tiers. `users.plan` is what the administrator sets:
//
//   trial      普通账户  only the machine 启动NovaFlow opened; no pool node
//   standard   中级账户  pool nodes marked 普通 (standard), not 高级 ones
//   pro / team 高级账户  every pool node, 普通 and 高级 alike
//
// Anything else reads as trial, so a typo in the database can only take
// access away, never grant it.
export const PLAN_TIERS = Object.freeze(['trial', 'standard', 'pro', 'team']);
export const SHARED_COMPUTE_PLANS = Object.freeze(['standard', 'pro', 'team']);
export const PREMIUM_NODE_PLANS = Object.freeze(['pro', 'team']);

export function normalizePlan(plan) {
  const key = String(plan || 'trial').trim().toLowerCase();
  return PLAN_TIERS.includes(key) ? key : 'trial';
}

export function canUseSharedCompute(plan) {
  return SHARED_COMPUTE_PLANS.includes(normalizePlan(plan));
}

export function canUsePremiumNodes(plan) {
  return PREMIUM_NODE_PLANS.includes(normalizePlan(plan));
}

// Node tiers. Every pool node is 普通 (standard) or 高级 (premium). The
// registration code that admits a machine decides its tier, and the
// administrator may change it afterwards; the scheduler and the picker both
// read it from gpu_workers.tier.
export const NODE_TIERS = Object.freeze(['standard', 'premium']);

export function normalizeNodeTier(tier) {
  return String(tier || '').trim().toLowerCase() === 'premium' ? 'premium' : 'standard';
}

/** May an account with this plan run work on a node of this tier? */
export function planAllowsNode(plan, tier) {
  if (!canUseSharedCompute(plan)) return false;
  return normalizeNodeTier(tier) === 'standard' || canUsePremiumNodes(plan);
}

export const ERROR_CODE = Object.freeze({
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  EXPIRED: 'token_expired',
  SESSION_REPLACED: 'session_replaced',
  ACCOUNT_EXPIRED: 'account_expired',
  NOT_FOUND: 'not_found',
  BAD_REQUEST: 'bad_request',
  CONFLICT: 'conflict',
  INSUFFICIENT_CREDITS: 'insufficient_credits',
  PLAN_REQUIRED: 'plan_required',
  NODE_TIER_REQUIRED: 'node_tier_required',
  NO_WORKER: 'no_capable_worker',
  RATE_LIMITED: 'rate_limited',
  UNAVAILABLE: 'unavailable'
});

// Filenames the gateway will serve. Anything outside this shape is refused
// before it ever reaches the filesystem.
export const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeFilename(name) {
  const value = String(name || '');
  if (!SAFE_FILENAME_RE.test(value)) return false;
  return !value.includes('..');
}
