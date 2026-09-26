// 万物迁移, 特效提取 and 去特效 run on Qwen-Image-2.1 only; the 2511 route and its fallback are gone.
// 特效提取 redraws the plate's effects onto a black canvas (image 1 black, image 2 the plate) with a new
// seed per run: asked to remove the figure, 2.1 took the particles lying on it along.
// Measured 2026-09-24 for 万物迁移 on the same inputs and seed: 2.1 kept the picture outside the object
// (mean |diff| 3.6/255 against 9.2 on bf16 and 17.0 on fp8mixed) and drew a soft contact shadow where both
// 2511 runs painted a hard black blot. The graphs here are the ones the renderer builds; the browser only
// records them.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { check, checkEqual, checkThrows, section, finish } from '../helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const RENDERER = 'novaflow-web/renderer/spine-split-runtime.js';
const require = createRequire(import.meta.url);
const { loadSpine } = require(join(ROOT, 'tools/qwen-rapid-migration-smoke.cjs'));

const source = await readFile(join(ROOT, RENDERER), 'utf8');
const s = loadSpine(RENDERER);
// The 2.1 model lists and step count live after the slice loadSpine captures; feed the real ones in.
runInContext(source.match(/^  const QWEN21_UNETS = \[[\s\S]*?^  const QWEN21_STEPS = \d+/m)[0], s);

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
const PIECES_2511 = ['UNETLoader', 'LoraLoaderModelOnly', 'ModelSamplingAuraFlow', 'CFGNorm', 'TextEncodeQwenImageEditPlus', 'ConditioningZeroOut', 'VAEEncode', 'FluxKontextImageScale'];

section('no 2511 route is left: no engine switch, no 2511 file names');
{
  checkEqual('the engine switch is gone', typeof s.objectTransferEngine, 'undefined');
  checkEqual('the 2511 plate graph is gone', typeof s.buildQwenEditPlateWorkflow, 'undefined');
  check('the runtime names no 2511 model file', !/qwen_image_edit_2511|Qwen-Image-Edit-2511-Lightning/.test(source), null);
}

section('runtime resolution: 2.1 by name, an error on a node that cannot build it');
{
  const info = nodes();
  checkEqual('2.1 resolves the GGUF, the Qwen3-VL encoder and the 2.1 VAE, no LoRA', s.resolveObjectTransferRuntime(info),
    { engine: 'qwen-2.1', unetName: 'qwen-image-2.1-UC-Q8_0.gguf', clipName: 'qwen3vl_8b_w4a8_heretic.safetensors', vaeName: 'qwen_image_2.1_vae_bf16.safetensors', loraName: '' });
  const no21 = nodes();
  delete no21.TextEncodeQwenImage21;
  await checkThrows('a node without the 2.1 encoder is an error, never a 2511 run', () => s.resolveObjectTransferRuntime(no21), /Qwen-Image-2\.1.*万物迁移/);
  const noWeights = nodes();
  noWeights.UnetLoaderGGUF.input.required.unet_name = combo(['other.gguf']);
  await checkThrows('and so is a node with the loader but not the weights', () => s.resolveObjectTransferRuntime(noWeights), /Qwen-Image-2\.1/);
  const only2511 = nodes();
  delete only2511.UnetLoaderGGUF;
  await checkThrows('a node that has only the 2511 files cannot run it either', () => s.resolveObjectTransferRuntime(only2511), /Qwen-Image-2\.1/);
  await checkThrows('the effect tools name themselves in the same error', () => s.resolveQwen21EditRuntime(no21, '特效提取'), /无法执行特效提取/);
}

section('the 万物迁移 graph: two references at their own size, the encoder latent, RGB out');
{
  const info = nodes();
  const resolved = s.resolveObjectTransferRuntime(info);
  for (const [label, graph, steps, cfg] of [
    ['integration', s.buildObjectTransferQwenWorkflow(info, uploads, 'NovaFlow_object_transfer_x', resolved), 25, 1],
    ['restyle', s.buildObjectTransferRestyleWorkflow(info, uploads, 'NovaFlow_object_transfer_x_restyle', resolved, ''), 25, 1]
  ]) {
    checkEqual(label + ': no 2511 pieces', PIECES_2511.filter((type) => byType(graph, type).length), []);
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
  const plain = s.buildObjectTransferQwenWorkflow(noCache, uploads, 'x', resolved);
  checkEqual('without the cache node the sampler takes the loader directly', byType(plain, 'KSampler')[0][1].inputs.model, ['4', 0]);
  const noGguf = nodes();
  delete noGguf.UnetLoaderGGUF;
  await checkThrows('replayed on a node without 2.1 (the page sent a marker), the graph is refused', () => s.buildObjectTransferQwenWorkflow(noGguf, uploads, 'x', 'marker'), /Qwen-Image-2\.1/);
}

section('特效提取 / 去特效 on 2.1: the extract redraws the plate onto a black canvas, a new seed per run, RGB out');
{
  const info = nodes();
  info.GetImageSize = { input: { required: { image: ['IMAGE', {}] }, hidden: { unique_id: ['UNIQUE_ID'] } } };
  info.EmptyImage = { input: { required: { width: ['INT', { default: 512 }], height: ['INT', { default: 512 }], batch_size: ['INT', { default: 1 }], color: ['INT', { default: 0 }] } } };
  const resolved = s.resolveQwen21EditRuntime(info, '特效提取');
  const seeds = [];
  for (const [label, build, promptText] of [
    ['extract', s.buildEffectExtractQwenWorkflow, s.effectExtractPromptText()],
    ['de-effect', s.buildEffectDeeffectQwenWorkflow, s.effectDeeffectPromptText()]
  ]) {
    for (const [how, given] of [['page-resolved', resolved], ['node-resolved (Web marker)', 'marker']]) {
      const graph = build(info, 'plate_input.png', 'NovaFlow_effect_x', given);
      checkEqual(`${label} ${how}: no 2511 pieces`, PIECES_2511.filter((type) => byType(graph, type).length), []);
      checkEqual(`${label} ${how}: the 2.1 files`, [byType(graph, 'UnetLoaderGGUF')[0][1].inputs.unet_name, byType(graph, 'CLIPLoader')[0][1].inputs.clip_name, byType(graph, 'VAELoader')[0][1].inputs.vae_name],
        ['qwen-image-2.1-UC-Q8_0.gguf', 'qwen3vl_8b_w4a8_heretic.safetensors', 'qwen_image_2.1_vae_bf16.safetensors']);
      const [encodeId, encode] = byType(graph, 'TextEncodeQwenImage21')[0];
      if (label === 'extract') {
        const canvas = graph[encode.inputs['images.image_1'][0]];
        const [sizeId, size] = byType(graph, 'GetImageSize')[0];
        checkEqual(`extract ${how}: image_1 is a black canvas the plate's size`, [canvas.class_type, canvas.inputs.width, canvas.inputs.height, canvas.inputs.batch_size, canvas.inputs.color, graph[size.inputs.image[0]].inputs.image],
          ['EmptyImage', [sizeId, 0], [sizeId, 1], 1, 0, 'plate_input.png']);
        checkEqual(`extract ${how}: image_2 is the plate, both at their own size`, [graph[encode.inputs['images.image_2'][0]].inputs.image, encode.inputs.resolution], ['plate_input.png', 0]);
      } else {
        checkEqual(`de-effect ${how}: the plate is the only image, at its own size`, [graph[encode.inputs['images.image_1'][0]].inputs.image, encode.inputs['images.image_2'], encode.inputs.resolution], ['plate_input.png', undefined, 0]);
      }
      checkEqual(`${label} ${how}: its own prompt, empty negative`, [encode.inputs.prompt, encode.inputs.negative_prompt], [promptText, '']);
      const [, sampler] = byType(graph, 'KSampler')[0];
      checkEqual(`${label} ${how}: 25 steps at cfg 1 on the encoder latent`,
        [sampler.inputs.steps, sampler.inputs.cfg, sampler.inputs.denoise, sampler.inputs.latent_image, sampler.inputs.negative],
        [25, 1, 1, [encodeId, 2], [encodeId, 1]]);
      check(`${label} ${how}: the seed is a non-negative integer`, Number.isInteger(sampler.inputs.seed) && sampler.inputs.seed >= 0, sampler.inputs.seed);
      seeds.push(sampler.inputs.seed);
      const [splitId] = byType(graph, 'SplitImageWithAlpha')[0];
      checkEqual(`${label} ${how}: RGB is saved under the run prefix`, [byType(graph, 'SaveImage')[0][1].inputs.images, byType(graph, 'SaveImage')[0][1].inputs.filename_prefix], [[splitId, 0], 'NovaFlow_effect_x']);
      for (const [id, node] of Object.entries(graph)) {
        for (const value of Object.values(node.inputs)) if (Array.isArray(value)) check(`${label} ${how}: ${id} links to a node`, Boolean(graph[value[0]]), value);
      }
    }
  }
  check('each run samples a new seed (a rerun gives another result)', new Set(seeds).size === seeds.length, seeds);
  check('no fixed effect seed is left in the runtime', !/EFFECT_EXTRACT_SEED|916202601/.test(source), null);
  check('the extract prompt redraws onto the black canvas and never asks to remove the figure', /纯黑画布/.test(s.effectExtractPromptText()) && !/Remove the person/.test(s.effectExtractPromptText()), s.effectExtractPromptText());
  const no21 = nodes();
  delete no21.TextEncodeQwenImage21;
  await checkThrows('the extract graph refuses a node without 2.1', () => s.buildEffectExtractQwenWorkflow(no21, 'x.png', 'x', 'marker'), /无法执行特效提取/);
  await checkThrows('and so does the de-effect graph', () => s.buildEffectDeeffectQwenWorkflow(no21, 'x.png', 'x', 'marker'), /无法执行特效去除/);
  await checkThrows('the extract graph names the canvas nodes it lacks', () => s.buildEffectExtractQwenWorkflow(nodes(), 'x.png', 'x', 'marker'), /GetImageSize \/ EmptyImage/);
}

section('特效去除 writes the de-effected crop straight onto the layer (no paste-back through a key)');
{
  const px = (...pixels) => Uint8ClampedArray.from(pixels.flat());
  const run = (original, result, mask) => Array.from(s.effectDeeffectPixels(px(...original), px(...result), mask ? Uint8ClampedArray.from(mask) : null, original.length));
  checkEqual('an opaque pixel takes the de-effected colour', run([[200, 100, 50, 255]], [[10, 20, 30, 255]]), [10, 20, 30, 255]);
  checkEqual('a glow floating over transparency becomes transparent', run([[255, 200, 100, 128]], [[0, 0, 0, 255]]), [0, 0, 0, 0]);
  checkEqual('the model cannot paint into a transparent pixel', run([[0, 0, 0, 0]], [[255, 255, 255, 255]]), [0, 0, 0, 0]);
  const edge = run([[200, 100, 50, 128]], [[100, 50, 25, 255]]);
  check('a soft edge the pass left alone keeps its alpha and colour', Math.abs(edge[3] - 128) <= 1 && Math.abs(edge[0] - 200) <= 2 && Math.abs(edge[1] - 100) <= 2 && Math.abs(edge[2] - 50) <= 2, edge);
  checkEqual('outside the stroke nothing changes', run([[200, 100, 50, 255]], [[10, 20, 30, 255]], [0]), [200, 100, 50, 255]);
  checkEqual('on the feathered stroke edge the two blend', run([[200, 100, 50, 255]], [[0, 0, 0, 255]], [128]), [100, 50, 25, 255]);
  check('the removal no longer composites through an extraction key', !/effectRemovalMaskCanvas|EFFECT_REMOVE_MASK_/.test(source) && /effectDeeffectCanvas\(layerOriginalCanvas, plate\.plate, cropBox, regionMask\)/.test(source), null);
}

section('去除物体 samples a new seed unless the caller pins one');
{
  check('the removal graph draws its default seed at random', /const seed = fixedSeed == null \? Math\.floor\(Math\.random\(\) \* 1000000000\) : fixedSeed/.test(source) && !/4819261740/.test(source), null);
  check('智能补图 keeps seed 746924259, 局部编辑 draws a new one (2.1 and the NSFW Rapid route)',
    /const INPAINT_COMPLETION_SEED = 746924259/.test(source)
      && /: route\.mode === 'completion' \? INPAINT_COMPLETION_SEED : Math\.floor\(Math\.random\(\) \* 1000000000\)/.test(source)
      && /fixedSeed != null \? fixedSeed : route\.mode === 'completion' \? INPAINT_COMPLETION_SEED : Math\.floor\(Math\.random\(\) \* 1000000000\)/.test(source), null);
  check('the 2.1 inpaint graph samples with the seed its caller drew (the debug record names the same one)',
    /function buildQwen21InpaintWorkflow\([^)]*, seed\)/.test(source) && /options && options\.promptParts, seed\)/.test(source) && /steps: QWEN21_STEPS,\s*seed,\s*provider: route\.provider/.test(source), null);
}

