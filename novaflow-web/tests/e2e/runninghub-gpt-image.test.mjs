import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';
import {
  DEFAULT_GPT_IMAGE_ENDPOINT,
  FALLBACK_GPT_IMAGE_ENDPOINT,
  DEFAULT_IMAGE_PRICES,
  formatChargedRemaining,
  formatCreditButtonLabel,
  mapGptImageParams,
  quoteGptImage,
  readRunningHubImageConfig,
  runChargedGptImage,
  poolBlocksNewTask
} from '../../packages/shared/src/runninghub-gpt-image.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function chargeProbe() {
  const events = [];
  const charge = createOnlineAiCharge({
    reserve: async ({ feature, amount }) => {
      events.push(['reserve', feature, amount]);
      return { status: 'reserved', idempotent: false, amount };
    },
    settle: async ({ feature, amount }) => {
      events.push(['settle', feature, amount]);
      return { remaining: 80, balance: 80 };
    },
    release: async ({ feature, amount, reason }) => {
      events.push(['release', feature, amount, reason]);
      return { remaining: 100, balance: 100 };
    }
  });
  return { charge, events };
}

function config(endpoint = '') {
  return readRunningHubImageConfig({
    NOVAFLOW_RUNNINGHUB_API_KEY: 'rh-fixture-key-not-real',
    NOVAFLOW_RUNNINGHUB_BASE_URL: 'https://www.runninghub.cn',
    NOVAFLOW_RUNNINGHUB_GPT_IMAGE_ENDPOINT: endpoint
  });
}

test('empty endpoint defaults to GPT Image 2.5 and prices that model at 22', () => {
  const cfg = config('');
  assert.equal(cfg.gptImageEndpoint, DEFAULT_GPT_IMAGE_ENDPOINT);
  assert.equal(cfg.apiKey, 'rh-fixture-key-not-real');
  const quote = quoteGptImage({ endpoint: cfg.gptImageEndpoint, count: 2, prices: cfg.prices });
  assert.equal(quote.feature, 'gpt_image_2_5');
  assert.equal(quote.perImage, DEFAULT_IMAGE_PRICES.gpt_image_2_5);
  assert.equal(quote.credits, 44);
  assert.equal(formatCreditButtonLabel(quote.credits), '开始生成 · 44积分');
});

test('official fallback endpoint is priced at 4 and admin prices override both', () => {
  const quote = quoteGptImage({ endpoint: FALLBACK_GPT_IMAGE_ENDPOINT, count: 3, prices: { gpt_image_2_official: 9, gpt_image_2_5: 30 } });
  assert.equal(quote.feature, 'gpt_image_2_official');
  assert.equal(quote.perImage, 9);
  assert.equal(quote.credits, 27);
  assert.equal(formatCreditButtonLabel(quote.credits), '开始生成 · 27积分');
});

test('ratio, resolution and reference images map onto RunningHub fields', () => {
  const text = mapGptImageParams({
    mode: 'txt2img',
    prompt: '一张海报',
    settings: { size: '1536x1024', quality: 'high' },
    endpoint: DEFAULT_GPT_IMAGE_ENDPOINT
  });
  assert.equal(text.endpoint, DEFAULT_GPT_IMAGE_ENDPOINT);
  assert.deepEqual(text.body, { prompt: '一张海报', aspectRatio: '3:2', resolution: '1k', quality: 'high' });

  const custom = mapGptImageParams({
    mode: 'txt2img',
    prompt: '竖图',
    settings: { size: 'Custom', customWidth: 2160, customHeight: 3840, quality: 'low' },
    endpoint: FALLBACK_GPT_IMAGE_ENDPOINT
  });
  assert.equal(custom.body.aspectRatio, '9:16');
  assert.equal(custom.body.resolution, '4k');
  assert.equal(custom.body.quality, 'low');

  const edit = mapGptImageParams({
    mode: 'img2img',
    prompt: '改成夜景',
    settings: { size: '1024x1024', quality: 'medium' },
    images: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
    endpoint: DEFAULT_GPT_IMAGE_ENDPOINT
  });
  assert.equal(edit.endpoint, DEFAULT_GPT_IMAGE_ENDPOINT.replace(/\/text-to-image$/, '/image-to-image'));
  assert.deepEqual(edit.body.imageUrls, ['https://cdn.example/a.png', 'https://cdn.example/b.png']);
  assert.equal(edit.body.aspectRatio, '1:1');
  assert.equal(edit.body.resolution, '1k');
});

test('pre-display equals the sum of per-image charges', async () => {
  const cfg = config('');
  const quote = quoteGptImage({ endpoint: cfg.gptImageEndpoint, count: 2, prices: cfg.prices });
  const { charge, events } = chargeProbe();
  let posts = 0;
  const fetchImpl = async (url) => {
    posts += 1;
    if (String(url).endsWith('/query')) {
      return { ok: true, json: async () => ({ taskId: 't1', status: 'SUCCESS', results: [{ url: 'https://cdn.example/out.png', outputType: 'png' }] }) };
    }
    if (String(url) === 'https://cdn.example/out.png') {
      return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
    }
    return { ok: true, status: 200, json: async () => ({ taskId: 't1', status: 'QUEUED', results: null }) };
  };
  const outcome = await runChargedGptImage({
    charge,
    config: cfg,
    fetchImpl,
    sleep: async () => {},
    request: { userId: 'user-1', usageKey: 'img-batch', count: 2, mode: 'txt2img', prompt: '海', settings: { size: '1024x1024', quality: 'medium' } }
  });
  assert.equal(formatCreditButtonLabel(quote.credits), '开始生成 · 44积分');
  assert.equal(outcome.charged, quote.credits);
  assert.equal(outcome.quote.credits, quote.credits);
  assert.deepEqual(events.filter((item) => item[0] === 'settle').map((item) => item[2]), [22, 22]);
  assert.equal(events.some((item) => item[0] === 'release'), false);
  assert.equal(formatChargedRemaining(outcome.charged, outcome.remaining), '本次扣 44积分，剩余 80');
  assert.ok(posts >= 2);
  assert.equal(JSON.stringify(outcome).includes('rh-fixture-key-not-real'), false);
});

