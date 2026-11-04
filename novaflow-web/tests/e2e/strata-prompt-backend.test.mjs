import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createStrataPromptBackend, STRATA_DEFAULT_BASE_URL, isStrataPromptRequest } from '../../worker/src/strata-prompt-backend.mjs';

// HTTP and lifecycle are mocked. These tests start no server and load no model.
const MODEL = 'verified-swift-flash-next.gguf';
const WEIGHT = 'E:/NovaFlow/models/LLM/verified-swift-flash-next.gguf';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const optimize = () => ({ surface: 'art', purpose: 'art-quality-optimize', prompt: '河边的一座小屋', negativePrompt: '水印', model: 'do-not-trust-request-alias' });
const request = () => ({ surface: 'art', purpose: 'art-director', visualSchema: 'nf.art.direction.v1', currentPrompt: '图9用图5画风', requirements: '保留动作和痣',
  artContext: { task: 'style', width: 1280, height: 960, editEnhancer: 'qwen21-pe-i2i', references: [{ source: 5, roles: ['style'] }, { source: 9, roles: ['subject'] }] },
  images: [{ dataUrl: PNG, name: 'style.png' }, { dataUrl: PNG, name: 'subject.png' }] });
const plan = () => ({ schema: 'nf.art.direction.v1', summary: '按照完整画法参考改绘', prompt: '将<image2>中的主体和场景按<image1>的成束明暗与线条边缘重新绘制，保持主体原有动作与痣。', preserve: ['动作与痣'], exclude: [], clarification: '',
  references: [{ source: 9, uses: [{ role: 'subject', detail: '源图实际人物与场景', box: [0, 0, 1000, 1000], samples: [] }], omit: [] },
    { source: 5, uses: [{ role: 'style', detail: '明确成束明暗关系，参考实际线条边缘', box: [0, 0, 1000, 1000], samples: [], renderingProfile: { markMaking: '有变化的线条边缘', shading: '实际参考的明暗层次' } }], omit: [] }],
  editEnhancer: { prompt: '将<image2>按<image1>画风改绘。', renderingClass: 'anime' } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function fixture({ answer = { positivePrompt: '河边木屋，清晰的木材纹理与水面反光。', negativePrompt: '水印' }, ids = [MODEL], props = { model_path: WEIGHT }, onChat, lifecycle, ...config } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/v1/models')) return json({ data: ids.map(id => ({ id })) });
    if (url.endsWith('/props')) return props instanceof Response ? props : json(props);
    if (url.endsWith('/v1/chat/completions')) return onChat ? onChat(calls.at(-1)) : json({ id: 'actual-response-id', model: MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }] });
    assert.fail('Unexpected endpoint: ' + url);
  };
  return { calls, backend: createStrataPromptBackend({ expectedModel: { ids: [MODEL], paths: [WEIGHT] }, fetchImpl, ...(lifecycle ? { lifecycle } : {}), ...config }) };
}

test('candidate is opt-in, loopback-only, and exposes synchronous original-image capability', () => {
  assert.equal(STRATA_DEFAULT_BASE_URL, 'http://127.0.0.1:8198');
  assert.equal(isStrataPromptRequest({ analysisBackend: 'strata' }), true);
  assert.equal(isStrataPromptRequest({}), false);
  const { backend } = fixture();
  assert.deepEqual({ ...backend.getStatus(), modelIdentity: undefined }, { ok: true, analysisBackend: 'strata', supportsOriginalImages: true, configured: true, busy: false, baseUrl: STRATA_DEFAULT_BASE_URL, modelIdentity: undefined });
  for (const baseUrl of ['https://127.0.0.1:8198', 'http://localhost:8198', 'http://127.1:8198', 'http://2130706433:8198', 'http://example.com:8198', 'http://127.0.0.1:8198/v1', 'http://127.0.0.1:8198/?x=1', 'http://u:p@127.0.0.1:8198']) {
    assert.throws(() => createStrataPromptBackend({ baseUrl }), /Strata地址必须/);
  }
});

