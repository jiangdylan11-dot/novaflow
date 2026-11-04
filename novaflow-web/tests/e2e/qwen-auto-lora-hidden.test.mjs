import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import { createControlPlane } from '../../packages/shared/src/control-plane.mjs';
import { base64UrlJson, hmacSha256 } from '../../packages/shared/src/tokens.mjs';
import { prepareComputeRenderer } from '../../tools/prepare-compute-renderer.mjs';
import { redactModule } from '../../tools/redact-workflow-module.mjs';
import { instrumentModule } from '../../tools/instrument-workflow-module.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { withReferences } from '../../worker/src/worker-core.mjs';
import { workflowModelId, allWorkflowEntryMethods, QWEN21_EDIT_LORA_CAPABILITY } from '../../packages/shared/src/workflow-modules.mjs';

const target = 'qwen/qwen2_1-femaledVaginus-nsfw-v1_3-fine_L22-31.safetensors';
const uc = 'qwen/qwen-image-2.1-uncensored-lora.safetensors';
const other = 'qwen/other-style.safetensors';
const token = 'qwen21-nsfw-lora-v1';
const features = {qwen21_nsfw_lora:true,qwen21_uc_lora:true};
const loraSource = await readFile(new URL('../../renderer/art-generate-lora.js', import.meta.url), 'utf8');

