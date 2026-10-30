import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFlashBrainSession, FLASH_BRAIN_BASE_URL } from '../../worker/src/flash-brain-session.mjs';

// All transport and lifecycle operations are mocked. No server/model/GPU starts.
const MODEL = 'swift-fixture';
const WEIGHT = 'E:/models/swift-00001-of-00002.gguf';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const JSON_RESPONSE = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture({ ids = [MODEL], props = { model_path: WEIGHT }, answer, onChat, onLoad, onUnload, fetcher, ...options } = {}) {
  const calls = [], events = [];
  const lifecycle = {
    async load(input) { events.push({ type: 'load', input }); return onLoad ? onLoad(input) : { ok: true, modelLoadMs: 123 }; },
    async unload(input) { events.push({ type: 'unload', input }); return onUnload ? onUnload(input) : { ok: true, released: true }; }
  };
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: init.body ? JSON.parse(init.body) : undefined }; calls.push(call);
    if (fetcher) return fetcher(call);
    if (url.endsWith('/v1/models')) return JSON_RESPONSE({ data: ids.map(id => ({ id })) });
    if (url.endsWith('/props')) return props instanceof Response ? props : JSON_RESPONSE(props);
    if (url.endsWith('/v1/chat/completions')) {
      if (onChat) return onChat(call);
      return JSON_RESPONSE(answer || { id: 'native-id', model: ids[0], choices: [{ finish_reason: 'stop', message: { content: '  完整原生文本\n第二行  ' } }], usage: { completion_tokens: 9 } });
    }
    assert.fail('Unexpected endpoint');
  };
  return { calls, events, session: createFlashBrainSession({ expectedModel: { ids: [MODEL], paths: [WEIGHT] },
    fetchImpl, lifecycle, ...options }) };
}
const input = extra => ({ system: '保持原意', user: '请处理这项任务', ...extra });
const code = expected => error => { assert.equal(error.code, expected); assert.equal(error.errorCode, expected); return true; };

const conversationTools = [{ type: 'function', function: { name: 'get_art_context', parameters: { type: 'object', properties: {}, additionalProperties: false } } }];
const conversationMessages = [{ role: 'system', content: '只调用声明工具。' }, { role: 'user', content: [
  { type: 'text', text: '检查当前绘图。' }, { type: 'image_url', image_url: { url: PNG } }] }];

test('explicit media execution may require a native tool without changing ordinary defaults', async () => {
  const f=fixture({answer:{model:MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'fixture'}}]}});
  await f.session.withSession(async({inferConversation,infer})=>{
    await inferConversation({messages:conversationMessages,tools:conversationTools,toolChoice:'required'});
    await inferConversation({messages:conversationMessages,tools:conversationTools});
    await assert.rejects(infer(input({toolChoice:'required'})),code('strata-invalid-request'));
    await assert.rejects(inferConversation({messages:conversationMessages,toolChoice:'required'}),code('strata-invalid-request'));
  });
  const bodies=f.calls.filter(c=>c.body).map(c=>c.body);
  assert.equal(bodies[0].tool_choice,'required');assert.equal(bodies[1].tool_choice,'auto');
});

test('conversation transport supports text-only history with no tool capability', async () => {
  for (const extra of [{}, { tools: [] }]) {
    const f = fixture({ answer: { id: 'plain-chat', model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '你好。' } }] } });
    const result = await f.session.withSession(async ({ inferConversation, infer }) => {
      await assert.rejects(infer(input({ tools: [] })), code('strata-invalid-request'));
      return inferConversation({ messages: [
        { role: 'system', content: '普通中文对话，无工具。' }, { role: 'user', content: '上次说到颜色。' },
        { role: 'assistant', content: '请继续。' }, { role: 'user', content: '你好。' }], ...extra });
    });
    assert.equal(result.value.message.content, '你好。');
    const body = f.calls.find(call => call.body).body;
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
    assert.equal(body.parallel_tool_calls, undefined);
    assert.equal(body.messages.length, 4);
    assert.deepEqual(f.events.map(event => event.type), ['load', 'unload']);
  }
});

