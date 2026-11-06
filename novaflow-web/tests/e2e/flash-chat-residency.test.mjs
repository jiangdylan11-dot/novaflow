import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashChatResidency } from '../../worker/src/flash-chat-residency.mjs';
import { createFlashBrainSession } from '../../worker/src/flash-brain-session.mjs';

// All native HTTP/model/lifecycle operations below are mocks; no GPU starts.
// The residency itself is model-neutral. The coordinator cases that drove it through the
// retired default local model ("next", removed for an explicit Qwen/Gemma choice) were deleted.
const MODEL = 'residency-fixture', WEIGHT = 'E:/fixture/swift.gguf';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function transport({ onChat, loadGate, unloadGate, releaseError = false, shared } = {}) {
  const events = [], calls = [], ownership = shared || { owner: '' };
  const lifecycle = {
    async load({ ownerToken }) {
      events.push({ type: 'load', ownerToken });
      if (ownership.owner && ownership.owner !== ownerToken) throw Error('another coordinator owns Flash');
      ownership.owner = ownerToken;
      if (loadGate) await loadGate.promise;
      return { ok: true };
    },
    async unload({ ownerToken }) {
      events.push({ type: 'unload', ownerToken });
      if (ownership.owner !== ownerToken) return { released: true, notOwned: true };
      if (unloadGate) await unloadGate.promise;
      if (releaseError) return { released: false };
      ownership.owner = ''; return { released: true };
    }
  };
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: MODEL }] });
    if (url.endsWith('/props')) return Response.json({ model_path: WEIGHT });
    assert.ok(url.endsWith('/v1/chat/completions'));
    const body = JSON.parse(init.body); calls.push(body); events.push({ type: 'infer' });
    if (onChat) return onChat({ body, signal: init.signal, number: calls.length });
    return Response.json({ id: 'native-' + calls.length, model: MODEL,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '先建立主次明暗，再用局部色彩区分材质。' } }] });
  };
  return { lifecycle, fetchImpl, events, calls, ownership };
}
function resident(options = {}) {
  const f = transport(options);
  const session = createFlashBrainSession({ expectedModel: { ids: [MODEL], paths: [WEIGHT] },
    lifecycle: f.lifecycle, fetchImpl: f.fetchImpl });
  const residency = createFlashChatResidency({ withSession: (...args) => session.withSession(...args), ...options.residency });
  return { ...f, residency };
}
const nativeTask = (flash, signal) => {
  assert.equal(signal.aborted, false);
  return flash.inferConversation({ messages: [{ role: 'system', content: '简短对话。' }, { role: 'user', content: '你好。' }] });
};

test('idle TTL refreshes and stale timer callbacks cannot release a newer warm interval', async () => {
  const timers = [], cleared = [];
  const f = resident({ residency: { setTimer(fn, ms) { const token = { fn, ms }; timers.push(token); return token; }, clearTimer(token) { cleared.push(token); } } });
  await f.residency.run({ requestId: 'first-request', task: nativeTask });
  const old = timers.at(-1); assert.equal(old.ms, 120000);
  await f.residency.run({ requestId: 'second-request', task: nativeTask });
  assert.ok(cleared.includes(old)); old.fn(); await tick();
  assert.equal(f.events.some(e => e.type === 'unload'), false);
  timers.at(-1).fn(); await f.residency.close();
  assert.equal(f.events.filter(e => e.type === 'load').length, 1);
  assert.equal(f.events.filter(e => e.type === 'unload').length, 1);
  assert.equal(f.residency.getStatus().modelLoaded, false);
});

test('resource-floor guard remains active while warm and aborts only its owned lifecycle', async () => {
  let abort, guardStopped = false;
  const f = resident({ residency: { startGuard(value) { abort = value; return () => { guardStopped = true; }; } } });
  await f.residency.run({ requestId: 'guard-request', task: nativeTask });
  const closing = f.residency.close;
  abort.abort(Object.assign(Error('resource floor'), { code: 'flash-resource-floor' }));
  await tick(); await closing();
  assert.equal(guardStopped, true); assert.equal(f.ownership.owner, '');
  assert.equal(f.events[0].ownerToken, f.events.at(-1).ownerToken);
  assert.equal(f.residency.getStatus().state, 'cold');
});

test('resource abort while idle releases the owned session without an explicit close', async () => {
  const unloadGate = deferred(), settled = deferred(); let abort;
  const f = resident({ unloadGate, residency: {
    startGuard(value) { abort = value; return () => {}; },
    onSettled(outcome) { settled.resolve(outcome); }
  } });
  await f.residency.run({ requestId: 'idle-resource-abort', task: nativeTask });
  assert.equal(f.residency.getStatus().state, 'warm');
  const owner = f.ownership.owner;
  abort.abort(Object.assign(Error('resource floor'), { code: 'flash-resource-floor' }));
  await tick();
  assert.equal(f.events.at(-1).type, 'unload');
  assert.equal(f.events.at(-1).ownerToken, owner);
  assert.equal(f.ownership.owner, owner, 'resources remain owned until the real unload resolves');
  unloadGate.resolve();
  const outcome = await settled.promise;
  assert.equal(outcome.resourcesReleased, true);
  assert.equal(f.ownership.owner, '');
  assert.equal(f.residency.getStatus().state, 'cold');
});

