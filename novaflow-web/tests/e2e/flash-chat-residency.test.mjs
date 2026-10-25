import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFlashChatResidency } from '../../worker/src/flash-chat-residency.mjs';
import { createFlashBrainSession } from '../../worker/src/flash-brain-session.mjs';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';

// All native HTTP/model/lifecycle operations below are mocks; no GPU starts.
const MODEL = 'residency-fixture', WEIGHT = 'E:/fixture/swift.gguf';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const chat = extra => ({ provider: 'local', mode: 'chat', requestId: randomUUID(), message: '请简短解释色彩层次。', history: [], ...extra });
const code = expected => error => { assert.equal(error.errorCode || error.code, expected); return true; };
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
function coordinator(options = {}) {
  const f = transport(options);
  const assistant = createStrataPromptAssistant({ config: { expectedModel: { ids: [MODEL], paths: [WEIGHT] } },
    lifecycle: f.lifecycle, fetchImpl: f.fetchImpl, comfyUrls: options.comfyUrls || [],
    legacyApi: { async runWithFlashSession(flash) { const result = await flash.infer({ system: 'original-task-system', user: 'old task' });
      return { ok: true, data: { text: result.text } }; }, async stop() {} },
    ...(options.resourceProbe ? { resourceProbe: options.resourceProbe } : {}) });
  return { ...f, assistant };
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

test('two chat replies reuse one owned session and accurately report warm without a generation gate', async () => {
  const f = coordinator();
  const first = await f.assistant.artAgentChat(chat());
  assert.equal(first.ok, true); assert.equal(first.resourcesReleased, false); assert.equal(first.generationReady, false);
  assert.equal(first.data.proposal, undefined); assert.equal(first.data.chatSession.state, 'warm');
  assert.equal(first.data.chatSession.modelLoaded, true); assert.equal(first.data.chatSession.idleTimeoutMs, 120000);
  assert.equal(f.assistant.busy, false); assert.equal(f.assistant.running, false);
  const second = await f.assistant.artAgentChat(chat({ conversationId: first.data.conversationId, history: first.data.history }));
  assert.equal(second.ok, true); assert.equal(second.timing.reusedSession, true);
  assert.deepEqual(f.events.map(e => e.type), ['load', 'infer', 'infer']);
  for (const body of f.calls) {
    assert.equal(body.reasoning_effort, 'none'); assert.equal(body.reasoning_budget_tokens, 0); assert.equal(body.max_tokens, 1536);
    assert.equal(body.tools, undefined); assert.match(body.messages[0].content, /默认简洁/);
  }
  const stop = await f.assistant.stop(); assert.equal(stop.released, true);
  assert.equal(f.events.at(-1).type, 'unload');
  assert.equal(f.events[0].ownerToken, f.events.at(-1).ownerToken);
  assert.equal(f.assistant.status().chatSession.state, 'cold');
});

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

test('generation handoff actively closes warm chat instead of waiting forever on its lifecycle', async () => {
  const f = coordinator(); await f.assistant.artAgentChat(chat());
  const release = await f.assistant.acquireGeneration('drawing-task');
  assert.equal(f.events.at(-1).type, 'unload');
  assert.equal(f.assistant.status().chatSession.state, 'cold');
  assert.equal((await f.assistant.artAgentChat(chat())).errorCode, 'prompt-assistant-busy');
  release(); await f.assistant.stop();
});

test('handoff during an active answer waits for that answer and actual release before generation', async () => {
  const entered = deferred(), answer = deferred(), unloading = deferred();
  const f = coordinator({ unloadGate: unloading, onChat: async () => { entered.resolve(); await answer.promise;
    return Response.json({ id: 'active-answer', model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '回答完成。' } }] }); } });
  const response = f.assistant.artAgentChat(chat()); await entered.promise;
  let acquired = false;
  const handoff = f.assistant.acquireGeneration('draw').then(release => { acquired = true; return release; });
  await tick(); assert.equal(acquired, false); assert.equal(f.events.some(e => e.type === 'unload'), false);
  assert.equal((await f.assistant.artAgentChat(chat())).ok, false);
  answer.resolve(); const reply = await response; assert.equal(reply.ok, true);
  await tick(); assert.equal(f.assistant.status().chatSession.state, 'releasing'); assert.equal(acquired, false);
  unloading.resolve(); const release = await handoff;
  assert.equal(acquired, true); assert.equal(f.assistant.status().chatSession.modelLoaded, false);
  release(); await f.assistant.stop();
});

