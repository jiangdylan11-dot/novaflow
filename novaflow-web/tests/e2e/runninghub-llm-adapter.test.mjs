import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RUNNINGHUB_LLM_BASE_URL,
  DEFAULT_RUNNINGHUB_LLM_MODEL,
  readRunningHubLlmConfig,
  responsesToChatCompletions,
  chatCompletionToResponses,
  postRunningHubResponses,
  uiCatalogResponsesRequest,
  responsesOutputText,
  runningHubHttpError
} from '../../packages/shared/src/runninghub-llm.mjs';
import {createOnlineAiCharge} from '../../packages/shared/src/online-ai-charge.mjs';

const KEY = 'rh-fixture-key-not-real';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('text and vision config defaults to the international RunningHub host and grok-4.7', () => {
  const config = readRunningHubLlmConfig({});
  assert.equal(config.baseUrl, DEFAULT_RUNNINGHUB_LLM_BASE_URL);
  assert.equal(config.baseUrl, 'https://llm.runninghub.ai/v1');
  assert.equal(config.model, DEFAULT_RUNNINGHUB_LLM_MODEL);
  assert.equal(config.model, 'xai/grok-4.7');
  assert.equal(config.configured, false);
  assert.equal(Object.hasOwn(config, 'gptModel'), false);
  assert.doesNotMatch(JSON.stringify(config), /gpt-|api\.x\.ai|grok-4\.3/);
  const selected = readRunningHubLlmConfig({
    NOVAFLOW_RUNNINGHUB_API_KEY: KEY,
    NOVAFLOW_RUNNINGHUB_LLM_BASE_URL: 'https://llm.runninghub.cn/v1',
    NOVAFLOW_RUNNINGHUB_LLM_MODEL: 'xai/grok-4.6',
    NOVAFLOW_GROK_API_KEY: 'old-grok-secret',
    XAI_API_KEY: 'old-xai-secret'
  });
  assert.equal(selected.baseUrl, 'https://llm.runninghub.cn/v1');
  assert.equal(selected.model, 'xai/grok-4.6');
  assert.equal(selected.apiKey, KEY);
  assert.doesNotMatch(JSON.stringify(selected), /old-grok-secret|old-xai-secret/);
});

test('LLM host and model stay configurable inside RunningHub and reject direct providers', () => {
  for (const value of ['https://api.x.ai/v1', 'http://llm.runninghub.ai/v1', 'https://example.com/v1', 'https://llm.runninghub.ai/v1/chat', 'https://www.runninghub.cn/v1']) {
    assert.throws(() => readRunningHubLlmConfig({ NOVAFLOW_RUNNINGHUB_LLM_BASE_URL: value }), /RunningHub LLM/);
  }
  assert.throws(() => readRunningHubLlmConfig({ NOVAFLOW_RUNNINGHUB_LLM_MODEL: 'grok 4.7' }), /模型 ID/);
  assert.throws(() => readRunningHubLlmConfig({ NOVAFLOW_RUNNINGHUB_API_KEY: 'bad\nkey' }), /API Key/);
});

test('Responses multimodal input becomes one chat completion without tools or the old model', () => {
  const chat = responsesToChatCompletions({
    model: 'grok-4.3',
    store: false,
    tools: [{ type: 'function', name: 'generate' }],
    input: [
      { role: 'system', content: [{ type: 'input_text', text: '只分析' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: '上一句' }] },
      { role: 'user', content: [{ type: 'input_text', text: '看图' }, { type: 'function_call', name: 'generate' }, { type: 'input_image', image_url: PNG }] }
    ],
    temperature: 0.4,
    max_output_tokens: 2048,
    text: { format: { type: 'json_schema', name: 'novaflow_ui_qwen21_v1', strict: true, schema: { type: 'object', additionalProperties: false, properties: { prompt: { type: 'string' } }, required: ['prompt'] } } }
  }, 'xai/grok-4.7');
  assert.equal(chat.model, 'xai/grok-4.7');
  assert.equal(chat.store, undefined);
  assert.equal(chat.tools, undefined);
  assert.equal(chat.max_tokens, 2048);
  assert.equal(chat.messages[0].content, '只分析');
  assert.equal(chat.messages[1].content, '上一句');
  assert.equal(chat.messages[2].content.find(part => part.type === 'image_url').image_url.url, PNG);
  assert.equal(chat.messages[2].content.some(part => part.type === 'function_call'), false);
  assert.equal(chat.response_format.json_schema.name, 'novaflow_ui_qwen21_v1');
  assert.equal(chat.response_format.json_schema.schema.required[0], 'prompt');
  assert.doesNotMatch(JSON.stringify(chat), new RegExp(KEY));
});