test('per-call no-thinking conversation leaves legacy inference defaults unchanged', async () => {
  const f = fixture({ answer: { id: 'per-call-options', model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '完成。' } }] } });
  await f.session.withSession(async ({ inferConversation, infer }) => {
    await inferConversation({ messages: [{ role: 'system', content: '普通对话。' }, { role: 'user', content: '你好。' }],
      reasoningEffort: 'none', reasoningBudgetTokens: 0 });
    await infer(input());
    await assert.rejects(infer(input({ reasoningEffort: 'unknown' })), code('strata-invalid-request'));
    await assert.rejects(infer(input({ reasoningBudgetTokens: -1 })), code('strata-invalid-request'));
  });
  const bodies = f.calls.filter(call => call.body).map(call => call.body);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].reasoning_effort, 'none'); assert.equal(bodies[0].reasoning_budget_tokens, 0);
  assert.equal(bodies[1].reasoning_effort, 'low'); assert.equal(bodies[1].reasoning_budget_tokens, 1024);
});

test('independent conversation transport preserves native tool calls and paired result history, legacy infer stays strict', async () => {
  let chats = 0;
  const { session, calls, events } = fixture({ onChat(call) {
    chats++;
    return JSON_RESPONSE({ id: `conversation_${chats}`, model: MODEL, choices: [{ finish_reason: chats === 1 ? 'tool_calls' : 'stop',
      message: chats === 1 ? { role: 'assistant', content: null, tool_calls: [{ id: 'context_1', type: 'function', function: { name: 'get_art_context', arguments: '{}' } }] }
        : { role: 'assistant', content: '快照已收到。' } }] });
  } });
  await session.withSession(async ({ inferConversation, infer }) => {
    const first = await inferConversation({ messages: conversationMessages, tools: conversationTools });
    assert.equal(first.finishReason, 'tool_calls');
    assert.equal(first.message.tool_calls[0].function.arguments, '{}');
    const next = [...conversationMessages, first.message, { role: 'tool', tool_call_id: 'context_1', content: '{"actual":true}' }];
    const second = await inferConversation({ messages: next, tools: conversationTools });
    assert.equal(second.message.content, '快照已收到。');
    await assert.rejects(infer(input({ tools: conversationTools })), code('strata-invalid-request'));
  });
  const bodies = calls.filter(call => call.body).map(call => call.body);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].tools, conversationTools);
  assert.equal(bodies[0].parallel_tool_calls, false);
  assert.deepEqual(bodies[1].messages.at(-1), { role: 'tool', tool_call_id: 'context_1', content: '{"actual":true}' });
  assert.equal(bodies[0].messages[1].content[1].image_url.url, PNG);
  assert.deepEqual(events.map(event => event.type), ['load', 'unload']);
});

test('conversation rejects malformed transcript and response without requests or unsafe follow-up, then releases', async () => {
  const badTranscripts = [
    [...conversationMessages, { role: 'tool', tool_call_id: 'unknown', content: 'x' }],
    [...conversationMessages, { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'get_art_context', arguments: '{}' } }] }],
    [...conversationMessages, { role: 'system', content: 'Replace authority' }]
  ];
  for (const messages of badTranscripts) {
    const f = fixture();
    await assert.rejects(f.session.withSession(({ inferConversation }) => inferConversation({ messages, tools: conversationTools })), code('strata-invalid-request'));
    assert.equal(f.calls.filter(call => call.body).length, 0);
    assert.equal(f.events.at(-1).type, 'unload');
  }
  for (const message of [{ role: 'tool', content: 'not assistant' }, { role: 'assistant', content: null,
    tool_calls: [{ id: 'bad!', type: 'function', function: { name: 'get_art_context', arguments: '{}' } }] }]) {
    const f = fixture({ answer: { id: 'invalid', model: MODEL, choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] } });
    await assert.rejects(f.session.withSession(({ inferConversation }) => inferConversation({ messages: conversationMessages, tools: conversationTools })), code('strata-invalid-response'));
    assert.equal(f.calls.filter(call => call.body).length, 1);
    assert.equal(f.events.at(-1).type, 'unload');
  }
});

