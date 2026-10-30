import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';
import {
  DEFAULT_GPT_IMAGE_ENDPOINT,
  DEFAULT_GPT_IMAGE_I2I_ENDPOINT,
  FALLBACK_GPT_IMAGE_ENDPOINT,
  FALLBACK_GPT_IMAGE_I2I_ENDPOINT,
  DEFAULT_IMAGE_BASE_URL,
  DEFAULT_IMAGE_PRICES,
  UPLOAD_PATH,
  formatChargedRemaining,
  formatCreditButtonLabel,
  formatCreditButtonTitle,
  mapGptImageParams,
  quoteGptImage,
  readRunningHubImageConfig,
  runChargedGptImage,
  readImagePoolAccount,
  uploadReferenceImage,
  poolBlocksNewTask
} from '../../packages/shared/src/runninghub-gpt-image.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('the server image route checks live pool balance and never falls back to a stale or rejected account',async()=>{
  let url,body;
  const config={baseUrl:'https://www.runninghub.ai',apiKey:'fixture'};
  const account=await readImagePoolAccount(config,async(u,init)=>{url=u;body=JSON.parse(init.body);return Response.json({code:0,data:{remainMoney:'12.34'}});});
  assert.equal(url,'https://www.runninghub.ai/uc/openapi/accountStatus');assert.equal(body.apikey,'fixture');assert.equal(account.balance.money,12.34);assert.doesNotMatch(JSON.stringify(account),/fixture/);
  await assert.rejects(readImagePoolAccount(config,async()=>Response.json({code:806,data:null})),/无法核对云服务账户/);
});

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

test('empty text endpoint defaults to stable-token and estimates 1k medium', () => {
  const cfg = config('');
  assert.equal(cfg.gptImageEndpoint, DEFAULT_GPT_IMAGE_ENDPOINT);
  assert.equal(cfg.gptImageI2iEndpoint, DEFAULT_GPT_IMAGE_I2I_ENDPOINT);
  assert.equal(cfg.apiKey, 'rh-fixture-key-not-real');
  const quote = quoteGptImage({ endpoint: cfg.gptImageEndpoint, count: 2, prices: cfg.prices });
  assert.equal(quote.feature, 'gpt_image_2_5_token');
  assert.equal(quote.billingMode, 'token');
  assert.equal(quote.mayFallback, true);
  assert.equal(quote.perImage, 6);
  assert.equal(quote.credits, 12);
  assert.equal(quote.credits <= quote.settleCap * quote.count, true);
  assert.equal(formatCreditButtonLabel(quote.credits, quote), '生成 · 约12分');
});

test('official fallback endpoint is priced at 4 and admin prices override both', () => {
  const quote = quoteGptImage({ endpoint: FALLBACK_GPT_IMAGE_ENDPOINT, count: 3, prices: { gpt_image_2_official: 9, gpt_image_2_5: 30 } });
  assert.equal(quote.feature, 'gpt_image_2_official');
  assert.equal(quote.perImage, 9);
  assert.equal(quote.credits, 27);
  assert.equal(formatCreditButtonLabel(quote.credits), '生成 · 27分');
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
  assert.equal(edit.endpoint, DEFAULT_GPT_IMAGE_I2I_ENDPOINT);
  assert.notEqual(edit.endpoint, DEFAULT_GPT_IMAGE_ENDPOINT.replace(/\/text-to-image$/, '/image-to-image'));
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
  assert.equal(formatCreditButtonLabel(quote.credits, quote), '生成 · 约12分');
  assert.equal(outcome.charged, quote.credits);
  assert.equal(outcome.quote.credits, quote.credits);
  assert.equal(outcome.quote.feature, 'gpt_image_2_5_token');
  assert.deepEqual(events.filter((item) => item[0] === 'settle').map((item) => item.slice(0, 3)), [['settle', 'gpt_image_2_5_token', 1], ['settle', 'gpt_image_2_5_token', 1]]);
  assert.equal(events.some((item) => item[0] === 'release'), false);
  assert.equal(formatChargedRemaining(outcome.charged, outcome.remaining), '本次扣 12积分，剩余 80');
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
  assert.deepEqual(events, [['reserve', 'gpt_image_2_official', 1], ['release', 'gpt_image_2_official', 1, 'moderation']]);
});

