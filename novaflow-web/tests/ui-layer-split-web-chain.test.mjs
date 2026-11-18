// UI 拆图 → 确认拆图 on the website. When no node can take the split, the page must crop the confirmed boxes
// itself and say the result is not filled in, instead of showing the prompt assistant's refusal in red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const runtime = await readFile(new URL('../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
const panel = await readFile(new URL('../renderer/ui-design.smart-split.js', import.meta.url), 'utf8');
const begin = runtime.indexOf('  async function localPromptAssistant('), end = runtime.indexOf('  async function pooledPromptStatus(', begin);
assert.ok(begin > 0 && end > begin);
const splitRequest = { surface: 'ui-design', purpose: 'ui-layer-split', visualSchema: 'nf.ui.layers.v1',
  images: [{ name: 'ui.png', role: 'source', dataUrl: 'data:image/png;base64,AAAA' }], regions: [{ id: 'r1', name: 'coin', kind: 'object', box: [10, 10, 200, 200], parentId: '' }] };

function harness(caps) {
  const posts = [];
  const ctx = { root: { setTimeout, clearTimeout, crypto: globalThis.crypto }, TextEncoder, TextDecoder, Map, Set, Date, Error, JSON, String, Object, AbortController,
    QWEN_ROTATION_CANDIDATE_RELEASE_ENABLED: false, computeNode: null, computeNodeEpoch: 0, pooledPromptRequests: new Map(), pooledConversationNodes: new Map(), tasks: new Map(),
    PROMPT_ASSISTANT_TIMEOUT_MS: 1000, PROMPT_ASSISTANT_REFUSAL: '提示词助手在 Web 版通过智能 AI 提供', taskMode: () => 'shared',
    control: async (method, path, body) => { if (method === 'GET') return caps; posts.push([path, body]); throw Error('nothing may be created'); } };
  createContext(ctx); runInContext(runtime.slice(begin, end) + '\nglobalThis.run=localPromptAssistant;', ctx);
  return { run: ctx.run, posts };
}

test('with no node able to take it, 确认拆图 gets a marked refusal and creates no task', async () => {
  for (const caps of [{ taskTypes: [], features: {} }, { taskTypes: [{ task_type: 'prompt_assistant', available_workers: 0 }], features: { qwenImage21Turbo: true } }]) {
    const h = harness(caps), result = await h.run('reverse-image-prompt', splitRequest);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'ui-split-node-unavailable');
    assert.equal(result.error, '当前没有可用的拆图节点');
    assert.doesNotMatch(result.error, /提示词助手/, 'a split never talks about the prompt assistant');
    assert.equal(h.posts.length, 0);
  }
});

test('other prompt requests keep their own refusal', async () => {
  const result = await harness({ taskTypes: [], features: {} }).run('reverse-image-prompt', { surface: 'art', images: splitRequest.images });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, undefined);
  assert.match(result.error, /提示词助手在 Web 版通过智能 AI 提供/);
});

test('the panel crops the boxes itself on that refusal and says so', () => {
  assert.match(panel, /result\.errorCode === 'ui-split-node-unavailable' \|\| result\.errorCode === 'flash-model-missing'\)\) unfilled = '当前没有可用的拆图节点'/);
  assert.match(panel, /unfilled \+ '，改为按识别框直接裁切（未补全）…'/, 'the working dialog shows the switch while it runs');
  assert.match(panel, /unfilled \? unfilled \+ '，已按识别框直接裁切（未补全）：'/, 'and the closing note states the result is not filled in');
  assert.doesNotMatch(panel, /\/拆图\|分割\|去除\|图像服务\|模型\//, 'a refusal that merely mentions 模型 is not a failed split');
  // The crop still runs after the refusal: the throw for a real failure is the only other exit before it.
  const split = panel.slice(panel.indexOf('async function split()'), panel.indexOf("overlay.addEventListener('wheel'"));
  assert.ok(split.indexOf("unfilled = '当前没有可用的拆图节点'") < split.indexOf('core.extract(next.source, work'));
});
