import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';
import {
  creditsFromUsd,
  estimateTokenImageCredits,
  normalizeCreditConfig,
  quoteFeature,
  settleTokenImageCredits
} from '../../packages/shared/src/feature-credits.mjs';
import {
  DEFAULT_GPT_IMAGE_ENDPOINT,
  DEFAULT_GPT_IMAGE_I2I_ENDPOINT,
  featureForEndpoint,
  quoteGptImage,
  runChargedGptImage
} from '../../packages/shared/src/runninghub-gpt-image.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const webRoot = resolve(here, '../..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function num(value) {
  return Number(value);
}

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(await readFile(join(webRoot, 'control-local/src/bootstrap.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20260812030000_grok_quota_reservations.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028010000_settle_grok_quota_failure_does_not_charge.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028140000_feature_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028150000_admin_adjust_feature_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028160000_users_plan_team_to_pro.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028170000_token_settle_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028170000_token_settle_credits.sql'), 'utf8'));
  return db;
}

async function addUser(db, balance = 200) {
  const user = (await db.query(
    "insert into public.users (email, display_name, status) values ('token@novaflow.local', 'token', 'active') returning id"
  )).rows[0];
  await db.query('insert into public.credits (user_id, balance) values ($1, $2)', [user.id, balance]);
  return user;
}

test('credit formula uses ceil(USD × 211 × 2) and the settle cap', () => {
  assert.equal(creditsFromUsd('0.006'), 3);
  assert.equal(creditsFromUsd('0.0133'), 6);
  assert.equal(creditsFromUsd('0.0269'), 12);
  assert.equal(creditsFromUsd('0.1072'), 46);
  assert.equal(creditsFromUsd(0.007), 3);
  assert.equal(creditsFromUsd(0.108), 46);
  assert.equal(creditsFromUsd(0), 0);
  assert.equal(creditsFromUsd(''), null);
  assert.equal(creditsFromUsd('nope'), null);
  const capped = settleTokenImageCredits({
    usage: { thirdPartyConsumeMoney: '0.1072', tokenUsage: { total_tokens: '3592', output_tokens: '3568' } },
    reservedCredits: 40
  });
  assert.equal(capped.rawCredits, 46);
  assert.equal(capped.credits, 40);
  assert.equal(capped.settleCapped, true);
  assert.equal(capped.capped, true);
  assert.equal(capped.pricingSource, 'rh_consume_money');
  assert.equal(capped.tokens.output_tokens, '3568');
  assert.match(capped.warning, /capped/);
  const under = settleTokenImageCredits({
    usage: { thirdPartyConsumeMoney: '0.0133' },
    reservedCredits: 6
  });
  assert.equal(under.credits, 6);
  assert.equal(under.capped, false);
  assert.equal(under.warning, '');
  const missing = settleTokenImageCredits({ usage: { consumeMoney: null }, reservedCredits: 12 });
  assert.equal(missing.credits, 12);
  assert.equal(missing.pricingSource, 'estimate_cap');
  assert.equal(missing.usageMissing, true);
  assert.match(missing.warning, /thirdPartyConsumeMoney and consumeMoney missing/);
  const fromConsume = settleTokenImageCredits({
    usage: { thirdPartyConsumeMoney: null, consumeMoney: '0.0133' },
    reservedCredits: 12
  });
  assert.equal(fromConsume.credits, 6);
  assert.equal(fromConsume.usdCost, 0.0133);
  assert.equal(fromConsume.moneySource, 'consumeMoney');
  assert.equal(fromConsume.usageMissing, false);
  assert.equal(fromConsume.pricingSource, 'rh_consume_money');
  assert.equal(fromConsume.warning, '');
  const preferThird = settleTokenImageCredits({
    usage: { thirdPartyConsumeMoney: '0.006', consumeMoney: '0.0133' },
    reservedCredits: 12
  });
  assert.equal(preferThird.credits, 3);
  assert.equal(preferThird.moneySource, 'thirdPartyConsumeMoney');
  const overCap = settleTokenImageCredits({ usage: {}, reservedCredits: 80 });
  assert.equal(overCap.credits, 40);
  assert.equal(overCap.settleCapped, true);
  assert.match(overCap.warning, /capped at 40/);
});

