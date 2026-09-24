// UI design on a compute node that carries Qwen-Image-2.1: the page plans a multi-reference run
// once the node reports the 2.1 files, and the worker builds one TextEncodeQwenImage21 graph with
// every reference. No GPU is used here.
import strictAssert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { withReferences } from '../../worker/src/worker-core.mjs';
import { detectQwenImage21 } from '../../worker/src/models/model-manager.mjs';
import { sanitizeReferences, MAX_TASK_REFERENCES } from '../../packages/shared/src/control-plane.mjs';

let checks = 0;
const assert = new Proxy(strictAssert, { get(target, key) {
  const fn = target[key];
  return typeof fn === 'function' ? (...args) => { checks += 1; return fn(...args); } : fn;
} });

// ---- worker graph -------------------------------------------------------------------------
const io = (...names) => Object.fromEntries(names.map((name) => [name, ['*']]));
const qwen21Info = {
  LoadImage: { input: { required: { image: [['x.png']] } } },
  UnetLoaderGGUF: { input: { required: { unet_name: [['qwen-image-2.1-UC-Q8_0.gguf']] } } },
  CLIPLoader: { input: { required: { clip_name: [['qwen3vl_8b_w4a8_heretic.safetensors']], type: [['stable_diffusion', 'qwen_image']] }, optional: { device: [['default', 'cpu']] } } },
  VAELoader: { input: { required: { vae_name: [['qwen_image_2.1_vae_bf16.safetensors']] } } },
  TextEncodeQwenImage21: { input: { required: { ...io('clip', 'prompt', 'negative_prompt'), resolution: ['INT', { default: 1024 }], images: ['COMFY_AUTOGROW_V3', {}] }, optional: io('vae') } },
  QwenImage21Cache: { input: { required: { model: ['MODEL'], device: [['auto', 'cpu']], dtype: [['default', 'int8']] } } },
  KSampler: { input: { required: { ...io('model', 'positive', 'negative', 'latent_image', 'seed', 'steps', 'cfg', 'denoise'), sampler_name: [['euler']], scheduler: [['simple']] } } },
  VAEDecode: { input: { required: io('samples', 'vae') } },
  SplitImageWithAlpha: { input: { required: io('image') } },
  ImageScale: { input: { required: { ...io('image', 'width', 'height'), upscale_method: [['lanczos']], crop: [['disabled', 'center']] } } },
  ImageScaleToTotalPixels: { input: { required: { ...io('image', 'megapixels', 'resolution_steps'), upscale_method: [['lanczos']] } } },
  ImageCrop: { input: { required: io('image', 'width', 'height', 'x', 'y') } },
  EmptyLatentImage: { input: { required: io('width', 'height', 'batch_size') } },
  SaveImage: { input: { required: io('images', 'filename_prefix') } }
};
const rendererDir = fileURLToPath(new URL('../../worker-renderer/', import.meta.url));
const host21 = await createWorkflowHost({ rendererDir, objectInfo: qwen21Info });
const byClass = (graph, type) => Object.entries(graph).filter(([, node]) => node.class_type === type);
const uiRoles = (roles) => roles.map((role, index) => ({ index, role }));
const buildUi = async (host, names, sizes, roles, extraState = {}) => JSON.parse(JSON.stringify(await host.buildGraph({
  module: 'novaflow-brand-runtime', method: 'buildArtGenerateRunWorkflow', options: { __args: [
    'local', 'img2img', names, 'NovaFlow_UI', 'slot main screen', '', 'client', sizes,
    { provider: 'local', mode: 'img2img', width: 756, height: 1638, seed: 7, randomSeed: false, localUiEngine: 'qwen-2.1', ...extraState },
    16, { taskProfile: 'ui-design', referenceRoles: roles.map((item, index) => (typeof item === 'string' ? { index, role: item } : { index, ...item })) }
  ] }
})));

