import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GPT_IMAGE_TICKET_TTL_MS,
  beginChargedGptImage,
  finishChargedGptImage,
  readRunningHubImageConfig,
  releaseStaleGptImageHolds,
  validateGptImageTicket
} from '../../packages/shared/src/runninghub-gpt-image.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function config() {
  return readRunningHubImageConfig({ NOVAFLOW_RUNNINGHUB_API_KEY: 'rh-fixture-key-not-real' });
}

function ports() {
  const events = [];
  return {
    events,
    reserve: async ({ feature, amount, usageKey, estimatedCredits }) => { events.push(['reserve', feature, amount, usageKey, estimatedCredits ?? null]); return { status: 'reserved', idempotent: false, amount }; },
    settle: async ({ feature, amount, usageKey, settledCredits }) => { events.push(['settle', feature, amount, usageKey, settledCredits ?? null]); return { status: 'settled', settled_credits: settledCredits ?? 13, balance_after: 80 }; },
    release: async ({ feature, usageKey, reason }) => { events.push(['release', feature, usageKey, reason]); return { status: 'released', balance_after: 100 }; }
  };
}

// RunningHub stand-in: upload, submit, N pending queries, then success (or a failure).
function provider({ pendingQueries = 1, finalStatus = 'SUCCESS', failPayload = null, submitStatus = 200, submitPayload = null } = {}) {
  const calls = [];
  let queries = 0;
  const fetchImpl = async (url, init) => {
    const where = String(url);
    calls.push([where, typeof init?.body === 'string' ? JSON.parse(init.body) : null]);
    if (where.includes('/media/upload/binary')) return Response.json({ code: 0, data: { download_url: 'https://cdn.example/up.png' } });
    if (where.endsWith('/image-to-image') || where.endsWith('/text-to-image') || where.endsWith('/edit')) {
      if (submitPayload) return Response.json(submitPayload, { status: submitStatus });
      return Response.json({ taskId: 't-77', status: 'QUEUED' });
    }
    if (where.endsWith('/query')) {
      queries += 1;
      if (queries <= pendingQueries) return Response.json({ taskId: 't-77', status: 'RUNNING' });
      if (finalStatus === 'FAILED') return Response.json(failPayload || { taskId: 't-77', status: 'FAILED', errorCode: '1501', errorMessage: 'Content verification failed' });
      return Response.json({ taskId: 't-77', status: 'SUCCESS', results: [{ url: 'https://cdn.example/out.png' }] });
    }
    if (where === 'https://cdn.example/out.png') return new Response(Buffer.from('png'), { headers: { 'content-type': 'image/png' } });
    throw new Error('unexpected ' + where);
  };
  return { fetchImpl, calls };
}

const request = (extra = {}) => ({ userId: 'u1', usageKey: 'gptimg_u1_k1', mode: 'img2img', model: 'nano-banana-2.1', prompt: '换成北欧神话主题', images: [{ dataUrl: png }], settings: { customWidth: 1152, customHeight: 2048 }, width: 1152, height: 2048, ...extra });

test('begin reserves the fixed hold, submits the line and hands back a ticket that names the task', async () => {
  const p = ports(), rh = provider();
  const begun = await beginChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, request: request() });
  assert.equal(begun.taskId, 't-77');
  assert.equal(begun.ticket.feature, 'nano_banana_21');
  assert.equal(begun.ticket.perImage, 13);
  assert.equal(begun.ticket.reserved, true);
  assert.equal(begun.ticket.endpoint, '/openapi/v2/rhart-image-n-nb21-official/image-to-image');
  assert.equal(begun.ticket.expiresAt - begun.ticket.startedAt, GPT_IMAGE_TICKET_TTL_MS);
  assert.deepEqual(p.events, [['reserve', 'nano_banana_21', 1, 'gptimg_u1_k1', null]]);
  const submit = rh.calls.find(([url]) => url.endsWith('/image-to-image'));
  assert.deepEqual(submit[1], { prompt: '换成北欧神话主题', aspectRatio: '9:16', resolution: '2k', thinkingLevel: 'medium', imageUrls: ['https://cdn.example/up.png'] });
  assert.deepEqual(validateGptImageTicket(JSON.parse(JSON.stringify(begun.ticket))).usageKey, 'gptimg_u1_k1');
});

test('finish stays pending while RunningHub runs, then downloads and settles the hold once', async () => {
  const p = ports(), rh = provider({ pendingQueries: 2 });
  const begun = await beginChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, request: request() });
  const first = await finishChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, ticket: begun.ticket });
  assert.deepEqual(first, { ok: true, pending: true, status: 'RUNNING' });
  const second = await finishChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, ticket: begun.ticket });
  assert.equal(second.pending, true);
  const done = await finishChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, ticket: begun.ticket });
  assert.equal(done.ok, true);
  assert.equal(done.pending, false);
  assert.equal(done.charged, 13);
  assert.equal(done.remaining, 80);
  assert.match(done.image.imageDataUrl, /^data:image\/png;base64,/);
  assert.equal(done.billing.chargedCredits, 13);
  assert.equal(p.events.filter(([kind]) => kind === 'settle').length, 1);
  assert.equal(p.events.some(([kind]) => kind === 'release'), false);
});

