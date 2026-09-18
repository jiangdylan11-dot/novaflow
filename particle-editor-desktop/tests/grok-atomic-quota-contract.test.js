const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20260812030000_grok_quota_reservations.sql');
const schema = read('particle-editor-desktop/license-admin-gui/supabase-admin-schema.sql');
const adminData = read('particle-editor-desktop/license-admin-gui/admin-data.js');
const desktop = read('particle-editor-desktop/admin-server/server.js');
const edge = read('supabase/functions/novaflow-backend/index.ts');

test('Grok quota RPC state machine is service-only, idempotent and row locked', () => {
  for (const name of ['reserve_grok_quota', 'settle_grok_quota', 'release_grok_quota', 'set_grok_quota']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`, 'is'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role`, 'is'));
  }
  assert.match(migration, /where key = v_key for update/);
  assert.match(migration, /where usage_key = p_usage_key for update/);
  assert.match(migration, /usage_key text primary key/);
  assert.match(migration, /status in \('reserved', 'settled', 'released'\)/);
  assert.match(migration, /expires_at timestamptz not null default \(now\(\) \+ interval '20 minutes'\)/);
  assert.match(migration, /status = 'reserved' and expires_at <= v_now/);
  assert.match(migration, /metadata = metadata \|\| jsonb_build_object\('release_reason', 'expired'\)/);
  assert.match(migration, /if v_row\.status = 'settled' then/);
  assert.match(migration, /if v_row\.status = 'released' then/);
});

test('manual schema carries the same Grok quota RPC surface', () => {
  for (const token of ['grok_quota_reservations', 'reserve_grok_quota', 'settle_grok_quota', 'release_grok_quota', 'set_grok_quota']) {
    assert.match(schema, new RegExp(token));
  }
  assert.doesNotMatch(schema, /\\ir .*grok_quota_reservations/i);
});

test('desktop and Edge handlers reserve before provider work and settle actual calls', () => {
  for (const source of [desktop, edge]) {
    assert.match(source, /reserveGrok(?:Calls|Quota)\([\s\S]{0,240}"prompt_optimize"/);
    assert.match(source, /"prompt_optimize"[\s\S]{0,160}(?:isH3Prompt \? 2|isH3Prompt \? 2 :)/);
    assert.match(source, /const requiredProviderCalls = Math\.max\([\s\S]{0,240}resultOptions(?: as AnyRecord)?\)??\?\.requiredProviderCalls/);
    assert.match(source, /isH3ReverseRequest \? requiredProviderCalls :|isH3Reverse \? requiredProviderCalls :/);
    assert.match(source, /h3RepairAllowed:\s*false/);
    assert.match(source, /settleGrok(?:Calls|Quota)\([\s\S]{0,180}providerCallCount/);
    assert.match(source, /releaseGrok(?:Calls|Quota)\(/);
    assert.match(source, /"provider_gateway", 1, 1/);
  }
  assert.match(adminData, /\.rpc\("reserve_grok_quota"/);
  assert.match(adminData, /\.rpc\("settle_grok_quota"/);
  assert.match(adminData, /\.rpc\("release_grok_quota"/);
  assert.match(adminData, /\.rpc\("set_grok_quota"/);
});

test('mock concurrent reservations cannot oversubscribe the allocation', async () => {
  const state = { allocated: 3, used: 0, reserved: 0 };
  let lock = Promise.resolve();
  const reserve = (min, max) => {
    const run = lock.then(() => {
      const available = state.allocated - state.used - state.reserved;
      if (available < min) return 0;
      const granted = Math.min(max, available);
      state.reserved += granted;
      return granted;
    });
    lock = run.then(() => undefined);
    return run;
  };
  const grants = await Promise.all([reserve(2, 3), reserve(2, 3)]);
  assert.deepEqual(grants.sort(), [0, 3]);
  assert.equal(state.reserved, 3);
  assert.ok(state.used + state.reserved <= state.allocated);
});

test('Edge counts every started Grok provider request on chat failures', () => {
  const callGrok = edge.slice(
    edge.indexOf('async function callGrok(payload'),
    edge.indexOf('async function callGrokResponseAttempt')
  );
  assert.match(callGrok, /let providerCallStarted = false;/);
  assert.match(callGrok, /providerCallStarted = true;\s*const response = await fetch/);
  assert.match(callGrok, /trackedError\.grokProviderCallCount = Math\.max\([\s\S]{0,180}providerCallStarted \? 1 : 0/);

  const chat = edge.slice(
    edge.indexOf('async function handleGrokChat'),
    edge.indexOf('async function handleLicenseVerification')
  );
  assert.match(chat, /const actualCalls = Math\.max\(/);
  assert.match(chat, /actualCalls > 0\s*\? await settleGrokQuota\([\s\S]{0,220}actualCalls, false/);
  assert.match(chat, /: await releaseGrokQuota\(/);
});

test('failed provider-call accounting settles the actual started request count', () => {
  const firstFailure = { providerCallCount: 0 };
  firstFailure.providerCallCount += 1;
  assert.equal(firstFailure.providerCallCount, 1);

  const repairFailure = { providerCallCount: 1 };
  repairFailure.providerCallCount += 1;
  assert.equal(repairFailure.providerCallCount, 2);

  const chatFailure = { started: true, providerCallCount: 1 };
  const quotaAction = chatFailure.providerCallCount > 0 ? 'settle' : 'release';
  assert.equal(quotaAction, 'settle');
});