// 1 style screenshot, 8 symbols and a full-screen background: every one is a reference (10, the
// model card's limit).
const names = Array.from({ length: 10 }, (_, i) => `ui_q21_${String(i + 1).padStart(2, '0')}.png`);
const sizes = [{ width: 1920, height: 1080 }, ...Array.from({ length: 8 }, () => ({ width: 148, height: 125 })), { width: 756, height: 1638 }];
const roles = ['style', ...Array.from({ length: 9 }, () => 'content')];
const ui = await buildUi(host21, names, sizes, roles);
const encode = byClass(ui, 'TextEncodeQwenImage21');
assert.equal(encode.length, 1);
const encodeInputs = encode[0][1].inputs;
assert.equal(encodeInputs.resolution, 0);
assert.equal(encodeInputs.negative_prompt, '');
for (let i = 0; i < 10; i += 1) {
  let ref = encodeInputs[`images.image_${i + 1}`];
  if (ui[ref[0]].class_type === 'ImageScale') ref = ui[ref[0]].inputs.image;
  assert.equal(ui[ref[0]].inputs.image, names[i]);
}
assert.equal(encodeInputs['images.image_11'], undefined);
assert.equal(byClass(ui, 'UNETLoader').length + byClass(ui, 'TextEncodeQwenImageEditPlus').length, 0);
// The style screenshot and the background are over their 0.5 MP budget; the symbols go in as they are.
const refScales = byClass(ui, 'ImageScale').filter(([, node]) => node.inputs.image[0] !== byClass(ui, 'SplitImageWithAlpha')[0][0]);
assert.equal(refScales.length, 2);
for (const [, node] of refScales) {
  const { width, height } = node.inputs;
  assert.ok(width * height <= 500000 && width * height > 300000 && width % 32 === 0 && height % 32 === 0, `${width}x${height}`);
}
const latent = byClass(ui, 'EmptyLatentImage')[0][1].inputs;
// The working size keeps the requested aspect within 1% (flooring both sides stretched it 3%).
assert.deepEqual([latent.width, latent.height], [640, 1376]);
const sampler = byClass(ui, 'KSampler')[0][1].inputs;
assert.deepEqual([sampler.seed, sampler.steps, sampler.cfg, sampler.latent_image[0]], [7, 25, 1, byClass(ui, 'EmptyLatentImage')[0][0]]);
// A filled negative prompt is used for real: cfg 1 would never evaluate it, so the run goes to 2.5.
const withNegative = JSON.parse(JSON.stringify(await host21.buildGraph({ module: 'novaflow-brand-runtime', method: 'buildArtGenerateRunWorkflow', options: { __args: [
  'local', 'img2img', names.slice(0, 2), 'NovaFlow_UI', 'slot main screen', '模糊，水印', 'client', sizes.slice(0, 2),
  { provider: 'local', mode: 'img2img', width: 756, height: 1638, seed: 7, randomSeed: false, localUiEngine: 'qwen-2.1' },
  16, { taskProfile: 'ui-design', referenceRoles: [{ index: 0, role: 'style' }, { index: 1, role: 'content' }] }
] } })));
assert.equal(byClass(withNegative, 'TextEncodeQwenImage21')[0][1].inputs.negative_prompt, '模糊，水印');
assert.equal(byClass(withNegative, 'KSampler')[0][1].inputs.cfg, 2.5);
// Opaque output at the requested size.
const [splitId] = byClass(ui, 'SplitImageWithAlpha')[0];
const finish = byClass(ui, 'ImageScale').find(([, node]) => node.inputs.image[0] === splitId)[1].inputs;
assert.deepEqual([finish.width, finish.height], [756, 1638]);
assert.equal(byClass(ui, 'SaveImage')[0][1].inputs.filename_prefix, 'NovaFlow_UI');

// A long list of large references shares one pixel cap.
const bigNames = Array.from({ length: 10 }, (_, i) => `big_${i}.png`);
const big = await buildUi(host21, bigNames, bigNames.map(() => ({ width: 1024, height: 1024 })), bigNames.map(() => 'layout'));
const bigPixels = byClass(big, 'ImageScale').filter(([, node]) => ui && node.inputs.width !== 756).reduce((sum, [, node]) => sum + node.inputs.width * node.inputs.height, 0);
assert.ok(bigPixels <= 2000000 && bigPixels > 1500000, 'reference pixels stay near the shared cap: ' + bigPixels);

await assert.rejects(buildUi(host21, Array.from({ length: 11 }, (_, i) => `r${i}.png`), [], Array.from({ length: 11 }, () => 'reference')), /最多接收 10/);
// Iteration: the current design is sampled at the working size, outside the reference budgets.
const iteration = await buildUi(host21, ['base.png', 's1.png', 's2.png'], [{ width: 756, height: 1638 }, { width: 148, height: 125 }, { width: 148, height: 125 }],
  [{ role: 'content', treatment: 'base' }, 'content', 'content'], { uiRunIntent: 'iteration' });
const iterationEncode = byClass(iteration, 'TextEncodeQwenImage21')[0][1].inputs;
const baseScale = iteration[iterationEncode['images.image_1'][0]];
assert.equal(baseScale.class_type, 'ImageScale');
assert.deepEqual([baseScale.inputs.width, baseScale.inputs.height, baseScale.inputs.crop], [640, 1376, 'center']);
const iterationLatent = byClass(iteration, 'EmptyLatentImage')[0][1].inputs;
assert.deepEqual([iterationLatent.width, iterationLatent.height], [640, 1376]);
assert.equal(iteration[iterationEncode['images.image_2'][0]].class_type, 'LoadImage');

