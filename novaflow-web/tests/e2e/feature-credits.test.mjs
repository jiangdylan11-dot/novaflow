import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';
import {
  collectPages,
  creditsFromRemainingCount,
  LEDGER_STATUSES,
  ledgerCsv,
  ledgerUserLookup,
  lowBalanceState,
  normalizeCreditConfig,
  quoteFeature
} from '../../packages/shared/src/feature-credits.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const webRoot = resolve(here, '../..');

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(await readFile(join(webRoot, 'control-local/src/bootstrap.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20260812030000_grok_quota_reservations.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028010000_settle_grok_quota_failure_does_not_charge.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028140000_feature_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028140000_feature_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028150000_admin_adjust_feature_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028160000_users_plan_team_to_pro.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028160000_users_plan_team_to_pro.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028170000_token_settle_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028170000_token_settle_credits.sql'), 'utf8'));
  return db;
}

async function addUser(db, email, balance = 100) {
  const user = (await db.query(
    'insert into public.users (email, display_name, status) values ($1, $2, $3) returning id',
    [email, email, 'active']
  )).rows[0];
  await db.query('insert into public.credits (user_id, balance) values ($1, $2)', [user.id, balance]);
  return user;
}

function num(value) {
  return Number(value);
}

test('recommended prices, empty renminbi rate, and low-balance threshold', async () => {
  const config = normalizeCreditConfig(undefined);
  assert.equal(config.credits_to_cny, null);
  assert.equal(config.low_balance_usd, 2);
  assert.equal(config.prices.local, 0);
  assert.equal(quoteFeature({ feature: 'xiaotao-vision' }).credits, 4);
  assert.equal(quoteFeature({ feature: 'prompt-optimize', units: 2 }).credits, 4);
  assert.equal(quoteFeature({ feature: 'image-reverse' }).credits, 4);
  assert.equal(quoteFeature({ feature: 'image-reverse', units: 3 }).credits, 4);
  assert.equal(quoteFeature({ feature: 'aifx-material' }).feature, 'image_reverse');
  assert.equal(quoteFeature({ feature: 'aifx-material' }).credits, 4);
  assert.equal(quoteFeature({ feature: 'video-reverse' }).credits, 4);
  assert.equal(quoteFeature({ feature: 'ui-catalog' }).credits, 14);
  assert.equal(quoteFeature({ feature: 'gpt_image_2_5_economy', units: 3 }).credits, 60);
  assert.equal(quoteFeature({ feature: 'gpt-image-2' }).credits, 4);
  assert.equal(quoteFeature({ feature: 'g-4.2', units: 2 }).credits, 12);
  assert.equal(quoteFeature({ feature: 'local_qwen', units: 4 }).credits, 0);
  assert.equal(quoteFeature({ feature: 'local_qwen' }).local, true);
  assert.equal(quoteFeature({ feature: 'gpt_image_2_5_token' }).unpriced, true);
  assert.equal(quoteFeature({ feature: 'xiaotao_vision' }).rhCostUsd, 0.0073);
  assert.equal(creditsFromRemainingCount(1, 2.3), 3);
  assert.equal(creditsFromRemainingCount(100, 4), 400);
  assert.equal(lowBalanceState({ remainMoney: 1.5, currency: 'USD' }).blocked, true);
  assert.equal(lowBalanceState({ remainMoney: 2, currency: 'USD' }).blocked, false);
  assert.equal(lowBalanceState({ remainMoney: 10, currency: 'CNY' }).blocked, true);
  assert.equal(lowBalanceState({ remainMoney: 15, currency: 'CNY' }).blocked, false);
  assert.equal(lowBalanceState({ remainMoney: 10, currency: 'CNY', thresholdCny: 5 }).blocked, false);
  assert.equal(lowBalanceState({ remainMoney: 0, currency: 'CNY' }).blocked, true);
  const fresh = new Date().toISOString();
  assert.equal(lowBalanceState({ cache: true, remainMoney: 1.5, currency: 'USD', checkedAt: fresh }).blocked, true);
  const staleCache = lowBalanceState({ cache: true, remainMoney: 0, currency: 'CNY', checkedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
  assert.equal(staleCache.blocked, false);
  assert.equal(staleCache.warn, true);
  assert.equal(staleCache.stale, true);
  assert.equal(lowBalanceState({ cache: true, remainMoney: 0, currency: 'USD', stalePolicy: 'block' }).blocked, true);
  assert.equal(normalizeCreditConfig(undefined).low_balance_cny, 15);
  assert.equal(normalizeCreditConfig(undefined).balance_ttl_seconds, 600);
  assert.equal(normalizeCreditConfig(undefined).stale_balance_policy, 'allow');
  assert.deepEqual(Object.keys(LEDGER_STATUSES), ['reserved', 'settled', 'released']);
  assert.match(LEDGER_STATUSES.released, /hold was returned/);
  assert.equal(ledgerUserLookup('ada').email, 'ada@accounts.novaflow.local');
  assert.equal(ledgerUserLookup('ada').displayName, 'ada');
  const pages = await collectPages(async ({ offset }) => (offset >= 1000 ? [{ id: offset }] : Array.from({ length: 500 }, (_, index) => ({ id: offset + index }))));
  assert.equal(pages.length, 1001);
  const overridden = quoteFeature({ feature: 'prompt_optimize', prices: { prices: { prompt_optimize: 9 } } });
  assert.equal(overridden.credits, 9);
  assert.equal(normalizeCreditConfig({ prices: { local: 12 } }).prices.local, 0);
});

test('browser price card matches the charge card', async () => {
  const source = await readFile(join(webRoot, 'renderer/feature-credit-prices.js'), 'utf8');
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  runInContext(source, createContext(sandbox));
  const api = sandbox.NovaFlowFeatureCreditPrices;
  for (const [feature, units] of [['prompt-optimize', 2], ['gpt_image_2_5_economy', 3], ['g-4.2', 2], ['local-flash', 1], ['image_reverse', 1], ['aifx-material', 1]]) {
    assert.equal(api.quoteFeature({ feature, units }).credits, quoteFeature({ feature, units }).credits, feature);
  }
  api.applyConfig({ prices: { gpt_image_2_5_economy: 30 }, low_balance_usd: 2, credits_to_cny: null });
  assert.equal(api.quoteFeature({ feature: 'gpt_image_2_5_economy', units: 2 }).credits, 60);
  assert.equal(api.quoteFeature({ feature: 'local' }).credits, 0);
  api.applyConfig({ prices: { prompt_optimize: 9 } });
  assert.equal(api.previewText('prompt_optimize', 1), '本次将扣 9 积分');
  api.applyConfig(null);
  assert.equal(api.previewText('prompt_optimize', 1), '本次将扣 4 积分');
  assert.equal(api.previewText('lean_research', 1), '本次将扣 14 积分');
  assert.equal(api.previewText('image_reverse', 3), '本次将扣 4 积分');
  assert.equal(api.previewText('local'), '本地处理不扣积分');
  assert.equal(api.settlementText({ charged_credits: 4, balance_after: 96 }), '实扣 4 积分，剩余 96');
  assert.equal(api.settlementText({ settled_credits: 14, balance_after: 0 }), '实扣 14 积分，剩余 0');
  assert.equal(api.settlementText({ settled_credits: 0, balance_after: 100 }), '');
  assert.equal(api.settlementText({ local: true, charged_credits: 0 }), '');
});

test('charge releases on failure and moderation, skips local work, and blocks a low pool before reserve', async () => {
  const calls = [];
  const charge = createOnlineAiCharge({
    reserve: async (input) => { calls.push(['reserve', input.feature, input.amount, input.credits]); return { status: 'reserved', idempotent: false, amount: input.amount }; },
    settle: async (input) => { calls.push(['settle', input.feature, input.amount]); return { settled_credits: 4, balance_after: 96 }; },
    release: async (input) => { calls.push(['release', input.feature, input.reason]); return { settled_credits: 0 }; }
  });
  const done = await charge({ userId: 'user', feature: 'prompt-optimize', amount: 2, usageKey: 'use-1', run: async ({ amount }) => ({ amount: 1, value: amount }) });
  assert.equal(done.value, 2);
  assert.deepEqual(calls, [['reserve', 'prompt-optimize', 2, 4], ['settle', 'prompt-optimize', 1]]);
  calls.length = 0;
  await assert.rejects(
    charge({ userId: 'user', feature: 'image-reverse', amount: 1, usageKey: 'use-2', run: async () => { throw new Error('在线模型暂时不可用'); } }),
    (error) => error.message === '在线模型暂时不可用'
  );
  assert.deepEqual(calls, [['reserve', 'image-reverse', 1, 4], ['release', 'image-reverse', 'incomplete']]);
  const moderated = await charge({ userId: 'user', feature: 'prompt-optimize', amount: 1, usageKey: 'use-3', run: async () => ({ success: false, moderation: true, amount: 1 }) });
  assert.equal(moderated.success, false);
  assert.equal(calls.filter((call) => call[0] === 'settle').length, 0);
  calls.length = 0;
  const local = await charge({ userId: 'user', feature: 'local_qwen', amount: 1, usageKey: 'local-1', run: async () => ({ value: 'ok' }) });
  assert.equal(local.value, 'ok');
  assert.equal(local.quota.charged_credits, 0);
  assert.deepEqual(calls, []);
  await assert.rejects(
    charge({ userId: 'user', feature: 'xiaotao-vision', amount: 1, usageKey: 'pool-1', pool: { remainMoney: 1.25, currency: 'USD', thresholdUsd: 2 }, run: async () => ({ value: 'no' }) }),
    (error) => error.message === '云服务余额不足，请联系管理员' && error.statusCode === 402
  );
  assert.deepEqual(calls, []);
});

test('feature credit RPCs hold the balance, release on failure, and mirror the old quota table', async () => {
  const db = await database();
  const user = await addUser(db, 'credits@novaflow.local', 100);
  await db.query('select public.set_grok_quota($1, 0, $2, $3::jsonb)', [user.id, 'empty', '{}']);

  const reserved = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, $4, $5, $6::jsonb) as row',
    [user.id, 'use-vision', 'xiaotao-vision', 1, 'xai/grok-4.7', '{}']
  )).rows[0].row;
  assert.equal(reserved.status, 'reserved');
  assert.equal(num(reserved.estimated_credits), 4);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 96);
  const mirror = (await db.query('select status, reserved_calls from public.grok_quota_reservations where usage_key = $1', ['use-vision'])).rows[0];
  assert.equal(mirror.status, 'reserved');
  assert.equal(num(mirror.reserved_calls), 1);

  const images = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, $4, null, $5::jsonb) as row',
    [user.id, 'use-images', 'gpt_image_2_5_economy', 2, '{}']
  )).rows[0].row;
  assert.equal(num(images.estimated_credits), 40);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 56);

  const replay = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, $4, null, $5::jsonb) as row',
    [user.id, 'use-vision', 'xiaotao-vision', 1, '{}']
  )).rows[0].row;
  assert.equal(replay.idempotent, true);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 56);

  await assert.rejects(
    db.query('select public.reserve_feature_credits($1, $2, $3, 3, null, $4::jsonb)', [user.id, 'use-broke', 'gpt_image_2_5_economy', '{}']),
    /积分不足/
  );
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 56);

  const settled = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, $4, $5::jsonb) as row',
    [user.id, 'use-vision', 'xiaotao-vision', 'xai/grok-4.7', '{}']
  )).rows[0].row;
  assert.equal(num(settled.settled_credits), 4);
  assert.equal(num(settled.balance_after), 56);
  const settledMirror = (await db.query("select status, success from public.grok_quota_reservations where usage_key = 'use-vision'")).rows[0];
  assert.equal(settledMirror.status, 'settled');
  assert.equal(settledMirror.success, true);

  const released = (await db.query(
    "select public.release_feature_credits($1, 'use-images', 'gpt_image_2_5_economy', 'moderation', '{}'::jsonb) as row",
    [user.id]
  )).rows[0].row;
  assert.equal(released.status, 'released');
  assert.equal(num(released.settled_credits), 0);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 96);
  const releasedMirror = (await db.query("select status, success, actual_calls from public.grok_quota_reservations where usage_key = 'use-images'")).rows[0];
  assert.equal(releasedMirror.status, 'released');
  assert.equal(releasedMirror.success, false);
  assert.equal(num(releasedMirror.actual_calls), 0);

  const again = (await db.query(
    "select public.release_feature_credits($1, 'use-images', 'gpt_image_2_5_economy', 'moderation', '{}'::jsonb) as row",
    [user.id]
  )).rows[0].row;
  assert.equal(again.idempotent, true);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 96);

  const freshBalance = new Date().toISOString();
  await db.query(
    "insert into public.system_settings (key, value) values ('rh_domestic_balance', jsonb_build_object('remainMoney', 1.5, 'currency', 'USD', 'site', 'domestic', 'checkedAt', $1::text))",
    [freshBalance]
  );
  await assert.rejects(
    db.query('select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb)', [user.id, 'use-blocked', 'prompt-optimize', '{}']),
    /云服务余额不足/
  );
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 96);
  await db.query(
    "update public.system_settings set value = jsonb_build_object('remainMoney', 1.5, 'currency', 'USD', 'checkedAt', $1::text) where key = 'rh_domestic_balance'",
    [new Date(Date.now() - 11 * 60 * 1000).toISOString()]
  );
  const staleAllowed = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb) as row',
    [user.id, 'use-stale', 'prompt-optimize', '{}']
  )).rows[0].row;
  assert.equal(staleAllowed.status, 'reserved');
  await db.query("select public.release_feature_credits($1, 'use-stale', 'prompt-optimize', 'incomplete', '{}'::jsonb)", [user.id]);
  await db.query(
    "update public.system_settings set value = jsonb_build_object('remainMoney', 10, 'currency', 'CNY', 'checkedAt', $1::text) where key = 'rh_domestic_balance'",
    [new Date().toISOString()]
  );
  await assert.rejects(
    db.query('select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb)', [user.id, 'use-cny', 'prompt-optimize', '{}']),
    /云服务余额不足/
  );
  assert.equal(num((await db.query('select public.credit_ledger_estimated_rh_cost() as cost')).rows[0].cost), 0.0073);

  const csv = ledgerCsv([{
    created_at: '2026-10-28T00:00:00Z', user_id: user.id, user_email_or_account: 'credits@novaflow.local',
    feature: 'xiaotao_vision', model: 'xai/grok-4.7', status: 'settled', estimated_credits: 4,
    settled_credits: 4, balance_after: 96, rh_cost_usd: 0.0073, rh_cost_currency: 'USD', usage_key: 'use-vision'
  }]);
  assert.match(csv, /created_at,settled_at,user_id/);
  assert.match(csv, /^\uFEFF/);
  assert.match(csv, /xiaotao_vision/);
  const adminData = await readFile(join(webRoot, 'admin/license-admin-gui/admin-data.js'), 'utf8');
  const ledgerFn = adminData.slice(adminData.indexOf('async function lookupLedgerUsers'), adminData.indexOf('async function callFeatureCreditRpc'));
  assert.doesNotMatch(ledgerFn, /\.or\(/);
  assert.match(ledgerFn, /collectPages/);
  assert.match(ledgerFn, /\.eq\("email", lookup\.email\)/);
  await db.close();
});

