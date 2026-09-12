const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadSpine}=require('../../tools/qwen-rapid-migration-smoke.cjs');
const {loadArt,graphs}=require('../../tools/qwen-rapid-acceptance.cjs');
const info=require('./fixtures/qwen-rapid-runtime.json');
const checkpoint='Qwen-Rapid-AIO-NSFW-v20.safetensors';
const spine=loadSpine('particle-editor/spine-split-runtime.js');

function assertRapid(graph){
 const entries=Object.entries(graph);
 const bases=entries.filter(([,n])=>n.class_type==='CheckpointLoaderSimple');
 assert.equal(bases.length,1);
 assert.equal(bases[0][1].inputs.ckpt_name,checkpoint);
 assert.equal(entries.some(([,n])=>['UNETLoader','CLIPLoader','VAELoader','ModelSamplingAuraFlow','CFGNorm'].includes(n.class_type)),false);
 for(const [id,n]of entries){
  assert.ok(!/lightning/i.test(n.inputs.lora_name||''),id);
  for(const value of Object.values(n.inputs))if(Array.isArray(value))assert.ok(graph[value[0]],`${id} has dangling link ${value}`);
  for(const field of ['clip','vae'])if(n.inputs[field])assert.deepEqual(Array.from(n.inputs[field]),[bases[0][0],field==='clip'?1:2]);
 }
}

test('all image tools build without UNET, CLIP, VAE or Lightning availability',()=>{
 assert.equal(info.UNETLoader,undefined);
 const outpaint=spine.buildQwenImageOutpaintWorkflow(info,'scene.png','test',{left:128,right:128,top:0,bottom:0});
 const angle=spine.buildImageAngleAdjustWorkflow(info,'reference.png',{horizontalAngle:90,verticalAngle:15,zoom:4.3});
 const transfer=spine.buildObjectTransferQwenWorkflow(info,{placementName:'scene.png',referenceName:'reference.png'},'test',spine.resolveObjectTransferQwenRuntime(info));
 for(const g of [outpaint,angle,transfer]){
  assertRapid(g);
  const sampler=Object.values(g).find(n=>n.class_type==='KSampler').inputs;
  assert.equal(sampler.steps,6);assert.equal(sampler.sampler_name,'euler_ancestral');assert.equal(sampler.scheduler,'beta');
 }
 assert.equal(Object.values(angle).filter(n=>n.class_type==='LoraLoaderModelOnly').length,1);
 assert.match(angle['4'].inputs.lora_name,/multiple-angles/);
 assert.equal(angle['9'].inputs.horizontal_angle,90);
 assert.deepEqual(Array.from(outpaint['2'].inputs.image),['1',0]);
 assert.ok(Object.values(transfer).some(n=>n.class_type==='TextEncodeQwenImageEditPlus'&&n.inputs.image1&&n.inputs.image2));
 const unavailable=structuredClone(info);unavailable.CheckpointLoaderSimple.input.required.ckpt_name[0]=['other.safetensors'];
 assert.throws(()=>spine.buildImageAngleAdjustWorkflow(unavailable,'reference.png'),/Rapid/);
});

test('legacy saved settings cannot select a retired editing or storyboard route',()=>{
 for(const mode of ['edit','completion'])for(const old of [undefined,false,true,'qwen-edit-v5'])assert.equal(spine.resolveInpaintWorkflowRoute(mode,old).workflow,'rapid-aio-nsfw');
 assert.equal(spine.resolveInpaintWorkflowRoute('repair',false).workflow,'removal');
 for(const mode of ['default','qwenNsfw',undefined])assertRapid(spine.buildStoryboardSceneWorkflow(info,'scene.png','test','A cottage by a lake.',{id:'landscape'},mode,{disablePromptExpansion:true}));
});

test('actual Art and UI bridge use Rapid even with NSFW off; ordinary txt2img stays Ideogram',()=>{
 const built=graphs(info);
 for(const g of Object.values(built))assertRapid(g);
 assert.equal(Object.values(built.art).find(n=>n.class_type==='KSampler').inputs.steps,4);
 assert.equal(Object.values(built.ui).find(n=>n.class_type==='KSampler').inputs.steps,6);
 assert.ok(built.art.nf_art_lora_1); // Manual Qwen adapters still participate.
 const art=loadArt();
 assert.equal(art.shouldUseArtGenerateIdeogramWorkflow('local','txt2img',{nsfw:false}),true);
 assert.equal(art.shouldUseArtGenerateIdeogramWorkflow('local','txt2img',{nsfw:true}),false);
});

test('Rapid AIFX preserves ControlNet and tail conditioning; catalog uses its actual base',()=>{
 const g=graphs(info)['aifx-tail'];
 assert.equal(g['13'].class_type,'ControlNetApplyAdvanced');
 assert.equal(g['13'].inputs.strength,.62);
 assert.equal(g['19'].inputs.end,.12);
 assert.equal(g['20'].inputs.start,0);
 assert.equal(g['21'].class_type,'ConditioningCombine');
 const {BASE_MODELS}=require('../main/qwen-lora-catalog');
 assert.equal(BASE_MODELS.edit,'checkpoints/'+checkpoint);assert.equal(BASE_MODELS.rapid,BASE_MODELS.edit);
 for(const name of ['novaflow-brand-runtime.js','spine-split-runtime.js','aifx-local.workflow.js'])assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname,'../../particle-editor',name),'utf8'),/qwen_image_edit_2511_(bf16|fp8mixed)\.safetensors/);
});
