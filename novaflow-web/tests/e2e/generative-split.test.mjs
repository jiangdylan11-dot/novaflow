import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { workflowModelId, isAllowedWorkflowCall } from '../../packages/shared/src/workflow-modules.mjs';
createRequire(import.meta.url)('../../renderer/generative-split.workflow.js');
const api = globalThis.NovaFlowGenerativeSplitWorkflow;
const unet = ['Qwen-Image-2.1-Turbo-BF16.gguf', 'qwen-image-2.1-UC-BF16.gguf'];
const info = Object.fromEntries(['LoadImage', 'NovaFlowGGUFBF16Loader', 'CLIPLoader', 'VAELoader', 'TextEncodeQwenImage21', 'QwenImage21Cache', 'BasicGuider', 'RandomNoise', 'KSamplerSelect', 'SamplerCustomAdvanced', 'VAEDecode', 'SaveImage', 'ManualSigmas', 'BasicScheduler'].map(name => [name, {}]));
info.NovaFlowGGUFBF16Loader.input = { required: { unet_name: [unet] } };
info.CLIPLoader.input = { required: { clip_name: [['qwen3vl_8b_bf16_heretic.safetensors']] } };
info.VAELoader.input = { required: { vae_name: [['qwen_image_2.1_vae_bf16.safetensors']] } };
const options = { profile: 'turbo', stage: 'object', imageName: 'original.png', guideName: 'guide.png', objectName: '帽子', seed: 42, taskProfile: 'generative-split' };

test('BF16 profiles, native RGBA latent and strict model availability', () => {
  for (const profile of ['turbo', 'standard']) {
    const graph = api.buildWorkflow({ ...options, profile, objectInfo: info });
    assert.equal(graph[3].inputs.unet_name, unet[profile === 'turbo' ? 0 : 1]);
    assert.equal(graph[4].inputs.clip_name, 'qwen3vl_8b_bf16_heretic.safetensors');
    assert.deepEqual(graph[12].inputs.latent_image, ['6', 2]);
    assert.equal(graph[6].inputs.resolution, 0);
    assert.equal(graph[7].inputs.dtype, 'default');
    assert(!Object.values(graph).some(node => /NoiseMask|RMBG/.test(node.class_type)));
    if (profile === 'turbo') assert.equal(graph[11].inputs.sigmas.split(',').length, 9);
    else assert.equal(graph[11].inputs.steps, 40);
  }
  assert.throws(() => api.buildWorkflow({ ...options, objectInfo: { ...info, NovaFlowGGUFBF16Loader: {} } }), /缺少模型/);
  assert.throws(() => api.buildWorkflow({ ...options, objectInfo: { ...info, ManualSigmas: null } }), /缺少节点/);
  assert.throws(() => api.buildWorkflow({ ...options, profile: 'int8', objectInfo: info }), /未知/);
  assert.match(api.promptForStage('object', '帽子'), /不限制补全范围/);
});

test('frame geometry fits source, aligns to 32 and obeys pixel budget', () => {
  for (const [w, h, b] of [[4032, 3024, { minX: 1234, minY: 987, width: 456, height: 678, count: 100 }], [75, 91, { minX: 70, minY: 85, width: 5, height: 6, count: 30 }], [100000, 1, { minX: 1, minY: 0, width: 99999, height: 1, count: 99999 }]]) {
    const f = api.planFrame(w, h, b);
    assert(f.x <= b.minX && f.y <= b.minY);
    assert(f.x + f.width <= w && f.y + f.height <= h);
    assert.equal(f.workingWidth % 32, 0);
    assert.equal(f.workingHeight % 32, 0);
    assert(f.workingWidth * f.workingHeight <= 1048576);
  }
  assert.throws(() => api.planFrame(100, 100, { width: NaN, height: 5, count: 20 }), /涂选/);
  assert.throws(() => api.planFrame(100, 100, { minX: 101, minY: 1, width: 5, height: 5, count: 25 }), /涂选/);
});

test('user instructions reach only their stage while structural constraints remain', () => {
  const automaticObject = api.promptForStage('object', '');
  const automaticBackground = api.promptForStage('background', '');
  assert.match(automaticObject, /object identified by the green outlines/);
  assert.match(automaticObject, /reconstruct the missing target parts/);
  assert.match(automaticObject, /colors, texture, material, illumination/);
  assert.match(automaticBackground, /Match the surrounding original surface color, texture and illumination/);
  assert(!automaticObject.includes('Additional instructions'));
  const object = api.buildWorkflow({ ...options, objectInfo: info, prompt: '移除蓝色横板并补全帽沿' });
  const base = api.buildWorkflow({ ...options, objectInfo: info, stage: 'background', prompt: '保持米色平涂底色' });
  assert.match(object[6].inputs.prompt, /移除蓝色横板并补全帽沿/);
  assert.match(object[6].inputs.prompt, /alpha channel/);
  assert(!object[6].inputs.prompt.includes('保持米色平涂底色'));
  assert.match(base[6].inputs.prompt, /保持米色平涂底色/);
  assert(!base[6].inputs.prompt.includes('移除蓝色横板'));
});

