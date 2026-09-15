// The 2026-09-12 Rapid unification was rolled back: every default local Qwen chain is
// Qwen Image Edit 2511 (UNET + CLIP + VAE + Lightning) again, and Rapid AIO NSFW is an
// explicit NSFW option only. fp8mixed was retired from disk, so the bf16 release must work.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs');
const { graphs } = require('../../tools/qwen-rapid-acceptance.cjs');
const info = require('./fixtures/qwen-2511-runtime.json');

const UNET = 'qwen_image_edit_2511_bf16.safetensors';
const RAPID = 'Qwen-Rapid-AIO-NSFW-v20.safetensors';
const spine = loadSpine('particle-editor/spine-split-runtime.js');
spine.comfyAllObjectInfo = async () => info;
spine.setInpaintDebugAttr = () => {};
spine.state = {};

const nodesOf = (graph, type) => Object.values(graph).filter((n) => n.class_type === type);

function assert2511(graph, { weightDtype = 'fp8_e4m3fn', lightning = /Qwen-Image-Edit-2511-Lightning/ } = {}) {
  assert.equal(nodesOf(graph, 'CheckpointLoaderSimple').length, 0, 'no Rapid checkpoint on the default chain');
  const unets = nodesOf(graph, 'UNETLoader');
  assert.equal(unets.length, 1);
  assert.equal(unets[0].inputs.unet_name, UNET);
  assert.equal(unets[0].inputs.weight_dtype, weightDtype);
  assert.equal(nodesOf(graph, 'CLIPLoader')[0].inputs.clip_name, 'qwen_2.5_vl_7b_fp8_scaled.safetensors');
  assert.equal(nodesOf(graph, 'VAELoader')[0].inputs.vae_name, 'qwen_image_vae.safetensors');
  if (lightning) assert.ok(nodesOf(graph, 'LoraLoaderModelOnly').some((n) => lightning.test(n.inputs.lora_name)), 'Lightning LoRA applied');
  for (const [id, node] of Object.entries(graph)) {
    for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(graph[value[0]], `${id} has dangling link ${value}`);
  }
}

test('outpaint, angle adjustment and object transfer build the 2511 chain with the bf16 release', () => {
  const outpaint = spine.buildQwenImageOutpaintWorkflow(info, 'scene.png', 'test', { left: 128, right: 128, top: 0, bottom: 0 });
  const angle = spine.buildImageAngleAdjustWorkflow(info, 'reference.png', { horizontalAngle: 90, verticalAngle: 15, zoom: 4.3 });
  const transfer = spine.buildObjectTransferQwenWorkflow(info, { placementName: 'scene.png', referenceName: 'reference.png' }, 'test', spine.resolveObjectTransferQwenRuntime(info));
  for (const g of [outpaint, angle, transfer]) {
    assert2511(g);
    const sampler = nodesOf(g, 'KSampler')[0].inputs;
    assert.equal(sampler.sampler_name, 'euler');
    assert.equal(sampler.scheduler, 'simple');
  }
  assert.ok(nodesOf(angle, 'LoraLoaderModelOnly').some((n) => /multiple-angles/.test(n.inputs.lora_name)));
  assert.equal(nodesOf(transfer, 'KSampler')[0].inputs.steps, 6);
  const without = structuredClone(info);
  without.UNETLoader.input.required.unet_name[0] = ['other.safetensors'];
  assert.throws(() => spine.buildImageAngleAdjustWorkflow(without, 'reference.png'), /缺少/);
});

test('storyboard defaults to the ordinary 2511 scene chain and only NSFW mode uses Rapid', () => {
  assert.equal(spine.normalizeStoryboardModelMode('default'), 'default');
  assert.equal(spine.normalizeStoryboardModelMode(undefined), 'default');
  assert.equal(spine.normalizeStoryboardModelMode('qwenNsfw'), 'qwenNsfw');
  const ordinary = spine.buildStoryboardSceneWorkflow(info, 'scene.png', 'test', 'A cottage by a lake.', { id: 'landscape' }, 'default', { disablePromptExpansion: true });
  assert2511(ordinary);
  const nsfw = spine.buildStoryboardSceneWorkflow(info, 'scene.png', 'test', 'A cottage by a lake.', { id: 'landscape' }, 'qwenNsfw', { disablePromptExpansion: true });
  assert.equal(nodesOf(nsfw, 'CheckpointLoaderSimple')[0].inputs.ckpt_name, RAPID);
  assert.equal(nodesOf(nsfw, 'UNETLoader').length, 0);
});