test('matching cancellation waits for cleanup; wrong request and idle stop never cancel somebody else', async () => {
  const entered = deferred(), unloadGate = deferred();
  const f = coordinator({ unloadGate, onChat: async ({ signal }) => {
    entered.resolve(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const payload = chat(), running = f.assistant.artAgentChat(payload); await entered.promise;
  assert.equal((await f.assistant.artAgentStop({ requestId: 'different-request' })).ok, false);
  assert.equal(f.events.some(e => e.type === 'unload'), false);
  let stopped = false;
  const stopping = f.assistant.artAgentStop({ requestId: payload.requestId }).then(value => { stopped = true; return value; });
  await tick(); assert.equal(stopped, false); assert.equal(f.assistant.status().chatSession.state, 'releasing');
  unloadGate.resolve(); assert.equal((await stopping).released, true); assert.equal((await running).ok, false);
  const warm = coordinator(); await warm.assistant.artAgentChat(chat());
  const idle = await warm.assistant.artAgentStop({ requestId: payload.requestId });
  assert.equal(idle.idle, true); assert.equal(idle.resourcesReleased, false); assert.equal(warm.assistant.status().chatSession.state, 'warm');
  await warm.assistant.stop(); await f.assistant.stop();
});

test('other model tasks release warm chat before loading and preserve old per-call thinking defaults', async () => {
  const f = coordinator(); await f.assistant.artAgentChat(chat());
  const result = await f.assistant.optimizePrompt({}); assert.equal(result.ok, true);
  assert.deepEqual(f.events.map(e => e.type), ['load', 'infer', 'unload', 'load', 'infer', 'unload']);
  assert.equal(f.calls[1].messages[0].content, 'original-task-system');
  assert.equal(f.calls[1].reasoning_effort, 'low'); assert.equal(f.calls[1].reasoning_budget_tokens, 1024);
  assert.equal(result.resourcesReleased, true); assert.equal(result.generationReady, true);
});

test('loading, answering, warm and releasing status follow real lifecycle transitions', async () => {
  const loadGate = deferred(), entered = deferred(), answer = deferred(), unloadGate = deferred();
  const f = coordinator({ loadGate, unloadGate, onChat: async () => { entered.resolve(); await answer.promise;
    return Response.json({ id: 'status-answer', model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '完成。' } }] }); } });
  const payload = chat(), running = f.assistant.artAgentChat(payload); await tick();
  assert.equal(f.assistant.status().chatSession.state, 'loading');
  assert.equal(f.assistant.status().chatSession.activeRequestId, payload.requestId);
  assert.equal(f.assistant.status().chatSession.modelLoaded, false);
  loadGate.resolve(); await entered.promise;
  assert.equal(f.assistant.status().chatSession.state, 'answering'); assert.equal(f.assistant.status().chatSession.modelLoaded, true);
  answer.resolve(); await running; assert.equal(f.assistant.status().chatSession.state, 'warm');
  const stopping = f.assistant.stop(); await tick();
  assert.equal(f.assistant.status().chatSession.state, 'releasing'); assert.equal(f.assistant.status().chatSession.modelLoaded, true);
  unloadGate.resolve(); await stopping; assert.equal(f.assistant.status().chatSession.state, 'cold');
});

test('unconfirmed residency release locks all following inference and generation', async () => {
  const f = coordinator({ releaseError: true }); await f.assistant.artAgentChat(chat());
  await assert.rejects(f.assistant.acquireGeneration('drawing'), code('strata-release-unconfirmed'));
  assert.equal(f.assistant.status().chatSession.state, 'fault');
  assert.equal((await f.assistant.artAgentChat(chat())).errorCode, 'strata-release-unconfirmed');
  assert.equal((await f.assistant.optimizePrompt({})).errorCode, 'strata-release-unconfirmed');
  assert.equal(f.events.filter(e => e.type === 'load').length, 1);
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

test('another coordinator cannot load or release a warm session owned by the first', async () => {
  const shared = { owner: '' }, first = coordinator({ shared }), second = coordinator({ shared });
  await first.assistant.artAgentChat(chat()); const owner = shared.owner;
  const denied = await second.assistant.artAgentChat(chat()); assert.equal(denied.ok, false);
  assert.equal(shared.owner, owner); assert.equal(first.assistant.status().chatSession.state, 'warm');
  assert.notEqual(second.events.at(-1).ownerToken, owner);
  await second.assistant.stop(); assert.equal(shared.owner, owner);
  await first.assistant.stop(); assert.equal(shared.owner, '');
});

test('a busy Comfy queue prevents the first resident model load', async () => {
  let loads = 0;
  const assistant = createStrataPromptAssistant({ config: { expectedModel: { ids: [MODEL] } }, comfyUrls: ['http://comfy.fixture'],
    lifecycle: { async load() { loads++; return { ok: true }; }, async unload() { return { released: true }; } },
    fetchImpl: async url => { assert.equal(url, 'http://comfy.fixture/queue'); return Response.json({ queue_running: [[1]], queue_pending: [] }); } });
  const result = await assistant.artAgentChat(chat());
  assert.equal(result.ok, false); assert.equal(result.errorCode, 'runtime-generation-busy');
  assert.equal(loads, 0); assert.equal(assistant.status().chatSession.state, 'cold');
});

test('a generation cancelled during graceful chat handoff never receives a generation reservation', async () => {
  const entered = deferred(), answer = deferred(); let cancelled = false;
  const f = coordinator({ onChat: async () => { entered.resolve(); await answer.promise;
    return Response.json({ id: 'cancel-handoff-answer', model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '完成。' } }] }); } });
  const running = f.assistant.artAgentChat(chat()); await entered.promise;
  const handoff = f.assistant.acquireGeneration('cancelled-draw', { isCancelled: () => cancelled });
  const rejected = assert.rejects(handoff, /取消/);
  cancelled = true; answer.resolve(); await running; await rejected;
  assert.equal(f.assistant.status().chatSession.state, 'cold');
  const release = await f.assistant.acquireGeneration('next-draw'); release();
  await f.assistant.stop();
});

