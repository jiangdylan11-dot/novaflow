import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';
import { computeArtAgentFingerprint } from '../../worker/src/flash-art-agent.mjs';

// Native inference and model ownership are simulated: these tests never start
// Flash, ComfyUI, a protocol subprocess, or any GPU work.
const MODEL = 'prompt-cancellation-fixture', WEIGHT = 'E:/fixture/swift.gguf';
const PROMPT_METHODS = ['optimizePrompt', 'reverseImagePrompt', 'describeArtStyle'];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = () => Response.json({ id: 'fixture-reply', model: MODEL,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '用清晰的发束和冷色环境光重新绘制。' } }] });

function fixture({ gateUnload = false, releaseConfirmed = true } = {}) {
  const entered = deferred(), answer = deferred(), unloadEntered = deferred(), unloadGate = deferred();
  const events = [], calls = [], signals = [];
  let owner = '', cpuStops = 0;
  const assistant = createStrataPromptAssistant({
    config: { expectedModel: { ids: [MODEL], paths: [WEIGHT] } }, comfyUrls: [],
    lifecycle: {
      async load({ ownerToken }) {
        assert.equal(owner, '', 'an overlapping model must not be loaded');
        owner = ownerToken; events.push({ type: 'load', ownerToken }); return { ok: true };
      },
      async unload({ ownerToken }) {
        assert.equal(ownerToken, owner, 'cleanup may release only this fixture operation');
        events.push({ type: 'unload-start', ownerToken }); unloadEntered.resolve();
        if (gateUnload) await unloadGate.promise;
        if (!releaseConfirmed) return { released: false };
        owner = ''; events.push({ type: 'unload-confirmed', ownerToken }); return { released: true };
      }
    },
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: MODEL }] });
      if (url.endsWith('/props')) return Response.json({ model_path: WEIGHT });
      assert.ok(url.endsWith('/v1/chat/completions'));
      calls.push(JSON.parse(init.body)); signals.push(init.signal); events.push({ type: 'infer' }); entered.resolve();
      return new Promise((resolve, reject) => {
        const abort = () => reject(init.signal.reason);
        if (init.signal.aborted) return abort();
        init.signal.addEventListener('abort', abort, { once: true });
        answer.promise.then(() => { init.signal.removeEventListener('abort', abort); resolve(reply()); });
      });
    },
    legacyApi: {
      async runWithFlashSession(flash, method) {
        const response = await flash.infer({ system: 'original-' + method, user: '请转换当前图片的画风。' });
        return { ok: true, data: { text: response.text } };
      },
      async stop() { cpuStops++; }
    }
  });
  return { assistant, events, calls, signals, entered, answer, unloadEntered, unloadGate,
    get owner() { return owner; }, get cpuStops() { return cpuStops; } };
}

for (const method of PROMPT_METHODS) {
  test(`${method}: matching cancellation waits for owned release before generation can proceed`, { timeout: 5000 }, async t => {
    const f = fixture({ gateUnload: true }), requestId = randomUUID();
    t.after(async () => { f.answer.resolve(); f.unloadGate.resolve(); await f.assistant.stop(); });
    let originalSettled = false, cancellationSettled = false, acquired = false;
    const original = f.assistant[method]({ requestId }).then(value => { originalSettled = true; return value; });
    await f.entered.promise;
    const cancelling = f.assistant.cancelRequest({ requestId }).then(value => { cancellationSettled = true; return value; });
    await f.unloadEntered.promise;
    const earlyGeneration = f.assistant.acquireGeneration('draw-after-' + method).then(
      release => { acquired = true; return { release }; }, error => ({ error }));
    await tick();
    assert.equal(f.signals[0].aborted, true);
    assert.equal(originalSettled, false, 'the failed original call must wait for lifecycle cleanup');
    assert.equal(cancellationSettled, false, 'cancel acknowledgement must not claim an unconfirmed unload');
    assert.equal(acquired, false, 'generation must not acquire GPU ownership while unload is pending');
    assert.notEqual(f.owner, ''); assert.equal(f.assistant.busy, true);
    assert.ok(f.cpuStops >= 1, 'cancellation also closes the abandoned protocol client');

    f.unloadGate.resolve();
    const cancelled = await cancelling, originalResult = await original;
    assert.equal(cancelled.ok, true); assert.equal(cancelled.cancelled, true); assert.equal(cancelled.matched, true);
    assert.equal(cancelled.released, true); assert.equal(cancelled.resourcesReleased, true);
    assert.equal(originalResult.ok, false, 'a cancelled inference cannot return usable analysis');
    assert.equal(f.owner, ''); assert.equal(f.events.at(-1).type, 'unload-confirmed');
    const early = await earlyGeneration;
    // A handoff arriving during stop may either wait successfully or report
    // that release is still settling. Neither outcome may grant an early lease.
    if (early.release) early.release();
    else assert.equal(early.error.errorCode, 'prompt-assistant-stopping');
    const release = await f.assistant.acquireGeneration('next-drawing'); release();
    assert.equal(f.calls.length, 1); assert.equal(f.assistant.busy, false);
    assert.equal(f.events[0].ownerToken, f.events.at(-1).ownerToken);
  });
}