section('the plate: 2.1 rounds the Qwen edit plate up to 32 so the encoder never resamples it');
{
  for (const [w, h] of [[756, 1137], [626, 1360], [1024, 1024], [1920, 1080]]) {
    const base = s.qwenEditPlateSize(w, h);
    const plate21 = s.qwen21EditPlateSize(w, h);
    check(`${w}x${h}: both edges are multiples of 32`, plate21.width % 32 === 0 && plate21.height % 32 === 0, plate21);
    check(`${w}x${h}: never smaller than the base plate, at most 31 px larger`, plate21.width >= base.width && plate21.height >= base.height && plate21.width - base.width < 32 && plate21.height - base.height < 32, [base, plate21]);
  }
  check('万物迁移 and the effect tools use the 2.1 plate', /const plateSize = qwen21EditPlateSize\(cropBox\.width, cropBox\.height\)/.test(source) && !/objectTransferPlateSize/.test(source), null);
}

section('无限扩图 / 画布扩展 move only the cards of the picture that grew');
{
  // The real functions, run against stubs: two 原图 (A 1016x1018, Z 512x720), a card on each and a
  // card from before multiple sources. Every card used to be shifted, so Z's layers came back 244 px
  // to the right and clipped after A was outpainted to 1504 wide.
  const fn = (head) => source.match(new RegExp(`^  ${head}\\([\\s\\S]*?^  \\}\\r?$`, 'm'))[0];
  const delta = { left: 244, top: 3, right: 244, bottom: 3 };
  const run = async (activeSetId, body) => {
    const cards = {
      a: { id: 'a', sourceResourceId: 'A', parts: [{ id: 'a1', x: 10, y: 20 }], previewDataUrl: 'a.png' },
      z: { id: 'z', sourceResourceId: 'Z', parts: [{ id: 'z1', x: 5, y: 6 }], previewDataUrl: 'z.png' },
      old: { id: 'old', parts: [{ id: 'o1', x: 1, y: 2 }], previewDataUrl: 'o.png' }
    };
    const ctx = {
      Math, Date, String, Number, Error,
      refreshed: 0,
      state: {
        activeSourceResourceId: 'A', activeSplitSetId: activeSetId, busy: false,
        source: { id: 'A', dataUrl: 'data:a' },
        splitSets: Object.values(cards),
        parts: cards[activeSetId].parts.map((part) => ({ ...part }))
      },
      imageOutpaintStateSnapshot: () => null, restoreImageOutpaintStateSnapshot: () => {},
      addSourceDataUrlResource: async () => { ctx.state.activeSourceResourceId = 'A2'; return true },
      normalizeSpineLayerOrder: (parts) => parts,
      splitSetById: (id) => ctx.state.splitSets.find((set) => set.id === id) || null,
      syncActiveSplitSet: () => { ctx.splitSetById(ctx.state.activeSplitSetId).parts = ctx.state.parts.map((part) => ({ ...part })) },
      refreshSplitPreview: async () => { ctx.refreshed += 1 },
      sourceSize: async () => ({ width: 1016, height: 1018 }),
      showCanvasResizeDialog: async () => 'raw', parseCanvasResizeInput: () => delta, sourceFullCanvas: async () => ({}),
      canvasOfSize: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:a-wide' }),
      syncActiveSourceResourceFromState: () => {}, cacheTempSplitPackage: async () => {},
      resetSelectionTool() {}, resetMaskEditor() {}, resetPenTool() {}, resetSplitCanvasViewport() {},
      setMessage() {}, render() {}, updatePreviewOverlay() {}, syncSplitWorkspace() {}
    };
    runInContext(`${fn('function shiftPartForCanvasResize')}\n${fn('async function commitImageOutpaintResult')}\n${fn('async function executeCanvasResizeTool')}`, Object.assign(createContext(ctx), ctx));
    await body(ctx);
    return { ...ctx, cards };
  };
  const outpaint = (ctx) => runInContext('commitImageOutpaintResult("a_outpaint.png", "data:x", ' + JSON.stringify(delta) + ', { width: 1504, height: 1024 })', ctx);
  const resize = (ctx) => runInContext('executeCanvasResizeTool()', ctx);
  for (const [name, act] of [['无限扩图', outpaint], ['画布扩展', resize]]) {
    const onZ = await run('z', act);
    checkEqual(`${name} with Z's card open: Z's layers stay put`, [onZ.cards.z.parts[0].x, onZ.cards.z.parts[0].y, onZ.cards.z.parts[0].sourceWidth], [5, 6, undefined]);
    checkEqual(`${name} with Z's card open: A's layers move onto the new frame`, [onZ.cards.a.parts[0].x, onZ.cards.a.parts[0].y, onZ.cards.a.parts[0].sourceWidth], [254, 23, 1504]);
    checkEqual(`${name} with Z's card open: a card from before multiple sources still moves`, [onZ.cards.old.parts[0].x, onZ.cards.old.parts[0].y], [245, 5]);
    checkEqual(`${name} with Z's card open: Z keeps its preview, the moved cards drop theirs`, [onZ.cards.z.previewDataUrl, onZ.cards.a.previewDataUrl], ['z.png', '']);
    checkEqual(`${name} with Z's card open: no composite is drawn for Z at A's size`, onZ.refreshed, 0);
    const onA = await run('a', act);
    checkEqual(`${name} with A's card open: A's layers move and Z's stay`, [onA.cards.a.parts[0].x, onA.cards.a.parts[0].y, onA.cards.z.parts[0].x], [254, 23, 5]);
    checkEqual(`${name} with A's card open: A's composite is rebuilt`, onA.refreshed, 1);
  }
  const outpainted = await run('z', outpaint);
  checkEqual('无限扩图 re-points A\'s card at the outpainted picture, Z\'s card keeps Z', [outpainted.cards.a.sourceResourceId, outpainted.cards.z.sourceResourceId], ['A2', 'Z']);
}

finish('web-object-transfer-qwen21');