test('chat completion maps back to a completed Responses answer and hides upstream secrets', async () => {
  const mapped = chatCompletionToResponses({
    id: 'cmpl-1',
    model: 'xai/grok-4.7',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ type: 'text', text: '短笔鼻子' }] } }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
  });
  assert.equal(mapped.status, 'completed');
  assert.equal(responsesOutputText(mapped), '短笔鼻子');
  assert.equal(mapped.usage.input_tokens, 2);
  assert.equal(mapped.output.some(item => item.type === 'function_call'), false);
  const tools = chatCompletionToResponses({ choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ function: { name: 'generate', arguments: '{}' } }] } }] });
  assert.equal(tools.output.some(item => item.type === 'function_call'), true);
  assert.throws(() => chatCompletionToResponses({ code: 1014, msg: KEY }), error => error.message.includes('1014') && !error.message.includes(KEY));
  assert.doesNotMatch(runningHubHttpError(401), new RegExp(KEY));

  let request;
  const posted = await postRunningHubResponses({
    body: { model: 'grok-4.3', input: [{ role: 'user', content: [{ type: 'input_text', text: '你好' }] }] },
    config: readRunningHubLlmConfig({ NOVAFLOW_RUNNINGHUB_API_KEY: KEY }),
    fetchImpl: async (url, init) => {
      request = { url, body: JSON.parse(init.body), authorization: init.headers.authorization };
      return Response.json({ id: 'cmpl-2', model: 'xai/grok-4.7', choices: [{ finish_reason: 'stop', message: { content: '好' } }] });
    }
  });
  assert.equal(request.url, 'https://llm.runninghub.ai/v1/chat/completions');
  assert.equal(request.body.model, 'xai/grok-4.7');
  assert.equal(request.authorization, 'Bearer ' + KEY);
  assert.equal(posted.data.output_text, '好');
  assert.doesNotMatch(JSON.stringify(request.body), new RegExp(KEY));
  let failures = 0;
  await assert.rejects(postRunningHubResponses({
    body: { input: [{ role: 'user', content: [{ type: 'input_text', text: '你好' }] }] },
    config: readRunningHubLlmConfig({ NOVAFLOW_RUNNINGHUB_API_KEY: KEY }),
    delay: async () => {},
    fetchImpl: async () => { failures++; return new Response(JSON.stringify({ error: { message: KEY, code: 'upstream' } }), { status: 502, headers: { 'content-type': 'application/json' } }); }
  }), error => error.statusCode === 502 && error.retryable === true && error.providerCallStarted === true && !error.message.includes(KEY));
  assert.equal(failures, 3);
  await assert.rejects(postRunningHubResponses({ body: {}, config: { apiKey: '', baseUrl: DEFAULT_RUNNINGHUB_LLM_BASE_URL, model: DEFAULT_RUNNINGHUB_LLM_MODEL }, fetchImpl: async () => assert.fail('missing key must not fetch') }), error => error.statusCode === 503 && error.providerCallStarted === false);
});

test('UI catalog job keeps the local schema and becomes one configured chat request', () => {
  const responses = uiCatalogResponsesRequest({
    systemInstruction: '按字段写目录',
    context: { theme: '霓虹' },
    maxOutputTokens: 3072,
    outputSchema: { type: 'object', required: ['ROTATION_ART', 'SHARED_STRIP'], properties: { ROTATION_ART: { type: 'string' }, SHARED_STRIP: { type: 'string' } } },
    images: [{ role: 'layout', imageUrl: PNG }]
  });
  const chat = responsesToChatCompletions(responses, 'xai/grok-4.7');
  assert.equal(chat.model, 'xai/grok-4.7');
  assert.equal(chat.max_tokens, 3072);
  assert.deepEqual(chat.response_format.json_schema.schema.required, ['ROTATION_ART', 'SHARED_STRIP']);
  assert.equal(chat.messages.at(-1).content.find(part => part.type === 'image_url').image_url.url, PNG);
  assert.equal(chat.tools, undefined);
  assert.throws(() => uiCatalogResponsesRequest({ systemInstruction: '按字段写目录', outputSchema: { required: ['ROTATION_ART'] }, images: [{ role: 'layout', imageUrl: 'https://example.test/a.png' }] }), /data URL/);
});

