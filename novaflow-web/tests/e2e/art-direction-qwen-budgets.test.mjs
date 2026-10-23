import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const source=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  const ART_QWEN21_UNETS ='),source.indexOf('  // UI design on a Qwen-Image-2.1 node:'));
function build(options,extra=false,native=false){
  const info={UnetLoaderGGUF:{input:{required:{unet_name:[['qwen-image-2.1-UC-Q8_0.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_w4a8_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
  if(native){info.UNETLoader={input:{required:{unet_name:[['qwen-image-2.1-UC-BF16-native.safetensors']]}}};info.CLIPLoader.input.required.clip_name[0].push('qwen3vl_8b_bf16_heretic.safetensors');}
  const vm=createContext({window:{electronAPI:{__objectInfoSync:()=>info}}});runInContext(code,vm);
  return vm.buildArtQwen21Workflow('img2img',extra?['source','style','pose']:['source','style'],'proof','prompt',{width:832,height:1216,seed:7,randomSeed:false,uiPreserveLayout:false,negativePrompt:'avoid donor'},extra?[{width:1280,height:960},{width:3328,height:4864},{width:1000,height:1000}]:[{width:1280,height:960},{width:3328,height:4864}],options,'avoid donor',{cfg:3,steps:40});
}

test('only the grounded subject/style pair trades photographic detail for complete style detail',()=>{
  const options={taskProfile:'art-direction',referenceRoles:['subject','style']};
  const ordinary=build(options).workflow,style=build({...options,styleReferencePriority:true}).workflow;
  assert.equal(ordinary['200'].inputs.width,1152);assert.equal(ordinary['201'].inputs.width,576);
  assert.equal(style['200'].inputs.width,800);assert.equal(style['200'].inputs.height,608);
  assert.equal(style['201'].inputs.width,832);assert.equal(style['201'].inputs.height,1216);
  assert.deepEqual(Array.from(style['5'].inputs['images.image_1']),['200',0]);assert.deepEqual(Array.from(style['5'].inputs['images.image_2']),['201',0]);
  assert.equal(style['7'].inputs.cfg,3);assert.equal(style['7'].inputs.steps,40);
});

test('analyzed drawing uses available native BF16 with matching encoder while ordinary edits keep their route',()=>{
  const high=build({taskProfile:'art-direction',referenceRoles:['subject','style']},false,true).workflow;
  assert.equal(high['1'].class_type,'UNETLoader');assert.equal(high['1'].inputs.weight_dtype,'default');
  assert.equal(high['2'].inputs.clip_name,'qwen3vl_8b_bf16_heretic.safetensors');assert.equal(high['7'].inputs.steps,40);
  const ordinary=build({},false,true).workflow;
  assert.equal(ordinary['1'].class_type,'UnetLoaderGGUF');assert.equal(ordinary['2'].inputs.clip_name,'qwen3vl_8b_w4a8_heretic.safetensors');
  assert.equal(build({taskProfile:'art-direction'}).workflow['1'].class_type,'UnetLoaderGGUF');
});
test('style priority cannot re-budget pose controls, ordinary edits or UI generation',()=>{
  const multiple=build({taskProfile:'art-direction',referenceRoles:['subject','style','pose'],styleReferencePriority:true},true).workflow;
  assert.equal(multiple['200'].inputs.width,1152);assert.equal(multiple['201'].inputs.width,576);
  assert.equal(build({styleReferencePriority:true}).workflow['200'].inputs.width,1152);
  assert.equal(build({taskProfile:'ui-design',referenceRoles:['subject','style'],styleReferencePriority:true}),null);
});
