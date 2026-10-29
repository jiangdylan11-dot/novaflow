// The Cloudflare Pages gate (deploy/_worker.js): does it serve the login shell
// to everyone, and the application code only to a browser carrying a valid,
// unexpired session cookie? Runs the worker's real fetch() against a mock
// env.ASSETS, with real nfs_ tokens minted the way the backend mints them.

import workerGate, { sessionTokenValid, isPublicPath } from '../../deploy/_worker.js';
import { base64UrlJson, hmacSha256 } from '../../packages/shared/src/tokens.mjs';
import { check, checkEqual, section, finish } from '../helpers.mjs';

const SECRET = 'gate-test-secret';

async function mintToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: 'u1', sid: 's1', email: 'a', plan: 'pro', status: 'active', iat: now, exp: now + 3600, nonce: 'n', ...overrides };
  const encoded = base64UrlJson(payload);
  return 'nfs_' + encoded + '.' + await hmacSha256(encoded, SECRET);
}

// Mock Pages ASSETS: echoes which path it was asked to serve.
const env = { NOVAFLOW_SESSION_SECRET: SECRET, ASSETS: { fetch: (req) => new Response('ASSET:' + new URL(req.url).pathname, { status: 200 }) } };
const req = (path, { cookie, accept } = {}) => new Request('https://site.pages.dev' + path, { headers: { ...(cookie ? { cookie } : {}), ...(accept ? { accept } : {}) } });
const served = async (res) => (res.status === 200 ? await res.text() : null);

section('token verification matches the backend format');
{
  check('a fresh token verifies', await sessionTokenValid(await mintToken(), SECRET) === true);
  check('an expired token is rejected', await sessionTokenValid(await mintToken({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET) === false);
  check('a token signed for another secret is rejected', await sessionTokenValid(await mintToken(), 'other-secret') === false);
  const t = await mintToken();
  const tampered = t.slice(0, -4) + (t.slice(-4) === 'aaaa' ? 'bbbb' : 'aaaa');
  check('a tampered signature is rejected', await sessionTokenValid(tampered, SECRET) === false);
  check('garbage is rejected', await sessionTokenValid('nfs_not.a.token', SECRET) === false);
  check('empty is rejected', await sessionTokenValid('', SECRET) === false);
  check('a non-nfs bearer is rejected', await sessionTokenValid('Bearer xyz', SECRET) === false);
}

section('public allow-list is exactly the login shell');
{
  for (const p of ['/', '/index.html', '/novaflow-web-runtime.js', '/novaflow-web-account.js', '/novaflow-ui-theme.css', '/foart-button-theme.css', '/foart-button-theme.js', '/assets/logo.png', '/assets/index-abc.css', '/release.json']) {
    check('public: ' + p, isPublicPath(p) === true);
  }
  for (const p of ['/novaflow-brand-runtime.js', '/spine-auto-bones.js', '/sweep-light.core.js', '/assets/index-abc.js', '/assets/particle-spine-export.js', '/templates/particle-bundled.json', '/vendor/ffmpeg/index.js', '/video-frame-edit.core.js']) {
    check('gated: ' + p, isPublicPath(p) === false);
  }
}

section('gate OFF when no secret: everything served');
{
  const open = { ASSETS: env.ASSETS };
  checkEqual('a gated module is served with no secret', await served(await workerGate.fetch(req('/spine-auto-bones.js'), open)), 'ASSET:/spine-auto-bones.js');
}

section('gate ON: shell public, code gated');
{
  checkEqual('login shell script is public', await served(await workerGate.fetch(req('/novaflow-web-account.js'), env)), 'ASSET:/novaflow-web-account.js');
  checkEqual('index is public', await served(await workerGate.fetch(req('/', { accept: 'text/html' }), env)), 'ASSET:/');

  const noCookie = await workerGate.fetch(req('/spine-auto-bones.js'), env);
  checkEqual('gated code with no cookie is 403', noCookie.status, 403);

  const bad = await workerGate.fetch(req('/spine-auto-bones.js', { cookie: 'nf_sess=nfs_bad.sig' }), env);
  checkEqual('gated code with a bad cookie is 403', bad.status, 403);

  const expired = await workerGate.fetch(req('/spine-auto-bones.js', { cookie: 'nf_sess=' + encodeURIComponent(await mintToken({ exp: Math.floor(Date.now() / 1000) - 1 })) }), env);
  checkEqual('gated code with an expired cookie is 403', expired.status, 403);

  const good = 'nf_sess=' + encodeURIComponent(await mintToken());
  checkEqual('gated code with a valid cookie is served', await served(await workerGate.fetch(req('/spine-auto-bones.js', { cookie: good }), env)), 'ASSET:/spine-auto-bones.js');
  checkEqual('the React bundle with a valid cookie is served', await served(await workerGate.fetch(req('/assets/index-abc.js', { cookie: good }), env)), 'ASSET:/assets/index-abc.js');
}

section('a logged-out navigation still gets the login screen');
{
  const nav = await workerGate.fetch(req('/anything', { accept: 'text/html' }), env);
  checkEqual('navigation falls back to index.html', await served(nav), 'ASSET:/index.html');
}

finish('pages-gate');