test('cancellation with a stalled native audit ends only after real cleanup and releases conversation busy state', async () => {
  const auditEntered = deferred(), auditGate = deferred(), unloadEntered = deferred(), unloadGate = deferred();
  const f = transport(); let audits = 0;
  const assistant = createStrataPromptAssistant({ config: { expectedModel: { ids: [MODEL], paths: [WEIGHT] } }, comfyUrls: [],
    lifecycle: { load: options => f.lifecycle.load(options), async unload(options) { unloadEntered.resolve(); await unloadGate.promise; return f.lifecycle.unload(options); } },
    fetchImpl: f.fetchImpl, sessionFactory: options => createFlashBrainSession({ ...options,
      onInference: async () => { if (++audits === 2) { auditEntered.resolve(); await auditGate.promise; } } }) });
  const first = await assistant.artAgentChat(chat());
  const payload = chat({ conversationId: first.data.conversationId, history: first.data.history });
  const pending = assistant.artAgentChat(payload); await auditEntered.promise;
  let stopped = false;
  const stopping = assistant.artAgentStop({ requestId: payload.requestId }).then(value => { stopped = true; return value; });
  await unloadEntered.promise; await tick();
  assert.equal(stopped, false); assert.equal(assistant.status().chatSession.state, 'releasing');
  unloadGate.resolve(); const result = await stopping, cancelled = await pending;
  assert.equal(result.released, true); assert.equal(cancelled.ok, false); assert.equal(cancelled.resourcesReleased, true);
  assert.equal(assistant.busy, false); assert.equal(f.ownership.owner, '');
  // The audit is STILL blocked; the cancelled Agent has nevertheless unwound
  // its own finally, so the same previous text history can make a new request.
  const resumed = await assistant.artAgentChat(chat({ conversationId: first.data.conversationId, history: first.data.history }));
  assert.equal(resumed.ok, true); assert.equal(f.calls.length, 3);
  auditGate.reject(Error('late audit failure after cancellation')); await tick();
  assert.equal(f.calls.length, 3, 'a late native/audit completion cannot issue a new request');
  await assistant.stop();
});
