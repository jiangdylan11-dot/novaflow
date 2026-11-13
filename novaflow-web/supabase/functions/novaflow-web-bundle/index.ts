// GENERATED - do not edit. Built by tools/bundle-edge-function.mjs.
// Source: supabase/functions/novaflow-web/ (9 modules + index.ts)
// Rebuild with: npm run bundle:edge
//
// One file on purpose: a multi-file deploy can lose a module, and a lost
// module only shows up as a cold-start failure in production.
import { createClient } from 'npm:@supabase/supabase-js@2';

// ===== lora-catalog.mjs ==============================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/lora-catalog.mjs
// Regenerate with: npm run sync:edge
// Advertise only selections supported by every node the scheduler can choose.
// Older nodes and failed scans are unavailable, never an empty success.
function commonLoraCatalog(rows, { kind, nsfw = false, mode = 'i2v', steps = 4, engine = '' }) {
  if (!rows.length) throw new Error('暂无在线算力可读取 LoRA');
  const key = kind === 'qwen'
    ? (engine === 'qwen-2.1' ? 'qwen21' : nsfw ? 'qwen_nsfw' : 'qwen')
    : (mode === 'r2v' ? 'h3_ref' : 'h3');
  const lists = rows.map(row => {
    const report = row.detail?.lora_catalog;
    if (report?.version !== 1) throw new Error('算力节点需要更新到 0.4.4 才能读取 LoRA');
    if (Date.now() - Date.parse(report.updated_at) > 300000 || !Number.isFinite(Date.parse(report.updated_at))) throw new Error('LoRA 列表已过期，等待节点更新后重试');
    const value = report[key];
    if (!value?.ok || !Array.isArray(value.items)) throw new Error('算力节点读取 LoRA 失败，请检查节点的 models 目录与模型文件');
    return value.items.filter(item => {
      const name = String(item?.name || '');
      if (!/\.safetensors$/i.test(name) || name.split(/[\\/]/).some(p => !p || p === '.' || p === '..' || p.includes(':'))) return false;
      if (kind === 'qwen') return /^qwen[\\/]/i.test(name);
      const family = mode === 'r2v' ? 'ref2va' : 'fl2va';
      return item.kind === 'standard' && ['h3', family].includes(item.modelFamily) &&
        (!item.supportedSteps || item.supportedSteps.includes(steps)) && typeof item.fingerprint === 'string';
    }).map(item => kind === 'qwen' ? { name: item.name } : {
      name: item.name, fingerprint: item.fingerprint, modelFamily: item.modelFamily,
      kind: item.kind, supportedSteps: item.supportedSteps, strengthRange: item.strengthRange
    });
  });
  return lists[0].filter(item => lists.slice(1).every(list => list.some(other =>
    other.name === item.name && (kind !== 'h3' || other.fingerprint === item.fingerprint))));
}

// ===== release.mjs ===================================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/release.mjs
// Regenerate with: npm run sync:edge
// Application release identifier; protocol and model versions remain independent.
const RELEASE_VERSION = "2.0.349";

// ===== xiaotao-memory.mjs ============================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/xiaotao-memory.mjs
// Regenerate with: npm run sync:edge
// 小桃记忆: each account's own short preference list. Only preference text is
// kept (never chat logs or pictures); a newer preference of the same kind
// replaces the old one and an account keeps at most 20.
const XIAOTAO_MEMORY_CATEGORIES = Object.freeze(['model','art','video','audio','ui','export','chat','avoid']);
const XIAOTAO_MEMORY_LIMIT = 20;
const SLOT = /^[a-z0-9_.:-]{1,64}$/;
const UNSAFE = /data:|https?:\/\/|www\.|Bearer\s|nfw_|sk-[A-Za-z0-9]|@[A-Za-z0-9-]+\.[A-Za-z]/i;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanXiaotaoMemoryText(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text && text.length <= 120 && !UNSAFE.test(text) ? text : '';
}

function createXiaotaoMemoryRoutes({ store, requireUser, HttpError }) {
  const fail = (status, code, message) => { throw new HttpError(status, code, message); };
  const plain = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
  const ready = () => { if (typeof store.listXiaotaoMemory !== 'function') fail(503, 'xiaotao-memory-unavailable', '记忆功能暂不可用'); };
  return {
    async handle({ method, path, headers, body }) {
      if (path !== '/api/web/xiaotao/memory' && !path.startsWith('/api/web/xiaotao/memory/')) return null;
      ready();
      const user = await requireUser(headers);
      if (method === 'GET' && path === '/api/web/xiaotao/memory') {
        return { ok: true, enabled: await store.getXiaotaoMemoryEnabled(user.id), limit: XIAOTAO_MEMORY_LIMIT, items: await store.listXiaotaoMemory(user.id) };
      }
      if (method !== 'POST') fail(404, 'xiaotao-memory-route', '未知的记忆操作');
      if (path === '/api/web/xiaotao/memory') {
        if (!plain(body, ['category', 'slot', 'text', 'source'])) fail(400, 'xiaotao-memory-invalid', '记忆格式无效');
        const text = cleanXiaotaoMemoryText(body.text);
        if (!XIAOTAO_MEMORY_CATEGORIES.includes(body.category) || typeof body.slot !== 'string' || !SLOT.test(body.slot)
          || !['explicit', 'adopted'].includes(body.source) || !text) fail(400, 'xiaotao-memory-invalid', '这条记忆不能保存');
        if (!await store.getXiaotaoMemoryEnabled(user.id)) fail(409, 'xiaotao-memory-off', '记忆已关闭');
        return { ok: true, item: await store.saveXiaotaoMemory(user.id, { category: body.category, slot: body.slot, text, source: body.source }) };
      }
      if (path === '/api/web/xiaotao/memory/delete') {
        if (!plain(body, ['id', 'all']) || (body.all !== true && !(typeof body.id === 'string' && ID.test(body.id)))) fail(400, 'xiaotao-memory-invalid', '删除请求无效');
        return { ok: true, deleted: await store.deleteXiaotaoMemory(user.id, body.all === true ? null : body.id) };
      }
      if (path === '/api/web/xiaotao/memory/settings') {
        if (!plain(body, ['enabled']) || typeof body.enabled !== 'boolean') fail(400, 'xiaotao-memory-invalid', '设置无效');
        await store.setXiaotaoMemoryEnabled(user.id, body.enabled);
        return { ok: true, enabled: body.enabled };
      }
      fail(404, 'xiaotao-memory-route', '未知的记忆操作');
    }
  };
}

// Memory-only store for the local control plane and tests.
function createMemoryXiaotaoMemoryStore() {
  const rows = new Map(), off = new Set();
  const list = userId => [...rows.values()].filter(r => r.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.seq - a.seq);
  let seq = 0;
  const view = ({ id, category, slot, text, source, updatedAt }) => ({ id, category, slot, text, source, updatedAt });
  return {
    async listXiaotaoMemory(userId) { return list(userId).map(view); },
    async getXiaotaoMemoryEnabled(userId) { return !off.has(userId); },
    async setXiaotaoMemoryEnabled(userId, enabled) { if (enabled) off.delete(userId); else off.add(userId); },
    async saveXiaotaoMemory(userId, item) {
      const old = list(userId).find(r => r.category === item.category && r.slot === item.slot);
      const row = { ...(old || { id: crypto.randomUUID(), userId }), ...item, updatedAt: new Date().toISOString(), seq: ++seq };
      rows.set(row.id, row);
      for (const extra of list(userId).slice(XIAOTAO_MEMORY_LIMIT)) rows.delete(extra.id);
      return view(row);
    },
    async deleteXiaotaoMemory(userId, id) {
      let n = 0;
      for (const row of list(userId)) if (id === null || row.id === id) { rows.delete(row.id); n++; }
      return n;
    }
  };
}

// ===== protocol.mjs ==================================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/protocol.mjs
// Regenerate with: npm run sync:edge
// NovaFlow Web - shared protocol.
// One source of truth for task states, task types, token prefixes and the
// worker/control-plane wire contract. Imported unchanged by the browser app,
// the worker, the local control plane and the Supabase edge function, so a
// contract drift becomes a test failure rather than a runtime mystery.

