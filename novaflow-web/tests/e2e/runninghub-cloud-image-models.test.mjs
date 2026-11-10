import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';
import { quoteFeature, DEFAULT_CREDITS_PER_USD, DEFAULT_TOKEN_MARKUP, DEFAULT_RH_COST_USD } from '../../packages/shared/src/feature-credits.mjs';
import {
  CLOUD_IMAGE_MODELS,
  DEFAULT_GPT_IMAGE_I2I_ENDPOINT,
  FALLBACK_GPT_IMAGE_I2I_ENDPOINT,
  cloudImageLine,
  fallbackFor,
  featureForEndpoint,
  mapGptImageParams,
  normalizeCloudImageModel,
  quoteGptImage,
  readRunningHubImageConfig,
  runChargedGptImage
} from '../../packages/shared/src/runninghub-gpt-image.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function config() {
  return readRunningHubImageConfig({ NOVAFLOW_RUNNINGHUB_API_KEY: 'rh-fixture-key-not-real' });
}

function chargeProbe() {
  const events = [];
  const charge = createOnlineAiCharge({
    reserve: async ({ feature, amount }) => { events.push(['reserve', feature, amount]); return { status: 'reserved', idempotent: false, amount }; },
    settle: async ({ feature, amount }) => { events.push(['settle', feature, amount]); return { remaining: 80, balance: 80 }; },
    release: async ({ feature, amount, reason }) => { events.push(['release', feature, amount, reason]); return { remaining: 100, balance: 100 }; }
  });
  return { charge, events };
}

test('the three cheaper lines are priced from the catalog at 211 credits per dollar times two', () => {
  const credits = (usd) => Math.round(usd * DEFAULT_CREDITS_PER_USD * DEFAULT_TOKEN_MARKUP);
  assert.equal(quoteFeature({ feature: 'nano-banana-2.1' }).credits, credits(0.03));
  assert.equal(quoteFeature({ feature: 'nano-banana-2.1' }).credits, 13);
  assert.equal(quoteFeature({ feature: 'gpt-image-2-edit' }).credits, credits(0.027));
  assert.equal(quoteFeature({ feature: 'gpt-image-2-edit' }).credits, 11);
  assert.equal(quoteFeature({ feature: 'grok-imagine' }).credits, credits(0.02));
  assert.equal(quoteFeature({ feature: 'grok-imagine' }).credits, 8);
  assert.equal(quoteFeature({ feature: 'gpt-image-2' }).credits, 4);
  assert.equal(DEFAULT_RH_COST_USD.nano_banana_21, 0.03);
  assert.equal(DEFAULT_RH_COST_USD.gpt_image_2_edit, 0.027);
  assert.equal(DEFAULT_RH_COST_USD.grok_image_official, 0.02);
});

test('unknown model ids fall back to GPT Image 2.5 and keep its configurable route', () => {
  assert.equal(normalizeCloudImageModel(''), 'gpt-image-2.5');
  assert.equal(normalizeCloudImageModel('something-else'), 'gpt-image-2.5');
  assert.equal(cloudImageLine('gpt-image-2.5', 'img2img'), null);
  const quote = quoteGptImage({ mode: 'img2img', model: 'nope', settings: { size: '1024x1024' } });
  assert.equal(quote.endpoint, DEFAULT_GPT_IMAGE_I2I_ENDPOINT);
  assert.equal(quote.feature, 'gpt_image_2_5_economy');
});

test('each line quotes its own fixed price per image and never falls back', () => {
  const banana = quoteGptImage({ mode: 'img2img', model: 'nano-banana-2.1', count: 2, settings: { size: '1152x2048' } });
  assert.equal(banana.endpoint, CLOUD_IMAGE_MODELS['nano-banana-2.1'].img2img);
  assert.equal(banana.feature, 'nano_banana_21');
  assert.equal(banana.billingMode, 'fixed');
  assert.equal(banana.perImage, 13);
  assert.equal(banana.credits, 26);
  assert.equal(banana.mayFallback, false);
  const gpt2 = quoteGptImage({ mode: 'img2img', model: 'gpt-image-2', settings: { size: '1024x1024' } });
  assert.equal(gpt2.feature, 'gpt_image_2_edit');
  assert.equal(gpt2.credits, 11);
  assert.equal(gpt2.endpoint, FALLBACK_GPT_IMAGE_I2I_ENDPOINT);
  const gpt2Text = quoteGptImage({ mode: 'txt2img', model: 'gpt-image-2', settings: { size: '1024x1024' } });
  assert.equal(gpt2Text.feature, 'gpt_image_2_official');
  assert.equal(gpt2Text.credits, 4);
  const grok = quoteGptImage({ mode: 'txt2img', model: 'grok-imagine', settings: { size: '1024x1024' } });
  assert.equal(grok.feature, 'grok_image_official');
  assert.equal(grok.credits, 8);
  assert.equal(fallbackFor(CLOUD_IMAGE_MODELS['nano-banana-2.1'].img2img), '');
  assert.equal(fallbackFor(CLOUD_IMAGE_MODELS['grok-imagine'].txt2img), '');
  // The official GPT Image 2 routes stay the 2.5 fallback target, and are still the same endpoints.
  assert.equal(featureForEndpoint(FALLBACK_GPT_IMAGE_I2I_ENDPOINT, { mode: 'img2img' }), 'gpt_image_2_official');
  assert.equal(featureForEndpoint(CLOUD_IMAGE_MODELS['nano-banana-2.1'].txt2img), 'nano_banana_21');
});

