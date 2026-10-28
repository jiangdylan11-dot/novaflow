// 小桃 online billing: estimate from text and staged files, settle from RH usage.
// No live RunningHub calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {
  creditsFromUsd,
  estimateXiaotaoOnlineCredits,
  settleTokenImageCredits,
  settleXiaotaoOnlineCredits,
  xiaotaoOnlinePolicy
} from '../../packages/shared/src/feature-credits.mjs';
import { companionInput, createCompanionChat } from '../../packages/shared/src/companion-chat.mjs';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const webRoot = resolve(here, '../..');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + (error.stack || error)); }
}

await test('the estimate grows with text and with image, video and audio, and is not a flat surcharge', () => {
  const text = estimateXiaotaoOnlineCredits({ text: '你好' });
  const longer = estimateXiaotaoOnlineCredits({ text: '你好'.repeat(400) });
  const image = estimateXiaotaoOnlineCredits({ text: '你好', files: [{ kind: 'image' }] });
  const video = estimateXiaotaoOnlineCredits({ text: '你好', files: [{ kind: 'video' }] });
  const audio = estimateXiaotaoOnlineCredits({ text: '你好', files: [{ kind: 'audio' }] });
  const both = estimateXiaotaoOnlineCredits({ text: '你好', files: [{ kind: 'image' }, { kind: 'video' }] });
  assert.ok(longer.credits >= text.credits);
  assert.ok(image.credits > text.credits);
  assert.ok(video.credits > image.credits);
  assert.ok(audio.credits > text.credits);
  assert.equal(both.credits, estimateXiaotaoOnlineCredits({ text: '你好', files: [{ kind: 'video' }, { kind: 'image' }] }).credits);
  assert.equal(text.credits - 0, text.credits);
  assert.notEqual(image.credits - text.credits, video.credits - text.credits);
  assert.equal(estimateXiaotaoOnlineCredits({ text: '', files: [] }).credits, 0);
});

await test('settlement is ceil(USD × 211 × 2), prefers thirdPartyConsumeMoney, and caps', () => {
  assert.equal(creditsFromUsd('0.0100'), Math.ceil(0.01 * 211 * 2));
  const preferred = settleXiaotaoOnlineCredits({
    usage: { thirdPartyConsumeMoney: '0.0100', consumeMoney: '0.2000' },
    reservedCredits: 40
  });
  assert.equal(preferred.moneySource, 'thirdPartyConsumeMoney');
  assert.equal(preferred.credits, Math.ceil(0.01 * 211 * 2));
  assert.equal(preferred.reservedCredits - preferred.credits > 0, true);
  const fallback = settleXiaotaoOnlineCredits({
    usage: { thirdPartyConsumeMoney: null, consumeMoney: '0.0200' },
    reservedCredits: 40
  });
  assert.equal(fallback.moneySource, 'consumeMoney');
  assert.equal(fallback.credits, Math.ceil(0.02 * 211 * 2));
  const missing = settleXiaotaoOnlineCredits({ usage: { prompt_tokens: 10 }, reservedCredits: 6 });
  assert.equal(missing.usageMissing, true);
  assert.equal(missing.credits, 6);
  const capped = settleXiaotaoOnlineCredits({
    usage: { thirdPartyConsumeMoney: '1.0000' },
    reservedCredits: 80,
    config: { xiaotao_online: { message_cap_credits: 9 } }
  });
  assert.equal(capped.settleCap, 9);
  assert.equal(capped.credits, 9);
  assert.equal(xiaotaoOnlinePolicy().message_cap_credits, 80);
  const topped = settleXiaotaoOnlineCredits({
    usage: { thirdPartyConsumeMoney: '0.0200' },
    reservedCredits: 5
  });
  assert.equal(topped.credits, Math.ceil(0.02 * 211 * 2));
  assert.equal(topped.toppedUp, true);
  assert.equal(topped.shortfall, topped.credits - 5);
  assert.equal(topped.reserveCapped, false);
  const gpt = settleTokenImageCredits({
    usage: { thirdPartyConsumeMoney: '0.0200' },
    reservedCredits: 5
  });
  assert.equal(gpt.credits, 5);
  assert.equal(gpt.reserveCapped, true);
});

