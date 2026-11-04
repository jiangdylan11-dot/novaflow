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

export function base64UrlJson(payload) {
  return toBase64Url(enc.encode(JSON.stringify(payload)));
}

export function decodeBase64UrlJson(value) {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(value)));
}

async function subtle() {
  if (typeof globalThis.crypto?.subtle?.importKey === 'function') return globalThis.crypto.subtle;
  const { webcrypto } = await import('node:crypto');
  return webcrypto.subtle;
}

export async function hmacSha256(message, secret) {
  const api = await subtle();
  const key = await api.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await api.sign('HMAC', key, enc.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

export async function sha256Hex(message) {
  const api = await subtle();
  const digest = await api.digest('SHA-256', enc.encode(message));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish compare. Both sides are base64url of a fixed-length MAC, so
// length equality is not itself a secret.
export function safeCompare(a, b) {
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

export function randomId(prefix) {
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
export async function verifySessionToken(token, sessionSecret) {
  if (!sessionSecret) throw new Error('session secret is not configured');
  const payload = await verifyEnvelope('nfs_', token, sessionSecret);
  if (!payload.sub) throw new Error('invalid token');
  return payload;
}

// ---------------------------------------------------------------------------
// nfw_ - worker identity.
// ---------------------------------------------------------------------------
export async function issueWorkerToken(worker, controlSecret, ttlSeconds = 3600) {
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

export async function verifyWorkerToken(token, controlSecret) {
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
export async function resolveControlSecret({ controlSecret, sessionSecret } = {}) {
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
export async function deriveWorkerGrantKey(workerId, controlSecret) {
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

export async function issueGrantToken(input, grantKey) {
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

export async function verifyGrantToken(token, grantKey, expect = {}) {
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
export async function issueH3DownloadProof(input,controlSecret) {
  const iat=nowSeconds();
  if(!Number.isSafeInteger(input?.sessionExpiresAt) || !Number.isSafeInteger(input?.resultExpiresAt))
    throw new Error('invalid H3 download expiry');
  const payload={kind:'h3-download-proof-v1',aud:'novaflow-web-h3-download',sub:input.userId,sid:input.sessionId,
    task:input.taskId,wid:input.workerId,attempt:input.attempt,ownership_generation:input.ownershipGeneration,file:input.file,
    iat,exp:Math.min(iat+60,input.sessionExpiresAt,input.resultExpiresAt)};
  validateH3DownloadProof(payload);
  return await signEnvelope('nfh_',payload,await h3DownloadProofKey(controlSecret));
}
export async function verifyH3DownloadProofSignature(token,controlSecret) {
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

export async function issueQwenRotationProof(input, controlSecret) {
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
export async function verifyQwenRotationProofSignature(token, controlSecret) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('invalid candidate proof');
  const payload = await verifyEnvelope(QWEN_ROTATION_PROOF_PREFIX,token,await rotationProofKey(controlSecret));
  if (!validRotationProofFields(payload) || payload.iat > nowSeconds()) throw new Error('invalid candidate proof');
  return payload;
}

// ---------------------------------------------------------------------------
// Worker secret hashing. The control plane stores only the hash, so a database
// read never yields a usable worker credential.
// ---------------------------------------------------------------------------
export async function hashWorkerSecret(workerId, secret) {
  return await sha256Hex('novaflow-worker-secret:v1:' + String(workerId) + ':' + String(secret));
}

export function generateWorkerSecret() {
  const bytes = new Uint8Array(32);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return toBase64Url(bytes);
}

export function bearerToken(headerValue) {
  const auth = String(headerValue || '');
  return /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : '';
}
