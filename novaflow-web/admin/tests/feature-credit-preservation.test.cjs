const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture({ readFails = false, race = false, disconnected = false, rpcMissing = false } = {}) {
  const filename = path.resolve(__dirname, '../license-admin-gui/admin-data.js');
  const realRequire = createRequire(filename);
  let value = {
    prices: { local: 0, online_chat_turn: 4, future_feature: 77 },
    credits_per_usd: 211,
    token_billing: { markup: 2, round: 'floor', future_field: 31, estimate_credits: { '1k': { standard: 5, future_quality: 88 } } },
    gpt_image: { future_route: 'keep' },
    xiaotao_online: { markup: 1.5, billing_scope: 'operation', minimum_positive_credits: 1, model_rates: { future_model: { input: 3 } }, version: 'v3' },
    future_snapshot: { preserve: true }
  };
  let writes = 0;
  const client = {
    from() {
      let action, record, compared;
      const q = {
        select() { return q; },
        eq(name, v) { if (name === 'value') compared = v; return q; },
        update(v) { action = 'update'; record = v; return q; },
        insert(v) { action = 'insert'; record = v; return q; },
        async maybeSingle() {
          if (!action) return readFails ? { error: new Error('read failed') } : { data: { value: structuredClone(value) } };
          if (race) value.xiaotao_online.model_rates.future_model.input = 8;
          if (action === 'update' && JSON.stringify(value) !== compared) return { data: null };
          writes++; value = structuredClone(record.value);
          return { data: { key: 'feature_credit_config' } };
        }
      };
      return q;
    },
    async rpc(name, args) {
      if (name === 'credit_ledger_estimated_rh_cost') return { data: null };
      assert.equal(name, 'foart_update_feature_credit_config_candidate_v1');
      if (rpcMissing) return { error: { code: 'PGRST202' } };
      if (race) value.xiaotao_online.model_rates.future_model.input = 8;
      if (JSON.stringify(value) !== JSON.stringify(args.p_expected)) return { error: { code: '40001' } };
      writes++; value = structuredClone(args.p_next);
      return { data: { key: 'feature_credit_config', value: args.p_next } };
    }
  };
  const module = { exports: {} };
  const env = disconnected ? {} : { NOVAFLOW_SUPABASE_URL: 'https://fixture.invalid', NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process: { env, platform: 'linux' },
    console: { log() {}, warn() {} },
    require: name => name === '@supabase/supabase-js' ? { createClient: () => client } : realRequire(name)
  }, { filename });
  return { api: module.exports, getValue: () => value, getWrites: () => writes,
    async revision() { return (await module.exports.getFeatureCreditAdmin()).configRevision; } };
}

test('saving edited fields preserves operation policy, future fields, rates and nested settings', async () => {
  const f = fixture();
  const before = structuredClone(f.getValue());
  await f.api.saveFeatureCreditAdmin({ config_revision: await f.revision(), prices: { online_chat_turn: 9 }, token_billing: { markup: 3 }, gpt_image: { text_model: 'model' } });
  const result = f.getValue();
  assert.equal(result.prices.online_chat_turn, 9);
  assert.equal(result.prices.future_feature, 77);
  assert.equal(result.token_billing.markup, 3);
  assert.equal(result.token_billing.round, 'floor');
  assert.deepEqual(result.token_billing.estimate_credits, before.token_billing.estimate_credits);
  assert.equal(result.token_billing.future_field, 31);
  assert.equal(result.gpt_image.future_route, 'keep');
  assert.deepEqual(result.xiaotao_online, before.xiaotao_online);
  assert.deepEqual(result.future_snapshot, before.future_snapshot);
  assert.equal(result.credits_per_usd, 211);
  assert.equal(f.getWrites(), 1);
});

test('unreadable or concurrently changed configuration is never replaced', async () => {
  for (const options of [{ readFails: true }, { race: true }, { disconnected: true }]) {
    const f = fixture(options);
    await assert.rejects(f.api.saveFeatureCreditAdmin({ config_revision: await f.revision(), prices: { online_chat_turn: 9 } }));
    assert.equal(f.getWrites(), 0);
  }
});

