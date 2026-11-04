const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const Module = require('node:module');
const path = require('node:path');

// Exercise the real request handler with synthetic streams and a stub store.
// No TCP listener, production credentials, or database calls are used.
test('generic settings endpoints cannot write credit policy; other settings still work', async () => {
  const writes = [];
  const adminData = {
    readAdminEnvValue(name) { return name === 'NOVAFLOW_ADMIN_API_TOKEN' ? 'fixture-token' : ''; },
    async upsertAdminSystemSetting(value) { writes.push(value); return { ok: true, value }; }
  };
  const originalLoad = Module._load;
  let createAdminServer;
  try {
    Module._load = function(request, parent, isMain) {
      if (request === '../license-admin-gui/admin-data') return adminData;
      return originalLoad.call(this, request, parent, isMain);
    };
    ({ createAdminServer } = require('../admin-server/server.js'));
  } finally { Module._load = originalLoad; }
  const server = createAdminServer();
  async function request(method, url, value, token = 'fixture-token') {
    const req = Readable.from([Buffer.from(JSON.stringify(value))]);
    Object.assign(req, { method, url, headers: { host: '127.0.0.1', 'x-novaflow-admin-token': token } });
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.writeHead = code => { res.statusCode = code; };
    return new Promise(resolve => {
      res.end = body => resolve({ status: res.statusCode, body: JSON.parse(body) });
      server.emit('request', req, res);
    });
  }
  for (const [method, url, value] of [
    ['POST', '/api/admin/system-settings', { key: 'feature_credit_config', value: {} }],
    ['POST', '/api/admin/system-settings', { key: ' feature_credit_config ', value: {} }],
    ['PATCH', '/api/admin/system-settings/feature_credit_config', { value: {} }],
    ['PATCH', '/api/admin/system-settings/%66eature_credit_config', { value: {} }]
  ]) {
    const result = await request(method, url, value);
    assert.equal(result.status, 403);
    assert.equal(result.body.ok, false);
  }
  assert.equal(writes.length, 0);
  assert.equal((await request('POST', '/api/admin/system-settings', { key: 'other', value: 1 }, 'wrong')).status, 401);
  assert.equal(writes.length, 0);
  assert.equal((await request('POST', '/api/admin/system-settings', { key: 'other', value: 1 })).status, 200);
  assert.equal((await request('PATCH', '/api/admin/system-settings/other2', { key: 'ignored', value: 2 })).status, 200);
  assert.deepEqual(writes.map(write => write.key), ['other', 'other2']);
});

test('packaged drawing module matches maintained framework and retains reference roles', async () => {
  const generated = require('../admin-server/art-direction.js');
  const source = await import(pathToFileURL(path.resolve(__dirname, '../../../supabase/functions/novaflow-backend/art-direction.mjs')).href);
  assert.equal(generated.SCHEMA, source.SCHEMA);
  assert.equal(generated.SYSTEM, source.SYSTEM);
  const payload = { visualSchema: source.SCHEMA, currentPrompt: '保留主体，参考第二张图的风格',
    images: [{ dataUrl: 'data:image/png;base64,AA==' }, { dataUrl: 'data:image/png;base64,AQ==' }],
    artContext: { references: [{ source: 1, role: 'subject' }, { source: 2, role: 'style' }] } };
  assert.deepEqual(generated.build(payload, 'fixture-model'), source.build(payload, 'fixture-model'));
  const builder = require('../electron-builder.json');
  assert.ok(builder.files.includes('admin-server/**/*'));
  const checked = spawnSync(process.execPath, [path.resolve(__dirname, '../../tools/sync-admin-art-direction.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});
