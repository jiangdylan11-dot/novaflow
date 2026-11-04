import test from 'node:test';
import assert from 'node:assert/strict';
import { communityTrialCapabilityFailure, communityTrialResponseFailure } from '../../worker/src/local-model-selection.mjs';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';

const communityModels = ['gemma-4-12b-it', 'qwen3.5-9b-heretic'];

test('community production trial permits conversation only and rejects every planner mode', () => {
  for (const modelId of communityModels) {
    assert.equal(communityTrialCapabilityFailure({ modelId, mode: 'chat', images: [{ dataUrl: 'data:image/png;base64,AA==' }] }), null);
    for (const file of [{ kind: 'audio' }, { kind: 'video' }, { type: 'audio/wav' }, { type: 'video/mp4' },
      { name: 'clip.mp4' }, { name: 'voice.wav' }, { kind:'image', name:'clip.mp4' }, { name:'document.pdf' }, {}]) {
      assert.equal(communityTrialCapabilityFailure({ modelId, mode: 'chat', uploads: [file] })?.errorCode,
        'community-trial-capability-unavailable');
    }
    assert.equal(communityTrialCapabilityFailure({modelId,mode:'chat',uploads:[{kind:'image',name:'image.png'}]}),null);
    for (const mode of ['foart', 'media', 'drawing', 'creation', '', undefined]) {
      const result = communityTrialCapabilityFailure({ modelId, mode });
      assert.equal(result?.errorCode, 'community-trial-capability-unavailable');
    }
    // Full planners may be exercised only through the existing isolated fixture.
    assert.equal(communityTrialCapabilityFailure({ modelId, mode: 'foart' }, { isolatedTest: true }), null);
  }
});

test('community production trial never returns a tool trace or operation plan', () => {
  for (const modelId of communityModels) {
    const payload = { modelId, mode: 'chat' };
    assert.equal(communityTrialResponseFailure(payload, { reply: 'hello', toolTrace: [] }), null);
    for (const data of [
      { reply: 'hello', toolTrace: [{ name: 'write' }] },
      { reply: 'hello', toolTrace: [], toolPlan: { status: 'act' } },
      { reply: 'hello', toolTrace: [], proposal: { action: 'generate' } },
      { reply: 'hello', toolTrace: [], mediaPlan: { action: 'apply' } },
      { reply: 'hello' }, null,
    ]) assert.equal(communityTrialResponseFailure(payload, data)?.errorCode, 'community-trial-response-rejected');
    assert.equal(communityTrialResponseFailure(payload, { toolPlan: {} }, { isolatedTest: true }), null);
  }
});

test('Next and existing online model identifiers retain their existing capability paths', () => {
  for (const modelId of [undefined, 'next', 'xai/grok-4.7']) {
    assert.equal(communityTrialCapabilityFailure({ modelId, mode: 'foart' }), null);
    assert.equal(communityTrialResponseFailure({ modelId, mode: 'foart' }, { toolPlan: {} }), null);
  }
});

test('both real assistant entry points reject community planner modes before model or network access', async () => {
  for (const modelId of communityModels) {
    const accesses = [];
    const session = { withSession: async () => { accesses.push('model'); throw Error('must not start'); } };
    const assistant = createStrataPromptAssistant({ gemmaSession: session, qwenSession: session,
      fetchImpl: async () => { accesses.push('network'); throw Error('must not call'); } });
    const payload = { modelId, mode: 'foart', requestId: 'community-trial-request', message: '请调整' };
    assert.equal((await assistant.artAgentChat(payload)).errorCode, 'community-trial-capability-unavailable');
    assert.equal((await assistant.runForTask('task-1', 'artAgentChat', payload)).errorCode, 'community-trial-capability-unavailable');
    assert.deepEqual(accesses, []);
  }
});
