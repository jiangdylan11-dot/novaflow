// Exercise the shipped adapters with the return shapes and entry points used
// by the art and animation panels. No paid providers or GPU are used here.
import strictAssert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { instrumentModule } from '../../tools/instrument-workflow-module.mjs';
import { isAllowedWorkflowCall } from '../../packages/shared/src/workflow-modules.mjs';
import { withReferences, assertGraphLoadsTaskInputs } from '../../worker/src/worker-core.mjs';
import { isSafeFilename } from '../../packages/shared/src/protocol.mjs';
import { fileURLToPath } from 'node:url';

const web = new URL('../../web-dist/', import.meta.url);
let checks = 0;
const assert = new Proxy(strictAssert, { get(target, key) {
  const fn = target[key];
  return typeof fn === 'function' ? (...args) => { checks += 1; return fn(...args); } : fn;
} });
const submissions = [];
const warehouseFiles = [];
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let task;
const sandbox = createDomSandbox({
  HTMLButtonElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {},
  Response, Request, Blob, FormData,
  NovaFlowWebWarehouse: { save: async item => { warehouseFiles.push(item); }, open: async () => ({ ok: true, warehouse: true }) },
  NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
  fetch: async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/api/web/capabilities')) return response({ taskTypes: ['qwen_t2i', 'h3_i2v'].map(task_type => ({ task_type, available_workers: 1 })) });
    if (url.endsWith('/api/web/tasks') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.ok(isAllowedWorkflowCall(body.workflow.module, body.workflow.method), JSON.stringify(body.workflow));
      submissions.push(body);
      task = { id: 'test-task', assigned_worker_id: 'test-worker', status: 'completed', output_manifest: { files: [{ name: 'NovaFlow_result-task.mp4', kind: 'video' }] } };
      return response({ task });
    }
    if (url.endsWith('/api/web/tasks/test-task')) return response({ task });
    if (url.endsWith('/grant')) return response({ grant: { endpoint: 'https://worker.test', token: 'test', expiresAt: new Date(Date.now() + 600000).toISOString() } });
    if (url.startsWith('https://worker.test/gw/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } });
    throw new Error('Unexpected request (including local runtime/owner APIs): ' + url);
  }
});
const context = createContext(sandbox);
runInContext(await readFile(new URL('novaflow-web-runtime.js', web), 'utf8'), context);
const api = sandbox.electronAPI;
const stats = await api.runtimeRequestJson({ baseUrl: 'http://127.0.0.1:8188', path: '/system_stats' });
assert.ok(stats.ok && stats.data.system && stats.data.devices.length === 1);
assert.equal(stats.data, stats.result);
const uploaded = await api.runtimeUploadImage({ fileName: 'test.png', dataBase64: 'AQID' });
assert.equal(uploaded.data.name, 'test.png');
// A name with no ASCII in it must still come out as something the worker gateway accepts, and two
// such names must stay two files.
const cn1 = (await api.runtimeUploadImage({ fileName: '白衣女.png', dataBase64: 'AQID' })).data.name;
const cn2 = (await api.runtimeUploadImage({ fileName: '背景图.png', dataBase64: 'AQID' })).data.name;
assert.ok(isSafeFilename(cn1) && isSafeFilename(cn2) && cn1 !== cn2, cn1 + ' / ' + cn2);
assert.ok(isSafeFilename((await api.runtimeUploadImage({ fileName: '(1).png', dataBase64: 'AQID' })).data.name));
// A prepared image from another panel must not contaminate text-to-video.
runInContext(await readFile(new URL('ai-sequence-minimax-h3.workflow.js', web), 'utf8'), context);
const video = sandbox.NovaFlowAiSequenceMiniMaxH3Workflow.getWorkflowJson({ mode: 't2v', prompt: 'a girl by the sea' });
const marker = JSON.parse(String(video));
assert.equal(marker.module, 'NovaFlowAiSequenceMiniMaxH3Workflow');
const sent = await sandbox.fetch('http://127.0.0.1:8189/prompt', { method: 'POST', body: JSON.stringify({ prompt: marker }) });
assert.equal(sent.status, 200);
assert.equal((await sent.json()).prompt_id, 'test-task');
assert.deepEqual(submissions[0].references, []);
const history = await sandbox.fetch('http://127.0.0.1:8189/api/history/test-task');
assert.equal((await history.json())['test-task'].outputs['nf-output'].gifs[0].filename, 'NovaFlow_result-task.mp4');
const binary = await sandbox.electronAPI.runtimeRequestBinary({ path: '/view?filename=NovaFlow_result-task.mp4' });
assert.equal(binary.dataBase64, 'AQID');
assert.equal(binary.contentType, 'video/mp4');
assert.equal(warehouseFiles.at(-1).name, 'NovaFlow_result-task.mp4');
assert.deepEqual([...new Uint8Array(await warehouseFiles.at(-1).blob.arrayBuffer())], [1, 2, 3]);
const direct = await sandbox.fetch('http://127.0.0.1:8189/view?filename=NovaFlow_result-task.mp4&type=output');
assert.deepEqual([...new Uint8Array(await direct.arrayBuffer())], [1, 2, 3]);
assert.equal((await sandbox.fetch('http://127.0.0.1:8189/object_info')).status, 503);
runInContext(await readFile(new URL('ai-sequence-minimax-h3-output.resource.js', web), 'utf8'), context);
const outputResource = sandbox.NovaFlowAiSequenceMiniMaxH3OutputResource;
const published = await outputResource.publish({ promptId: 'test-task', filename: 'NovaFlow_result-task.mp4', type: 'output' });
assert.ok(published.objectUrl.startsWith('blob:'));
assert.equal(published.id, 'test-task:output::NovaFlow_result-task.mp4');
assert.deepEqual([...new Uint8Array(await (await fetch(published.objectUrl)).arrayBuffer())], [1, 2, 3]);
assert.equal((await outputResource.list()).length, 1);
assert.equal((await api.aiSeqReadTempFile({ path: 'C:/private.txt' })).ok, false);
assert.equal((await api.minimaxH3OutputPublish({ promptId: 'other-task', filename: 'NovaFlow_result-task.mp4' })).ok, false);
outputResource.dispose();
await api.runtimeUploadImage({ fileName: 'test.png', dataBase64: 'AQID' });
const cutoutIntent = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'defaultRmbgWorkflow', ['', 'test.png', 'cutout', null]);
await api.runtimeRequestJson({ path: '/prompt', init: { method: 'POST', body: JSON.stringify({ prompt: JSON.parse(String(cutoutIntent)) }) } });
assert.deepEqual(submissions[1].references.map(ref => ref.name), ['test.png']);
// 一键拆图: the See-through graph is replayed on the compute node with the uploaded source as its
// second positional argument, and the page's upload rides along as the task's reference.
await api.runtimeUploadImage({ fileName: 'split.png', dataBase64: 'AQID' });
const splitSpec = { seed: 7, resolution: 1024, steps: 30, prefix: 'novaflow_spine_1_ab', useLama: true, headLayer: true };
const splitIntent = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'buildSeeThroughSplitWorkflow', ['http://127.0.0.1:8188', 'split.png', splitSpec]);
await api.runtimeRequestJson({ path: '/prompt', init: { method: 'POST', body: JSON.stringify({ prompt: JSON.parse(String(splitIntent)) }) } });
assert.equal(submissions[2].workflow.method, 'buildSeeThroughSplitWorkflow');
assert.deepEqual(submissions[2].references.map(ref => ref.name), ['split.png']);
assert.deepEqual(submissions[2].parameters.__args, ['http://127.0.0.1:8188', 'split.png', splitSpec]);
assert.equal(withReferences({ __args: ['http://127.0.0.1:8188', 'split.png', splitSpec] }, ['nfweb-1-0-split.png'], [{ name: 'split.png' }], 'buildSeeThroughSplitWorkflow').__args[1], 'nfweb-1-0-split.png');