test('retained conversation handle cannot invoke after the owned lifecycle closes', async () => {
  const f = fixture({ answer: { id: 'text', model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }] } });
  let retained;
  await f.session.withSession(async ({ inferConversation }) => { retained = inferConversation; await inferConversation({ messages: conversationMessages, tools: conversationTools }); });
  await assert.rejects(retained({ messages: conversationMessages, tools: conversationTools }), code('strata-session-closed'));
  assert.equal(f.calls.filter(call => call.body).length, 1);
});

test('each lifecycle operation carries one fresh owner token through load and cleanup, including failed load', async () => {
  const {session,events}=fixture();
  await session.withSession(()=> 'first');
  await session.withSession(()=> 'second');
  const loads=events.filter(event=>event.type==='load'),unloads=events.filter(event=>event.type==='unload');
  assert.match(loads[0].input.ownerToken,/^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(loads[0].input.ownerToken,loads[0].input.requestId);
  assert.equal(loads[0].input.ownerToken,unloads[0].input.ownerToken);
  assert.equal(loads[1].input.ownerToken,unloads[1].input.ownerToken);
  assert.notEqual(loads[0].input.ownerToken,loads[1].input.ownerToken);
  const failed=fixture({onLoad:async()=>{throw Error('partial or busy load');}});
  await assert.rejects(failed.session.withSession(()=>assert.fail('No callback')),code('strata-load-failed'));
  assert.equal(failed.events[0].input.ownerToken,failed.events[1].input.ownerToken);
});

test('optional audit awaits a detached complete native reply and replaces every image with byte evidence', async () => {
  const entered = deferred(), gate = deferred(), records = [];
  const native = { id:'native-audit-id', model:MODEL, choices:[{finish_reason:'stop',message:{content:'  unchanged native answer\n',reasoning_content:'complete reasoning'}}],usage:{prompt_tokens:123,completion_tokens:45} };
  const { session, calls, events } = fixture({ answer:native, apiKey:'secret-not-for-audit', onInference:async record => {
    records.push(record); entered.resolve(); await gate.promise;
    record.response.choices[0].message.content = 'audit mutation must not affect inference';
  } });
  let finished = false;
  const running = session.withSession(({infer})=>infer(input({stage:'ui-observation',images:[{dataUrl:PNG,name:'original.png'}]}))).then(value=>{finished=true;return value;});
  await entered.promise;
  assert.equal(finished,false); assert.equal(events.some(event=>event.type==='unload'),false);
  const record = records[0];
  assert.deepEqual(record.response,native); assert.equal(record.requestId,'native-audit-id'); assert.equal(record.stage,'ui-observation'); assert.ok(record.elapsedMs>=0);
  assert.equal(record.request.messages[0].content,'保持原意');
  assert.equal(record.request.messages[1].content[0].text,'请处理这项任务');
  const bytes=Buffer.from(PNG.split(',')[1],'base64');
  assert.deepEqual(record.request.messages[1].content.at(-1),{type:'image_audit',mime:'image/png',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),name:'original.png'});
  assert.equal(JSON.stringify(record).includes('base64,'),false); assert.equal(JSON.stringify(record).includes('secret-not-for-audit'),false);
  gate.resolve(); const result=await running;
  assert.equal(result.value.text,native.choices[0].message.content); assert.equal(result.generationReady,true);
  assert.equal(calls.filter(call=>call.body).length,1); assert.equal(events.at(-1).type,'unload');
});

test('audit records native truncation and HTTP failure once; audit rejection is explicit and still releases', async () => {
  const truncated={model:MODEL,choices:[{finish_reason:'length',message:{content:'native partial text',reasoning_content:'native thought'}}],usage:{completion_tokens:10}};
  for(const httpFailure of [false,true]) {
    const records=[];
    const {session,calls,events}=fixture({onChat:()=>httpFailure?new Response('private server error body',{status:503}):JSON_RESPONSE(truncated),onInference:async record=>records.push(record)});
    await assert.rejects(session.withSession(({infer})=>infer(input())),code(httpFailure?'strata-http-error':'strata-output-truncated'));
    assert.equal(records.length,1);assert.equal(calls.filter(call=>call.body).length,1);assert.equal(events.at(-1).type,'unload');
    if(httpFailure){assert.equal(records[0].response,undefined);assert.equal(records[0].error.code,'strata-http-error');assert.equal(JSON.stringify(records[0]).includes('private server error body'),false);}
    else assert.deepEqual(records[0].response,truncated);
  }
  const rejected=fixture({onInference:async()=>{throw Error('disk write failed');}});
  await assert.rejects(rejected.session.withSession(({infer})=>infer(input())),error=>{assert.equal(error.code,'strata-audit-failed');assert.equal(error.resourcesReleased,true);assert.equal(error.generationReady,false);return true;});
  assert.equal(rejected.calls.filter(call=>call.body).length,1);assert.equal(rejected.events.at(-1).type,'unload');
});