// A reference of unknown size is scaled by its real pixel count; no role goes in unbudgeted.
const unknown = await buildUi(host21, ['a.png', 'b.png'], [{ width: 0, height: 0 }, { width: 8000, height: 8000 }], ['style', 'ui_layout']);
const unknownEncode = byClass(unknown, 'TextEncodeQwenImage21')[0][1].inputs;
assert.equal(unknown[unknownEncode['images.image_1'][0]].class_type, 'ImageScaleToTotalPixels');
assert.ok(unknown[unknownEncode['images.image_1'][0]].inputs.megapixels <= 0.5);
const guideScale = unknown[unknownEncode['images.image_2'][0]];
assert.ok(guideScale.class_type === 'ImageScale' && guideScale.inputs.width * guideScale.inputs.height <= 500000);
// The requested output size is capped.
const huge = await buildUi(host21, [], [], [], { width: 100000, height: 100000 });
const hugeFinish = byClass(huge, 'ImageScale').find(([, node]) => node.inputs.image[0] === byClass(huge, 'SplitImageWithAlpha')[0][0])[1].inputs;
assert.deepEqual([hugeFinish.width, hugeFinish.height], [4096, 4096]);

// The host re-reads the node catalogue per build, so 2.1 installed while the worker runs is used.
let liveCatalogue = { LoadImage: qwen21Info.LoadImage, KSampler: qwen21Info.KSampler };
const liveHost = await createWorkflowHost({ rendererDir, comfy: { requestJson: async (_base, path) => (path === '/object_info' ? liveCatalogue : {}) } });
await assert.rejects(buildUi(liveHost, names, sizes, roles), /缺少 Qwen-Image-2.1/);
liveCatalogue = qwen21Info;
assert.equal(byClass(await buildUi(liveHost, names, sizes, roles), 'TextEncodeQwenImage21').length, 1);

// A screen with nothing connected is a text-only 2.1 run.
const textOnly = await buildUi(host21, [], [], []);
assert.equal(byClass(textOnly, 'LoadImage').length, 0);
assert.equal(Object.keys(byClass(textOnly, 'TextEncodeQwenImage21')[0][1].inputs).filter((key) => key.startsWith('images.')).length, 0);

// Drawing img2img on 2.1 with W / H on reference 1's size is an edit in place: reference 1 goes in at
// the working size, the sampler takes the encoder's own latent and the output comes back at W / H.
const buildDraw = async (names, sizes, width, height, negative = '') => JSON.parse(JSON.stringify(await host21.buildGraph({ module: 'novaflow-brand-runtime', method: 'buildArtGenerateRunWorkflow', options: { __args: [
  'local', 'img2img', names, 'NovaFlow_Art', 'recolour', negative, 'client', sizes,
  { provider: 'local', mode: 'img2img', width, height, seed: 1, randomSeed: false }, 4, {}
] } })));
const drawI2i = await buildDraw(['ref.png'], [{ width: 512, height: 720 }], 512, 720);
// The model card's 40 steps unless the panel says otherwise.
assert.equal(byClass(drawI2i, 'KSampler')[0][1].inputs.steps, 40);
const drawSaved = drawI2i[byClass(drawI2i, 'SaveImage')[0][1].inputs.images[0]];
assert.equal(drawSaved.class_type, 'ImageScale');
assert.deepEqual([drawSaved.inputs.width, drawSaved.inputs.height], [512, 720]);
assert.equal(byClass(drawI2i, 'KSampler')[0][1].inputs.cfg, 1);
const drawEncode = byClass(drawI2i, 'TextEncodeQwenImage21')[0];
assert.deepEqual(byClass(drawI2i, 'KSampler')[0][1].inputs.latent_image, [drawEncode[0], 2]);
const drawFirst = drawI2i[drawEncode[1].inputs['images.image_1'][0]];
assert.deepEqual([drawFirst.class_type, drawFirst.inputs.width, drawFirst.inputs.height], ['ImageScale', 512, 736]);
assert.equal(drawI2i[drawFirst.inputs.image[0]].class_type, 'LoadImage');
// No node reads its own output (the old graph gave the output scale reference 1's loader id).
const reaches = (graph, from, target, seen = new Set()) => {
  if (seen.has(from)) return false;
  seen.add(from);
  return Object.values(graph[from]?.inputs || {}).some((value) => Array.isArray(value) && (String(value[0]) === target || reaches(graph, String(value[0]), target, seen)));
};
Object.keys(drawI2i).forEach((id) => assert.ok(!reaches(drawI2i, id, id), `cycle at ${id}`));
// W / H on another aspect lay the picture out anew on an empty latent of that size.
const drawRelayout = await buildDraw(['ref.png'], [{ width: 512, height: 720 }], 1024, 1024);
const relayoutLatent = byClass(drawRelayout, 'EmptyLatentImage')[0];
assert.deepEqual([relayoutLatent[1].inputs.width, relayoutLatent[1].inputs.height], [1024, 1024]);
assert.deepEqual(byClass(drawRelayout, 'KSampler')[0][1].inputs.latent_image, [relayoutLatent[0], 0]);
assert.equal(drawRelayout[byClass(drawRelayout, 'SaveImage')[0][1].inputs.images[0]].class_type, 'VAEDecode');
// A large W / H is sampled at ~1.3 MP and scaled up at the end.
const drawLarge = await buildDraw(['ref.png'], [{ width: 4000, height: 4000 }], 2048, 2048);
const largeFirst = drawLarge[byClass(drawLarge, 'TextEncodeQwenImage21')[0][1].inputs['images.image_1'][0]].inputs;
assert.ok(largeFirst.width === largeFirst.height && largeFirst.width * largeFirst.height <= 1300000 && largeFirst.width % 32 === 0);
const largeSaved = drawLarge[byClass(drawLarge, 'SaveImage')[0][1].inputs.images[0]].inputs;
assert.deepEqual([largeSaved.width, largeSaved.height], [2048, 2048]);
// Up to ten references (the model card's limit); the ones after reference 1 share 1.5 MP, 0.5 MP at
// most each.
const many = Array.from({ length: 11 }, (_, i) => `r${i}.png`);
const drawMany = await buildDraw(many, many.map(() => ({ width: 1024, height: 1024 })), 1024, 1024);
const manyEncode = byClass(drawMany, 'TextEncodeQwenImage21')[0][1].inputs;
assert.equal(Object.keys(manyEncode).filter((key) => key.startsWith('images.')).length, 10);
assert.equal(byClass(drawMany, 'LoadImage').length, 10);
const extraPixels = Array.from({ length: 9 }, (_, i) => drawMany[manyEncode[`images.image_${i + 2}`][0]].inputs)
  .map((inputs) => inputs.width * inputs.height);