test('quota migration rounds remaining counts up, is idempotent, and rolls the batch back', async () => {
  const db = await database();
  const whole = await addUser(db, 'whole@novaflow.local', 10);
  const fraction = await addUser(db, 'fraction@novaflow.local', 1);
  const held = await addUser(db, 'held@novaflow.local', 5);
  await db.query('select public.set_grok_quota($1, 10, $2, $3::jsonb)', [whole.id, 'seed', '{}']);
  await db.query('select public.reserve_grok_quota($1, $2, $3, 1, 1, $4::jsonb)', [whole.id, 'spent', 'image-reverse', '{}']);
  await db.query('select public.settle_grok_quota($1, $2, 1, true, $3::jsonb, $4::jsonb)', [whole.id, 'spent', '[]', '{}']);
  await db.query('select public.set_grok_quota($1, 1, $2, $3::jsonb)', [fraction.id, 'seed', '{}']);
  await db.query('select public.set_grok_quota($1, 8, $2, $3::jsonb)', [held.id, 'seed', '{}']);
  await db.query('select public.reserve_grok_quota($1, $2, $3, 2, 2, $4::jsonb)', [held.id, 'open-hold', 'prompt-optimize', '{}']);

  await assert.rejects(
    db.query('select public.migrate_grok_quota_to_credits($1, $2, true)', ['batch-fail', 4]),
    /forced failure/
  );
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [whole.id])).rows[0].balance), 10);
  assert.equal((await db.query("select count(*)::int as n from public.quota_migration_batches")).rows[0].n, 0);
  assert.equal((await db.query("select value->>'locked' as locked from public.system_settings where key = 'quota_migration_lock'")).rows[0]?.locked || '', '');

  const migrated = (await db.query('select public.migrate_grok_quota_to_credits($1, $2, false) as row', ['batch-1', null])).rows[0].row;
  assert.equal(migrated.status, 'completed');
  assert.equal(num(migrated.price), 4);
  // whole: allocated 10, used 1, reserved 0 -> 9 * 4 = 36, balance 10 + 36
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [whole.id])).rows[0].balance), 46);
  // fraction uses an explicit later batch so the default price path is covered here: remaining 1 * 4 = 4
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [fraction.id])).rows[0].balance), 5);
  // held: open 2 calls are released, remaining 8 * 4 = 32
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [held.id])).rows[0].balance), 37);
  const frozen = (await db.query("select value from public.system_settings where key = $1", ['provider_quota_grok_' + held.id])).rows[0].value;
  assert.equal(frozen.migration_frozen, true);
  assert.equal(num(frozen.remaining_count), 0);
  assert.equal((await db.query("select status from public.grok_quota_reservations where usage_key = 'open-hold'")).rows[0].status, 'released');
  const ledger = (await db.query("select feature, settled_credits from public.credit_ledger where user_id = $1 and feature = 'quota_migration'", [whole.id])).rows[0];
  assert.equal(num(ledger.settled_credits), 36);

  const again = (await db.query('select public.migrate_grok_quota_to_credits($1, 4, false) as row', ['batch-1'])).rows[0].row;
  assert.equal(again.status, 'already_migrated');
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [whole.id])).rows[0].balance), 46);

  const odd = await addUser(db, 'odd@novaflow.local', 2);
  await db.query('select public.set_grok_quota($1, 1, $2, $3::jsonb)', [odd.id, 'seed', '{}']);
  const fractional = (await db.query('select public.migrate_grok_quota_to_credits($1, 2.3, false) as row', ['batch-fraction'])).rows[0].row;
  assert.equal(fractional.status, 'completed');
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [odd.id])).rows[0].balance), 5);

  const undone = (await db.query('select public.rollback_grok_quota_migration($1) as row', ['batch-1'])).rows[0].row;
  assert.equal(undone.status, 'rolled_back');
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [whole.id])).rows[0].balance), 10);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [held.id])).rows[0].balance), 5);
  assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where pricing_details->>'batch_id' = 'batch-1'")).rows[0].n, 0);
  const restored = (await db.query("select value from public.system_settings where key = $1", ['provider_quota_grok_' + whole.id])).rows[0].value;
  assert.equal(restored.migration_frozen, false);
  assert.equal(num(restored.allocated_count), 10);
  const second = (await db.query('select public.rollback_grok_quota_migration($1) as row', ['batch-1'])).rows[0].row;
  assert.equal(second.status, 'already_rolled_back');
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [whole.id])).rows[0].balance), 10);

  await db.query("update public.system_settings set value = '{\"locked\":true,\"status\":\"held\",\"batch_id\":\"other-batch\"}'::jsonb where key = 'quota_migration_lock'");
  await assert.rejects(
    db.query('select public.migrate_grok_quota_to_credits($1, 4, false)', ['batch-while-held']),
    /another batch holds the lock/
  );
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [whole.id])).rows[0].balance), 10);
  await db.query("insert into public.system_settings (key, value) values ('quota_migration_lock', '{\"locked\":true}'::jsonb) on conflict (key) do update set value = excluded.value");
  await assert.rejects(
    db.query('select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb)', [whole.id, 'during-lock', 'prompt-optimize', '{}']),
    /维护中/
  );
  await assert.rejects(
    db.query('select public.reserve_grok_quota($1, $2, $3, 1, 1, $4::jsonb)', [whole.id, 'during-lock-calls', 'image-reverse', '{}']),
    /维护中/
  );
  await db.close();
});