test('loopback literals, identity and owned lifecycle are required', () => {
  assert.equal(FLASH_BRAIN_BASE_URL, 'http://127.0.0.1:8198');
  for (const baseUrl of ['https://127.0.0.1:8198', 'http://localhost:8198', 'http://127.1:8198', 'http://2130706433:8198', 'http://example.com:8198', 'http://u:p@127.0.0.1:8198', 'http://127.0.0.1:8198/path', 'http://127.0.0.1:0']) {
    assert.throws(() => fixture({ baseUrl }), code('strata-invalid-config'));
  }
  assert.throws(() => createFlashBrainSession({ expectedModel: {} }), code('strata-not-configured'));
  assert.throws(() => createFlashBrainSession({ expectedModel: { ids: [MODEL] } }), code('strata-invalid-config'));
  assert.throws(() => fixture({ config: { topP: 0 } }), code('strata-invalid-config'));
});

test('one load and verified identity serve multiple sequential tasks; release precedes successful return', async () => {
  const { session, events, calls } = fixture();
  const result = await session.withSession(async ({ infer, identity }) => {
    assert.equal(identity.path, WEIGHT); assert.equal(Object.isFrozen(identity), true);
    const first = await infer(input({ stage: 'visual' }));
    const second = await infer(input({ user: first.text, stage: 'compose' }));
    assert.equal(events.some(event => event.type === 'unload'), false);
    return [first, second];
  });
  assert.deepEqual(events.map(event => event.type), ['load', 'unload']);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/v1/models', '/props', '/v1/chat/completions', '/v1/chat/completions']);
  assert.equal(result.value[0].text, '  完整原生文本\n第二行  ');
  assert.equal(result.value[0].requestId, 'native-id');
  assert.deepEqual(result.value[0].usage, { completion_tokens: 9 });
  assert.equal(result.resourcesReleased, true); assert.equal(result.generationReady, true);
  assert.equal(result.timing.modelLoadMs, 123); assert.equal(result.timing.requests.length, 2);
  assert.ok(result.timing.totalMs >= result.timing.unloadMs);
  assert.equal(events[1].input.receipt.modelLoadMs, 123);
  assert.equal(events[0].input.requestId, events[1].input.requestId);
  assert.equal(session.getStatus().generationReady, true);
});

test('native sampling, opt-in JSON, ordered complete image data and literal text are preserved', async () => {
  const { session, calls } = fixture({ config: { maxTokens: 3000 } });
  await session.withSession(async ({ infer }) => {
    await infer(input({ user: '  代码```\n<image2>保留\n```  ', images: [{ dataUrl: PNG, name: 'first.png' }, { dataUrl: PNG, name: '第二张' }], maxTokens: 1800, temperature: 0.7 }));
    await infer(input({ responseFormat: { type: 'json_object' } }));
  });
  const [first, second] = calls.filter(call => call.body).map(call => call.body);
  assert.deepEqual(first.messages[1].content.filter(part => part.type === 'image_url').map(part => part.image_url.url), [PNG, PNG]);
  assert.equal(first.messages[1].content[0].text, '  代码```\n<image2>保留\n```  ');
  assert.equal(first.messages[1].content[1].text, '<image1>: first.png');
  assert.equal(first.messages[1].content[3].text, '<image2>: 第二张');
  assert.equal(first.response_format, undefined); assert.deepEqual(second.response_format, { type: 'json_object' });
  assert.equal(first.max_tokens, 1800); assert.equal(first.temperature, 0.7);
  for (const [key, value] of Object.entries({ top_p: 0.95, top_k: 20, min_p: 0, repetition_penalty: 1, seed: 957282577, reasoning_budget_tokens: 1024, reasoning_effort: 'low', stream: false })) assert.equal(first[key], value);
  assert.equal(first.tools, undefined); assert.equal(first.repeat_penalty, undefined);
  assert.ok(calls.every(call => call.init.redirect === 'error'));
});