test('a failed task releases the hold and says why (a plain provider failure is not a moderation refusal)', async () => {
  const p = ports(), rh = provider({ finalStatus: 'FAILED' });
  const begun = await beginChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, request: request() });
  await finishChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, ticket: begun.ticket });
  const failed = await finishChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, ticket: begun.ticket });
  assert.equal(failed.ok, false);
  assert.equal(failed.pending, false);
  assert.equal(failed.moderation, false);
  assert.equal(failed.charged, 0);
  assert.match(failed.error, /\S/);
  assert.deepEqual(p.events.at(-1), ['release', 'nano_banana_21', 'gptimg_u1_k1', 'rejected']);
  assert.equal(p.events.some(([kind]) => kind === 'settle'), false);
});

test('a ticket past its deadline releases the hold instead of asking RunningHub again', async () => {
  const p = ports(), rh = provider();
  const begun = await beginChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, request: request() });
  const queriesBefore = rh.calls.filter(([url]) => url.endsWith('/query')).length;
  const late = await finishChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, ticket: begun.ticket, now: begun.ticket.expiresAt + 1 });
  assert.equal(late.ok, false);
  assert.equal(late.timeout, true);
  assert.match(late.error, /超时/);
  assert.equal(rh.calls.filter(([url]) => url.endsWith('/query')).length, queriesBefore);
  assert.deepEqual(p.events.at(-1), ['release', 'nano_banana_21', 'gptimg_u1_k1', 'timeout']);
});

test('a submit the line refuses releases the hold before any ticket exists', async () => {
  const p = ports(), rh = provider({ submitStatus: 200, submitPayload: { code: 1001, msg: 'not found' } });
  await assert.rejects(beginChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, request: request({ model: 'grok-imagine' }) }), /1001/);
  assert.deepEqual(p.events.map(([kind]) => kind), ['reserve', 'release']);
});

test('a tampered or foreign ticket is refused before anything is charged', async () => {
  const p = ports(), rh = provider();
  const begun = await beginChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, request: request() });
  await assert.rejects(finishChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, ticket: { ...begun.ticket, usageKey: 'other_key' } }), /凭据无效/);
  await assert.rejects(finishChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, ticket: { ...begun.ticket, v: 2 } }), /凭据无效/);
  assert.equal(p.events.length, 1);
});

test('stale holds this user never closed are released when a new picture starts', async () => {
  const p = ports(), rh = provider();
  const stale = [{ usage_key: 'gptimg_u1_old', feature: 'gpt_image_2_edit' }, { usage_key: 'other_k', feature: 'xiaotao_vision' }];
  let asked = null;
  const listStaleHolds = async (input) => { asked = input; return stale; };
  const released = await releaseStaleGptImageHolds({ ports: p, listStaleHolds, userId: 'u1', now: 1_000_000_000_000 });
  assert.deepEqual(released, [{ usageKey: 'gptimg_u1_old', feature: 'gpt_image_2_edit', status: 'released' }]);
  assert.equal(asked.userId, 'u1');
  assert.equal(asked.before, new Date(1_000_000_000_000 - 15 * 60 * 1000).toISOString());
  const begun = await beginChargedGptImage({ ports: p, config: config(), fetchImpl: rh.fetchImpl, listStaleHolds, request: request({ usageKey: 'gptimg_u1_k2' }) });
  assert.equal(begun.staleReleased.length, 1);
  assert.deepEqual(p.events.map(([kind]) => kind), ['release', 'release', 'reserve']);
});

test('the 2.5 line that fell back at submit settles its hold at the official GPT Image 2 price', async () => {
  const p = ports();
  let posts = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    const where = String(url); calls.push(where);
    if (where.includes('/media/upload/binary')) return Response.json({ code: 0, data: { download_url: 'https://cdn.example/up.png' } });
    if (where.endsWith('/image-to-image')) { posts += 1; return posts === 1 ? Response.json({ code: 1001, msg: 'missing' }) : Response.json({ taskId: 't-9', status: 'RUNNING' }); }
    if (where.endsWith('/query')) return Response.json({ taskId: 't-9', status: 'SUCCESS', results: [{ url: 'https://cdn.example/out.png' }] });
    if (where === 'https://cdn.example/out.png') return new Response(Buffer.from('png'), { headers: { 'content-type': 'image/png' } });
    throw new Error('unexpected ' + where);
  };
  const begun = await beginChargedGptImage({ ports: p, config: config(), fetchImpl, request: request({ model: 'gpt-image-2.5' }) });
  assert.equal(begun.ticket.fellBack, true);
  assert.equal(begun.ticket.feature, 'gpt_image_2_5_economy');
  const done = await finishChargedGptImage({ ports: p, config: config(), fetchImpl, ticket: begun.ticket });
  assert.equal(done.ok, true);
  const settle = p.events.find(([kind]) => kind === 'settle');
  assert.equal(settle[4], 4);
  assert.equal(done.charged, 4);
});
