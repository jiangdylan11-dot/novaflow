// 小桃 online billing: estimate from text and staged files, settle from RH usage.
// No live RunningHub calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import {
  creditsFromUsd,
  estimateXiaotaoOnlineCredits,
  settleXiaotaoOnlineCredits,
  xiaotaoOnlinePolicy
} from '../../packages/shared/src/feature-credits.mjs';
import { createCompanionChat } from '../../packages/shared/src/companion-chat.mjs';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';

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

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