test('verified real path takes precedence over aliases; contradictory authoritative path cannot hide behind alternate metadata', async () => {
  const matching = fixture({ ids: ['renamed-server-alias'], props: { model_path: 'e:\\MODELS\\swift-00001-of-00002.gguf' } });
  const result = await matching.session.withSession(({ infer }) => infer(input()));
  assert.equal(result.identity.id, 'renamed-server-alias'); assert.equal(result.identity.expectedIdMatched, false);
  assert.equal(result.identity.verification, 'server-weight-path');
  const wrong = fixture({ props: { model_path: 'E:/wrong.gguf', model: WEIGHT } });
  await assert.rejects(wrong.session.withSession(({ infer }) => infer(input())), code('strata-identity-mismatch'));
  assert.equal(wrong.calls.some(call => call.body), false); assert.equal(wrong.events.at(-1).type, 'unload');
});

test('ID-only identity is explicit; expected weight paths cannot fall back to matching ID', async () => {
  const idOnly = fixture({ expectedModel: { ids: [MODEL] }, props: new Response('', { status: 404 }) });
  assert.equal((await idOnly.session.withSession(({ identity }) => identity)).identity.verification, 'server-model-id');
  const pathRequired = fixture({ props: new Response('', { status: 404 }) });
  await assert.rejects(pathRequired.session.withSession(() => 'unused'), code('strata-http-error'));
  const ambiguous = fixture({ ids: ['one', 'two'] });
  await assert.rejects(ambiguous.session.withSession(() => 'unused'), code('strata-identity-mismatch'));
});

test('overlapping sessions and overlapping inference calls are rejected without another load', async () => {
  const chat = deferred(), entered = deferred();
  const { session, events } = fixture({ onChat: async () => { entered.resolve(); return chat.promise; } });
  const running = session.withSession(async ({ infer }) => {
    const first = infer(input()); await entered.promise;
    await assert.rejects(infer(input()), code('strata-busy'));
    return first;
  });
  await entered.promise;
  await assert.rejects(session.withSession(() => 'other'), code('strata-busy'));
  chat.resolve(JSON_RESPONSE({ model: MODEL, choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }));
  await running;
  assert.equal(events.filter(event => event.type === 'load').length, 1);
});

test('release is awaited before value and generation gate become visible', async () => {
  const release = deferred(), entered = deferred();
  const { session } = fixture({ onUnload: async () => { entered.resolve(); return release.promise; } });
  let resolved = false;
  const running = session.withSession(() => 'value').then(value => { resolved = true; return value; });
  await entered.promise; await Promise.resolve();
  assert.equal(resolved, false); assert.equal(session.getStatus().busy, true); assert.equal(session.getStatus().generationReady, false);
  release.resolve({ released: true }); assert.equal((await running).generationReady, true);
});

test('callback failures still release resources without opening generation gate', async () => {
  const { session, events } = fixture();
  await assert.rejects(session.withSession(() => { throw Object.freeze(Object.assign(new Error('callback parse failed'), { code: 'fixture-parse' })); }), error => {
    assert.equal(error.code, 'fixture-parse'); assert.equal(error.resourcesReleased, true); assert.equal(error.generationReady, false); return true;
  });
  assert.equal(events.at(-1).type, 'unload'); assert.equal(session.getStatus().generationReady, false);
  assert.equal((await session.withSession(() => 'next task')).value, 'next task');
});

test('unconfirmed, thrown and timed-out unloads latch a permanent release fault', async () => {
  for (const onUnload of [async () => ({ released: false }), async () => { throw new Error('exit race'); }, () => new Promise(() => {})]) {
    const { session, events } = fixture({ onUnload, releaseTimeoutMs: 15 });
    await assert.rejects(session.withSession(({ infer }) => infer(input())), error => {
      assert.equal(error.code, 'strata-release-unconfirmed'); assert.equal(error.resourcesReleased, false); assert.equal(error.generationReady, false); return true;
    });
    await assert.rejects(session.withSession(() => 'blocked'), code('strata-release-unconfirmed'));
    assert.equal(events.filter(event => event.type === 'load').length, 1);
    assert.equal(session.getStatus().cleanupFault, true);
  }
});