test('identity is read from server and exact loaded path; request alias cannot select a model', async () => {
  const { backend, calls } = fixture();
  const result = await backend.optimizePrompt(optimize());
  assert.equal(result.ok, true);
  assert.equal(result.data.positivePrompt, '河边木屋，清晰的木材纹理与水面反光。');
  assert.equal(result.data.modelIdentity.path, WEIGHT);
  assert.equal(result.data.modelIdentity.verification, 'server-model-id-and-weight-path');
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/v1/models', '/props', '/v1/chat/completions']);
  assert.equal(calls[2].body.model, MODEL);
  assert.equal(calls[2].body.tools, undefined);
  assert.equal(calls[2].body.reasoning_effort, undefined);
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  assert.equal(result.data.generationReady, false, 'HTTP completion alone must not open generation gate');
  assert.equal(result.data.resourcesReleased, false);
  assert.equal(result.data.timing.modelLoadMs, null, 'unmeasured model load is not represented as zero');
  assert.equal(result.data.timing.serviceLoadMs, null);
});

test('missing configuration, model mismatch, and contradictory real path stop before inference', async () => {
  for (const config of [{ expectedModel: {} }, { ids: ['other-model'] }, { props: { model_path: 'E:/wrong/other.gguf' } }, { expectedModel: { ids: [WEIGHT], paths: [WEIGHT] }, ids: [WEIGHT], props: { model_path: 'E:/wrong/other.gguf' } }]) {
    const { backend, calls } = fixture(config);
    const result = await backend.optimizePrompt(optimize());
    assert.equal(result.ok, false);
    assert.ok(['strata-not-configured', 'strata-identity-mismatch'].includes(result.errorCode));
    assert.equal(calls.some(call => call.url.endsWith('/completions')), false);
  }
});

test('a server-reported ID is an explicit verification tier when props is unsupported', async () => {
  const { backend } = fixture({ expectedModel: { ids: [MODEL] }, props: new Response('', { status: 404 }) });
  const result = await backend.inspectIdentity();
  assert.equal(result.ok, true);
  assert.equal(result.data.modelIdentity.verification, 'server-model-id');
  assert.equal(result.data.modelIdentity.path, undefined);
});

test('full native images and order survive unchanged; sparse original source numbers map to compiler markers', async () => {
  const { backend, calls } = fixture({ answer: plan(), lifecycle: { unload: async () => ({ ok: true, released: true }) } });
  const input = request();
  const result = await backend.reverseImagePrompt(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.analysisBackend, 'strata');
  assert.equal(result.data.generationReady, true);
  const content = calls.at(-1).body.messages[1].content;
  assert.deepEqual(content.filter(part => part.type === 'image_url').map(part => part.image_url.url), input.images.map(image => image.dataUrl));
  assert.match(content[1].text, /原始图5.*<image1>.*style/);
  assert.match(content[3].text, /原始图9.*<image2>.*subject/);
  const enhancer = result.data.artDirection.editEnhancer;
  assert.equal(enhancer.kind, 'qwen21-pe-i2i', 'existing renderer compiler protocol is reused');
  assert.equal(enhancer.version, 'drawing-style-v1');
  assert.equal(enhancer.analysisBackend, 'strata');
  assert.equal(enhancer.model, MODEL, 'do not falsely attribute inference to PE checkpoint');
  assert.equal(enhancer.modelIdentity.id, MODEL);
  assert.deepEqual(enhancer.sourceOrder, [5, 9]);
  assert.deepEqual(enhancer.promptIds, ['actual-response-id']);
  assert.deepEqual(result.data.artDirection.references.map(ref => ref.source), [9, 5]);
  assert.deepEqual(result.data.artDirection.references.flatMap(ref => ref.uses).map(use => use.samples), [[], []]);
});

