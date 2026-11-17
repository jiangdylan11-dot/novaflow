import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createContext, runInContext} from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertH3Beta7Runnable, runtimeSupportsW6a8} from '../../worker/src/h3-beta7-support.mjs';

const renderer = fileURLToPath(new URL('../../renderer/', import.meta.url));
const BETA7 = 'Minimax_H3\\10Eros_Max_h3_8stepTURBO_beta7_activation_learned_compact_w4w6int8_14.65gb.safetensors';
async function load(saved) {
  const memory = new Map(saved ? [['novaflow-h3-beta5-profiles-v1', JSON.stringify(saved)]] : []);
  const c = createContext({console, localStorage: {getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v)}});
  c.globalThis = c; c.window = c;
  for (const f of ['h3-prompt-format.js', 'ai-sequence-minimax-h3.resource.js', 'ai-sequence-minimax-h3-prompt.workflow.js', 'ai-sequence-minimax-h3.workflow.js'])
    runInContext(await readFile(path.join(renderer, f), 'utf8'), c, {filename: f});
  return {api: c.NovaFlowAiSequenceMiniMaxH3Workflow, memory};
}
const modes = {t2v: {}, i2v: {firstFrame: 'a.png'}, fl2v: {firstFrame: 'a.png', lastFrame: 'b.png'}, r2v: {referenceImages: ['a.png']}};

test('beta7 builds all four modes on its own checkpoint with 8 steps; beta5 stays default', async () => {
  const {api} = await load();
  assert.equal(api.getSelectedProfile(), 'beta5_int8');
  assert.equal(api.getProfileSettings('beta7_int8').steps, 8);
  for (const [mode, extra] of Object.entries(modes)) {
    const opts = {profile: 'beta7_int8', mode, prompt: 'x', seed: 1, ...extra};
    const wf = api.buildWorkflow(opts);
    api.validateWorkflow(wf, opts);
    assert.equal(wf['1'].inputs.unet_name, BETA7);
    assert.equal(wf['6'].inputs.steps, 8);
    assert.equal(api.supportsMode('beta7_int8', mode), true);
    const b5 = api.buildWorkflow({...opts, profile: 'beta5_int8'});
    assert.match(b5['1'].inputs.unet_name, /beta5_int8/);
  }
});

test('the selected line persists and drives the default build', async () => {
  let {api, memory} = await load();
  api.setSelectedProfile('beta7_int8');
  ({api} = await load(JSON.parse(memory.get('novaflow-h3-beta5-profiles-v1'))));
  assert.equal(api.getSelectedProfile(), 'beta7_int8');
  assert.equal(api.buildWorkflow({mode: 't2v', prompt: 'x', seed: 1})['1'].inputs.unet_name, BETA7);
});

test('a node without the w6a8 environment patch refuses beta7 only', async () => {
  const graph = {1: {class_type: 'UNETLoader', inputs: {unet_name: BETA7}}};
  assert.throws(() => assertH3Beta7Runnable(graph, {supports: () => false}), e => e.code === 'H3_BETA7_RUNTIME_UNSUPPORTED');
  assert.doesNotThrow(() => assertH3Beta7Runnable(graph, {supports: () => true}));
  assert.doesNotThrow(() => assertH3Beta7Runnable(graph, {supports: () => null}));
  assert.doesNotThrow(() => assertH3Beta7Runnable({1: {class_type: 'UNETLoader', inputs: {unet_name: 'Minimax_H3\\10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors'}}}, {supports: () => false}));
});

test('w6a8 support needs the quant entry and comfy-kitchen 0.2.41', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'foart-w6a8-'));
  assert.equal(runtimeSupportsW6a8({root}), null);
  await mkdir(path.join(root, 'engine/ComfyUI/comfy'), {recursive: true});
  await mkdir(path.join(root, 'engine/python/Lib/site-packages/comfy_kitchen-0.2.35.dist-info'), {recursive: true});
  await writeFile(path.join(root, 'engine/ComfyUI/comfy/quant_ops.py'), 'QUANT_ALGOS["asym_w4a8_int8"] = {}');
  assert.equal(runtimeSupportsW6a8({root}), false);
  await writeFile(path.join(root, 'engine/ComfyUI/comfy/quant_ops.py'), 'QUANT_ALGOS["w6a8_int8"] = {}');
  assert.equal(runtimeSupportsW6a8({root}), false);
  await mkdir(path.join(root, 'engine/python/Lib/site-packages/comfy_kitchen-0.2.41.dist-info'));
  assert.equal(runtimeSupportsW6a8({root}), true);
});