// Invoke the actual art wrapper with the same fixed-seed callback as the UI.
const brand = instrumentModule(await readFile(new URL('novaflow-brand-runtime.js', web), 'utf8'), {
  moduleName: 'browser-art', forceNames: ['buildArtGenerateRunWorkflow', 'buildArtGenerateWorkflowWithSeed']
}).code;
runInContext(brand, context);
const art = sandbox.__nfBuilders['browser-art'];
const built = art.buildArtGenerateWorkflowWithSeed(42, () => art.buildArtGenerateRunWorkflow(
  'local', 'txt2img', [], 'NovaFlow_Test', 'a girl by the sea', '', 'client', [],
  { provider: 'local', mode: 'txt2img', width: 512, height: 512, seed: 42, localTextQuality: 'instant', references: ['PRIVATE_PIXELS'], promptHistory: ['PRIVATE_HISTORY'] }
));
assert.equal(built.workflow.module, 'novaflow-brand-runtime');
assert.equal(built.workflow.fn, 'buildArtGenerateRunWorkflow');
assert.equal(built.workflow.options.__args[8].seed, 42);
assert.ok(!JSON.stringify(built).includes('PRIVATE_'));
const artSent = await sandbox.electronAPI.runtimeRequestJson({ path: '/prompt', init: { method: 'POST', body: JSON.stringify({ prompt: built.workflow }) } });
assert.equal(artSent.data.prompt_id, 'test-task');