test('online metering is one charge of a feature id and an amount', async () => {
  const calls = [];
  const charge = createOnlineAiCharge({
    reserve: async (input) => { calls.push(['reserve', input.feature, input.amount]); return { status: 'reserved', idempotent: false, amount: input.amount }; },
    settle: async (input) => { calls.push(['settle', input.feature, input.amount, input.success]); return { remaining: 3 }; },
    release: async (input) => { calls.push(['release', input.feature, input.amount]); return { remaining: 4 }; }
  });
  const done = await charge({ userId: 'user', feature: 'prompt-optimize', amount: 2, usageKey: 'use-1', run: async ({ amount }) => ({ amount: 1, value: amount }) });
  assert.equal(done.value, 2);
  assert.deepEqual(calls, [['reserve', 'prompt-optimize', 2], ['settle', 'prompt-optimize', 1, true]]);
  calls.length = 0;
  await assert.rejects(charge({ userId: 'user', feature: 'image-reverse', amount: 1, usageKey: 'use-2', run: async () => { const error = new Error('在线模型暂时不可用'); error.chargedAmount = 0; throw error; } }));
  assert.deepEqual(calls, [['reserve', 'image-reverse', 1], ['release', 'image-reverse', 1]]);
  await assert.rejects(charge({ userId: 'user', feature: 'ui-catalog', amount: 1, usageKey: 'use-3', run: async () => { const error = new Error('secret upstream moderation text'); error.chargedAmount = 1; error.moderation = true; throw error; } }));
  assert.equal(calls.some(call => call[0] === 'settle'), false);
  assert.deepEqual(calls.filter(call => call[0] === 'release').at(-1), ['release', 'ui-catalog', 1]);
  const rejected = await charge({ userId: 'user', feature: 'prompt-optimize', amount: 1, usageKey: 'use-4', run: async () => ({ success: false, moderation: true, amount: 1 }) });
  assert.equal(rejected.quota.remaining, 4);
  assert.equal(calls.filter(call => call[0] === 'settle').length, 0);
});

test('provider errors stay in Chinese and only busy, server and timeout failures retry', async () => {
  const secret = 'upstream-secret-must-not-leak';
  const noWait = async () => {};
  const config = readRunningHubLlmConfig({ NOVAFLOW_RUNNINGHUB_API_KEY: KEY });
  const body = { input: [{ role: 'user', content: [{ type: 'input_text', text: '你好' }] }] };
  const once = async (payload, status, count = { n: 0 }) => {
    let calls = 0;
    try {
      await postRunningHubResponses({ body, config, delay: noWait, fetchImpl: async () => { calls++; count.n++; return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }); } });
    } catch (error) {
      return { error, calls };
    }
    return { calls };
  };
  const queued = await once({ code: 421, msg: secret }, 200);
  assert.equal(queued.calls, 3);
  assert.match(queued.error.message, /排队/);
  assert.equal(queued.error.retryable, true);
  assert.doesNotMatch(queued.error.message, /upstream-secret/);
  const busy = await once({ code: 1003, message: secret }, 503);
  assert.equal(busy.calls, 3);
  assert.match(busy.error.message, /繁忙/);
  const auth = await once({ code: 1014, msg: secret }, 403);
  assert.equal(auth.calls, 1);
  assert.match(auth.error.message, /1014/);
  assert.equal(auth.error.retryable, false);
  const invalid = await once({ error: { message: secret, type: 'invalid_request_error', code: 'invalid_prompt' } }, 400);
  assert.equal(invalid.calls, 1);
  assert.match(invalid.error.message, /提示内容无法提交/);
  assert.equal(invalid.error.retryable, false);
  const moderated = await once({ error: { message: secret, code: 'content_policy_violation' } }, 400);
  assert.equal(moderated.calls, 1);
  assert.match(moderated.error.message, /未通过在线审核/);
  assert.equal(moderated.error.moderation, true);
  assert.doesNotMatch(moderated.error.message, /upstream-secret/);
  const filtered = await once({ id: 'cmpl-filter', choices: [{ finish_reason: 'content_filter', message: { role: 'assistant', content: secret } }] }, 200);
  assert.equal(filtered.calls, 1);
  assert.match(filtered.error.message, /未通过在线审核/);
  assert.equal(filtered.error.moderation, true);
  assert.equal(filtered.error.retryable, false);
  assert.equal(filtered.error.statusCode, 400);
  assert.doesNotMatch(filtered.error.message, /upstream-secret/);
  const events = [];
  const charge = createOnlineAiCharge({
    reserve: async (input) => { events.push(['reserve', input.feature, input.amount]); return { status: 'reserved', idempotent: false, amount: input.amount }; },
    settle: async (input) => { events.push(['settle', input.feature, input.amount, input.success]); return { remaining: 3 }; },
    release: async (input) => { events.push(['release', input.feature, input.amount, input.reason]); return { remaining: 4 }; }
  });
  await assert.rejects(charge({
    userId: 'user',
    feature: 'image-reverse',
    amount: 1,
    usageKey: 'filter-1',
    run: () => postRunningHubResponses({
      body,
      config,
      delay: noWait,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: { content: secret } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
  }), error => error.moderation === true && /未通过在线审核/.test(error.message) && !error.message.includes(secret));
  assert.deepEqual(events, [['reserve', 'image-reverse', 1], ['release', 'image-reverse', 1, 'moderation']]);
  let timeouts = 0;
  await assert.rejects(postRunningHubResponses({ body, config, delay: noWait, fetchImpl: async () => { timeouts++; throw Object.assign(new Error(secret), { name: 'TimeoutError' }); } }), error => error.message === '在线模型响应超时' && !error.message.includes(secret));
  assert.equal(timeouts, 3);
});