test('normal drawing text-to-image art-director uses raw prompt with zero references', async () => {
  const answer = { ...plan(), references: [] }; delete answer.editEnhancer;
  const { backend } = fixture({ answer });
  const result = await backend.reverseImagePrompt({ ...request(), currentPrompt: '山中的小屋', images: [], artContext: { width: 1024, height: 768, task: 'auto', references: [] } });
  assert.equal(result.ok, true);
  assert.equal(result.data.artDirection.prompt, answer.prompt);
  assert.deepEqual(result.data.artDirection.references, []);
  assert.equal(result.data.artDirection.editEnhancer, undefined);
});

test('text-to-image sends strict complete JSON Schema and an explicit complete object example', async () => {
  const answer = { ...plan(), references: [] }; delete answer.editEnhancer;
  const { backend, calls } = fixture({ answer });
  await backend.reverseImagePrompt({ ...request(), images: [], artContext: { width: 1280, height: 960, references: [] } });
  const body = calls.at(-1).body;
  assert.equal(body.response_format.type, 'json_schema');
  const spec = body.response_format.json_schema;
  assert.equal(spec.strict, true);
  assert.equal(spec.name, 'novaflow_art_direction_t2i');
  assert.equal(spec.schema.type, 'object');
  assert.equal(spec.schema.additionalProperties, false);
  assert.deepEqual(spec.schema.required, ['schema', 'summary', 'prompt', 'references', 'preserve', 'exclude', 'clarification']);
  assert.equal(spec.schema.properties.schema.const, 'nf.art.direction.v1');
  assert.equal(spec.schema.properties.references.maxItems, 0);
  assert.equal(spec.schema.properties.references.items, false);
  assert.equal(spec.schema.properties.editEnhancer, undefined);
  const example = JSON.parse(body.messages[0].content.split('\n').at(-1));
  assert.equal(example.schema, 'nf.art.direction.v1');
  assert.deepEqual(example.references, []);
  assert.deepEqual(Object.keys(example), spec.schema.required);
});

test('two-reference schema asks for one full prompt; trusted request supplies actual metadata and roles', async () => {
  const answer = { prompt: '将图9的主体和场景按图5的成束明暗与线条边缘重新绘制，保持动作与痣。', renderingClass: 'painterly' };
  const { backend, calls } = fixture({ answer });
  const result = await backend.reverseImagePrompt(request());
  const body = calls.at(-1).body, spec = body.response_format.json_schema;
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(spec.strict, true);
  assert.equal(spec.name, 'novaflow_art_direction_subject_style');
  assert.deepEqual(spec.schema.required, ['prompt', 'renderingClass']);
  assert.equal(spec.schema.additionalProperties, false);
  assert.equal(spec.schema.properties.references, undefined);
  assert.equal(spec.schema.properties.schema, undefined);
  assert.equal(spec.schema.properties.editEnhancer, undefined, 'model does not write a duplicate shorter instruction');
  assert.deepEqual(spec.schema.properties.renderingClass.enum, ['anime', 'animated-3d', 'painterly', 'other']);
  assert.equal(spec.schema.properties.renderingClass.const, undefined, 'schema must not force one target style');
  assert.deepEqual(spec.schema.properties.prompt.allOf, [{ pattern: '<image1>' }, { pattern: '<image2>' }]);
  const example = JSON.parse(body.messages[0].content.split('\n').at(-1));
  assert.deepEqual(example, { prompt: '', renderingClass: 'other' });
  assert.equal(result.ok, true);
  const direction = result.data.artDirection;
  assert.deepEqual(direction.references.map(ref => [ref.source, ref.uses[0].role]), [[5, 'style'], [9, 'subject']]);
  assert.ok(direction.references.every(ref => ref.uses[0].box.join(',') === '0,0,1000,1000' && ref.uses[0].samples.length === 0));
  assert.equal(direction.prompt, answer.prompt.replaceAll('图9', '<image2>').replaceAll('图5', '<image1>'));
  assert.equal(direction.editEnhancer.prompt, direction.prompt);
  assert.deepEqual(direction.editEnhancer.sourceOrder, [5, 9]);
  assert.equal(direction.editEnhancer.renderingClass, 'painterly');
});

