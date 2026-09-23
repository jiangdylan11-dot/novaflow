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

// 1 style screenshot, 10 symbols and a full-screen background: every one is a reference.
const names = Array.from({ length: 12 }, (_, i) => `ui_q21_${String(i + 1).padStart(2, '0')}.png`);
const sizes = [{ width: 1920, height: 1080 }, ...Array.from({ length: 10 }, () => ({ width: 148, height: 125 })), { width: 756, height: 1638 }];
const roles = ['style', ...Array.from({ length: 11 }, () => 'content')];
const ui = await buildUi(host21, names, sizes, roles);
const encode = byClass(ui, 'TextEncodeQwenImage21');
assert.equal(encode.length, 1);
const encodeInputs = encode[0][1].inputs;
assert.equal(encodeInputs.resolution, 0);
assert.equal(encodeInputs.negative_prompt, '');
for (let i = 0; i < 12; i += 1) {
  let ref = encodeInputs[`images.image_${i + 1}`];
  if (ui[ref[0]].class_type === 'ImageScale') ref = ui[ref[0]].inputs.image;
  assert.equal(ui[ref[0]].inputs.image, names[i]);
}
assert.equal(encodeInputs['images.image_13'], undefined);
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
// Opaque output at the requested size.
const [splitId] = byClass(ui, 'SplitImageWithAlpha')[0];
const finish = byClass(ui, 'ImageScale').find(([, node]) => node.inputs.image[0] === splitId)[1].inputs;
assert.deepEqual([finish.width, finish.height], [756, 1638]);
assert.equal(byClass(ui, 'SaveImage')[0][1].inputs.filename_prefix, 'NovaFlow_UI');

// A long list of large references shares one pixel cap.
const bigNames = Array.from({ length: 15 }, (_, i) => `big_${i}.png`);
const big = await buildUi(host21, bigNames, bigNames.map(() => ({ width: 1024, height: 1024 })), bigNames.map(() => 'layout'));
const bigPixels = byClass(big, 'ImageScale').filter(([, node]) => ui && node.inputs.width !== 756).reduce((sum, [, node]) => sum + node.inputs.width * node.inputs.height, 0);
assert.ok(bigPixels <= 2000000 && bigPixels > 1500000, 'reference pixels stay near the shared cap: ' + bigPixels);

await assert.rejects(buildUi(host21, Array.from({ length: 17 }, (_, i) => `r${i}.png`), [], Array.from({ length: 17 }, () => 'reference')), /最多接收 16/);
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

// Asked for 2.1 on a node without it: an error, never a 2511 graph that keeps three references.
const hostOld = await createWorkflowHost({ rendererDir, objectInfo: { LoadImage: qwen21Info.LoadImage, KSampler: qwen21Info.KSampler } });
await assert.rejects(buildUi(hostOld, names, sizes, roles), /缺少 Qwen-Image-2.1/);
// Without the engine flag the UI run never becomes a 2.1 graph.
await assert.rejects(buildUi(host21, names.slice(0, 3), sizes.slice(0, 3), ['style', 'content', 'ui_layout'], { localUiEngine: '' }), (error) => !/Qwen-Image-2.1/.test(error.message));

// The worker renames all fifteen uploads.
const refs15 = Array.from({ length: 15 }, (_, i) => ({ name: `ui_q21_${i}.png` }));
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
assert.equal(generate.providerCapability('local').externalReferenceLimit, 15);
assert.equal(generate.providerCapability('local').reservedLayoutReferences, 0);
assert.equal(generate.providerCapability('gpt').externalReferenceLimit, 15);

const mentions = generate.compileUiMentions('把@参考图2放在转轴里', [{ sourceId: 'a' }, { sourceId: 'b' }], { modelImageNumbers: [1, 2], imageToken: 'angle' });
assert.equal(mentions.text, '把<image2>放在转轴里');

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const runRefs = [
  { name: '风格.png', dataUrl: pixel, role: 'style', sourceId: 's', width: 1920, height: 1080 },
  ...Array.from({ length: 11 }, (_, i) => ({ name: `符号${i}.png`, dataUrl: pixel, role: 'asset', sourceId: `a${i}`, width: 148, height: 125 }))
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
// No guide image: the twelve connected images are the references, the structure is text.
assert.equal(uploads.length, 12);
assert.deepEqual(uploads, Array.from({ length: 12 }, (_, i) => `ui_q21_${String(i + 1).padStart(2, '0')}.png`));
assert.equal(built.maxReferences, 15);
assert.equal(built.negativePrompt, '');
assert.equal(built.referenceRoles.length, 12);
assert.ok(built.referenceRoles.every((item) => item.role !== 'ui_layout'));
assert.equal(built.referenceRoles[0].role, 'style');
assert.equal(built.referenceRoles[1].role, 'content');
assert.ok(built.prompt.includes('<image2>') && built.prompt.includes('<image12> 符号10: finished asset'));
assert.ok(!built.prompt.includes('occupancy map') && built.prompt.includes('Screen structure, top to bottom:'));
assert.ok(built.prompt.includes('wild') && built.prompt.includes('Also avoid: 模糊，水印'));
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
  references: Array.from({ length: 15 }, (_, i) => ({ name: '一个很长的素材名称' + i + '.png', role: i % 2 ? 'style' : 'reference' }))
});
assert.ok(longPrompt.length <= 4000, 'prompt length ' + longPrompt.length);
assert.ok(longPrompt.includes('Also avoid: 模糊，水印') && longPrompt.includes('Do not show:') && longPrompt.includes('<image15>'));
assert.ok(longPrompt.includes('- 88-100% from the top: 区7：说明'));

// Sixteen connected images is one too many even on 2.1.
await assert.rejects(generate.run({ bridge, project, refs: [...runRefs, ...runRefs.slice(0, 4)], state: { ...state }, prompt: 'x' }), /最多支持 15 张外部参考图，当前已连接 16 张/);

// Without the node's answer the page stays on the 2511 plan.
globalThis.electronAPI = { runtimeFeaturesSync: () => ({}), runtimeFeatures: async () => ({}) };
await assert.rejects(generate.run({ bridge, project, refs: runRefs.slice(0, 3), state: { ...state }, prompt: 'x' }), /最多支持 2 张/);

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

console.log(checks + ' passed, 0 failed: UI design on Qwen-Image-2.1 (page plan, worker graph, node probe)');