test('content moderation releases the hold and does not settle', async () => {
  const cfg = config(FALLBACK_GPT_IMAGE_ENDPOINT);
  const quote = quoteGptImage({ endpoint: cfg.gptImageEndpoint, count: 1, prices: cfg.prices });
  const { charge, events } = chargeProbe();
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { code: 'invalid_prompt', message: 'upstream-secret-prompt' } })
  });
  const outcome = await runChargedGptImage({
    charge,
    config: cfg,
    fetchImpl,
    request: { userId: 'user-1', usageKey: 'img-mod', count: 1, mode: 'txt2img', prompt: 'bad', settings: { size: '1024x1024', quality: 'low' } }
  });
  assert.equal(quote.perImage, 4);
  assert.equal(outcome.charged, 0);
  assert.equal(outcome.results[0].success, false);
  assert.match(outcome.results[0].message, /审核/);
  assert.equal(outcome.results[0].message.includes('upstream-secret'), false);
  assert.deepEqual(events, [['reserve', 'gpt_image_2_official', 4], ['release', 'gpt_image_2_official', 4, 'moderation']]);
});

test('a 2.5 endpoint 404 falls back to the official path without changing the quoted price', async () => {
  const cfg = config('');
  const quote = quoteGptImage({ endpoint: cfg.gptImageEndpoint, count: 1, prices: cfg.prices });
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.includes('rhart-image-g-2.5')) return { ok: false, status: 404, json: async () => ({}) };
    if (href.endsWith('/query')) {
      return { ok: true, json: async () => ({ taskId: 't2', status: 'SUCCESS', results: [{ url: 'https://cdn.example/fallback.png' }] }) };
    }
    if (href === 'https://cdn.example/fallback.png') {
      return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
    }
    return { ok: true, status: 200, json: async () => ({ taskId: 't2', status: 'RUNNING' }) };
  };
  const { charge, events } = chargeProbe();
  const outcome = await runChargedGptImage({
    charge, config: cfg, fetchImpl, sleep: async () => {},
    request: { userId: 'user-1', usageKey: 'img-fb', count: 1, mode: 'txt2img', prompt: '海', settings: { size: '2048x1152', quality: 'medium' } }
  });
  assert.ok(seen.some((href) => href.includes('rhart-image-g-2.5')));
  assert.ok(seen.some((href) => href.includes('rhart-image-g-2-official/text-to-image')));
  assert.equal(outcome.charged, quote.credits);
  assert.equal(events[1][2], 22);
  assert.equal(outcome.mapped.body.aspectRatio, '16:9');
  assert.equal(outcome.mapped.body.resolution, '2k');
});

test('a low RunningHub pool balance blocks before any charge', async () => {
  const { charge, events } = chargeProbe();
  await assert.rejects(() => runChargedGptImage({
    charge,
    config: config(''),
    poolAccount: { balance: { money: 1 } },
    fetchImpl: async () => { throw new Error('should not call RunningHub'); },
    request: { userId: 'user-1', usageKey: 'img-block', count: 1, mode: 'txt2img', prompt: '海', settings: { size: '1024x1024' } }
  }), (error) => error.noCharge === true && /未扣积分/.test(error.message));
  assert.deepEqual(events, []);
  assert.equal(poolBlocksNewTask({ balance: { money: 2 } }, 2), false);
});

test('the image button label is the same quote the charge uses', () => {
  const context = { module: { exports: {} }, exports: {}, console };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL('../../renderer/art-generate-credit-pricing.tool.js', import.meta.url), 'utf8'), context);
  const pricing = context.module.exports;
  const quote = quoteGptImage({ endpoint: DEFAULT_GPT_IMAGE_ENDPOINT, count: 1, prices: DEFAULT_IMAGE_PRICES });
  const snapshot = pricing.createSnapshot({ provider: 'gpt', mode: 'txt2img', count: 1, gptSize: '1024x1024', gptQualityTxt2img: 'medium' }, {
    quoteGptImage: () => quote
  });
  const label = pricing.getButtonLabel(snapshot);
  assert.equal(label, formatCreditButtonLabel(quote.credits));
  assert.equal(label, '开始生成 · 22积分');
  pricing.recordSettlement({
    promptId: 'rh-task-1',
    settlement: { status: 'settled', charge_amount: quote.perImage },
    credits: { balance: 78, deducted: quote.perImage }
  });
  const view = pricing.getProgressView({ promptId: 'rh-task-1' });
  assert.equal(view.text, formatChargedRemaining(quote.perImage, 78));
  const storedGoogle = pricing.createSnapshot({ provider: 'google', mode: 'txt2img' });
  assert.equal(storedGoogle.provider, 'local');
  assert.equal(pricing.getButtonLabel(storedGoogle), '开始生成');
});
