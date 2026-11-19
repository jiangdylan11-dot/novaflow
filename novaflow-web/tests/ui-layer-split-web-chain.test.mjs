// Old website clients must not enqueue splits or begin paid UI recognition during the pause.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createControlPlane, validateTaskParameters } from '../packages/shared/src/control-plane.mjs';
import { UI_LAYER_SPLIT_CAPABILITY, UI_LAYER_SPLIT_SCOPE } from '../worker/src/worker-core.mjs';

const runtime = await readFile(new URL('../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
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

test('a cached request is refused before a task is created even when a split worker is online', async () => {
  const h = harness({ nodes: 1 });
  const response = await h.run('reverse-image-prompt', splitRequest);
  assert.equal(response.ok, false);
  assert.equal(h.created.length, 0);
  assert.equal(h.getUpload(), undefined);
  const plane = createControlPlane({ store: {}, secrets: {sessionSecret: secret} });
  for (const [path, body] of [
    ['/api/web/tasks', {task_type:'prompt_assistant',parameters:{ui_scope:UI_LAYER_SPLIT_SCOPE}}],
    ['/api/web/companion/operation/prepare', {intent:{mode:'style-analysis',kind:'ui-layers'}}]
  ]) {
    const result = await plane.handle({method:'POST', path, headers, body});
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'ui-split-paused');
  }
  assert.throws(() => validateTaskParameters('prompt_assistant', {action:'reverse-image-prompt',
    ui_scope:UI_LAYER_SPLIT_SCOPE,references:[{name:'request.json',kind:'json',bytes:10}]}), /暂时停用/);
});

test('other prompt requests keep their own refusal', async () => {
  const result = await harness({ nodes: 1 }).run('reverse-image-prompt', { surface: 'art', images: splitRequest.images });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, undefined);
  assert.match(result.error, /提示词助手在 Web 版通过智能 AI 提供/);
});
