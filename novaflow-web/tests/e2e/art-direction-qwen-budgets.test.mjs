import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const source=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  const ART_QWEN21_TURBO_UNETS ='),source.indexOf('  // UI design on a Qwen-Image-2.1 node:'));
const modelSandbox={module:{exports:{}}};
runInContext(readFileSync(new URL('../../renderer/art-generate-model.resource.js',import.meta.url),'utf8'),createContext(modelSandbox));
const realModels=modelSandbox.module.exports;
function build(options,extra=false,native=true,state={}){
  const info={NovaFlowGGUFBF16Loader:{input:{required:{unet_name:[['qwen-image-2.1-UC-BF16.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_bf16_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
  info.UNETLoader={input:{required:{unet_name:[[native?'Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors':'other-model.safetensors']],weight_dtype:[['default']]}}};
  if(native){info.UNETLoader.input.required.unet_name[0].push('qwen-image-2.1-UC-BF16-native.safetensors');info.CLIPLoader.input.required.clip_name[0].push('qwen3vl_8b_bf16_heretic.safetensors');}
  const vm=createContext({window:{electronAPI:{__objectInfoSync:()=>info}}});runInContext(readFileSync(new URL('../../renderer/qwen21-turbo.workflow.js',import.meta.url),'utf8'),vm);vm.NovaFlowQwen21Turbo=vm.NovaFlowQwen21Turbo;vm.window.NovaFlowArtGenerateModels=realModels;vm.window.NovaFlowQwen21Turbo=vm.NovaFlowQwen21Turbo;runInContext(code,vm);
  return vm.buildArtQwen21Workflow('img2img',extra?['source','style','pose']:['source','style'],'proof','prompt',{width:832,height:1216,seed:7,randomSeed:false,uiPreserveLayout:false,negativePrompt:'avoid donor',...state},extra?[{width:1280,height:960},{width:3328,height:4864},{width:1000,height:1000}]:[{width:1280,height:960},{width:3328,height:4864}],options,'avoid donor',{cfg:3,steps:40});
}

// A style redraw is the single-pass recipe decided in the Nov 5-6 A/B rounds: the subject photo goes in
// loose (STYLE_REDRAW_CONTENT_PIXELS), the style picture keeps up to 1 MP, and the picture is drawn fresh on
// a large empty canvas of the requested aspect (STYLE_REDRAW_WORKING_PIXELS) at STYLE_REDRAW_CFG.
const near=(value,target,tolerance)=>Math.abs(value-target)<=tolerance;
function assertStyleRedraw(style,{width,height}){
  const subject=style['200'].inputs,content=subject.width*subject.height;
  assert.deepEqual(Array.from(style['5'].inputs['images.image_1']),['200',0]);
  assert.ok(content<=realModels.STYLE_REDRAW_CONTENT_PIXELS&&content>=realModels.STYLE_REDRAW_CONTENT_PIXELS*0.75,`subject is loose: ${subject.width}x${subject.height}`);
  assert.ok(near(subject.width/subject.height,1280/960,0.06),'the subject keeps its own aspect');
  assert.deepEqual(Array.from(style['5'].inputs['images.image_2']),['201',0]);
  assert.equal(style['201'].inputs.width,832);assert.equal(style['201'].inputs.height,1216);
  const canvas=style['6'].inputs;
  assert.equal(style['6'].class_type,'EmptyLatentImage');assert.deepEqual(Array.from(style['7'].inputs.latent_image),['6',0]);
  assert.ok(canvas.width%32===0&&canvas.height%32===0);
  assert.ok(canvas.width*canvas.height<=realModels.STYLE_REDRAW_WORKING_PIXELS&&canvas.width*canvas.height>=realModels.STYLE_REDRAW_WORKING_PIXELS*0.9,`canvas ${canvas.width}x${canvas.height}`);
  assert.ok(near(canvas.width/canvas.height,width/height,0.03),'the canvas has the requested aspect');
  assert.equal(style['7'].class_type,'SamplerCustom');assert.equal(style['7'].inputs.cfg,realModels.STYLE_REDRAW_CFG);
  assert.equal(style['5'].inputs.prompt,'prompt');
}

test('a portrait style redraw draws on a large requested-aspect canvas from a loose subject and the full style picture',()=>{
  const options={taskProfile:'art-direction',referenceRoles:['subject','style']};
  const ordinary=build({...options,referenceRoles:['subject','reference']}).workflow;
  assert.equal(ordinary['200'].inputs.width,1152);assert.equal(ordinary['201'].inputs.width,576);
  assertStyleRedraw(build(options).workflow,{width:832,height:1216});
});

test('a style redraw never samples the source latent, whatever the layout flag or the requested size',()=>{
  const options={taskProfile:'art-direction',referenceRoles:['subject','style']};
  const state={width:1280,height:960,uiPreserveLayout:undefined};
  const ordinary=build({...options,referenceRoles:['subject','reference']},false,true,state).workflow;
  assert.deepEqual(Array.from(ordinary['7'].inputs.latent_image),['5',2]);
  assert.equal(ordinary['200'],undefined);
  for(const uiPreserveLayout of [undefined,false])assertStyleRedraw(build(options,false,true,{...state,uiPreserveLayout}).workflow,state);
  assertStyleRedraw(build(options,false,true,{width:1024,height:768,uiPreserveLayout:false}).workflow,{width:1024,height:768});
});

test('source-aspect alignment stays scoped away from fresh-layout controls and ordinary edits',()=>{
  const state={width:1280,height:960,uiPreserveLayout:false};
  for(const [options,extra]of [
    [{taskProfile:'art-direction',referenceRoles:['subject','style','pose']},true],
    [{taskProfile:'art-direction',referenceRoles:['subject','pose']},false],
    [{taskProfile:'art-direction',referenceRoles:['subject','composition']},false],
    [{},false]
  ]){
    const graph=build(options,extra,true,state).workflow;
    assert.equal(graph['200'].inputs.width,1152);assert.equal(graph['200'].inputs.height,864);
    assert.equal(graph['6'].inputs.width,1280);assert.equal(graph['6'].inputs.height,960);
    assert.deepEqual(Array.from(graph['7'].inputs.latent_image),['6',0]);
  }
});

test('every drawing runs the Turbo INT8 file through UNETLoader with the matching encoder (the 普通 line is gone)',()=>{
  const high=build({taskProfile:'art-direction',referenceRoles:['subject','style']},false,true).workflow;
  assert.equal(high['1'].class_type,'UNETLoader');assert.equal(high['1'].inputs.unet_name,'Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors');
  assert.equal(high['2'].inputs.clip_name,'qwen3vl_8b_bf16_heretic.safetensors');assert.equal(high['7'].class_type,'SamplerCustom');
  const ordinary=build({},false,true).workflow;
  assert.equal(ordinary['1'].class_type,'UNETLoader');assert.equal(ordinary['2'].inputs.clip_name,'qwen3vl_8b_bf16_heretic.safetensors');
  assert.equal(build({taskProfile:'art-direction'},false,false),null,'a node without the INT8 file does not silently run another model');
});
test('style priority cannot re-budget pose controls, ordinary edits or UI generation',()=>{
  const multiple=build({taskProfile:'art-direction',referenceRoles:['subject','style','pose']},true).workflow;
  assert.equal(multiple['200'].inputs.width,1152);assert.equal(multiple['201'].inputs.width,576);
  assert.equal(build({}).workflow['200'].inputs.width,1152);
  assert.equal(build({taskProfile:'ui-design',referenceRoles:['subject','style']}),null);
});


test('Turbo drawing selects the exact Turbo INT8 ConvRot file through UNETLoader and the shipped eight-step schedule',()=>{
  const graph=build({taskProfile:'art-direction'},false,true,{localQwen21Variant:'turbo'}).workflow;
  assert.equal(graph['1'].class_type,'UNETLoader');assert.equal(graph['1'].inputs.weight_dtype,'default');
  assert.equal(graph['1'].inputs.unet_name,'Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors');
  assert.equal(graph['2'].inputs.clip_name,'qwen3vl_8b_bf16_heretic.safetensors');
  assert.equal(graph['7'].class_type,'SamplerCustom');assert.equal(graph['7'].inputs.cfg,1);
  assert.equal(graph[graph['7'].inputs.sigmas[0]].inputs.sigmas,'1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0');
  assert.equal(Object.values(graph).filter(n=>n.class_type==='KSampler').length,0);
});