test('external cancellation and overall timeout use fresh, bounded cleanup signals', async () => {
  for (const cancel of [true, false]) {
    const entered = deferred(), abort = new AbortController(); let inferenceSignal, cleanupSignal;
    const { session } = fixture({ timeoutMs: cancel ? 1000 : 15,
      onChat: call => { inferenceSignal = call.init.signal; entered.resolve(); return new Promise(() => {}); },
      onUnload: async value => { cleanupSignal = value.signal; assert.equal(cleanupSignal.aborted, false); return { released: true }; } });
    const running = session.withSession(({ infer }) => infer(input()), { signal: abort.signal });
    await entered.promise; if (cancel) abort.abort();
    await assert.rejects(running, error => {
      assert.equal(error.code, cancel ? 'strata-aborted' : 'strata-timeout'); assert.equal(error.resourcesReleased, true); return true;
    });
    assert.equal(inferenceSignal.aborted, true); assert.notEqual(cleanupSignal, inferenceSignal);
  }
});

test('cancellation before entry does not start a lifecycle; cancel() aborts an active session', async () => {
  const abort = new AbortController(); abort.abort();
  const before = fixture();
  await assert.rejects(before.session.withSession(() => 'no', { signal: abort.signal }), code('strata-aborted'));
  assert.equal(before.events.length, 0); assert.equal(before.session.cancel(), false);
  const entered = deferred(); const active = fixture({ onChat: () => { entered.resolve(); return new Promise(() => {}); } });
  const running = active.session.withSession(({ infer }) => infer(input())); await entered.promise;
  assert.equal(active.session.cancel(), true); await assert.rejects(running, code('strata-aborted'));
});

test('cancellation while unload is pending cannot skip cleanup or return a generation-ready result', async () => {
  const release = deferred(), entered = deferred();
  const { session } = fixture({ onUnload: async ({ signal }) => { entered.resolve(signal); return release.promise; } });
  const running = session.withSession(() => 'ready');
  const cleanupSignal = await entered.promise;
  assert.equal(session.cancel(), true); assert.equal(cleanupSignal.aborted, false);
  release.resolve({ released: true });
  await assert.rejects(running, error => { assert.equal(error.code, 'strata-aborted'); assert.equal(error.resourcesReleased, true); assert.equal(error.generationReady, false); return true; });
});

test('per-infer timeout bounds a long workflow and parent resource-floor errors retain their identity', async () => {
  const timed = fixture({ timeoutMs: 1000, config: { requestTimeoutMs: 15 }, onChat: () => new Promise(() => {}) });
  await assert.rejects(timed.session.withSession(({ infer }) => infer(input({ maxTokens: 8192 }))), error => {
    assert.equal(error.code, 'strata-timeout'); assert.equal(error.resourcesReleased, true); assert.ok(error.timing.totalMs < 500); return true;
  });
  const entered = deferred(), abort = new AbortController();
  const floor = Object.assign(new Error('RAM floor guard'), { code: 'flash-resource-floor' });
  const guarded = fixture({ onChat: () => { entered.resolve(); return new Promise(() => {}); } });
  const running = guarded.session.withSession(({ infer }) => infer(input()), { signal: abort.signal });
  await entered.promise; abort.abort(floor);
  await assert.rejects(running, error => { assert.equal(error.code, 'flash-resource-floor'); assert.equal(error.message, 'RAM floor guard'); assert.equal(error.resourcesReleased, true); return true; });
});

test('a failed/partially started load still receives owned cleanup', async () => {
  for (const onLoad of [async () => { throw new Error('partial load'); }, async () => ({ ok: false })]) {
    const { session, events, calls } = fixture({ onLoad });
    await assert.rejects(session.withSession(() => 'unused'), code('strata-load-failed'));
    assert.equal(events.at(-1).type, 'unload'); assert.equal(calls.length, 0);
  }
});

