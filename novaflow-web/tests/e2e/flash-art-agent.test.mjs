import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createFlashBrainSession } from '../../worker/src/flash-brain-session.mjs';
import { createFlashArtAgent, computeArtAgentFingerprint, canonicalArtAgentJSON, prepareFlashArtAgentPayload,
  FLASH_ART_AGENT_TOOLS, FLASH_CREATION_AGENT_TOOLS, FLASH_CHAT_AGENT_SYSTEM, FLASH_CREATION_AGENT_SYSTEM } from '../../worker/src/flash-art-agent.mjs';

// Native transport, model identity and ownership are mocked; no GPU/server starts.
const MODEL = 'swift-agent-fixture', WEIGHT = 'E:/models/swift-fixture.gguf';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const rawPrompt = '  Use <image1> for the airport subject.\nDesign cool environmental light and layered painted shadows.  ';
function payload(extra = {}) {
  const value = { requestId: randomUUID(), mode: 'creation', message: '头发太写实，请按参考的发束和画法重绘', history: [],
    artContext: { task: 'creation', provider: 'local', engine: 'qwen-2.1', nsfw: false, mode: 'img2img', prompt: 'original prompt', negativePrompt: '  keep my negative\nexactly  ',
      width: 1280, height: 960, cfg: 1, steps: 8, seed: 54792256 },
    images: [{ dataUrl: PNG, role: 'subject' }], ...extra };
  value.contextFingerprint = computeArtAgentFingerprint(value);
  return value;
}
const chatPayload = (extra = {}) => ({ requestId: randomUUID(), mode: 'chat', message: '你好，可以帮我讨论一下配色吗？', history: [], ...extra });
function tool(name, args, id = 'call_1') {
  return { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] };
}
function fixture(answers, { unload = async () => ({ ok: true, released: true }), audit } = {}) {
  const calls = [], events = [];
  const session = createFlashBrainSession({ expectedModel: { ids: [MODEL], paths: [WEIGHT] },
    lifecycle: { async load() { events.push('load'); return { ok: true }; }, async unload() { events.push('unload'); return unload(); } },
    ...(audit ? { onInference: audit } : {}),
    fetchImpl: async (url, init) => {
      const json = value => new Response(JSON.stringify(value));
      if (url.endsWith('/v1/models')) return json({ data: [{ id: MODEL }] });
      if (url.endsWith('/props')) return json({ model_path: WEIGHT });
      assert.ok(url.endsWith('/v1/chat/completions'));
      const body = JSON.parse(init.body); calls.push(body);
      const message = typeof answers === 'function' ? answers(body, calls.length) : answers[calls.length - 1];
      assert.ok(message, 'An unexpected extra inference was attempted');
      return json({ model: MODEL, id: `request_${calls.length}`, choices: [{
        finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] });
    } });
  return { session, calls, events };
}
const invoke = async (agent, f, request) => {
  const prepared = agent.preflight(request);
  return f.session.withSession(flash => agent.run({ payload: prepared, flash }));
};
test('chat and creation system text stays byte-identical',()=>{
  const sha=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(sha(FLASH_CHAT_AGENT_SYSTEM),'66af68d3c3aebe8efb0abec824fe52f9d3b95da3211c9327876cb10fefc33f86');
  assert.equal(sha(FLASH_CREATION_AGENT_SYSTEM),'fbad9f88081d7ce264b5a98f494dd195a4612cf790dc289a205a5709453ee084');
});
test('native write and generation tools return bounded application actions while prompt-only stays separate',async()=>{
  for(const [name,action] of [['propose_art_direction','prompt'],['apply_art_direction','apply'],['generate_art_image','generate']]) {
    const request=payload(), f=fixture([tool('get_art_context',{}),tool(name,{contextFingerprint:request.contextFingerprint,prompt:rawPrompt,explanation:'交由应用执行'},'call_2')]);
    const result=await invoke(createFlashArtAgent(),f,request); assert.equal(result.value.proposal.action,action); assert.equal(result.value.proposal.resourcesReleased,undefined); assert.equal(result.resourcesReleased,true); assert.deepEqual(f.events,['load','unload']);
  }
});
test('uncertain drawing intent asks one semantic question and returns no executable proposal',async()=>{
  const request=payload(),f=fixture([tool('ask_art_question',{question:'你希望保留原来的构图，还是重新设计构图？'})]);
  const result=await invoke(createFlashArtAgent(),f,request);
  assert.equal(result.value.needsInput,true);assert.equal(result.value.proposal,undefined);assert.match(result.value.reply,/构图/);assert.equal(f.calls.length,1);
});

test('creation without references and correction from current result use native tools and bind actual pixels',async()=>{
  for(const edit of [false,true]) {
    const request={requestId:randomUUID(),mode:'creation',message:edit?'改掉成图的黄调':'帮我画个花园',history:[],artContext:{task:'creation',provider:'local',engine:'qwen-2.1',nsfw:false,mode:'txt2img',prompt:'',negativePrompt:'keep negative'},images:edit?[{role:'result',dataUrl:PNG}]:[]};
    request.contextFingerprint=computeArtAgentFingerprint(request);
    const f=fixture([tool('get_art_context',{}),tool('generate_art_image',{contextFingerprint:request.contextFingerprint,prompt:edit?'Improve the lighting in <image1>.':'An illustrated sunny garden.',explanation:'准备执行',generationMode:edit?'img2img':'txt2img',width:1280,height:960},'call_2')]);
    const result=await invoke(createFlashArtAgent(),f,request); assert.equal(result.value.proposal.kind,'qwen21-agent-direct'); assert.equal(result.value.proposal.action,'generate'); assert.equal(result.value.proposal.generationMode,edit?'img2img':'txt2img'); assert.deepEqual(result.value.proposal.settings,{width:1280,height:960}); assert.deepEqual(f.calls[0].tools,FLASH_CREATION_AGENT_TOOLS);
    assert.equal(f.calls[0].messages[1].content.filter(i=>i.type==='image_url').length,edit?1:0);
    assert.equal(result.value.proposal.negativePrompt,'keep negative'); assert.deepEqual(f.events,['load','unload']);
  }
});
const code = expected => error => { assert.equal(error.code, expected); return true; };

test('ordinary local chat needs no drawing page, references or fingerprint and exposes no tools', async () => {
  const agent = createFlashArtAgent(), request = chatPayload();
  const f = fixture([{ role: 'assistant', content: '可以，你想营造怎样的情绪和氛围？' }]);
  const result = await invoke(agent, f, request), data = result.value;
  assert.deepEqual(f.events, ['load', 'unload']);
  assert.equal(result.resourcesReleased, true);
  assert.equal(f.calls.length, 1);
  assert.equal(data.mode, 'chat');
  assert.equal(data.proposal, undefined);
  assert.equal(data.contextFingerprint, undefined);
  assert.deepEqual(data.toolTrace, []);
  for (const field of ['tools', 'tool_choice', 'parallel_tool_calls', 'response_format']) assert.equal(f.calls[0][field], undefined);
  const actual = JSON.parse(f.calls[0].messages.at(-1).content[0].text);
  assert.deepEqual(actual.suppliedImageRoles, []);
  assert.deepEqual(actual.capabilities, { conversationOnly: true, toolsAvailable: false });
});

test('ordinary chat accepts optional page context and full current image without a drawing contract', async () => {
  const context = { surface: 'video', engine: 'other', nsfw: true, note: 'User-provided page data only.' };
  const request = chatPayload({ artContext: context, images: [{ dataUrl: PNG, role: 'attachment' }] });
  const f = fixture([{ role: 'assistant', content: '我只能根据本轮附图讨论，未读取其他页面或执行任务。' }]);
  const data = (await invoke(createFlashArtAgent(), f, request)).value;
  assert.equal(data.proposal, undefined);
  const content = f.calls[0].messages.at(-1).content;
  assert.deepEqual(JSON.parse(content[0].text).optionalPageContext, context);
  assert.equal(content.find(part => part.type === 'image_url').image_url.url, PNG);
});

test('ordinary chat cannot execute a model-returned tool call and always releases', async () => {
  const f = fixture([tool('get_art_context', {})]);
  await assert.rejects(invoke(createFlashArtAgent(), f, chatPayload()), code('strata-invalid-response'));
  assert.deepEqual(f.events, ['load', 'unload']);
  assert.equal(f.calls.length, 1);
});

test('ordinary chat invalid images and modes fail CPU preflight before any load', async () => {
  for (const request of [chatPayload({ mode: 'unknown' }), chatPayload({ images: [{ dataUrl: 'https://example.com/remote.png' }] }),
    chatPayload({ images: Array.from({ length: 4 }, () => ({ dataUrl: PNG })) }), chatPayload({ artContext: 'not a snapshot' })]) {
    const f = fixture([{ role: 'assistant', content: 'not requested' }]);
    await assert.rejects(invoke(createFlashArtAgent(), f, request));
    assert.deepEqual(f.events, []);
    assert.equal(f.calls.length, 0);
  }
});

test('explicit API provider can never fall back to local Flash, while omitted or local stays compatible', async () => {
  for (const request of [chatPayload({ provider: 'api' }), payload({ provider: 'api' }), chatPayload({ provider: 'unknown' })]) {
    const f = fixture([{ role: 'assistant', content: 'must not run' }]);
    await assert.rejects(invoke(createFlashArtAgent(), f, request), code('flash-agent-unsupported-provider'));
    assert.deepEqual(f.events, []);
    assert.equal(f.calls.length, 0);
  }
  for (const provider of [undefined, 'local']) {
    const request = chatPayload({ ...(provider === undefined ? {} : { provider }) });
    const f = fixture([{ role: 'assistant', content: '本地普通对话。' }]);
    assert.equal((await invoke(createFlashArtAgent(), f, request)).value.mode, 'chat');
    assert.equal(f.calls.length, 1);
  }
});

test('native tool loop reads actual snapshot then preserves transparent proposal and releases once', async () => {
  const request = payload(), agent = createFlashArtAgent();
  const f = fixture([tool('get_art_context', {}), tool('propose_art_direction', {
    contextFingerprint: request.contextFingerprint, prompt: rawPrompt, explanation: '按参考重画发束，保持冷环境光。' }, 'call_2')]);
  const result = await invoke(agent, f, request);
  assert.deepEqual(f.events, ['load', 'unload']);
  assert.equal(result.resourcesReleased, true);
  assert.equal(f.calls.length, 2);
  const data = result.value;
  assert.deepEqual(data.toolTrace.map(item => item.name), ['get_art_context', 'propose_art_direction']);
  assert.deepEqual(data.toolTrace[0].result.artContext, request.artContext);
  assert.equal(data.proposal.prompt, rawPrompt);
  assert.equal(data.proposal.negativePrompt, request.artContext.negativePrompt);
  assert.equal(data.proposal.cfg, request.artContext.cfg);
  assert.equal(data.proposal.kind, 'qwen21-agent-direct');
  assert.equal(data.proposal.version, 'agent-direct-v1');
  assert.deepEqual(data.proposal.sourceOrder, [1]);
  assert.equal(data.proposal.resourcesReleased, undefined);
  assert.equal(data.proposal.generationReady, undefined);
  assert.deepEqual(f.calls[1].messages.map(item => item.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(JSON.parse(f.calls[1].messages.at(-1).content).contextFingerprint, request.contextFingerprint);
  assert.equal(data.proposal.contextFingerprint,request.contextFingerprint);
  assert.deepEqual(f.calls[0].tools, FLASH_CREATION_AGENT_TOOLS);
  assert.deepEqual(f.calls[0].messages[1].content.filter(item => item.type === 'image_url').map(item => item.image_url.url), [PNG]);
  assert.equal(f.calls[0].response_format, undefined);
});

test('plain JSON text cannot masquerade as a native proposal tool call', async () => {
  const agent = createFlashArtAgent(), f = fixture([{ role: 'assistant', content: JSON.stringify({ prompt: rawPrompt }) }]);
  const result = await invoke(agent, f, payload());
  assert.equal(result.value.proposal, undefined);
  assert.deepEqual(result.value.toolTrace, []);
  assert.equal(f.calls.length, 1);
});

test('exact UI reference aliases keep all visual words and native audit without another model round', async () => {
  const request = payload(), original = '  Redraw @参考图1 in an anime form language.\nKeep cool light and bold hair masses.  ';
  const expected = original.replace('@参考图1', '<image1>');
  const f = fixture([tool('get_art_context', {}), tool('propose_art_direction', {
    contextFingerprint: request.contextFingerprint, prompt: original, explanation: '按参考重画造型。' }, 'call_2')]);
  const result = (await invoke(createFlashArtAgent(), f, request)).value;
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.events, ['load', 'unload']);
  assert.equal(result.proposal.prompt, expected);
  assert.equal(result.proposal.negativePrompt, request.artContext.negativePrompt);
  assert.equal(JSON.parse(result.toolTrace[1].arguments).prompt, original);
  assert.deepEqual(result.proposal.sourceCacheProvenance.agentPromptNormalization, {
    kind: 'reference-marker-alias-v1', originalPrompt: original,
    originalSHA256: createHash('sha256').update(original).digest('hex'),
    normalizedSHA256: createHash('sha256').update(expected).digest('hex')
  });
});

test('explicit HTML-escaped image slots normalize once while unrelated entities and all wording stay exact',async()=>{
  const request=payload(),original='  Redraw &lt;image1&gt; cleanly.\nKeep specular &amp; diffuse layers, not &lt;script&gt;.  ';
  const expected=original.replace('&lt;image1&gt;','<image1>');
  const f=fixture([tool('propose_art_direction',{contextFingerprint:request.contextFingerprint,prompt:original,explanation:'完整画法。'})]);
  const result=(await invoke(createFlashArtAgent(),f,request)).value;
  assert.equal(f.calls.length,1);assert.equal(result.proposal.prompt,expected);
  assert.equal(result.proposal.negativePrompt,request.artContext.negativePrompt);
  assert.equal(JSON.parse(result.toolTrace[0].arguments).prompt,original);
  assert.equal(result.proposal.sourceCacheProvenance.agentPromptNormalization.originalSHA256,createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(f.events,['load','unload']);
});

test('unknown, ambiguous or missing reference markers still reject instead of guessing or retrying', async () => {
  for (const prompt of ['Use @参考图1 and @参考图3.', 'Use @参考图01 and @参考图2.',
    'Use @参考图1 and @参考图二.', 'Use <image1> and <image3>.', 'Use &lt;image1&gt; and &lt;image3&gt;.', 'Use &lt;image01&gt; and &lt;image2&gt;.', 'Redraw the source in that style.']) {
    const request = payload(), f = fixture([tool('get_art_context', {}), tool('propose_art_direction', {
      contextFingerprint: request.contextFingerprint, prompt, explanation: 'test' }, 'call_2')]);
    await assert.rejects(invoke(createFlashArtAgent(), f, request), code('flash-agent-invalid-proposal'));
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.events, ['load', 'unload']);
  }
});

test('stale snapshot, malformed or excess arguments and duplicate calls fail and release', async () => {
  const request = payload();
  const cases = [
    { responses: [tool('propose_art_direction', { contextFingerprint: '0'.repeat(64), prompt: rawPrompt, explanation: 'x' })], code: 'flash-agent-stale-context' },
    { responses: [tool('get_art_context', '{broken')], code: 'flash-agent-invalid-tool-call' },
    { responses: [tool('get_art_context', { command: 'shell' })], code: 'flash-agent-invalid-tool-call' },
    { responses: [tool('get_art_context', {}), tool('get_art_context', {}, 'call_1')], code: 'flash-agent-invalid-tool-call' },
    { responses: [tool('unknown_shell', {})], code: 'strata-invalid-response' },
    { responses: [tool('get_art_context', {}), tool('propose_art_direction', {
      contextFingerprint: request.contextFingerprint, prompt: rawPrompt, explanation: 'x', cfg: 99 }, 'call_2')], code: 'flash-agent-invalid-proposal' }
  ];
  for (const item of cases) {
    const f = fixture(item.responses);
    await assert.rejects(invoke(createFlashArtAgent(), f, request), code(item.code));
    assert.deepEqual(f.events, ['load', 'unload']);
    assert.equal(f.session.getStatus().generationReady, false);
  }
});

test('three-round budget has no implicit retry, extra rewrite, or fourth model request', async () => {
  const f = fixture([1, 2, 3].map(index => tool('get_art_context', {}, `call_${index}`)));
  await assert.rejects(invoke(createFlashArtAgent(), f, payload()), code('flash-agent-budget'));
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.events, ['load', 'unload']);
});

test('fingerprint covers all state fields and decoded full bytes, independent of object key insertion order', () => {
  const request = payload(), reordered = { ...request, artContext: Object.fromEntries(Object.entries(request.artContext).reverse()) };
  assert.equal(computeArtAgentFingerprint(request), computeArtAgentFingerprint(reordered));
  for (const field of ['prompt', 'negativePrompt', 'seed', 'cfg', 'steps', 'width', 'height']) {
    const changed = structuredClone(request); changed.artContext[field] = typeof changed.artContext[field] === 'string' ? 'changed' : 123;
    assert.notEqual(computeArtAgentFingerprint(changed), request.contextFingerprint);
  }
  const changed = structuredClone(request);
  const bytes = Buffer.from(PNG.split(',')[1], 'base64'); bytes[bytes.length - 1] ^= 1;
  changed.images[0].dataUrl = 'data:image/png;base64,' + bytes.toString('base64');
  assert.notEqual(computeArtAgentFingerprint(changed), request.contextFingerprint);
  assert.equal(canonicalArtAgentJSON({ z: [2, 1], a: { y: 'x', b: 1 } }), '{"a":{"b":1,"y":"x"},"z":[2,1]}');
});

test('invalid or stale snapshot, wrong provider and unsupported roles make no model call', async () => {
  const agent = createFlashArtAgent();
  for (const mutation of [request => { request.artContext.seed++; }, request => { request.artContext.provider = 'api'; },
    request => { request.artContext.referenceRoles = ['style', 'subject']; }]) {
    const request = payload(); mutation(request);
    let calls = 0;
    await assert.rejects(agent.run({ payload: request, flash: { identity: { id: MODEL }, inferConversation() { calls++; } } }));
    assert.equal(calls, 0);
  }
});

test('CPU preflight rejects invalid context, bytes, request IDs and history before loading Flash', async () => {
  const mutations = [
    request => { request.requestId = 'short'; },
    request => { request.requestId = 'request with spaces'; },
    request => { request.artContext.engine = 'sdxl'; },
    request => { request.artContext.nsfw = true; },
    request => { delete request.artContext.nsfw; },
    request => { request.artContext.mode = 'txt2img'; },
    request => { request.images[0].dataUrl = 'data:image/png;base64,dGVzdA=='; },
    request => { request.history = [{ role: 'tool', content: 'pretend-executed' }]; },
    request => { request.contextFingerprint = '0'.repeat(64); },
    request => { request.conversationId = 'unknown-conversation'; }
  ];
  for (const mutate of mutations) {
    const request = payload(); mutate(request);
    const f = fixture([{ role: 'assistant', content: 'should not load' }]);
    await assert.rejects(invoke(createFlashArtAgent(), f, request));
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.calls, []);
  }
  const request = payload(); request.artContext.nsfw = true;
  assert.throws(() => prepareFlashArtAgentPayload(request), /暂不支持 NSFW/);
});

