import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletionToResponses } from '../../packages/shared/src/runninghub-llm.mjs';
import { createCompanionChat } from '../../packages/shared/src/companion-chat.mjs';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';

test('adapter retains cache hits and does not invent missing token splits', () => {
  const response = (usage) => chatCompletionToResponses({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }], usage });
  assert.deepEqual(response({ prompt_tokens: 7777, completion_tokens: 489, total_tokens: 8266,
    prompt_tokens_details: { cached_tokens: 2048, ignored: 'private' } }).usage.prompt_tokens_details, { cached_tokens: 2048 });
  const partial = response({ total_tokens: 8266 }).usage;
  assert.equal(partial.input_tokens, null);
  assert.equal(partial.output_tokens, null);
  assert.equal(partial.total_tokens, 8266);
});

test('companion settles Grok from the provider token split and records the source', async () => {
  let settled;
  const charge = createOnlineAiCharge({
    reserve: async ({ estimatedCredits }) => ({ status: 'reserved', credits: estimatedCredits, amount: 1 }),
    settle: async (input) => { settled = input; return { settled_credits: input.settledCredits }; },
    release: async () => assert.fail('successful call should not release')
  });
  const companion = createCompanionChat({ provider: { apiKey: 'fixture', baseUrl: 'https://provider.test/v1', model: 'xai/grok-4.7' }, charge,
    fetchImpl: async () => Response.json({ id: 'chatcmpl-test', model: 'xai/grok-4.7', choices: [{ finish_reason: 'stop', message: { content: '好' } }],
      usage: { prompt_tokens: 7777, completion_tokens: 489, total_tokens: 8266, prompt_tokens_details: { cached_tokens: 2048 } } }) });
  const result = await companion.reply({ user: { id: 'user' }, payload: { requestId: 'test-pricing-123', mode: 'chat', promptLanguage: 'en', message: '你好', history: [] } });
  assert.equal(settled.pricingSource, 'token_rate_estimate');
  assert.equal(result.quota.settled_credits, 5);
  assert.ok(Math.abs(settled.rhCostUsd - 0.0131036) < 1e-10);
  assert.equal(settled.metadata.provider_request_id, 'chatcmpl-test');
  assert.equal(settled.metadata.token_rate_estimate.cachedTokens, 2048);
});