const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Task state machine (spec 15). Every transition carries a timestamp column.
// ---------------------------------------------------------------------------
const TASK_STATE = Object.freeze({
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

const TERMINAL_TASK_STATES = Object.freeze([
  TASK_STATE.COMPLETED,
  TASK_STATE.FAILED,
  TASK_STATE.CANCELLED,
  TASK_STATE.EXPIRED
]);

// Allowed transitions. Anything not listed here is rejected by the control
// plane, which is what keeps unexplainable intermediate states from existing.
const TASK_TRANSITIONS = Object.freeze({
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

function canTransition(from, to) {
  const allowed = TASK_TRANSITIONS[String(from || '')];
  return Array.isArray(allowed) && allowed.includes(String(to || ''));
}

function isTerminalState(state) {
  return TERMINAL_TASK_STATES.includes(String(state || ''));
}

// ---------------------------------------------------------------------------
// Worker lifecycle (spec 5).
// ---------------------------------------------------------------------------
const WORKER_STATUS = Object.freeze({
  IDLE: 'idle',
  BUSY: 'busy',
  OFFLINE: 'offline',
  MAINTENANCE: 'maintenance'
});

const WORKER_MODEL_STATUS = Object.freeze({
  READY: 'ready',
  MISSING: 'missing',
  INVALID: 'invalid',
  UPDATING: 'updating'
});

// Heartbeat cadence and the timeout the sweeper uses (spec 14).
const HEARTBEAT_INTERVAL_SECONDS = 20;
const HEARTBEAT_TIMEOUT_SECONDS = 75;
// A task that is ASSIGNED but never picked up goes back to the queue.
const ASSIGN_TIMEOUT_SECONDS = 120;
// A task stuck in PROCESSING with no progress for this long is requeued once
// and then failed.
const PROCESSING_TIMEOUT_SECONDS = 1800;
// How many times a task may be requeued after a worker dies under it.
const MAX_TASK_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// A task's place in line (2026-10-15, user: 节点忙碌时弹框提示排队、已等多久、预计多久，能取消排队).
// A task still waiting for a node gets `task.queue` from the control plane (or the
// local queue); a node whose runtime is still drawing other prompts says so in its
// progress note as "<note> [queue ahead=2 eta=180]". The page reads the marker into
// task.queue and strips it, so no panel shows it.
// ---------------------------------------------------------------------------
const QUEUE_NOTE_RE = /\s*\[queue ahead=(\d+)(?: eta=(\d+))?\]\s*$/;

function withQueueNote(note, { ahead, eta } = {}) {
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
function estimateQueueWait({ queuedAhead = 0, runningElapsed = [], averageSeconds = 0, workers = 1 } = {}) {
  const average = Number(averageSeconds) || 0;
  if (!(average > 0)) return null;
  const left = runningElapsed.reduce((sum, elapsed) => sum + Math.max(average * 0.1, average - (Number(elapsed) || 0)), 0);
  return Math.round((left + Math.max(0, Number(queuedAhead) || 0) * average) / Math.max(1, Number(workers) || 1));
}

// ---------------------------------------------------------------------------
// Token prefixes. Each token type is a distinct namespace so a token can never
// be replayed as a different kind of credential.
// ---------------------------------------------------------------------------
const TOKEN_PREFIX = Object.freeze({
  SESSION: 'nfs_',   // user session, minted by the existing novaflow-backend
  WORKER: 'nfw_',    // worker identity, minted by the control plane
  GRANT: 'nfg_'      // short-lived browser<->worker file grant
});

const GRANT_OP = Object.freeze({
  UPLOAD: 'upload',
  DOWNLOAD: 'download'
});

const GRANT_TTL_SECONDS = 900;           // 15 min upload window
const GRANT_DOWNLOAD_TTL_SECONDS = 3600; // 1 h result playback window

// ---------------------------------------------------------------------------
// Task types -> workflow files. The browser NEVER sees a ComfyUI graph; it
// sends a task_type plus business parameters and the worker picks the graph
// (spec 10).
// ---------------------------------------------------------------------------
const TASK_TYPE = Object.freeze({
  H3_I2V: 'h3_i2v',
  // 音频: game background music (looped) and sound effects, text to audio.
  AUDIO_MUSIC: 'audio_music',
  AUDIO_SFX: 'audio_sfx'
});

const TASK_TYPE_WORKFLOW = Object.freeze({
  [TASK_TYPE.H3_I2V]: 'h3_i2v.json',
  [TASK_TYPE.AUDIO_MUSIC]: 'audio_music.json',
  [TASK_TYPE.AUDIO_SFX]: 'audio_sfx.json'
});

// 音频 limits, shared by the validator, the worker and the panel.
const AUDIO_LIMITS = Object.freeze({
  music: { minSeconds: 8, maxSeconds: 300, defaultSeconds: 30 },
  sfx: { minSeconds: 1, maxSeconds: 30, defaultSeconds: 2 },
  minCrossfadeMs: 100, maxCrossfadeMs: 4000, defaultCrossfadeMs: 800
});
const AUDIO_MUSIC_MODEL_ID = 'audio-music';
const AUDIO_SFX_MODEL_ID = 'audio-sfx';

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
const BILLING = Object.freeze({ SELF_HOSTED: 'self_hosted', PROVIDER: 'provider' });

// 'video_matting' is deliberately absent from TASK_TYPE and
// TASK_TYPE_WORKFLOW above. Membership there means "this type names a ComfyUI
// graph file", which the worker's loadWorkflow() then insists on loading and
// tests/e2e/protocol.test.mjs asserts exists. AI 抠图 runs BiRefNet in a
// Python process and never opens ComfyUI at all, so it belongs only here -
// isKnownTaskType() reads THIS table, which is what admits it to the queue.
const MATTING_TASK_TYPE = 'video_matting';

// Local Flash assistant (optimize / reverse / art-style description). The task
// type string stays prompt_assistant so workers already in the field keep
// dispatching it. Production inference is Flash/Strata; the Python service is
// not an automatic fallback. On the shared pool the request still travels as
// one uploaded JSON file and the reply comes back as one output file.
const PROMPT_ASSISTANT_TASK_TYPE = 'prompt_assistant';
const PROMPT_ASSISTANT_MODEL_ID = 'prompt-assistant';
// A separate scheduler capability; legacy Next nodes cannot claim Qwen work.
const PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID = 'qwen3.5-9b-heretic';
// Distinct scheduler capability: chat-ready older nodes cannot claim business tasks.
const PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY = 'qwen3.5-9b-heretic-business-v1';
// Reserved for a future owner-bound candidate-only route; not advertised or enabled.
const PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE = 'qwen-foart-rotation-candidate-v1';
const PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY = 'qwen3.5-9b-heretic-foart-rotation-candidate-v1';
const PROMPT_ASSISTANT_ACTIONS = Object.freeze(['optimize-prompt', 'reverse-image-prompt', 'describe-art-style', 'rewrite-audio-prompt', 'art-agent-chat']);
const PROMPT_ASSISTANT_REQUEST_FILE = 'request.json';
const PROMPT_ASSISTANT_RESULT_FILE = 'result.json';

const TASK_TYPE_REQUIREMENTS = Object.freeze({
  [TASK_TYPE.H3_I2V]: { modelId: 'minimax-h3', minVramMb: 15000, kind: 'video', label: 'AI序列', billing: BILLING.SELF_HOSTED },
  // 音频 is light: the music model peaks under 7 GB, the effects model under 3 GB.
  [TASK_TYPE.AUDIO_MUSIC]: { modelId: AUDIO_MUSIC_MODEL_ID, minVramMb: 8000, kind: 'audio', label: '音乐', billing: BILLING.SELF_HOSTED },
  [TASK_TYPE.AUDIO_SFX]: { modelId: AUDIO_SFX_MODEL_ID, minVramMb: 4000, kind: 'audio', label: '音效', billing: BILLING.SELF_HOSTED },
  // Matting is segmentation, not generation: BiRefNet runs at a fixed
  // 1024x1024 whatever the clip is, so the VRAM floor is far below the
  // generation types and a machine that cannot draw can still cut out.
  [MATTING_TASK_TYPE]: { modelId: 'birefnet-matting', minVramMb: 4000, kind: 'video', label: '抠图', billing: BILLING.SELF_HOSTED },
  // Local Flash. The node frees its drawing runtime's memory first.
  [PROMPT_ASSISTANT_TASK_TYPE]: { modelId: PROMPT_ASSISTANT_MODEL_ID, minVramMb: 8000, kind: 'text', label: '本地 Flash 助手', billing: BILLING.SELF_HOSTED }
});

/** Does this task type cost the user credits? */
function isMetered(taskType) {
  const req = TASK_TYPE_REQUIREMENTS[String(taskType || '')];
  return Boolean(req) && req.billing === BILLING.PROVIDER;
}

function requirementsFor(taskType) {
  return TASK_TYPE_REQUIREMENTS[String(taskType || '')] || null;
}

function isKnownTaskType(taskType) {
  return Object.prototype.hasOwnProperty.call(TASK_TYPE_REQUIREMENTS, String(taskType || ''));
}

// ---------------------------------------------------------------------------
// Result TTL defaults (spec 13). Configurable per deployment; these are the
// values the worker ships with.
// ---------------------------------------------------------------------------
const TTL_SECONDS = Object.freeze({
  input: 24 * 3600,
  image: 72 * 3600,
  video: 48 * 3600,
  audio: 72 * 3600
});

// ---------------------------------------------------------------------------
// Control-plane routes. Written once so the worker, the browser and both
// server implementations cannot disagree about a path.
// ---------------------------------------------------------------------------
const ROUTES = Object.freeze({
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
const GATEWAY_ROUTES = Object.freeze({
  health: '/gw/health',
  upload: (taskId, name) => '/gw/tasks/' + taskId + '/input/' + name,
  output: (taskId, name) => '/gw/tasks/' + taskId + '/output/' + name,
  preview: (taskId, name) => '/gw/tasks/' + taskId + '/preview/' + name
});

// Account tiers. `users.plan` is what the administrator sets:
//
//   trial     普通账户  only the machine 启动NovaFlow opened; no pool node
//   standard  中级账户  pool nodes marked 普通 (standard), not 高级 ones
//   pro       高级账户  every pool node, 普通 and 高级 alike
//   team      legacy alias, normalized to pro (same node access)
//
// Anything else reads as trial, so a typo in the database can only take
// access away, never grant it.
const PLAN_TIERS = Object.freeze(['trial', 'standard', 'pro']);
const SHARED_COMPUTE_PLANS = Object.freeze(['standard', 'pro']);
const PREMIUM_NODE_PLANS = Object.freeze(['pro']);

function normalizePlan(plan) {
  const key = String(plan || 'trial').trim().toLowerCase();
  if (key === 'team') return 'pro';
  return PLAN_TIERS.includes(key) ? key : 'trial';
}

function canUseSharedCompute(plan) {
  return SHARED_COMPUTE_PLANS.includes(normalizePlan(plan));
}

function canUsePremiumNodes(plan) {
  return PREMIUM_NODE_PLANS.includes(normalizePlan(plan));
}

// Node tiers. Every pool node is 普通 (standard) or 高级 (premium). The
// registration code that admits a machine decides its tier, and the
// administrator may change it afterwards; the scheduler and the picker both
// read it from gpu_workers.tier.
const NODE_TIERS = Object.freeze(['standard', 'premium']);

function normalizeNodeTier(tier) {
  return String(tier || '').trim().toLowerCase() === 'premium' ? 'premium' : 'standard';
}

/** May an account with this plan run work on a node of this tier? */
function planAllowsNode(plan, tier) {
  if (!canUseSharedCompute(plan)) return false;
  return normalizeNodeTier(tier) === 'standard' || canUsePremiumNodes(plan);
}

const ERROR_CODE = Object.freeze({
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
const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isSafeFilename(name) {
  const value = String(name || '');
  if (!SAFE_FILENAME_RE.test(value)) return false;
  return !value.includes('..');
}

// ===== tokens.mjs ====================================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/tokens.mjs
// Regenerate with: npm run sync:edge
// NovaFlow Web - token minting and verification.
//
// Three token families, each in its own namespace so one can never be replayed
// as another (spec 8, 11):
//
//   nfs_  user session   - minted by the EXISTING novaflow-backend. We only
//                          verify it here, with the same HMAC secret. We never
//                          mint one, so the Web line cannot forge a user.
//   nfw_  worker identity- minted by the control plane after a worker proves
//                          it knows its worker_secret.
//   nfg_  file grant     - short lived, binds {user, task, worker, op} for one
//                          browser<->worker transfer.
//
// The grant is signed with a PER-WORKER key derived from the control-plane
// secret. A worker is handed only its own derived key, so it can verify grants
// addressed to itself and cannot forge a grant for any other worker.

const enc = new TextEncoder();

function toBase64Url(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  const b64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(view).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function base64UrlJson(payload) {
  return toBase64Url(enc.encode(JSON.stringify(payload)));
}

function decodeBase64UrlJson(value) {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(value)));
}

async function subtle() {
  if (typeof globalThis.crypto?.subtle?.importKey === 'function') return globalThis.crypto.subtle;
  const { webcrypto } = await import('node:crypto');
  return webcrypto.subtle;
}

async function hmacSha256(message, secret) {
  const api = await subtle();
  const key = await api.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await api.sign('HMAC', key, enc.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

async function sha256Hex(message) {
  const api = await subtle();
  const digest = await api.digest('SHA-256', enc.encode(message));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish compare. Both sides are base64url of a fixed-length MAC, so
// length equality is not itself a secret.
function safeCompare(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomId(prefix) {
  const uuid = (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36));
  return prefix ? prefix + '_' + uuid.replace(/-/g, '') : uuid;
}

// ---------------------------------------------------------------------------
// Generic signed envelope: <prefix><base64url(payload)>.<mac>
// ---------------------------------------------------------------------------
async function signEnvelope(prefix, payload, secret) {
  const encoded = base64UrlJson(payload);
  const mac = await hmacSha256(encoded, secret);
  return prefix + encoded + '.' + mac;
}

async function verifyEnvelope(prefix, token, secret) {
  const raw = String(token || '').trim();
  if (!raw.startsWith(prefix)) throw new Error('invalid token');
  const parts = raw.slice(prefix.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('invalid token');
  const expected = await hmacSha256(parts[0], secret);
  if (!safeCompare(parts[1], expected)) throw new Error('invalid token');
  let payload;
  try {
    payload = decodeBase64UrlJson(parts[0]);
  } catch {
    throw new Error('invalid token');
  }
  if (!payload || typeof payload !== 'object') throw new Error('invalid token');
  if (!payload.exp || Number(payload.exp) <= nowSeconds()) throw new Error('token expired');
  return payload;
}

// ---------------------------------------------------------------------------
// nfs_ - user session, verify only. Byte-compatible with novaflow-backend's
// issueSessionToken(), which is what lets the Web line reuse the existing
// login without touching the Desktop backend.
// ---------------------------------------------------------------------------
async function verifySessionToken(token, sessionSecret) {
  if (!sessionSecret) throw new Error('session secret is not configured');
  const payload = await verifyEnvelope('nfs_', token, sessionSecret);
  if (!payload.sub) throw new Error('invalid token');
  return payload;
}

// ---------------------------------------------------------------------------
// nfw_ - worker identity.
// ---------------------------------------------------------------------------
async function issueWorkerToken(worker, controlSecret, ttlSeconds = 3600) {
  const iat = nowSeconds();
  const generation=worker.ownership_generation;
  if (generation !== undefined && generation !== null &&
      (typeof generation!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(generation)))
    throw new Error('invalid worker ownership generation');
  return await signEnvelope('nfw_', {
    kind: 'worker',
    wid: String(worker.id),
    owner: String(worker.owner_id || ''),
    ...(generation == null ? {} : {ownership_generation:generation}),
    name: String(worker.worker_name || ''),
    iat,
    exp: iat + ttlSeconds,
    nonce: randomId()
  }, controlSecret);
}

async function verifyWorkerToken(token, controlSecret) {
  const payload = await verifyEnvelope('nfw_', token, controlSecret);
  if (payload.kind !== 'worker' || !payload.wid) throw new Error('invalid token');
  return payload;
}

// ---------------------------------------------------------------------------
// The control secret, which signs worker tokens and derives grant keys.
//
// It does not have to be a secret anyone configures. Deriving it from the
// session secret - which every deployment already has, because that is what
// verifies logins - removes a setup step without weakening anything: the
// derivation is domain-separated, so holding a worker token tells you nothing
// about the session secret and vice versa.
//
// An explicit NOVAFLOW_WEB_CONTROL_SECRET still wins, for a deployment that
// wants the two rotated independently.
// ---------------------------------------------------------------------------
async function resolveControlSecret({ controlSecret, sessionSecret } = {}) {
  const explicit = String(controlSecret || '').trim();
  if (explicit) return explicit;
  const session = String(sessionSecret || '').trim();
  if (!session) return '';
  return await hmacSha256('novaflow-web-control-secret:v1', session);
}

// ---------------------------------------------------------------------------
// Per-worker grant key. Derived, never stored: the control plane can always
// recompute it, and a worker only ever learns its own.
// ---------------------------------------------------------------------------
async function deriveWorkerGrantKey(workerId, controlSecret) {
  return await hmacSha256('novaflow-web-grant-key:v1:' + String(workerId), controlSecret);
}

// ---------------------------------------------------------------------------
// nfg_ - short-lived file grant. Bound to user + task + worker + op, so it is
// useless anywhere else (spec 11).
// ---------------------------------------------------------------------------
function validateH3GrantRefs(refs) {
  if (!Array.isArray(refs) || refs.length !== 2) throw new Error('invalid H3 grant references');
  const names = new Set();
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) ||
        Object.keys(ref).sort().join(',') !== 'bytes,kind,name,sha256' ||
        typeof ref.name !== 'string' || !/^h3-[a-f0-9-]{36}-[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9]+)?$/.test(ref.name) ||
        ref.name.length > 128 || names.has(ref.name.toLowerCase()) || ref.kind !== 'image' || !Number.isSafeInteger(ref.bytes) ||
        ref.bytes < 1 || ref.bytes > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(ref.sha256))
      throw new Error('invalid H3 grant references');
    names.add(ref.name.toLowerCase());
  }
  return refs;
}

function validateH3GrantFile(taskId, file) {
  if (!file || typeof file!=='object' || Array.isArray(file) || Object.keys(file).sort().join(',')!=='bytes,kind,name,sha256' ||
      typeof taskId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(taskId) ||
      typeof file.name!=='string' || !new RegExp('^h3-'+taskId+'-result-[1-8]\\.(mp4|webm)$').test(file.name) ||
      file.kind!=='video' || !Number.isSafeInteger(file.bytes) || file.bytes<1 || file.bytes>8*1024*1024*1024 ||
      typeof file.sha256!=='string' || !/^[a-f0-9]{64}$/.test(file.sha256))
    throw new Error('invalid H3 grant output');
  return file;
}

async function issueGrantToken(input, grantKey) {
  const iat = nowSeconds();
  const ttl = Number(input.ttlSeconds) > 0 ? Number(input.ttlSeconds) : 900;
  const scoped = input.scope !== undefined;
  const h3 = input.scope === 'h3-idempotent-v1', h3Download=input.scope==='h3-download-v1';
  if (h3) {
    if (input.op !== 'upload' || !Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 20 ||
        typeof input.ownership_generation!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.ownership_generation))
      throw new Error('invalid H3 grant operation or attempt');
    validateH3GrantRefs(input.refs);
    if (!input.refs.every((ref,index)=>ref.name.startsWith(`h3-${input.taskId}-${index===0?'first':'last'}.`)))
      throw new Error('H3 grant task binding mismatch');
  } else if (h3Download) {
    if (input.op!=='download' || !Number.isSafeInteger(input.attempt) || input.attempt<1 || input.attempt>20 ||
        typeof input.ownership_generation!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.ownership_generation) ||
        typeof input.proof!=='string' || !input.proof.startsWith('nfh_') || input.proof.length>8192)
      throw new Error('invalid H3 download grant');
    validateH3GrantFile(String(input.taskId),input.file);
  } else if (scoped && (!['qwen-foart-plan-v1','qwen21-local-image-edit-v1'].includes(input.scope) ||
      !Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 20)) {
    throw new Error('invalid grant scope or attempt');
  }
  return await signEnvelope('nfg_', {
    kind: 'grant',
    sub: String(input.userId),
    task: String(input.taskId),
    wid: String(input.workerId),
    op: String(input.op),
    ...(h3 ? {scope:input.scope,attempt:input.attempt,ownership_generation:input.ownership_generation,refs:input.refs}
      : h3Download ? {scope:input.scope,attempt:input.attempt,ownership_generation:input.ownership_generation,file:input.file,proof:input.proof}
      : scoped ? {scope:input.scope,attempt:input.attempt} : {}),
    iat,
    exp: iat + ttl,
    nonce: randomId()
  }, grantKey);
}

async function verifyGrantToken(token, grantKey, expect = {}) {
  const payload = await verifyEnvelope('nfg_', token, grantKey);
  if (payload.kind !== 'grant') throw new Error('invalid token');
  if (payload.scope === 'h3-idempotent-v1') {
    if (payload.op !== 'upload' || !Number.isSafeInteger(payload.attempt) || payload.attempt < 1 || payload.attempt > 20 ||
        typeof payload.ownership_generation!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.ownership_generation))
      throw new Error('invalid H3 grant operation or attempt');
    validateH3GrantRefs(payload.refs);
    if (!payload.refs.every((ref,index)=>ref.name.startsWith(`h3-${payload.task}-${index===0?'first':'last'}.`)))
      throw new Error('H3 grant task binding mismatch');
  } else if (payload.scope==='h3-download-v1') {
    if(payload.op!=='download' || !Number.isSafeInteger(payload.attempt) || payload.attempt<1 || payload.attempt>20 ||
       typeof payload.ownership_generation!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.ownership_generation) ||
       typeof payload.proof!=='string' || !payload.proof.startsWith('nfh_') || payload.proof.length>8192)
      throw new Error('invalid H3 download grant');
    validateH3GrantFile(String(payload.task),payload.file);
  } else if (payload.scope !== undefined && (!['qwen-foart-plan-v1','qwen21-local-image-edit-v1'].includes(payload.scope) ||
      !Number.isSafeInteger(payload.attempt) || payload.attempt < 1 || payload.attempt > 20)) {
    throw new Error('invalid grant scope or attempt');
  }
  if (expect.taskId && String(payload.task) !== String(expect.taskId)) throw new Error('grant task mismatch');
  if (expect.workerId && String(payload.wid) !== String(expect.workerId)) throw new Error('grant worker mismatch');
  if (expect.op && String(payload.op) !== String(expect.op)) throw new Error('grant op mismatch');
  return payload;
}

// Worker grant keys are known to workers; this independent proof is signed
// with a server-only derived key and is always revalidated against live state.
async function h3DownloadProofKey(controlSecret) {
  if (typeof controlSecret!=='string' || !controlSecret.trim()) throw new Error('control secret is not configured');
  return await hmacSha256('novaflow-web-h3-download-proof:v1',controlSecret);
}
function validateH3DownloadProof(payload) {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!payload || payload.kind!=='h3-download-proof-v1' || payload.aud!=='novaflow-web-h3-download' ||
      !uuid.test(String(payload.sub||'')) || !uuid.test(String(payload.sid||'')) || !uuid.test(String(payload.wid||'')) ||
      !Number.isSafeInteger(payload.attempt) || payload.attempt<1 || payload.attempt>20 ||
      typeof payload.ownership_generation!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.ownership_generation) ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp<=payload.iat || payload.exp-payload.iat>60)
    throw new Error('invalid H3 download proof');
  validateH3GrantFile(String(payload.task),payload.file);
}
async function issueH3DownloadProof(input,controlSecret) {
  const iat=nowSeconds();
  if(!Number.isSafeInteger(input?.sessionExpiresAt) || !Number.isSafeInteger(input?.resultExpiresAt))
    throw new Error('invalid H3 download expiry');
  const payload={kind:'h3-download-proof-v1',aud:'novaflow-web-h3-download',sub:input.userId,sid:input.sessionId,
    task:input.taskId,wid:input.workerId,attempt:input.attempt,ownership_generation:input.ownershipGeneration,file:input.file,
    iat,exp:Math.min(iat+60,input.sessionExpiresAt,input.resultExpiresAt)};
  validateH3DownloadProof(payload);
  return await signEnvelope('nfh_',payload,await h3DownloadProofKey(controlSecret));
}
async function verifyH3DownloadProofSignature(token,controlSecret) {
  if(typeof token!=='string' || token.length>8192)throw new Error('invalid H3 download proof');
  const payload=await verifyEnvelope('nfh_',token,await h3DownloadProofKey(controlSecret));
  validateH3DownloadProof(payload);
  if(payload.iat>nowSeconds())throw new Error('invalid H3 download proof');
  return payload;
}

// This proof is for server-to-server validation of the reserved Qwen
// rotation candidate only. It is never an authorization decision by itself:
// the control plane must also re-check the stored task, owner, session,
// attempt and operation transactionally. The worker receives neither the
// control secret nor this derived key.
const QWEN_ROTATION_PROOF_PREFIX = 'nfr_';
const QWEN_ROTATION_PROOF_MAX_SECONDS = 60;
const QWEN_ROTATION_TASK_ID = /^fa047a0a-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const rotationProofOp = value => value === 'upload' || value === 'download';
async function rotationProofKey(controlSecret) {
  if (typeof controlSecret !== 'string' || !controlSecret.trim()) throw new Error('control secret is not configured');
  return await hmacSha256('novaflow-web-qwen-rotation-proof:v1', controlSecret);
}
function validRotationProofFields(payload) {
  return payload && payload.kind === 'qwen-rotation-proof-v1' &&
    payload.scope === 'qwen-foart-rotation-candidate-v1' && payload.aud === 'novaflow-web-candidate-verifier' &&
    QWEN_ROTATION_TASK_ID.test(payload.task) && CANONICAL_UUID.test(payload.wid) &&
    CANONICAL_UUID.test(payload.sub) && CANONICAL_UUID.test(payload.sid) &&
    Number.isSafeInteger(payload.attempt) && payload.attempt > 0 &&
    rotationProofOp(payload.op) && Number.isSafeInteger(payload.iat) &&
    Number.isSafeInteger(payload.exp) && payload.exp > payload.iat &&
    payload.exp - payload.iat <= QWEN_ROTATION_PROOF_MAX_SECONDS;
}

async function issueQwenRotationProof(input, controlSecret) {
  const iat = nowSeconds();
  if (!input || !Number.isSafeInteger(input.sessionExpiresAt) || input.sessionExpiresAt <= iat)
    throw new Error('invalid candidate session expiry');
  const payload = {kind:'qwen-rotation-proof-v1',scope:'qwen-foart-rotation-candidate-v1',
    aud:'novaflow-web-candidate-verifier',sub:input.userId,sid:input.sessionId,
    task:input.taskId,wid:input.workerId,attempt:input.attempt,op:input.op,iat,
    exp:Math.min(input.sessionExpiresAt,iat+QWEN_ROTATION_PROOF_MAX_SECONDS)};
  if (!validRotationProofFields(payload)) throw new Error('invalid candidate proof');
  return await signEnvelope(QWEN_ROTATION_PROOF_PREFIX,payload,await rotationProofKey(controlSecret));
}

// Signature validation only; callers must reject on an unavailable/negative
// authoritative database check, even if this signature is valid.
async function verifyQwenRotationProofSignature(token, controlSecret) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('invalid candidate proof');
  const payload = await verifyEnvelope(QWEN_ROTATION_PROOF_PREFIX,token,await rotationProofKey(controlSecret));
  if (!validRotationProofFields(payload) || payload.iat > nowSeconds()) throw new Error('invalid candidate proof');
  return payload;
}

// ---------------------------------------------------------------------------
// Worker secret hashing. The control plane stores only the hash, so a database
// read never yields a usable worker credential.
// ---------------------------------------------------------------------------
async function hashWorkerSecret(workerId, secret) {
  return await sha256Hex('novaflow-worker-secret:v1:' + String(workerId) + ':' + String(secret));
}

function generateWorkerSecret() {
  const bytes = new Uint8Array(32);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return toBase64Url(bytes);
}

function bearerToken(headerValue) {
  const auth = String(headerValue || '');
  return /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : '';
}

// ===== pricing.mjs ===================================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/pricing.mjs
// Regenerate with: npm run sync:edge
// NovaFlow Web - credit pricing.
//
// Spec 17: the trusted backend decides the cost. Neither the browser nor the
// worker may supply, influence or negotiate a number.
//
// WHAT COSTS CREDITS: only what a third party bills for - Grok, GPT, Google.
// Generation that runs on this pool's own GPUs is free, however many machines
// are in it and whoever owns them. Charging for someone's own hardware would
// be inventing a fee, not recovering one.
//
// The Desktop line settles ComfyUI usage with a client-reported
// `comfy_api_exact_price_v1` amount. That is a reasonable trust assumption for
// a signed desktop build talking to a ComfyUI on the same machine; it is NOT
// acceptable for a browser we do not control, so where the Web line does
// charge, it derives every cost here from validated business parameters only.
//
// Cost is expressed in credits with 6 decimals, matching the precision the
// existing settle_comfy_usage RPC enforces.



// Base rates. Deliberately simple and auditable: a rate card, not a formula
// nobody can reproduce by hand.
const IMAGE_PRICE_KEY = 'image';
const PRICE_TABLE = Object.freeze({
  [IMAGE_PRICE_KEY]: {
    // per megapixel of output, per 20 sampling steps
    perMegapixelPer20Steps: 1.2,
    minimum: 0.6
  },
  [TASK_TYPE.H3_I2V]: {
    // per second of generated video at 720p-equivalent
    perSecondAt720p: 6.0,
    minimum: 12.0
  }
});

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Derive the credit cost of a task from its business parameters.
 * Returns { creditCost, breakdown, source } - never throws for odd input; it
 * clamps instead, so a hostile browser gets a sane (and never cheaper) price.
 */
function priceTask(taskType, parameters = {}) {
  const type = String(taskType || '');

  // Work that runs on this pool's own GPUs is free. Credits meter what a third
  // party bills for - Grok, GPT, Google - not somebody's own graphics card.
  if (!isMetered(type)) {
    return {
      creditCost: 0,
      source: 'novaflow_web_self_hosted_v1',
      breakdown: { billing: 'self_hosted', reason: '在自有算力上运行，不计积分' }
    };
  }
  return priceFromRateCard(type, parameters);
}

/**
 * The rate card itself, independent of who pays.
 *
 * Exported so it stays under test: every task type today is self-hosted and
 * therefore free, and a rate card nothing exercises is a rate card that has
 * quietly rotted by the time a provider-backed task type needs it.
 */
function priceFromRateCard(taskType, parameters = {}) {
  const type = String(taskType || '');
  const params = parameters && typeof parameters === 'object' ? parameters : {};

  if (type === IMAGE_PRICE_KEY) {
    const rate = PRICE_TABLE[type];
    const width = clampInt(params.width, 256, 4096, 1024);
    const height = clampInt(params.height, 256, 4096, 1024);
    const steps = clampInt(params.steps, 1, 100, 20);
    const count = clampInt(params.count, 1, 10, 1);
    const megapixels = (width * height) / 1_000_000;
    const perImage = Math.max(
      rate.minimum,
      rate.perMegapixelPer20Steps * megapixels * (steps / 20)
    );
    const creditCost = round6(perImage * count);
    return {
      creditCost,
      source: 'novaflow_web_rate_card_v1',
      breakdown: { width, height, steps, count, megapixels: round6(megapixels), perImage: round6(perImage) }
    };
  }

  if (type === TASK_TYPE.H3_I2V) {
    const rate = PRICE_TABLE[type];
    const width = clampInt(params.width, 256, 2048, 1280);
    const height = clampInt(params.height, 256, 2048, 720);
    const duration = Math.min(30, Math.max(1, Number(params.duration_seconds) || 5));
    // 720p reference area; a bigger frame costs proportionally more.
    const areaRatio = (width * height) / (1280 * 720);
    const creditCost = round6(Math.max(rate.minimum, rate.perSecondAt720p * duration * areaRatio));
    return {
      creditCost,
      source: 'novaflow_web_rate_card_v1',
      breakdown: { width, height, duration, areaRatio: round6(areaRatio) }
    };
  }

  return { creditCost: 0, source: 'novaflow_web_rate_card_v1', breakdown: { unknownTaskType: type } };
}

/**
 * What the user is quoted before the task runs. Identical to the settled cost
 * in this version - we quote what we charge, so there is no surprise delta.
 */
function estimateTask(taskType, parameters) {
  return priceTask(taskType, parameters);
}

// ===== workflow-modules.mjs ==========================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/workflow-modules.mjs
// Regenerate with: npm run sync:edge
// Renderer workflow modules the Web line will run.
//
// The browser sends {module, method, options}; this table says what that
// needs. It is an allow-list, so a module nobody vetted cannot be reached even
// though the worker has it loaded - and it is the one place to look when
// asking "which NovaFlow features work on the Web".
//
// Method names here are READ OFF the real modules, not guessed;
// tests/e2e/renderer-workflow.test.mjs fails if any of them stops existing.
//
// `label` is what a user sees. `runtime` picks the ComfyUI instance. `price`
// says how the cost is derived from the recorded options.

// Every image run that names no other model runs on Turbo.
const DEFAULT_IMAGE_MODEL_ID = 'qwen-image-2.1-turbo';
const QWEN21_EDIT_LORA_CAPABILITY = 'qwen-image-2.1-turbo-edit-lora-v1';
const QWEN21_EDIT_LORA_NAME = 'qwen/qwen2_1-femaledVaginus-nsfw-v1_3-fine_L22-31.safetensors';
const QWEN21_UC_LORA_NAME = 'qwen/qwen-image-2.1-uncensored-lora.safetensors';

const WORKFLOW_MODULES = Object.freeze({
  'novaflow-brand-runtime': {
    label: '绘图', modelId: DEFAULT_IMAGE_MODEL_ID, minVramMb: 16000,
    runtime: 'image', kind: 'image', price: 'image', positional: true,
    methods: ['buildArtGenerateRunWorkflow']
  },
  // Private builders used by the art tools have positional arguments, unlike
  // the exported workflow modules. Only these audited builders are callable.
  // buildSeeThroughSplitWorkflow is 一键拆图: the node runs See-through and
  // copies the layer files back by name (worker-core collectSeeThroughOutputs).
  // The builders whose first argument is the node catalogue (the page sends an
  // empty object) are listed in workflow-host CATALOGUE_FIRST and get this
  // node's catalogue when replayed.
  'spine-split-runtime': {
    label: '美工 · 补图 / 抠图 / 拆图 / 放大 / 扩图 / 迁移 / 角度 / 特效',
    modelId: DEFAULT_IMAGE_MODEL_ID,
    minVramMb: 16000,
    runtime: 'image', kind: 'image', price: 'image',
    positional: true,
    methods: [
      'defaultQwenInpaintWorkflow', 'defaultQwenLoraInpaintWorkflow', 'defaultRemovalInpaintWorkflow', 'defaultRmbgWorkflow', 'samPointWorkflowFromPrompts',
      'buildSeeThroughSplitWorkflow', 'buildSeedVr2ImageUpscaleWorkflow', 'buildQwenImageOutpaintWorkflow',
      'buildImageAngleAdjustWorkflow', 'buildObjectTransferQwen21Workflow',
      'buildEffectExtractQwenWorkflow', 'buildEffectDeeffectQwenWorkflow', 'buildGenerativeSplitWorkflow'
    ]
  },
  // ---- 美工 -------------------------------------------------------------
  NovaFlowArtGenerateProviderWorkflow: {
    label: '绘图',
    modelId: DEFAULT_IMAGE_MODEL_ID,
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['buildWorkflow', 'buildRunWorkflow']
  },
  // UI 设计 runs through the 绘图 builders on Qwen-Image-2.1; it has no builder of its own.

  // ---- AI 序列动画 ------------------------------------------------------
  NovaFlowAiSequenceMiniMaxH3Workflow: {
    label: 'AI 序列动画',
    modelId: 'minimax-h3',
    minVramMb: 15000,
    runtime: 'video',
    kind: 'video',
    price: 'video',
    methods: ['getWorkflowJson', 'buildWorkflow']
  },
  NovaFlowAiSequenceVideoMergeExportWorkflow: {
    label: 'AI 序列 · 合成导出',
    modelId: 'minimax-h3',
    minVramMb: 15000,
    runtime: 'video',
    kind: 'video',
    price: 'video',
    methods: ['createWorkflow']
  },

  // ---- AI 特效 ----------------------------------------------------------
  NovaFlowAifxRestyleWorkflow: {
    label: 'AI 特效',
    modelId: 'minimax-h3',
    minVramMb: 15000,
    runtime: 'video',
    kind: 'video',
    price: 'video',
    methods: ['buildWorkflow']
  },

  // ---- 拆图 / 抠图 ------------------------------------------------------
  NovaFlowSplitInpaintNsfwWorkflow: {
    label: '拆图 · 补全',
    modelId: DEFAULT_IMAGE_MODEL_ID,
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['buildWorkflow']
  }
});

// Build-time file names must resolve to the same public API names accepted by
// the control plane. Private runtimes retain their file name.
const WORKFLOW_SOURCE_MODULES = Object.freeze({
  'art-generate-provider.workflow': 'NovaFlowArtGenerateProviderWorkflow',
  'ai-sequence-minimax-h3.workflow': 'NovaFlowAiSequenceMiniMaxH3Workflow',
  'ai-sequence-video-merge-export.workflow': 'NovaFlowAiSequenceVideoMergeExportWorkflow',
  'aifx-restyle.workflow': 'NovaFlowAifxRestyleWorkflow',
  'split-inpaint-nsfw.workflow': 'NovaFlowSplitInpaintNsfwWorkflow'
});

function workflowModule(name) {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_MODULES, String(name || ''))
    ? WORKFLOW_MODULES[String(name)]
    : null;
}

function isAllowedWorkflowCall(name, method) {
  const entry = workflowModule(name);
  if (!entry) return false;
  return entry.methods.includes(String(method || ''));
}

// The model a renderer run needs. A drawing or UI-design run that asks for Qwen-Image-2.1 records it
// in its run state (__args[8]); the node builds the 2.1 graph under exactly these conditions (see
// buildArtGenerateRunWorkflow), so such a run is queued for the 2.1 model and a node without it
// never claims it.
function workflowModelId(name, options, method='') {
  const entry = workflowModule(name);
  if (!entry) return null;
  if (name === 'spine-split-runtime' && method === 'defaultQwenLoraInpaintWorkflow') return QWEN21_EDIT_LORA_CAPABILITY;
  if (name === 'spine-split-runtime' && method === 'defaultRmbgWorkflow') {
    const node=options?.__args?.[3];
    return !node || node.name === 'BiRefNetRMBG' ? 'foart-rmbg-birefnet-general-v1' : 'foart-rmbg-explicit-node-unavailable-v1';
  }
  if (name === 'spine-split-runtime' && method === 'defaultRemovalInpaintWorkflow') return 'foart-flux-removal-v1';
  if (name === 'spine-split-runtime' && method === 'buildSeedVr2ImageUpscaleWorkflow') return 'foart-seedvr2-upscale-v1';
  if (name === 'spine-split-runtime' && method === 'buildSeeThroughSplitWorkflow') return options?.__args?.[2]?.useLama === false ? 'foart-seethrough-v1' : 'foart-seethrough-lama-v1';
  if (name === 'spine-split-runtime' && method === 'samPointWorkflowFromPrompts') {
    const size=options?.__args?.[4]?.modelSize;
    return size === 'ViT-B' ? 'foart-sam-vit-b-v1' : size === 'ViT-L' ? 'foart-sam-vit-l-v1' : size === 'ViT-H' ? 'foart-sam-vit-h-v1' : 'foart-sam-auto-v1';
  }
  if (name === 'spine-split-runtime' && method === 'defaultQwenInpaintWorkflow') {
    const opts=options?.__args?.[5] || {};
    const provider=opts.route?.provider || opts.inpaintProvider;
    if (provider === 'flux-fill') return 'foart-flux-fill-v1';
    if (opts.route?.nsfw === true || provider === 'qwen-2.1-nsfw-lora' || provider === true) throw Object.assign(new Error('旧 NSFW 补图路由已退役，请重新打开当前开关后提交。'),{code:'RETIRED_NSFW_INPAINT_ROUTE'});
    return 'foart-qwen21-inpaint-v1';
  }
  if (name === 'spine-split-runtime' && (method === 'buildGenerativeSplitWorkflow' || options?.__args?.[1]?.taskProfile === 'generative-split')) {
    return 'qwen-image-2.1-turbo';
  }
  if (name === 'NovaFlowArtGenerateProviderWorkflow' && method === 'buildRunWorkflow' && options?.provider === 'local' && options?.localWorkflow && typeof options.localWorkflow === 'object') {
    const loaders=Object.values(options.localWorkflow).filter(node=>node?.class_type === 'NovaFlowGGUFBF16Loader' || node?.class_type === 'UNETLoader').map(node=>node?.inputs?.unet_name);
    if (loaders.includes('Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors')) return 'qwen-image-2.1-turbo';
  }
  const args = name === 'novaflow-brand-runtime' && Array.isArray(options?.__args) ? options.__args : null;
  if (args && args[0] === 'local') {
    const state = args[8] && typeof args[8] === 'object' ? args[8] : {};
    const profile = String(args[10]?.taskProfile || '');
    const ui = profile.toLowerCase() === 'ui-design' && state.localUiEngine === 'qwen-2.1';
    const draw = !/^ui-design/i.test(profile) && state.localDrawEngine === 'qwen-2.1';
    if (ui || draw) return 'qwen-image-2.1-turbo';
  }
  if(name==='spine-split-runtime'&&['buildQwenImageOutpaintWorkflow','buildImageAngleAdjustWorkflow','buildObjectTransferQwen21Workflow','buildEffectExtractQwenWorkflow','buildEffectDeeffectQwenWorkflow'].includes(method))return 'qwen-image-2.1-turbo';
  if (name === 'NovaFlowAiSequenceMiniMaxH3Workflow' && [
    options?.profile, options?.params?.profile
  ].some(profile => ['beta6_int8', 'minimax-h3-beta6'].includes(String(profile || '')))) {
    throw Object.assign(new Error('beta6 已下线，请选择本地 beta5 后重新提交；未自动替换模型。'), { code: 'H3_PROFILE_RETIRED' });
  }
  return entry.modelId;
}

