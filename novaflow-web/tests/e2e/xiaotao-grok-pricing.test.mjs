import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { estimateXiaotaoOnlineCredits, settleXiaotaoOnlineCredits, xiaotaoOnlinePolicy } from '../../packages/shared/src/feature-credits.mjs';

const model = 'xai/grok-4.7';
const settle = (usage, extra = {}) => settleXiaotaoOnlineCredits({ model, usage, reservedCredits: 50, ...extra });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('Grok reservation estimates input and maximum output at configured separate rates without assuming cache', () => {
  const input = { text: 'a'.repeat(1000), system: '', files: [{kind:'image'}], outputTokens: 1000 };
  const quote = estimateXiaotaoOnlineCredits({ ...input, model });
  assert.equal(quote.tokens, 4000);
  near(quote.usd, (3000 * 1.7 + 1000 * 5.1) / 1e6);
  assert.equal(quote.credits, 4);
  const fallback = estimateXiaotaoOnlineCredits(input);
  near(fallback.usd, 4000 * 10 / 1e6);
  assert.equal(fallback.credits, 13);
  assert.equal(estimateXiaotaoOnlineCredits({...input, model:'unknown-model'}).credits, fallback.credits);
  const high = estimateXiaotaoOnlineCredits({ ...input, model, config: { xiaotao_online: { grok_4_7_rates: {
    high_input_threshold: 3000, high_input: 4, high_output: 11
  } } } });
  near(high.usd, (3000 * 4 + 1000 * 11) / 1e6);
  assert.equal(high.credits, 8);
  const capped = estimateXiaotaoOnlineCredits({ ...input, model, config:{xiaotao_online:{message_cap_credits:2}} });
  assert.equal(capped.credits, 2);
});

test('Grok token estimate uses input, output and cached-input rates independently', () => {
  const decision = settle({ prompt_tokens: 10000, completion_tokens: 1000, total_tokens: 11000,
    prompt_tokens_details: { cached_tokens: 4000 } });
  near(decision.usdCost, (6000 * 1.7 + 4000 * 0.425 + 1000 * 5.1) / 1e6);
  assert.equal(decision.credits, 6);
  assert.equal(decision.pricingSource, 'token_rate_estimate');
  assert.equal(decision.tokenRateEstimate.cacheKnown, true);
  assert.equal(decision.tokenRateEstimate.cachedTokens, 4000);
  assert.equal(decision.refund, 44);
});

test('Grok uses the correct long-input tier and configurable prices', () => {
  const usage = { input_tokens: 200000, output_tokens: 1000, total_tokens: 201000,
    input_tokens_details: { cached_tokens: 20000 } };
  const high = settle(usage);
  near(high.usdCost, (180000 * 3.4 + 20000 * 0.425 + 1000 * 10.2) / 1e6);
  const configured = settle(usage, { config: { xiaotao_online: { grok_4_7_rates: {
    high_input_threshold: 200001, input: 2, output: 6, cached_input: 0.5
  } } } });
  near(configured.usdCost, (180000 * 2 + 20000 * 0.5 + 1000 * 6) / 1e6);
  const normalized = xiaotaoOnlinePolicy({ xiaotao_online: { grok_4_7_rates: { input: '2', output: -1, cached_input: '0.5', high_input_threshold: 200001 } } });
  assert.equal(normalized.grok_4_7_rates.input, 2);
  assert.equal(normalized.grok_4_7_rates.output, 5.1);
  assert.equal(normalized.grok_4_7_rates.cached_input, 0.5);
  assert.equal(normalized.grok_4_7_rates.high_input_threshold, 200001);
});

test('missing cache data is labeled as unknown; provider money always wins', () => {
  const estimate = settle({ input_tokens: 10000, output_tokens: 1000 });
  near(estimate.usdCost, 0.0221);
  assert.equal(estimate.tokenRateEstimate.cacheKnown, false);
  const money = settle({ input_tokens: 10000, output_tokens: 1000, thirdPartyConsumeMoney: '0.01' });
  assert.equal(money.usdCost, 0.01);
  assert.equal(money.pricingSource, 'rh_consume_money');
  assert.equal(money.tokenRateEstimate, null);
});

test('missing or inconsistent breakdown refunds the reservation instead of overcharging', () => {
  for (const usage of [
    {},
    { input_tokens: 100 },
    { total_tokens: 11000 },
    { input_tokens: 10000, output_tokens: 0, total_tokens: 11000 },
    { input_tokens: 10000, output_tokens: 1000, input_tokens_details: { cached_tokens: 10001 } }
  ]) {
    const result = settle(usage);
    assert.equal(result.pricingSource, 'unpriced_usage');
    assert.equal(result.tokenRateEstimate, null);
    assert.equal(result.usageMissing, true);
    assert.equal(result.credits, 0);
    assert.equal(result.refund, 50);
    assert.match(result.warning, /no credits charged/);
  }
});

test('unknown models retain existing total-token behavior', () => {
  const result = settle({ input_tokens: 10000, output_tokens: 1000 }, { model: 'unknown-model' });
  near(result.usdCost, 0.11);
  assert.equal(result.pricingSource, 'token_usage');
});

test('zero-credit unpriced usage settles through SQL and refunds the full reservation', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(here, '../../..');
  const web = resolve(here, '../..');
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(await readFile(join(web, 'control-local/src/bootstrap.sql'), 'utf8'));
    for (const migration of [
      '20260812030000_grok_quota_reservations.sql',
      '20261028010000_settle_grok_quota_failure_does_not_charge.sql',
      '20261028140000_feature_credits.sql',
      '20261028170000_token_settle_credits.sql',
      '20261028180000_xiaotao_online_token_credits.sql'
    ]) await db.exec(await readFile(join(repo, 'supabase/migrations', migration), 'utf8'));
    const user = (await db.query("insert into public.users (email, display_name, status) values ('unpriced@novaflow.local', 'unpriced', 'active') returning id")).rows[0];
    await db.query('insert into public.credits (user_id, balance) values ($1, 100)', [user.id]);
    await db.query('select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5)', [user.id, 'unpriced-grok', 'xiaotao-text', '{}', 50]);
    const decision = settle({ total_tokens: 1000 });
    const receipt = (await db.query('select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5, null, $6) as row',
      [user.id, 'unpriced-grok', 'xiaotao-text', '{}', decision.credits, decision.pricingSource])).rows[0].row;
    assert.equal(Number(receipt.settled_credits), 0);
    assert.equal(Number(receipt.refunded_credits), 50);
    assert.equal(Number(receipt.balance_after), 100);
    assert.equal(receipt.pricing_source, 'unpriced_usage');
    assert.equal(receipt.rh_cost_usd, null);
  } finally { await db.close(); }
});