test('reserve estimates match measured tiers and never exceed the settle cap', () => {
  const cases = [
    ['1k', 'low', 3],
    ['1k', 'medium', 6],
    ['2k', 'medium', 12],
    ['2k', 'high', 40]
  ];
  for (const [resolution, quality, credits] of cases) {
    const estimated = estimateTokenImageCredits({ resolution, quality, count: 1 });
    assert.equal(estimated.perImage, credits, `${resolution}/${quality}`);
    assert.equal(estimated.perImage <= estimated.settleCap, true);
  }
  assert.equal(estimateTokenImageCredits({ resolution: '2k', quality: 'high', count: 2 }).credits, 80);
  assert.equal(estimateTokenImageCredits({ resolution: '4k', quality: 'high' }).perImage, 40);
  const lowered = estimateTokenImageCredits({
    resolution: '2k',
    quality: 'high',
    config: { token_billing: { settle_cap_credits: 10, estimate_credits: { '2k': { high: 46 } } } }
  });
  assert.equal(lowered.perImage, 10);
  assert.equal(lowered.settleCap, 10);
  assert.equal(normalizeCreditConfig(undefined).prices.gpt_image_2_5_economy, 20);
  assert.equal(normalizeCreditConfig(undefined).token_billing.markup, 2);
  assert.equal(normalizeCreditConfig(undefined).token_billing.settle_cap_credits, 40);
  assert.equal(quoteFeature({ feature: 'gpt_image_2_5_token' }).unpriced, true);
  assert.equal(quoteFeature({ feature: 'gpt_image_2_5_economy', units: 2, prices: { prices: { gpt_image_2_5_economy: 30 } } }).credits, 60);
});

test('text-to-image quotes the token channel and image-to-image stays a fixed 20', () => {
  assert.equal(featureForEndpoint(DEFAULT_GPT_IMAGE_ENDPOINT), 'gpt_image_2_5_token');
  assert.equal(featureForEndpoint(DEFAULT_GPT_IMAGE_I2I_ENDPOINT), 'gpt_image_2_5_economy');
  const text = quoteGptImage({
    endpoint: DEFAULT_GPT_IMAGE_ENDPOINT,
    settings: { resolution: '2k', quality: 'high' },
    count: 1
  });
  assert.equal(text.billingMode, 'token');
  assert.equal(text.perImage, 40);
  assert.equal(text.model, 'rhart-image-g-2.5-official-token');
  const edit = quoteGptImage({
    mode: 'img2img',
    imageEndpoint: DEFAULT_GPT_IMAGE_I2I_ENDPOINT,
    settings: { resolution: '2k', quality: 'high' },
    count: 2
  });
  assert.equal(edit.billingMode, 'fixed');
  assert.equal(edit.feature, 'gpt_image_2_5_economy');
  assert.equal(edit.perImage, 20);
  assert.equal(edit.credits, 40);
  const custom = quoteGptImage({
    mode: 'img2img',
    imageEndpoint: DEFAULT_GPT_IMAGE_I2I_ENDPOINT,
    prices: { gpt_image_2_5_economy: 18 }
  });
  assert.equal(custom.perImage, 18);
});

