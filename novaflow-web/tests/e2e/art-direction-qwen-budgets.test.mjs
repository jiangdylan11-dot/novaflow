import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const source=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  const ART_QWEN21_UNETS ='),source.indexOf('  // UI design on a Qwen-Image-2.1 node:'));
function build(options,extra=false,native=true,state={}){
  const info={NovaFlowGGUFBF16Loader:{input:{required:{unet_name:[['qwen-image-2.1-UC-BF16.gguf','Qwen-Image-2.1-Turbo-BF16.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_bf16_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
  if(!native)info.NovaFlowGGUFBF16Loader.input.required.unet_name[0]=['qwen-image-2.1-UC-Q8_0.gguf'];
  if(native){info.UNETLoader={input:{required:{unet_name:[['qwen-image-2.1-UC-BF16-native.safetensors']]}}};info.CLIPLoader.input.required.clip_name[0].push('qwen3vl_8b_bf16_heretic.safetensors');}
  const vm=createContext({window:{electronAPI:{__objectInfoSync:()=>info}}});runInContext(readFileSync(new URL('../../renderer/qwen21-turbo.workflow.js',import.meta.url),'utf8'),vm);vm.NovaFlowQwen21Turbo=vm.NovaFlowQwen21Turbo;vm.window.NovaFlowQwen21Turbo=vm.NovaFlowQwen21Turbo;runInContext(code,vm);
  return vm.buildArtQwen21Workflow('img2img',extra?['source','style','pose']:['source','style'],'proof','prompt',{width:832,height:1216,seed:7,randomSeed:false,uiPreserveLayout:false,negativePrompt:'avoid donor',...state},extra?[{width:1280,height:960},{width:3328,height:4864},{width:1000,height:1000}]:[{width:1280,height:960},{width:3328,height:4864}],options,'avoid donor',{cfg:3,steps:40});
}

test('a portrait relayout retains the grounded pair content budget and full style detail',()=>{
  const options={taskProfile:'art-direction',referenceRoles:['subject','style']};
  const ordinary=build(options).workflow,style=build({...options,styleReferencePriority:true}).workflow;
  assert.equal(ordinary['200'].inputs.width,1152);assert.equal(ordinary['201'].inputs.width,576);
  assert.equal(style['200'].inputs.width,800);assert.equal(style['200'].inputs.height,608);
  assert.equal(style['201'].inputs.width,832);assert.equal(style['201'].inputs.height,1216);
  assert.deepEqual(Array.from(style['5'].inputs['images.image_1']),['200',0]);assert.deepEqual(Array.from(style['5'].inputs['images.image_2']),['201',0]);
  assert.equal(style['6'].inputs.width,832);assert.equal(style['6'].inputs.height,1216);
  assert.deepEqual(Array.from(style['7'].inputs.latent_image),['6',0]);
  assert.equal(style['7'].inputs.cfg,3);assert.equal(style['7'].inputs.steps,40);
});

test('source-sized grounded style uses the first reference latent without a photographic framing lock',()=>{
  const options={taskProfile:'art-direction',referenceRoles:['subject','style']};
  const state={width:1280,height:960,uiPreserveLayout:undefined};
  const ordinary=build(options,false,true,state).workflow;
  assert.deepEqual(Array.from(ordinary['7'].inputs.latent_image),['5',2]);
  assert.equal(ordinary['200'],undefined);
  for(const uiPreserveLayout of [undefined,false]){
    const style=build({...options,styleReferencePriority:true},false,true,{...state,uiPreserveLayout}).workflow;
    assert.equal(style['200'],undefined);
    assert.deepEqual(Array.from(style['5'].inputs['images.image_1']),['100',0]);
    assert.equal(style['201'].inputs.width,832);assert.equal(style['201'].inputs.height,1216);
    assert.equal(style['6'],undefined);
    assert.deepEqual(Array.from(style['7'].inputs.latent_image),['5',2]);
    assert.equal(style['5'].inputs.prompt,'prompt');
  }
});

test('same-aspect grounded style scales source to working dimensions and samples its latent',()=>{
  const style=build({taskProfile:'art-direction',referenceRoles:['subject','style'],styleReferencePriority:true},false,true,{width:1024,height:768,uiPreserveLayout:false}).workflow;
  assert.equal(style['200'].inputs.width,1024);assert.equal(style['200'].inputs.height,768);
  assert.deepEqual(Array.from(style['5'].inputs['images.image_1']),['200',0]);
  assert.equal(style['201'].inputs.width,832);assert.equal(style['201'].inputs.height,1216);
  assert.equal(style['6'],undefined);
  assert.deepEqual(Array.from(style['7'].inputs.latent_image),['5',2]);
  assert.equal(style['5'].inputs.prompt,'prompt');
});

test('source-aspect alignment stays scoped away from fresh-layout controls and ordinary edits',()=>{
  const state={width:1280,height:960,uiPreserveLayout:false};
  for(const [options,extra]of [
    [{taskProfile:'art-direction',referenceRoles:['subject','style','pose'],styleReferencePriority:true},true],
    [{taskProfile:'art-direction',referenceRoles:['subject','pose'],styleReferencePriority:true},false],
    [{taskProfile:'art-direction',referenceRoles:['subject','composition'],styleReferencePriority:true},false],
    [{},false]
  ]){
    const graph=build(options,extra,true,state).workflow;
    assert.equal(graph['200'].inputs.width,1152);assert.equal(graph['200'].inputs.height,864);
    assert.equal(graph['6'].inputs.width,1280);assert.equal(graph['6'].inputs.height,960);
    assert.deepEqual(Array.from(graph['7'].inputs.latent_image),['6',0]);
  }
});

test('analyzed drawing uses available native BF16 with matching encoder while ordinary edits keep their route',()=>{
  const high=build({taskProfile:'art-direction',referenceRoles:['subject','style']},false,true).workflow;
  assert.equal(high['1'].class_type,'NovaFlowGGUFBF16Loader');assert.equal(high['1'].inputs.unet_name,'qwen-image-2.1-UC-BF16.gguf');
  assert.equal(high['2'].inputs.clip_name,'qwen3vl_8b_bf16_heretic.safetensors');assert.equal(high['7'].inputs.steps,40);
  const ordinary=build({},false,true).workflow;
  assert.equal(ordinary['1'].class_type,'NovaFlowGGUFBF16Loader');assert.equal(ordinary['2'].inputs.clip_name,'qwen3vl_8b_bf16_heretic.safetensors');
  assert.equal(build({taskProfile:'art-direction'},false,false),null,'Q8-only nodes do not silently replace BF16');
});
test('style priority cannot re-budget pose controls, ordinary edits or UI generation',()=>{
  const multiple=build({taskProfile:'art-direction',referenceRoles:['subject','style','pose'],styleReferencePriority:true},true).workflow;
  assert.equal(multiple['200'].inputs.width,1152);assert.equal(multiple['201'].inputs.width,576);
  assert.equal(build({styleReferencePriority:true}).workflow['200'].inputs.width,1152);
  assert.equal(build({taskProfile:'ui-design',referenceRoles:['subject','style'],styleReferencePriority:true}),null);
});


test('Turbo drawing selects the exact Turbo BF16 GGUF and the shipped eight-step schedule',()=>{
  const graph=build({taskProfile:'art-direction'},false,true,{localQwen21Variant:'turbo'}).workflow;
  assert.equal(graph['1'].class_type,'NovaFlowGGUFBF16Loader');
  assert.equal(graph['1'].inputs.unet_name,'Qwen-Image-2.1-Turbo-BF16.gguf');
  assert.equal(graph['2'].inputs.clip_name,'qwen3vl_8b_bf16_heretic.safetensors');
  assert.equal(graph['7'].class_type,'SamplerCustom');assert.equal(graph['7'].inputs.cfg,1);
  assert.equal(graph[graph['7'].inputs.sigmas[0]].inputs.sigmas,'1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0');
  assert.equal(Object.values(graph).filter(n=>n.class_type==='KSampler').length,0);
});