test('flat-surface harmonization removes color blotches without flattening textures or gradients', () => {
  const w = 80, h = 80, source = new Uint8ClampedArray(w * h * 4), generated = new Uint8ClampedArray(source.length), mask = new Uint8ClampedArray(source.length);
  const fill = style => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, color = style(x, y);
      source.set([...color, 255], i); generated.set(color.map(v => v + 3).concat(255), i);
      const selected = x >= 25 && x < 55 && y >= 25 && y < 55;
      mask.set([selected ? 255 : 0, selected ? 255 : 0, selected ? 255 : 0, 255], i);
    }
  };
  fill(() => [233, 223, 205]);
  for (let y = 25; y < 55; y++) for (let x = 25; x < 55; x++) {
    const i = (y * w + x) * 4;
    source.set([210, 40, 30, 255], i);
    generated[i] += Math.max(0, 5 - Math.round(Math.hypot(x - 40, y - 40) / 3));
  }
  const result = api.harmonizeFlatBackgroundPixels(source, generated, mask, w, h);
  assert.equal(result.stats.correctedPixels, 900);
  assert.deepEqual([...result.data.slice((40 * w + 40) * 4, (40 * w + 40) * 4 + 4)], [233, 223, 205, 255]);
  for (let i = 0; i < mask.length; i += 4) if (!mask[i]) assert.deepEqual(result.data.slice(i, i + 4), generated.slice(i, i + 4));
  for (const style of [(x, y) => [120 + (x + y) % 2 * 8, 100, 80], x => [120 + Math.floor(x / 4), 100, 80]]) {
    fill(style);
    const kept = api.harmonizeFlatBackgroundPixels(source, generated, mask, w, h);
    assert.equal(kept.stats.correctedPixels, 0);
    assert.deepEqual(kept.data, generated);
  }
  fill(() => [233, 223, 205]); mask.fill(255);
  assert.equal(api.harmonizeFlatBackgroundPixels(source, generated, mask, w, h).stats.correctedPixels, 0);
  for (let i = 3; i < generated.length; i += 4) generated[i] = 128;
  assert.deepEqual(api.harmonizeFlatBackgroundPixels(source, generated, mask, w, h).data, generated);
});

test('blend preserves unselected RGBA bytes and uses premultiplied feathering', () => {
  const base = new Uint8ClampedArray([61, 12, 244, 127, 255, 0, 0, 255, 0, 0, 0, 0]);
  const generated = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 255, 255, 12, 34, 56, 255]);
  const mask = new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  const result = api.blendBackgroundPixels(base, generated, mask);
  assert.deepEqual([...result.data.slice(0, 4)], [...base.slice(0, 4)]);
  assert.deepEqual([...result.data.slice(4, 8)], [127, 0, 128, 255]);
  assert.deepEqual([...result.data.slice(8)], [12, 34, 56, 255]);
  assert.equal(result.changed, 2);
});

test('worker replays integrated builder with its own catalogue and correct scheduling model', async () => {
  const host = await createWorkflowHost({ rendererDir: fileURLToPath(new URL('../../worker-renderer/', import.meta.url)), objectInfo: info });
  assert(isAllowedWorkflowCall('spine-split-runtime', 'buildGenerativeSplitWorkflow'));
  assert.equal(workflowModelId('spine-split-runtime', { __args: [{}, options] }, 'buildGenerativeSplitWorkflow'), 'qwen-image-2.1-turbo');
  assert.equal(workflowModelId('spine-split-runtime', { __args: [{}, { ...options, profile: 'standard' }] }, 'buildGenerativeSplitWorkflow'), 'qwen-image-2.1');
  assert.equal(workflowModelId('spine-split-runtime', { __args: [{}, {}] }), 'qwen-image-2511');
  const graph = await host.buildGraph({ module: 'spine-split-runtime', method: 'buildGenerativeSplitWorkflow', options: { __args: [{ poisonedCatalogue: true }, options] } });
  assert.deepEqual(JSON.parse(JSON.stringify(graph)), api.buildWorkflow({ ...options, objectInfo: info }));
  const browser = await readFile(new URL('../../web-dist/generative-split.workflow.js', import.meta.url), 'utf8');
  assert(!browser.includes('Turbo-BF16.gguf'));
  assert(!browser.includes('class_type'));
});