test('the admin cannot manufacture operation-level billing flags from its payload', async () => {
  const f = fixture();
  const before = structuredClone(f.getValue().xiaotao_online);
  await f.api.saveFeatureCreditAdmin({ config_revision: await f.revision(), xiaotao_online: { billing_scope: 'request', minimum_positive_credits: 8 }, token_billing: { xiaotao_online: { markup: 99 } } });
  assert.deepEqual(f.getValue().xiaotao_online, before);
  assert.equal(f.getValue().token_billing.xiaotao_online, undefined);
});

test('form loaded before a change and legacy clients without a revision fail closed', async () => {
  const f = fixture();
  const revision = await f.revision();
  f.getValue().credits_per_usd = 250;
  await assert.rejects(f.api.saveFeatureCreditAdmin({ config_revision: revision, credits_per_usd: 211 }), /刷新/);
  await assert.rejects(f.api.saveFeatureCreditAdmin({ credits_per_usd: 211 }), /版本过旧/);
  assert.equal(f.getValue().credits_per_usd, 250);
  assert.equal(f.getWrites(), 0);
});

test('editing the global exchange rate commits with the full configuration through CAS', async () => {
  const f=fixture(), before=structuredClone(f.getValue());
  await f.api.saveFeatureCreditAdmin({config_revision:await f.revision(),credits_per_usd:250,prices:{online_chat_turn:9}});
  assert.equal(f.getValue().credits_per_usd,250);assert.equal(f.getValue().prices.online_chat_turn,9);
  assert.deepEqual(f.getValue().xiaotao_online,before.xiaotao_online);assert.equal(f.getValue().token_billing.round,'floor');assert.equal(f.getWrites(),1);
});

test('missing or raced CAS never claims the exchange rate was saved', async () => {
  for(const options of [{rpcMissing:true},{race:true}]) {
    const f=fixture(options), revision=await f.revision();
    await assert.rejects(f.api.saveFeatureCreditAdmin({config_revision:revision,credits_per_usd:250}));
    assert.equal(f.getValue().credits_per_usd,211);assert.equal(f.getWrites(),0);
  }
});

test('explicit invalid prices and multipliers are rejected before any write', async () => {
  const invalid = [
    { credits_per_usd: -1 }, { credits_per_usd: 'not a number' },
    { token_billing: { markup: -1 } }, { token_billing: { markup: 'bad' } },
    { token_billing: { settle_cap_credits: 1.4 } },
    { token_billing: { estimate_credits: { '1k': { low: 1.4 } } } },
    { prices: { online_chat_turn: -0.4 } }, { prices: { online_chat_turn: 1.4 } }
  ];
  for (const patch of invalid) {
    const f = fixture();
    await assert.rejects(f.api.saveFeatureCreditAdmin({ config_revision: await f.revision(), ...patch }), /无效/);
    assert.equal(f.getWrites(), 0);
  }
});

test('stored invalid prices cannot be presented as normalized defaults or saved', async () => {
  const f = fixture();
  f.getValue().credits_per_usd = -3;
  const response = await f.api.getFeatureCreditAdmin();
  assert.match(response.error, /无效/);
  assert.equal(response.configRevision, undefined);
  await assert.rejects(f.api.saveFeatureCreditAdmin({ config_revision: 'absent', prices: { online_chat_turn: 9 } }));
  assert.equal(f.getWrites(), 0);
});

test('valid zero prices and omitted optional values retain existing behaviour', async () => {
  const f = fixture();
  await f.api.saveFeatureCreditAdmin({ config_revision: await f.revision(), prices: { online_chat_turn: 0 }, token_billing: { markup: 2.5 } });
  assert.equal(f.getValue().prices.online_chat_turn, 0);
  assert.equal(f.getValue().token_billing.markup, 2.5);
  assert.equal(f.getWrites(), 1);
});

test('blank optional prices preserve existing values instead of resetting defaults', async () => {
  const f = fixture(), before = structuredClone(f.getValue());
  await f.api.saveFeatureCreditAdmin({ config_revision: await f.revision(), credits_per_usd: '', prices: { online_chat_turn: '' }, token_billing: { markup: '', estimate_credits: { '1k': { standard: '' } } } });
  assert.equal(f.getValue().credits_per_usd, before.credits_per_usd);
  assert.equal(f.getValue().prices.online_chat_turn, before.prices.online_chat_turn);
  assert.equal(f.getValue().token_billing.markup, before.token_billing.markup);
  assert.equal(f.getValue().token_billing.estimate_credits['1k'].standard, before.token_billing.estimate_credits['1k'].standard);
});