await test('companion reserves the estimate, settles the RH amount, and releases the hold on failure', async () => {
  const events = [];
  const charge = createOnlineAiCharge({
    reserve: async (input) => { events.push(['reserve', input.feature, input.estimatedCredits]); return { status: 'reserved', idempotent: false, amount: 1, credits: input.estimatedCredits }; },
    settle: async (input) => { events.push(['settle', input.feature, input.settledCredits, input.rhCostUsd, input.pricingSource]); return { settled_credits: input.settledCredits, balance_after: 90 }; },
    release: async () => { events.push(['release']); return { status: 'released', settled_credits: 0 }; }
  });
  const service = createCompanionChat({
    provider: { baseUrl: 'https://provider.test/v1', model: 'vision-fixture', apiKey: 'fixture-private' },
    charge,
    fetchImpl: async () => Response.json({
      id: 'cmpl-fixture', model: 'vision-fixture',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '已看过。' } }],
      usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24, thirdPartyConsumeMoney: '0.0100', consumeMoney: '9' }
    })
  });
  const result = await service.reply({
    user: { id: 'user' },
    payload: { requestId: 'vision-fixture-123', mode: 'chat', message: '看一下', history: [], images: [{ role: 'attachment', dataUrl: PNG }], uploads: [{ kind: 'video', name: 'clip.mp4' }] }
  });
  assert.equal(events[0][0], 'reserve');
  assert.equal(events[0][1], 'xiaotao-vision');
  assert.equal(events[0][2], estimateXiaotaoOnlineCredits({ text: '看一下', files: [{ kind: 'image' }, { kind: 'video' }] }).credits);
  assert.deepEqual(events[1], ['settle', 'xiaotao-vision', Math.ceil(0.01 * 211 * 2), 0.01, 'rh_consume_money']);
  assert.equal(result.quota.settled_credits, Math.ceil(0.01 * 211 * 2));
  assert.equal(result.quota.billing_mode, 'token');
  let released = 0;
  const failing = createCompanionChat({
    provider: { baseUrl: 'https://provider.test/v1', model: 'fixture', apiKey: 'secret' },
    charge: createOnlineAiCharge({
      reserve: async () => ({ status: 'reserved', idempotent: false, amount: 1, credits: 4 }),
      settle: async () => { throw new Error('failed vision is not charged'); },
      release: async () => { released += 1; return { status: 'released' }; }
    }),
    fetchImpl: async () => new Response('secret upstream detail', { status: 502 })
  });
  await assert.rejects(failing.reply({ user: { id: 'user' }, payload: { requestId: 'vision-fail-1234', mode: 'chat', message: '看一下', history: [], images: [{ role: 'attachment', dataUrl: PNG }] } }), error => error.status === 502 && !String(error.message).includes('secret'));
  assert.equal(released, 1);
});

await test('the composer estimate matches the charge-path formula and local mode is not priced', () => {
  const sandbox = { window: null };
  sandbox.window = sandbox;
  runInContext(readFileSync(new URL('../../renderer/feature-credit-prices.js', import.meta.url), 'utf8'), createContext(sandbox));
  const samples = [
    { text: '你好' },
    { text: '画一张', history: '上一句', files: [{ kind: 'image' }] },
    { text: '配乐', files: [{ kind: 'audio' }, { kind: 'video' }] }
  ];
  for (const sample of samples) {
    assert.equal(sandbox.NovaFlowFeatureCreditPrices.estimateXiaotaoOnline(sample).credits, estimateXiaotaoOnlineCredits(sample).credits);
  }
  const source = readFileSync(new URL('../../renderer/xiaotao-art-agent.js', import.meta.url), 'utf8');
  assert.match(source, /约\$\{quote\.credits\}分/);
  assert.match(source, /实扣 \$\{settled\} \$\{unit\}/);
  assert.match(source, /不扣积分/);
  assert.doesNotMatch(source, /本次将扣 \$\{onlineCreditCost\(\)\}/);
});

