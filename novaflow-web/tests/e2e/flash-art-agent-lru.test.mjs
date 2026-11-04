import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFlashArtAgent } from '../../worker/src/flash-art-agent.mjs';

// Only the model transport is simulated; no model, service or user data is used.
const request = (extra = {}) => ({
  requestId: randomUUID(), mode: 'chat', message: 'hello', history: [], ...extra
});
const response = () => ({
  model: 'fixture', requestId: randomUUID(), finishReason: 'stop',
  message: { role: 'assistant', content: 'reply' }
});
const flash = { identity: { id: 'fixture' }, inferConversation: async () => response() };
const run = (agent, payload, model = flash) => agent.run({ payload, flash: model });
const next = result => request({ conversationId: result.conversationId, history: result.history });
const expectUnknown = (agent, result) => assert.throws(
  () => agent.preflight(next(result)), { code: 'flash-agent-unknown-conversation' }
);

test('forty sequential conversations fit the 32-entry limit and recent history remains usable', async () => {
  const agent = createFlashArtAgent();
  const results = [];
  for (let i = 0; i < 40; i++) results.push(await run(agent, request()));
  assert.equal(agent.getStatus().conversations, 32);
  expectUnknown(agent, results[0]);
  const continued = await run(agent, next(results.at(-1)));
  assert.equal(continued.history.length, 4);
});

test('preflight has no eviction side effect and actual reservation evicts least recently used', async () => {
  const agent = createFlashArtAgent({ maxConversations: 2 });
  let first = await run(agent, request());
  const second = await run(agent, request());
  first = await run(agent, next(first));

  const pending = request();
  assert.doesNotThrow(() => agent.preflight(pending));
  assert.doesNotThrow(() => agent.preflight(next(first)));
  assert.doesNotThrow(() => agent.preflight(next(second)));

  await run(agent, pending);
  assert.doesNotThrow(() => agent.preflight(next(first)));
  expectUnknown(agent, second);
});

test('a busy session survives eviction and becomes most recent after it completes', async () => {
  let resolveBusy;
  const held = {
    identity: { id: 'fixture' },
    inferConversation: () => new Promise(resolve => { resolveBusy = () => resolve(response()); })
  };
  const agent = createFlashArtAgent({ maxConversations: 2 });
  const running = run(agent, request(), held);
  const idle = await run(agent, request());
  await run(agent, request());
  expectUnknown(agent, idle);

  assert.equal(typeof resolveBusy, 'function');
  resolveBusy();
  const finished = await running;
  await run(agent, request());
  assert.doesNotThrow(() => agent.preflight(next(finished)));
});

test('when all sessions are busy a new session is rejected without disturbing either', async () => {
  let resolveFirst, resolveSecond;
  const hold = setResolver => ({
    identity: { id: 'fixture' },
    inferConversation: () => new Promise(resolve => setResolver(() => resolve(response())))
  });
  const agent = createFlashArtAgent({ maxConversations: 2 });
  const first = run(agent, request(), hold(resolve => { resolveFirst = resolve; }));
  const second = run(agent, request(), hold(resolve => { resolveSecond = resolve; }));
  assert.throws(() => agent.preflight(request()), { code: 'flash-agent-conversation-limit' });
  resolveFirst();
  resolveSecond();
  for (const result of await Promise.all([first, second])) {
    assert.doesNotThrow(() => agent.preflight(next(result)));
  }
});

test('a failed new conversation is not resurrected during cleanup', async () => {
  const agent = createFlashArtAgent({ maxConversations: 1 });
  const failing = { identity: { id: 'fixture' }, inferConversation: async () => { throw new Error('fixture failure'); } };
  await assert.rejects(run(agent, request(), failing), /fixture failure/);
  assert.equal(agent.getStatus().conversations, 0);
  await run(agent, request());
  assert.equal(agent.getStatus().conversations, 1);
});