test('request bodies carry only the fields RunningHub documents for each line and snap ratios to the line', () => {
  const banana = mapGptImageParams({ mode: 'img2img', model: 'nano-banana-2.1', prompt: '换成北欧神话主题', images: ['https://cdn.example/a.png'], settings: { customWidth: 944, customHeight: 2048 } });
  assert.equal(banana.endpoint, '/openapi/v2/rhart-image-n-nb21-official/image-to-image');
  assert.deepEqual(banana.body, { prompt: '换成北欧神话主题', aspectRatio: '9:16', resolution: '2k', thinkingLevel: 'medium', imageUrls: ['https://cdn.example/a.png'] });
  assert.equal(banana.model, 'nano-banana-2.1');

  const bananaText = mapGptImageParams({ mode: 'txt2img', model: 'nano-banana-2.1', prompt: '一张海报', settings: { size: '1536x1024' } });
  assert.deepEqual(bananaText.body, { prompt: '一张海报', aspectRatio: '3:2', resolution: '1k', thinkingLevel: 'medium' });

  const gpt2 = mapGptImageParams({ mode: 'img2img', model: 'gpt-image-2', prompt: '改成夜景', images: ['https://cdn.example/a.png', 'https://cdn.example/b.png'], settings: { customWidth: 944, customHeight: 2048, quality: 'high' } });
  assert.equal(gpt2.endpoint, '/openapi/v2/rhart-image-g-2-official/image-to-image');
  // GPT Image 2 lists 9:21, so the tall screen keeps its own ratio there.
  assert.deepEqual(gpt2.body, { prompt: '改成夜景', aspectRatio: '9:21', resolution: '2k', quality: 'high', imageUrls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'] });

  const grokEdit = mapGptImageParams({ mode: 'img2img', model: 'grok-imagine', prompt: '把背景换成雪山', images: ['https://cdn.example/a.png'], settings: { size: '1024x1024' } });
  assert.equal(grokEdit.endpoint, '/openapi/v2/rhart-image-x-official/edit');
  assert.deepEqual(grokEdit.body, { prompt: '把背景换成雪山', image: 'https://cdn.example/a.png' });

  const grokText = mapGptImageParams({ mode: 'txt2img', model: 'grok-imagine', prompt: '雪山下的村庄', settings: { customWidth: 944, customHeight: 2048 } });
  assert.equal(grokText.endpoint, '/openapi/v2/rhart-image-x-official/text-to-image');
  assert.deepEqual(grokText.body, { prompt: '雪山下的村庄', aspectRatio: '9:20', outputFormat: 'png' });

  assert.throws(() => mapGptImageParams({ mode: 'img2img', model: 'grok-imagine', prompt: '两张图', images: ['https://cdn.example/a.png', 'https://cdn.example/b.png'] }), /最多 1 张参考图/);
  assert.throws(() => mapGptImageParams({ mode: 'txt2img', model: 'grok-imagine', prompt: '短' }), /至少 5 个字/);
});

test('a charged Nano Banana run settles at its own fixed price and sends its own endpoint', async () => {
  const { charge, events } = chargeProbe();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([String(url), typeof init?.body === 'string' ? JSON.parse(init.body) : null]);
    if (String(url).includes('/media/upload/binary')) return Response.json({ code: 0, data: { download_url: 'https://cdn.example/up.png' } });
    if (String(url).endsWith('/image-to-image')) return Response.json({ taskId: 't-1', status: 'RUNNING' });
    if (String(url).endsWith('/query')) return Response.json({ taskId: 't-1', status: 'SUCCESS', results: [{ url: 'https://cdn.example/out.png' }] });
    if (String(url) === 'https://cdn.example/out.png') return new Response(Buffer.from('png'), { headers: { 'content-type': 'image/png' } });
    throw new Error('unexpected ' + url);
  };
  const outcome = await runChargedGptImage({
    charge, config: config(), fetchImpl, sleep: async () => {},
    request: { userId: 'u1', usageKey: 'k1', mode: 'img2img', model: 'nano-banana-2.1', prompt: '换主题', images: [{ dataUrl: png }], settings: { customWidth: 1152, customHeight: 2048 }, width: 1152, height: 2048 }
  });
  assert.equal(outcome.charged, 13);
  assert.equal(outcome.quote.feature, 'nano_banana_21');
  assert.deepEqual(events, [['reserve', 'nano_banana_21', 1], ['settle', 'nano_banana_21', 1]]);
  const submit = calls.find(([url]) => url.endsWith('/image-to-image'));
  assert.equal(submit[0], 'https://www.runninghub.ai/openapi/v2/rhart-image-n-nb21-official/image-to-image');
  assert.deepEqual(submit[1], { prompt: '换主题', aspectRatio: '9:16', resolution: '2k', thinkingLevel: 'medium', imageUrls: ['https://cdn.example/up.png'] });
  assert.equal(outcome.results[0].image.fellBack, false);
});

test('a fixed line that is missing on RunningHub releases the hold instead of silently running GPT Image 2', async () => {
  const { charge, events } = chargeProbe();
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/text-to-image')) return Response.json({ code: 1001, msg: 'not found' });
    throw new Error('unexpected ' + url);
  };
  await assert.rejects(runChargedGptImage({
    charge, config: config(), fetchImpl, sleep: async () => {},
    request: { userId: 'u1', usageKey: 'k2', mode: 'txt2img', model: 'grok-imagine', prompt: '雪山下的村庄', settings: { size: '1024x1024' } }
  }), /1001/);
  assert.equal(events.filter(([kind]) => kind === 'settle').length, 0);
  assert.equal(events.some(([kind]) => kind === 'release'), true);
});
