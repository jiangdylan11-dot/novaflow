const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const owner = '11111111-1111-4111-8111-111111111111';
const guest = '22222222-2222-4222-8222-222222222222';
const payload = () => ({ id: 'node-one', owner_id: owner, enabled: true, owner_enabled: true,
  sharing_enabled: false, sharing_scope: 'selected', allowed_user_ids: [guest] });

function fixture({ error, missing = false } = {}) {
  const filename = path.resolve(__dirname, '../license-admin-gui/admin-data.js');
  const realRequire = createRequire(filename);
  const writes = [];
  const client = { from(table) {
    assert.equal(table, 'gpu_workers');
    const query = { update(row) { this.row = JSON.parse(JSON.stringify(row)); return this; },
      eq(column, id) { assert.equal(column, 'id'); this.id = id; return this; }, select() { return this; },
      async maybeSingle() { writes.push({ ...this.row, id: this.id }); return { data: missing ? null : { ...this.row, id: this.id }, error }; } };
    return query;
  } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
    console: { log() {}, warn() {} }, process: { env: { NOVAFLOW_SUPABASE_URL: 'https://fixture.supabase.co', NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' }, platform: 'win32' },
    require: (name) => name === '@supabase/supabase-js' ? { createClient: () => client } : realRequire(name)
  }, { filename });
  return { api: module.exports, writes };
}

test('node enable/disable never overwrites the worker heartbeat status', async () => {
  const { api, writes } = fixture();
  assert.equal((await api.setAdminGpuWorkerStatus({ id: 'node-one', status: 'maintenance' })).ok, true);
  assert.equal((await api.setAdminGpuWorkerStatus({ id: 'node-one', status: 'idle' })).ok, true);
  assert.equal(writes[0].enabled, false);
  assert.equal(writes[1].enabled, true);
  assert.equal(writes.some((row) => 'status' in row), false);
});

test('private owner use and selected sharing are saved independently', async () => {
  const { api, writes } = fixture();
  const privatePolicy = payload();
  const saved = await api.setAdminGpuWorkerAccessPolicy(privatePolicy);
  assert.equal(saved.ok, true);
  assert.equal(writes[0].owner_enabled, true);
  assert.equal(writes[0].sharing_enabled, false);
  assert.equal(writes[0].owner_id, owner);
  const sharedPolicy = { ...privatePolicy, owner_enabled: false, sharing_enabled: true, allowed_user_ids: [guest, guest] };
  assert.equal((await api.setAdminGpuWorkerAccessPolicy(sharedPolicy)).ok, true);
  assert.deepEqual(writes[1].allowed_user_ids, [guest]);
  assert.equal(writes[1].owner_enabled, false);
  assert.equal(writes[1].sharing_scope, 'selected');
});

test('invalid or incomplete policy cannot reach the database', async () => {
  const { api, writes } = fixture();
  for (const patch of [
    { enabled: 'false' }, { owner_id: null }, { owner_id: null, owner_enabled: false }, { sharing_scope: 'all' },
    { allowed_user_ids: ['invalid'] }, { sharing_enabled: true, allowed_user_ids: [] }
  ]) {
    assert.equal((await api.setAdminGpuWorkerAccessPolicy({ ...payload(), ...patch })).status, 'error');
  }
  assert.equal(writes.length, 0);
});

test('missing migration and missing node never report successful saves', async () => {
  const migrated = fixture({ error: { message: "Could not find the 'sharing_enabled' column in schema cache" } });
  const result = await migrated.api.setAdminGpuWorkerAccessPolicy(payload());
  assert.equal(result.status, 'error'); assert.match(result.error, /数据库迁移/); assert.notEqual(result.ok, true);
  const missing = fixture({ missing: true });
  assert.equal((await missing.api.setAdminGpuWorkerAccessPolicy(payload())).status, 'error');
  assert.equal((await missing.api.setAdminGpuWorkerStatus({ id: 'node-one', status: 'idle' })).status, 'error');
});
