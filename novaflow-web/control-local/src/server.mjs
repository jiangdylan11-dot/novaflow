// Local NovaFlow Web control plane.
//
// Serves the exact API the Supabase edge function serves, backed by PGlite
// running the real migrations. Two jobs:
//   1. Development and acceptance without touching the production project.
//   2. The environment the E2E suite runs against, so every test exercises the
//      production SQL rather than a stub.
//
// It also mints nfs_ session tokens for LOCAL users only. In production those
// come from the existing novaflow-backend and this code path is not deployed.

import { createServer } from 'node:http';
import { createDatabase, seedUser, seedProviderBudget } from './db.mjs';
import { createPgStore } from './pg-store.mjs';
import { createControlPlane } from '../../packages/shared/src/control-plane.mjs';
import { normalizePlan } from '../../packages/shared/src/protocol.mjs';
import { base64UrlJson, hmacSha256, sha256Hex, resolveControlSecret } from '../../packages/shared/src/tokens.mjs';

const DEFAULT_PORT = Number(process.env.NOVAFLOW_WEB_CONTROL_PORT || 4890);
const SESSION_SECRET = process.env.NOVAFLOW_SESSION_SECRET || 'local-dev-session-secret-change-me';
// Optional, exactly as in production: derived from the session secret when it
// is not set, so the two deployments behave the same way.
const CONTROL_SECRET_ENV = process.env.NOVAFLOW_WEB_CONTROL_SECRET || '';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-novaflow-grant, range',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'content-range, accept-ranges, content-length'
};

/** Mint a session token byte-compatible with novaflow-backend's issueSessionToken. */
export async function mintLocalSessionToken(user, ttlSeconds = 86400, secret = SESSION_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(user.id),
    email: String(user.email || ''),
    plan: String(user.plan || 'trial'),
    status: String(user.status || 'active'),
    iat: now,
    exp: now + ttlSeconds,
    nonce: 'local-' + now + '-' + Math.random().toString(36).slice(2)
  };
  const encoded = base64UrlJson(payload);
  const signature = await hmacSha256(encoded, secret);
  return 'nfs_' + encoded + '.' + signature;
}

async function readBody(req, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('request body must be JSON');
  }
}

export async function createLocalControlPlane({ verbose = false } = {}) {
  const db = await createDatabase({ verbose });
  const store = createPgStore(db);
  await seedProviderBudget(db, { providerKey: 'comfyui', balance: 1_000_000 });
  const controlSecret = await resolveControlSecret({
    controlSecret: CONTROL_SECRET_ENV,
    sessionSecret: SESSION_SECRET
  });
  const plane = createControlPlane({
    store,
    secrets: { sessionSecret: SESSION_SECRET, controlSecret },
    logger: verbose ? (msg, meta) => console.log('[control] ' + msg, meta || '') : undefined
  });
  return { db, store, plane, sessionSecret: SESSION_SECRET, controlSecret };
}

// Ports fetch() refuses to talk to. Undici (and every browser) keeps a list of
// "unsafe" ports - ancient protocols that a redirect could be used to attack -
// and asking for port 0 occasionally lands on one. The result is a suite that
// passes ten times and then dies with "TypeError: fetch failed / bad port",
// which looks like a bug in whatever was being tested.
const UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080
]);

/**
 * Listen, and when the OS hands back a port fetch will not use, try again.
 *
 * Only applies to an ephemeral request (port 0). An explicit port is honoured
 * as asked - if someone names a blocked port, that is worth an error, not a
 * silent move somewhere else.
 */
async function listenOnUsablePort(server, port, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const chosen = server.address().port;
    if (port !== 0 || !UNSAFE_PORTS.has(chosen)) return chosen;
    await new Promise((resolve) => server.close(resolve));
  }
  throw new Error('could not get a port fetch() will talk to after ' + attempts + ' tries');
}

export async function startLocalControlPlane({ port = DEFAULT_PORT, verbose = false } = {}) {
  const ctx = await createLocalControlPlane({ verbose });

  const server = createServer(async (req, res) => {
    const send = (status, body, extraHeaders = {}) => {
      const payload = body == null ? '' : JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...CORS_HEADERS,
        ...extraHeaders
      });
      res.end(payload);
    };

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const url = new URL(req.url, 'http://127.0.0.1');

      const query = Object.fromEntries(url.searchParams.entries());

      // Local-only helper so a developer can get a session without standing up
      // the production auth stack. Never part of the deployed edge function.
      // The session is a 高级账户 (pro) unless the caller asks for another plan,
      // so a developer can create shared tasks straight away.
      if (req.method === 'POST' && url.pathname === '/dev/login') {
        const body = await readBody(req, 16 * 1024);
        const email = String(body.email || 'demo@novaflow.local');
        const user = await seedUser(ctx.db, {
          email,
          balance: Number.isFinite(Number(body.balance)) ? Number(body.balance) : 1000,
          displayName: String(body.display_name || 'NovaFlow Demo'),
          plan: body.plan ? normalizePlan(body.plan) : 'pro'
        });
        const token = await mintLocalSessionToken(user);
        const balance = await ctx.store.getCreditBalance(user.id);
        send(200, { ok: true, user, session: { token }, credits: { balance } });
        return;
      }

      // Local-only helper: mint a worker registration code for an owner.
      if (req.method === 'POST' && url.pathname === '/dev/registration-code') {
        const body = await readBody(req, 16 * 1024);
        const user = await ctx.store.getUserByEmail(String(body.email || 'demo@novaflow.local'));
        if (!user) { send(404, { ok: false, error: 'unknown user' }); return; }
        const code = 'NFW-' + Math.random().toString(36).slice(2, 8).toUpperCase() +
                     '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        const codeHash = await sha256Hex('novaflow-web-registration-code:v1:' + code);
        await ctx.store.createRegistrationCode({
          ownerId: user.id,
          codeHash,
          label: String(body.label || ''),
          maxUses: Number(body.max_uses) || 1,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          tier: String(body.tier || '') === 'premium' ? 'premium' : 'standard'
        });
        send(200, { ok: true, registration_code: code });
        return;
      }

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? await readBody(req, 256 * 1024)
        : {};

      const result = await ctx.plane.handle({
        method: req.method,
        path: url.pathname,
        headers: req.headers,
        query,
        body
      });
      send(result.status, result.body);
    } catch (error) {
      send(400, { ok: false, error: String(error?.message || error) });
    }
  });

  await listenOnUsablePort(server, port);
  const address = 'http://127.0.0.1:' + server.address().port;
  return { ...ctx, server, port: server.address().port, url: address };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  startLocalControlPlane({ verbose: true }).then((ctx) => {
    console.log('NovaFlow Web control plane (local) listening on ' + ctx.url);
    console.log('  POST /dev/login                {"email":"demo@novaflow.local","balance":1000}');
    console.log('  POST /dev/registration-code    {"email":"demo@novaflow.local"}');
  }).catch((error) => {
    console.error('control plane failed to start:', error);
    process.exit(1);
  });
}