const inpaint = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'defaultQwenInpaintWorkflow', [
  'http://127.0.0.1:8188', 'image.png', 'mask.png', 'NovaFlow_Repair', 'repair', { inpaintMode: 'complete' }
]);
const options = JSON.parse(String(inpaint)).options;
const mapped = withReferences(options, ['task-image.png', 'task-mask.png'], [{ name: 'image.png' }, { name: 'mask.png' }], 'defaultQwenInpaintWorkflow');
assert.deepEqual(mapped.__args.slice(1, 5), ['task-image.png', 'task-mask.png', 'NovaFlow_Repair', 'repair']);
assert.throws(() => withReferences(options, [], [], 'defaultQwenInpaintWorkflow'), /uploaded task reference/);
const latentInpaint = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'defaultQwenInpaintWorkflow', [
  'http://127.0.0.1:8188', 'image.png', 'mask.png', 'NovaFlow_Repair', 'repair', { inpaintMode: 'completion', latentInputName: 'latent.png' }
]);
const latentOptions = JSON.parse(String(latentInpaint)).options;
const latentRefs = [{ name: 'image.png' }, { name: 'mask.png' }, { name: 'latent.png' }];
// Smart completion keeps the undug crop this task uploaded, renamed to the task's copy.
const latentMapped = withReferences(latentOptions, ['task-image.png', 'task-mask.png', 'task-latent.png'], latentRefs, 'defaultQwenInpaintWorkflow');
assert.deepEqual(latentMapped.__args.slice(1, 3), ['task-image.png', 'task-mask.png']);
assert.equal(latentMapped.__args[5].latentInputName, 'task-latent.png');
assert.equal(latentMapped.__args[5].inpaintMode, 'completion');
const engineAsked = JSON.parse(JSON.stringify(latentOptions));
engineAsked.__args[5].inpaintEngine = 'qwen-2.1';
assert.equal(withReferences(engineAsked, ['task-image.png', 'task-mask.png'], latentRefs.slice(0, 2), 'defaultQwenInpaintWorkflow').__args[5].inpaintEngine, undefined);
// 局部编辑 keeps its undug crop (renamed to the task's copy); one the task never uploaded is dropped.
const editOptions = JSON.parse(JSON.stringify(latentOptions));
editOptions.__args[5].inpaintMode = 'edit';
assert.equal(withReferences(editOptions, ['task-image.png', 'task-mask.png', 'task-latent.png'], latentRefs, 'defaultQwenInpaintWorkflow').__args[5].latentInputName, 'task-latent.png');
assert.equal(withReferences(editOptions, ['task-image.png', 'task-mask.png'], latentRefs.slice(0, 2), 'defaultQwenInpaintWorkflow').__args[5].latentInputName, undefined);