function workflowModuleNames() {
  return Object.keys(WORKFLOW_MODULES);
}

/**
 * Every method a browser may reach, across all modules. The redaction pass
 * force-hollows exactly these, so the PUBLIC entry point records the intent
 * and the private helpers below it are never entered - otherwise the recorded
 * intent would name a private function the worker cannot call.
 */
function allWorkflowEntryMethods() {
  const names = new Set();
  for (const spec of Object.values(WORKFLOW_MODULES)) {
    for (const method of spec.methods) names.add(method);
  }
  return [...names];
}

// ===== model-manifest.mjs ============================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/model-manifest.mjs
// Regenerate with: npm run sync:edge
// NovaFlow Web - model manifest (spec 22).
//
// The worker checks this against what the local ComfyUI can actually load,
// and reports ready / missing / invalid / updating. The scheduler only ever
// hands a task to a worker that reports 'ready' for the required model, so a
// machine with half a model installed is simply not eligible - a user task is
// never spent discovering that.
//
// The filenames below were read from the live runtimes this project targets
// (/object_info on 127.0.0.1:8188 and :8189), not invented. `sha256: null`
// means we have not pinned a digest for that file; the worker then verifies
// presence and size and SAYS so, rather than implying it checked a hash.

const MODEL_MANIFEST = Object.freeze([
  {
    model_id: 'minimax-h3',
    display_name: 'MiniMax H3 (image to video)',
    version: '0.31.1',
    runtime: 'video',
    // The shipped H3 weights are int8/nvfp4 quantised; the reference runtime
    // serves them on a 16 GB card, so the floor is set from what actually
    // runs rather than from the bf16 model's footprint.
    min_vram_mb: 15000,
    compatible_workflows: ['h3_i2v.json'],
    required_files: [
      {
        path: 'diffusion_models/Minimax_H3/10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors',
        min_bytes: 5_000_000_000,
        sha256: null
      },
      {
        path: 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
        min_bytes: 4_000_000_000,
        sha256: null
      },
      { path: 'vae/minimax_h3_video_vae_fp16.safetensors', min_bytes: 50_000_000, sha256: null },
      { path: 'vae/minimax_h3_audio_vae_fp32.safetensors', min_bytes: 10_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: 'Import from an existing NovaFlow H3 runtime (e.g. E:/NovaFlow/models) or configure a URL.'
    }
  },
  {
    model_id: 'birefnet-matting',
    display_name: 'BiRefNet (AI 抠图)',
    version: '2.0.0',
    // 'local' on purpose, and it is load-bearing. reportModels only asks
    // ComfyUI about runtimes 'image' and 'video'; a model tagged 'local' is
    // never looked for in a node catalogue that could not answer for it
    // anyway, and is never falsely matched by a checkpoint whose filename
    // happens to end the same way. Readiness comes from the files on disk.
    runtime: 'local',
    min_vram_mb: 4000,
    compatible_workflows: ['video_matting'],
    required_files: [
      // BiRefNet_lite (MIT), the ZhengPeng7/BiRefNet_lite folder as published; RMBG-2.0 is CC BY-NC.
      { path: 'RMBG/BiRefNet_lite/model.safetensors', min_bytes: 150_000_000, sha256: null },
      { path: 'RMBG/BiRefNet_lite/config.json', min_bytes: 100, sha256: null },
      { path: 'RMBG/BiRefNet_lite/birefnet.py', min_bytes: 10_000, sha256: null },
      { path: 'RMBG/BiRefNet_lite/BiRefNet_config.py', min_bytes: 100, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从模型包导入 models/RMBG/BiRefNet_lite（整个文件夹）。'
    }
  },
  {
    // Shared local Flash brain; image/video/audio generation encoders stay separate.
    model_id: 'prompt-assistant',
    display_name: '本地 AI 大脑 (Flash-Next)',
    version: 'swift-1.5-flash-next',
    runtime: 'local',
    min_vram_mb: 16000,
    compatible_workflows: ['prompt_assistant'],
    required_files: [
      { path: 'LLM/qwen38_swift15_strata/Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf', min_bytes: 39_788_473_344, sha256: 'ca3b302d3d1eb6eddce3ea4acc79854e6cc5fdc0583e374a6a8b6bb67327743b' },
      { path: 'LLM/qwen38_swift15_strata/Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00002-of-00002.gguf', min_bytes: 28_363_693_824, sha256: 'e4996a6de18fd49c58d9a0040fcfd73787db6407c51973f29884bee7b14c9dbb' },
      { path: 'LLM/qwen38_swift15_strata/mmproj-Swift-Qwen3.8-Flash-Next-BF16.gguf', min_bytes: 907_543_520, sha256: 'cd1140f4abba943ce8d9fa92fed8407e389954d26907efde7b72153c75bd8a60' },
      { path: 'LLM/qwen38_swift15_strata/strata-pack-resident/dense.bin', min_bytes: 100_000_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/strata-pack-resident/experts.bin', min_bytes: 30_000_000_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/strata-pack/tokenizer/vocab.json', min_bytes: 100_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/strata-pack-resident/index.txt', min_bytes: 100, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/mtp/rt/dense.bin', min_bytes: 100_000_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/mtp/rt/dense.txt', min_bytes: 100, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/mtp/rt/experts.bin', min_bytes: 700_000_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/mtp/rt/draft_vocab.bin', min_bytes: 400_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '导入 Flash-Next 模型目录（含 resident pack、tokenizer、MTP 与视觉投影），并安装环境包中的 Strata 引擎。'
    }
  },
  {
    // Drawing and UI design on Qwen-Image-2.1. A node reports it ready exactly when it can build the
    // 2.1 graph (detectQwenImage21, the check the builder itself makes), and the control plane queues
    // a run that asks for 2.1 on this model, so only such a node claims it.
    // Since 2026-11-06 the 普通 BF16 line is gone: this id stays for the control plane's qwenImage21
    // feature flag and pool queries, and names the same INT8 Turbo files as qwen-image-2.1-turbo.
    model_id: 'qwen-image-2.1',
    display_name: 'Qwen-Image-2.1 (Turbo INT8 ConvRot)',
    version: '2.1',
    runtime: 'image',
    min_vram_mb: 16000,
    compatible_workflows: ['novaflow-brand-runtime.buildArtGenerateRunWorkflow'],
    required_files: [
      { path: 'diffusion_models/Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors', min_bytes: 7_000_000_000, sha256: null },
      { path: 'text_encoders/qwen3vl_8b_bf16_heretic.safetensors', min_bytes: 17_000_000_000, sha256: null },
      { path: 'vae/qwen_image_2.1_vae_bf16.safetensors', min_bytes: 600_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '导入 Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors、BF16 编码器和 VAE。'
    }
  },
  {
    // INT8 ConvRot weights in ComfyUI's scaled-int8 layout (converted from the Unsloth export with
    // work/art-style-ab-20261105/convert_unsloth_int8_convrot_to_comfy.py), loaded by UNETLoader.
    model_id:'qwen-image-2.1-turbo', display_name:'Qwen-Image-2.1 Turbo INT8 ConvRot', version:'2.1-turbo', runtime:'image', min_vram_mb:16000,
    compatible_workflows:['novaflow-brand-runtime.buildArtGenerateRunWorkflow','spine-split-runtime'],
    required_files:[
      {path:'diffusion_models/Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors',min_bytes:7_000_000_000,sha256:null},
      {path:'text_encoders/qwen3vl_8b_bf16_heretic.safetensors',min_bytes:17_000_000_000,sha256:null},
      {path:'vae/qwen_image_2.1_vae_bf16.safetensors',min_bytes:600_000_000,sha256:null}
    ],download:{mode:'import_or_configured_url',hint:'导入 Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors、BF16 编码器和 VAE；需要 ManualSigmas 与 SamplerCustom 节点。'}
  },
  {
    // 音频 · 音乐. The medium text-to-audio checkpoint plus its text encoder.
    // Open weights, community licence; the panel never names it.
    model_id: 'audio-music',
    display_name: '音频生成 (音乐)',
    version: '3.0',
    runtime: 'image',
    min_vram_mb: 8000,
    compatible_workflows: ['audio_music.json'],
    required_files: [
      { path: 'checkpoints/stable_audio_3_medium.safetensors', min_bytes: 9_000_000_000, sha256: null },
      { path: 'text_encoders/t5gemma_b_b_ul2.safetensors', min_bytes: 1_100_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从已有的 NovaFlow 模型目录导入 checkpoints/stable_audio_3_medium.safetensors 、text_encoders/t5gemma_b_b_ul2.safetensors，并安装 novaflow_audio 节点。'
    }
  },
  {
    // 音频 · 音效. The small effects checkpoint shares the text encoder above.
    model_id: 'audio-sfx',
    display_name: '音频生成 (音效)',
    version: '3.0',
    runtime: 'image',
    min_vram_mb: 4000,
    compatible_workflows: ['audio_sfx.json'],
    required_files: [
      { path: 'checkpoints/stable_audio_3_small_sfx.safetensors', min_bytes: 1_300_000_000, sha256: null },
      { path: 'text_encoders/t5gemma_b_b_ul2.safetensors', min_bytes: 1_100_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从已有的 NovaFlow 模型目录导入 checkpoints/stable_audio_3_small_sfx.safetensors 、text_encoders/t5gemma_b_b_ul2.safetensors，并安装 novaflow_audio 节点。'
    }
  }
]);

const QWEN21_MODEL_ID = 'qwen-image-2.1';
// No node advertises these, so a task queued for one would wait forever.
const RETIRED_MODEL_IDS = Object.freeze(['qwen-image-2511', 'prompt-assistant']);

function findModel(modelId) {
  return MODEL_MANIFEST.find((m) => m.model_id === String(modelId || '')) || null;
}

function manifestModelIds() {
  return MODEL_MANIFEST.map((m) => m.model_id);
}

/** Which ComfyUI runtime a model needs: the image node or the video node. */
function runtimeFor(modelId) {
  return findModel(modelId)?.runtime || 'image';
}

// ===== control-plane.mjs =============================================
// GENERATED COPY - do not edit here.
// Source: packages/shared/src/control-plane.mjs
// Regenerate with: npm run sync:edge

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

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PROMPT_CHARS = 12000;
const UI_CPU_CAPABILITY = 'foart-ui-cpu-compiler-v1';
const QWEN21_NATIVE_REWRITE_V3_CAPABILITY = 'qwen3.5-9b-heretic-qwen21-native-rewrite-v3';
const QWEN_PLAN_SCOPE = 'qwen-foart-plan-v1';
const QWEN_PLAN_CAPABILITY = 'qwen3.5-9b-heretic-foart-plan-v1';
const QWEN_PLAN_REQUEST_FILE = 'qwen-foart-plan-request.json';
const QWEN_PLAN_RESULT_FILE = attempt => `qwen-foart-plan-result-${attempt}.json`;
const QWEN_IMAGE_EDIT_SCOPE = 'qwen21-local-image-edit-v1';
const QWEN_IMAGE_EDIT_CAPABILITY = 'qwen3.5-9b-heretic-qwen21-local-image-edit-v1';
const QWEN_IMAGE_EDIT_REQUEST_FILE = 'qwen21-local-image-edit-request.json';
const QWEN_IMAGE_EDIT_RESULT_FILE = attempt => `qwen21-local-image-edit-result-${attempt}.json`;
const QWEN_IMAGE_EDIT_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

// ---------------------------------------------------------------------------
// Parameter validation. Everything a browser sends is clamped to a range we
// are willing to run; nothing is passed through to a workflow unexamined.
// ---------------------------------------------------------------------------
function sanitizeText(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function validateTaskParameters(taskType, raw) {
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
    if (isQwenRotationCandidateTask({model_id:input.model_id,modelId:input.modelId,input_manifest:{parameters:input}}))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen rotation candidate owner lease unavailable');
    if (isQwenUiDraftTask({ model_id: input.model_id, input_manifest: { parameters: input } }))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen UI owner lease unavailable');
    if (Object.hasOwn(input, 'assistant_tool_scope') || Object.hasOwn(input, 'assistantToolScope')) {
      const allowed = ['action','model_id','assistant_tool_scope','request_id','request_sha256','request_bytes','references'];
      const imageEdit=input.assistant_tool_scope===QWEN_IMAGE_EDIT_SCOPE;
      if (Object.keys(input).some(k => !allowed.includes(k)) || ![QWEN_PLAN_SCOPE,QWEN_IMAGE_EDIT_SCOPE].includes(input.assistant_tool_scope) ||
          input.action !== (imageEdit?'optimize-prompt':'art-agent-chat') || input.model_id !== PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID ||
          typeof input.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.request_id) ||
          typeof input.request_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.request_sha256) ||
          !Number.isSafeInteger(input.request_bytes) || input.request_bytes < 1 || input.request_bytes > (imageEdit?QWEN_IMAGE_EDIT_MAX_REQUEST_BYTES:262144) ||
          cleanRefs.length !== 1 || cleanRefs[0].name !== (imageEdit?QWEN_IMAGE_EDIT_REQUEST_FILE:QWEN_PLAN_REQUEST_FILE) || cleanRefs[0].kind !== 'json' ||
          cleanRefs[0].bytes !== input.request_bytes) throw bad('invalid Qwen Foart plan task');
      return {action:input.action,model_id:PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID,
        assistant_tool_scope:input.assistant_tool_scope,request_id:input.request_id,request_sha256:input.request_sha256,
        request_bytes:input.request_bytes,references:cleanRefs};
    }
    const action = sanitizeText(input.action, 40);
    if (!PROMPT_ASSISTANT_ACTIONS.includes(action)) throw bad('unsupported prompt assistant action: ' + action);
    const hasScope = Object.hasOwn(input, 'assistant_selection_scope') || Object.hasOwn(input, 'assistantSelectionScope');
    const scope = Object.hasOwn(input, 'assistant_selection_scope') ? input.assistant_selection_scope : input.assistantSelectionScope;
    if (hasScope && (scope !== 'xiaotao' || action === 'art-agent-chat'
        || (Object.hasOwn(input, 'assistant_selection_scope') && Object.hasOwn(input, 'assistantSelectionScope') && input.assistantSelectionScope !== scope))) {
      throw bad('invalid assistant selection scope');
    }
    if (cleanRefs.length !== 1 || cleanRefs[0].name !== PROMPT_ASSISTANT_REQUEST_FILE || cleanRefs[0].kind !== 'json') {
      throw bad('a prompt assistant task carries its request as ' + PROMPT_ASSISTANT_REQUEST_FILE);
    }
    // UI's bounded CPU compiler is a task capability, not a user-selected
    // model. The server alone assigns its model identity and the worker checks
    // the actual uploaded request against the scoped action whitelist.
    if (Object.hasOwn(input,'ui_scope') || Object.hasOwn(input,'uiScope')) {
      if (input.ui_scope !== 'cpu-v1' || Object.hasOwn(input,'uiScope') || action !== 'reverse-image-prompt' ||
          hasScope || Object.hasOwn(input,'assistant_model_id') || Object.hasOwn(input,'assistantModelId') ||
          Object.hasOwn(input,'model_id') || Object.hasOwn(input,'modelId')) throw bad('invalid UI CPU scope');
      return {action,ui_scope:'cpu-v1',model_id:UI_CPU_CAPABILITY,references:cleanRefs};
    }
    // Legacy business payloads may use modelId for a generation model. Only
    // a dedicated assistant field may change their node routing.
    if (action !== 'art-agent-chat') {
      const hasAssistant=Object.hasOwn(input,'assistant_model_id') || Object.hasOwn(input,'assistantModelId');
      if (hasScope && !Object.hasOwn(input, 'assistant_model_id')) throw bad('xiaotao assistant model selection is required');
      if(hasAssistant) {
        const assistantId=Object.hasOwn(input,'assistant_model_id')?input.assistant_model_id:input.assistantModelId;
        if(assistantId!==PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID
          || (Object.hasOwn(input,'assistant_model_id')&&Object.hasOwn(input,'assistantModelId')&&input.assistantModelId!==assistantId)
          || (Object.hasOwn(input,'model_id')&&input.model_id!==assistantId))
          throw bad('unsupported assistant model for prompt business action');
        return {action,model_id:PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY,references:cleanRefs};
      }
      // UI design's explicitly marked CPU compiler still uses the legacy
      // reverse-image envelope; its payload is checked by the node.
      if(action!=='reverse-image-prompt')throw bad('请先选择小桃 AI 模型并重新提交。');
      return { action, references: cleanRefs };
    }
    const hasModelId = Object.hasOwn(input, 'model_id') || Object.hasOwn(input, 'modelId');
    const modelId = Object.hasOwn(input, 'model_id') ? input.model_id : input.modelId;
    if (!hasModelId) throw bad('请先选择小桃 AI 模型并重新提交。');
    if (hasModelId && (typeof modelId !== 'string' || modelId !== PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID
        || (Object.hasOwn(input, 'model_id') && Object.hasOwn(input, 'modelId') && input.modelId !== modelId))) {
      throw bad('unsupported prompt assistant model or action');
    }
    return { action, ...(hasModelId ? { model_id: modelId } : {}), references: cleanRefs };
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

  throw bad('unsupported task type: ' + String(taskType));
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

const MAX_TASK_OUTPUT_FILES = 96;

function sanitizeWorkflowOptions(raw, depth = 0) {
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
function pricingViewOf(options) {
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
const MAX_TASK_REFERENCES = 20;

function sanitizeReferences(raw) {
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
// Deployment-side settings only: never pass request bodies or query values.
function qwenRotationControlOptions({verify,create}={}) {
  return {qwenRotationVerifyEnabled:verify === 'true',qwenRotationCreateEnabled:create === 'true'};
}

/** @param {{store:any,secrets:any,logger?:(...args:any[])=>void,companion?:{reply:(input:any)=>Promise<any>}|null,qwenRotationVerifyEnabled?:boolean,qwenRotationCreateEnabled?:boolean}} options */
function createControlPlane({ store, secrets, logger=()=>{}, companion=null, qwenRotationVerifyEnabled=false, qwenRotationCreateEnabled=false, qwenPlanEnabled=false, qwen21LocalImageEditEnabled=false, assistantAudioCreateOnceEnabled=false, h3CreateOnceEnabled=false, h3RecoveryEnabled=false, h3DownloadEnabled=false, h3AtomicCompletionEnabled=false, workerExplicitStopEnabled=false, workerStopReadiness=null }) {
  const log = logger || (() => {});
  const sessionSecret = secrets?.sessionSecret || '';
  const controlSecret = secrets?.controlSecret || '';
  const xiaotaoMemory = createXiaotaoMemoryRoutes({store,requireUser,HttpError});
  const qwenScopeEnabled=scope=>scope===QWEN_PLAN_SCOPE ? qwenPlanEnabled===true : scope===QWEN_IMAGE_EDIT_SCOPE && qwen21LocalImageEditEnabled===true;

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

  // Bind art quotes to the verified login session, never a browser-supplied sid.
  async function requireArtActor(headers) {
    const user=await requireUser(headers);
    const token=bearerToken(headers.authorization || headers.Authorization);
    let payload;
    try {payload=await verifySessionToken(token,sessionSecret);}
    catch {throw new HttpError(401,ERROR_CODE.UNAUTHORIZED,'invalid session');}
    if(!Number.isSafeInteger(payload?.exp)||payload.exp<=Math.floor(Date.now()/1000))
      throw new HttpError(401,ERROR_CODE.UNAUTHORIZED,'invalid session expiry');
    const sessionId=payload?.sid ? String(payload.sid) : '';
    if(!sessionId||String(payload.sub)!==String(user.id))
      throw new HttpError(401,ERROR_CODE.UNAUTHORIZED,'session identity required');
    return {user,sessionId};
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

  // Extra identity requirements apply only to the H3 scoped protocol. Old
  // worker tokens continue to work on existing non-H3 paths.
  async function requireH3WorkerActor(headers,worker) {
    const payload=await verifyWorkerToken(bearerToken(headers.authorization || headers.Authorization),controlSecret);
    if (!payload.owner || !worker?.owner_id || String(payload.owner)!==String(worker.owner_id) ||
        typeof payload.ownership_generation!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.ownership_generation) ||
        payload.ownership_generation!==worker.ownership_generation ||
        worker.enabled!==true)
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video worker authorization unavailable');
    return {ownerId:String(payload.owner),generation:payload.ownership_generation};
  }

  function h3SnapshotPolicyValid(task,{download=false}={}) {
    const worker=task?.recovery_worker,user=task?.recovery_user;
    const expiry=user?.expires_at == null ? null : Date.parse(String(user.expires_at));
    return Boolean(worker && user && String(user.id)===String(task.user_id) &&
      String(user.status || '').toLowerCase()==='active' && (expiry===null || (Number.isFinite(expiry) && expiry>Date.now())) &&
      Array.isArray(worker.capabilities) && (download?['cap:h3-idempotent-v1']:['minimax-h3','cap:h3-idempotent-v1']).every(model=>
        worker.capabilities.some(entry=>entry?.model_id===model && entry?.status==='ready')) && workerAllowsUser(worker,user));
  }

  function h3DownloadFile(task,name) {
    if (!task || task.status!==TASK_STATE.COMPLETED || task.result_expired!==false || task.credit_settled!==true ||
        typeof name!=='string' || !new RegExp('^h3-'+String(task.id)+'-result-[1-8]\\.(mp4|webm)$').test(name)) return null;
    const expires=Date.parse(String(task.output_manifest?.expires_at || ''));
    if(!Number.isFinite(expires) || expires<=Date.now()) return null;
    const files=task.output_manifest?.files;
    if(!Array.isArray(files) || files.length<1 || files.length>8) return null;
    const matches=files.filter(item=>item?.name===name);
    if(matches.length!==1)return null;
    const file=matches[0];
    if(file.kind!=='video' || !Number.isSafeInteger(file.bytes) || file.bytes<1 || file.bytes>8*1024*1024*1024 ||
       typeof file.sha256!=='string' || !/^[a-f0-9]{64}$/.test(file.sha256))return null;
    return {file:{name:file.name,kind:'video',bytes:file.bytes,sha256:file.sha256},expiresAt:Math.floor(expires/1000)};
  }

  // Existing ordinary task storage is reused; this scope only returns a plan.
  // The private manifest is created by this server, not accepted from a node.
  async function requireQwenImageEditLease(task,bound,attempt,op,sha256=null,bytes=null) {
    if(typeof store.verifyQwenImageEditLease!=='function')throw new HttpError(503,'qwen_image_edit_lease_unavailable','Qwen image edit authorization unavailable');
    let authorized=false;
    try {authorized=await store.verifyQwenImageEditLease({taskId:String(task.id),workerId:String(bound.worker_id),
      userId:String(bound.user_id),sessionId:String(bound.session_id),attempt,op,sha256,bytes})===true;} catch {}
    if(!authorized)throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Qwen image edit authorization denied');
  }

  async function requireQwenPlanActor(headers, task) {
    const actor = await requireArtActor(headers);
    const bound = task?.input_manifest?.qwen_foart_plan;
    const contract=qwenScopedContract(task);
    if (!contract || !qwenScopeEnabled(contract.scope) || !qwenPlanUnexpired(task) || task.task_type !== PROMPT_ASSISTANT_TASK_TYPE || task.model_id !== contract.capability ||
        task.input_manifest?.parameters?.assistant_tool_scope !== contract.scope || !bound || bound.scope !== contract.scope ||
        String(task.user_id) !== String(actor.user.id) || bound.user_id !== String(actor.user.id) ||
        bound.session_id !== actor.sessionId || !Number.isSafeInteger(bound.session_expires_epoch) ||
        bound.session_expires_epoch <= nowSeconds() || !UUID_RE.test(String(bound.worker_id || '')))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen plan authorization denied');
    const worker = await store.getWorkerById(bound.worker_id);
    if (!qwenPlanUnexpired(task) || bound.session_expires_epoch <= nowSeconds() ||
        !worker || String(worker.owner_id || '') !== String(actor.user.id) || !workerAllowsUser(worker, actor.user) ||
        (contract.scope===QWEN_IMAGE_EDIT_SCOPE && (!UUID_V4_RE.test(String(bound.ownership_generation||'')) || bound.ownership_generation!==worker.ownership_generation)) ||
        (task.assigned_worker_id && String(task.assigned_worker_id) !== String(worker.id)))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen plan authorization denied');
    return {actor,worker,bound};
  }

  async function handleQwenPlanVerify(taskId, body, headers) {
    const worker = await requireWorker(headers);
    const uploadFinish = body?.op === 'upload' && body?.phase === 'finish';
    const required = uploadFinish ? ['op','phase','attempt','sha256','bytes'] : ['op','phase'];
    const allowed = uploadFinish ? required : ['op','phase','attempt'];
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !required.every(k => Object.hasOwn(body,k)) || Object.keys(body).some(k => !allowed.includes(k)) ||
        !['upload','download','wait','infer','complete'].includes(body.op) ||
        !['start','finish'].includes(body.phase) ||
        (body.phase === 'finish' && !uploadFinish && body.op !== 'infer') ||
        (body.op !== 'upload' && !Number.isSafeInteger(body.attempt)) ||
        (Object.hasOwn(body,'attempt') && (!Number.isSafeInteger(body.attempt) || body.attempt < 1 || body.attempt > 20)) ||
        (uploadFinish && (typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256) ||
          !Number.isSafeInteger(body.bytes) || body.bytes < 1 || body.bytes > QWEN_IMAGE_EDIT_MAX_REQUEST_BYTES)))
      throw bad('invalid Qwen plan verification request');
    const task = await store.getTask(taskId), bound = task?.input_manifest?.qwen_foart_plan;
    const contract=qwenScopedContract(task);
    const attempt = Number(task?.attempt_count);
    if (!task || !contract || !qwenScopeEnabled(contract.scope) || !qwenPlanUnexpired(task) || task.task_type !== PROMPT_ASSISTANT_TASK_TYPE || task.model_id !== contract.capability ||
        task.input_manifest?.parameters?.assistant_tool_scope !== contract.scope || !bound || bound.scope !== contract.scope ||
        String(task.assigned_worker_id || '') !== String(worker.id) || bound.worker_id !== String(worker.id) ||
        bound.user_id !== String(task.user_id || '') || String(worker.owner_id || '') !== String(task.user_id || '') ||
        !UUID_RE.test(String(bound.session_id || '')) || !Number.isSafeInteger(bound.session_expires_epoch) ||
        bound.session_expires_epoch <= nowSeconds() || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > 20 ||
        (body.attempt !== undefined && body.attempt !== attempt) ||
        (uploadFinish && (body.sha256 !== bound.request_sha256 || body.bytes !== bound.request_bytes)))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen plan authorization denied');
    if(contract.scope===QWEN_IMAGE_EDIT_SCOPE){
      const workerActor=await requireH3WorkerActor(headers,worker);
      if(!UUID_V4_RE.test(String(bound.ownership_generation||'')) || workerActor.generation!==bound.ownership_generation)
        throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen image edit authorization denied');
    }
    const states = body.op === 'upload' || body.op === 'wait' ? [TASK_STATE.ASSIGNED,TASK_STATE.UPLOADING] :
      body.op === 'download' ? [TASK_STATE.COMPLETED] : [TASK_STATE.PROCESSING];
    if (!states.includes(task.status) || (body.op === 'download' && task.result_expired))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen plan authorization denied');
    const [user, session] = await Promise.all([store.getUserById(String(task.user_id)),store.getUserSession(bound.session_id)]);
    const userExpiry = Date.parse(String(user?.expires_at || ''));
    if (!user || String(user.status || 'active').toLowerCase() !== 'active' ||
        (Number.isFinite(userExpiry) && userExpiry <= Date.now()) || !workerAllowsUser(worker,user) ||
        !session || String(session.user_id) !== String(task.user_id) || session.revoked_at ||
        bound.session_expires_epoch <= nowSeconds())
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen plan authorization denied');
    // These reads are not a database transaction; consumers still reject stale
    // attempts and revalidate the native project baseline before confirmation.
    const latest = await store.getTask(taskId);
    if (!latest || !qwenPlanUnexpired(latest) || bound.session_expires_epoch <= nowSeconds() ||
        latest.status !== task.status || Number(latest.attempt_count) !== attempt ||
        String(latest.assigned_worker_id || '') !== String(worker.id) ||
        latest.input_manifest?.qwen_foart_plan?.session_id !== bound.session_id)
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen plan authorization denied');
    if(contract.scope===QWEN_IMAGE_EDIT_SCOPE)
      await requireQwenImageEditLease(latest,bound,attempt,body.op,uploadFinish?body.sha256:null,uploadFinish?body.bytes:null);
    return {ok:true,authorized:true,taskId,workerId:String(worker.id),userId:String(task.user_id),
      sessionId:bound.session_id,scope:contract.scope,attempt,op:body.op,
      ...(uploadFinish ? {digestBound:true,sha256:body.sha256,bytes:body.bytes} : {})};
  }

  // Reserved-scope verifier only. Enabling this endpoint does not enable
  // candidate creation, scheduling, model execution, or grant issuance.
  // The proof is signed by the control plane, never by the worker; the SQL
  // function must compare every signed identity to live authoritative rows in
  // one transaction and return false on contention or revocation.
  async function handleQwenRotationVerify(taskId, body, headers) {
    if (qwenRotationVerifyEnabled !== true || typeof store.authorizeQwenRotationLease !== 'function')
      throw new HttpError(503, 'qwen_rotation_lease_unavailable', 'candidate verification unavailable');
    const worker = await requireWorker(headers);
    const uploadFinish = body?.op === 'upload' && body?.phase === 'finish';
    const keys = uploadFinish ? ['proof','op','phase','sha256','bytes'] : ['proof','op','phase'];
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== keys.length || !Object.keys(body).every(k => keys.includes(k)) ||
        typeof body.proof !== 'string' || !['upload','download'].includes(body.op) ||
        (body.phase !== 'start' && !uploadFinish) ||
        (uploadFinish && (typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256) ||
          !Number.isSafeInteger(body.bytes) || body.bytes < 1 || body.bytes > 262144)))
      throw bad('invalid candidate verification request');
    let proof;
    try { proof = await verifyQwenRotationProofSignature(body.proof, controlSecret); }
    catch { throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate verification denied'); }
    if (proof.task !== taskId || proof.wid !== String(worker.id) || proof.op !== body.op)
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate verification denied');
    let allowed = false;
    try {
      allowed = await store.authorizeQwenRotationLease({taskId:proof.task,workerId:proof.wid,
        userId:proof.sub,sessionId:proof.sid,attempt:proof.attempt,op:proof.op,proofExpiresAtMs:proof.exp * 1000,
        uploadSha256:uploadFinish ? body.sha256 : null,uploadBytes:uploadFinish ? body.bytes : null});
    } catch { throw new HttpError(503, 'qwen_rotation_lease_unavailable', 'candidate verification unavailable'); }
    if (allowed !== true) throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate verification denied');
    return {ok:true,authorized:true,taskId:proof.task,workerId:proof.wid,userId:proof.sub,
      sessionId:proof.sid,attempt:proof.attempt,scope:proof.scope,op:proof.op,
      ...(uploadFinish ? {digestBound:true,sha256:body.sha256,bytes:body.bytes} : {})};
  }

  async function handleQwenRotationProof(taskId, body, headers) {
    if (qwenRotationVerifyEnabled !== true || typeof store.authorizeQwenRotationLease !== 'function')
      throw new HttpError(503, 'qwen_rotation_lease_unavailable', 'candidate authorization unavailable');
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !['upload','download'].includes(body.op))
      throw bad('invalid candidate authorization request');
    const actor = await requireArtActor(headers);
    let session;
    try { session = await verifySessionToken(bearerToken(headers.authorization || headers.Authorization), sessionSecret); }
    catch { throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'invalid session'); }
    const task = await store.getTask(taskId);
    if (!task || String(task.user_id) !== String(actor.user.id) || !isQwenRotationCandidateTask(task))
      throw new HttpError(404, ERROR_CODE.NOT_FOUND, 'unknown task');
    const workerId = String(task.assigned_worker_id || '');
    const attempt = Number(task.attempt_count);
    let proof, signed;
    try {
      proof = await issueQwenRotationProof({taskId,workerId,userId:String(actor.user.id),sessionId:actor.sessionId,
        attempt,op:body.op,sessionExpiresAt:session.exp},controlSecret);
      signed = await verifyQwenRotationProofSignature(proof,controlSecret);
    } catch { throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate authorization denied'); }
    let allowed = false;
    try {
      allowed = await store.authorizeQwenRotationLease({taskId,workerId,userId:signed.sub,sessionId:signed.sid,
        attempt:signed.attempt,op:signed.op,proofExpiresAtMs:signed.exp * 1000,uploadSha256:null,uploadBytes:null});
    } catch { throw new HttpError(503, 'qwen_rotation_lease_unavailable', 'candidate authorization unavailable'); }
    if (allowed !== true) throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate authorization denied');
    const worker = await store.getWorkerById(workerId);
    if (!worker || String(worker.owner_id || '') !== String(actor.user.id) || signed.exp <= nowSeconds())
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate authorization denied');
    let endpoint;
    try {
      endpoint = new URL(String(worker.endpoint_url || ''));
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
          !(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' &&
            ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))) throw new Error('unsafe endpoint');
    } catch { throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate endpoint unavailable'); }
    const grantKey = await deriveWorkerGrantKey(workerId,controlSecret);
    const grantTtlSeconds = signed.exp-nowSeconds();
    if (grantTtlSeconds < 1) throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate authorization denied');
    const token = await issueGrantToken({userId:signed.sub,taskId,workerId,op:signed.op,
      ttlSeconds:grantTtlSeconds},grantKey);
    return {ok:true,proof,grant:{token,op:signed.op,taskId,workerId,endpoint:endpoint.href.replace(/\/$/,''),
      transport:String(worker.transport || 'direct'),expiresAt:new Date(signed.exp*1000).toISOString()}};
  }

  // The authenticated worker may request a fresh check for an already-bound
  // task; actor identity is always read from the server-owned task manifest,
  // never from the node. The endpoint does not itself start or complete work.
  async function handleQwenRotationPhase(taskId, body, headers) {
    if (qwenRotationVerifyEnabled !== true || typeof store.authorizeQwenRotationLease !== 'function')
      throw new HttpError(503, 'qwen_rotation_lease_unavailable', 'candidate verification unavailable');
    const worker = await requireWorker(headers);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 2 || !Object.keys(body).every(k => ['attempt','op'].includes(k)) ||
        !Number.isSafeInteger(body.attempt) || body.attempt < 1 || !['wait','infer','complete'].includes(body.op))
      throw bad('invalid candidate phase request');
    const task = await store.getTask(taskId);
    const lease = task?.input_manifest?.candidate_lease;
    const expires = Number(lease?.session_expires_epoch);
    if (!task || !isQwenRotationCandidateTask(task) || String(task.assigned_worker_id || '') !== String(worker.id) ||
        Number(task.attempt_count) !== body.attempt || !lease || typeof lease !== 'object' || Array.isArray(lease) ||
        String(lease.actor_user_id || '') !== String(task.user_id || '') || !UUID_RE.test(String(lease.session_id || '')) ||
        !Number.isSafeInteger(expires) || expires <= nowSeconds())
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate verification denied');
    const checkUntilMs = Math.min(Date.now() + 8000, expires * 1000);
    let allowed = false;
    try {
      allowed = await store.authorizeQwenRotationLease({taskId,workerId:String(worker.id),userId:String(task.user_id),
        sessionId:String(lease.session_id),attempt:body.attempt,op:body.op === 'wait' ? 'upload' : body.op,
        proofExpiresAtMs:checkUntilMs,uploadSha256:null,uploadBytes:null});
    } catch { throw new HttpError(503, 'qwen_rotation_lease_unavailable', 'candidate verification unavailable'); }
    if (allowed !== true) throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'candidate verification denied');
    return {ok:true,authorized:true,taskId,workerId:String(worker.id),attempt:body.attempt,op:body.op};
  }

  async function handleQwenRotationMutation(taskId, body, headers, action) {
    const method = action === 'start' ? 'startQwenRotationCandidate' : action === 'complete' ? 'completeQwenRotationCandidate' : 'failQwenRotationCandidate';
    if (qwenRotationVerifyEnabled !== true || typeof store[method] !== 'function')
      throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate operation unavailable');
    const worker = await requireWorker(headers);
    const keys = action === 'start' ? ['attempt','sha256','bytes'] : action === 'complete' ? ['attempt','bytes'] : ['attempt'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length ||
        !Object.keys(body).every(k=>keys.includes(k)) || !Number.isSafeInteger(body.attempt) || body.attempt < 1 ||
        (action !== 'fail' && (!Number.isSafeInteger(body.bytes) || body.bytes < 1 || body.bytes > (action === 'start' ? 262144 : 65536))) ||
        (action === 'start' && (typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256))))
      throw bad('invalid candidate operation request');
    const task = await store.getTask(taskId), lease = task?.input_manifest?.candidate_lease;
    const expires = Number(lease?.session_expires_epoch);
    if (!task || !isQwenRotationCandidateTask(task) || String(task.assigned_worker_id || '') !== String(worker.id) ||
        Number(task.attempt_count) !== body.attempt || !lease || typeof lease !== 'object' || Array.isArray(lease) ||
        String(lease.actor_user_id || '') !== String(task.user_id || '') || !UUID_RE.test(String(lease.session_id || '')) ||
        !Number.isSafeInteger(expires) || expires <= nowSeconds())
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'candidate operation denied');
    let allowed = false;
    try {
      allowed = await store[method]({taskId,workerId:String(worker.id),userId:String(task.user_id),
        sessionId:String(lease.session_id),attempt:body.attempt,proofExpiresAtMs:Math.min(Date.now()+8000,expires*1000),
        ...(action === 'start' ? {sha256:body.sha256,bytes:body.bytes} : action === 'complete' ? {bytes:body.bytes} : {})});
    } catch { throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate operation unavailable'); }
    if (allowed !== true) throw new HttpError(403,ERROR_CODE.FORBIDDEN,'candidate operation denied');
    return {ok:true,taskId,workerId:String(worker.id),attempt:body.attempt,action};
  }

  async function handleQwenRotationCreate(body, headers) {
    if (qwenRotationVerifyEnabled !== true || qwenRotationCreateEnabled !== true || typeof store.createQwenRotationCandidate !== 'function')
      throw new HttpError(503, 'qwen_rotation_lease_unavailable', 'candidate creation unavailable');
    const keys=['requestId','workerId','sha256','bytes'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length ||
        !Object.keys(body).every(k=>keys.includes(k)) ||
        typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.requestId) ||
        typeof body.workerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.workerId) ||
        typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256) ||
        !Number.isSafeInteger(body.bytes) || body.bytes < 1 || body.bytes > 262144)
      throw bad('invalid candidate creation request');
    const actor = await requireArtActor(headers);
    let session;
    try { session = await verifySessionToken(bearerToken(headers.authorization || headers.Authorization),sessionSecret); }
    catch { throw new HttpError(401,ERROR_CODE.UNAUTHORIZED,'invalid session'); }
    let result;
    try {
      result = await store.createQwenRotationCandidate({userId:String(actor.user.id),sessionId:actor.sessionId,
        sessionExpiresAt:session.exp,workerId:body.workerId,requestId:body.requestId,sha256:body.sha256,bytes:body.bytes});
    } catch { throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate creation unavailable'); }
    if (!result || !/^fa047a0a-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(result.task_id || '')))
      throw new HttpError(409,ERROR_CODE.CONFLICT,'candidate creation rejected');
    const task = await store.getTask(result.task_id);
    if (!task || String(task.user_id) !== String(actor.user.id) || !isQwenRotationCandidateTask(task))
      throw new HttpError(409,ERROR_CODE.CONFLICT,'candidate creation rejected');
    return {ok:true,task:publicTask(task),replayed:result.replayed === true};
  }

  async function handleQwenRotationCancel(taskId, body, headers) {
    if (qwenRotationVerifyEnabled !== true || typeof store.cancelQwenRotationCandidate !== 'function')
      throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate cancellation unavailable');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !Number.isSafeInteger(body.attempt) || body.attempt < 0) throw bad('invalid candidate cancellation request');
    const actor=await requireArtActor(headers);
    let session;
    try { session=await verifySessionToken(bearerToken(headers.authorization || headers.Authorization),sessionSecret); }
    catch { throw new HttpError(401,ERROR_CODE.UNAUTHORIZED,'invalid session'); }
    const task=await store.getTask(taskId);
    if (!task || String(task.user_id)!==String(actor.user.id) || !isQwenRotationCandidateTask(task))
      throw new HttpError(404,ERROR_CODE.NOT_FOUND,'unknown task');
    let cancelled=false;
    try { cancelled=await store.cancelQwenRotationCandidate({taskId,userId:String(actor.user.id),sessionId:actor.sessionId,
      sessionExpiresAt:session.exp,expectedAttempt:body.attempt}); }
    catch { throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate cancellation unavailable'); }
    if(cancelled!==true)throw new HttpError(409,ERROR_CODE.CONFLICT,'candidate cancellation rejected');
    return {ok:true,cancelled:true};
  }

  async function handleQwenRotationClaim(body, headers) {
    if (qwenRotationVerifyEnabled !== true || typeof store.listQwenRotationCandidates !== 'function' ||
        typeof store.claimQwenRotationCandidate !== 'function')
      throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate claim unavailable');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0)
      throw bad('invalid candidate claim request');
    const worker = await requireWorker(headers);
    if (!worker.owner_id) return {ok:true,task:null};
    let rows;
    try { rows = await store.listQwenRotationCandidates({workerId:String(worker.id),ownerId:String(worker.owner_id),limit:4}); }
    catch { throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate claim unavailable'); }
    if (!Array.isArray(rows)) throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate claim unavailable');
    for (const row of rows.slice(0,4)) {
      let task;
      try { task = await store.getTask(row.id); }
      catch { throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate claim unavailable'); }
      const lease = task?.input_manifest?.candidate_lease;
      const expires = Number(lease?.session_expires_epoch), attempt = Number(task?.attempt_count);
      if (!task || !/^fa047a0a-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(task.id || '')) ||
          !isQwenRotationCandidateTask(task) || String(task.user_id || '') !== String(worker.owner_id) ||
          String(task.input_manifest?.target_worker_id || '') !== String(worker.id) ||
          String(lease?.actor_user_id || '') !== String(task.user_id) || String(lease?.owner_worker_id || '') !== String(worker.id) ||
          !UUID_RE.test(String(lease?.session_id || '')) || !Number.isSafeInteger(expires) || expires <= nowSeconds() ||
          !Number.isSafeInteger(attempt) || attempt < 0) continue;
      let assigned;
      try {
        assigned = await store.claimQwenRotationCandidate({taskId:String(task.id),workerId:String(worker.id),
          userId:String(task.user_id),sessionId:String(lease.session_id),sessionExpiresAt:expires,
          expectedAttempt:attempt,heartbeatTimeoutSeconds:HEARTBEAT_TIMEOUT_SECONDS});
      } catch { throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate claim unavailable'); }
      if (!assigned) continue;
      if (String(assigned.id) !== String(task.id) || String(assigned.assigned_worker_id || '') !== String(worker.id) ||
          assigned.status !== TASK_STATE.ASSIGNED || Number(assigned.attempt_count) !== attempt + 1 ||
          String(assigned.user_id || '') !== String(worker.owner_id) || !isQwenRotationCandidateTask(assigned))
        throw new HttpError(503,'qwen_rotation_lease_unavailable','candidate claim unavailable');
      return {ok:true,task:workerTaskView(assigned),grantKey:await deriveWorkerGrantKey(worker.id,controlSecret)};
    }
    return {ok:true,task:null};
  }

  // -------------------------------------------------------------------------
  // Worker endpoints
  // -------------------------------------------------------------------------

  // Registration accepts EITHER an owner session token (the owner registering
  // their own machine) OR a one-time registration code (a friend running the
  // installer). Either way the worker never learns a Supabase key.
  async function handleWorkerRegister(body, headers, clientAddress) {
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
    let previousSecretHash = null;
    if (existing) {
      const proof = sanitizeText(body.previous_secret || body.previousSecret, 400) || secret;
      const proofHash = await hashWorkerSecret(workerId, proof);
      previousSecretHash = proofHash;
      if (proofHash !== existing.worker_secret_hash) {
        throw new HttpError(409, ERROR_CODE.CONFLICT,
          'this worker id is already registered; supply previous_secret to rotate its credential');
      }
    }

    let ownerId = null;
    // The code that admits a machine also says which tier it joins as (普通 /
    // 高级节点). An owner registering their own machine gets 普通; the
    // administrator can change either later.
    let tier = '';
    const code = sanitizeText(body.registration_code || body.registrationCode, 200).trim();
    const pendingEnrollment = !existing && body.profile === 'compute-only' && !code
      && !bearerToken(headers.authorization || headers.Authorization);
    if (existing) {
      // An existing worker keeps its owner, including an unapproved null owner.
      ownerId = existing.owner_id ? String(existing.owner_id) : null;
    } else if (code) {
      const codeHash = await sha256Hex('novaflow-web-registration-code:v1:' + code);
      const owner = await store.consumeRegistrationCode(codeHash);
      if (!owner) throw new HttpError(401, ERROR_CODE.UNAUTHORIZED, 'registration code is invalid or used up');
      ownerId = String(owner.owner_id);
      tier = normalizeNodeTier(owner.tier);
    } else if (!pendingEnrollment) {
      const user = await requireUser(headers);
      ownerId = String(user.id);
    }

    const hardware = body.hardware && typeof body.hardware === 'object' ? body.hardware : {};
    const secretHash = await hashWorkerSecret(workerId, secret);
    const registered = await (pendingEnrollment ? store.enrollPendingWorker : store.registerWorker)({
      workerId,
      ownerId,
      workerName,
      secretHash,
      peerHash: pendingEnrollment ? await sha256Hex('novaflow-compute-peer:v1:' + String(clientAddress || 'unavailable')) : null,
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
        enrollment_peer_hash: await sha256Hex('novaflow-compute-peer:v1:' + String(clientAddress || 'unavailable')),
        previous_secret_hash: previousSecretHash
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

  async function canReportWorkerStop(worker) {
    if(workerExplicitStopEnabled!==true || typeof workerStopReadiness!=='function' || typeof store.stopWorkerTask!=='function')return false;
    const controller=new AbortController();let timer;
    try {
      const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(false)},3000)});
      return await Promise.race([workerStopReadiness({workerId:String(worker.id),signal:controller.signal}),timeout])===true;
    } catch {return false;} finally {clearTimeout(timer);}
  }

  async function handleHeartbeat(body, headers) {
    const worker = await requireWorker(headers);
    const updated = await store.heartbeat({
      workerId: worker.id,
      status: sanitizeText(body.status, 20) || 'idle',
      currentTaskId: body.current_task_id || body.currentTaskId || null,
      hardware: body.hardware && typeof body.hardware === 'object' ? body.hardware : {}
    });
    const publicNode=publicWorker(updated);
    const reportReady=Boolean(publicNode) && await canReportWorkerStop(worker);
    return { ok: true, worker: publicNode, ...(reportReady ? {policy:{...publicNode.policy,compute_close_report_v1:true}} : {}), serverTime: new Date().toISOString() };
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
    // Preserve existing task priority; the ordinary DB claim excludes H3 scope.
    let task=await store.claimTask(worker.id,HEARTBEAT_TIMEOUT_SECONDS),h3ClaimVerified=false;
    if (!task && h3CreateOnceEnabled===true && typeof store.claimH3Task==='function') {
      let actor=null;
      try { actor=await requireH3WorkerActor(headers,worker); } catch(error) {
        if (!(error instanceof HttpError) || error.status!==403) throw error;
      }
      if (actor) {
        task=await store.claimH3Task({workerId:worker.id,ownerId:actor.ownerId,
          ownershipGeneration:actor.generation,heartbeatTimeoutSeconds:HEARTBEAT_TIMEOUT_SECONDS});
        h3ClaimVerified=!!task;
      }
    }
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
            // The list is deliberately a minimal projection. Re-read the
            // immutable task scope before recovering it: a scoped H3 task may
            // already have reached Comfy even when the restarted worker is idle.
            const fullTask=await store.getTask(oldTask.id);
            if (!fullTask || fullTask.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1') continue;
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
    if (task.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1' && !h3ClaimVerified)
      throw new HttpError(503,'h3_claim_unavailable','Video task claim unavailable');
    if (isQwenRotationCandidateTask(task)) {
      try { await store.updateTaskStatus({taskId:task.id,workerId:worker.id,toStatus:TASK_STATE.FAILED,
        progress:null,note:'Qwen rotation candidate owner lease unavailable',detail:{actor:'scheduler',error_code:'qwen_rotation_lease_unavailable'}}); }
      catch { /* Do not disclose task contents or grant key if cleanup fails. */ }
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen rotation candidate owner lease unavailable');
    }
    if (isQwenUiDraftTask(task)) {
      try { await store.updateTaskStatus({taskId:task.id,workerId:worker.id,toStatus:TASK_STATE.FAILED,
        progress:null,note:'Qwen UI owner lease unavailable',detail:{actor:'scheduler',error_code:'qwen_ui_lease_unavailable'}}); }
      catch { /* Refuse to return task contents even if recovery is pending. */ }
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen UI owner lease unavailable');
    }
    if (isQwenPlanTask(task)) {
      try { await handleQwenPlanVerify(task.id,{op:'wait',phase:'start',attempt:Number(task.attempt_count)},headers); }
      catch (error) {
        try { await store.updateTaskStatus({taskId:task.id,workerId:worker.id,toStatus:TASK_STATE.FAILED,
          progress:null,note:'Qwen plan authorization unavailable',detail:{actor:'scheduler',error_code:'qwen_plan_unavailable'}}); }
        catch { /* Fail closed if cleanup races another transition. */ }
        throw error;
      }
    }
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
    if (isQwenRotationCandidateTask({id:taskId}))
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'candidate requires its bound phase');
    const to = sanitizeText(body.status, 20) || TASK_STATE.PROCESSING;
    if (![TASK_STATE.UPLOADING, TASK_STATE.PROCESSING].includes(to)) {
      throw bad('progress may only report uploading or processing');
    }
    const current = await store.getTask(taskId);
    let h3Actor=null;
    if (current?.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1' &&
        (!Number.isSafeInteger(body.attempt) || body.attempt!==Number(current.attempt_count) || String(current.assigned_worker_id)!==String(worker.id)))
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video attempt denied');
    if (current?.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1') {
      h3Actor=await requireH3WorkerActor(headers,worker);
      if (current.input_manifest?.h3_assigned_worker_owner_id!==h3Actor.ownerId ||
          current.input_manifest?.h3_assigned_worker_owner_generation!==h3Actor.generation)
        throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video attempt denied');
    }
    if (isQwenPlanTask(current)) {
      if (!Number.isSafeInteger(body.attempt) || body.attempt !== Number(current.attempt_count))
        throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Qwen plan attempt denied');
      const op = [TASK_STATE.ASSIGNED,TASK_STATE.UPLOADING].includes(current.status) ? 'wait' : 'infer';
      await handleQwenPlanVerify(taskId,{op,phase:'start',attempt:body.attempt},headers);
    }
    const progressInput = {
      taskId,
      workerId: worker.id,
      toStatus: to,
      progress: Number.isFinite(Number(body.progress)) ? Math.min(100, Math.max(0, Number(body.progress))) : null,
      note: sanitizeText(body.note, 200),
      detail: {
        actor: 'worker',
        prompt_id: sanitizeText(body.prompt_id || body.promptId, 160)
      }
    };
    let task;
    if (current?.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1') {
      if (typeof store.updateH3TaskStatus!=='function') throw new HttpError(503,'h3_status_unavailable','Video status unavailable');
      task=await store.updateH3TaskStatus({...progressInput,attempt:body.attempt,expectedStatus:current.status,
        ownerId:h3Actor.ownerId,ownershipGeneration:h3Actor.generation});
    } else task=await store.updateTaskStatus(progressInput);
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
    if (current.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1' &&
        (!Number.isSafeInteger(body.attempt) || body.attempt!==Number(current.attempt_count)))
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video attempt denied');
    const isH3 = current.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1';
    const h3Actor=isH3 ? await requireH3WorkerActor(headers,worker) : null;
    if (isH3 && (current.input_manifest?.h3_assigned_worker_owner_id!==h3Actor.ownerId ||
        current.input_manifest?.h3_assigned_worker_owner_generation!==h3Actor.generation))
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video attempt denied');
    if (isQwenRotationCandidateTask(current))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen rotation candidate owner lease unavailable');

    if (isQwenPlanTask(current)) {
      const attempt = Number(current.attempt_count);
      const contract=qwenScopedContract(current);
      if (!Number.isSafeInteger(body.attempt) || body.attempt !== attempt || attempt < 1 || attempt > 20 ||
          !Array.isArray(body.outputs) || body.outputs.length !== 1 ||
          !contract || body.outputs[0]?.name !== contract.resultFile(attempt) || body.outputs[0]?.kind !== 'json' ||
          !Number.isSafeInteger(body.outputs[0]?.bytes) || body.outputs[0].bytes < 1 || body.outputs[0].bytes > 65536)
        throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Qwen plan result denied');
      await handleQwenPlanVerify(taskId,{op:current.status === TASK_STATE.COMPLETED ? 'download' : 'complete',
        phase:'start',attempt},headers);
    }

    const promptId = sanitizeText(body.prompt_id || body.promptId, 160);
    if (!promptId) throw bad('prompt_id is required so settlement stays idempotent');

    // A worker retrying after a dropped response must get a clean answer, not
    // an error about a task it already finished. Settlement is keyed on the
    // prompt id, so replaying charges nothing extra either way.
    if (current.status === TASK_STATE.COMPLETED && !isH3) {
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

    if (isH3) {
      if(!Array.isArray(body.outputs) || body.outputs.length<1 || body.outputs.length>8)
        throw bad('invalid H3 result files');
      outputManifest.files=body.outputs.map((file,index)=>{
        const expected=new RegExp('^h3-'+taskId+'-result-'+(index+1)+'\\.(mp4|webm)$');
        if(!file || typeof file!=='object' || Array.isArray(file) || typeof file.name!=='string' || !expected.test(file.name) ||
           file.kind!=='video' || !Number.isSafeInteger(file.bytes) || file.bytes<1 || file.bytes>8*1024*1024*1024 ||
           typeof file.sha256!=='string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw bad('invalid H3 result file');
        return {name:file.name,kind:'video',bytes:file.bytes,sha256:file.sha256,
          width:clampInt(file.width,0,16384,0),height:clampInt(file.height,0,16384,0),
          duration_seconds:Number.isFinite(Number(file.duration_seconds)) ? Number(file.duration_seconds) : 0};
      });
      if (h3AtomicCompletionEnabled!==true || typeof store.completeH3AndSettle!=='function' || ![TASK_STATE.PROCESSING,TASK_STATE.COMPLETED].includes(current.status))
        throw new HttpError(503,'h3_settlement_unknown','Video completion requires reconciliation');
      const parameters=current.input_manifest?.parameters;
      if (!parameters || typeof parameters!=='object' || Array.isArray(parameters) ||
          current.model_id!=='minimax-h3' || current.input_manifest?.workflow?.module!=='NovaFlowAiSequenceMiniMaxH3Workflow' ||
          current.input_manifest?.workflow?.method!=='buildWorkflow')
        throw new HttpError(503,'h3_pricing_unknown','Video pricing unavailable');
      const estimate=current.estimated_credit_cost;
      if ((typeof estimate!=='number' && typeof estimate!=='string') || String(estimate).trim()!==String(estimate) ||
          !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(String(estimate)))
        throw new HttpError(503,'h3_pricing_unknown','Video pricing unavailable');
      // Retain the exact existing completion calculation, not a browser or
      // worker amount. Unknown zero pricing is never treated as free.
      const pricing=priceTask(current.task_type,parameters);
      if (typeof pricing?.creditCost!=='number' || !Number.isFinite(pricing.creditCost) || pricing.creditCost<0 ||
          pricing.creditCost>Number.MAX_SAFE_INTEGER/1000000 ||
          Math.abs(pricing.creditCost*1000000-Math.round(pricing.creditCost*1000000))>1e-7 ||
          typeof pricing.source!=='string' || !pricing.source)
        throw new HttpError(503,'h3_pricing_unknown','Video pricing unavailable');
      if (pricing.creditCost===0 && (requirementsFor('h3_i2v')?.billing!=='self_hosted' ||
          pricing.source!=='novaflow_web_self_hosted_v1' || pricing.breakdown?.billing!=='self_hosted'))
        throw new HttpError(503,'h3_pricing_unknown','Video pricing unavailable');
      if (pricing.creditCost>0 && (pricing.source!=='novaflow_web_rate_card_v1' || pricing.breakdown?.unknownTaskType))
        throw new HttpError(503,'h3_pricing_unknown','Video pricing unavailable');
      const result=await store.completeH3AndSettle({taskId,workerId:worker.id,ownerId:h3Actor.ownerId,
        ownershipGeneration:h3Actor.generation,attempt:body.attempt,inputManifest:current.input_manifest,
        promptId,outputManifest,chargeAmount:pricing.creditCost,pricingSource:pricing.source,
        pricingDetails:{runtime:'comfyui',web:true,breakdown:pricing.breakdown}});
      if (!result?.task || typeof result.idempotent!=='boolean' || !result.settlement)
        throw new HttpError(503,'h3_settlement_unknown','Video completion requires reconciliation');
      return {ok:true,task:publicTask(result.task),pricing,settlement:result.settlement,idempotent:result.idempotent};
    }

    // A task can finish before any progress ping lands (a 4-step image is
    // quick). The state machine still requires work to be marked started, so
    // walk it through processing here rather than making every worker
    // remember to.
    if ([TASK_STATE.ASSIGNED, TASK_STATE.UPLOADING].includes(current.status)) {
      const startInput = {
        taskId,
        workerId: worker.id,
        toStatus: TASK_STATE.PROCESSING,
        progress: null,
        note: 'started',
        detail: { actor: 'worker', prompt_id: promptId }
      };
      await store.updateTaskStatus(startInput);
    }

    // Recompute the price from the stored input manifest. The worker has no
    // say in it, and a replayed completion settles the same usage key.
    const parameters = current.input_manifest?.parameters || {};
    const pricing = priceTask(current.task_type, parameters);

    const completeInput = {
      taskId,
      workerId: worker.id,
      toStatus: TASK_STATE.COMPLETED,
      progress: 100,
      note: 'done',
      detail: { actor: 'worker', prompt_id: promptId, output_manifest: outputManifest }
    };
    const task = await store.updateTaskStatus(completeInput);

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

  async function handleWorkerExplicitStop(taskId,body,headers) {
    if(workerExplicitStopEnabled!==true || typeof store.stopWorkerTask!=='function')
      throw new HttpError(503,'worker_stop_unavailable','Worker stop acknowledgement unavailable');
    const worker=await requireWorker(headers);
    if(!await canReportWorkerStop(worker))
      throw new HttpError(503,'worker_stop_unavailable','Worker stop acknowledgement unavailable');
    if(!UUID_RE.test(String(taskId)) || !body || typeof body!=='object' || Array.isArray(body) ||
      Object.keys(body).join(',')!=='attempt' || !Number.isSafeInteger(body.attempt) || body.attempt<1)
      throw bad('invalid worker stop request');
    // The store RPC checks worker, exact attempt, scope and terminal status in
    // one transaction. Never infer a stop from a missing heartbeat here.
    const result=await store.stopWorkerTask({taskId,workerId:worker.id,attempt:body.attempt});
    if(!result?.task || typeof result.idempotent!=='boolean')
      throw new HttpError(503,'worker_stop_unknown','Worker stop outcome unavailable');
    return {ok:true,task:publicTask(result.task),idempotent:result.idempotent};
  }

  async function handleWorkerFail(taskId, body, headers) {
    const worker = await requireWorker(headers);
    if (isQwenRotationCandidateTask({id:taskId}))
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'candidate requires its bound termination');
    const current = await store.getTask(taskId);
    let h3Actor=null;
    if (current?.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1' &&
        (!Number.isSafeInteger(body.attempt) || body.attempt!==Number(current.attempt_count) || String(current.assigned_worker_id)!==String(worker.id)))
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video attempt denied');
    if (current?.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1') {
      h3Actor=await requireH3WorkerActor(headers,worker);
      if (current.input_manifest?.h3_assigned_worker_owner_id!==h3Actor.ownerId ||
          current.input_manifest?.h3_assigned_worker_owner_generation!==h3Actor.generation)
        throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video attempt denied');
    }
    if (isQwenPlanTask(current) && (!Number.isSafeInteger(body.attempt) || body.attempt !== Number(current.attempt_count)))
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Qwen plan attempt denied');
    // No settlement on this path at all - a failed task cannot be charged
    // because there is no code here that charges (spec 16, 17).
    const failInput = {
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
    };
    let task;
    if (current?.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1') {
      if (typeof store.updateH3TaskStatus!=='function') throw new HttpError(503,'h3_status_unavailable','Video status unavailable');
      task=await store.updateH3TaskStatus({...failInput,attempt:body.attempt,expectedStatus:current.status,
        ownerId:h3Actor.ownerId,ownershipGeneration:h3Actor.generation});
    } else task=await store.updateTaskStatus(failInput);
    return { ok: true, task: publicTask(task), charged: false };
  }

  // -------------------------------------------------------------------------
  // User endpoints
  // -------------------------------------------------------------------------

  async function handleCreateTask(body, headers) {
    const user = await requireUser(headers);
    const taskType = sanitizeText(body.task_type || body.taskType, 80);
    const assistantTaskId = body.assistant_task_id;
    const videoRequestId = body.video_request_id;
    let h3Refs = null, h3Parameters = null;
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
      ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
    const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
    const h3Conflict=()=>{throw new HttpError(409,'h3_request_conflict','Video request conflict');};
    function existingH3Result(existing) {
      if (String(existing.id)!==videoRequestId || String(existing.user_id)!==String(user.id) ||
          existing.task_type!=='renderer_workflow' || existing.model_id!=='minimax-h3' ||
          existing.input_manifest?.h3_idempotency_scope!=='h3-idempotent-v1' ||
          !same(existing.input_manifest?.parameters,h3Parameters) || !same(existing.input_manifest?.references,h3Refs) ||
          !same(existing.input_manifest?.workflow,{module:'NovaFlowAiSequenceMiniMaxH3Workflow',method:'buildWorkflow'}) ||
          String(existing.input_manifest?.target_worker_id||'')!==String(sanitizeText(body.target_worker_id || body.targetWorkerId,80)||'')) h3Conflict();
      const raw=existing.estimated_credit_cost;
      if ((typeof raw!=='number' && typeof raw!=='string') || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(String(raw)))
        throw new HttpError(503,'h3_status_unknown','Video request status is unknown');
      const price=Number(raw);
      if (!Number.isFinite(price) || price<0) throw new HttpError(503,'h3_status_unknown','Video request status is unknown');
      return {ok:true,task:publicTask(existing),idempotent:true,pricing:{creditCost:price,source:'existing_task_snapshot'},
        target:existing.input_manifest?.target_worker_id?{id:existing.input_manifest.target_worker_id,name:existing.input_manifest.target_worker_name||null}:null};
    }
    if (videoRequestId !== undefined) {
      if (h3CreateOnceEnabled!==true || typeof store.createH3TaskOnce!=='function' || typeof store.countH3CapableWorkers!=='function')
        throw new HttpError(503,'h3_create_once_unavailable','Video recovery unavailable');
      if (assistantTaskId!==undefined || typeof videoRequestId!=='string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(videoRequestId) ||
          taskType!=='renderer_workflow' || body.workflow?.module!=='NovaFlowAiSequenceMiniMaxH3Workflow' ||
          body.workflow?.method!=='buildWorkflow' || !Array.isArray(body.references) || body.references.length!==2)
        throw bad('invalid video recovery request');
      h3Refs=body.references.map((ref,index)=>{
        const expected=new RegExp('^h3-'+videoRequestId+'-'+(index===0?'first':'last')+'\\.(?:png|jpg|jpeg|webp)$');
        if (!ref || typeof ref!=='object' || Array.isArray(ref) || Object.keys(ref).sort().join(',')!=='bytes,kind,name,sha256' ||
            typeof ref.name!=='string' || !expected.test(ref.name) || ref.name.length>128 || ref.kind!=='image' ||
            !Number.isSafeInteger(ref.bytes) || ref.bytes<1 || ref.bytes>64*1024*1024 || !/^[a-f0-9]{64}$/.test(ref.sha256))
          throw bad('invalid video reference');
        return {name:ref.name,bytes:ref.bytes,kind:ref.kind,sha256:ref.sha256};
      });
      h3Parameters=sanitizeWorkflowOptions(body.parameters);
      if (h3Parameters?.mode!=='fl2v' || !same(h3Parameters.images,h3Refs.map(ref=>ref.name))) throw bad('invalid video reference binding');
      const existing=await store.getTask(videoRequestId);
      if (existing) return existingH3Result(existing);
    }
    // Also used when a concurrent insert wins between getTask and the RPC.
    function assistantAudioExistingResult(existing) {
      const conflict=()=>{throw new HttpError(409,'assistant_audio_request_conflict','Assistant audio request conflict');};
      const unknown=()=>{throw new HttpError(503,'assistant_audio_status_unknown','Assistant audio request status is unknown');};
      if(String(existing.id)!==assistantTaskId || String(existing.user_id)!==String(user.id) ||
         existing.task_type!==taskType || existing.model_id!==requirementsFor(taskType).modelId) conflict();
      const normalized=validateTaskParameters(taskType,body.parameters);
      const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
        ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
      const target=sanitizeText(body.target_worker_id || body.targetWorkerId,80)||null;
      if(JSON.stringify(canonical(existing.input_manifest?.parameters))!==JSON.stringify(canonical(normalized))||
         String(existing.input_manifest?.target_worker_id||'')!==String(target||'')||
         !Array.isArray(existing.input_manifest?.references)||existing.input_manifest.references.length!==0)conflict();
      const raw=existing.estimated_credit_cost;
      if((typeof raw!=='number' && typeof raw!=='string') || (typeof raw==='string' && raw.trim()!==raw))unknown();
      const text=String(raw),match=/^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(text);
      if(!match)unknown();
      const units=BigInt(match[1])*1000000n+BigInt((match[2]||'').padEnd(6,'0'));
      if(units>BigInt(Number.MAX_SAFE_INTEGER))unknown();
      return {ok:true,task:publicTask(existing),idempotent:true,
        pricing:{creditCost:Number(units)/1000000,source:'existing_task_snapshot'},
        target:existing.input_manifest?.target_worker_id?{id:existing.input_manifest.target_worker_id,name:existing.input_manifest.target_worker_name||null}:null};
    }
    if (assistantTaskId !== undefined) {
      if (assistantAudioCreateOnceEnabled !== true || typeof store.createAudioTaskOnce !== 'function')
        throw new HttpError(503, 'assistant_audio_create_once_unavailable', 'Assistant audio submission is unavailable');
      if (typeof assistantTaskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assistantTaskId) || taskType!=='audio_music')
        throw bad('invalid assistant audio request');
      // This scoped path is text-only. Never silently ignore references on
      // either the initial submission or a recovery of an existing task.
      if([body.references,body.parameters?.references].some(refs => refs != null && (!Array.isArray(refs) || refs.length !== 0)))
        throw bad('assistant audio references are not supported');
      // A committed matching task owns its original price and scheduling
      // snapshot. Recover it before checking today's balance or worker state.
      const existing=await store.getTask(assistantTaskId);
      if(existing) return assistantAudioExistingResult(existing);
    }
    const requestedQwenScope=body?.parameters?.assistant_tool_scope;
    const planRequested = [QWEN_PLAN_SCOPE,QWEN_IMAGE_EDIT_SCOPE].includes(requestedQwenScope);
    let planActor = null, planSessionExpiry = 0;
    if (planRequested) {
      if (!qwenScopeEnabled(requestedQwenScope)) throw new HttpError(503, 'qwen_plan_unavailable', 'Qwen plan unavailable');
      planActor = await requireArtActor(headers);
      let session;
      try { session = await verifySessionToken(bearerToken(headers.authorization || headers.Authorization),sessionSecret); }
      catch { throw new HttpError(401,ERROR_CODE.UNAUTHORIZED,'invalid session'); }
      if (!Number.isSafeInteger(session?.exp) || session.exp <= nowSeconds())
        throw new HttpError(401,ERROR_CODE.UNAUTHORIZED,'invalid session expiry');
      planSessionExpiry = session.exp;
    }
    // Website users may use their own authorized machines independently of
    // pool membership; shared nodes still require the existing account tier.
    const requestedTarget = sanitizeText(body.target_worker_id || body.targetWorkerId, 80);
    const ownTarget = UUID_RE.test(requestedTarget) ? await store.getWorkerById(requestedTarget) : null;
    const hasOwnCompute = !canUseSharedCompute(user.plan) && !requestedTarget
      && (await store.listWorkers(user.id)).some(worker => workerAllowsUser(worker, user));
    if (!canUseSharedCompute(user.plan) && !hasOwnCompute && !(ownTarget && String(ownTarget.owner_id) === String(user.id) && workerAllowsUser(ownTarget, user))) {
      throw new HttpError(403, ERROR_CODE.PLAN_REQUIRED,
        '此账号没有获准使用的本机算力，请先接入助手并联系管理员设置机器归属和本人使用权限。使用其他算力节点需要中级或高级账户。',
        { plan: String(user.plan || 'trial') });
    }
    // A 中级账户 may use 普通 nodes only; the scheduler reads this flag off the
    // task so a 高级 node never picks its work up, pinned or not.
    const allowPremiumNodes = canUsePremiumNodes(user.plan) || Boolean(ownTarget && String(ownTarget.owner_id) === String(user.id));

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
      if (moduleName === 'spine-split-runtime' && method === 'defaultQwenInpaintWorkflow') {
        const options = Array.isArray(parameters.__args) ? parameters.__args[5] : null;
        const route = options && typeof options === 'object' ? options.route : null;
        const provider = options && typeof options === 'object' ? options.inpaintProvider : null;
        if (route?.nsfw === true || route?.workflow === 'rapid-aio-nsfw' ||
            ['qwen-2.1-nsfw-lora', 'qwen-rapid-aio-nsfw-v20', 'rapid-aio-nsfw'].includes(route?.provider) ||
            provider === true || ['qwen-2.1-nsfw-lora', 'qwen-rapid-aio-nsfw-v20', 'rapid-aio-nsfw'].includes(provider)) {
          throw bad('旧 NSFW 编辑路线已退役，请在新版页面重新开启开关；任务未提交。');
        }
      }
      req = { modelId: workflowModelId(moduleName, parameters, method), minVramMb: entry.minVramMb, kind: entry.kind };
      pricing = priceTask(entry.price === 'video' ? 'h3_i2v' : IMAGE_PRICE_KEY, pricingViewOf(parameters));
      inputWorkflow = { module: moduleName, method };
    } else {
      if (!isKnownTaskType(taskType)) throw bad('unsupported task type: ' + taskType);
      req = requirementsFor(taskType);
      parameters = validateTaskParameters(taskType, taskType === MATTING_TASK_TYPE || taskType === PROMPT_ASSISTANT_TASK_TYPE
        ? { ...body.parameters, references: sanitizeReferences(body.references) }
        : body.parameters);
      if (taskType === PROMPT_ASSISTANT_TASK_TYPE && [PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID,PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY,UI_CPU_CAPABILITY].includes(parameters.model_id)) {
        req = { ...req, modelId: parameters.model_id, minVramMb: 0 };
      }
      if (parameters.assistant_tool_scope === QWEN_PLAN_SCOPE || parameters.assistant_tool_scope === QWEN_IMAGE_EDIT_SCOPE)
        req = { ...req, modelId: parameters.assistant_tool_scope===QWEN_IMAGE_EDIT_SCOPE?QWEN_IMAGE_EDIT_CAPABILITY:QWEN_PLAN_CAPABILITY, minVramMb: 0 };
      pricing = priceTask(taskType, parameters);
    }

    if (!req.modelId || RETIRED_MODEL_IDS.includes(req.modelId))
      throw new HttpError(409, ERROR_CODE.NOT_FOUND, '所选模型已下线或不存在，任务未提交。');

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
    if (planRequested && (taskType !== PROMPT_ASSISTANT_TASK_TYPE || !target ||
        String(target.owner_id || '') !== String(user.id) || !workerAllowsUser(target,user) ||
        String(planActor?.user?.id || '') !== String(user.id) ||
        (requestedQwenScope===QWEN_IMAGE_EDIT_SCOPE && !UUID_V4_RE.test(String(target.ownership_generation||'')))))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen plan requires your own enabled node');

    // Fail fast when nothing online can run it, instead of parking the task in
    // a queue nobody drains. Pinned work counts its node alone; a 中级账户
    // counts 普通 nodes alone.
    const capable = h3Refs ? await store.countH3CapableWorkers(req.minVramMb, HEARTBEAT_TIMEOUT_SECONDS,
      target ? target.id : null, allowPremiumNodes, user.id, canUseSharedCompute(user.plan))
      : await store.countCapableWorkers(req.modelId, req.minVramMb, HEARTBEAT_TIMEOUT_SECONDS,
        target ? target.id : null, allowPremiumNodes, user.id, canUseSharedCompute(user.plan));
    if(h3Refs && (!Number.isSafeInteger(Number(capable)) || Number(capable)<1))
      throw new HttpError(409,ERROR_CODE.NOT_FOUND,'No compatible video node is available');
    if (req.modelId === PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID && capable === 0) {
      throw new HttpError(409, ERROR_CODE.NOT_FOUND, '当前没有可用的 Qwen 文字和图片试用节点，请稍后重试或选择其他模型。');
    }
    if (req.modelId === PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY && capable === 0)
      throw new HttpError(409, ERROR_CODE.NOT_FOUND, '当前没有支持此业务的 Qwen 节点，本次未提交。');
    if ([QWEN_PLAN_CAPABILITY,QWEN_IMAGE_EDIT_CAPABILITY].includes(req.modelId) && (!Number.isSafeInteger(Number(capable)) || Number(capable)<1))
      throw new HttpError(409, ERROR_CODE.NOT_FOUND, '当前本人节点尚未支持 Qwen 基础操作，本次未提交。');
    if (req.modelId === UI_CPU_CAPABILITY && capable === 0)
      throw new HttpError(409, ERROR_CODE.NOT_FOUND, '所选算力节点不支持 UI CPU 编译，本次未提交。');
    if (req.modelId === QWEN21_EDIT_LORA_CAPABILITY && capable === 0)
      throw new HttpError(409, ERROR_CODE.NOT_FOUND, '没有可用的兼容编辑节点：需要新版算力助手、Qwen 2.1 Turbo 底模及指定兼容 LoRA，任务未提交。');
    const inputManifest = {
      parameters,
      min_vram_mb: req.minVramMb,
      protocol: PROTOCOL_VERSION,
      created_from: 'web',
      workflow: inputWorkflow,
      references: h3Refs || sanitizeReferences(body.references),
      ...(h3Refs ? {h3_idempotency_scope:'h3-idempotent-v1'} : {}),
      target_worker_id: target ? target.id : null,
      target_worker_name: target ? target.worker_name : null,
      allow_premium_nodes: allowPremiumNodes,
      ...(planRequested ? {qwen_foart_plan:{scope:requestedQwenScope,user_id:String(user.id),
        session_id:planActor.sessionId,session_expires_epoch:planSessionExpiry,worker_id:String(target.id),
        ...(requestedQwenScope===QWEN_IMAGE_EDIT_SCOPE?{ownership_generation:target.ownership_generation}:{}),
        request_id:parameters.request_id,request_sha256:parameters.request_sha256,request_bytes:parameters.request_bytes}} : {})
    };

    const taskInput = {
      userId: user.id,
      taskType,
      modelId: req.modelId,
      inputManifest,
      estimatedCreditCost: pricing.creditCost,
      expiresAt: new Date(planRequested ? Math.min(Date.now()+(requestedQwenScope===QWEN_IMAGE_EDIT_SCOPE?15:5)*60*1000,planSessionExpiry*1000) : Date.now() + 6 * 3600 * 1000).toISOString()
    };
    let task, idempotent=false;
    if (assistantTaskId !== undefined) {
      let result;
      try { result=await store.createAudioTaskOnce({...taskInput,taskId:assistantTaskId}); }
      catch(error) {
        if(error?.code==='23505') throw new HttpError(409,'assistant_audio_request_conflict','Assistant audio request conflict');
        throw error;
      }
      if(!result?.task || typeof result.idempotent!=='boolean')throw new HttpError(503,'assistant_audio_status_unknown','Assistant audio request status is unknown');
      task=result.task;idempotent=result.idempotent;
      if(idempotent) return assistantAudioExistingResult(task);
    } else if (videoRequestId !== undefined) {
      let result;
      try { result=await store.createH3TaskOnce({...taskInput,taskId:videoRequestId}); }
      catch(error) {
        if(error?.code==='23505') {
          const existing=await store.getTask(videoRequestId);
          if(existing) return existingH3Result(existing);
          h3Conflict();
        }
        throw error;
      }
      if(!result?.task || typeof result.idempotent!=='boolean')throw new HttpError(503,'h3_status_unknown','Video request status is unknown');
      task=result.task;idempotent=result.idempotent;
      if(idempotent) return existingH3Result(task);
    } else task=await store.createTask(taskInput);

    log('task created', { taskId: task.id, taskType, capable });
    return {
      ok: true,
      task: publicTask(task),
      ...(assistantTaskId !== undefined || videoRequestId !== undefined ? {idempotent} : {}),
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
    if (isQwenPlanTask(task)) await requireQwenPlanActor(headers,task);
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
    if (isQwenRotationCandidateTask(task))
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'candidate requires its bound cancellation');
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
    if (isQwenRotationCandidateTask(task))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen rotation candidate owner lease unavailable');
    if (isQwenUiDraftTask(task))
      throw new HttpError(403, ERROR_CODE.FORBIDDEN, 'Qwen UI owner lease unavailable');
    const qwenPlan = isQwenPlanTask(task);
    let planBinding = null;
    if (qwenPlan) {
      if (!qwenScopeEnabled(qwenScopedContract(task)?.scope)) throw new HttpError(503,'qwen_plan_unavailable','Qwen plan unavailable');
      planBinding = await requireQwenPlanActor(headers,task);
      if (!body || !['upload','download'].includes(body.op) || !Number.isSafeInteger(body.attempt) ||
          body.attempt < 1 || body.attempt > 20 || body.attempt !== Number(task.attempt_count))
        throw bad('invalid Qwen plan grant request');
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

    let worker = await store.getWorkerById(task.assigned_worker_id);
    if (!worker) throw new HttpError(409, ERROR_CODE.CONFLICT, 'assigned worker is gone');

    const ttlSeconds = qwenPlan ? Math.min(60,planBinding.bound.session_expires_epoch-nowSeconds()) :
      (op === GRANT_OP.DOWNLOAD ? GRANT_DOWNLOAD_TTL_SECONDS : GRANT_TTL_SECONDS);
    if (ttlSeconds < 1) throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Qwen plan authorization denied');
    const h3Scoped = task.input_manifest?.h3_idempotency_scope === 'h3-idempotent-v1';
    if (h3Scoped && ((op===GRANT_OP.UPLOAD && h3CreateOnceEnabled!==true) || task.task_type!=='renderer_workflow' ||
        task.input_manifest?.workflow?.module!=='NovaFlowAiSequenceMiniMaxH3Workflow' ||
        task.input_manifest?.workflow?.method!=='buildWorkflow'))
      throw new HttpError(503,'h3_create_once_unavailable','Video recovery unavailable');
    // A scoped H3 download requires an independent server-only session proof.
    // Until separately enabled, never fall back to an ordinary download grant.
    if (h3Scoped && op===GRANT_OP.DOWNLOAD && h3DownloadEnabled!==true)
      throw new HttpError(503,'h3_download_unavailable','Video download authorization unavailable');
    if (h3Scoped && op===GRANT_OP.DOWNLOAD &&
        (!body || Object.keys(body).sort().join(',')!=='name,op' || typeof body.name!=='string'))
      throw bad('invalid video download request');
    let h3Snapshot=null;
    if(h3Scoped) {
      if(typeof store.getH3RecoverySnapshot!=='function')throw new HttpError(503,'h3_recovery_unavailable','Video recovery unavailable');
      h3Snapshot=await store.getH3RecoverySnapshot(task.id,worker.id);
      const bound=h3Snapshot?.recovery_worker;
      if(!h3Snapshot || !h3SnapshotPolicyValid(h3Snapshot,{download:op===GRANT_OP.DOWNLOAD}) || String(h3Snapshot.user_id)!==String(user.id) ||
         String(h3Snapshot.assigned_worker_id)!==String(worker.id) ||
         !(op===GRANT_OP.DOWNLOAD ? h3Snapshot.status===TASK_STATE.COMPLETED : [TASK_STATE.ASSIGNED,TASK_STATE.UPLOADING].includes(h3Snapshot.status)) ||
         Number(h3Snapshot.attempt_count)!==Number(task.attempt_count) ||
         h3Snapshot.input_manifest?.h3_idempotency_scope!=='h3-idempotent-v1' ||
         String(h3Snapshot.input_manifest?.h3_assigned_worker_owner_id||'')!==String(bound?.owner_id||'') ||
         !bound?.ownership_generation || h3Snapshot.input_manifest?.h3_assigned_worker_owner_generation!==bound.ownership_generation)
        throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video grant unavailable');
      worker=bound;
    }
    let h3Proof=null,h3File=null,h3GrantTtl=ttlSeconds,h3Deadline=null;
    if(h3Scoped && op===GRANT_OP.DOWNLOAD) {
      const actor=await requireArtActor(headers);
      const session=await verifySessionToken(bearerToken(headers.authorization || headers.Authorization),sessionSecret);
      const selected=h3DownloadFile(h3Snapshot,body.name);
      if(!selected || String(actor.user.id)!==String(h3Snapshot.user_id) || !Number.isSafeInteger(session.exp))
        throw new HttpError(404,ERROR_CODE.NOT_FOUND,'unknown video output');
      h3File=selected.file;
      const deadline=Math.min(session.exp,selected.expiresAt,nowSeconds()+60);
      h3Deadline=deadline;
      h3GrantTtl=deadline-nowSeconds();
      if(h3GrantTtl<1)throw new HttpError(410,ERROR_CODE.EXPIRED,'results have expired');
      h3Proof=await issueH3DownloadProof({userId:String(user.id),sessionId:actor.sessionId,taskId:String(task.id),
        workerId:String(worker.id),attempt:Number(h3Snapshot.attempt_count),ownershipGeneration:worker.ownership_generation,
        file:h3File,sessionExpiresAt:session.exp,resultExpiresAt:selected.expiresAt},controlSecret);
    }
    const grantKey = await deriveWorkerGrantKey(worker.id, controlSecret);
    if(qwenPlan && qwenScopedContract(task)?.scope===QWEN_IMAGE_EDIT_SCOPE)
      await requireQwenImageEditLease(task,planBinding.bound,Number(task.attempt_count),op);
    const token = await issueGrantToken(
      { userId: user.id, taskId: task.id, workerId: worker.id, op, ttlSeconds:h3GrantTtl,
        ...(h3Scoped && op===GRANT_OP.UPLOAD ? {scope:'h3-idempotent-v1',attempt:Number(h3Snapshot.attempt_count),
          ownership_generation:worker.ownership_generation,refs:h3Snapshot.input_manifest.references}
          : h3Scoped && op===GRANT_OP.DOWNLOAD ? {scope:'h3-download-v1',attempt:Number(h3Snapshot.attempt_count),
            ownership_generation:worker.ownership_generation,file:h3File,proof:h3Proof}
          : qwenPlan ? {scope:qwenScopedContract(task).scope,attempt:Number(task.attempt_count)} : {}) },
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
        expiresAt: new Date((h3Deadline ?? (nowSeconds() + h3GrantTtl)) * 1000).toISOString()
      }
    };
  }

  async function handleH3InputVerify(taskId, body, headers) {
    const worker=await requireWorker(headers);
    const recovery=body?.phase==='recovery';
    if (!body || typeof body!=='object' || Array.isArray(body) ||
        Object.keys(body).sort().join(',')!==(recovery?'attempt,phase,promptId,userId':'attempt,phase') ||
        (recovery && (typeof body.userId!=='string' || !UUID_RE.test(body.userId) ||
          typeof body.promptId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.promptId))) ||
        !['upload','execute','recovery'].includes(body.phase) || !Number.isSafeInteger(body.attempt) || body.attempt<1 || body.attempt>20)
      throw bad('invalid video verification');
    if (body.phase==='recovery' ? h3RecoveryEnabled!==true : h3CreateOnceEnabled!==true)
      throw new HttpError(503,'h3_create_once_unavailable','Video recovery unavailable');
    // Read task and worker in one DB snapshot. A node may have changed owner
    // since assignment; an old token or a new owner must not reveal the task.
    if (typeof store.getH3RecoverySnapshot!=='function')
      throw new HttpError(503,'h3_recovery_unavailable','Video recovery unavailable');
    const payload=await verifyWorkerToken(bearerToken(headers.authorization || headers.Authorization),controlSecret);
    const task=await store.getH3RecoverySnapshot(taskId,worker.id);
    const boundWorker=task?.recovery_worker;
    if (!task || !boundWorker || !payload.owner || !boundWorker.owner_id ||
        String(payload.owner)!==String(boundWorker.owner_id) ||
        typeof payload.ownership_generation!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.ownership_generation) ||
        payload.ownership_generation!==boundWorker.ownership_generation ||
        task.input_manifest?.h3_assigned_worker_owner_generation!==boundWorker.ownership_generation ||
        String(task.input_manifest?.h3_assigned_worker_owner_id || '')!==String(boundWorker.owner_id) ||
        boundWorker.enabled!==true ||
        String(boundWorker.id)!==String(worker.id) || String(task.assigned_worker_id)!==String(worker.id) || Number(task.attempt_count)!==body.attempt ||
        !h3SnapshotPolicyValid(task) ||
        task.task_type!=='renderer_workflow' || task.model_id!=='minimax-h3' ||
        task.input_manifest?.h3_idempotency_scope!=='h3-idempotent-v1')
      throw new HttpError(404,ERROR_CODE.NOT_FOUND,'unknown video task');
    if (body.phase==='recovery') {
      // A recovery snapshot never authorizes a new submission or changes state.
      if (![TASK_STATE.ASSIGNED,TASK_STATE.UPLOADING,TASK_STATE.PROCESSING,TASK_STATE.COMPLETED,
            TASK_STATE.FAILED,TASK_STATE.CANCELLED,TASK_STATE.EXPIRED].includes(task.status) || String(task.user_id)!==String(body.userId) ||
          (task.status===TASK_STATE.COMPLETED && String(task.prompt_id || '')!==body.promptId))
        throw new HttpError(404,ERROR_CODE.NOT_FOUND,'unknown video task');
      const result={ok:true,taskId:String(task.id),workerId:String(worker.id),workerOwnerId:String(boundWorker.owner_id),
        workerOwnerGeneration:boundWorker.ownership_generation,attempt:body.attempt,status:task.status,userMatched:true};
      if (task.status===TASK_STATE.PROCESSING) {
        result.userId=String(task.user_id);
        result.workerOwnerId=String(boundWorker.owner_id);
        result.refs=task.input_manifest.references;
        result.parameters=task.input_manifest.parameters;
        // An explicit, separately controlled deployment gate is required:
        // operators must verify the reviewed completion RPC and its ACL first.
        if(h3AtomicCompletionEnabled===true && typeof store.completeH3AndSettle==='function')
          result.completionMode='h3-atomic-v1';
      }
      if (task.status===TASK_STATE.COMPLETED) result.taskCreditSettledFlag=task.credit_settled===true;
      return result;
    }
    const validStates=body.phase==='upload'?[TASK_STATE.ASSIGNED,TASK_STATE.UPLOADING]:[TASK_STATE.ASSIGNED,TASK_STATE.UPLOADING,TASK_STATE.PROCESSING];
    if (!task || String(task.assigned_worker_id)!==String(worker.id) || Number(task.attempt_count)!==body.attempt ||
        !validStates.includes(task.status) ||
        task.input_manifest?.h3_idempotency_scope!=='h3-idempotent-v1')
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video input verification denied');
    return {ok:true,taskId:String(task.id),workerId:String(worker.id),userId:String(task.user_id),
      workerOwnerId:String(boundWorker.owner_id),workerOwnerGeneration:boundWorker.ownership_generation,
      attempt:body.attempt,status:task.status,refs:task.input_manifest.references};
  }

  async function handleH3DownloadVerify(taskId,body,headers) {
    if(h3DownloadEnabled!==true)throw new HttpError(503,'h3_download_unavailable','Video download authorization unavailable');
    const worker=await requireWorker(headers);
    const actor=await requireH3WorkerActor(headers,worker);
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).join(',')!=='proof' || typeof body.proof!=='string')
      throw bad('invalid video download verification');
    let proof;
    try {proof=await verifyH3DownloadProofSignature(body.proof,controlSecret);}
    catch {throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video download authorization denied');}
    if(String(proof.task)!==String(taskId) || String(proof.wid)!==String(worker.id) ||
       proof.ownership_generation!==actor.generation || typeof store.getH3RecoverySnapshot!=='function' || typeof store.getUserSession!=='function')
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video download authorization denied');
    const [snapshot,session]=await Promise.all([store.getH3RecoverySnapshot(taskId,worker.id),store.getUserSession(proof.sid)]);
    const bound=snapshot?.recovery_worker,selected=h3DownloadFile(snapshot,proof.file?.name);
    if(!snapshot || !bound || !session || session.revoked_at || String(session.id)!==String(proof.sid) ||
       String(session.user_id)!==String(proof.sub) || String(snapshot.user_id)!==String(proof.sub) ||
       String(bound.owner_id)!==actor.ownerId || bound.ownership_generation!==actor.generation ||
       snapshot.input_manifest?.h3_idempotency_scope!=='h3-idempotent-v1' ||
       snapshot.input_manifest?.h3_assigned_worker_owner_id!==actor.ownerId ||
       snapshot.input_manifest?.h3_assigned_worker_owner_generation!==actor.generation ||
       Number(snapshot.attempt_count)!==proof.attempt || !h3SnapshotPolicyValid(snapshot,{download:true}) || !selected ||
       selected.file.name!==proof.file.name || selected.file.kind!==proof.file.kind ||
       selected.file.bytes!==proof.file.bytes || selected.file.sha256!==proof.file.sha256 || proof.exp>selected.expiresAt)
      throw new HttpError(403,ERROR_CODE.FORBIDDEN,'Video download authorization denied');
    return {ok:true,taskId:String(snapshot.id),workerId:String(worker.id),userId:String(snapshot.user_id),
      workerOwnerId:actor.ownerId,workerOwnerGeneration:actor.generation,attempt:proof.attempt,file:selected.file,expiresAt:proof.exp};
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
    const qwen21Turbo = await store.countCapableWorkers('qwen-image-2.1-turbo', findModel('qwen-image-2.1-turbo').min_vram_mb,
      HEARTBEAT_TIMEOUT_SECONDS, workerId, user ? canUsePremiumNodes(user.plan) : true, user?.id || null,
      user ? canUseSharedCompute(user.plan) : true).catch(() => 0);
    // Community trial readiness can expose a specific machine's setup, so
    // unlike public generic counts it is only disclosed to an authorized user.
    const qwen35CpuTrial = user ? await store.countCapableWorkers(PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID, 0,
      HEARTBEAT_TIMEOUT_SECONDS, workerId, canUsePremiumNodes(user.plan), user.id,
      canUseSharedCompute(user.plan)).catch(() => 0) : 0;
    const qwen35BusinessTrial = user ? await store.countCapableWorkers(PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY, 0,
      HEARTBEAT_TIMEOUT_SECONDS, workerId, canUsePremiumNodes(user.plan), user.id,
      canUseSharedCompute(user.plan)).catch(() => 0) : 0;
    let qwen21NativeRewriteV3=false;
    if(user && workerId && typeof store.getWorkerById==='function') {
      const node=await store.getWorkerById(workerId).catch(()=>null);
      if(node && String(node.owner_id || '')===String(user.id) && workerAllowsUser(node,user)) {
        const count=await store.countCapableWorkers(QWEN21_NATIVE_REWRITE_V3_CAPABILITY,0,
          HEARTBEAT_TIMEOUT_SECONDS,workerId,canUsePremiumNodes(user.plan),user.id,false).catch(()=>0);
        qwen21NativeRewriteV3=Number(count)>0;
      }
    }
    let qwenPlanReady=false;
    if(qwenPlanEnabled===true && user && workerId) {
      const actor=await requireArtActor(headers).catch(()=>null);
      const node=actor ? await store.getWorkerById(workerId).catch(()=>null) : null;
      if(node && String(node.owner_id || '')===String(user.id) && workerAllowsUser(node,user)) {
        const count=await store.countCapableWorkers(QWEN_PLAN_CAPABILITY,0,
          HEARTBEAT_TIMEOUT_SECONDS,workerId,canUsePremiumNodes(user.plan),user.id,false).catch(()=>0);
        qwenPlanReady=Number(count)>0;
      }
    }
    let qwenImageEditReady=false;
    if(qwen21LocalImageEditEnabled===true && user && workerId) {
      const actor=await requireArtActor(headers).catch(()=>null);
      const node=actor ? await store.getWorkerById(workerId).catch(()=>null) : null;
      if(node && String(node.owner_id || '')===String(user.id) && workerAllowsUser(node,user) && UUID_V4_RE.test(String(node.ownership_generation||''))) {
        const count=await store.countCapableWorkers(QWEN_IMAGE_EDIT_CAPABILITY,0,
          HEARTBEAT_TIMEOUT_SECONDS,workerId,canUsePremiumNodes(user.plan),user.id,false).catch(()=>0);
        qwenImageEditReady=Number(count)>0;
      }
    }
    let qwenRotationReady=false;
    if(qwenRotationVerifyEnabled===true && qwenRotationCreateEnabled===true && user && workerId &&
       ['createQwenRotationCandidate','listQwenRotationCandidates','claimQwenRotationCandidate',
        'authorizeQwenRotationLease','startQwenRotationCandidate','completeQwenRotationCandidate','cancelQwenRotationCandidate']
        .every(name=>typeof store[name]==='function')) {
      const actor=await requireArtActor(headers).catch(()=>null);
      const node=actor ? await store.getWorkerById(workerId).catch(()=>null) : null;
      if(node && String(node.owner_id || '')===String(user.id) && node.enabled===true && node.owner_enabled===true) {
        const count=await store.countCapableWorkers(PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY,0,
          HEARTBEAT_TIMEOUT_SECONDS,workerId,canUsePremiumNodes(user.plan),user.id,false).catch(()=>0);
        qwenRotationReady=Number(count)>0;
      }
    }
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
      available_workers: Math.max(0, ...counts, qwen21, qwen21Turbo),
      features: { qwenImage21: qwen21 > 0, qwenImage21Workers: qwen21, qwenImage21Turbo: qwen21Turbo > 0, qwenImage21TurboWorkers: qwen21Turbo, qwen35CpuTrial: qwen35CpuTrial > 0, qwen35BusinessTrial: qwen35BusinessTrial > 0,qwen21NativeRewriteV3,
        qwen35FoartPlan:qwenPlanReady,qwen35FoartPlanOwnerBound:qwenPlanReady,
        qwen21LocalImageEdit:qwenImageEditReady,qwen21LocalImageEditOwnerLeaseBound:qwenImageEditReady,
        qwen35FoartRotationCandidate:qwenRotationReady,qwen35FoartRotationOwnerLeaseBound:qwenRotationReady,
        qwen35UiDraft: false, qwen35UiOwnerLeaseBound: false,
        h3CreateOnce:h3CreateOnceEnabled===true && typeof store.createH3TaskOnce==='function' && typeof store.countH3CapableWorkers==='function' },
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
    if (kind === 'qwen' && !engine) throw bad('invalid LoRA context');
    const modelId = kind === 'h3' ? 'minimax-h3' : query.variant === 'turbo' ? 'qwen-image-2.1-turbo' : QWEN21_MODEL_ID;
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
    // Keep both verified adapters in the catalogue so workers can validate the graph.
    const managed = new Map([[QWEN21_EDIT_LORA_NAME.toLowerCase(), 'qwen21-nsfw-lora-v1'], [QWEN21_UC_LORA_NAME, 'qwen21-uc-lora-v1']]);
    const catalogItems = engine ? items.map(item => {
      const autoManaged = managed.get(item.name.replaceAll('\\', '/').toLowerCase());
      return autoManaged ? { ...item, autoManaged } : item;
    }) : items;
    const features = engine ? {
      qwen21_nsfw_lora: catalogItems.some(item => item.autoManaged === 'qwen21-nsfw-lora-v1'),
      qwen21_uc_lora: catalogItems.some(item => item.autoManaged === 'qwen21-uc-lora-v1')
    } : undefined;
    return { ok: true, items: catalogItems, ...(features ? { features } : {}) };
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

  // Image bytes are validated and capped by companionInput. Keep the original
  // 64 KiB limit for text/metadata while allowing the existing 20 MiB image
  // allowance; otherwise a normal reference photo fails before reaching it.
  function operationIntentWithinLimits(intent) {
    try {
      if(!intent||typeof intent!=='object'||Array.isArray(intent))return false;
      const images=intent.images===undefined?[]:intent.images;
      if(!Array.isArray(images)||images.length>3)return false;
      let imageChars=0;
      for(const image of images) {
        if(!image||typeof image!=='object'||Array.isArray(image)||typeof image.dataUrl!=='string')return false;
        imageChars+=image.dataUrl.length;
      }
      const text=JSON.stringify(intent),maxImages=Math.ceil(20*1024*1024/3)*4+3*40;
      return imageChars<=maxImages && text.length-imageChars<=65536;
    } catch {return false;}
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
      if(method==='GET'&&path==='/api/web/companion/pricing'){
        const user=await requireUser(headers);
        if(!companion?.pricing)throw new HttpError(503,'companion-unavailable','在线计费策略尚未配置');
        try{return ok({ok:true,policy:await companion.pricing({user})});}
        catch(error){if(error.status)throw new HttpError(error.status,['companion-pricing-changed','xiaotao_reservation_release_unconfirmed','xiaotao_reservation_status_unknown','xiaotao_settlement_status_unknown'].includes(error.code)?error.code:'companion-failed',error.message);throw error;}
      }
      if(method==='POST'&&path==='/api/web/companion/quote'){
        const user=await requireUser(headers);
        if(!companion?.quote)throw new HttpError(503,'companion-unavailable','在线计费策略尚未配置');
        try{return ok({ok:true,quote:await companion.quote({user,payload:body})});}
        catch(error){if(error.status)throw new HttpError(error.status,['companion-pricing-changed','xiaotao_reservation_release_unconfirmed','xiaotao_reservation_status_unknown','xiaotao_settlement_status_unknown'].includes(error.code)?error.code:'companion-failed',error.message);throw error;}
      }
      if(method==='POST'&&path==='/api/web/companion/chat'){
        const user=await requireUser(headers);
        if(!companion)throw new HttpError(503,'companion-unavailable','在线参考分析服务尚未启用');
        try{return ok({ok:true,...await companion.reply({user,payload:body})});}
        catch(error){if(error.status)throw new HttpError(error.status,['companion-pricing-changed','xiaotao_reservation_release_unconfirmed','xiaotao_reservation_status_unknown','xiaotao_settlement_status_unknown'].includes(error.code)?error.code:'companion-failed',error.message);throw error;}
      }
      if(method==='POST'&&['/api/web/companion/operation/foart/prepare','/api/web/companion/operation/foart/start',
        '/api/web/companion/operation/foart/resume','/api/web/companion/operation/foart/cancel'].includes(path)){
        // A separate default-closed adapter supports only a validated open
        // action. Actor, freshness, pricing and provider are server-owned.
        const operationHeaders={authorization:String(headers.authorization || headers.Authorization || '')};
        const authorized=await requireArtActor(operationHeaders),name=path.slice(path.lastIndexOf('/')+1);
        const handler=companion?.foartOperation?.[name];
        if(typeof handler!=='function')throw new HttpError(503,'operation-billing-disabled','操作级工具计费尚未开通。');
        const common=['originalIntent','initialContext'],fields=name==='prepare'?[...common,'nonce','model']:
          name==='resume'?[...common,'operationToken','previousContext','continuationToken','receipt','context']:[...common,'operationToken'];
        const optional=name==='resume'?['previousPlan']:[];
        if(Array.isArray(body)||fields.some(key=>!Object.hasOwn(body,key))||Object.keys(body).some(key=>!fields.includes(key)&&!optional.includes(key))||
          !body.originalIntent||typeof body.originalIntent!=='object'||Array.isArray(body.originalIntent)||
          !body.initialContext||typeof body.initialContext!=='object'||Array.isArray(body.initialContext))
          throw new HttpError(400,'operation-invalid-request','操作请求格式无效。');
        if(Object.hasOwn(body,'previousPlan')&&(!body.previousPlan||typeof body.previousPlan!=='object'||Array.isArray(body.previousPlan)))
          throw new HttpError(400,'operation-invalid-request','操作请求格式无效。');
        let size;try{size=JSON.stringify(body).length;}catch{size=Infinity;}
        if(size>250000)throw new HttpError(400,'operation-invalid-request','操作请求过大。');
        if(name==='prepare'&&(typeof body.nonce!=='string'||typeof body.model!=='string'))throw new HttpError(400,'operation-invalid-request','操作请求格式无效。');
        if(name!=='prepare'&&(typeof body.operationToken!=='string'||body.operationToken.length>8192))throw new HttpError(400,'operation-invalid-request','操作请求格式无效。');
        const isCurrent=async candidate=>{try{const fresh=await requireArtActor(operationHeaders);return String(fresh.user.id)===String(authorized.user.id)&&fresh.sessionId===authorized.sessionId&&
          String(candidate?.userId||'')===String(authorized.user.id)&&String(candidate?.sessionId||'')===authorized.sessionId;}catch{return false;}};
        try {return ok({ok:true,...await handler({...body,actor:{userId:String(authorized.user.id),sessionId:authorized.sessionId},signal:request.signal,isCurrent})});}
        catch(error){const status=Number(error?.statusCode??error?.status);if(status>=400&&status<600)throw new HttpError(status,String(error.code||'operation-billing-unavailable'),String(error.message||'operation unavailable'));
          throw new HttpError(503,'operation-billing-unavailable','操作状态暂时无法确认。');}
      }
      if(method==='POST'&&path==='/api/web/companion/operation/status'){
        // This endpoint is read-only. Authenticated identity, not the body,
        // scopes the DB query; it never dispatches, settles or refunds.
        const operationHeaders={authorization:String(headers.authorization || headers.Authorization || '')};
        const actor=await requireArtActor(operationHeaders);
        if(typeof companion?.getXiaotaoOperationV3Status!=='function')throw new HttpError(503,'operation-billing-disabled','操作级计费尚未开通。');
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||
          typeof body.operationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operationId))
          throw new HttpError(400,'operation-invalid-request','操作请求格式无效。');
        const isCurrent=async candidate=>{try{const fresh=await requireArtActor(operationHeaders);return String(fresh.user.id)===String(actor.user.id)&&fresh.sessionId===actor.sessionId&&
          String(candidate?.userId||'')===String(actor.user.id)&&String(candidate?.sessionId||'')===actor.sessionId;}catch{return false;}};
        try{return ok({ok:true,operation:await companion.getXiaotaoOperationV3Status({...actor,payload:{operationId:body.operationId},isCurrent})});}
        catch(error){const status=Number(error?.statusCode??error?.status);if(status>=400&&status<600)throw new HttpError(status,String(error.code||'operation-status-unknown'),String(error.message||'operation status unavailable'));
          throw new HttpError(503,'operation-status-unknown','操作状态暂时无法确认。');}
      }
      if(method==='POST'&&path==='/api/web/companion/operation/execute'){
        // The handler is server-owned and disabled unless explicitly injected.
        // Never accept model, phase, identity, policy, usage or cost from body.
        const operationHeaders={authorization:String(headers.authorization || headers.Authorization || '')};
        const actor=await requireArtActor(operationHeaders);
        if(typeof companion?.executeXiaotaoOperationV3!=='function')throw new HttpError(503,'operation-billing-disabled','\u64cd\u4f5c\u7ea7\u8ba1\u8d39\u5c1a\u672a\u5f00\u901a\u3002');
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||
          !Object.keys(body).every(key=>['operationToken','intent'].includes(key))||
          typeof body.operationToken!=='string'||body.operationToken.length>8192||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.operationToken)||
          !body.intent||typeof body.intent!=='object'||Array.isArray(body.intent))
          throw new HttpError(400,'operation-invalid-request','\u64cd\u4f5c\u8bf7\u6c42\u683c\u5f0f\u65e0\u6548\u3002');
        if(!operationIntentWithinLimits(body.intent))throw new HttpError(400,'operation-invalid-request','\u64cd\u4f5c\u8bf7\u6c42\u8fc7\u5927\u3002');
        const isCurrent=async candidate=>{
          try {
            const fresh=await requireArtActor(operationHeaders);
            return String(fresh.user.id)===String(actor.user.id) && fresh.sessionId===actor.sessionId &&
              String(candidate?.userId || '')===String(actor.user.id) && String(candidate?.sessionId || '')===actor.sessionId;
          } catch {return false;}
        };
        try {
          return ok({ok:true,...await companion.executeXiaotaoOperationV3({...actor,
            payload:{operationToken:body.operationToken,intent:body.intent},signal:request.signal,isCurrent})});
        } catch(error) {
          const status=Number(error?.statusCode ?? error?.status);
          if(status>=400&&status<600)throw new HttpError(status,String(error.code||'operation-billing-unavailable'),String(error.message||'operation unavailable'));
          throw new HttpError(503,'operation-billing-unavailable','\u64cd\u4f5c\u72b6\u6001\u6682\u65f6\u65e0\u6cd5\u786e\u8ba4\u3002');
        }
      }
      if(method==='POST'&&path==='/api/web/companion/operation/prepare'){
        // Disabled unless a server-owned handler is explicitly injected. This
        // is not wired to v2 or to a provider and never enables paid traffic.
        const operationHeaders={authorization:String(headers.authorization || headers.Authorization || '')};
        const actor=await requireArtActor(operationHeaders);
        if(typeof companion?.prepareXiaotaoOperationV3!=='function')throw new HttpError(503,'operation-billing-disabled','\u64cd\u4f5c\u7ea7\u8ba1\u8d39\u5c1a\u672a\u5f00\u901a\u3002');
        const keys=Object.keys(body);
        if(Array.isArray(body)||keys.length!==3||!keys.every(key=>['nonce','model','intent'].includes(key))||
          typeof body.nonce!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.nonce)||
          typeof body.model!=='string'||!body.model||body.model.length>200||
          !body.intent||typeof body.intent!=='object'||Array.isArray(body.intent))
          throw new HttpError(400,'operation-invalid-request','\u64cd\u4f5c\u8bf7\u6c42\u683c\u5f0f\u65e0\u6548\u3002');
        if(!operationIntentWithinLimits(body.intent))throw new HttpError(400,'operation-invalid-request','\u64cd\u4f5c\u8bf7\u6c42\u8fc7\u5927\u3002');
        const isCurrent=async candidate=>{
          try {
            const fresh=await requireArtActor(operationHeaders);
            return String(fresh.user.id)===String(actor.user.id) && fresh.sessionId===actor.sessionId &&
              String(candidate?.userId || '')===String(actor.user.id) && String(candidate?.sessionId || '')===actor.sessionId;
          } catch {return false;}
        };
        try {
          // intent remains untrusted input. The injected handler must derive
          // model authorization, canonical digest and pricing from the server;
          // no body field is an identity, policy snapshot, usage or cost.
          const result=await companion.prepareXiaotaoOperationV3({...actor,payload:{nonce:body.nonce,model:body.model,intent:body.intent},signal:request.signal,isCurrent});
          return ok({ok:true,operation:result});
        } catch(error) {
          const status=Number(error?.statusCode ?? error?.status);
          if(status>=400&&status<600)throw new HttpError(status,String(error.code||'operation-billing-unavailable'),String(error.message||'operation unavailable'));
          throw new HttpError(503,'operation-billing-unavailable','\u64cd\u4f5c\u72b6\u6001\u6682\u65f6\u65e0\u6cd5\u786e\u8ba4\u3002');
        }
      }
      if(method==='POST'&&['/api/web/companion/art/quote','/api/web/companion/art/execute','/api/web/companion/art/cancel'].includes(path)){
        // Keep the original bearer value in a server-only closure. Revalidate
        // the account and session before dispatch and after settlement; never
        // accept a freshness callback or session identity from request.body.
        const artHeaders={authorization:String(headers.authorization || headers.Authorization || '')};
        const actor=await requireArtActor(artHeaders);
        const isCurrentArtActor=async candidate=>{
          try {
            const fresh=await requireArtActor(artHeaders);
            return String(fresh.user.id)===String(actor.user.id) && fresh.sessionId===actor.sessionId &&
              String(candidate?.userId || '')===String(actor.user.id) && String(candidate?.sessionId || '')===actor.sessionId;
          } catch {return false;}
        };
        const action=path.endsWith('/quote')?'artQuote':path.endsWith('/cancel')?'artCancel':'artExecute';
        if(typeof companion?.[action]!=='function')throw new HttpError(503,'art-business-unavailable','\u5728\u7ebf\u7f8e\u5de5\u5c1a\u672a\u5b89\u5168\u5f00\u901a\uff0c\u672c\u6b21\u6ca1\u6709\u63d0\u4ea4\u6216\u6263\u8d39\u3002');
        if(action==='artCancel'&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||
          !Object.keys(body).every(k=>['stageToken','epoch'].includes(k))||typeof body.stageToken!=='string'||body.stageToken.length>180000||
          !Number.isSafeInteger(body.epoch)||body.epoch<0))throw new HttpError(400,'art-invalid-request','\u64cd\u4f5c\u8bf7\u6c42\u683c\u5f0f\u65e0\u6548\u3002');
        try {
          const result=await companion[action]({...actor,payload:body,signal:request.signal,isCurrent:isCurrentArtActor});
          return action==='artQuote' ? ok({ok:true,quote:result}) : ok({ok:true,...result});
        } catch(error) {
          const status=Number(error?.status);
          if(status>=400&&status<600)throw new HttpError(status,String(error.code||'art-business-unavailable'),String(error.message||'\u5728\u7ebf\u7f8e\u5de5\u6682\u4e0d\u53ef\u7528'));
          throw new HttpError(400,String(error?.code||'art-business-invalid'),'\u5728\u7ebf\u7f8e\u5de5\u8bf7\u6c42\u672a\u5b8c\u6210\uff0c\u8bf7\u6838\u5bf9\u8d26\u5355\u72b6\u6001\u3002');
        }
      }
      if (path === '/api/web/xiaotao/memory' || path.startsWith('/api/web/xiaotao/memory/')) return ok(await xiaotaoMemory.handle({method,path,headers,body}));
      if (method === 'GET' && path === '/health') {
        return ok({ ok: true, service: 'novaflow-web-control', protocol: PROTOCOL_VERSION, status: 'running', releaseVersion: RELEASE_VERSION });
      }
      if (method === 'GET' && path === '/api/web/capabilities') return ok(await handleCapabilities(query, headers));
      if (method === 'GET' && path === '/api/web/me') return ok(await handleMe(headers));
      if (method === 'GET' && path === '/api/web/loras/qwen') return ok(await handleLoraCatalog('qwen', query, headers));
      if (method === 'GET' && path === '/api/web/loras/h3') return ok(await handleLoraCatalog('h3', query, headers));
      if (method === 'POST' && path === '/api/web/loras/h3/validate') return ok(await handleLoraCatalog('h3', body, headers, body));

      if (method === 'POST' && path === '/api/worker/register') return ok(await handleWorkerRegister(body, headers, request.clientAddress));
      if (method === 'POST' && path === '/api/worker/login') return ok(await handleWorkerLogin(body));
      if (method === 'POST' && path === '/api/worker/heartbeat') return ok(await handleHeartbeat(body, headers));
      if (method === 'POST' && path === '/api/worker/models') return ok(await handleWorkerModels(body, headers));
      if (method === 'POST' && path === '/api/worker/claim') return ok(await handleClaim(headers));
      if (method === 'POST' && path === '/api/worker/qwen-rotation/claim') return ok(await handleQwenRotationClaim(body, headers));
      if (method === 'POST' && path === '/api/worker/expire') return ok(await handleWorkerExpire(body, headers));

      let m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/h3-download-verify$/);
      if (m && method === 'POST') return ok(await handleH3DownloadVerify(m[1],body,headers));
      m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/h3-input-verify$/);
      if (m && method === 'POST') return ok(await handleH3InputVerify(m[1], body, headers));
      m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/qwen-foart-plan-verify$/);
      if (m && method === 'POST') return ok(await handleQwenPlanVerify(m[1], body, headers));

      m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/qwen-rotation-verify$/);
      if (m && method === 'POST') return ok(await handleQwenRotationVerify(m[1], body, headers));

      m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/qwen-rotation-phase$/);
      if (m && method === 'POST') return ok(await handleQwenRotationPhase(m[1], body, headers));

      m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/qwen-rotation-(start|complete|fail)$/);
      if (m && method === 'POST') return ok(await handleQwenRotationMutation(m[1], body, headers, m[2]));

      m = path.match(/^\/api\/worker\/tasks\/([^/]+)\/(progress|complete|fail|stop)$/);
      if (m && method === 'POST') {
        const [, taskId, action] = m;
        if (action === 'progress') return ok(await handleWorkerProgress(taskId, body, headers));
        if (action === 'complete') return ok(await handleWorkerComplete(taskId, body, headers));
        if (action === 'stop') return ok(await handleWorkerExplicitStop(taskId, body, headers));
        return ok(await handleWorkerFail(taskId, body, headers));
      }

      if (method === 'POST' && path === '/api/web/qwen-rotation/tasks') return ok(await handleQwenRotationCreate(body, headers));
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

      m = path.match(/^\/api\/web\/tasks\/([^/]+)\/qwen-rotation-cancel$/);
      if (m && method === 'POST') return ok(await handleQwenRotationCancel(m[1], body, headers));

      m = path.match(/^\/api\/web\/tasks\/([^/]+)\/qwen-rotation-proof$/);
      if (m && method === 'POST') return ok(await handleQwenRotationProof(m[1], body, headers));

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
      if (/compute enrollment rate limit/.test(message)) return {status:429,body:{ok:false,error:'设备登记过于频繁，请稍后重试',code:'enrollment_rate_limited'}};
      if (/compute pending enrollment capacity/.test(message)) return {status:503,body:{ok:false,error:'待审批设备已达上限，请联系管理员处理',code:'enrollment_capacity_reached'}};
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
function workerPolicy(worker, includeAllowed = true) {
  return {
    pending_approval: !worker.owner_id,
    enabled: worker.enabled === true,
    owner_enabled: worker.owner_enabled === true,
    sharing_enabled: worker.sharing_enabled === true,
    sharing_scope: worker.sharing_scope === 'pool' ? 'pool' : 'selected',
    ...(includeAllowed ? { allowed_user_ids: Array.isArray(worker.allowed_user_ids) ? worker.allowed_user_ids : [] } : {})
  };
}