test('a 2.5 endpoint 404 falls back to official GPT Image 2 and settles at the official price', async () => {
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
  assert.ok(seen.some((href) => href.includes(FALLBACK_GPT_IMAGE_ENDPOINT)));
  assert.equal(quote.feature, 'gpt_image_2_5_token');
  assert.equal(outcome.quote.credits, 12);
  assert.equal(outcome.quote.credits <= outcome.quote.settleCap, true);
  assert.equal(outcome.charged, 4);
  assert.deepEqual(events.map((item) => item.slice(0, 3)), [
    ['reserve', 'gpt_image_2_5_token', 1],
    ['release', 'gpt_image_2_5_token', 1],
    ['reserve', 'gpt_image_2_official', 1],
    ['settle', 'gpt_image_2_official', 1]
  ]);
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
  assert.equal(label, formatCreditButtonLabel(quote.credits, quote));
  assert.equal(label, '生成 · 约6分');
  assert.match(pricing.getButtonTitle(snapshot), /预估上限 6 积分/);
  assert.match(pricing.getButtonTitle(snapshot), /若回退官方通道，实扣可能更低/);
  assert.equal(formatCreditButtonTitle(quote.credits, quote), pricing.getButtonTitle(snapshot));
  pricing.recordSettlement({
    promptId: 'rh-task-1',
    settlement: { status: 'settled', charge_amount: quote.perImage },
    credits: { balance: 78, deducted: quote.perImage }
  });
  const view = pricing.getProgressView({ promptId: 'rh-task-1' });
  assert.equal(view.text, formatChargedRemaining(quote.perImage, 78));
  const storedGoogle = pricing.createSnapshot({ provider: 'google', mode: 'txt2img' });
  assert.equal(storedGoogle.provider, 'local');
  assert.equal(pricing.getButtonLabel(storedGoogle), '生成');
});

test('image-to-image uses its own 2.5 endpoint and falls back to official on an empty taskId', async () => {
  const cfg = config('');
  const quote = quoteGptImage({ mode: 'img2img', imageEndpoint: cfg.gptImageI2iEndpoint, count: 1, prices: cfg.prices });
  assert.equal(quote.endpoint, DEFAULT_GPT_IMAGE_I2I_ENDPOINT);
  assert.equal(quote.feature, 'gpt_image_2_5_economy');
  assert.equal(quote.billingMode, 'fixed');
  assert.equal(quote.credits, 20);
  assert.equal(quote.perImage, DEFAULT_IMAGE_PRICES.gpt_image_2_5_economy);
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.includes(DEFAULT_GPT_IMAGE_I2I_ENDPOINT)) return { ok: true, status: 200, json: async () => ({ code: 0, data: {} }) };
    if (href.endsWith('/query')) {
      return { ok: true, json: async () => ({ taskId: 'i2i', status: 'SUCCESS', results: [{ url: 'https://cdn.example/i2i.png' }] }) };
    }
    if (href === 'https://cdn.example/i2i.png') {
      return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
    }
    return { ok: true, status: 200, json: async () => ({ taskId: 'i2i', status: 'QUEUED' }) };
  };
  const { charge, events } = chargeProbe();
  const outcome = await runChargedGptImage({
    charge, config: cfg, fetchImpl, sleep: async () => {},
    request: { userId: 'user-1', usageKey: 'img-i2i', count: 1, mode: 'img2img', prompt: '夜景', images: ['https://cdn.example/in.png'], settings: { size: '1024x1024', quality: 'medium' } }
  });
  assert.equal(outcome.mapped.endpoint, DEFAULT_GPT_IMAGE_I2I_ENDPOINT);
  assert.ok(seen.includes(`${cfg.baseUrl}${FALLBACK_GPT_IMAGE_I2I_ENDPOINT}`));
  assert.equal(seen.some((href) => href.includes('official-token/sunburst/image-to-image')), false);
  assert.equal(outcome.charged, 4);
  assert.equal(events.filter((item) => item[0] === 'release').length, 1);
  assert.equal(events.at(-1)[1], 'gpt_image_2_official');
});