test('a different request ID neither aborts the active prompt call nor unloads its model', { timeout: 5000 }, async t => {
  const f = fixture(), requestId = randomUUID(), differentId = randomUUID();
  t.after(async () => { f.answer.resolve(); await f.assistant.stop(); });
  const original = f.assistant.reverseImagePrompt({ requestId }); await f.entered.promise;
  const result = await f.assistant.cancelRequest({ requestId: differentId }); await tick();
  assert.equal(result.ok, true); assert.equal(result.matched, false);
  assert.equal(f.signals[0].aborted, false); assert.equal(f.cpuStops, 0);
  assert.deepEqual(f.events.map(event => event.type), ['load', 'infer']);
  assert.equal(f.assistant.busy, true);
  f.answer.resolve(); const completed = await original;
  assert.equal(completed.ok, true); assert.equal(completed.resourcesReleased, true);
  assert.equal(f.calls.length, 1); assert.equal(f.owner, '');
  const delayed = await f.assistant.reverseImagePrompt({ requestId: differentId });
  assert.equal(delayed.ok, false); assert.equal(delayed.errorCode, 'prompt-assistant-cancelled');
  assert.equal(f.calls.length, 1, 'only the cancelled ID is tombstoned');
});

test('cancellation overtaking the HTTP request prevents every prompt entry from loading Flash', { timeout: 5000 }, async t => {
  const f = fixture(); t.after(() => f.assistant.stop());
  for (const method of PROMPT_METHODS) {
    const requestId = randomUUID(), cancellation = await f.assistant.cancelRequest({ requestId });
    assert.equal(cancellation.ok, true); assert.equal(cancellation.matched, false);
    const result = await f.assistant[method]({ requestId });
    assert.equal(result.ok, false); assert.equal(result.errorCode, 'prompt-assistant-cancelled');
    const replay = await f.assistant[method]({ requestId });
    assert.equal(replay.errorCode, 'prompt-assistant-cancelled', 'a repeated delayed delivery cannot revive the request');
  }
  assert.deepEqual(f.events, []); assert.equal(f.calls.length, 0); assert.equal(f.cpuStops, 0);
  const release = await f.assistant.acquireGeneration('unblocked-drawing'); release();
});

test('invalid cancellation IDs do not create a broad cancellation or stop an unrelated call', { timeout: 5000 }, async t => {
  const f = fixture(); t.after(async () => { f.answer.resolve(); await f.assistant.stop(); });
  const original = f.assistant.optimizePrompt({ requestId: randomUUID() }); await f.entered.promise;
  for (const payload of [{}, { requestId: '' }, { requestId: 42 }, { requestId: 'x'.repeat(161) }]) {
    const result = await f.assistant.cancelRequest(payload);
    assert.equal(result.ok, false); assert.equal(result.errorCode, 'invalid-request');
  }
  assert.equal(f.signals[0].aborted, false); assert.equal(f.cpuStops, 0);
  f.answer.resolve(); assert.equal((await original).ok, true);
});

for (const mode of ['chat', 'creation']) {
  test(`prompt cancellation cannot stop a same-ID ${mode} Agent; only its scoped Agent stop can do so`, { timeout: 5000 }, async t => {
    const f = fixture({ gateUnload: true }), requestId = randomUUID();
    t.after(async () => { f.answer.resolve(); f.unloadGate.resolve(); await f.assistant.stop(); });
    const payload = { provider: 'local', mode, requestId, history: [], message: '请解释光影层次。' };
    if (mode === 'creation') {
      payload.artContext = { task: 'creation', provider: 'local', engine: 'qwen-2.1', nsfw: false,
        mode: 'txt2img', prompt: '', negativePrompt: 'unchanged negative' };
      payload.images = []; payload.contextFingerprint = computeArtAgentFingerprint(payload);
    }
    const agent = f.assistant.artAgentChat(payload); await f.entered.promise;
    const denied = await f.assistant.cancelRequest({ requestId }); await tick();
    assert.equal(denied.ok, false); assert.equal(denied.errorCode, 'prompt-request-not-current');
    assert.equal(f.signals[0].aborted, false); assert.equal(f.cpuStops, 0);
    assert.deepEqual(f.events.map(event => event.type), ['load', 'infer']);
    let stopped = false;
    const stopping = f.assistant.artAgentStop({ requestId }).then(value => { stopped = true; return value; });
    await f.unloadEntered.promise; await tick();
    assert.equal(f.signals[0].aborted, true); assert.equal(stopped, false);
    f.unloadGate.resolve(); assert.equal((await stopping).released, true); assert.equal((await agent).ok, false);
    const release = await f.assistant.acquireGeneration('after-agent-stop'); release();
  });
}

test('a prompt tombstone does not cancel a later Agent conversation with the same ID', { timeout: 5000 }, async t => {
  const f = fixture(), requestId = randomUUID();
  t.after(async () => { f.answer.resolve(); await f.assistant.stop(); });
  await f.assistant.cancelRequest({ requestId });
  const agent = f.assistant.artAgentChat({ provider: 'local', mode: 'chat', requestId, history: [], message: '你好。' });
  await f.entered.promise; f.answer.resolve(); const result = await agent;
  assert.equal(result.ok, true); assert.equal(f.calls.length, 1); assert.equal(f.signals[0].aborted, false);
  assert.equal(result.data.chatSession.state, 'warm');
});