test('real renderer validator accepts the existing compiler protocol and retains Strata model attribution', async () => {
  const { backend } = fixture({ answer: plan() });
  const result = await backend.reverseImagePrompt(request());
  const sandbox = createContext({});
  runInContext(readFileSync(new URL('../../renderer/art-direction.workflow.js', import.meta.url), 'utf8'), sandbox);
  const source = { engine: 'local', provider: 'local', prompt: '图9用图5画风', references: request().artContext.references };
  const validated = sandbox.NovaFlowArtDirection.validate(result.data.artDirection, source);
  assert.equal(validated.editEnhancer.model, MODEL);
  assert.equal(validated.editEnhancer.prompt, plan().prompt, 'full actual optimized instruction survives renderer validation instead of short legacy duplicate');
  assert.deepEqual(Array.from(validated.editEnhancer.sourceOrder), [5, 9]);
  assert.equal(validated.prompt, source.prompt, 'generic raw.prompt is not misrepresented as the executed instruction');
  assert.equal(result.data.modelIdentity.id, MODEL);
});

test('one complete prompt wins over short legacy duplicate; only explicit image numbers change', async () => {
  const answer = { prompt: '以图9为主体，参考图5为画法。皮肤是柔和渐变明暗，头发以片状高光表现体积；保持动作与痣。',
    clarification: '主体场景保留，参考只提供画法，不迁入其物件。', editEnhancer: { prompt: '把<image2>用<image1>改绘。', renderingClass: 'anime' } };
  const original = structuredClone(answer);
  const { backend } = fixture({ answer });
  const result = await backend.reverseImagePrompt(request());
  assert.equal(result.ok, true, 'missing repairable wrapper fields must not reject complete useful content');
  const direction = result.data.artDirection;
  const expected = '以<image2>为主体，<image1>为画法。皮肤是柔和渐变明暗，头发以片状高光表现体积；保持动作与痣。';
  assert.equal(direction.prompt, expected);
  assert.equal(direction.editEnhancer.prompt, expected);
  assert.equal(direction.editEnhancer.renderingClass, 'anime');
  assert.equal(direction.clarification, '', 'a completed declarative analysis note does not block renderer generation');
  assert.equal(direction.analysisNote, answer.clarification);
  assert.equal(direction.schema, 'nf.art.direction.v1');
  assert.deepEqual(direction.references.map(ref => ref.source), [5, 9]);
  assert.deepEqual(answer, original, 'adapter does not mutate or embellish observed facts');
});

test('legacy edit prompt remains usable when no primary prompt exists; unknown image references remain rejected', async () => {
  const answer = { editEnhancer: { prompt: '将<image2>主体按<image1>的画法重绘，保留原表情。', renderingClass: 'painterly' } };
  const result = await fixture({ answer }).backend.reverseImagePrompt(request());
  assert.equal(result.ok, true);
  assert.equal(result.data.artDirection.editEnhancer.prompt, answer.editEnhancer.prompt);
  const invalid = await fixture({ answer: { ...answer, prompt: '将图9主体按图3画风重绘。' } }).backend.reverseImagePrompt(request());
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorCode, 'strata-invalid-response');
  assert.equal(invalid.data.artDirection, undefined, 'do not hide a wrong source number by silently using a short fallback');
});

test('unsupported editing, remote images, invalid roles or mismatched image count are explicit failures with no model load', async () => {
  const variants = [
    input => { input.artContext.references[0].roles = ['pose']; },
    input => { input.artContext.references[0].excludedRoles = ['style']; },
    input => { input.images[0].dataUrl = 'https://example.com/image.png'; },
    input => { input.images[0].dataUrl = 'file:///C:/secret.png'; },
    input => { input.images[0].dataUrl = 'data:image/svg+xml;base64,PHN2Zz4='; },
    input => { input.images[0].dataUrl = PNG.replace('iVBOR', 'aVBOR'); },
    input => { input.images.pop(); },
    input => { input.artContext.references[1].source = 5; },
    input => { input.images.push(input.images[0]); input.artContext.references.push({ source: 3, roles: ['style'] }); },
  ];
  for (const change of variants) {
    let loads = 0;
    const { backend, calls } = fixture({ lifecycle: { load: async () => { loads++; } } });
    const input = request(); change(input);
    const result = await backend.reverseImagePrompt(input);
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
    assert.equal(loads, 0);
  }
});