class FakeElement {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.style = {}; this.children = []; this.handlers = {}; this.attributes = {}; this.isConnected = true; this.value = ''; this._text = ''; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  appendChild(n) { this.children.push(n); return n; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
}
const allNodes = root => [root, ...root.children.flatMap(allNodes)];
function harness(mode, { oldCache = false, selected = [], source = loraSource } = {}) {
  const doc = { createElement: tag => new FakeElement(tag, doc) };
  const host = doc.createElement('main');
  const store = new Map();
  if (oldCache) store.set('nf_art_lora_catalog_v1', JSON.stringify({[`local:${mode}:false:true`]: {names:[target, other, uc], at:Date.now()}}));
  const localStorage = {getItem:k=>store.get(k) ?? null, setItem:(k,v)=>store.set(k,String(v))};
  const context = createContext({console, localStorage}); context.globalThis = context;
  runInContext(source, context);
  const state = {provider:'local', mode, nsfw:false, loras:selected.map(x=>({...x}))};
  const api = context.NovaFlowArtGenerateLora;
  let response = {ok:true, features, items:[{name:target,autoManaged:token},{name:uc,autoManaged:'qwen21-uc-lora-v1'},{name:other}]};
  const options = {host,state,loadCatalog:async()=>response};
  const select = () => allNodes(host).find(node=>node.tagName==='SELECT');
  const optionValues = () => select()?.children.map(n=>n.value).filter(Boolean) || [];
  return {api,state,host,options,select,optionValues,setResponse:v=>{response=v}};
}
const flush = async () => { for(let n=0;n<5;n++) await new Promise(resolve=>setTimeout(resolve,0)); };

test('control catalog marks both managed Qwen 2.1 adapters and leaves the ordinary LoRA selectable', async () => {
  const secret='isolated-only-secret', encoded=base64UrlJson({sub:'synthetic',exp:Math.floor(Date.now()/1000)+120});
  const bearer='nfs_'+encoded+'.'+await hmacSha256(encoded,secret);
  const row={detail:{lora_catalog:{version:1,updated_at:new Date().toISOString(),qwen21:{ok:true,items:[{name:target},{name:other},{name:uc}]}}}};
  const store={getUserById:async()=>({id:'synthetic',status:'active',plan:'free'}),listCapableModelDetails:async()=>[row]};
  const plane=createControlPlane({store,secrets:{sessionSecret:secret,controlSecret:'isolated'}});
  for(const variant of [undefined,'turbo']) {
    const response=await plane.handle({method:'GET',path:'/api/web/loras/qwen',query:{engine:'qwen-2.1',...(variant?{variant}:{})},headers:{authorization:'Bearer '+bearer}});
    assert.equal(response.status,200); assert.deepEqual(response.body.features,features);
    assert.deepEqual(response.body.items.map(x=>x.name),[target,other,uc]);
    assert.equal(response.body.items[0].autoManaged,token);
    assert.equal(Object.hasOwn(response.body.items[1],'autoManaged'),false);
    assert.equal(response.body.items[2].autoManaged,'qwen21-uc-lora-v1');
    assert(!JSON.stringify(response.body.items).includes('E:\\\\'));
  }
});

test('redacted website preserves metadata-based filtering without exposing a model filename', async () => {
  const replacement=fn=>fn==='catalogFromInfo'
    ? '\n    if (!info?.ok || !Array.isArray(info.items)) throw new Error(info?.error || "读取兼容 LoRA 失败");\n    return info.items.map(item => item.name).filter(isSelectable);\n  '
    : `\n    return globalThis.NovaFlowWebRuntime.serverOnly('art-generate-lora', ${JSON.stringify(fn)}, arguments);\n  `;
  const built=redactModule(loraSource,{moduleName:'art-generate-lora',forceNames:allWorkflowEntryMethods().filter(name=>name!=='buildArtGenerateRunWorkflow'),replacement});
  assert(!built.code.includes(target) && !built.code.includes(uc),'public browser code must not embed managed model filenames');
  const h=harness('txt2img',{source:built.code});
  h.api.mount(h.options); h.api.setConnection(true,'redacted-test'); await flush();
  assert.deepEqual(h.optionValues(),[other]);
  assert.equal(h.api.verifiedNsfwName({ok:true,features,items:[]}),token);
  assert.throws(()=>h.api.verifiedNsfwName({ok:true,features:{qwen21_nsfw_lora:true},items:[]}),/缺少/);
  const legacyItems = [{name:target,autoManaged:token},{name:uc.replaceAll('/', '\\')},{name:other}];
  assert.equal(h.api.verifiedNsfwName({ok:true,features:{qwen21_nsfw_lora:true},items:legacyItems}),token);
  assert.throws(()=>h.api.verifiedNsfwName({ok:true,features:{qwen21_nsfw_lora:true,qwen21_uc_lora:false},items:legacyItems}),/缺少/);
  h.setResponse({ok:true,features:{qwen21_nsfw_lora:true},items:legacyItems});
  h.api.setConnection(true,'legacy-control'); await flush();
  assert.deepEqual(h.optionValues(),[other]);
});

for (const mode of ['txt2img','img2img']) test(`${mode}: only ordinary choices hide target; legacy selected item and switch behavior remain`, async () => {
  const h=harness(mode,{selected:[{name:target,strength:.35,enabled:true}]});
  h.api.mount(h.options); h.api.setConnection(true,'synthetic'); await flush();
  assert.deepEqual(h.optionValues(),[other]);
  assert.deepEqual(h.state.loras,[{name:target,strength:.35,enabled:true}]);
  assert(h.host.textContent.includes('qwen2_1-femaledVaginus'));
  assert.equal(h.api.verifiedNsfwName({ok:true,features,items:[]}),token);
  const on=Array.from(h.api.effectiveSelection({...h.state,nsfwLoraEnabled:true,nsfwLoraName:token}));
  assert.equal(on.length,2); assert.equal(on[0].name,uc); assert.equal(on[1].name,target); assert.equal(on[1].strength,.35);
  const off=Array.from(h.api.effectiveSelection({...h.state,nsfwLoraEnabled:false}));
  assert.equal(off.length,1); assert.equal(off[0].name,target); assert.equal(off[0].strength,.35);
  const noManual=Array.from(h.api.effectiveSelection({...h.state,loras:[],nsfwLoraEnabled:true,nsfwLoraName:token}));
  assert.equal(noManual.length,2); assert.equal(noManual[0].name,uc); assert.equal(noManual[1].name,target); assert.equal(noManual[1].strength,1);
  const manualUc=Array.from(h.api.effectiveSelection({...h.state,loras:[{name:uc,strength:.5}],nsfwLoraEnabled:true,nsfwLoraName:token}));
  assert.equal(manualUc.filter(item=>item.name===uc).length,1);
  assert.equal(manualUc.find(item=>item.name===uc).strength,.5);
  assert.throws(()=>h.api.verifiedNsfwName({ok:true,features:{qwen21_nsfw_lora:false},items:[]}),/不兼容|缺少/);
});

test('stale pre-marker cache and old server keep unrelated choices and a legacy selection', async () => {
  const empty=harness('img2img',{oldCache:true});
  empty.api.mount(empty.options);
  assert(empty.optionValues().includes(other),'an unrelated cached LoRA remains available before refresh');
  assert(!empty.optionValues().includes(uc),'the managed UC adapter is hidden even in a cached list');
  empty.select().value=other;
  empty.select().handlers.change();
  assert(empty.state.loras.some(x=>x.name===other),'an unrelated cached LoRA can actually be selected');
  const h=harness('txt2img',{oldCache:true,selected:[{name:target,strength:.7,enabled:true}]});
  h.api.mount(h.options);
  assert(h.optionValues().includes(other),'other cached LoRAs remain selectable while metadata is unavailable');
  h.setResponse({ok:true,features:{qwen21_nsfw_lora:true},items:[{name:target},{name:other}]});
  h.api.setConnection(true,'old-server'); await flush();
  assert(h.optionValues().includes(other),'old control plane must not disable unrelated LoRAs');
  assert.match(h.host.textContent,/目录待更新/);
  assert(h.state.loras.some(x=>x.name===target && x.strength===.7));
  h.setResponse({ok:true,features:{qwen21_nsfw_lora:true},items:[{name:target,autoManaged:token},{name:other}]});
  h.api.setConnection(false); h.api.setConnection(true,'updated-server'); await flush();
  assert.deepEqual(h.optionValues(),[other]);
  assert(h.state.loras.some(x=>x.name===target && x.strength===.7));
});

test('redacted web edit bridge keeps a legacy manual target at its strength only once in worker graph', async () => {
  const source=await readFile(new URL('../../renderer/spine-split-runtime.js',import.meta.url),'utf8');
  const redacted=redactModule(source,{moduleName:'spine-split-runtime',forceNames:allWorkflowEntryMethods(),replacement:fn=>`\n return globalThis.NovaFlowWebRuntime.serverOnly('spine-split-runtime', ${JSON.stringify(fn)}, arguments);\n`});
  const instrumented=instrumentModule(redacted.code,{moduleName:'browser-split',forceNames:['defaultAiRetouchWorkflow']});
  const sandbox=createDomSandbox({NovaFlowWebRuntime:{serverOnly:(module,method,args)=>({module,method,options:{__args:Array.from(args)}})}});
  runInContext(instrumented.code,createContext(sandbox));
  const routeSource=source.match(/  function resolveInpaintWorkflowRoute\(mode, provider\) \{[\s\S]*?\n  \}/)?.[0]; assert(routeSource);
  const route=runInNewContext(`${routeSource}\nresolveInpaintWorkflowRoute('edit', true)`,{normalizeSelectionInpaintMode:x=>x,selectionInpaintNsfwAvailable:x=>['edit','completion'].includes(x),QWEN21_REMOVAL_PROVIDER:'removal',FLUX_COMPLETION_PROVIDER:'flux'});
  const call=await sandbox.__nfBuilders['browser-split'].defaultAiRetouchWorkflow('', 'a.png','mask.png','out','synthetic prompt',{route,inpaintMode:'edit',loras:[{name:target,strength:.35},{name:other,strength:.7}]});
  assert.equal(call.method,'defaultQwenLoraInpaintWorkflow');
  assert.equal(workflowModelId(call.module,call.options,call.method),QWEN21_EDIT_LORA_CAPABILITY);
  const choice=(key,values)=>({input:{required:{[key]:[values]}}}), empty={input:{required:{}}};
  const info={NovaFlowGGUFBF16Loader:choice('unet_name',['Qwen-Image-2.1-Turbo-BF16.gguf']),CLIPLoader:choice('clip_name',['qwen3vl_8b_bf16_heretic.safetensors']),VAELoader:choice('vae_name',['qwen_image_2.1_vae_bf16.safetensors']),LoraLoaderModelOnly:choice('lora_name',[target,other,uc].map(name=>name.replaceAll('/','\\'))),...Object.fromEntries(['TextEncodeQwenImage21','VAEEncode','SetLatentNoiseMask','ImageToMask','SplitImageWithAlpha','InvertMask','ImageCompositeMasked','ImagePadForOutpaint','ImageCrop','MaskComposite','VAEDecode','SaveImage','LoadImage'].map(name=>[name,empty])),QwenImage21Cache:{input:{required:Object.fromEntries(['model','device','dtype'].map(name=>[name,['ANY']]))}},KSampler:{input:{required:Object.fromEntries(['model','positive','negative','latent_image','seed','steps','cfg','sampler_name','scheduler','denoise'].map(name=>[name,['ANY']]))}}};
  const dir=await mkdtemp(join(tmpdir(),'foart-hidden-lora-'));
  try {
    await prepareComputeRenderer({outputDir:dir});
    const host=await createWorkflowHost({rendererDir:dir,objectInfo:info});
    const mapped=withReferences(call.options,['task-a.png','task-mask.png'],[{name:'a.png'},{name:'mask.png'}],call.method);
    const graph=await host.buildGraph({module:call.module,method:call.method,options:mapped});
    const loras=Object.values(graph).filter(node=>node.class_type==='LoraLoaderModelOnly');
    assert.equal(loras.filter(n=>n.inputs.lora_name===uc && n.inputs.strength_model===1).length,1);
    assert.equal(loras.filter(n=>n.inputs.lora_name===target).length,1);
    assert.equal(loras.find(n=>n.inputs.lora_name===target).inputs.strength_model,.35);
    assert.equal(loras.find(n=>n.inputs.lora_name===other).inputs.strength_model,.7);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