test('browser quote matches the shared estimate and the economy price', () => {
  const source = readFileSync(new URL('../../renderer/feature-credit-prices.js', import.meta.url), 'utf8');
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const api = sandbox.NovaFlowFeatureCreditPrices;
  for (const [resolution, quality] of [['1k', 'low'], ['1k', 'medium'], ['2k', 'medium'], ['2k', 'high']]) {
    const shared = quoteGptImage({ endpoint: DEFAULT_GPT_IMAGE_ENDPOINT, settings: { resolution, quality } });
    const browser = api.quoteGptImage({ endpoint: DEFAULT_GPT_IMAGE_ENDPOINT, settings: { resolution, quality } });
    assert.equal(browser.credits, shared.credits, `${resolution}/${quality}`);
    assert.equal(browser.billingMode, 'token');
  }
  const edit = api.quoteGptImage({ mode: 'img2img', imageEndpoint: DEFAULT_GPT_IMAGE_I2I_ENDPOINT, settings: { resolution: '2k' }, count: 2 });
  assert.equal(edit.credits, 40);
  api.applyConfig({ prices: { gpt_image_2_5_economy: 18 }, token_billing: { settle_cap_credits: 40 } });
  assert.equal(api.quoteGptImage({ mode: 'img2img' }).perImage, 18);
});

function successFetch(usage) {
  return async (url) => {
    const href = String(url);
    if (href.endsWith('/query')) {
      return { ok: true, json: async () => ({ taskId: 't1', status: 'SUCCESS', results: [{ url: 'https://cdn.example/out.png' }], usage }) };
    }
    if (href === 'https://cdn.example/out.png') {
      return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
    }
    return { ok: true, status: 200, json: async () => ({ taskId: 't1', status: 'QUEUED' }) };
  };
}

function ledgerCharge() {
  let balance = 1000;
  const rows = new Map();
  const events = [];
  const charge = createOnlineAiCharge({
    reserve: async ({ feature, estimatedCredits, credits, usageKey }) => {
      const hold = Number(estimatedCredits ?? credits);
      balance -= hold;
      rows.set(usageKey, { feature, estimated: hold, status: 'reserved' });
      events.push(['reserve', feature, hold, balance]);
      return { status: 'reserved', idempotent: false, amount: 1, estimated_credits: hold };
    },
    settle: async ({ feature, usageKey, settledCredits, pricingSource, metadata, rhCostUsd }) => {
      const row = rows.get(usageKey);
      const requested = settledCredits == null ? row.estimated : Number(settledCredits);
      const actual = Math.min(requested, row.estimated);
      const refund = row.estimated - actual;
      balance += refund;
      row.status = 'settled';
      row.settled = actual;
      row.pricingSource = pricingSource;
      row.metadata = metadata;
      row.rhCostUsd = rhCostUsd;
      events.push(['settle', feature, actual, balance]);
      return {
        status: 'settled',
        settled_credits: actual,
        estimated_credits: row.estimated,
        balance_after: balance,
        refunded_credits: refund,
        reserve_capped: requested > row.estimated
      };
    },
    release: async ({ feature, usageKey }) => {
      const row = rows.get(usageKey);
      balance += row.estimated;
      row.status = 'released';
      events.push(['release', feature, row.estimated, balance]);
      return { status: 'released', settled_credits: 0, balance_after: balance };
    }
  });
  return { charge, events, rows, balance: () => balance };
}

const imageConfig = {
  apiKey: 'rh-fixture-key-not-real',
  baseUrl: 'https://www.runninghub.ai',
  gptImageEndpoint: DEFAULT_GPT_IMAGE_ENDPOINT,
  gptImageI2iEndpoint: DEFAULT_GPT_IMAGE_I2I_ENDPOINT
};

