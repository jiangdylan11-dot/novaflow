// GENERATED - do not edit. Built by tools/bundle-edge-function.mjs.
// Source: supabase/functions/novaflow-web/ (7 modules + index.ts)
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
  QWEN_T2I: 'qwen_t2i',
  QWEN_EDIT: 'qwen2511_edit',
  H3_I2V: 'h3_i2v'
});

const TASK_TYPE_WORKFLOW = Object.freeze({
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
const BILLING = Object.freeze({ SELF_HOSTED: 'self_hosted', PROVIDER: 'provider' });

// 'video_matting' is deliberately absent from TASK_TYPE and
// TASK_TYPE_WORKFLOW above. Membership there means "this type names a ComfyUI
// graph file", which the worker's loadWorkflow() then insists on loading and
// tests/e2e/protocol.test.mjs asserts exists. AI 抠图 runs BiRefNet in a
// Python process and never opens ComfyUI at all, so it belongs only here -
// isKnownTaskType() reads THIS table, which is what admits it to the queue.
const MATTING_TASK_TYPE = 'video_matting';

// 提示词助手 (优化 / 反推 / 画风描述) is the desktop's Python service, which every
// compute node ships. On the shared pool it runs as this task: the request
// travels as one uploaded JSON file, the reply comes back as one output file.
// Like matting it names no ComfyUI graph, so it lives only in this table.
const PROMPT_ASSISTANT_TASK_TYPE = 'prompt_assistant';
const PROMPT_ASSISTANT_MODEL_ID = 'prompt-assistant';
const PROMPT_ASSISTANT_ACTIONS = Object.freeze(['optimize-prompt', 'reverse-image-prompt', 'describe-art-style']);
const PROMPT_ASSISTANT_REQUEST_FILE = 'request.json';
const PROMPT_ASSISTANT_RESULT_FILE = 'result.json';

const TASK_TYPE_REQUIREMENTS = Object.freeze({
  [TASK_TYPE.QWEN_T2I]: { modelId: 'qwen-image-2511', minVramMb: 16000, kind: 'image', label: '绘图', billing: BILLING.SELF_HOSTED },
  [TASK_TYPE.QWEN_EDIT]: { modelId: 'qwen-image-2511', minVramMb: 16000, kind: 'image', label: '图生图', billing: BILLING.SELF_HOSTED },
  [TASK_TYPE.H3_I2V]: { modelId: 'minimax-h3', minVramMb: 15000, kind: 'video', label: 'AI序列', billing: BILLING.SELF_HOSTED },
  // Matting is segmentation, not generation: BiRefNet runs at a fixed
  // 1024x1024 whatever the clip is, so the VRAM floor is far below the
  // generation types and a machine that cannot draw can still cut out.
  [MATTING_TASK_TYPE]: { modelId: 'birefnet-matting', minVramMb: 4000, kind: 'video', label: '抠图', billing: BILLING.SELF_HOSTED },
  // A 7B VL model in fp8; the node frees its drawing runtime's memory first.
  [PROMPT_ASSISTANT_TASK_TYPE]: { modelId: PROMPT_ASSISTANT_MODEL_ID, minVramMb: 8000, kind: 'text', label: '提示词助手', billing: BILLING.SELF_HOSTED }
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
  video: 48 * 3600
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
//   trial      普通账户  only the machine 启动NovaFlow opened; no pool node
//   standard   中级账户  pool nodes marked 普通 (standard), not 高级 ones
//   pro / team 高级账户  every pool node, 普通 and 高级 alike
//
// Anything else reads as trial, so a typo in the database can only take
// access away, never grant it.
const PLAN_TIERS = Object.freeze(['trial', 'standard', 'pro', 'team']);
const SHARED_COMPUTE_PLANS = Object.freeze(['standard', 'pro', 'team']);
const PREMIUM_NODE_PLANS = Object.freeze(['pro', 'team']);

function normalizePlan(plan) {
  const key = String(plan || 'trial').trim().toLowerCase();
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
  return await signEnvelope('nfw_', {
    kind: 'worker',
    wid: String(worker.id),
    owner: String(worker.owner_id || ''),
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
async function issueGrantToken(input, grantKey) {
  const iat = nowSeconds();
  const ttl = Number(input.ttlSeconds) > 0 ? Number(input.ttlSeconds) : 900;
  return await signEnvelope('nfg_', {
    kind: 'grant',
    sub: String(input.userId),
    task: String(input.taskId),
    wid: String(input.workerId),
    op: String(input.op),
    iat,
    exp: iat + ttl,
    nonce: randomId()
  }, grantKey);
}

async function verifyGrantToken(token, grantKey, expect = {}) {
  const payload = await verifyEnvelope('nfg_', token, grantKey);
  if (payload.kind !== 'grant') throw new Error('invalid token');
  if (expect.taskId && String(payload.task) !== String(expect.taskId)) throw new Error('grant task mismatch');
  if (expect.workerId && String(payload.wid) !== String(expect.workerId)) throw new Error('grant worker mismatch');
  if (expect.op && String(payload.op) !== String(expect.op)) throw new Error('grant op mismatch');
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
const PRICE_TABLE = Object.freeze({
  [TASK_TYPE.QWEN_T2I]: {
    // per megapixel of output, per 20 sampling steps
    perMegapixelPer20Steps: 1.2,
    minimum: 0.6
  },
  [TASK_TYPE.QWEN_EDIT]: {
    perMegapixelPer20Steps: 1.5,
    minimum: 0.8
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

  if (type === TASK_TYPE.QWEN_T2I || type === TASK_TYPE.QWEN_EDIT) {
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

const WORKFLOW_MODULES = Object.freeze({
  'novaflow-brand-runtime': {
    label: '绘图', modelId: 'qwen-image-2511', minVramMb: 16000,
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
    modelId: 'qwen-image-2511',
    minVramMb: 16000,
    runtime: 'image', kind: 'image', price: 'image',
    positional: true,
    methods: [
      'defaultQwenInpaintWorkflow', 'defaultRemovalInpaintWorkflow', 'defaultRmbgWorkflow', 'samPointWorkflowFromPrompts',
      'buildSeeThroughSplitWorkflow', 'buildSeedVr2ImageUpscaleWorkflow', 'buildQwenImageOutpaintWorkflow',
      'buildImageAngleAdjustWorkflow', 'buildObjectTransferQwen21Workflow',
      'buildEffectExtractQwenWorkflow', 'buildEffectDeeffectQwenWorkflow'
    ]
  },
  // ---- 美工 -------------------------------------------------------------
  NovaFlowArtGenerateProviderWorkflow: {
    label: '绘图',
    modelId: 'qwen-image-2511',
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['buildWorkflow', 'buildRunWorkflow']
  },
  NovaFlowArtGenerateIdeogramWorkflow: {
    label: '绘图 · Ideogram',
    modelId: 'ideogram-4',
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['build', 'buildWorkflow']
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
    modelId: 'qwen-image-2511',
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
  'art-generate-ideogram.workflow': 'NovaFlowArtGenerateIdeogramWorkflow',
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
function workflowModelId(name, options) {
  const entry = workflowModule(name);
  if (!entry) return null;
  const args = name === 'novaflow-brand-runtime' && Array.isArray(options?.__args) ? options.__args : null;
  if (args && args[0] === 'local') {
    const state = args[8] && typeof args[8] === 'object' ? args[8] : {};
    const profile = String(args[10]?.taskProfile || '');
    const ui = profile.toLowerCase() === 'ui-design' && state.localUiEngine === 'qwen-2.1';
    const draw = !/^ui-design/i.test(profile) && state.localDrawEngine === 'qwen-2.1';
    if (ui || draw) return 'qwen-image-2.1';
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
    model_id: 'qwen-image-2511',
    display_name: 'Qwen Image (Rapid AIO)',
    version: '2511.1',
    runtime: 'image',
    min_vram_mb: 16000,
    compatible_workflows: ['qwen_t2i.json', 'qwen2511_edit.json'],
    required_files: [
      {
        path: 'checkpoints/Qwen-Rapid-AIO-NSFW-v20.safetensors',
        min_bytes: 4_000_000_000,
        sha256: null
      }
    ],
    download: {
      // These weights are licensed per user, so this project does not
      // redistribute them. The Model Manager imports them from an existing
      // ComfyUI models folder or a URL the operator configures.
      mode: 'import_or_configured_url',
      hint: 'Point the worker at an existing ComfyUI models folder, or set a download URL in worker settings.'
    }
  },
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
      { path: 'RMBG/RMBG-2.0/model.safetensors', min_bytes: 400_000_000, sha256: null },
      { path: 'RMBG/RMBG-2.0/config.json', min_bytes: 100, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从已有的 NovaFlow 模型目录导入（例如 E:/NovaFlow/models/RMBG），或让 BiRefNet 首次运行时自行下载。'
    }
  },
  {
    // 提示词助手's own model, Qwen3-VL 8B in NF4. 'local' like BiRefNet: ComfyUI
    // never loads it. Either folder is enough ('any'): the NF4 cache the
    // assistant loads, or the raw model it builds that cache from on first use.
    // worker-core then asks the assistant itself (reportModels), which checks
    // the whole folder and its Python service, before advertising it.
    model_id: 'prompt-assistant',
    display_name: '提示词助手 (Qwen3-VL 8B)',
    version: '2.0.0',
    runtime: 'local',
    min_vram_mb: 8000,
    compatible_workflows: ['prompt_assistant'],
    required_match: 'any',
    required_files: [
      { path: 'prompt_assistant/cache/Huihui-Qwen3-VL-8B-Instruct-Abliterated-novaflow-bnb-nf4-v1/novaflow_nf4_cache.json', min_bytes: 100, sha256: null },
      { path: 'prompt_assistant/Huihui-Qwen3-VL-8B-Instruct-Abliterated/model.safetensors.index.json', min_bytes: 10_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从已有的 NovaFlow 模型目录导入 prompt_assistant/cache 下的 NF4 缓存文件夹（例如 E:/NovaFlow/models/prompt_assistant）。'
    }
  },
  {
    // Drawing and UI design on Qwen-Image-2.1. A node reports it ready exactly when it can build the
    // 2.1 graph (detectQwenImage21, the check the builder itself makes), and the control plane queues
    // a run that asks for 2.1 on this model, so only such a node claims it.
    model_id: 'qwen-image-2.1',
    display_name: 'Qwen-Image-2.1',
    version: '2.1',
    runtime: 'image',
    min_vram_mb: 16000,
    compatible_workflows: ['novaflow-brand-runtime.buildArtGenerateRunWorkflow'],
    required_files: [
      { path: 'diffusion_models/qwen-image-2.1-UC-Q8_0.gguf', min_bytes: 7_000_000_000, sha256: null },
      { path: 'text_encoders/qwen3vl_8b_w4a8_heretic.safetensors', min_bytes: 6_000_000_000, sha256: null },
      { path: 'vae/qwen_image_2.1_vae_bf16.safetensors', min_bytes: 600_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从已有的 NovaFlow 模型目录导入（例如 E:/NovaFlow/models），并安装 ComfyUI-GGUF-leejet 节点。'
    }
  }
]);

const QWEN21_MODEL_ID = 'qwen-image-2.1';

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
    const action = sanitizeText(input.action, 40);
    if (!PROMPT_ASSISTANT_ACTIONS.includes(action)) throw bad('unsupported prompt assistant action: ' + action);
    if (cleanRefs.length !== 1 || cleanRefs[0].name !== PROMPT_ASSISTANT_REQUEST_FILE || cleanRefs[0].kind !== 'json') {
      throw bad('a prompt assistant task carries its request as ' + PROMPT_ASSISTANT_REQUEST_FILE);
    }
    return { action, references: cleanRefs };
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
function createControlPlane({ store, secrets, logger }) {
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
        transport: hardware.transport === 'tunnel' ? 'tunnel' : 'direct'
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
    // Every task created here runs on somebody else's node. A 普通账户 keeps
    // to its own machine (the local assistant never calls this endpoint).
    if (!canUseSharedCompute(user.plan)) {
      throw new HttpError(403, ERROR_CODE.PLAN_REQUIRED,
        '普通账户只能使用本机算力：请在本地助手点击“启动NovaFlow”后生成。使用其他算力节点需要中级或高级账户。',
        { plan: String(user.plan || 'trial') });
    }
    // A 中级账户 may use 普通 nodes only; the scheduler reads this flag off the
    // task so a 高级 node never picks its work up, pinned or not.
    const allowPremiumNodes = canUsePremiumNodes(user.plan);
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
      req = { modelId: workflowModelId(moduleName, parameters), minVramMb: entry.minVramMb, kind: entry.kind };
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
      if (!planAllowsNode(user.plan, target.tier)) {
        throw new HttpError(403, ERROR_CODE.NODE_TIER_REQUIRED,
          '中级账户只能使用普通算力节点；使用高级算力节点需要高级账户。',
          { plan: String(user.plan || 'trial'), node_tier: normalizeNodeTier(target.tier) });
      }
    }

    // Fail fast when nothing online can run it, instead of parking the task in
    // a queue nobody drains. Pinned work counts its node alone; a 中级账户
    // counts 普通 nodes alone.
    const capable = await store.countCapableWorkers(req.modelId, req.minVramMb, HEARTBEAT_TIMEOUT_SECONDS,
      target ? target.id : null, allowPremiumNodes);
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
    const nodes = rows.map((w) => {
      const beat = w.last_heartbeat ? new Date(w.last_heartbeat).getTime() : 0;
      const online = beat > since && ['idle', 'busy'].includes(String(w.status));
      return {
        id: w.id,
        name: w.worker_name,
        gpu_name: w.gpu_name || '',
        vram_mb: Number(w.vram_mb) || 0,
        tier: normalizeNodeTier(w.tier),
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
  async function handleCapabilities(query) {
    // ?worker=<id> narrows every count to one node, for a page that pinned its
    // work there: 「AI 已连接」 then speaks for that node, not for the pool.
    const workerId = UUID_RE.test(String(query && query.worker || '')) ? String(query.worker) : null;
    const entries = Object.entries(TASK_TYPE_REQUIREMENTS);
    const counts = await Promise.all(entries.map(([, value]) =>
      store.countCapableWorkers(value.modelId, value.minVramMb, HEARTBEAT_TIMEOUT_SECONDS, workerId)
        .catch(() => 0)
    ));
    // The drawing and UI-design panels use Qwen-Image-2.1 while a node that can build it is online;
    // their runs then queue for that model (workflowModelId), so only such a node takes them.
    const qwen21 = await store.countCapableWorkers(QWEN21_MODEL_ID, findModel(QWEN21_MODEL_ID).min_vram_mb,
      HEARTBEAT_TIMEOUT_SECONDS, workerId).catch(() => 0);
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
    await requireUser(headers);
    if (!['qwen', 'h3'].includes(kind)) throw bad('invalid LoRA kind');
    const mode = String(query.mode || 'i2v');
    const steps = Number(query.steps || 4);
    if (kind === 'h3' && (!['t2v','i2v','fl2v','r2v'].includes(mode) || !Number.isInteger(steps) || steps < 1 || steps > 100)) throw bad('invalid LoRA context');
    // A 2.1 run takes the LoRAs every 2.1 node can load, checked against its own 2.1 model.
    const engine = kind === 'qwen' && query.engine === 'qwen-2.1' ? 'qwen-2.1' : '';
    const modelId = kind === 'h3' ? 'minimax-h3' : engine ? QWEN21_MODEL_ID : 'qwen-image-2511';
    const rows = await store.listCapableModelDetails(modelId, kind === 'h3' ? 15000 : 16000, HEARTBEAT_TIMEOUT_SECONDS);
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
      if (method === 'GET' && path === '/health') {
        return ok({ ok: true, service: 'novaflow-web-control', protocol: PROTOCOL_VERSION, status: 'running' });
      }
      if (method === 'GET' && path === '/api/web/capabilities') return ok(await handleCapabilities(query));
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
function publicWorker(worker) {
  if (!worker) return null;
  return {
    id: worker.id,
    worker_name: worker.worker_name,
    status: worker.status,
    tier: normalizeNodeTier(worker.tier),
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
  async getUserById(userId: string) {
    if (!UUID_RE.test(String(userId))) return null;
    const { data, error } = await admin()
      .from('users')
      .select('id,email,display_name,role,plan,status')
      .eq('id', userId)
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

  async countCapableWorkers(modelId: string, minVramMb: number, heartbeatTimeoutSeconds: number, workerId: string | null = null, allowPremium = true) {
    const since = new Date(Date.now() - heartbeatTimeoutSeconds * 1000).toISOString();
    let query = admin()
      .from('worker_models')
      .select('worker_id, gpu_workers!inner(id,status,tier,vram_mb,last_heartbeat)')
      .eq('model_id', modelId)
      .eq('status', 'ready')
      .in('gpu_workers.status', ['idle', 'busy'])
      .gte('gpu_workers.vram_mb', minVramMb)
      .gt('gpu_workers.last_heartbeat', since);
    if (workerId) query = query.eq('worker_id', workerId);
    // A 中级账户 counts 普通 nodes alone.
    if (allowPremium === false) query = query.neq('gpu_workers.tier', 'premium');
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).length;
  },

  async listPoolWorkers() {
    const { data, error } = await admin()
      .from('gpu_workers')
      .select('id,worker_name,status,tier,gpu_name,vram_mb,last_heartbeat')
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

  async listCapableModelDetails(modelId: string, minVramMb: number, heartbeatTimeoutSeconds: number) {
    const { data, error } = await admin().from('worker_models')
      .select('detail, gpu_workers!inner(status,vram_mb,last_heartbeat)')
      .eq('model_id', modelId).eq('status', 'ready')
      .in('gpu_workers.status', ['idle', 'busy']).gte('gpu_workers.vram_mb', minVramMb)
      .gt('gpu_workers.last_heartbeat', new Date(Date.now() - heartbeatTimeoutSeconds * 1000).toISOString());
    if (error) throw error;
    return data || [];
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

  async getTask(taskId: string) {
    if (!UUID_RE.test(String(taskId || ''))) return null;
    const { data, error } = await admin()
      .from('web_ai_tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) throw error;
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

Deno.serve(async (req: Request) => {
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
    path,
    headers,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  return new Response(result.body == null ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS }
  });
});