assert.ok(extraPixels.every((pixels) => pixels <= 500000) && extraPixels.reduce((a, b) => a + b, 0) <= 1500000);
const fewExtra = await buildDraw(['a.png', 'b.png'], [{ width: 800, height: 600 }, { width: 400, height: 300 }], 800, 600);
assert.equal(fewExtra[byClass(fewExtra, 'TextEncodeQwenImage21')[0][1].inputs['images.image_2'][0]].class_type, 'LoadImage');
// Drawing on 2.1: only the user's own negative prompt (state.negativePrompt) counts and reaches the
// graph; the quality profile's automatic negatives in the compiled argument neither switch CFG nor go
// to 2.1.
const drawT2i = async (userNegative, compiledNegative, extraState = {}) => JSON.parse(JSON.stringify(await host21.buildGraph({ module: 'novaflow-brand-runtime', method: 'buildArtGenerateRunWorkflow', options: { __args: [
  'local', 'txt2img', [], 'NovaFlow_Art', 'a knight', compiledNegative, 'client', [],
  { provider: 'local', mode: 'txt2img', width: 1024, height: 1024, seed: 1, randomSeed: false, negativePrompt: userNegative, ...extraState }, 4, {}
] } })));
const profileOnly = await drawT2i('', '错误人体，畸形手指，低完成度');
assert.equal(byClass(profileOnly, 'TextEncodeQwenImage21')[0][1].inputs.negative_prompt, '');
assert.deepEqual([byClass(profileOnly, 'KSampler')[0][1].inputs.steps, byClass(profileOnly, 'KSampler')[0][1].inputs.cfg], [40, 1]);
const drawNegative = await drawT2i('blurry, extra fingers', 'blurry, extra fingers，错误人体，低完成度');
assert.equal(byClass(drawNegative, 'TextEncodeQwenImage21')[0][1].inputs.negative_prompt, 'blurry, extra fingers');
assert.equal(byClass(drawNegative, 'KSampler')[0][1].inputs.cfg, 2.5);
// Steps / CFG typed on the panel for this route are what the run uses.
const drawTyped = await drawT2i('', '', { samplingOverrides: { 'qwen-2.1:txt2img': { steps: 25, cfg: 3 } } });
assert.deepEqual([byClass(drawTyped, 'KSampler')[0][1].inputs.steps, byClass(drawTyped, 'KSampler')[0][1].inputs.cfg], [25, 3]);

