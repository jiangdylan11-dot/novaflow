import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createControlPlane } from '../../packages/shared/src/control-plane.mjs';
import { base64UrlJson, hmacSha256 } from '../../packages/shared/src/tokens.mjs';
import { createWorkerLoraCatalog } from '../../worker/src/models/lora-catalog.mjs';

const root = new URL('../../', import.meta.url);
const name = 'qwen/qwen2_1-femaledVaginus-nsfw-v1_3-fine_L22-31.safetensors';
const token = 'qwen21-nsfw-lora-v1';
const other = 'qwen/another.safetensors';
function load(relative) {
  const context = {}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL(relative, root), 'utf8'), context);
  return context.NovaFlowArtGenerateLora;
}
const nodeApi = load('renderer/art-generate-lora.js');

for (const mode of ['txt2img', 'img2img']) {
  test(`${mode}: node resolves only the fixed token; toggle off and manual selection remain independent`, () => {
    const state = {provider:'local',mode,nsfw:false,nsfwLoraEnabled:true,nsfwLoraName:token,loras:[{name:other,strength:.6}]};
    const selection = nodeApi.effectiveSelection(state);
    assert.equal(selection.length, 2); assert.equal(selection[1].name, name); assert.equal(selection[1].strength, 1);
    const manual = nodeApi.effectiveSelection({...state, loras:[...state.loras, {name,strength:.7}]});
    assert.equal(manual.length, 2); assert.equal(manual[1].strength, .7);
    const off = nodeApi.effectiveSelection({...state, nsfwLoraEnabled:false});
    assert.equal(off.length, 1); assert.equal(off[0].name, other);
    assert.equal(state.loras.length, 1);
    assert.throws(() => nodeApi.effectiveSelection({...state,nsfwLoraName:'arbitrary'}));
    assert.throws(() => nodeApi.effectiveSelection({...state,nsfw:true}));
    assert.throws(() => nodeApi.effectiveSelection({...state,provider:'online'}));
    assert.equal(nodeApi.effectiveSelection({...state,nsfwLoraName:name})[1].name,name);
  });
}

test('actual worker graph validator rechecks the chosen model and missing files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foart-lora-test-'));
  const old = process.resourcesPath;
  try {
    const catalogs = path.join(dir, 'lora-catalogs'); fs.mkdirSync(catalogs);
    fs.writeFileSync(path.join(catalogs,'qwen-lora-catalog.cjs'),
      "exports.createQwenLoraCatalog=()=>({catalog:async input=>{globalThis.__loraTestModel=input.modelName;return globalThis.__loraTestItems},runtimeName21:n=>n});");
    fs.writeFileSync(path.join(catalogs,'minimax-h3-lora-catalog.cjs'),
      "exports.createMiniMaxH3LoraCatalog=()=>({catalog:async()=>[],validate:async()=>({ok:true})});");
    process.resourcesPath = dir;
    const catalog = createWorkerLoraCatalog({modelsRoot:dir,image:{},video:{}});
    const graph = {base:{class_type:'UNETLoader',inputs:{unet_name:'qwen-image-2.1.safetensors'}},step:{class_type:'KSampler',inputs:{model:['base',0]}}};
    nodeApi.apply(graph,{provider:'local',mode:'img2img',nsfw:false,nsfwLoraEnabled:true,nsfwLoraName:token});
    const runtimeName = name.replaceAll('/', '\\');
    globalThis.__loraTestItems = [{name:runtimeName}];
    await catalog.validateGraph(graph); assert.equal(globalThis.__loraTestModel,'qwen-image-2.1.safetensors');
    assert.equal(graph.nf_art_lora_1.inputs.lora_name,runtimeName);
    globalThis.__loraTestItems = []; await assert.rejects(catalog.validateGraph(graph));
  } finally { process.resourcesPath = old; delete globalThis.__loraTestModel; delete globalThis.__loraTestItems; fs.rmSync(dir,{recursive:true,force:true}); }
});

test('authenticated catalog uses the actual Standard or Turbo node set and fails closed for stale/shared nodes', async () => {
  const secret = 'isolated-test-secret';
  const encoded = base64UrlJson({sub:'test-user',exp:Math.floor(Date.now()/1000)+120});
  const bearer = 'nfs_'+encoded+'.'+await hmacSha256(encoded,secret);
  let rows=[], calls=[];
  const row=(items,updated_at=new Date().toISOString())=>({detail:{lora_catalog:{version:1,updated_at,qwen21:{ok:true,items:items.map(name=>({name}))}}}});
  const store={getUserById:async()=>({id:'test-user',status:'active',plan:'free'}),listCapableModelDetails:async id=>{calls.push(id);return rows}};
  const plane=createControlPlane({store,secrets:{sessionSecret:secret,controlSecret:'isolated'}});
  const run=(query={},auth=true)=>plane.handle({method:'GET',path:'/api/web/loras/qwen',query:{engine:'qwen-2.1',...query},headers:auth?{authorization:'Bearer '+bearer}:{}});
  rows=[row([name])]; let result=await run(); assert.equal(result.body.features.qwen21_nsfw_lora,true);assert.equal(calls.at(-1),'qwen-image-2.1');
  result=await run({variant:'turbo'});assert.equal(result.body.features.qwen21_nsfw_lora,true);assert.equal(calls.at(-1),'qwen-image-2.1-turbo');
  rows=[row([name]),row([])];assert.equal((await run()).body.features.qwen21_nsfw_lora,false);
  rows=[row([name],new Date(Date.now()-360000).toISOString())];assert.equal((await run()).status,503);
  assert.equal((await run({},false)).status,401);
});