test('malformed direction cannot silently crop, omit, relabel or hallucinate an image', async () => {
  const changes = [
    value => value.references.pop(),
    value => { value.references[0].source = 3; },
    value => { value.references[0].source = 5; },
    value => { value.references[0].uses[0].role = 'style'; },
    value => { value.references[1].uses[0].box = [100, 100, 800, 900]; },
    value => { value.references[1].uses[0].samples = [[0, 0, 100, 100]]; },
    value => { value.prompt = '只用<image1>改绘'; },
    value => { value.prompt += '<image3>'; },
    value => { value.editEnhancer.renderingClass = 'all-styles-anime'; },
  ];
  for (const change of changes) {
    const answer = plan(); change(answer);
    const { backend } = fixture({ answer });
    const result = await backend.reverseImagePrompt(request());
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'strata-invalid-response');
    assert.equal(result.data.generationReady, false);
    assert.equal(result.data.artDirection, undefined);
  }
});

test('generation waits for confirmed release, with separate timing and actual lifecycle receipt', async () => {
  let release, finished = false, loadedReceipt;
  const gate = new Promise(resolve => { release = resolve; });
  const events = [];
  const { backend } = fixture({ lifecycle: {
    load: async ({ signal }) => { assert.equal(signal.aborted, false); events.push('load'); loadedReceipt = { ok: true, pid: 123, modelLoadMs: 7.25 }; return loadedReceipt; },
    unload: async ({ receipt, signal }) => { assert.equal(receipt, loadedReceipt); assert.equal(signal.aborted, false); events.push('unload-start'); await gate; events.push('unload-complete'); return { ok: true, released: true }; },
  } });
  const pending = backend.optimizePrompt(optimize()).then(result => { finished = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(events, ['load', 'unload-start']);
  assert.equal(finished, false);
  assert.equal(backend.getStatus().busy, true);
  assert.equal((await backend.optimizePrompt(optimize())).errorCode, 'strata-busy');
  release();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.data.resourcesReleased, true);
  assert.equal(result.data.generationReady, true);
  assert.equal(result.data.timing.modelLoadMs, 7.25);
  for (const field of ['serviceLoadMs', 'identityMs', 'requestMs', 'unloadMs', 'totalMs']) assert.ok(Number.isFinite(result.data.timing[field]), field);
  assert.ok(result.data.timing.totalMs >= result.data.timing.requestMs);
  assert.equal(backend.getStatus().busy, false);
});

test('unconfirmed or failed release discards successful prompt; partial load also gets cleanup', async () => {
  for (const unload of [async () => ({}), async () => ({ ok: false, released: true }), async () => { throw new Error('private runtime detail'); }]) {
    const { backend } = fixture({ lifecycle: { unload } });
    const result = await backend.optimizePrompt(optimize());
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'strata-release-unconfirmed');
    assert.equal(result.data.positivePrompt, undefined);
    assert.equal(result.data.generationReady, false);
    assert.doesNotMatch(JSON.stringify(result), /private runtime detail/);
  }
  let cleaned = 0;
  const { backend, calls } = fixture({ lifecycle: { load: async () => { throw new Error('partial-start-private'); }, unload: async ({ signal }) => { cleaned++; assert.equal(signal.aborted, false); return { released: true }; } } });
  const result = await backend.optimizePrompt(optimize());
  assert.equal(result.ok, false);
  assert.equal(cleaned, 1);
  assert.equal(calls.length, 0);
  assert.equal(result.data.resourcesReleased, true);
  assert.equal(result.data.generationReady, false);
});