test('local edit and completion route to the 2511 chain unless the NSFW switch is on', async () => {
  for (const mode of ['edit', 'completion']) {
    for (const off of [undefined, false, 'qwen-edit-v5']) assert.equal(spine.resolveInpaintWorkflowRoute(mode, off).workflow, 'qwen', `${mode}/${off}`);
    for (const on of [true, 'qwen-rapid-aio-nsfw-v20', 'rapid-aio-nsfw']) assert.equal(spine.resolveInpaintWorkflowRoute(mode, on).workflow, 'rapid-aio-nsfw', `${mode}/${on}`);
  }
  assert.equal(spine.resolveInpaintWorkflowRoute('completion', false).provider, 'qwen-completion-v4');
  assert.equal(spine.resolveInpaintWorkflowRoute('edit', false).provider, 'qwen-edit-v5');
  assert.equal(spine.resolveInpaintWorkflowRoute('repair', true).workflow, 'removal');

  for (const mode of ['edit', 'completion']) {
    const route = spine.resolveInpaintWorkflowRoute(mode, false);
    const graph = await spine.defaultQwenInpaintWorkflow('http://127.0.0.1:8188', 'img.png', 'mask.png', 'test', 'complete the missing legs', { route, inpaintMode: mode });
    assert2511(graph);
    assert.equal(nodesOf(graph, 'TextEncodeQwenImageEditPlusAdvance_lrzjason').length, 1);
    assert.equal(nodesOf(graph, 'ModelSamplingAuraFlow').length, 1);
    assert.equal(nodesOf(graph, 'CFGNorm').length, 1);
    assert.equal(nodesOf(graph, 'KSampler')[0].inputs.steps, 6);
    assert.ok(!nodesOf(graph, 'LoraLoaderModelOnly').some((n) => /eigen-banana/.test(n.inputs.lora_name)), 'the 2509 adapter stays off the 2511 base');
    assert.equal(spine.state.lastProcessingDebug.qwenInpaint.model, '2511');
  }
  const without = structuredClone(info);
  without.UNETLoader.input.required.unet_name[0] = ['other.safetensors'];
  spine.comfyAllObjectInfo = async () => without;
  try {
    await assert.rejects(spine.defaultQwenInpaintWorkflow('http://127.0.0.1:8188', 'img.png', 'mask.png', 'test', 'x', { route: spine.resolveInpaintWorkflowRoute('completion', false), inpaintMode: 'completion' }), /Qwen UNET/);
  } finally {
    spine.comfyAllObjectInfo = async () => info;
  }
});

test('selection toolbar exposes the NSFW switch instead of a fixed Rapid label', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../particle-editor/spine-split-runtime.js'), 'utf8');
  assert.match(source, /button\('NSFW', \(\) => toggleSelectionInpaintNsfw\(\), inpaintNsfwEnabled/);
  assert.doesNotMatch(source, /button\('Rapid'|selectionLegacyQwen|inpaintLegacyQwenEnabled/);
  assert.match(source, /patchSplitToolButtonVisual\('selectionNsfw', nsfwEnabled\)/);
  assert.match(source, /const rapidAioNsfwRequested = provider === true \|\| provider === 'qwen-rapid-aio-nsfw-v20' \|\| provider === 'rapid-aio-nsfw'/);
});

test('Art img2img, UI bridge and local AI effects use the 2511 chain; NSFW off is the default', () => {
  const built = graphs(info);
  assert2511(built.art, { weightDtype: 'default' });
  assert2511(built.ui, { weightDtype: 'default', lightning: null });
  assert2511(built['aifx-tail'], { weightDtype: 'default' });
  assert.equal(nodesOf(built['aifx-tail'], 'KSampler')[0].inputs.steps, 4);
  assert.ok(built.art.nf_art_lora_1, 'manual Qwen adapters still participate');
  // The dedicated NSFW module keeps Rapid for the explicit NSFW switch.
  for (const mode of ['edit', 'completion']) assert.equal(nodesOf(built[mode], 'CheckpointLoaderSimple')[0].inputs.ckpt_name, RAPID);
  const { BASE_MODELS } = require('../main/qwen-lora-catalog');
  assert.equal(BASE_MODELS.edit, 'diffusion_models/' + UNET);
  assert.equal(BASE_MODELS.rapid, 'checkpoints/' + RAPID);
  for (const name of ['novaflow-brand-runtime.js', 'aifx-local.workflow.js', 'ui-design-local.workflow.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../particle-editor', name), 'utf8');
    assert.doesNotMatch(source, /provider === "local" && mode === "img2img" \? \{ \.\.\.requestedState, nsfw: true \}/);
  }
});