test('a successful token image settles the money formula, refunds the difference, and caps 2k/high at 40', async () => {
  const low = ledgerCharge();
  const lowOutcome = await runChargedGptImage({
    charge: low.charge,
    config: imageConfig,
    fetchImpl: successFetch({ thirdPartyConsumeMoney: '0.006', tokenUsage: { total_tokens: '220', output_tokens: '196' } }),
    sleep: async () => {},
    request: { userId: 'user-1', usageKey: 'low', mode: 'txt2img', prompt: '海', settings: { resolution: '1k', quality: 'low' } }
  });
  assert.equal(lowOutcome.quote.perImage, 3);
  assert.equal(lowOutcome.charged, 3);
  assert.equal(lowOutcome.billing.pricingSource, 'rh_consume_money');
  assert.equal(lowOutcome.results[0].billing.token_usage.output_tokens, '196');
  assert.equal(low.balance(), 1000 - 3);

  const mid = ledgerCharge();
  const midOutcome = await runChargedGptImage({
    charge: mid.charge,
    config: imageConfig,
    fetchImpl: successFetch({ thirdPartyConsumeMoney: '0.006' }),
    sleep: async () => {},
    request: { userId: 'user-1', usageKey: 'mid', mode: 'txt2img', prompt: '海', settings: { resolution: '2k', quality: 'medium' } }
  });
  assert.equal(midOutcome.quote.perImage, 12);
  assert.equal(midOutcome.charged, 3);
  assert.equal(midOutcome.billing.refundedCredits, 9);
  assert.equal(mid.balance(), 1000 - 3);
  assert.equal(midOutcome.results[0].metadata.third_party_consume_money, '0.006');

  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const high = ledgerCharge();
    const highOutcome = await runChargedGptImage({
      charge: high.charge,
      config: imageConfig,
      fetchImpl: successFetch({ thirdPartyConsumeMoney: '0.1072', consumeMoney: null, tokenUsage: { total_tokens: '3592' } }),
      sleep: async () => {},
      request: { userId: 'user-1', usageKey: 'high', mode: 'txt2img', prompt: '海', settings: { resolution: '2k', quality: 'high' } }
    });
    assert.equal(highOutcome.quote.perImage, 40);
    assert.equal(highOutcome.charged, 40);
    assert.equal(highOutcome.billing.capped, true);
    assert.equal(highOutcome.results[0].billing.raw_credits, 46);
    assert.equal(high.rows.get('high').rhCostUsd, 0.1072);
    assert.equal(warnings.some((line) => line.includes('token charge capped')), true);
  } finally {
    console.warn = original;
  }
});

test('price preview raises the reserve and the settle cap still holds', async () => {
  const held = ledgerCharge();
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes('/price-preview/')) {
      return { ok: true, json: async () => ({ data: { estimatedPrice: '0.2', currency: 'USD' } }) };
    }
    return successFetch({ thirdPartyConsumeMoney: '0.006' })(url);
  };
  const outcome = await runChargedGptImage({
    charge: held.charge,
    config: { ...imageConfig, pricePreview: true },
    fetchImpl,
    sleep: async () => {},
    request: { userId: 'user-1', usageKey: 'preview', mode: 'txt2img', prompt: '海', settings: { resolution: '1k', quality: 'low' } }
  });
  assert.equal(outcome.quote.perImage, 40);
  assert.equal(outcome.charged, 3);
  assert.equal(held.events[0][2], 40);
  assert.equal(held.balance(), 1000 - 3);
});

