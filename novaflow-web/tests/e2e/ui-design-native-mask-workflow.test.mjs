import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowHost} from '../../worker/src/comfy/workflow-host.mjs';
const io=(...names)=>Object.fromEntries(names.map(n=>[n,['*']]));
const info={
 LoadImage:{input:{required:{image:[['screen.png']]}}},
 UnetLoaderGGUF:{input:{required:{unet_name:[['qwen-image-2.1-UC-Q8_0.gguf']]}}},
 CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_w4a8_heretic.safetensors']],type:[['qwen_image']]},optional:{device:[['default']]}}},
 VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},
 TextEncodeQwenImage21:{input:{required:{...io('clip','prompt','negative_prompt'),resolution:['INT',{default:1024}],images:['COMFY_AUTOGROW_V3',{}]},optional:io('vae')}},
 KSampler:{input:{required:{...io('model','positive','negative','latent_image','seed','steps','cfg','denoise'),sampler_name:[['euler']],scheduler:[['simple']]}}},
 VAEDecode:{input:{required:io('samples','vae')}},
 SplitImageWithAlpha:{input:{required:io('image')}},
 ImageScale:{input:{required:{...io('image','width','height'),upscale_method:[['lanczos']],crop:[['disabled','center']]}}},
 ImageScaleToTotalPixels:{input:{required:{...io('image','megapixels','resolution_steps'),upscale_method:[['lanczos']]}}},
 EmptyLatentImage:{input:{required:io('width','height','batch_size')}},
 SaveImage:{input:{required:io('images','filename_prefix')}},
 VAEEncode:{input:{required:io('pixels','vae')}},SetLatentNoiseMask:{input:{required:io('samples','mask')}},
 SolidMask:{input:{required:io('value','width','height')}},MaskComposite:{input:{required:io('destination','source','x','y','operation')}},
 EmptyImage:{input:{required:io('width','height','batch_size','color')}},ImageCompositeMasked:{input:{required:io('destination','source','mask','x','y','resize_source')}}
};
const host=await createWorkflowHost({rendererDir:new URL('../../worker-renderer/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),objectInfo:info});
const baseState={provider:'local',mode:'img2img',width:720,height:1280,seed:7,randomSeed:false,localUiEngine:'qwen-2.1',uiPreserveLayout:true,uiLayoutMode:'partial',uiRunIntent:'iteration',uiNativeEditPrompt:true,samplingOverrides:{'qwen-2.1:img2img':{steps:40,cfg:1}}};
const edit={regions:[{x:.125,y:.25,width:.25,height:.2}],baseSourceId:'base',neutralizeConditioning:true,fillColor:0x102030};
const options={taskProfile:'ui-design',referenceRoles:[{index:0,role:'layout',sourceId:'base'},{index:1,role:'style',sourceId:'style'}],uiNativeEdit:edit};
async function build(patch={},opts=options,sizes=[{width:720,height:1280},{width:512,height:512}],target=host){return JSON.parse(JSON.stringify(await target.buildGraph({module:'novaflow-brand-runtime',method:'buildArtGenerateRunWorkflow',options:{__args:['local','img2img',['screen.png','style.png'],'NF_native','only edit selected equipment','','test',sizes,{...baseState,...patch},10,opts]}})));}
test('worker builds physical mask and samples untouched base latent at requested native size',async()=>{
 const g=await build();assert.deepEqual(g['401'].inputs,{value:0,width:720,height:1280});
 assert.deepEqual(g['450'].inputs,{value:1,width:180,height:256});
 assert.equal(g['451'].inputs.x,90);assert.equal(g['451'].inputs.y,320);
 assert.deepEqual(g['402'].inputs,{samples:['400',0],mask:['451',0]});assert.deepEqual(g['7'].inputs.latent_image,['402',0]);
 assert.deepEqual(g['410'].inputs,{width:720,height:1280,batch_size:1,color:0x102030});
 assert.deepEqual(g['411'].inputs.destination,g['400'].inputs.pixels);assert.deepEqual(g['5'].inputs['images.image_1'],['411',0]);
 assert.deepEqual(g['11'].inputs.images,['9',0]);assert.equal(g['10'],undefined);
 assert.equal(Object.entries(g).filter(([,n])=>/Composite|Paste|Blend/.test(n.class_type)).length,2,'one mask composite and one input-only image composite');
});
test('neutralization is optional and full-frame UI generation retains its existing graph',async()=>{
 const g=await build({}, {...options,uiNativeEdit:{...edit,neutralizeConditioning:false}});assert.equal(g['410'],undefined);assert.equal(g['411'],undefined);assert.deepEqual(g['5'].inputs['images.image_1'],g['400'].inputs.pixels);
 const full=await build({uiRunIntent:'style-transfer',uiLayoutMode:'preserve'},{taskProfile:'ui-design',referenceRoles:options.referenceRoles});
 assert.equal(full['400'],undefined);assert.equal(full['402'],undefined);assert.deepEqual(full['11'].inputs.images,['10',0]);
});
test('worker rejects stale base binding, invalid bounds, full-canvas edit, aspect mismatch and unmeasured sizes',async()=>{
 for(const patch of [{baseSourceId:'wrong'},{regions:[{x:-.1,y:0,width:.2,height:.2}]},{regions:[{x:1,y:0,width:1e-7,height:.2}]},{regions:[{x:0,y:0,width:1,height:1}]},{regions:Array(9).fill(edit.regions[0])},{fillColor:-1}])await assert.rejects(()=>build({}, {...options,uiNativeEdit:{...edit,...patch}}));
 await assert.rejects(()=>build({width:720,height:720}),/不匹配/);
 await assert.rejects(()=>build({width:728,height:1280}),/不匹配/);
 await assert.rejects(()=>build({width:1024,height:2048},options,[{width:1024,height:2048},{width:512,height:512}]),/超过已验证/);
});
test('measured 864x1536 uses same production mask path and fails outside its model/sampling guard',async()=>{
 const sizes=[{width:864,height:1536},{width:512,height:512}];
 const g=await build({width:864,height:1536},options,sizes);assert.equal(g['401'].inputs.width,864);assert.equal(g['401'].inputs.height,1536);assert.deepEqual(g['11'].inputs.images,['9',0]);
 await assert.rejects(()=>build({width:864,height:1536,samplingOverrides:{'qwen-2.1:img2img':{steps:32,cfg:3}}},options,sizes),/40步/);
});
test('worker refuses unavailable native mask nodes before producing a graph',async()=>{
 const {SetLatentNoiseMask,...missing}=info;
 const other=await createWorkflowHost({rendererDir:new URL('../../worker-renderer/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),objectInfo:missing});
 await assert.rejects(()=>build({},options,undefined,other),/缺少/);
});


test('native partial jobs reject missing masks, raw invalid sizes and non-finite decoded reference metadata',async()=>{
 await assert.rejects(()=>build({}, {taskProfile:'ui-design',referenceRoles:options.referenceRoles}),/缺少原生选区/);
 for(const patch of [{width:0},{width:NaN},{height:Infinity},{width:720.5},{width:8192}])await assert.rejects(()=>build(patch),/尺寸/);
 for(const size of [{width:Infinity,height:Infinity},{width:0,height:1280},{width:720,height:NaN}])await assert.rejects(()=>build({},options,[size,{width:512,height:512}]),/尺寸/);
});
test('worker permits multiple style roles but rejects duplicate indices and source identifiers',async()=>{
 const roles=[{index:0,role:'layout',sourceId:'base'},{index:1,role:'style',sourceId:'style-a'},{index:2,role:'style',sourceId:'style-b'}];
 const g=JSON.parse(JSON.stringify(await host.buildGraph({module:'novaflow-brand-runtime',method:'buildArtGenerateRunWorkflow',options:{__args:['local','img2img',['screen.png','a.png','b.png'],'NF_roles','edit','','test',[{width:720,height:1280},{width:256,height:256},{width:256,height:256}],baseState,10,{...options,referenceRoles:roles}]}})));assert.equal(g['102'].class_type,'LoadImage');
 for(const entries of [[{...options.referenceRoles[0]}, {...options.referenceRoles[1],index:0}],[{...options.referenceRoles[0]},{...options.referenceRoles[1],sourceId:'base'}]])await assert.rejects(()=>build({}, {...options,referenceRoles:entries}),/重复/);
});

test('a native mask request cannot be routed to a legacy drawing workflow',async()=>{
 await assert.rejects(()=>build({localUiEngine:''}),/必须使用Qwen2.1原生选区/);
});

test('every UI partial without a native mask is refused independent of native-prompt flag and engine route',async()=>{
 const opts={taskProfile:'ui-design',referenceRoles:options.referenceRoles};
 for(const uiNativeEditPrompt of [undefined,false,true])for(const uiRunIntent of ['iteration','redesign','style-transfer'])for(const localUiEngine of ['qwen-2.1',''])await assert.rejects(()=>build({uiNativeEditPrompt,uiRunIntent,localUiEngine},opts),/局部UI任务缺少原生选区/);
 await assert.rejects(()=>build({uiNativeEditPrompt:false},{...opts,taskProfile:'UI-DESIGN'}),/局部UI任务缺少原生选区/);
});