const host = await createWorkflowHost({ rendererDir: fileURLToPath(new URL('../../worker-renderer/', import.meta.url)), objectInfo: {
  RMBG: { input: { required: { image: ['IMAGE'], model: [['RMBG-2.0']], sensitivity: ['FLOAT', { default: 1 }] } } }
} });
const cutout = await host.buildGraph({ module: 'spine-split-runtime', method: 'defaultRmbgWorkflow', options: { __args: ['', 'task-image.png', 'NovaFlow_Cutout', null] } });
assert.equal(cutout['1'].inputs.image, 'task-image.png');
assert.equal(cutout['2'].class_type, 'RMBG');
await assert.rejects(host.buildGraph({ module: 'spine-split-runtime', method: 'patchWorkflow', options: {} }), /not available/);
// The split graph names the task's copy of the source, carries the page's seed and prefix, and adds
// the whole-head node only where the catalogue has it; without See-through it refuses.
const seeThroughInfo = Object.fromEntries(['SeeThrough_LoadLayerDiffModel', 'SeeThrough_LoadDepthModel', 'SeeThrough_GenerateLayers', 'SeeThrough_GenerateDepth', 'SeeThrough_PostProcess', 'SeeThrough_SavePSD'].map((name) => [name, {}]));
const splitCall = { module: 'spine-split-runtime', method: 'buildSeeThroughSplitWorkflow', options: { __args: ['http://evil.test', 'task-split.png', splitSpec] } };
const rendererDir = fileURLToPath(new URL('../../worker-renderer/', import.meta.url));
const split = await (await createWorkflowHost({ rendererDir, objectInfo: { ...seeThroughInfo, NovaFlowSeeThroughHeadLayer: {} } })).buildGraph(splitCall);
assert.equal(split['1'].inputs.image, 'task-split.png');
assert.equal(split['4'].inputs.seed, 7);
assert.equal(split['8'].inputs.filename_prefix, 'novaflow_spine_1_ab');
assert.equal(split['10'].class_type, 'NovaFlowSeeThroughHeadLayer');
assert.equal(split['10'].inputs.filename_prefix, 'novaflow_spine_1_ab');
assert.equal((await (await createWorkflowHost({ rendererDir, objectInfo: seeThroughInfo })).buildGraph(splitCall))['10'], undefined);
await assert.rejects((await createWorkflowHost({ rendererDir, objectInfo: { RMBG: {} } })).buildGraph(splitCall), /节点未加载/);