function workerAllowsUser(worker, user) {
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
    owner_id: worker.owner_id || null,
    ...(typeof worker.ownership_generation==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(worker.ownership_generation)
      ? {ownership_generation:worker.ownership_generation} : {}),
    pending_approval: !worker.owner_id,
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

// A scoped result is usable only until its original task deadline, even if a
// sweeper has not changed its status or removed files yet.
function qwenPlanUnexpired(task) {
  const expiry = Date.parse(String(task?.expires_at || ''));
  return Number.isFinite(expiry) && expiry > Date.now();
}

function isQwenPlanTask(task) {
  return [QWEN_PLAN_CAPABILITY,QWEN_IMAGE_EDIT_CAPABILITY].includes(task?.model_id) ||
    [QWEN_PLAN_SCOPE,QWEN_IMAGE_EDIT_SCOPE].includes(task?.input_manifest?.parameters?.assistant_tool_scope) ||
    [QWEN_PLAN_SCOPE,QWEN_IMAGE_EDIT_SCOPE].includes(task?.input_manifest?.qwen_foart_plan?.scope);
}

function qwenScopedContract(task) {
  const scope=task?.input_manifest?.qwen_foart_plan?.scope;
  if(scope===QWEN_PLAN_SCOPE)return {scope,capability:QWEN_PLAN_CAPABILITY,resultFile:QWEN_PLAN_RESULT_FILE};
  if(scope===QWEN_IMAGE_EDIT_SCOPE)return {scope,capability:QWEN_IMAGE_EDIT_CAPABILITY,resultFile:QWEN_IMAGE_EDIT_RESULT_FILE};
  return null;
}

function isQwenRotationCandidateTask(task) {
  const matches = parameters => parameters && typeof parameters==='object' && (
    parameters.assistant_tool_scope === PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE ||
    parameters.assistantToolScope === PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE ||
    parameters.model_id === PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY ||
    parameters.modelId === PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY ||
    parameters.foartAnimationStage === 'rotation_candidate' || parameters.foart_animation_stage === 'rotation_candidate');
  return /^fa047a0a-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(task?.id || '')) ||
    matches(task?.input_manifest?.parameters) || matches(task?.parameters) ||
    task?.model_id === PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY ||
    task?.modelId === PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY;
}