test('creation execution confirmation requires the effective sampling snapshot and chat never accepts it',()=>{
  const request={requestId:randomUUID(),mode:'creation',message:'生成一张花园插画',history:[],images:[],
    artContext:{task:'creation',provider:'local',engine:'qwen-2.1',nsfw:false,mode:'txt2img',prompt:'',negativePrompt:'',localQwen21Variant:'turbo',steps:8,cfg:2}};
  request.contextFingerprint=computeArtAgentFingerprint(request);
  request.executionApproval={schema:'nf.art.execution-approval.v1',requestId:request.requestId,contextFingerprint:request.contextFingerprint,
    action:'generate',imageCount:1,sampling:{variant:'turbo',steps:8,cfg:2},basis:'sampling-confirmation'};
  assert.deepEqual(prepareFlashArtAgentPayload(request).executionApproval,request.executionApproval);
  const stale=structuredClone(request);stale.executionApproval.sampling.cfg=3;
  assert.throws(()=>prepareFlashArtAgentPayload(stale),code('flash-agent-invalid-approval'));
  const chat={...chatPayload(),executionApproval:request.executionApproval};
  assert.throws(()=>prepareFlashArtAgentPayload(chat),code('flash-agent-invalid-approval'));
});

test('conversation audit redacts all full-image data and release failure never becomes a successful result', async () => {
  const records = [];
  const f = fixture([{ role: 'assistant', content: '收到。' }], { audit: record => records.push(record), unload: async () => ({ released: false }) });
  await assert.rejects(invoke(createFlashArtAgent(), f, payload()), code('strata-release-unconfirmed'));
  assert.equal(JSON.stringify(records).includes('base64,'), false);
  const hashes = records[0].request.messages[1].content.filter(item => item.type === 'image_audit').map(item => item.sha256);
  assert.deepEqual(hashes, [0].map(() => createHash('sha256').update(Buffer.from(PNG.split(',')[1], 'base64')).digest('hex')));
  assert.equal(f.session.getStatus().generationReady, false);
});