test('missing money charges the reserve, and failure or moderation releases it', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  const held = ledgerCharge();
  try {
    const outcome = await runChargedGptImage({
      charge: held.charge,
      config: imageConfig,
      fetchImpl: successFetch({ consumeMoney: null, tokenUsage: { total_tokens: '10' } }),
      sleep: async () => {},
      request: { userId: 'user-1', usageKey: 'missing', mode: 'txt2img', prompt: '海', settings: { resolution: '1k', quality: 'medium' } }
    });
    assert.equal(outcome.charged, 6);
    assert.equal(outcome.billing.pricingSource, 'estimate_cap');
    assert.equal(outcome.results[0].billing.usage_missing, true);
    assert.equal(held.rows.get('missing').pricingSource, 'estimate_cap');
    assert.equal(warnings.some((line) => line.includes('thirdPartyConsumeMoney') && line.includes('consumeMoney missing')), true);
  } finally {
    console.warn = original;
  }

  const consumeWarnings = [];
  console.warn = (...args) => consumeWarnings.push(args.join(' '));
  const consumeHeld = ledgerCharge();
  try {
    const outcome = await runChargedGptImage({
      charge: consumeHeld.charge,
      config: imageConfig,
      fetchImpl: successFetch({ thirdPartyConsumeMoney: null, consumeMoney: '0.0133', tokenUsage: { total_tokens: '400' } }),
      sleep: async () => {},
      request: { userId: 'user-1', usageKey: 'consume', mode: 'txt2img', prompt: '海', settings: { resolution: '2k', quality: 'medium' } }
    });
    assert.equal(outcome.quote.perImage, 12);
    assert.equal(outcome.charged, 6);
    assert.equal(outcome.billing.pricingSource, 'rh_consume_money');
    assert.equal(outcome.results[0].billing.money_source, 'consumeMoney');
    assert.equal(outcome.results[0].billing.usage_missing, false);
    assert.equal(consumeWarnings.some((line) => line.includes('missing')), false);
    assert.equal(consumeHeld.balance(), 1000 - 6);
  } finally {
    console.warn = original;
  }

  const moderated = ledgerCharge();
  const moderation = await runChargedGptImage({
    charge: moderated.charge,
    config: imageConfig,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 'moderation_rejected' } }) }),
    request: { userId: 'user-1', usageKey: 'mod', mode: 'txt2img', prompt: 'bad', settings: { resolution: '2k', quality: 'high' } }
  });
  assert.equal(moderation.charged, 0);
  assert.equal(moderated.events.at(-1)[0], 'release');
  assert.equal(moderated.balance(), 1000);

  const failed = ledgerCharge();
  await assert.rejects(() => runChargedGptImage({
    charge: failed.charge,
    config: { ...imageConfig, gptImageEndpoint: '/openapi/v2/rhart-image-g-2-official/text-to-image' },
    fetchImpl: async () => { throw Object.assign(new Error('出图超时，请稍后重试'), { statusCode: 504 }); },
    request: { userId: 'user-1', usageKey: 'fail', mode: 'txt2img', prompt: '海', settings: { size: '1024x1024' } }
  }), /超时/);
  assert.equal(failed.events[0][0], 'reserve');
  assert.equal(failed.events.at(-1)[0], 'release');
  assert.equal(failed.balance(), 1000);
});