// A runtime carrying the Qwen-Image-2.1 weights takes the 2.1 completion graph: latent from the
// undug upload, and a crop that is not a multiple of 32 padded before encoding and cropped back after.
const io = (...names) => Object.fromEntries(names.map((name) => [name, ['*']]));
const qwen21Info = {
  LoadImage: { input: { required: { image: [['x.png']] } } },
  UnetLoaderGGUF: { input: { required: { unet_name: [['qwen-image-2.1-UC-Q8_0.gguf']] } } },
  CLIPLoader: { input: { required: { clip_name: [['qwen3vl_8b_w4a8_heretic.safetensors']], type: [['stable_diffusion', 'qwen_image']] }, optional: { device: [['default', 'cpu']] } } },
  VAELoader: { input: { required: { vae_name: [['qwen_image_2.1_vae_bf16.safetensors']] } } },
  TextEncodeQwenImage21: { input: { required: { ...io('clip', 'prompt', 'negative_prompt'), resolution: ['INT', { default: 1024 }], images: ['COMFY_AUTOGROW_V3', {}] }, optional: io('vae') } },
  QwenImage21Cache: { input: { required: { model: ['MODEL'], device: [['auto', 'cpu']], dtype: [['default', 'int8']] } } },
  VAEEncode: { input: { required: io('pixels', 'vae') } },
  ImageToMask: { input: { required: { image: ['IMAGE'], channel: [['red', 'green', 'blue', 'alpha']] } } },
  SetLatentNoiseMask: { input: { required: io('samples', 'mask') } },
  KSampler: { input: { required: { ...io('model', 'positive', 'negative', 'latent_image', 'seed', 'steps', 'cfg', 'denoise'), sampler_name: [['euler']], scheduler: [['simple']] } } },
  VAEDecode: { input: { required: io('samples', 'vae') } },
  SplitImageWithAlpha: { input: { required: io('image') } },
  InvertMask: { input: { required: io('mask') } },
  ImageCompositeMasked: { input: { required: io('destination', 'source', 'x', 'y', 'resize_source'), optional: io('mask') } },
  ImagePadForOutpaint: { input: { required: io('image', 'left', 'top', 'right', 'bottom', 'feathering') } },
  ImageCrop: { input: { required: io('image', 'width', 'height', 'x', 'y') } },
  MaskComposite: { input: { required: { ...io('destination', 'source', 'x', 'y'), operation: [['multiply', 'add', 'subtract', 'and', 'or', 'xor']] } } },
  ThresholdMask: { input: { required: io('mask', 'value') } },
  EmptyLatentImage: { input: { required: io('width', 'height', 'batch_size') } },
  SaveImage: { input: { required: io('images', 'filename_prefix') } }
};
const host21 = await createWorkflowHost({ rendererDir: fileURLToPath(new URL('../../worker-renderer/', import.meta.url)), objectInfo: qwen21Info });
const completionRoute = { mode: 'completion', provider: 'qwen-completion-v4', workflow: 'qwen', outputMode: 'patch', v4: true };
const build21 = async (inputSize, extra = {}, promptText = 'leg') => {
  const call = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'defaultQwenInpaintWorkflow', [
    'http://127.0.0.1:8188', 'image.png', 'mask.png', 'NovaFlow_Complete', promptText, { inpaintMode: 'completion', route: completionRoute, inpaintEngine: 'qwen-2.1', latentInputName: 'latent.png', inputSize, ...extra }
  ]);
  // The worker never forwards the 2.1 engine choice (see above); the dormant 2.1 completion graph
  // is still built here directly so it keeps working for when it is switched on again.
  const opts = JSON.parse(String(call)).options;
  opts.__args[1] = 'task-image.png';
  opts.__args[2] = 'task-mask.png';
  if (opts.__args[5] && opts.__args[5].latentInputName) opts.__args[5].latentInputName = 'task-latent.png';
  return await host21.buildGraph({ module: 'spine-split-runtime', method: 'defaultQwenInpaintWorkflow', options: opts });
};
// The graph is built inside the host's vm context; bring it into this realm before deep comparisons.
const byClass = (graph, type) => Object.entries(JSON.parse(JSON.stringify(graph))).filter(([, node]) => node.class_type === type);
// Completion runs on 2.1 whatever engine the task names.
assert.equal(byClass(JSON.parse(JSON.stringify(await build21({ width: 450, height: 700 }, { inpaintEngine: '' }))), 'TextEncodeQwenImage21').length, 1);
const g21 = JSON.parse(JSON.stringify(await build21({ width: 450, height: 700 })));
assert.equal(byClass(g21, 'TextEncodeQwenImage21').length, 1);
assert.equal(g21['3'].inputs.image, 'task-latent.png');
const pads = Object.fromEntries(byClass(g21, 'ImagePadForOutpaint').map(([id, node]) => [id, node.inputs]));
assert.equal(Object.keys(pads).length, 3);
for (const pad of Object.values(pads)) assert.deepEqual([pad.left, pad.top, pad.right, pad.bottom, pad.feathering], [0, 0, 30, 4, 0]);
// 智能补图 samples the whole picture on the encoder's latent like 局部编辑 (the page pastes it back
// through the selection): the noise mask drew full legs on 0 of 9 seeds of the user's run, this on 6.
assert.equal(byClass(g21, 'SetLatentNoiseMask').length + byClass(g21, 'VAEEncode').length + byClass(g21, 'MaskComposite').length, 0);
assert.deepEqual(byClass(g21, 'KSampler')[0][1].inputs.latent_image, ['10', 2]);
// The reference is the padded undug crop and the hole is image 2.
assert.deepEqual(pads[g21['10'].inputs['images.image_1'][0]].image, ['3', 0]);
assert.deepEqual(pads[g21['10'].inputs['images.image_2'][0]].image, ['2', 0]);
// Without the undug crop (an older page) completion falls back to the noise mask on the dug plate,
// 1 across the pad strip, not the pad's grey.
{
  const gOld = JSON.parse(JSON.stringify(await build21({ width: 450, height: 700 }, { latentInputName: '' })));
  const oldPads = Object.fromEntries(byClass(gOld, 'ImagePadForOutpaint').map(([id, node]) => [id, node.inputs]));
  const encodeFrom = byClass(gOld, 'VAEEncode')[0][1].inputs.pixels[0];
  assert.deepEqual(oldPads[encodeFrom].image, ['1', 0]);
  assert.deepEqual(gOld['10'].inputs['images.image_1'], [encodeFrom, 0]);
  const noiseMask = gOld[byClass(gOld, 'SetLatentNoiseMask')[0][1].inputs.mask[0]];
  assert.equal(noiseMask.class_type, 'MaskComposite');
  assert.deepEqual([noiseMask.inputs.destination, noiseMask.inputs.operation], [['8', 0], 'add']);
  assert.deepEqual(noiseMask.inputs.source, [gOld['10'].inputs['images.image_2'][0], 1]);
  assert.deepEqual(byClass(gOld, 'KSampler')[0][1].inputs.latent_image, ['9', 0]);
}
const [[cropId, crop]] = byClass(g21, 'ImageCrop');
assert.deepEqual([crop.inputs.width, crop.inputs.height, crop.inputs.x, crop.inputs.y], [450, 700, 0, 0]);
assert.deepEqual(byClass(g21, 'SaveImage')[0][1].inputs.images, [cropId, 0]);
// 局部编辑 samples the whole picture on the encoder's latent (no noise mask; the page pastes it back
// through the selection): the local repaint left the skin under a "戴上墨镜" edit pale and soft.
{
  const editRoute = { mode: 'edit', provider: 'qwen-edit-v5', label: 'Qwen Edit V5', workflow: 'qwen', outputMode: 'patch', qwenControlMode: 1, editV5: true, v4: true };
  const gEdit = JSON.parse(JSON.stringify(await build21({ width: 450, height: 700 }, { inpaintMode: 'edit', route: editRoute }, '戴上墨镜')));
  assert.equal(byClass(gEdit, 'SetLatentNoiseMask').length + byClass(gEdit, 'VAEEncode').length + byClass(gEdit, 'MaskComposite').length, 0);
  const editSampler = byClass(gEdit, 'KSampler')[0][1].inputs;
  assert.deepEqual(editSampler.latent_image, ['10', 2]);
  const editPads = Object.fromEntries(byClass(gEdit, 'ImagePadForOutpaint').map(([id, node]) => [id, node.inputs]));
  // The reference is the padded undug crop, the selection is image 2, and the output is cropped back.
  assert.deepEqual(editPads[gEdit['10'].inputs['images.image_1'][0]].image, ['3', 0]);
  assert.deepEqual(editPads[gEdit['10'].inputs['images.image_2'][0]].image, ['2', 0]);
  assert.match(gEdit['10'].inputs.prompt, /Inside the white area only: 戴上墨镜/);
  const [[editCropId, editCrop]] = byClass(gEdit, 'ImageCrop');
  assert.deepEqual([editCrop.inputs.width, editCrop.inputs.height], [450, 700]);
  assert.deepEqual(byClass(gEdit, 'SaveImage')[0][1].inputs.images, [editCropId, 0]);
  // Without the undug crop (an older page) 局部编辑 falls back to the noise-mask graph on the dug plate.
  const gEditOld = JSON.parse(JSON.stringify(await build21({ width: 450, height: 700 }, { inpaintMode: 'edit', route: editRoute, latentInputName: '' }, '戴上墨镜')));
  assert.equal(byClass(gEditOld, 'SetLatentNoiseMask').length, 1);
}
const g21Aligned = JSON.parse(JSON.stringify(await build21(undefined)));
assert.equal(byClass(g21Aligned, 'ImagePadForOutpaint').length + byClass(g21Aligned, 'ImageCrop').length + byClass(g21Aligned, 'MaskComposite').length, 0);
assert.deepEqual(g21Aligned['10'].inputs['images.image_1'], ['3', 0]);
assert.deepEqual(byClass(g21Aligned, 'KSampler')[0][1].inputs.latent_image, ['10', 2]);
// The 2.1 prompt is built from the user's words and the part guidance, never from the 2509 template's
// "Transparent background." line; a merged prompt without the parts loses that line.
const promptOf = (graph) => byClass(graph, 'TextEncodeQwenImage21')[0][1].inputs.prompt;
// Local txt2img / img2img switch to Qwen-Image-2.1 on a compute node that carries it.
const buildArt = async (mode, refs, sizes, extraState = {}) => JSON.parse(JSON.stringify(await host21.buildGraph({ module: 'novaflow-brand-runtime', method: 'buildArtGenerateRunWorkflow', options: { __args: [
  'local', mode, refs, 'NovaFlow_Art', 'a swordswoman in red', '', 'client', sizes, { provider: 'local', mode, width: 900, height: 1300, seed: 42, randomSeed: false, localDrawEngine: extraState.nsfw ? '' : 'qwen-2.1', ...extraState }, 4, {}
] } })));
const t2i = await buildArt('txt2img', [], []);
assert.equal(byClass(t2i, 'TextEncodeQwenImage21').length, 1);
const t2iLatent = byClass(t2i, 'EmptyLatentImage')[0][1].inputs;
assert.deepEqual([t2iLatent.width, t2iLatent.height], [896, 1312]);
const t2iSampler = byClass(t2i, 'KSampler')[0][1].inputs;
// The model card's 40 steps; CFG 1 with no negative prompt of the user's own.
assert.deepEqual([t2iSampler.seed, t2iSampler.steps, t2iSampler.cfg], [42, 40, 1]);
assert.equal(byClass(t2i, 'SaveImage')[0][1].inputs.filename_prefix, 'NovaFlow_Art');
// W / H on reference 1's size (as a new reference 1 fills them): an edit on the encoder's own latent.
const i2i = await buildArt('img2img', ['ref.png'], [{ width: 624, height: 1360 }], { width: 624, height: 1360 });
const i2iEncode = byClass(i2i, 'TextEncodeQwenImage21')[0][1].inputs;
// Reference 1 is put on the 32 grid by the graph (624 x 1360 -> 640 x 1376), the output scaled back.
const i2iFirst = i2i[i2iEncode['images.image_1'][0]];
assert.deepEqual([i2iFirst.class_type, i2iFirst.inputs.width, i2iFirst.inputs.height], ['ImageScale', 640, 1376]);
assert.equal(i2i[i2iFirst.inputs.image[0]].inputs.image, 'ref.png');
assert.equal(i2iEncode.resolution, 0);
assert.deepEqual(byClass(i2i, 'KSampler')[0][1].inputs.latent_image[1], 2);
// Another aspect (900 x 1300 here) is sampled on an empty latent of that size; a large reference 1 is
// brought to ~1 MP by the graph instead of the encoder's resolution setting.
const i2iRelayout = await buildArt('img2img', ['big.png'], [{ width: 2048, height: 2048 }]);
const relayoutEncode = byClass(i2iRelayout, 'TextEncodeQwenImage21')[0][1].inputs;
assert.equal(relayoutEncode.resolution, 0);
const relayoutFirst = i2iRelayout[relayoutEncode['images.image_1'][0]].inputs;
assert.ok(relayoutFirst.width * relayoutFirst.height <= 1048576);
assert.equal(i2iRelayout[byClass(i2iRelayout, 'KSampler')[0][1].inputs.latent_image[0]].class_type, 'EmptyLatentImage');
assert.equal(byClass(await buildArt('img2img', ['ref.png'], [], { nsfw: true }), 'TextEncodeQwenImage21').length, 0);
const template = ['User instruction, highest priority:', '补全腿部', '', 'Complete the masked missing area.', 'Transparent background.', '', 'Original protective context:', 'leg'].join(String.fromCharCode(10));
const withParts = promptOf(JSON.parse(JSON.stringify(await build21(undefined, { promptParts: { user: '补全腿部，赤脚', part: 'Extend the leg.' } }, template))));
// The user's own words lead (with the bare-feet rule they trigger); the layer's part guidance is only
// used when the user wrote nothing.
assert.ok(withParts.includes('补全腿部，赤脚') && withParts.includes('bare feet') && !withParts.includes('Extend the leg.'));
assert.ok(promptOf(JSON.parse(JSON.stringify(await build21(undefined, { promptParts: { user: '', part: 'Extend the leg.' } }, template)))).includes('Extend the leg.'));
assert.ok(!/Transparent background|Complete the masked missing area/.test(withParts));
const merged = promptOf(JSON.parse(JSON.stringify(await build21(undefined, {}, template))));
assert.ok(merged.includes('Complete the masked missing area.') && !/Transparent background/.test(merged));
// ---- the rest of the art builders. A catalogue-first builder gets this node's catalogue in place of the
// empty object the page recorded; uploads are renamed wherever the recorded arguments put them; and a
// graph may load only this task's files.
const nodeWith = (...keys) => ({ input: { required: Object.fromEntries(keys.map((key) => [key, ['*']])) } });
const catalogueOf = (...names) => Object.fromEntries(names.map((name) => [name, nodeWith()]));
const upscaleHost = await createWorkflowHost({ rendererDir, objectInfo: {
  ...catalogueOf('LoadImage', 'SaveImage'),
  SeedVR2LoadDiTModel: nodeWith('model', 'device'),
  SeedVR2LoadVAEModel: nodeWith('model', 'device'),
  SeedVR2VideoUpscaler: nodeWith('image', 'dit', 'vae', 'seed', 'resolution', 'max_resolution')
} });
const upscale = await upscaleHost.buildGraph({ module: 'spine-split-runtime', method: 'buildSeedVr2ImageUpscaleWorkflow', options: { __args: [{}, 'task-up.png', 'novaflow_upscale_1', { resolution: 1080, maxResolution: 2048 }] } });
assert.equal(upscale['1'].inputs.image, 'task-up.png');
assert.equal(upscale['5'].class_type, 'SeedVR2VideoUpscaler');
assert.equal(upscale['5'].inputs.resolution, 1080);
assert.equal(upscale['6'].inputs.filename_prefix, 'novaflow_upscale_1');
// Without the nodes the builder refuses on the node, with its own message.
await assert.rejects(host.buildGraph({ module: 'spine-split-runtime', method: 'buildSeedVr2ImageUpscaleWorkflow', options: { __args: [{}, 'task-up.png', 'p', {}] } }), /SeedVR2/);
// SAM: the page sends the point prompts it read off the stroke; the node picks a model size it has.
const samHost = await createWorkflowHost({ rendererDir, objectInfo: {
  ...catalogueOf('LoadImage', 'SAM Parameters', 'SAM Image Mask', 'JoinImageWithAlpha', 'SaveImage'),
  'SAM Model Loader': { input: { required: { model_size: [['ViT-B', 'ViT-L']] } } }
} });
const sam = await samHost.buildGraph({ module: 'spine-split-runtime', method: 'samPointWorkflowFromPrompts', options: { __args: [{}, 'task-sam.png', 'novaflow_sam_1', { points: [[10, 20], [30, 40]], labels: [1, 1] }, { modelSize: 'ViT-H' }] } });
assert.equal(sam['1'].inputs.image, 'task-sam.png');
assert.equal(sam['2'].inputs.model_size, 'ViT-L');
assert.deepEqual(sam['3'].inputs.points, [[10, 20], [30, 40]]);
assert.equal(sam['5'].class_type, 'JoinImageWithAlpha');
// 万物迁移: the runtime the page "resolved" is a marker string here; the node resolves against its own
// catalogue, and both uploads are renamed inside the object argument.
const transferArgs = withReferences(
  { __args: [{}, { placementName: 'run_placement.png', referenceName: 'run_scene.png' }, 'run_1', '{"__novaflowServerOnly":true}', 'prompt', { steps: 8, cfg: 1 }] },
  ['nfweb-1-0-run_placement.png', 'nfweb-1-1-run_scene.png'], [{ name: 'run_placement.png' }, { name: 'run_scene.png' }], 'buildObjectTransferQwen21Workflow'
).__args;
assert.deepEqual(transferArgs[1], { placementName: 'nfweb-1-0-run_placement.png', referenceName: 'nfweb-1-1-run_scene.png' });
const transferHost = await createWorkflowHost({ rendererDir, objectInfo: { ...qwen21Info, SplitImageWithAlpha: nodeWith('image'), SaveImage: nodeWith('filename_prefix', 'images') } });
const transfer = await transferHost.buildGraph({ module: 'spine-split-runtime', method: 'buildObjectTransferQwen21Workflow', options: { __args: transferArgs } });
assert.equal(transfer['1'].inputs.image, 'nfweb-1-0-run_placement.png');
assert.equal(transfer['2'].inputs.image, 'nfweb-1-1-run_scene.png');
assert.equal(transfer['4'].inputs.unet_name, 'qwen-image-2.1-UC-Q8_0.gguf');
assert.equal(Object.values(transfer).find((node) => node.class_type === 'SaveImage').inputs.filename_prefix, 'run_1');
// The guard: a graph that names a file this task did not upload is refused.
assertGraphLoadsTaskInputs(transfer, ['nfweb-1-0-run_placement.png', 'nfweb-1-1-run_scene.png']);
assert.throws(() => assertGraphLoadsTaskInputs(transfer, ['nfweb-1-0-run_placement.png']), /did not upload/);

runInContext(await readFile(new URL('novaflow-web-capabilities.js', web), 'utf8'), context);
const cached = await sandbox.electronAPI.aiSeqCacheTempFile({ fileName: 'result.png', cacheKey: 'art-output', bytes: new Uint8Array([4, 5, 6]) });
assert.ok(cached.ok && cached.path.startsWith('blob:'));
assert.equal(cached.bytes, 3);
assert.deepEqual([...new Uint8Array(await (await fetch(cached.path)).arrayBuffer())], [4, 5, 6]);
await sandbox.electronAPI.aiSeqCacheReleaseOutput({ key: 'art-output' });
await assert.rejects(fetch(cached.path));
console.log(checks + ' passed, 0 failed: shipped image/video contracts, art intent, positional references and worker cutout');
