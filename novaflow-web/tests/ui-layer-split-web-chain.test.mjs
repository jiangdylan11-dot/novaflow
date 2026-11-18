// UI 拆图 → 确认拆图 on the website.
// A node that reported the split capability gets the request as its own kind of task; when no node can take
// it, the page crops the confirmed boxes itself and says the result is not filled in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createControlPlane, validateTaskParameters } from '../packages/shared/src/control-plane.mjs';
import { validatePromptAssistantModelRoute, UI_LAYER_SPLIT_CAPABILITY, UI_LAYER_SPLIT_SCOPE, UI_CPU_CAPABILITY } from '../worker/src/worker-core.mjs';

const runtime = await readFile(new URL('../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
const panel = await readFile(new URL('../renderer/ui-design.smart-split.js', import.meta.url), 'utf8');
const begin = runtime.indexOf('  async function localPromptAssistant('), end = runtime.indexOf('  async function pooledPromptStatus(', begin);
assert.ok(begin > 0 && end > begin);
const userId = '22222222-2222-4222-8222-222222222222', secret = 'synthetic-session-secret';
const encoded = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const headers = { authorization: 'Bearer nfs_' + encoded + '.' + createHmac('sha256', secret).update(encoded).digest('base64url') };
const splitRequest = { surface: 'ui-design', purpose: 'ui-layer-split', visualSchema: 'nf.ui.layers.v1',
  images: [{ name: 'ui.png', role: 'source', dataUrl: 'data:image/png;base64,AAAA' }], regions: [{ id: 'r1', name: 'coin', kind: 'object', box: [10, 10, 200, 200], parentId: '' }] };
const layers = { visualSchema: 'nf.ui.layers.v1', width: 10, height: 10, layers: [{ id: 'background', group: 'background' }, { id: 'r1', group: 'element' }] };

// The page's own code against the real control plane; only the database and the network are stand-ins.
function harness({ nodes = 0, reply = { ok: true, data: layers } } = {}) {
  const created = [], counted = []; let upload;
  const store = { getUserById: async () => ({ id: userId, status: 'active', plan: 'pro' }), getWorkerById: async () => null,
    countCapableWorkers: async model => { counted.push(model); return model === UI_LAYER_SPLIT_CAPABILITY ? nodes : 0; },
    createTask: async entry => { created.push(entry); return { id: 'test-task', user_id: userId, task_type: entry.taskType, model_id: entry.modelId, input_manifest: entry.inputManifest, status: 'queued' }; } };
  const plane = createControlPlane({ store, secrets: { sessionSecret: secret } });
  const ctx = { root: { setTimeout, clearTimeout, crypto: globalThis.crypto }, TextEncoder, TextDecoder, Map, Set, Date, Error, JSON, String, Object, AbortController,
    QWEN_ROTATION_CANDIDATE_RELEASE_ENABLED: false, computeNode: null, computeNodeEpoch: 0, pooledPromptRequests: new Map(), pooledConversationNodes: new Map(), tasks: new Map(),
    PROMPT_ASSISTANT_TIMEOUT_MS: 1000, PROMPT_ASSISTANT_REFUSAL: '提示词助手在 Web 版通过智能 AI 提供', taskMode: () => 'shared',
    control: async (method, path, body) => { const r = await plane.handle({ method, path: path.split('?')[0], headers, query: {}, body }); if (r.status !== 200) throw Error(r.body.error); return r.body; },
    putTaskInput: async (_id, _file, bytes) => { upload = JSON.parse(new TextDecoder().decode(bytes)); }, waitForTaskEnd: async () => ({}),
    fetchTaskOutput: async () => new TextEncoder().encode(JSON.stringify(reply)) };
  createContext(ctx); runInContext(runtime.slice(begin, end) + '\nglobalThis.run=localPromptAssistant;', ctx);
  return { run: ctx.run, created, counted, getUpload: () => upload };
}

test('a node that reported the split capability gets 确认拆图 as its own task', async () => {
  const h = harness({ nodes: 1 }), result = await h.run('reverse-image-prompt', splitRequest);
  assert.equal(result.ok, true);
  assert.equal(result.data.visualSchema, 'nf.ui.layers.v1');
  assert.equal(h.created.length, 1);
  const entry = h.created[0], params = entry.inputManifest.parameters;
  assert.equal(entry.taskType, 'prompt_assistant');
  assert.equal(entry.modelId, UI_LAYER_SPLIT_CAPABILITY, 'only a node that reported the capability is given the task');
  assert.equal(params.ui_scope, UI_LAYER_SPLIT_SCOPE);
  assert.equal(params.model_id, UI_LAYER_SPLIT_CAPABILITY);
  assert.deepEqual(h.getUpload().regions, splitRequest.regions, 'the confirmed boxes reach the node unchanged');
  // The node accepts exactly this pairing of task and uploaded request, and nothing else under the scope.
  const task = { model_id: entry.modelId, parameters: params };
  assert.doesNotThrow(() => validatePromptAssistantModelRoute(task, h.getUpload()));
  assert.throws(() => validatePromptAssistantModelRoute(task, { ...h.getUpload(), purpose: 'ui-layer-proposal' }));
  assert.throws(() => validatePromptAssistantModelRoute(task, { surface: 'ui-design', uiPlanner: 'grok-vision-cpu-v1', action: 'capabilities' }));
  assert.throws(() => validatePromptAssistantModelRoute({ model_id: UI_CPU_CAPABILITY, parameters: params }, h.getUpload()));
});

test('the server names the capability itself and refuses a caller that tries to', () => {
  const refs = [{ name: 'request.json', kind: 'json', bytes: 10 }];
  const clean = validateTaskParameters('prompt_assistant', { action: 'reverse-image-prompt', ui_scope: UI_LAYER_SPLIT_SCOPE, references: refs });
  assert.equal(clean.model_id, UI_LAYER_SPLIT_CAPABILITY);
  assert.equal(clean.ui_scope, UI_LAYER_SPLIT_SCOPE);
  assert.throws(() => validateTaskParameters('prompt_assistant', { action: 'reverse-image-prompt', ui_scope: UI_LAYER_SPLIT_SCOPE, model_id: 'qwen3.5-9b-heretic', references: refs }));
  assert.throws(() => validateTaskParameters('prompt_assistant', { action: 'optimize-prompt', ui_scope: UI_LAYER_SPLIT_SCOPE, references: refs }));
  assert.throws(() => validateTaskParameters('prompt_assistant', { action: 'reverse-image-prompt', ui_scope: 'layer-split-v2', references: refs }));
});

test('with no node able to take it, 确认拆图 gets a marked refusal and creates no task', async () => {
  const h = harness({ nodes: 0 }), result = await h.run('reverse-image-prompt', splitRequest);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'ui-split-node-unavailable');
  assert.equal(result.error, '当前没有可用的拆图节点');
  assert.doesNotMatch(result.error, /提示词助手/, 'a split never talks about the prompt assistant');
  assert.equal(h.created.length, 0);
  assert.ok(h.counted.includes(UI_LAYER_SPLIT_CAPABILITY), 'the page asked the server how many nodes can split');
});

test('other prompt requests keep their own refusal', async () => {
  const result = await harness({ nodes: 1 }).run('reverse-image-prompt', { surface: 'art', images: splitRequest.images });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, undefined);
  assert.match(result.error, /提示词助手在 Web 版通过智能 AI 提供/);
});

test('the panel crops the boxes itself on a refusal and says so', () => {
  assert.match(panel, /result\.errorCode === 'ui-split-node-unavailable' \|\| result\.errorCode === 'flash-model-missing' \|\| result\.errorCode === 'ui-layer-split-unavailable' \|\| String\(result\.error \|\| ''\)\.startsWith\('当前没有可用的拆图节点'\)\)\) unfilled = '当前没有可用的拆图节点'/);
  assert.match(panel, /unfilled \+ '，改为按识别框直接裁切（未补全）…'/, 'the working dialog shows the switch while it runs');
  assert.match(panel, /unfilled \? unfilled \+ '，已按识别框直接裁切（未补全）：'/, 'and the closing note states the result is not filled in');
  assert.doesNotMatch(panel, /\/拆图\|分割\|去除\|图像服务\|模型\//, 'a refusal that merely mentions 模型 is not a failed split');
  const split = panel.slice(panel.indexOf('async function split()'), panel.indexOf("overlay.addEventListener('wheel'"));
  assert.ok(split.indexOf("unfilled = '当前没有可用的拆图节点'") < split.indexOf('core.extract(next.source, work'));
});
