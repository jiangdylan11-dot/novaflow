import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowModelId} from '../packages/shared/src/workflow-modules.mjs';
import {detectSharedImageCapabilities,RMBG_CAPABILITY,SAM_B_CAPABILITY,QWEN_INPAINT_CAPABILITY,SEEDVR_CAPABILITY,SEETHROUGH_CAPABILITY,SEETHROUGH_LAMA_CAPABILITY,FLUX_FILL_CAPABILITY,FLUX_REMOVAL_CAPABILITY} from '../worker/src/models/shared-workflow-capabilities.mjs';

const inpaintNodes=['VAEEncode','SetLatentNoiseMask','ImageToMask','KSampler','SplitImageWithAlpha','InvertMask','ImageCompositeMasked','ImagePadForOutpaint','ImageCrop','MaskComposite'];
const buildInfo=()=>Object.fromEntries([...inpaintNodes,'LoadImage','SaveImage','VAEDecode','SAM Parameters','SAM Image Mask','JoinImageWithAlpha'].map(name=>[name,{}]));
const statAll=async()=>({isFile:()=>true,size:9000000000});
const fetchInfo=info=>async()=>({ok:true,json:async()=>info});

test('real workflow routing matches independently detected RMBG, B-only SAM and Qwen edit capabilities',async()=>{
  const info=buildInfo();info.BiRefNetRMBG={input:{required:{model:[['BiRefNet-general']]}}};
  info['SAM Model Loader']={input:{required:{model_size:[['ViT-H','ViT-L','ViT-B']]}}};
  const ready=await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:fetchInfo(info),statFile:statAll});
  assert.deepEqual(ready,{rmbg:true,samB:true,samL:true,samH:true,samAuto:true,qwenInpaintNodes:true,seedvr:false,seeThrough:false,seeThroughLama:false,fluxFill:false,fluxRemoval:false});
  assert.equal(workflowModelId('spine-split-runtime',{},'defaultRmbgWorkflow'),RMBG_CAPABILITY);
  assert.notEqual(workflowModelId('spine-split-runtime',{__args:[null,'image','prefix',{name:'LayerMask: BiRefNetUltraV2'}]},'defaultRmbgWorkflow'),RMBG_CAPABILITY);
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'image','prefix',{name:'BiRefNetRMBG'}]},'defaultRmbgWorkflow'),RMBG_CAPABILITY);
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'test.png','test',{}, {modelSize:'ViT-H'}]},'samPointWorkflowFromPrompts'),'foart-sam-vit-h-v1');
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'test.png','test',{}, {modelSize:'ViT-L'}]},'samPointWorkflowFromPrompts'),'foart-sam-vit-l-v1');
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'test.png','test',{}, {}]},'samPointWorkflowFromPrompts'),'foart-sam-auto-v1');
  assert.equal(workflowModelId('NovaFlowArtGenerateProviderWorkflow',{provider:'local',localWorkflow:{'1':{class_type:'NovaFlowGGUFBF16Loader',inputs:{unet_name:'Qwen-Image-2.1-Turbo-BF16.gguf'}}}},'buildRunWorkflow'),'qwen-image-2.1-turbo');
  assert.equal(workflowModelId('NovaFlowArtGenerateProviderWorkflow',{provider:'local',localWorkflow:{'1':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'Qwen-Rapid-AIO-NSFW-v20.safetensors'}}}},'buildRunWorkflow'),'qwen-image-2.1-turbo');
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'test.png','test',{}, {modelSize:'ViT-B'}]},'samPointWorkflowFromPrompts'),SAM_B_CAPABILITY);
  assert.notEqual(workflowModelId('spine-split-runtime',{__args:[null,'test.png','test',{}, {modelSize:'ViT-H'}]},'samPointWorkflowFromPrompts'),SAM_B_CAPABILITY);
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'a','b','c','d',{route:{provider:'qwen-edit-v5'}}]},'defaultQwenInpaintWorkflow'),QWEN_INPAINT_CAPABILITY);
  assert.notEqual(workflowModelId('spine-split-runtime',{__args:[null,'a','b','c','d',{route:{provider:'flux-fill'}}]},'defaultQwenInpaintWorkflow'),QWEN_INPAINT_CAPABILITY);
  assert.throws(()=>workflowModelId('spine-split-runtime',{__args:[null,'a','b','c','d',{inpaintProvider:true}]},'defaultQwenInpaintWorkflow'),{code:'RETIRED_NSFW_INPAINT_ROUTE'});
  assert.equal(workflowModelId('spine-split-runtime',{},'defaultQwenLoraInpaintWorkflow'),'qwen-image-2.1-turbo-edit-lora-v1');
});