test('release has a bounded timeout and never opens the generation gate while unconfirmed', async () => {
  const { backend } = fixture({ releaseTimeoutMs: 15, lifecycle: { unload: () => new Promise(() => {}) } });
  const result = await backend.optimizePrompt(optimize());
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'strata-release-unconfirmed');
  assert.equal(result.data.generationReady, false);
  assert.equal(result.data.resourcesReleased, false);
  assert.ok(result.data.timing.unloadMs >= 10);
});

test('abort and deadline do not depend on fetch honoring signal, and cleanup uses fresh signal', async () => {
  for (const cancel of [false, true]) {
    let cleanup = 0, chatStarted;
    const started = new Promise(resolve => { chatStarted = resolve; });
    const controller = new AbortController();
    const { backend } = fixture({ timeoutMs: 25, onChat: () => { chatStarted(); return new Promise(() => {}); }, lifecycle: { unload: async ({ signal }) => { cleanup++; assert.equal(signal.aborted, false); return { released: true }; } } });
    const pending = backend.optimizePrompt(optimize(), { signal: controller.signal });
    await started;
    if (cancel) controller.abort();
    const result = await pending;
    assert.equal(result.errorCode, cancel ? 'strata-aborted' : 'strata-timeout');
    assert.equal(cleanup, 1);
    assert.equal(result.data.resourcesReleased, true);
    assert.equal(result.data.generationReady, false);
  }
  const { backend, calls } = fixture();
  const controller = new AbortController(); controller.abort();
  assert.equal((await backend.optimizePrompt(optimize(), { signal: controller.signal })).errorCode, 'strata-aborted');
  assert.equal(calls.length, 0);
});

test('tool calls, truncated or malformed content and inconsistent response identity fail closed', async () => {
  const replies = [
    { choices: [{ message: { tool_calls: [{ function: { name: 'read_file', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { function_call: { name: 'anything' } } }] },
    { choices: [{ message: { content: '{}' }, finish_reason: 'length' }] },
    { choices: [{ message: { content: '{broken' } }] },
    { model: 'some-other-model', choices: [{ message: { content: '{}' } }] },
    { choices: [{ message: { content: JSON.stringify({ positivePrompt: PNG, negativePrompt: '' }) } }] },
  ];
  for (const reply of replies) {
    const { backend } = fixture({ onChat: () => json(reply) });
    const result = await backend.optimizePrompt(optimize());
    assert.equal(result.ok, false);
    assert.equal(result.data.generationReady, false);
    assert.equal(result.data.positivePrompt, undefined);
    assert.doesNotMatch(JSON.stringify(result), /iVBOR|read_file|some-other-model/);
  }
});

test('HTTP/network errors never echo response bodies, image payload or credentials and never fall back', async () => {
  const secret = 'private-key-123';
  for (const onChat of [async () => new Response(secret + PNG, { status: 500 }), async () => { throw new Error(secret + PNG); }]) {
    const { backend, calls } = fixture({ apiKey: secret, onChat });
    const result = await backend.optimizePrompt(optimize());
    assert.equal(result.ok, false);
    assert.ok(['strata-http-error', 'strata-unavailable'].includes(result.errorCode));
    assert.doesNotMatch(JSON.stringify(result), /private-key-123|iVBOR/);
    assert.equal(calls.filter(call => call.url.endsWith('/completions')).length, 1);
    assert.ok(calls.every(call => call.options.headers.authorization === 'Bearer ' + secret));
  }
});

test('trusted sampling options are explicit; user-supplied tools, endpoints and settings are ignored', async () => {
  const { backend, calls } = fixture({ reasoningEffort: 'low', maxTokens: 3072, temperature: 0.3, topP: 0.95 });
  await backend.optimizePrompt({ ...optimize(), baseUrl: 'http://example.com', tools: [{ type: 'function' }], temperature: 2, max_tokens: 1 });
  const body = calls.at(-1).body;
  assert.equal(body.max_tokens, 3072);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.temperature, 0.3);
  assert.equal(body.top_p, 0.95);
  assert.equal(body.tools, undefined);
  assert.ok(calls.every(call => call.url.startsWith(STRATA_DEFAULT_BASE_URL + '/')));
});