await test('a text-only online turn keeps the general chat prompt and token billing', async () => {
  const text = companionInput({ requestId: 'text-only-1234', mode: 'chat', promptLanguage: 'en', message: '你好', history: [] });
  assert.equal(text.textOnly, true);
  assert.match(text.input[0].content[0].text, /使用云端API的智能助手/);
  assert.doesNotMatch(text.input[0].content[0].text, /参考资源/);
  const vision = companionInput({ requestId: 'vision-only-12', mode: 'chat', message: '看图', history: [], images: [{ role: 'attachment', dataUrl: PNG }] });
  assert.equal(vision.textOnly, false);
  assert.match(vision.input[0].content[0].text, /参考资源/);
  const events = [];
  const service = createCompanionChat({
    provider: { baseUrl: 'https://provider.test/v1', model: 'chat-fixture', apiKey: 'fixture-private' },
    charge: createOnlineAiCharge({
      reserve: async (input) => { events.push(['reserve', input.feature, input.estimatedCredits]); return { status: 'reserved', idempotent: false, amount: 1, credits: input.estimatedCredits }; },
      settle: async (input) => { events.push(['settle', input.feature, input.settledCredits]); return { settled_credits: input.settledCredits, balance_after: 90 }; },
      release: async () => ({ status: 'released' })
    }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.match(body.messages[0].content, /使用云端API的智能助手/);
      assert.doesNotMatch(body.messages[0].content, /参考资源/);
      return Response.json({
        id: 'cmpl-text', model: 'chat-fixture',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '你好，我是小桃AI。' } }],
        usage: { thirdPartyConsumeMoney: '0.0100' }
      });
    }
  });
  const result = await service.reply({ user: { id: 'user' }, payload: { requestId: 'text-only-1234', mode: 'chat', promptLanguage: 'en', message: '你好', history: [] } });
  assert.deepEqual(events[0], ['reserve', 'xiaotao-text', estimateXiaotaoOnlineCredits({ text: '你好' }).credits]);
  assert.equal(events[1][2], Math.ceil(0.01 * 211 * 2));
  assert.equal(result.quota.settled_credits, Math.ceil(0.01 * 211 * 2));
});

function num(value) { return Number(value); }

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(await readFile(join(webRoot, 'control-local/src/bootstrap.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20260812030000_grok_quota_reservations.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028010000_settle_grok_quota_failure_does_not_charge.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028140000_feature_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028170000_token_settle_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028180000_xiaotao_online_token_credits.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20261028180000_xiaotao_online_token_credits.sql'), 'utf8'));
  return db;
}

async function addUser(db, balance) {
  const user = (await db.query(
    "insert into public.users (email, display_name, status) values ('xiaotao@novaflow.local', 'xiaotao', 'active') returning id"
  )).rows[0];
  await db.query('insert into public.credits (user_id, balance) values ($1, $2)', [user.id, balance]);
  return user;
}