// Asked for 2.1 on a node without it: an error, never a 2511 graph that keeps three references.
const hostOld = await createWorkflowHost({ rendererDir, objectInfo: { LoadImage: qwen21Info.LoadImage, KSampler: qwen21Info.KSampler } });
await assert.rejects(buildUi(hostOld, names, sizes, roles), /缺少 Qwen-Image-2.1/);
// Without the engine flag the UI run never becomes a 2.1 graph.
await assert.rejects(buildUi(host21, names.slice(0, 3), sizes.slice(0, 3), ['style', 'content', 'ui_layout'], { localUiEngine: '' }), (error) => !/Qwen-Image-2.1/.test(error.message));

// The worker renames all ten uploads.
const refs15 = Array.from({ length: 10 }, (_, i) => ({ name: `ui_q21_${i}.png` }));
const mapped = withReferences({ __args: ['local', 'img2img', refs15.map((r) => r.name)] }, refs15.map((_, i) => `task-${i}.png`), refs15, 'buildArtGenerateRunWorkflow');
assert.deepEqual(mapped.__args[2], refs15.map((_, i) => `task-${i}.png`));
assert.equal(MAX_TASK_REFERENCES, 20);
assert.equal(sanitizeReferences(Array.from({ length: 25 }, (_, i) => ({ name: `r${i}.png` }))).length, 20);