test('late noncooperative loader must settle then receive a second unload, or gate stays locked', async () => {
  const loading = deferred(), unloaded = deferred(); let unloadCount = 0;
  const { session } = fixture({ onLoad: () => loading.promise, timeoutMs: 10, releaseTimeoutMs: 100,
    onUnload: async () => { if (++unloadCount === 1) { unloaded.resolve(); setTimeout(() => loading.resolve({ ok: true }), 5); } return { released: true }; } });
  const running = session.withSession(() => 'no'); await unloaded.promise;
  await assert.rejects(running, error => { assert.equal(error.code, 'strata-timeout'); assert.equal(error.resourcesReleased, true); return true; });
  assert.equal(unloadCount, 2);
  const hung = fixture({ onLoad: () => new Promise(() => {}), timeoutMs: 10, releaseTimeoutMs: 15 });
  await assert.rejects(hung.session.withSession(() => 'no'), code('strata-release-unconfirmed'));
});

test('retained infer cannot issue requests after callback closes; fire-and-forget inference does not open gate', async () => {
  const retained = fixture(); let inferLater;
  await retained.session.withSession(({ infer }) => { inferLater = infer; return 'done'; });
  await assert.rejects(inferLater(input()), code('strata-session-closed'));
  assert.equal(retained.calls.some(call => call.body), false);
  const orphan = fixture({ onChat: () => new Promise(() => {}) });
  await assert.rejects(orphan.session.withSession(({ infer }) => { void infer(input()); return 'forgot await'; }), error => {
    assert.equal(error.code, 'strata-session-incomplete'); assert.equal(error.resourcesReleased, true); assert.equal(error.generationReady, false); return true;
  });
});

test('image type/order bounds reject invalid input without performing inference', async () => {
  for (const images of [[{ dataUrl: 'https://example.com/image.png' }], [{ dataUrl: 'data:image/png;base64,YWJjZA==' }], Array.from({ length: 17 }, () => ({ dataUrl: PNG }))]) {
    const { session, calls, events } = fixture();
    await assert.rejects(session.withSession(({ infer }) => infer(input({ images }))), code('strata-invalid-request'));
    assert.equal(calls.some(call => call.body), false); assert.equal(events.at(-1).type, 'unload');
  }
  const total = fixture({ config: { maxTotalImageBytes: 100 } });
  await assert.rejects(total.session.withSession(({ infer }) => infer(input({ images: [{ dataUrl: PNG }, { dataUrl: PNG }] }))), code('strata-invalid-request'));
});

test('tool output, truncated text and a substituted response model are rejected and released', async () => {
  for (const [answer, expected] of [
    [{ model: MODEL, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{}] } }] }, 'strata-tool-response'],
    [{ model: MODEL, choices: [{ finish_reason: 'length', message: { content: 'half' } }] }, 'strata-output-truncated'],
    [{ model: 'other', choices: [{ finish_reason: 'stop', message: { content: 'text' } }] }, 'strata-identity-mismatch']
  ]) {
    const { session, events } = fixture({ answer });
    await assert.rejects(session.withSession(({ infer }) => infer(input())), code(expected));
    assert.equal(events.at(-1).type, 'unload');
  }
});

test('response reading is bounded while streaming, even without a content-length header', async () => {
  let cancelled = false, reads = 0;
  const { session } = fixture({ config: { maxResponseBytes: 256 }, onChat: () => new Response(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(180)); }, cancel() { cancelled = true; }
  })) });
  await assert.rejects(session.withSession(({ infer }) => infer(input())), code('strata-invalid-response'));
  assert.equal(cancelled, true); assert.ok(reads <= 4);
});

test('HTTP/invalid JSON errors are bounded and never leak response bodies', async () => {
  for (const response of [new Response('secret-service-log', { status: 500 }), new Response('not-json')]) {
    const { session, events } = fixture({ onChat: () => response });
    await assert.rejects(session.withSession(({ infer }) => infer(input())), error => {
      assert.ok(['strata-http-error', 'strata-invalid-response'].includes(error.code)); assert.doesNotMatch(error.message, /secret-service-log|not-json/); return true;
    });
    assert.equal(events.at(-1).type, 'unload');
  }
});