test('admin credit adjustment writes the ledger in one transaction and team plans fold into pro', async () => {
  const db = await database();
  const user = await addUser(db, 'adjust@novaflow.local', 10);
  const added = (await db.query(
    'select public.admin_adjust_feature_credits($1, $2, $3, $4, $5, $6, $7) as row',
    [user.id, 'add', 5, '补偿', 'note', 'admin-host', 'admin_adjust_test_1']
  )).rows[0].row;
  assert.equal(added.idempotent, false);
  assert.equal(num(added.before_balance), 10);
  assert.equal(num(added.after_balance), 15);
  assert.equal(num(added.delta), 5);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 15);
  const ledger = (await db.query("select feature, status, settled_credits, balance_after, pricing_details from public.credit_ledger where usage_key = 'admin_adjust_test_1'")).rows[0];
  assert.equal(ledger.feature, 'admin_adjust');
  assert.equal(ledger.status, 'settled');
  assert.equal(num(ledger.settled_credits), 5);
  assert.equal(ledger.pricing_details.reason, '补偿');
  assert.equal(ledger.pricing_details.source, 'admin_gui');
  const again = (await db.query(
    'select public.admin_adjust_feature_credits($1, $2, $3, $4, $5, $6, $7) as row',
    [user.id, 'add', 5, '补偿', 'note', 'admin-host', 'admin_adjust_test_1']
  )).rows[0].row;
  assert.equal(again.idempotent, true);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 15);
  await assert.rejects(
    db.query('select public.admin_adjust_feature_credits($1, $2, $3, $4, $5, $6, $7)', [user.id, 'deduct', 1, '其他', '', 'admin-host', 'admin_adjust_test_1']),
    /内容不一致/
  );
  await assert.rejects(
    db.query('select public.admin_adjust_feature_credits($1, $2, $3, $4, $5, $6, $7)', [user.id, 'deduct', 100, '扣太多', '', 'admin-host', 'admin_adjust_test_2']),
    /不能小于 0/
  );
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 15);
  assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where usage_key = 'admin_adjust_test_2'")).rows[0].n, 0);
  const anon = (await db.query("select has_function_privilege('anon', 'public.admin_adjust_feature_credits(uuid,text,numeric,text,text,text,text)', 'execute') as ok")).rows[0];
  assert.equal(anon.ok, false);
  const authed = (await db.query("select has_function_privilege('authenticated', 'public.admin_adjust_feature_credits(uuid,text,numeric,text,text,text,text)', 'execute') as ok")).rows[0];
  assert.equal(authed.ok, false);

  const planSql = await readFile(join(repoRoot, 'supabase/migrations/20261028160000_users_plan_team_to_pro.sql'), 'utf8');
  assert.doesNotMatch(planSql, /users_plan_valid/i);
  await db.query("update public.users set plan = 'team' where id = $1", [user.id]);
  const balanceBefore = num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance);
  await db.exec(planSql);
  assert.equal((await db.query('select plan from public.users where id = $1', [user.id])).rows[0].plan, 'pro');
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), balanceBefore);
  assert.equal((await db.query("select count(*)::int as n from public.users where plan = 'team'")).rows[0].n, 0);
  await db.exec(planSql);
  assert.equal((await db.query("select count(*)::int as n from public.users where plan = 'team'")).rows[0].n, 0);
  const constraint = (await db.query("select count(*)::int as n from pg_constraint where conname = 'users_plan_valid'")).rows[0];
  assert.equal(constraint.n, 0);
  await db.query("update public.users set plan = 'team' where id = $1", [user.id]);
  await db.exec(planSql);
  assert.equal((await db.query('select plan from public.users where id = $1', [user.id])).rows[0].plan, 'pro');
  await db.close();
});