await test('sql reserves the 小桃 estimate, tops up or refunds under the cap, and never goes negative', async () => {
  const db = await database();
  const user = await addUser(db, 200);
  const flat = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb) as row',
    [user.id, 'flat-text', 'xiaotao-text', '{}']
  )).rows[0].row;
  assert.equal(num(flat.estimated_credits), 4);
  assert.equal(flat.feature, 'online_chat_turn');

  const held = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'estimate-text', 'xiaotao-text', '{}', 64]
  )).rows[0].row;
  assert.equal(held.feature, 'online_chat_turn');
  assert.equal(num(held.estimated_credits), 64);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 132);
  const expiry = (await db.query("select expires_at from public.credit_ledger where usage_key = 'estimate-text'")).rows[0].expires_at;
  assert.ok(new Date(expiry).getTime() > Date.now());

  const vision = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'estimate-vision', 'xiaotao-vision', '{}', 64]
  )).rows[0].row;
  assert.equal(vision.feature, 'xiaotao_vision');
  assert.equal(num(vision.estimated_credits), 64);

  const refunded = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5, $6, $7) as row',
    [user.id, 'estimate-text', 'xiaotao-text', '{}', 10, 0.02, 'rh_consume_money']
  )).rows[0].row;
  assert.equal(num(refunded.settled_credits), 10);
  assert.equal(num(refunded.refunded_credits), 54);
  assert.equal(num(refunded.topup_credits), 0);
  assert.equal(refunded.balance_short, false);

  const topped = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5, null, $6) as row',
    [user.id, 'estimate-vision', 'xiaotao-vision', '{}', 70, 'rh_consume_money']
  )).rows[0].row;
  assert.equal(num(topped.settled_credits), 70);
  assert.equal(num(topped.topup_credits), 6);
  assert.equal(num(topped.refunded_credits), 0);
  assert.equal(topped.reserve_capped, false);

  const overCapHold = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'over-cap', 'online_chat_turn', '{}', 200]
  )).rows[0].row;
  assert.equal(num(overCapHold.estimated_credits), 80);
  const cappedSettle = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5, null, null) as row',
    [user.id, 'over-cap', 'online_chat_turn', '{}', 500]
  )).rows[0].row;
  assert.equal(num(cappedSettle.settled_credits), 80);
  assert.equal(num(cappedSettle.topup_credits), 0);

  await db.query('update public.credits set balance = 25 where user_id = $1', [user.id]);
  const shortHold = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'short-balance', 'xiaotao-text', '{}', 20]
  )).rows[0].row;
  assert.equal(num(shortHold.estimated_credits), 20);
  const short = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5, null, null) as row',
    [user.id, 'short-balance', 'xiaotao-text', '{}', 70]
  )).rows[0].row;
  assert.equal(num(short.settled_credits), 25);
  assert.equal(num(short.topup_credits), 5);
  assert.equal(num(short.uncollected_credits), 45);
  assert.equal(short.balance_short, true);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 0);
  const logged = (await db.query("select pricing_details from public.credit_ledger where usage_key = 'short-balance'")).rows[0].pricing_details;
  assert.equal(logged.balance_short, true);
  assert.equal(num(logged.uncollected_credits), 45);

  await db.query('update public.credits set balance = 100 where user_id = $1', [user.id]);
  const gpt = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'gpt-still-capped', 'gpt_image_2_5_token', '{}', 12]
  )).rows[0].row;
  assert.equal(num(gpt.estimated_credits), 12);
  const gptSettle = (await db.query(
    'select public.settle_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5, null, null) as row',
    [user.id, 'gpt-still-capped', 'gpt_image_2_5_token', '{}', 40]
  )).rows[0].row;
  assert.equal(num(gptSettle.settled_credits), 12);
  assert.equal(gptSettle.reserve_capped, true);
  assert.equal(num(gptSettle.topup_credits), 0);
  await db.close();
});

await test('a stale 小桃 hold is released after the ttl, including on the next reserve', async () => {
  const db = await database();
  const user = await addUser(db, 100);
  const held = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'abandoned', 'xiaotao-text', '{}', 30]
  )).rows[0].row;
  assert.equal(num(held.estimated_credits), 30);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 70);
  const fresh = (await db.query("select public.release_stale_feature_credits(50) as row")).rows[0].row;
  assert.equal(num(fresh.count), 0);
  assert.equal((await db.query("select status from public.credit_ledger where usage_key = 'abandoned'")).rows[0].status, 'reserved');

  await db.query("update public.credit_ledger set expires_at = clock_timestamp() - interval '1 minute' where usage_key = 'abandoned'");
  const swept = (await db.query("select public.release_stale_feature_credits(50) as row")).rows[0].row;
  assert.equal(num(swept.count), 1);
  assert.equal(num(swept.released_credits), 30);
  assert.equal((await db.query("select status, error_code, settled_credits from public.credit_ledger where usage_key = 'abandoned'")).rows[0].status, 'released');
  assert.equal((await db.query("select error_code from public.credit_ledger where usage_key = 'abandoned'")).rows[0].error_code, 'expired');
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 100);
  assert.equal((await db.query("select status from public.grok_quota_reservations where usage_key = 'abandoned'")).rows[0].status, 'released');
  const again = (await db.query("select public.release_stale_feature_credits(50) as row")).rows[0].row;
  assert.equal(num(again.count), 0);
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 100);

  const left = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'left-open', 'xiaotao-vision', '{}', 18]
  )).rows[0].row;
  assert.equal(num(left.estimated_credits), 18);
  await db.query("update public.credit_ledger set expires_at = clock_timestamp() - interval '1 minute' where usage_key = 'left-open'");
  const next = (await db.query(
    'select public.reserve_feature_credits($1, $2, $3, 1, null, $4::jsonb, $5) as row',
    [user.id, 'next-message', 'xiaotao-text', '{}', 10]
  )).rows[0].row;
  assert.equal(num(next.estimated_credits), 10);
  assert.equal((await db.query("select status from public.credit_ledger where usage_key = 'left-open'")).rows[0].status, 'released');
  assert.equal(num((await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 90);
  await db.close();
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