test('missing files, absent nodes, unsupported models or offline catalogues fail closed',async()=>{
  const info=buildInfo();info.BiRefNetRMBG={input:{required:{model:[['BiRefNet-general']]}}};
  info['SAM Model Loader']={input:{required:{model_size:[['ViT-B']]}}};
  const missingWeights=async(path)=>{if(String(path).includes('sam_vit_b') || String(path).includes('BiRefNet-general'))throw Error('missing');return statAll();};
  const result=await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:fetchInfo(info),statFile:missingWeights});
  assert.equal(result.rmbg,false);assert.equal(result.samB,false);assert.equal(result.qwenInpaintNodes,true);
  delete info.KSampler;info['SAM Model Loader'].input.required.model_size=[['ViT-H']];
  assert.deepEqual(await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:fetchInfo(info),statFile:statAll}),{rmbg:true,samB:false,samL:false,samH:true,samAuto:true,qwenInpaintNodes:false,seedvr:false,seeThrough:false,seeThroughLama:false,fluxFill:false,fluxRemoval:false});
  assert.deepEqual(await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:async()=>{throw Error('offline');},statFile:statAll}),{rmbg:false,samB:false,samL:false,samH:false,samAuto:false,qwenInpaintNodes:false,seedvr:false,seeThrough:false,seeThroughLama:false,fluxFill:false,fluxRemoval:false});
});


test('SeedVR2, SeeThrough and Flux route only to their checked capabilities',async()=>{
  const info=buildInfo();
  for(const name of ['SeedVR2VideoUpscaler','SeeThrough_GenerateLayers','SeeThrough_GenerateDepth','SeeThrough_PostProcess','SeeThrough_SavePSD','PreviewImage','UNETLoader','DualCLIPLoader','VAELoader','CLIPTextEncode','ConditioningZeroOut','FluxGuidance','InpaintModelConditioning','DifferentialDiffusion','VAEDecode'])info[name]={};
  const combo=(key,values)=>({input:{required:{[key]:[values]}}});
  info.SeedVR2LoadDiTModel=combo('model',['seedvr2_ema_3b_fp8_e4m3fn.safetensors']);
  info.SeedVR2LoadVAEModel=combo('model',['ema_vae_fp16.safetensors']);
  info.SeeThrough_LoadLayerDiffModel=combo('model',['seethroughv0.0.2_layerdiff3d']);
  info.SeeThrough_LoadDepthModel=combo('model',['seethroughv0.0.1_marigold']);
  info.UNETLoader=combo('unet_name',['fill-dev-OneReward-fp8.safetensors']);
  info.VAELoader=combo('vae_name',['ae.safetensors']);
  info.DualCLIPLoader={input:{required:{clip_name1:[['clip_l.safetensors']],clip_name2:[['t5xxl_fp8_e4m3fn.safetensors']]}}};
  info.LoraLoaderModelOnly=combo('lora_name',['removal_timestep_alpha-2-1740.safetensors']);
  const ready=await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:fetchInfo(info),statFile:statAll});
  for(const field of ['seedvr','seeThrough','seeThroughLama','fluxFill','fluxRemoval'])assert.equal(ready[field],true,field);
  assert.equal(workflowModelId('spine-split-runtime',{},'buildSeedVr2ImageUpscaleWorkflow'),SEEDVR_CAPABILITY);
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'a',{useLama:false}]},'buildSeeThroughSplitWorkflow'),SEETHROUGH_CAPABILITY);
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'a',{}]},'buildSeeThroughSplitWorkflow'),SEETHROUGH_LAMA_CAPABILITY);
  assert.equal(workflowModelId('spine-split-runtime',{__args:[null,'a','b','c','d',{route:{provider:'flux-fill'}}]},'defaultQwenInpaintWorkflow'),FLUX_FILL_CAPABILITY);
  assert.equal(workflowModelId('spine-split-runtime',{},'defaultRemovalInpaintWorkflow'),FLUX_REMOVAL_CAPABILITY);
  delete info.LoraLoaderModelOnly;
  const noWeights=async(path)=>{if(String(path).includes('ema_vae_fp16') || String(path).includes('lama_large_512px'))throw Error('missing');return statAll();};
  const missingConfig=async(path)=>{if(String(path).includes('tokenizer_config.json'))throw Error('missing');return statAll();};
  assert.equal((await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:fetchInfo(info),statFile:missingConfig})).seeThrough,false);
  const remote=await detectSharedImageCapabilities({baseUrl:'http://192.0.2.1:8188'},'fixture',{fetcher:fetchInfo(info),statFile:statAll});
  assert.equal(remote.seedvr,false);assert.equal(remote.seeThrough,false);assert.equal(remote.seeThroughLama,false);
  const limited=await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:fetchInfo(info),statFile:noWeights});
  assert.equal(limited.seedvr,false);assert.equal(limited.seeThrough,true);assert.equal(limited.seeThroughLama,false);assert.equal(limited.fluxFill,true);assert.equal(limited.fluxRemoval,false);
});