// ---- node probe -----------------------------------------------------------------------------
const catalogue = {
  ...qwen21Info,
  UnetLoaderGGUF: { input: { required: { unet_name: [['qwen-image-2.1-UC-Q8_0.gguf']] } } }
};
let served = catalogue;
const server = createServer((req, res) => {
  const node = decodeURIComponent(req.url.split('/object_info/')[1] || '');
  res.writeHead(served[node] ? 200 : 200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(served[node] ? { [node]: served[node] } : {}));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const comfy = { baseUrl: `http://127.0.0.1:${server.address().port}` };
assert.equal(await detectQwenImage21(comfy), true);
served = { ...catalogue, UnetLoaderGGUF: { input: { required: { unet_name: [['flux1-dev-Q8_0.gguf']] } } } };
assert.equal(await detectQwenImage21(comfy), false);
served = { ...catalogue, TextEncodeQwenImage21: undefined };
assert.equal(await detectQwenImage21(comfy), false);
server.close();

// ---- page side ------------------------------------------------------------------------------
const require = createRequire(import.meta.url);
const renderer = (name) => require(fileURLToPath(new URL(`../../renderer/${name}`, import.meta.url)));
renderer('ui-design-local.workflow.js');
renderer('ui-design-local-reference.helper.js');
renderer('ui-design-local-director.workflow.js');
renderer('ui-design-layout-guide.helper.js');
renderer('ui-design-generate.workflow.js');
// The renderer folder is ESM-typed, so the UMD modules register on globalThis only.
const generate = globalThis.NovaFlowUiDesignGenerateWorkflow;

globalThis.electronAPI = { runtimeFeaturesSync: () => ({}), runtimeFeatures: async () => ({}) };
assert.equal(generate.providerCapability('local').externalReferenceLimit, 2);
globalThis.electronAPI = { runtimeFeaturesSync: () => ({ qwenImage21: true }), runtimeFeatures: async () => ({ qwenImage21: true }) };
assert.equal(generate.providerCapability('local').externalReferenceLimit, 10);
assert.equal(generate.providerCapability('local').reservedLayoutReferences, 0);
assert.equal(generate.providerCapability('local').negativePrompt, true);
assert.equal(generate.providerCapability('gpt').externalReferenceLimit, 15);

const mentions = generate.compileUiMentions('把@参考图2放在转轴里', [{ sourceId: 'a' }, { sourceId: 'b' }], { modelImageNumbers: [1, 2], imageToken: 'angle' });
assert.equal(mentions.text, '把<image2>放在转轴里');

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const runRefs = [
  { name: '风格.png', dataUrl: pixel, role: 'style', sourceId: 's', width: 1920, height: 1080 },
  ...Array.from({ length: 9 }, (_, i) => ({ name: `符号${i}.png`, dataUrl: pixel, role: 'asset', sourceId: `a${i}`, width: 148, height: 125 }))
];
const project = {
  width: 756, height: 1638, canvas: { width: 756, height: 1638 },
  blocks: [
    { id: 'top', name: '顶部信息栏', x: 0, y: 0, width: 756, height: 180, purpose: '余额与标题' },
    { id: 'reels', name: '转轴', x: 0, y: 300, width: 756, height: 900, purpose: '5列3行转轴' },
    { id: 'bottom', name: '底部操作栏', x: 0, y: 1400, width: 756, height: 238, purpose: '旋转按钮' }
  ]
};
const uploads = [];
let built = null;
const bridge = {
  detectBaseUrl: async () => 'http://runtime',
  requestJson: async (_base, path) => path === '/prompt'
    ? { ok: true, data: { prompt_id: 'p1' } }
    : { ok: true, data: { p1: { outputs: { 11: { images: [{ filename: 'ui.png' }] } } } } },
  fetchBlob: async () => ({ blob: true }),
  uploadDataUrl: async (_base, name) => { uploads.push(name); return { name }; },
  buildRunWorkflow: async (options) => { built = options; return { workflow: { 1: { class_type: 'SaveImage', inputs: {} } }, modelKey: 'qwen-image-2.1-ui' }; },
  validateWorkflowNodes: async () => true,
  extractFiles: (item) => (item?.outputs ? [{ filename: 'ui.png' }] : []),
  historyErrorMessage: () => '',
  readQueueState: async () => ({ empty: false, pending: 0 }),
  withTimeout: async (task) => task(),
  blobToDataUrl: async () => pixel
};
const state = { provider: 'local', width: 756, height: 1638, randomSeed: false, seed: 3, negativePrompt: '模糊，水印', promptMentionBindings: { '@参考图2': 'a0' } };
const result = await generate.run({
  bridge, project, refs: runRefs, state,
  prompt: '怪盗女神老虎机主界面，@参考图2 作为 wild 符号', negativePrompt: '模糊，水印',
  layoutGuide: { kind: 'ui-layout-guide', role: 'ui_layout', clean: true, editorSnapshot: false, name: 'guide.png', dataUrl: pixel, width: 756, height: 1638, visualEncoding: 'soft-ui-semantic-scaffold-v2', source: 'test', semantic: null },
  pollIntervalMs: 0
});
assert.equal(result.localEngine, 'qwen-2.1');
assert.equal(state.localUiEngine, 'qwen-2.1');
// No guide image: the ten connected images are the references, the structure is text.
assert.equal(uploads.length, 10);
assert.deepEqual(uploads, Array.from({ length: 10 }, (_, i) => `ui_q21_${String(i + 1).padStart(2, '0')}.png`));
assert.equal(built.maxReferences, 10);
// Only what the user wrote: the automatic 2511 canvas negatives would force cfg 2.5 on every run.
assert.equal(built.negativePrompt, '模糊，水印');
assert.equal(built.referenceRoles.length, 10);
assert.ok(built.referenceRoles.every((item) => item.role !== 'ui_layout'));
assert.equal(built.referenceRoles[0].role, 'style');
assert.equal(built.referenceRoles[1].role, 'content');
assert.ok(built.prompt.includes('<image2>') && built.prompt.includes('<image10> 符号8: finished asset'));
assert.ok(!built.prompt.includes('occupancy map') && built.prompt.includes('Screen structure, top to bottom:'));
assert.ok(built.prompt.includes('wild') && !built.prompt.includes('Also avoid'));
assert.ok(!/图\d/.test(built.prompt) && built.prompt.length <= 4000);
assert.ok(built.prompt.includes('<image1> 风格: style reference') && built.prompt.includes('<image2> 符号0: finished asset'));
// Region lines carry their position; the 2511 content-lock paragraphs stay out.
assert.ok(built.prompt.includes('- 0-11% from the top: 顶部信息栏：余额与标题') && !built.prompt.includes('Content lock') && !built.prompt.includes('@参考图'));

// Side-by-side regions keep their horizontal place and name (unless the text already says it);
// the list runs top to bottom.
const sideBySide = generate.compileQwen21UiPrompt({
  project: { width: 1920, height: 1080, canvas: { width: 1920, height: 1080 } },
  semantic: { canvas: { width: 1920, height: 1080 }, regions: [
    { name: '转轴', purpose: '5列3行转轴', xNorm: 0.22, yNorm: 0.11, wNorm: 0.56, hNorm: 0.78 },
    { name: '右侧栏', xNorm: 0.79, yNorm: 0.11, wNorm: 0.21, hNorm: 0.78 },
    { name: '顶栏', purpose: '余额', xNorm: 0, yNorm: 0, wNorm: 1, hNorm: 0.1 },
    { name: '奖池', purpose: '奖池金额', xNorm: 0, yNorm: 0.11, wNorm: 0.21, hNorm: 0.78 }
  ] },
  userPrompt: '老虎机横屏主界面', references: []
});
const structureLines = sideBySide.split(String.fromCharCode(10)).filter((line) => line.startsWith('- '));
assert.deepEqual(structureLines, [
  '- 0-10% from the top: 顶栏：余额',
  '- 11-89% from the top, 0-21% from the left: 奖池金额',
  '- 11-89% from the top, 22-78% from the left: 5列3行转轴',
  '- 11-89% from the top, 79-100% from the left: 右侧栏：完成该功能区'
]);
// A long request shrinks; the keep / avoid lines at the end are never cut.
const longPrompt = generate.compileQwen21UiPrompt({
  project: { width: 756, height: 1638, canvas: { width: 756, height: 1638 } },
  semantic: { canvas: { width: 756, height: 1638 }, regions: Array.from({ length: 8 }, (_, i) => ({ name: '区' + i, purpose: '说明'.repeat(60), yNorm: i / 8, hNorm: 0.12, xNorm: 0, wNorm: 1 })) },
  userPrompt: '界面要求，'.repeat(400), negativePrompt: '模糊，水印',
  references: Array.from({ length: 10 }, (_, i) => ({ name: '一个很长的素材名称' + i + '.png', role: i % 2 ? 'style' : 'reference' }))
});
assert.ok(longPrompt.length <= 4000, 'prompt length ' + longPrompt.length);
assert.ok(!longPrompt.includes('Also avoid') && longPrompt.includes('Do not show:') && longPrompt.includes('<image10>'));
assert.ok(longPrompt.includes('- 88-100% from the top: 区7：说明'));

// Eleven connected images is one too many even on 2.1 (the model card's limit is 10).
await assert.rejects(generate.run({ bridge, project, refs: [...runRefs, ...runRefs.slice(0, 1)], state: { ...state }, prompt: 'x' }), /最多支持 10 张外部参考图，当前已连接 11 张/);

// Without the node's answer the page stays on the 2511 plan.
globalThis.electronAPI = { runtimeFeaturesSync: () => ({}), runtimeFeatures: async () => ({}) };
await assert.rejects(generate.run({ bridge, project, refs: runRefs.slice(0, 3), state: { ...state }, prompt: 'x' }), /最多支持 2 张/);

// Drawing controls on a 2.1 node: no Instant quality or edit strength; steps and CFG on every local
// route that samples; img2img with W / H and up to ten references; the negative prompt kept.
renderer('art-generate-model.resource.js');
const models = globalThis.NovaFlowArtGenerateModels;
globalThis.electronAPI = { runtimeFeaturesSync: () => ({ qwenImage21: true }), runtimeFeatures: async () => ({ qwenImage21: true }) };
const allFields = ['width', 'height', 'steps', 'cfg', 'seed', 'nsfw'];
assert.deepEqual([...models.capabilityFor('local', 'txt2img', {}).fields], allFields);
assert.deepEqual([...models.capabilityFor('local', 'img2img', {}).fields], allFields);
assert.equal(models.capabilityFor('local', 'img2img', {}).referenceLimit, 10);
assert.equal(models.capabilityFor('local', 'img2img', { nsfw: true }).referenceLimit, 3);
assert.equal(models.capabilityFor('local', 'img2img', {}).negativePrompt, true);
assert.deepEqual([...models.capabilityFor('local', 'txt2img', { nsfw: true }).fields], allFields);
assert.deepEqual([...models.capabilityFor('local', 'img2img', { loras: [{ name: 'x' }] }).fields], allFields);
assert.deepEqual([...models.capabilityFor('local', 'img2img', { nsfw: true }).fields], allFields);
// Route defaults: 2.1 40 steps, CFG 1 (2.5 with the user's negative); NSFW (Rapid AIO) 6 steps, CFG 1;
// the 2511 route of a LoRA run 4 Lightning steps at CFG 1, the base 40 steps at CFG 4 with a negative.
const pick = (sampling) => sampling && [sampling.route, sampling.steps, sampling.cfg, sampling.lightning];
assert.deepEqual(pick(models.localSamplingFor({ provider: 'local' }, 'txt2img', '')), ['qwen-2.1', 40, 1, false]);
assert.deepEqual(pick(models.localSamplingFor({ provider: 'local' }, 'img2img', 'blurry')), ['qwen-2.1', 40, 2.5, false]);
assert.deepEqual(pick(models.localSamplingFor({ provider: 'local', nsfw: true }, 'img2img', 'blurry')), ['rapid', 6, 1, false]);
assert.deepEqual(pick(models.localSamplingFor({ provider: 'local', nsfw: true }, 'txt2img', '')), ['rapid', 6, 1, false]);
const lora = { provider: 'local', loras: [{ name: 'x' }] };
assert.deepEqual(pick(models.localSamplingFor(lora, 'img2img', '')), ['standard', 4, 1, true]);
assert.deepEqual(pick(models.localSamplingFor(lora, 'img2img', 'blurry')), ['standard', 40, 4, false]);
assert.equal(models.localSamplingFor(lora, 'txt2img', ''), null);
assert.equal(models.localSamplingFor({ provider: 'gpt' }, 'img2img', ''), null);
// The state's own negative prompt is the default source; a run can name its route.
assert.equal(models.localSamplingFor({ provider: 'local', negativePrompt: 'blurry' }, 'txt2img').cfg, 2.5);
assert.equal(models.localSamplingFor({ provider: 'local' }, 'img2img', '', 'standard').route, 'standard');
// Typed values stay with their route and mode, within the route's range; typing the default or
// clearing the field follows the route again.
const typed = { provider: 'local', nsfw: true };
assert.equal(models.setLocalSamplingValue(typed, 'img2img', 'steps', '20').steps, 8);
assert.equal(models.localSamplingFor(typed, 'img2img').stepsManual, true);
assert.equal(models.localSamplingFor(typed, 'txt2img').steps, 6);
typed.nsfw = false;
assert.equal(models.localSamplingFor(typed, 'img2img').steps, 40);
models.setLocalSamplingValue(typed, 'img2img', 'cfg', '3.25');
assert.equal(models.localSamplingFor(typed, 'img2img').cfg, 3.3);
models.setLocalSamplingValue(typed, 'img2img', 'steps', '40');
assert.equal(models.localSamplingFor(typed, 'img2img').stepsManual, false);
models.setLocalSamplingValue(typed, 'img2img', 'cfg', '');
assert.equal(typed.samplingOverrides['qwen-2.1:img2img'], undefined);
typed.nsfw = true;
assert.equal(models.localSamplingFor(typed, 'img2img').steps, 8);
// On the 2511 route more than 8 steps turns the Lightning LoRA off and CFG follows to 4.
const loraTyped = { ...lora };
models.setLocalSamplingValue(loraTyped, 'img2img', 'steps', '20');
assert.deepEqual(pick(models.localSamplingFor(loraTyped, 'img2img', '')), ['standard', 20, 4, false]);
// The preset on the legacy graphs: the run's sampling over the family's sampler; UI design (no
// sampling) keeps its edit-strength presets.
const presetGraph = () => ({ 1: { class_type: 'KSampler', inputs: {} }, 2: { class_type: 'PrimitiveBoolean', inputs: { value: true }, _meta: { title: 'Enable 4 Step(s) LoRA?' } } });
const presetOf = (state, negative) => {
  const sampling = models.localSamplingFor(state, 'img2img', negative, state.nsfw ? 'rapid' : 'standard');
  const graph = models.applyLocalWorkflowPreset(presetGraph(), state, 'img2img', sampling);
  return [graph[1].inputs.steps, graph[1].inputs.cfg, graph[2].inputs.value, graph[1].inputs.sampler_name];
};
assert.deepEqual(presetOf(lora, ''), [4, 1, true, 'euler']);
assert.deepEqual(presetOf(lora, 'blurry'), [40, 4, false, 'euler']);
assert.deepEqual(presetOf({ provider: 'local', nsfw: true }, 'blurry'), [6, 1, true, 'euler_ancestral']);
const uiPreset = models.applyLocalWorkflowPreset(presetGraph(), { localEditStrength: 'enhanced' }, 'img2img');
assert.deepEqual([uiPreset[1].inputs.steps, uiPreset[1].inputs.cfg, uiPreset[2].inputs.value], [12, 4, false]);
globalThis.electronAPI = { runtimeFeaturesSync: () => ({}), runtimeFeatures: async () => ({}) };
assert.ok(models.capabilityFor('local', 'txt2img', {}).fields.includes('instantQuality'));

// The prompt editor's chips show the model image each @参考图 becomes: after the guide on 2511,
// the first connected image on 2.1.
globalThis.window = globalThis;
renderer('resource-mention.tool.js');
const chip = (modelImageNumber) => globalThis.NovaFlowResourceMentionTool.compileText({
  surface: 'ui-design', text: '@参考图1',
  resources: [{ key: 'ui_reference_1', sourceId: 'a', name: 'a.png', occupied: true, kind: 'image', modelImageNumber }]
}).text;
assert.equal(chip(1), '图1');
assert.equal(chip(undefined), '图2');
// The drawing panel's slots past the fixed three are @参考图 targets too.
const artRefs = Array.from({ length: 5 }, (_, i) => ({ key: `art_reference_${i + 1}`, label: `参考图${i + 1}`, kind: 'image', occupied: true, fileName: `r${i}.png`, previewUrl: 'data:image/png;base64,AA' }));
const artCompiled = globalThis.NovaFlowResourceMentionTool.compileText({ surface: 'art-generate', text: '@参考图5 和 @参考图2', resources: artRefs });
assert.deepEqual(artCompiled.invalidTokens, []);
assert.ok(artCompiled.text.includes('5') && !artCompiled.text.includes('@参考图5'));

console.log(checks + ' passed, 0 failed: UI design on Qwen-Image-2.1 (page plan, worker graph, node probe)');
