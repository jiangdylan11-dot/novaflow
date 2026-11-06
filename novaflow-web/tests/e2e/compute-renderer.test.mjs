import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareComputeRenderer, COMPUTE_RENDERER_FILES } from '../../tools/prepare-compute-renderer.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';

const outputDir = await mkdtemp(join(tmpdir(), 'foart-compute-renderer-'));
const report = await prepareComputeRenderer({ outputDir });
assert.equal(report.modules, 7);
assert.deepEqual((await readdir(outputDir)).sort(), [...COMPUTE_RENDERER_FILES, 'compute-manifest.json'].sort());
assert(!COMPUTE_RENDERER_FILES.some(name => /spine-(?:auto|skeleton|mesh-edit|bones|binary|structure)|\.html$/.test(name)));

const host = await createWorkflowHost({ rendererDir: outputDir });
const h3 = await host.buildGraph({ module: 'NovaFlowAiSequenceMiniMaxH3Workflow', method: 'getWorkflowJson', options: { mode: 'i2v', steps: 4 } });
assert(Object.values(h3).some(node => node.class_type === 'MiniMaxH3ImageToVideo'));
assert(Object.values(h3).some(node => node.class_type === 'SamplerCustomAdvanced'));
const node = { input: { required: {} } };
const objectInfo = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['Qwen-Rapid-AIO-NSFW-v20.safetensors']] } } },
  LoadImage: node, ImageToMask: node, TextEncodeQwenImageEditPlus: node, TextEncodeQwenImageEdit: node,
  InpaintModelConditioning: node, KSampler: node, VAEDecode: node, SaveImage: node
};
const imageHost = await createWorkflowHost({ rendererDir: outputDir, objectInfo });
const graph = await imageHost.buildGraph({ module: 'NovaFlowSplitInpaintNsfwWorkflow', method: 'buildWorkflow', options: {
  runtimeInfo: {}, mode: 'edit', imageName: 'a.png', maskName: 'm.png', prefix: 'p', prompt: 'wear glasses', seed: 1
} });
assert(Object.values(graph).some(item => item.class_type === 'CheckpointLoaderSimple' && item.inputs.ckpt_name === 'Qwen-Rapid-AIO-NSFW-v20.safetensors'));

// Drawing needs its model/sampling helper as well as a registered builder.
// Without that dependency a reduced package silently uses fallback sampling.
const artInfo = {
  UNETLoader: { input: { required: { unet_name: [['Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors']], weight_dtype: [['default']] } } },
  CLIPLoader: { input: { required: { clip_name: [['qwen3vl_8b_bf16_heretic.safetensors']] } } },
  VAELoader: { input: { required: { vae_name: [['qwen_image_2.1_vae_bf16.safetensors']] } } },
  TextEncodeQwenImage21: {}, QwenImage21Cache: {}, KSampler: {}, VAEDecode: {}, SaveImage: {}, ImageScale: {}, ManualSigmas: {}, SamplerCustom: {}, KSamplerSelect: {}
};
const artHost = await createWorkflowHost({ rendererDir: outputDir, objectInfo: artInfo });
const art = await artHost.buildGraph({ module: 'novaflow-brand-runtime', method: 'buildArtGenerateRunWorkflow', options: { __args: [
  'local', 'txt2img', [], 'NF_compute', 'a red swordswoman', '', 'fixture', [],
  { provider: 'local', mode: 'txt2img', width: 900, height: 1300, seed: 42, randomSeed: false, localDrawEngine: 'qwen-2.1',
    samplingOverrides: { 'qwen-2.1-turbo:txt2img': { cfg: 2.2 } } }, 4, {}
] } });
assert(Object.values(art).some(item => item.class_type === 'TextEncodeQwenImage21'));
// Every 2.1 run is Turbo (eight fixed sigmas) since 2026-11-06; the user's cfg override still applies.
const sampler = Object.values(art).find(item => item.class_type === 'SamplerCustom');
assert.equal(sampler.inputs.noise_seed, 42);
assert.equal(sampler.inputs.cfg, 2.2);
assert.equal(art[sampler.inputs.sigmas[0]].class_type, 'ManualSigmas');

const packaged = JSON.parse(await readFile(new URL('../../worker/electron-builder-compute.json', import.meta.url), 'utf8'));
assert(!packaged.extraResources.some(item => /web-dist|worker-renderer/.test(item.from)));
assert(packaged.extraResources.some(item => item.to === 'compute-renderer'));
assert.equal(packaged.extraMetadata.main, 'electron/compute-main.cjs');
assert(!packaged.extraResources.some(item => (item.filter || []).some(filter => /license-core|license-public-key|license\//.test(filter))));
const shared = packaged.extraResources.find(item => item.to === 'packages/shared/src');
assert(!shared.filter.some(filter => filter.includes('*') || /control-plane|pricing|runninghub|companion-chat/.test(filter)), 'node bundle must not include server control-plane source');
console.log('compute renderer: all allowed workflow entries, image/video graphs and packaging boundaries passed');