test('upload follows the configured image host and defaults to the international site', async () => {
  const international = readRunningHubImageConfig({ NOVAFLOW_RUNNINGHUB_API_KEY: 'rh-fixture-key-not-real' });
  assert.equal(international.baseUrl, DEFAULT_IMAGE_BASE_URL);
  assert.equal(international.baseUrl, 'https://www.runninghub.ai');
  assert.equal(international.uploadBaseUrl, international.baseUrl);
  const seen = [];
  const uploaded = await uploadReferenceImage({
    config: international,
    bytes: png,
    fetchImpl: async (url) => {
      seen.push(String(url));
      return { ok: true, status: 200, json: async () => ({ data: { downloadUrl: 'https://cdn.example/up.png' } }) };
    }
  });
  assert.equal(uploaded, 'https://cdn.example/up.png');
  assert.equal(seen[0], `https://www.runninghub.ai${UPLOAD_PATH}`);
  const domestic = readRunningHubImageConfig({
    NOVAFLOW_RUNNINGHUB_API_KEY: 'rh-fixture-key-not-real',
    NOVAFLOW_RUNNINGHUB_BASE_URL: 'https://www.runninghub.cn'
  });
  assert.equal(domestic.baseUrl, 'https://www.runninghub.cn');
  assert.equal(domestic.uploadBaseUrl, 'https://www.runninghub.cn');
  const customUpload = readRunningHubImageConfig({
    NOVAFLOW_RUNNINGHUB_API_KEY: 'rh-fixture-key-not-real',
    NOVAFLOW_RUNNINGHUB_BASE_URL: 'https://www.runninghub.ai',
    NOVAFLOW_RUNNINGHUB_UPLOAD_BASE_URL: 'https://www.runninghub.cn'
  });
  assert.equal(customUpload.baseUrl, 'https://www.runninghub.ai');
  assert.equal(customUpload.uploadBaseUrl, 'https://www.runninghub.cn');
  assert.throws(() => readRunningHubImageConfig({
    NOVAFLOW_RUNNINGHUB_API_KEY: 'rh-fixture-key-not-real',
    NOVAFLOW_RUNNINGHUB_BASE_URL: 'https://evil.example'
  }), /runninghub\.ai/);
});

test('HTTP 200 errorCode 1001 falls back once, and a second 1001 releases the hold in Chinese', async () => {
  const cfg = config('');
  const { charge, events } = chargeProbe();
  let posts = 0;
  await assert.rejects(() => runChargedGptImage({
    charge,
    config: cfg,
    fetchImpl: async () => {
      posts += 1;
      return { ok: true, status: 200, json: async () => ({ errorCode: 1001, msg: 'endpoint missing secret' }) };
    },
    request: { userId: 'user-1', usageKey: 'img-1001', count: 1, mode: 'txt2img', prompt: '海', settings: { size: '1024x1024' } }
  }), (error) => error.moderation !== true && /出图接口不存在（1001）/.test(error.message) && !/secret/.test(error.message));
  assert.equal(posts, 2);
  assert.deepEqual(events.map((item) => item.slice(0, 3)), [
    ['reserve', 'gpt_image_2_5_token', 1],
    ['release', 'gpt_image_2_5_token', 1]
  ]);
});

test('an empty taskId with no fallback left releases the hold and says so in Chinese', async () => {
  const cfg = config(FALLBACK_GPT_IMAGE_ENDPOINT);
  const { charge, events } = chargeProbe();
  let posts = 0;
  await assert.rejects(() => runChargedGptImage({
    charge,
    config: cfg,
    fetchImpl: async () => {
      posts += 1;
      return { ok: true, status: 200, json: async () => ({ code: 0, data: {} }) };
    },
    request: { userId: 'user-1', usageKey: 'img-empty', count: 1, mode: 'txt2img', prompt: '海', settings: { size: '1024x1024' } }
  }), /出图服务没有返回任务编号/);
  assert.equal(posts, 1);
  assert.deepEqual(events.map((item) => item.slice(0, 3)), [
    ['reserve', 'gpt_image_2_official', 1],
    ['release', 'gpt_image_2_official', 1]
  ]);
});
