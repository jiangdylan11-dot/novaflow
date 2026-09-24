// 万物迁移 runs on Qwen-Image-2.1 when the node reports the 2.1 weights, and on the 2511 fp8mixed release
// otherwise (the 40 GB bf16 file is retired to disk-saving; it is only a fallback name). Measured
// 2026-09-24 on the same inputs and seed: 2.1 kept the picture outside the object (mean |diff| 3.6/255
// against 9.2 on bf16 and 17.0 on fp8mixed) and drew a soft contact shadow where both 2511 runs painted a
// hard black blot. The graphs here are the ones the renderer builds; the browser only records them.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInContext } from 'node:vm';
import { check, checkEqual, checkThrows, section, finish } from '../helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const RENDERER = 'novaflow-web/renderer/spine-split-runtime.js';
const require = createRequire(import.meta.url);
const { loadSpine } = require(join(ROOT, 'tools/qwen-rapid-migration-smoke.cjs'));

const source = await readFile(join(ROOT, RENDERER), 'utf8');
const s = loadSpine(RENDERER);
// The 2.1 model lists live after the slice loadSpine captures; feed the real ones to the resolver.
runInContext(source.match(/^  const QWEN21_UNETS = \[[\s\S]*?^  const QWEN21_VAE = '[^']+'/m)[0], s);

const combo = (options) => [options, {}];
const nodes = () => ({
  LoadImage: { input: { required: { image: combo([]) } } },
  UNETLoader: { input: { required: { unet_name: combo(['qwen_image_edit_2511_bf16.safetensors', 'qwen_image_edit_2511_fp8mixed.safetensors']), weight_dtype: combo(['default', 'fp8_e4m3fn']) } } },
  UnetLoaderGGUF: { input: { required: { unet_name: combo(['qwen-image-2.1-UC-Q8_0.gguf']) } } },
  CLIPLoader: { input: { required: { clip_name: combo(['qwen3vl_8b_w4a8_heretic.safetensors', 'qwen_2.5_vl_7b_fp8_scaled.safetensors']), type: combo(['qwen_image']) }, optional: { device: combo(['default']) } } },
  VAELoader: { input: { required: { vae_name: combo(['qwen_image_2.1_vae_bf16.safetensors', 'qwen_image_vae.safetensors']) } } },
  VAEEncode: { input: { required: { pixels: ['IMAGE', {}], vae: ['VAE', {}] } } },
  TextEncodeQwenImageEditPlus: { input: { required: { clip: ['CLIP', {}], prompt: ['STRING', { default: '' }] }, optional: { vae: ['VAE', {}], image1: ['IMAGE', {}], image2: ['IMAGE', {}] } } },
  TextEncodeQwenImage21: { input: { required: { clip: ['CLIP', {}], prompt: ['STRING', { default: '' }], negative_prompt: ['STRING', { default: '' }], resolution: ['INT', { default: 1024 }], images: ['COMFY_AUTOGROW_V3', {}] }, optional: { vae: ['VAE', {}] } } },
  QwenImage21Cache: { input: { required: { model: ['MODEL', {}], device: combo(['auto', 'gpu', 'cpu', 'off']), dtype: combo(['default', 'int8', 'int4']) } } },
  ConditioningZeroOut: { input: { required: { conditioning: ['CONDITIONING', {}] } } },
  KSampler: { input: { required: { model: ['MODEL', {}], seed: ['INT', { default: 0 }], steps: ['INT', { default: 20 }], cfg: ['FLOAT', { default: 8 }], sampler_name: combo(['euler']), scheduler: combo(['simple']), positive: ['CONDITIONING', {}], negative: ['CONDITIONING', {}], latent_image: ['LATENT', {}], denoise: ['FLOAT', { default: 1 }] } } },
  VAEDecode: { input: { required: { samples: ['LATENT', {}], vae: ['VAE', {}] } } },
  SplitImageWithAlpha: { input: { required: { image: ['IMAGE', {}] } } },
  SaveImage: { input: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', { default: 'ComfyUI' }] } } },
  ModelSamplingAuraFlow: { input: { required: { model: ['MODEL', {}], shift: ['FLOAT', { default: 3 }] } } },
  CFGNorm: { input: { required: { model: ['MODEL', {}], strength: ['FLOAT', { default: 1 }] } } },
  LoraLoaderModelOnly: { input: { required: { model: ['MODEL', {}], lora_name: combo(['Qwen-Image-Edit-2511-Lightning-4steps-V1.0-fp32.safetensors']), strength_model: ['FLOAT', { default: 1 }] } } },
  FluxKontextMultiReferenceLatentMethod: { input: { required: { conditioning: ['CONDITIONING', {}], reference_latents_method: combo(['offset', 'index', 'uxo-uno', 'index_timestep_zero']) } } },
  FluxKontextImageScale: { input: { required: { image: ['IMAGE', {}] } } }
});
const byType = (graph, type) => Object.entries(graph).filter(([, node]) => node.class_type === type);
const uploads = { placementName: 'plate.png', referenceName: 'scene.png' };

section('the engine follows the node capability snapshot the drawing and UI panels read');
{
  s.window = { electronAPI: { runtimeFeaturesSync: () => ({ qwenImage21: true }) } };
  checkEqual('a node that reports the 2.1 weights runs 2.1', s.objectTransferEngine(), 'qwen-2.1');
  s.window = { electronAPI: { runtimeFeaturesSync: () => ({ qwenImage21: false }) } };
  checkEqual('a node without them stays on 2511', s.objectTransferEngine(), 'qwen-2511');
  s.window = {};
  checkEqual('no snapshot at all is 2511', s.objectTransferEngine(), 'qwen-2511');
}

section('runtime resolution: 2.1 by name, 2511 on fp8mixed with bf16 only as the fallback');
{
  const info = nodes();
  const resolved21 = s.resolveObjectTransferRuntime(info, 'qwen-2.1');
  checkEqual('2.1 resolves the GGUF, the Qwen3-VL encoder and the 2.1 VAE, no LoRA', resolved21,
    { engine: 'qwen-2.1', unetName: 'qwen-image-2.1-UC-Q8_0.gguf', clipName: 'qwen3vl_8b_w4a8_heretic.safetensors', vaeName: 'qwen_image_2.1_vae_bf16.safetensors', loraName: '' });
  const resolved2511 = s.resolveObjectTransferRuntime(info, 'qwen-2511');
  checkEqual('2511 picks fp8mixed although bf16 is listed first', resolved2511.unetName, 'qwen_image_edit_2511_fp8mixed.safetensors');
  checkEqual('and keeps the 2511 encoder, VAE and Lightning LoRA', [resolved2511.engine, resolved2511.clipName, resolved2511.vaeName, resolved2511.loraName],
    ['qwen-2511', 'qwen_2.5_vl_7b_fp8_scaled.safetensors', 'qwen_image_vae.safetensors', 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-fp32.safetensors']);
  const bf16Only = nodes();
  bf16Only.UNETLoader.input.required.unet_name = combo(['qwen_image_edit_2511_bf16.safetensors']);
  checkEqual('a node that still has only bf16 keeps working on it', s.resolveObjectTransferRuntime(bf16Only, 'qwen-2511').unetName, 'qwen_image_edit_2511_bf16.safetensors');
  const no21 = nodes();
  delete no21.TextEncodeQwenImage21;
  await checkThrows('2.1 asked of a node that cannot build it is an error, never a silent 2511 run', () => s.resolveObjectTransferRuntime(no21, 'qwen-2.1'), /Qwen-Image-2\.1/);
  const noWeights = nodes();
  noWeights.UnetLoaderGGUF.input.required.unet_name = combo(['other.gguf']);
  await checkThrows('and so is a node with the loader but not the weights', () => s.resolveObjectTransferRuntime(noWeights, 'qwen-2.1'), /Qwen-Image-2\.1/);
  check('the source prefers fp8mixed', /OBJECT_TRANSFER_QWEN_UNETS = \['qwen_image_edit_2511_fp8mixed\.safetensors', 'qwen_image_edit_2511_bf16\.safetensors'\]/.test(source), null);
}

section('the 2.1 graph: two references at their own size, the encoder latent, RGB out');
{
  const info = nodes();
  const resolved = s.resolveObjectTransferRuntime(info, 'qwen-2.1');
  for (const [label, graph, steps, cfg] of [
    ['integration', s.buildObjectTransferQwenWorkflow(info, uploads, 'NovaFlow_object_transfer_x', resolved, 'qwen-2.1'), 25, 1],
    ['restyle', s.buildObjectTransferRestyleWorkflow(info, uploads, 'NovaFlow_object_transfer_x_restyle', resolved, '', 'qwen-2.1'), 25, 1]
  ]) {
    checkEqual(label + ': no 2511 pieces', ['UNETLoader', 'LoraLoaderModelOnly', 'ModelSamplingAuraFlow', 'CFGNorm', 'TextEncodeQwenImageEditPlus', 'ConditioningZeroOut', 'VAEEncode', 'FluxKontextImageScale'].filter((type) => byType(graph, type).length), []);
    checkEqual(label + ': the GGUF loader carries the 2.1 file', byType(graph, 'UnetLoaderGGUF').map(([, n]) => n.inputs.unet_name), ['qwen-image-2.1-UC-Q8_0.gguf']);
    checkEqual(label + ': the encoder is Qwen3-VL as qwen_image', byType(graph, 'CLIPLoader').map(([, n]) => [n.inputs.clip_name, n.inputs.type]), [['qwen3vl_8b_w4a8_heretic.safetensors', 'qwen_image']]);
    const [encodeId, encode] = byType(graph, 'TextEncodeQwenImage21')[0];
    checkEqual(label + ': the plate is image_1 and the untouched scene image_2, each at its own size', [encode.inputs['images.image_1'], encode.inputs['images.image_2'], encode.inputs.resolution], [['1', 0], ['2', 0], 0]);
    checkEqual(label + ': the plate and the scene are the two uploads', [graph['1'].inputs.image, graph['2'].inputs.image], ['plate.png', 'scene.png']);
    checkEqual(label + ': an empty negative at cfg 1, so the negative branch is never evaluated', [encode.inputs.negative_prompt, byType(graph, 'KSampler')[0][1].inputs.cfg], ['', cfg]);
    check(label + ': the prompt is the object transfer prompt', typeof encode.inputs.prompt === 'string' && encode.inputs.prompt.length > 20, encode.inputs.prompt);
    const [, sampler] = byType(graph, 'KSampler')[0];
    checkEqual(label + ': the sampler runs on the encoder latent, denoise 1, euler/simple',
      [sampler.inputs.latent_image, sampler.inputs.positive, sampler.inputs.negative, sampler.inputs.denoise, sampler.inputs.steps, sampler.inputs.sampler_name, sampler.inputs.scheduler],
      [[encodeId, 2], [encodeId, 0], [encodeId, 1], 1, steps, 'euler', 'simple']);
    const cacheId = byType(graph, 'QwenImage21Cache')[0][0];
    checkEqual(label + ': the KV cache sits between the loader and the sampler', [graph[cacheId].inputs.model, sampler.inputs.model], [['4', 0], [cacheId, 0]]);
    const [splitId, split] = byType(graph, 'SplitImageWithAlpha')[0];
    const [decodeId] = byType(graph, 'VAEDecode')[0];
    checkEqual(label + ': the RGBA decode is split to RGB before it is saved', [split.inputs.image, byType(graph, 'SaveImage')[0][1].inputs.images], [[decodeId, 0], [splitId, 0]]);
    for (const [id, node] of Object.entries(graph)) {
      for (const value of Object.values(node.inputs)) if (Array.isArray(value)) check(label + ': ' + id + ' links to a node', Boolean(graph[value[0]]), value);
    }
  }
  checkEqual('the debug record names the engine', [s.state.lastProcessingDebug.objectTransfer.workflow, s.state.lastProcessingDebug.objectTransfer.engine], ['qwen-image-2.1-object-transfer', 'qwen-2.1']);
  const noCache = nodes();
  delete noCache.QwenImage21Cache;
  const plain = s.buildObjectTransferQwenWorkflow(noCache, uploads, 'x', resolved, 'qwen-2.1');
  checkEqual('without the cache node the sampler takes the loader directly', byType(plain, 'KSampler')[0][1].inputs.model, ['4', 0]);
}

section('the 2511 graph is the one it was, on the fp8mixed file');
{
  const info = nodes();
  const resolved = s.resolveObjectTransferRuntime(info, 'qwen-2511');
  for (const engine of ['qwen-2511', undefined]) {
    const graph = s.buildObjectTransferQwenWorkflow(info, uploads, 'x', resolved, engine);
    checkEqual(String(engine) + ': the 2511 loader casts fp8mixed as before', byType(graph, 'UNETLoader').map(([, n]) => n.inputs), [{ unet_name: 'qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype: 'fp8_e4m3fn' }]);
    checkEqual(String(engine) + ': no 2.1 pieces', ['UnetLoaderGGUF', 'TextEncodeQwenImage21', 'QwenImage21Cache', 'SplitImageWithAlpha'].filter((type) => byType(graph, type).length), []);
    const [, sampler] = byType(graph, 'KSampler')[0];
    checkEqual(String(engine) + ': 4 Lightning steps at cfg 1.2 with the 3.1 shift', [sampler.inputs.steps, sampler.inputs.cfg, byType(graph, 'ModelSamplingAuraFlow')[0][1].inputs.shift], [4, 1.2, 3.1]);
  }
  checkEqual('the debug record names 2511', s.state.lastProcessingDebug.objectTransfer.engine, 'qwen-2511');
}

section('the plate: 2.1 rounds the 2511 plate up to 32 so the encoder never resamples it');
{
  for (const [w, h] of [[756, 1137], [626, 1360], [1024, 1024], [1920, 1080]]) {
    const plate2511 = s.qwenEditPlateSize(w, h);
    const plate21 = s.qwen21EditPlateSize(w, h);
    check(`${w}x${h}: both edges are multiples of 32`, plate21.width % 32 === 0 && plate21.height % 32 === 0, plate21);
    check(`${w}x${h}: never smaller than the 2511 plate, at most 31 px larger`, plate21.width >= plate2511.width && plate21.height >= plate2511.height && plate21.width - plate2511.width < 32 && plate21.height - plate2511.height < 32, [plate2511, plate21]);
    checkEqual(`${w}x${h}: the engine picks the plate`, [s.objectTransferPlateSize('qwen-2.1', w, h), s.objectTransferPlateSize('qwen-2511', w, h)], [plate21, plate2511]);
  }
}

finish('web-object-transfer-qwen21');
