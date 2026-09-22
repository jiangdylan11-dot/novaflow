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

export async function verifyWorkerToken(token, controlSecret) {
  const payload = await verifyEnvelope('nfw_', token, controlSecret);
  if (payload.kind !== 'worker' || !payload.wid) throw new Error('invalid token');
  return payload;
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
export async function issueGrantToken(input, grantKey) {
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

export async function verifyGrantToken(token, grantKey, expect = {}) {
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