function isQwenUiDraftTask(task) {
  const parameters = task?.input_manifest?.parameters || {};
  return parameters.ui_scope === 'qwen-ui-draft-v1' || parameters.uiScope === 'qwen-ui-draft-v1' ||
    parameters.assistant_tool_scope === 'qwen-ui-draft-v1' ||
    parameters.model_id === 'qwen3.5-9b-heretic-ui-draft-v1' ||
    parameters.modelId === 'qwen3.5-9b-heretic-ui-draft-v1' ||
    task?.model_id === 'qwen3.5-9b-heretic-ui-draft-v1';
}

function publicTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    ...(task.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1' ? {h3_idempotency_scope:'h3-idempotent-v1'} : {}),
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
    ...(task.input_manifest?.h3_idempotency_scope==='h3-idempotent-v1' ? {
      h3_idempotency_scope:'h3-idempotent-v1',user_id:task.user_id,assigned_worker_id:task.assigned_worker_id,
      h3_assigned_worker_owner_id:task.input_manifest?.h3_assigned_worker_owner_id || null,
      h3_assigned_worker_owner_generation:task.input_manifest?.h3_assigned_worker_owner_generation || null
    } : {}),
    attempt_count: Number(task.attempt_count || 0),
    assigned_at: task.assigned_at,
    expires_at: task.expires_at
  };
}

