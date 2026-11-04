import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createWorkflowHost} from '../../worker/src/comfy/workflow-host.mjs';
const io=(...names)=>Object.fromEntries(names.map(n=>[n,['*']]));
const info={
 LoadImage:{input:{required:{image:[['L.jpg','S.png']]}}},
 UnetLoaderGGUF:{input:{required:{unet_name:[['qwen-image-2.1-UC-Q8_0.gguf']]}}},
 CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_w4a8_heretic.safetensors']],type:[['qwen_image']]},optional:{device:[['default']]}}},
 VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},
 TextEncodeQwenImage21:{input:{required:{...io('clip','prompt','negative_prompt'),resolution:['INT',{default:1024}],images:['COMFY_AUTOGROW_V3',{}]},optional:io('vae')}},
 QwenImage21Cache:{input:{required:{model:['MODEL'],device:[['auto']],dtype:[['default']]}}},
 KSampler:{input:{required:{...io('model','positive','negative','latent_image','seed','steps','cfg','denoise'),sampler_name:[['euler']],scheduler:[['simple']]}}},
 VAEDecode:{input:{required:io('samples','vae')}},SplitImageWithAlpha:{input:{required:io('image')}},
 ImageScale:{input:{required:{...io('image','width','height'),upscale_method:[['lanczos']],crop:[['disabled']]}}},
 ImagePadForOutpaint:{input:{required:io('image','left','right','top','bottom','feathering')}},
 EmptyLatentImage:{input:{required:io('width','height','batch_size')}},
 LatentUpscale:{input:{required:{...io('samples','width','height'),upscale_method:[['nearest-exact']],crop:[['disabled']]}}},
 SaveImage:{input:{required:io('images','filename_prefix')}}
};
const host=await createWorkflowHost({rendererDir:process.env.NOVAFLOW_TEST_RENDERER_DIR||fileURLToPath(new URL('../../worker-renderer/',import.meta.url)),objectInfo:info});
const build=(flag,names=['L.jpg'])=>host.buildGraph({module:'novaflow-brand-runtime',method:'buildArtGenerateRunWorkflow',options:{__args:[
 'local','img2img',names,'native_PE','原始PE设计稿。','','test',names.map(()=>({width:1512,height:3276})),
 {provider:'local',mode:'img2img',width:960,height:2080,seed:10050508,randomSeed:false,localUiEngine:'qwen-2.1',uiRunIntent:'redesign',uiPreserveLayout:true,uiNativeEditPrompt:true,uiLayoutMode:'preserve'},16,
 {taskProfile:'ui-design',...(flag?{uiNaturalDraft:true}:{}),referenceRoles:names.map((_,index)=>({index,role:index?'style':'layout'}))}
]}});
test('formal worker restores the original PE reference, encoder and packed empty-latent conditions',async()=>{
 const graph=JSON.parse(JSON.stringify(await build(true)));assert.equal(graph['5'].inputs.resolution,1024);assert.deepEqual(graph['5'].inputs['images.image_1'],['100',0]);
 assert.equal(graph['5'].inputs.prompt,'原始PE设计稿。');assert.equal(graph['100'].inputs.image,'L.jpg');
 const latent=graph[graph['7'].inputs.latent_image[0]];assert.equal(latent.class_type,'LatentUpscale');assert.deepEqual(latent.inputs.samples,['5',2]);
 assert.deepEqual([latent.inputs.width,latent.inputs.height,latent.inputs.upscale_method],[480,1040,'nearest-exact']);
 assert.deepEqual([graph['7'].inputs.seed,graph['7'].inputs.steps,graph['7'].inputs.cfg],[10050508,40,1]);
 assert.ok(!Object.values(graph).some(n=>n.class_type==='ImagePadForOutpaint'));
});
test('ordinary UI and existing multi-reference budget retain their previous rendering path',async()=>{
 const ordinary=await build(false);assert.equal(ordinary['5'].inputs.resolution,0);assert.notEqual(ordinary['5'].inputs['images.image_1'][0],'100');
 const multi=await build(true,['L.jpg','S.png']);assert.equal(multi['5'].inputs.resolution,0);assert.ok(multi['5'].inputs['images.image_2']);
});