test('settle refunds, caps at the reservation, releases on failure, and stays compatible', async () => {
  const db = await database();
  const user = await addUser(db, 200);
  const price = num((await db.query("select value #>> '{prices,gpt_image_2_5_economy}' as price from public.system_settings where key = 'feature_credit_config'")).rows[0].price);
  assert.equal(price, 20);
  const cap = num((await db.query("select value #>> '{token_billing,settle_cap_credits}' as cap from public.system_settings where key = 'feature_credit_config'")).rows[0].cap);
  assert.equal(cap, 40);
  assert.equal((await db.query("select public.canonical_credit_feature('gpt-image-2.5-token') as feature")).rows[0].feature, 'gpt_image_2_5_token');
  assert.equal((await db.query("select public.feature_credit_quote('gpt_image_2_5_token', 1)->>'unpriced' as unpriced")).rows[0].unpriced, 'true');

  const reserved = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, $4, $5::jsonb, $6) as row',
    [user.id, 'token-refund', 'gpt_image_2_5_token', 'rhart-image-g-2.5-official-token', '{"billing_mode":"token"}', 12]
  )).rows[0].row;
  assert.equal(reserved.status, 'reserved');
  assert.equal(num(reserved.estimated_credits), 12);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 188);

  const replay = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, 99) as row',
    [user.id, 'token-refund', 'gpt_image_2_5_token', '{}']
  )).rows[0].row;
  assert.equal(replay.idempotent, true);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 188);

  const refunded = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, $4, $5::jsonb, $6, $7, $8) as row',
    [user.id, 'token-refund', 'gpt_image_2_5_token', 'rhart-image-g-2.5-official-token', '{"token_usage":{"total_tokens":"220"},"third_party_consume_money":"0.006"}', 3, 0.006, 'rh_consume_money']
  )).rows[0].row;
  assert.equal(num(refunded.settled_credits), 3);
  assert.equal(num(refunded.refunded_credits), 9);
  assert.equal(num(refunded.balance_after), 197);
  assert.equal(refunded.reserve_capped, false);
  const ledger = (await db.query("select settled_credits, rh_cost_usd, pricing_source, pricing_details from public.credit_ledger where usage_key = 'token-refund'")).rows[0];
  assert.equal(num(ledger.settled_credits), 3);
  assert.equal(num(ledger.rh_cost_usd), 0.006);
  assert.equal(ledger.pricing_source, 'rh_consume_money');
  assert.equal(ledger.pricing_details.token_usage.total_tokens, '220');
  assert.equal(ledger.pricing_details.third_party_consume_money, '0.006');

  const again = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb, 1, null, null) as row',
    [user.id, 'token-refund', 'gpt_image_2_5_token', '{}']
  )).rows[0].row;
  assert.equal(again.idempotent, true);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 197);

  const cappedHold = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'token-cap', 'gpt_image_2_5_token', '{}', 40]
  )).rows[0].row;
  assert.equal(num(cappedHold.estimated_credits), 40);
  const capped = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5, $6, $7) as row',
    [user.id, 'token-cap', 'gpt_image_2_5_token', '{"raw_credits":46}', 46, 0.1072, 'rh_consume_money']
  )).rows[0].row;
  assert.equal(num(capped.settled_credits), 40);
  assert.equal(num(capped.refunded_credits), 0);
  assert.equal(capped.reserve_capped, true);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 157);
  const capDetails = (await db.query("select pricing_details from public.credit_ledger where usage_key = 'token-cap'")).rows[0].pricing_details;
  assert.equal(capDetails.reserve_capped, true);
  assert.equal(num(capDetails.overrun_credits), 6);

  const releasedHold = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'token-release', 'gpt_image_2_5_token', '{}', 40]
  )).rows[0].row;
  assert.equal(num(releasedHold.estimated_credits), 40);
  const released = (await db.query(
    "select public.release_feature_credits($1, 'token-release', 'gpt_image_2_5_token', 'moderation', '{}'::jsonb) as row",
    [user.id]
  )).rows[0].row;
  assert.equal(released.status, 'released');
  assert.equal(num(released.settled_credits), 0);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 157);

  const legacy = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb) as row',
    [user.id, 'legacy', 'xiaotao-vision', '{}']
  )).rows[0].row;
  assert.equal(num(legacy.estimated_credits), 4);
  const legacySettled = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb) as row',
    [user.id, 'legacy', 'xiaotao-vision', '{}']
  )).rows[0].row;
  assert.equal(num(legacySettled.settled_credits), 4);
  assert.equal(num(legacySettled.refunded_credits), 0);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 153);

  await db.query("update public.system_settings set value = jsonb_set(jsonb_set(value, '{prices,gpt_image_2_5_economy}', '30'::jsonb, true), '{token_billing,markup}', '3'::jsonb, true) where key = 'feature_credit_config'");
  await db.query("update public.system_settings set value = value #- '{token_billing,settle_cap_credits}' where key = 'feature_credit_config'");
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028170000_token_settle_credits.sql'), 'utf8'));
  const kept = (await db.query("select value from public.system_settings where key = 'feature_credit_config'")).rows[0].value;
  assert.equal(num(kept.prices.gpt_image_2_5_economy), 30);
  assert.equal(num(kept.token_billing.markup), 3);
  assert.equal(num(kept.token_billing.settle_cap_credits), 40);
  assert.equal(kept.gpt_image.text_model, 'rhart-image-g-2.5-official-token');
  await db.close();
});