// ===== index.ts ======================================================
// NovaFlow Web control plane - Supabase Edge Function.
//
// A NEW function deployed ALONGSIDE the existing novaflow-backend. It does not
// modify, wrap or replace that function, so the stable Desktop product is
// unaffected whether or not this is deployed.
//
// It contains no routing or business logic of its own: the whole API lives in
// packages/shared/src/control-plane.mjs, which the local control plane runs
// too. This file is the Supabase-shaped edge of that one implementation - a
// store adapter plus request plumbing.
//
// Secrets it needs (supabase secrets set ...):
//   NOVAFLOW_SUPABASE_URL              (or SUPABASE_URL)
//   NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY)
//   NOVAFLOW_SESSION_SECRET            the SAME value novaflow-backend uses,
//                                      so a Desktop login works on the Web
//   NOVAFLOW_WEB_CONTROL_SECRET        Web-line only: signs worker tokens and
//                                      derives per-worker grant keys





const FUNCTION_NAME = 'novaflow-web';


function env(name: string): string {
  return String(Deno.env.get(name) || '').trim();
}

function supabaseUrl(): string {
  return (env('NOVAFLOW_SUPABASE_URL') || env('SUPABASE_URL')).replace(/\/+$/, '');
}

function serviceRoleKey(): string {
  return env('NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
}

function sessionSecret(): string {
  return env('NOVAFLOW_SESSION_SECRET');
}

// Optional. When it is not set it is derived from NOVAFLOW_SESSION_SECRET,
// so a deployment has one fewer secret to create by hand. See
// resolveControlSecret in tokens.mjs for why that is safe.
function controlSecret(): string {
  return env('NOVAFLOW_WEB_CONTROL_SECRET');
}

let cachedAdmin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cachedAdmin) {
    const url = supabaseUrl();
    const key = serviceRoleKey();
    if (!url || !key) throw new Error('Supabase service role is not configured');
    cachedAdmin = createClient(url, key, { auth: { persistSession: false } });
  }
  return cachedAdmin;
}



