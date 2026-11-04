import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import { prepareComputeRenderer } from '../../tools/prepare-compute-renderer.mjs';
import { redactModule } from '../../tools/redact-workflow-module.mjs';
import { instrumentModule } from '../../tools/instrument-workflow-module.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { withReferences, qwenEditLoraAvailable } from '../../worker/src/worker-core.mjs';
import { workflowModelId, allWorkflowEntryMethods, QWEN21_EDIT_LORA_CAPABILITY } from '../../packages/shared/src/workflow-modules.mjs';

const target = 'qwen/qwen2_1-femaledVaginus-nsfw-v1_3-fine_L22-31.safetensors';
const choice = (key, values) => ({ input: { required: { [key]: [values] } } });
const empty = { input: { required: {} } };
const info = {
  NovaFlowGGUFBF16Loader: choice('unet_name', ['Qwen-Image-2.1-Turbo-BF16.gguf']),
  CLIPLoader: choice('clip_name', ['qwen3vl_8b_bf16_heretic.safetensors']),
  VAELoader: choice('vae_name', ['qwen_image_2.1_vae_bf16.safetensors']),
  LoraLoaderModelOnly: choice('lora_name', [target, 'qwen/style.safetensors']),
  ...Object.fromEntries(['TextEncodeQwenImage21','VAEEncode','SetLatentNoiseMask','ImageToMask','KSampler',
    'SplitImageWithAlpha','InvertMask','ImageCompositeMasked','ImagePadForOutpaint','ImageCrop','MaskComposite',
    'QwenImage21Cache','VAEDecode','SaveImage','LoadImage'].map(name => [name, empty])),
  KSampler: { input: { required: Object.fromEntries(['model','positive','negative','latent_image','seed','steps','cfg','sampler_name','scheduler','denoise'].map(name => [name, ['ANY']])) } },
  QwenImage21Cache: { input: { required: Object.fromEntries(['model','device','dtype'].map(name => [name, ['ANY']])) } }
};
const dir = await mkdtemp(join(tmpdir(), 'foart-inpaint-nsfw-'));
try {
  await test('editor switch enables only the adapter and leaves the edit mode intact', async () => {
    const source = await readFile(new URL('../../renderer/spine-split-runtime.js', import.meta.url), 'utf8');
    const setter = source.match(/  function setSelectionInpaintNsfwEnabled\(enabled\) \{[\s\S]*?\n  \}/)?.[0];
    const title = source.match(/  function selectionInpaintNsfwTitle\(enabled\) \{[\s\S]*?\n  \}/)?.[0];
    assert(setter && title);
    const context = { state:{busy:false,selectionTool:{active:true,mode:'inpaint',inpaintMode:'edit',inpaintNsfwEnabled:false,inpaintFluxEnabled:true}}, refreshSelectionToolSurface() {}, setInpaintDebugAttr() {}, normalizeSelectionInpaintMode: x => x, selectionInpaintNsfwAvailable: x => ['edit','completion'].includes(x) };
    runInNewContext(`${setter}\n${title}\nsetSelectionInpaintNsfwEnabled(true)`, context);
    assert.equal(context.state.selectionTool.inpaintNsfwEnabled, true);
    assert.equal(context.state.selectionTool.inpaintMode, 'edit');
    assert.equal(context.state.selectionTool.inpaintFluxEnabled, false);
    assert.match(runInNewContext('selectionInpaintNsfwTitle(false)', context), /不切换底模/);
    runInNewContext('setSelectionInpaintNsfwEnabled(false)', context);
    assert.equal(context.state.selectionTool.inpaintNsfwEnabled, false);
    assert.match(source, /nsfwButton\.disabled = state\.busy/);
    assert.match(source, /title: selectionInpaintNsfwTitle\(inpaintNsfwEnabled\),\s*disabled: state\.busy/);
  });
  await prepareComputeRenderer({ outputDir: dir });
  const host = await createWorkflowHost({ rendererDir: dir, objectInfo: info });
  const build = (options, h = host, method = 'defaultQwenInpaintWorkflow') => h.buildGraph({ module: 'spine-split-runtime', method, options: {
    __args: ['', 'a.png', 'mask.png', 'out', 'clear detail', options]
  } });
  const nodes = graph => Object.values(graph);
  const loras = graph => nodes(graph).filter(node => node.class_type === 'LoraLoaderModelOnly');
  await test('edit uses its existing Qwen 2.1 base and only adds LoRA when enabled', async () => {
    const normal = await build({ inpaintMode:'edit', inpaintProvider:false, seed:1 });
    const enabled = await build({ inpaintMode:'edit', inpaintProvider:true, seed:1 }, host, 'defaultQwenLoraInpaintWorkflow');
    assert.equal(loras(normal).length, 0);
    assert.equal(loras(enabled).length, 1);
    assert.equal(loras(enabled)[0].inputs.lora_name, target);
    assert.equal(loras(enabled)[0].inputs.strength_model, 1);
    for (const graph of [normal, enabled]) {
      assert(nodes(graph).some(node => node.class_type === 'NovaFlowGGUFBF16Loader' && node.inputs.unet_name === 'Qwen-Image-2.1-Turbo-BF16.gguf'));
      assert(!nodes(graph).some(node => node.class_type === 'CheckpointLoaderSimple'));
    }
  });
  await test('manual adapters are retained and the same target is never added twice', async () => {
    const selected = [{ name:target, strength:0.35 }, { name:'qwen/style.safetensors', strength:0.7 }];
    const before = JSON.stringify(selected);
    const graph = await build({ inpaintMode:'edit', inpaintProvider:true, seed:1, loras:selected }, host, 'defaultQwenLoraInpaintWorkflow');
    assert.equal(JSON.stringify(selected), before);
    assert.equal(loras(graph).length, 2);
    assert.equal(loras(graph).find(node => node.inputs.lora_name === target).inputs.strength_model, 0.35);
    assert.equal(loras(graph).find(node => node.inputs.lora_name === 'qwen/style.safetensors').inputs.strength_model, 0.7);
  });
  await test('missing target and retired routes fail before a graph is returned', async () => {
    const noTarget = await createWorkflowHost({ rendererDir: dir, objectInfo:{ ...info, LoraLoaderModelOnly:choice('lora_name',[]) } });
    await assert.rejects(build({ inpaintMode:'edit', inpaintProvider:true }, noTarget, 'defaultQwenLoraInpaintWorkflow'));
    for (const inpaintMode of ['edit','repair']) {
      await assert.rejects(build({ inpaintMode, inpaintProvider:'qwen-rapid-aio-nsfw-v20' }), /NSFW/);
    }
    await assert.rejects(build({ inpaintMode:'edit', route:{mode:'edit',workflow:'rapid-aio-nsfw'} }), /NSFW/);
  });
  await test('web task is routed to a versioned capability and the worker remaps only uploaded inputs', async () => {
    const method = 'defaultQwenLoraInpaintWorkflow';
    const options = { __args: ['', 'a.png', 'mask.png', 'out', 'clear detail', { inpaintMode:'edit', inpaintProvider:true, latentInputName:'latent.png' }] };
    assert.equal(workflowModelId('spine-split-runtime', options, method), QWEN21_EDIT_LORA_CAPABILITY);
    assert.notEqual(workflowModelId('spine-split-runtime', options, 'defaultQwenInpaintWorkflow'), QWEN21_EDIT_LORA_CAPABILITY);
    const refs = ['a.png','mask.png','latent.png'].map(name => ({name}));
    const mapped = withReferences(options, ['task-a.png','task-mask.png','task-latent.png'], refs, method);
    assert.equal(mapped.__args[1], 'task-a.png');
    assert.equal(mapped.__args[2], 'task-mask.png');
    assert.equal(mapped.__args[5].latentInputName, 'task-latent.png');
    const graph = await host.buildGraph({module:'spine-split-runtime',method,options:mapped});
    assert.equal(loras(graph).length, 1);
    assert.equal(loras(graph)[0].inputs.lora_name, target);
    assert.throws(() => withReferences(options, [], [], method), /uploaded task reference/);
    await assert.rejects(build({inpaintMode:'edit',inpaintProvider:false}, host, method), /路由无效/);
  });
  await test('worker advertises the editing capability only for the verified Turbo adapter', async () => {
    let calls = 0;
    const catalog = { async read(kind, options) { calls++; assert.equal(kind, 'qwen'); assert.equal(options.modelName, 'Qwen-Image-2.1-Turbo-BF16.gguf'); return {ok:true, items:[{name:target.replaceAll('/','\\')}]}; } };
    assert.equal(await qwenEditLoraAvailable(false, catalog), false);
    assert.equal(calls, 0);
    assert.equal(await qwenEditLoraAvailable(true, catalog), true);
    assert.equal(await qwenEditLoraAvailable(true, {read:async()=>({ok:true,items:[]})}), false);
    assert.equal(await qwenEditLoraAvailable(true, {read:async()=>{throw new Error('incompatible');}}), false);
  });
  await test('actual web-redacted edit bridge records the new builder and the node builds its graph', async () => {
    const source = await readFile(new URL('../../renderer/spine-split-runtime.js', import.meta.url), 'utf8');
    const redacted = redactModule(source, { moduleName:'spine-split-runtime', forceNames:allWorkflowEntryMethods(),
      replacement: fn => `\n return globalThis.NovaFlowWebRuntime.serverOnly('spine-split-runtime', ${JSON.stringify(fn)}, arguments);\n` });
    assert(redacted.redacted.includes('defaultQwenLoraInpaintWorkflow'));
    const instrumented = instrumentModule(redacted.code, {moduleName:'browser-split', forceNames:['defaultAiRetouchWorkflow']});
    const sandbox = createDomSandbox({NovaFlowWebRuntime:{serverOnly:(module,method,args)=>({module,method,options:{__args:Array.from(args)}})}});
    runInContext(instrumented.code, createContext(sandbox));
    const routeSource = source.match(/  function resolveInpaintWorkflowRoute\(mode, provider\) \{[\s\S]*?\n  \}/)?.[0];
    assert(routeSource);
    const routeContext = {normalizeSelectionInpaintMode:x=>x, selectionInpaintNsfwAvailable:x=>['edit','completion'].includes(x), QWEN21_REMOVAL_PROVIDER:'removal', FLUX_COMPLETION_PROVIDER:'flux'};
    const route = runInNewContext(`${routeSource}\nresolveInpaintWorkflowRoute('edit', true)`, routeContext);
    assert.equal(route.nsfw, true);
    const call = await sandbox.__nfBuilders['browser-split'].defaultAiRetouchWorkflow('', 'a.png', 'mask.png', 'out', 'clear detail', {route, inpaintMode:'edit'});
    assert.equal(call.method, 'defaultQwenLoraInpaintWorkflow');
    assert.equal(workflowModelId(call.module, call.options, call.method), QWEN21_EDIT_LORA_CAPABILITY);
    const mapped = withReferences(call.options, ['task-a.png','task-mask.png'], [{name:'a.png'},{name:'mask.png'}], call.method);
    const graph = await host.buildGraph({module:call.module,method:call.method,options:mapped});
    assert.equal(loras(graph).length, 1);
    assert.equal(loras(graph)[0].inputs.lora_name, target);
  });
} finally {
  await rm(dir, { recursive:true, force:true });
}