test('SeedVR capability supports legacy and V3 COMBO, while malformed choices or absent weights fail closed',async()=>{
  const graph=()=>({LoadImage:{},SaveImage:{},SeedVR2VideoUpscaler:{},SeedVR2LoadDiTModel:{input:{required:{model:[['seedvr2_ema_3b_fp8_e4m3fn.safetensors']]}}},SeedVR2LoadVAEModel:{input:{required:{model:[['ema_vae_fp16.safetensors']]}}}});
  const check=async info=>(await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:fetchInfo(info),statFile:statAll})).seedvr;
  const info=graph();assert.equal(await check(info),true,'legacy choices');
  info.SeedVR2LoadDiTModel.input.required.model=['COMBO',{options:['seedvr2_ema_3b_fp8_e4m3fn.safetensors']}];
  info.SeedVR2LoadVAEModel.input.required.model=['COMBO',{options:['ema_vae_fp16.safetensors']}];
  assert.equal(await check(info),true,'actual Comfy V3 choices');
  for(const invalid of [['STRING',{options:['seedvr2_ema_3b_fp8_e4m3fn.safetensors']}],['COMBO',{options:'seedvr2_ema_3b_fp8_e4m3fn.safetensors'}],['COMBO',{}],['COMBO',{options:[42,'seedvr2_ema_3b_fp8_e4m3fn.safetensors']}],['COMBO',{options:[['seedvr2_ema_3b_fp8_e4m3fn.safetensors']]}],['COMBO',{options:['wrong.gguf']}],['COMBO',{options:['seedvr2_ema_3b_fp8_e4m3fn.safetensors']},{}]]) {
    info.SeedVR2LoadDiTModel.input.required.model=invalid;assert.equal(await check(info),false,JSON.stringify(invalid));
  }
  info.SeedVR2LoadDiTModel.input.required.model=['COMBO',{options:['seedvr2_ema_3b_fp8_e4m3fn.safetensors']}];
  const missing=async path=>{if(String(path).includes('ema_vae_fp16'))throw Error('absent');return statAll();};
  assert.equal((await detectSharedImageCapabilities({baseUrl:'http://127.0.0.1:19081'},'fixture',{fetcher:fetchInfo(info),statFile:missing})).seedvr,false,'V3 schema never bypasses required weight checks');
});
