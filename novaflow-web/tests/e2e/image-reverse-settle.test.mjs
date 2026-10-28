// Cloud image reverse, including AIFX material, must settle once and still return
// the success body. A ReferenceError after settle used to charge the user and
// then answer 500.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const SECRET = 'phase-d-test-session-secret-32chars';
process.env.NOVAFLOW_SESSION_SECRET = SECRET;
process.env.NOVAFLOW_RUNNINGHUB_API_KEY = 'rh-test-key-not-real';
process.env.NOVAFLOW_RUNNINGHUB_LLM_MODEL = 'xai/grok-4.7';
process.env.NOVAFLOW_ADMIN_SERVER_ENV = 'development';
process.env.NOVAFLOW_ADMIN_SERVER_REQUEST_LOGS = '0';

const require = createRequire(import.meta.url);
const adminData = require('../../admin/license-admin-gui/admin-data.js');
const { createAdminServer } = require('../../admin/admin-server/server.js');

const USER = '11111111-1111-4111-8111-111111111111';
const MATERIAL = { name: 'PETAL', material: 'soft petals', elements: 'petals', colours: 'red', breakup: 'sheds' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

function sessionToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: USER, email: 'acct_phase_d@accounts.novaflow.local', plan: 'trial', status: 'active', iat: now, exp: now + 3600, nonce: 'test-nonce' };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return `nfs_${encoded}.${signature}`;
}

test('AIFX cloud material reverse settles once and returns the success body', async () => {
  const rpc = [];
  adminData.callFeatureCreditRpc = async (name, args) => {
    rpc.push({ name, feature: args?.p_feature, units: args?.p_units ?? args?.p_actual_units ?? null });
    if (name === 'reserve_feature_credits') return { status: 'reserved', idempotent: false, units: 1, estimated_credits: 4, feature: 'image_reverse' };
    if (name === 'settle_feature_credits') return { status: 'settled', settled_credits: 4, balance_after: 96, estimated_credits: 4, feature: 'image_reverse' };
    if (name === 'release_feature_credits') return { status: 'released', settled_credits: 0, balance_after: 100, feature: 'image_reverse' };
    throw new Error('unexpected credit rpc ' + name);
  };
  adminData.getAdminUserById = async () => ({
    status: 'ok',
    record: { id: USER, email: 'acct_phase_d@accounts.novaflow.local', status: 'active', role: 'user', plan: 'trial', display_name: 'phase-d' }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('127.0.0.1')) return originalFetch(url, init);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'rh-req-1' },
      text: async () => JSON.stringify({
        id: 'chatcmpl-aifx',
        model: 'xai/grok-4.7',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(MATERIAL) } }],
        usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 }
      })
    };
  };
  const server = createAdminServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/client/grok/image-reverse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken()}` },
      body: JSON.stringify({ surface: 'aifx', purpose: 'aifx-material', images: [{ name: 'reference.jpg', dataUrl: PNG }] })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.material.material, 'soft petals');
    assert.deepEqual(Object.keys(body.material).sort(), ['breakup', 'colours', 'elements', 'material', 'name']);
    assert.equal(body.model, 'xai/grok-4.7');
    assert.equal(body.quota.charged_credits, 4);
    assert.equal(body.quota.balance_after, 96);
    assert.equal(body.grok.providerCallCount, 1);
    assert.deepEqual(rpc.map((call) => call.name), ['reserve_feature_credits', 'settle_feature_credits']);
    assert.equal(rpc.filter((call) => call.name === 'settle_feature_credits').length, 1);
    assert.equal(rpc[0].feature, 'image-reverse');
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await once(server, 'close');
  }
});