function unwrapRpc<T>(data: unknown): T | null {
  // A plpgsql function returning a table type comes back as an array of one.
  if (Array.isArray(data)) return (data[0] ?? null) as T | null;
  return (data ?? null) as T | null;
}

/**
 * Store adapter. Every method calls the SAME SQL function the local PgStore
 * calls, through PostgREST rpc() instead of a direct connection, so behaviour
 * cannot diverge between the two deployments.
 */
const supabaseStore = {
  async listXiaotaoMemory(userId: string) {
    const {data,error}=await admin().from('xiaotao_user_memories').select('id,category,slot,memory_text,source,updated_at').eq('user_id',userId).order('updated_at',{ascending:false}).limit(20);
    if(error)throw error;return (data||[]).map((r:any)=>({id:r.id,category:r.category,slot:r.slot,text:r.memory_text,source:r.source,updatedAt:r.updated_at}));
  },
  async getXiaotaoMemoryEnabled(userId: string){const {data,error}=await admin().from('xiaotao_memory_settings').select('enabled').eq('user_id',userId).maybeSingle();if(error)throw error;return data?.enabled!==false;},
  async setXiaotaoMemoryEnabled(userId: string,enabled: boolean){const {error}=await admin().from('xiaotao_memory_settings').upsert({user_id:userId,enabled,updated_at:new Date().toISOString()});if(error)throw error;},
  async saveXiaotaoMemory(userId: string,item: any){const {data,error}=await admin().rpc('xiaotao_memory_save',{p_user_id:userId,p_category:item.category,p_slot:item.slot,p_text:item.text,p_source:item.source});if(error)throw error;return data;},
  async deleteXiaotaoMemory(userId: string,id: string|null){
    let query=admin().from('xiaotao_user_memories').delete({count:'exact'}).eq('user_id',userId);
    if(id)query=query.eq('id',id);
    const {count,error}=await query;if(error)throw error;return count||0;
  },
  async getUserById(userId: string) {
    if (!UUID_RE.test(String(userId))) return null;
    const { data, error } = await admin()
      .from('users')
      .select('id,email,display_name,role,plan,status,expires_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getUserSession(sessionId: string) {
    if (!UUID_RE.test(String(sessionId))) return null;
    const { data, error } = await admin()
      .from('user_sessions')
      .select('id,user_id,revoked_at')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getCreditBalance(userId: string) {
    const { data, error } = await admin()
      .from('credits')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return Number(data?.balance || 0);
  },

  async registerWorker({ workerId, ownerId, workerName, secretHash, hardware }: any) {
    const { data, error } = await admin().rpc('novaflow_web_register_worker', {
      p_worker_id: workerId,
      p_owner_id: ownerId,
      p_worker_name: workerName,
      p_secret_hash: secretHash,
      p_hardware: hardware || {}
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async enrollPendingWorker({workerId,workerName,secretHash,hardware,peerHash}: any) {
    const {data,error}=await admin().rpc('novaflow_web_enroll_pending_worker', {
      p_worker_id:workerId,p_worker_name:workerName,p_secret_hash:secretHash,p_hardware:hardware||{},p_peer_hash:peerHash
    });
    if(error)throw error;return unwrapRpc(data);
  },

  async getWorkerById(workerId: string) {
    if (!UUID_RE.test(String(workerId || ''))) return null;
    const { data, error } = await admin()
      .from('gpu_workers').select('*').eq('id', workerId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async listWorkers(ownerId: string) {
    const { data, error } = await admin()
      .from('gpu_workers').select('*').eq('owner_id', ownerId).order('created_at');
    if (error) throw error;
    return data || [];
  },

  async heartbeat({ workerId, status, currentTaskId, hardware }: any) {
    const { data, error } = await admin().rpc('novaflow_web_worker_heartbeat', {
      p_worker_id: workerId,
      p_status: status,
      p_current_task_id: currentTaskId || null,
      p_hardware: hardware || {}
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async reportModels(workerId: string, models: unknown[]) {
    const { data, error } = await admin().rpc('novaflow_web_report_models', {
      p_worker_id: workerId,
      p_models: models || []
    });
    if (error) throw error;
    return Number(data || 0);
  },

  async countCapableWorkers(modelId: string, minVramMb: number, heartbeatTimeoutSeconds: number, workerId: string | null = null, allowPremium = true, userId: string | null = null, allowShared = true) {
    const {data,error}=await admin().rpc('novaflow_web_count_capable_workers', {
      p_model_id:modelId,p_min_vram:minVramMb,p_timeout:heartbeatTimeoutSeconds,p_worker_id:workerId,
      p_allow_premium:allowPremium,p_user_id:userId,p_allow_shared:allowShared
    });
    if(error)throw error;return Number(data||0);
  },

  async listPoolWorkers() {
    const { data, error } = await admin()
      .from('gpu_workers')
      .select('id,owner_id,worker_name,status,tier,gpu_name,vram_mb,last_heartbeat,enabled,owner_enabled,sharing_enabled,sharing_scope,allowed_user_ids')
      .order('worker_name');
    if (error) throw error;
    return data || [];
  },

  async setWorkerTier(workerId: string, tier: string) {
    const { data, error } = await admin()
      .from('gpu_workers')
      .update({ tier: tier === 'premium' ? 'premium' : 'standard', updated_at: new Date().toISOString() })
      .eq('id', workerId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listCapableModelDetails(modelId: string, minVramMb: number, heartbeatTimeoutSeconds: number, userId: string | null = null, allowPremium = true, allowShared = true) {
    const {data,error}=await admin().rpc('novaflow_web_capable_model_details', {
      p_model_id:modelId,p_min_vram:minVramMb,p_timeout:heartbeatTimeoutSeconds,p_user_id:userId,
      p_allow_premium:allowPremium,p_allow_shared:allowShared
    });
    if(error)throw error;return data||[];
  },

  async createTask({ userId, taskType, modelId, inputManifest, estimatedCreditCost, expiresAt }: any) {
    const { data, error } = await admin().rpc('novaflow_web_create_task', {
      p_user_id: userId,
      p_task_type: taskType,
      p_model_id: modelId,
      p_input_manifest: inputManifest || {},
      p_estimated_credit_cost: estimatedCreditCost,
      p_expires_at: expiresAt
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async createAudioTaskOnce({ userId, taskId, taskType, modelId, inputManifest, estimatedCreditCost, expiresAt }: any) {
    const { data, error } = await admin().rpc('novaflow_web_create_audio_once_v1', {
      p_user_id: userId, p_task_id: taskId, p_task_type: taskType, p_model_id: modelId,
      p_input_manifest: inputManifest || {}, p_estimated_credit_cost: estimatedCreditCost, p_expires_at: expiresAt
    });
    if (error) throw error;
    const result=unwrapRpc(data);
    if(!result?.task || typeof result.idempotent!=='boolean')throw new Error('assistant_audio_status_unknown');
    return {task:result.task,idempotent:result.idempotent};
  },

  async createH3TaskOnce({ userId, taskId, taskType, modelId, inputManifest, estimatedCreditCost, expiresAt }: any) {
    const { data, error } = await admin().rpc('novaflow_web_create_h3_once_v1', {
      p_user_id:userId, p_task_id:taskId, p_task_type:taskType, p_model_id:modelId,
      p_input_manifest:inputManifest || {}, p_estimated_credit_cost:estimatedCreditCost, p_expires_at:expiresAt
    });
    if(error) throw error;
    const result=unwrapRpc(data);
    if(!result?.task || typeof result.idempotent!=='boolean')throw new Error('h3_status_unknown');
    return {task:result.task,idempotent:result.idempotent};
  },

  async countH3CapableWorkers(minVramMb: number, heartbeatTimeoutSeconds: number, targetWorkerId: string | null,
    allowPremiumNodes: boolean, userId: string | null, allowShared: boolean) {
    const {data,error}=await admin().rpc('novaflow_web_count_h3_idempotent_workers_v1', {
      p_min_vram_mb:minVramMb, p_heartbeat_timeout_seconds:heartbeatTimeoutSeconds,
      p_target_worker_id:targetWorkerId, p_allow_premium_nodes:allowPremiumNodes,
      p_user_id:userId, p_allow_shared:allowShared
    });
    if(error) throw error;
    return data;
  },

  async claimH3Task({workerId,ownerId,ownershipGeneration,heartbeatTimeoutSeconds}: any) {
    const {data,error}=await admin().rpc('novaflow_web_h3_claim_task_v1', {
      p_worker_id:workerId,p_expected_owner:ownerId,p_expected_generation:ownershipGeneration,
      p_heartbeat_timeout_seconds:heartbeatTimeoutSeconds
    });
    if(error)throw error;
    const result=unwrapRpc(data);
    return result?.id ? result : null;
  },

  async getTask(taskId: string) {
    if (!UUID_RE.test(String(taskId || ''))) return null;
    const { data, error } = await admin()
      .from('web_ai_tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async getH3RecoverySnapshot(taskId: string, workerId: string) {
    if (!UUID_RE.test(String(taskId || '')) || !UUID_RE.test(String(workerId || ''))) return null;
    // A single joined read gives the task and its current node owner under one
    // database snapshot; worker-owned grant keys are not owner proof.
    const {data,error}=await admin().from('web_ai_tasks')
      .select('id,user_id,task_type,model_id,status,prompt_id,input_manifest,output_manifest,result_expired,assigned_worker_id,attempt_count,credit_settled,recovery_user:users!web_ai_tasks_user_id_fkey(id,plan,status,expires_at),recovery_worker:gpu_workers!web_ai_tasks_assigned_worker_id_fkey(id,owner_id,enabled,owner_enabled,sharing_enabled,sharing_scope,allowed_user_ids,tier,endpoint_url,transport,ownership_generation,capabilities:worker_models!worker_models_worker_id_fkey(model_id,status))')
      .eq('id',taskId).eq('assigned_worker_id',workerId).maybeSingle();
    if(error) throw error;
    return data;
  },

  async listTasks(userId: string, limit: number) {
    const { data, error } = await admin()
      .from('web_ai_tasks').select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  // A waiting task's place in line (control plane queueView): counts and timestamps only.
  async queueSnapshot({ modelId, createdAt }: any) {
    const { count, error } = await admin()
      .from('web_ai_tasks').select('id', { count: 'exact', head: true })
      .eq('status', 'queued').eq('model_id', modelId).lt('created_at', createdAt);
    if (error) throw error;
    return { queuedAhead: count || 0 };
  },

  async queueStats({ modelId }: any) {
    const [running, recent] = await Promise.all([
      admin().from('web_ai_tasks').select('started_at,assigned_at,created_at')
        .eq('model_id', modelId).in('status', ['assigned', 'uploading', 'processing']).limit(50),
      admin().from('web_ai_tasks').select('started_at,completed_at')
        .eq('model_id', modelId).eq('status', 'completed')
        .not('started_at', 'is', null).not('completed_at', 'is', null)
        .order('completed_at', { ascending: false }).limit(20)
    ]);
    if (running.error) throw running.error;
    if (recent.error) throw recent.error;
    return {
      runningStartedAt: (running.data || []).map((t: any) => t.started_at || t.assigned_at || t.created_at),
      recentRuns: recent.data || []
    };
  },

  async stopWorkerTask({taskId,workerId,attempt}: any) {
    const {data,error}=await admin().rpc('novaflow_web_stop_worker_task_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_expected_attempt:attempt
    });
    if(error)throw error;
    return unwrapRpc<any>(data);
  },

  async workerStopReady(signal: AbortSignal) {
    const {data,error}=await admin().rpc('novaflow_web_worker_stop_readiness_v1').abortSignal(signal);
    if(error)throw error;
    const result=unwrapRpc<any>(data);
    return result?.ready===true && result?.protocol==='worker-stop-v1';
  },

  async claimTask(workerId: string, heartbeatTimeoutSeconds: number) {
    const { data, error } = await admin().rpc('novaflow_web_claim_task', {
      p_worker_id: workerId,
      p_heartbeat_timeout_seconds: heartbeatTimeoutSeconds
    });
    if (error) throw error;
    const row = unwrapRpc<any>(data);
    return row && row.id ? row : null;
  },

  async listActiveAssignedTasks(workerId: string) {
    const { data, error } = await admin()
      .from('web_ai_tasks').select('id,status')
      .eq('assigned_worker_id', workerId)
      .in('status', ['assigned', 'uploading', 'processing'])
      .limit(10);
    if (error) throw error;
    return data || [];
  },

  async updateTaskStatus({ taskId, workerId, toStatus, progress, note, detail }: any) {
    const { data, error } = await admin().rpc('novaflow_web_update_task_status', {
      p_task_id: taskId,
      p_worker_id: workerId || null,
      p_to_status: toStatus,
      p_progress: progress,
      p_progress_note: note || '',
      p_detail: detail || {}
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async updateH3TaskStatus({ taskId, workerId, ownerId, ownershipGeneration, attempt, expectedStatus, toStatus, progress, note, detail }: any) {
    const {data,error}=await admin().rpc('novaflow_web_h3_update_task_status_v1', {
      p_task_id:taskId, p_worker_id:workerId, p_expected_owner:ownerId, p_expected_generation:ownershipGeneration,
      p_attempt:attempt, p_expected_status:expectedStatus,
      p_to_status:toStatus, p_progress:progress, p_progress_note:note || '', p_detail:detail || {}
    });
    if(error) throw error;
    const result=unwrapRpc(data);
    if(!result?.id)throw new Error('h3_status_unknown');
    return result;
  },

  async completeH3AndSettle({taskId,workerId,ownerId,ownershipGeneration,attempt,inputManifest,promptId,outputManifest,chargeAmount,pricingSource,pricingDetails}: any) {
    const {data,error}=await admin().rpc('novaflow_web_h3_complete_and_settle_v1', {
      p_task_id:taskId,p_worker_id:workerId,p_expected_owner:ownerId,p_expected_generation:ownershipGeneration,
      p_attempt:attempt,p_expected_input_manifest:inputManifest,p_prompt_id:promptId,p_output_manifest:outputManifest,
      p_charge_amount:chargeAmount,p_pricing_source:pricingSource,p_pricing_details:pricingDetails
    });
    if(error) throw error;
    const result=unwrapRpc(data);
    if(!result?.task || typeof result.idempotent!=='boolean' || !result.settlement)throw new Error('h3_settlement_unknown');
    return result;
  },

  async verifyQwenImageEditLease({taskId,workerId,userId,sessionId,attempt,op,sha256=null,bytes=null}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_image_edit_authorize_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,
      p_attempt:attempt,p_op:op,p_sha256:sha256,p_bytes:bytes
    });
    if(error)throw error;
    return data===true;
  },

  async authorizeQwenRotationLease({ taskId, workerId, userId, sessionId, attempt, op, proofExpiresAtMs, uploadSha256=null, uploadBytes=null }: any) {
    const { data, error } = await admin().rpc('novaflow_qwen_rotation_authorize_v1', {
      p_task_id: taskId, p_worker_id: workerId, p_user_id: userId, p_session_id: sessionId,
      p_attempt: attempt, p_op: op, p_proof_expires_at_ms: proofExpiresAtMs,
      p_upload_sha256: uploadSha256, p_upload_bytes: uploadBytes
    });
    if (error) throw error;
    return data === true;
  },

  async createQwenRotationCandidate({ userId, sessionId, sessionExpiresAt, workerId, requestId, sha256, bytes }: any) {
    const { data, error } = await admin().rpc('novaflow_qwen_rotation_create_v1', {
      p_user_id:userId, p_session_id:sessionId, p_session_expires_epoch:sessionExpiresAt,
      p_worker_id:workerId, p_request_id:requestId, p_request_digest:sha256, p_input_bytes:bytes
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async listQwenRotationCandidates({ workerId, ownerId, limit }: any) {
    const { data, error } = await admin().from('web_ai_tasks').select('id')
      .eq('status','queued').eq('user_id',ownerId).eq('model_id','qwen3.5-9b-heretic-foart-rotation-candidate-v1')
      .gte('id','fa047a0a-0000-0000-0000-000000000000').lt('id','fa047a0b-0000-0000-0000-000000000000')
      .eq('input_manifest->>target_worker_id',workerId).order('created_at').limit(Math.min(4,Math.max(1,Number(limit)||4)));
    if (error) throw error;
    return data || [];
  },

  async claimQwenRotationCandidate({taskId,workerId,userId,sessionId,sessionExpiresAt,expectedAttempt,heartbeatTimeoutSeconds}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_claim_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,
      p_session_expires_epoch:sessionExpiresAt,p_expected_attempt:expectedAttempt,p_heartbeat_timeout_seconds:heartbeatTimeoutSeconds
    });
    if(error)throw error;
    const row=unwrapRpc<any>(data);return row && row.id ? row : null;
  },

  async startQwenRotationCandidate({taskId,workerId,userId,sessionId,attempt,proofExpiresAtMs,sha256,bytes}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_start_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,p_attempt:attempt,
      p_proof_expires_at_ms:proofExpiresAtMs,p_uploaded_sha256:sha256,p_uploaded_bytes:bytes
    });
    if(error)throw error;return data===true;
  },

  async completeQwenRotationCandidate({taskId,workerId,userId,sessionId,attempt,proofExpiresAtMs,bytes}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_complete_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,p_attempt:attempt,
      p_proof_expires_at_ms:proofExpiresAtMs,p_result_bytes:bytes
    });
    if(error)throw error;return data===true;
  },

  async failQwenRotationCandidate({taskId,workerId,userId,sessionId,attempt,proofExpiresAtMs}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_fail_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,p_attempt:attempt,
      p_proof_expires_at_ms:proofExpiresAtMs
    });
    if(error)throw error;return data===true;
  },

  async cancelQwenRotationCandidate({taskId,userId,sessionId,sessionExpiresAt,expectedAttempt}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_cancel_v1',{
      p_task_id:taskId,p_user_id:userId,p_session_id:sessionId,p_session_expires_epoch:sessionExpiresAt,
      p_expected_attempt:expectedAttempt
    });
    if(error)throw error;return data===true;
  },

  async markCharged(taskId: string, amount: number) {
    const { data, error } = await admin()
      .from('web_ai_tasks')
      .update({ charged_credit_cost: amount, credit_settled: true, updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async sweep({ heartbeatTimeoutSeconds, assignTimeoutSeconds, processingTimeoutSeconds, maxAttempts }: any) {
    const { data, error } = await admin().rpc('novaflow_web_sweep', {
      p_heartbeat_timeout_seconds: heartbeatTimeoutSeconds,
      p_assign_timeout_seconds: assignTimeoutSeconds,
      p_processing_timeout_seconds: processingTimeoutSeconds,
      p_max_attempts: maxAttempts
    });
    if (error) throw error;
    return data || {};
  },

  async markResultsExpired(taskIds: string[]) {
    const { data, error } = await admin().rpc('novaflow_web_mark_result_expired', {
      p_task_ids: taskIds || []
    });
    if (error) throw error;
    return Number(data || 0);
  },

  async createRegistrationCode({ ownerId, codeHash, label, maxUses, expiresAt, tier }: any) {
    const { data, error } = await admin()
      .from('web_worker_registration_codes')
      .insert({
        code_hash: codeHash, owner_id: ownerId,
        label: label || '', max_uses: maxUses || 1, expires_at: expiresAt,
        tier: tier === 'premium' ? 'premium' : 'standard'
      })
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listRegistrationCodes(ownerId: string) {
    const { data, error } = await admin()
      .from('web_worker_registration_codes')
      .select('label, tier, max_uses, used_count, expires_at, created_at')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  },

  async revokeRegistrationCodes(ownerId: string, label: string | null) {
    let query = admin()
      .from('web_worker_registration_codes')
      .update({ expires_at: new Date().toISOString() })
      .eq('owner_id', ownerId)
      .gt('expires_at', new Date().toISOString());
    if (label) query = query.eq('label', label);
    const { data, error } = await query.select('code_hash');
    if (error) throw error;
    return (data || []).length;
  },

  async consumeRegistrationCode(codeHash: string) {
    // PostgREST cannot express "increment if under the cap" atomically, so we
    // read, then update with the used_count we saw as a guard. A racing second
    // use matches zero rows and is rejected.
    const { data: row, error } = await admin()
      .from('web_worker_registration_codes')
      .select('code_hash, owner_id, label, tier, max_uses, used_count, expires_at')
      .eq('code_hash', codeHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    if (!row || row.used_count >= row.max_uses) return null;

    const { data: claimed, error: claimError } = await admin()
      .from('web_worker_registration_codes')
      .update({ used_count: row.used_count + 1 })
      .eq('code_hash', codeHash)
      .eq('used_count', row.used_count)
      .select('owner_id, label, tier')
      .maybeSingle();
    if (claimError) throw claimError;
    return claimed || null;
  },

  // Reuses the PRODUCTION settlement function, unchanged. Idempotent on the
  // usage key, atomic across user credits and the provider budget.
  async settleCredits({ userId, promptId, taskType, modelId, estimatedCreditCost, chargeAmount, pricingSource, pricingDetails }: any) {
    const { data, error } = await admin().rpc('settle_comfy_usage', {
      p_usage_key: 'comfyui:' + promptId,
      p_user_id: userId,
      p_prompt_id: promptId,
      p_provider_key: 'comfyui',
      p_model_key: modelId || '',
      p_task_type: taskType,
      p_estimated_credit_cost: estimatedCreditCost,
      p_charge_amount: chargeAmount,
      p_pricing_source: pricingSource,
      p_pricing_details: pricingDetails || {}
    });
    if (error) throw error;
    return data;
  }
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-novaflow-grant',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400'
};

const plane = createControlPlane({
  store: supabaseStore,
  // Do not enable until the worker protocol, scheduling filter and RPC are verified together.
  h3CreateOnceEnabled: false,
  h3RecoveryEnabled: false,
  h3DownloadEnabled: false,
  h3AtomicCompletionEnabled: false,
  // Non-secret opt-in; every advertisement and stop checks the DB readiness
  // RPC as well. The RPC and its limited ACL require separate deployment.
  workerExplicitStopEnabled: env('FOART_WORKER_EXPLICIT_STOP_ENABLED')==='true',
  workerStopReadiness: ({signal}: {signal:AbortSignal}) => supabaseStore.workerStopReady(signal),
  // Default closed until the separately reviewed RPC and client flow exist.
  assistantAudioCreateOnceEnabled: env('FOART_ASSISTANT_AUDIO_CREATE_ONCE_ENABLED')==='true',
  // Deployment-only, non-secret opt-ins. Creation can be stopped while the
  // verifier remains available to finish and download already-created work.
  ...qwenRotationControlOptions({verify:env('FOART_QWEN_ROTATION_VERIFY_ENABLED'),create:env('FOART_QWEN_ROTATION_CREATE_ENABLED')}),
  // Release-managed, non-secret gate for the verified ordinary-task 9B preview.
  // Set false in a rollback after draining existing preview tasks.
  qwenPlanEnabled: true,
  secrets: { sessionSecret: sessionSecret(), controlSecret: await resolveControlSecret({ controlSecret: controlSecret(), sessionSecret: sessionSecret() }) },
  logger: (message: string, meta: unknown) =>
    console.log(JSON.stringify({ fn: FUNCTION_NAME, message, meta }))
});

const FUNCTION_SLUG = 'novaflow-web';

/** /functions/v1/novaflow-web/api/... and /novaflow-web/api/... -> /api/... */
function routePath(pathname: string): string {
  let out = pathname;
  const viaGateway = '/functions/v1/' + FUNCTION_SLUG;
  if (out === viaGateway || out.startsWith(viaGateway + '/')) out = out.slice(viaGateway.length);
  const bare = '/' + FUNCTION_SLUG;
  if (out === bare || out.startsWith(bare + '/')) out = out.slice(bare.length);
  return out || '/';
}

Deno.serve(async (req: Request, info: Deno.ServeHandlerInfo) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  // Supabase routes a function by prefixing the path with its slug, so what
  // arrives here is /novaflow-web/api/web/... while every route, every test and
  // the local control plane speak /api/web/... . Strip the prefix rather than
  // teaching the shared router about a deployment detail - otherwise the two
  // deployments disagree about paths, which is exactly the drift the shared
  // implementation exists to prevent.
  const path = routePath(url.pathname);
  let body: unknown = {};
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ ok: false, error: 'request body too large' }), {
        status: 413,
        headers: { 'content-type': 'application/json', ...CORS }
      });
    }
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'request body must be JSON' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...CORS }
      });
    }
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

  const result = await plane.handle({
    method: req.method,
    // Peer comes from the server, never a caller-controlled forwarding header.
    // Hosted gateways can share this quota until their trusted client-IP contract is verified.
    clientAddress: "hostname" in info.remoteAddr ? info.remoteAddr.hostname : "edge-gateway",
    path,
    headers,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  return new Response(result.body == null ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-foart-deployment': env('DENO_DEPLOYMENT_ID') || 'unknown', ...CORS }
  });
});
