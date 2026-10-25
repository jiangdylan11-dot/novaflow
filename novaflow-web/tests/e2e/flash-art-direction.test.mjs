import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planFlashArtDirection, isFlashArtDirectionRequest, FLASH_ART_SYSTEM, FLASH_ART_SYSTEM_SHA256 } from '../../worker/src/flash-art-direction.mjs';
import { instrumentModule } from '../../tools/instrument-workflow-module.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';

// Structural CPU contracts only: no network, model inference, or quality claims.
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),RENDERER=join(ROOT,'novaflow-web/renderer');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const identity={id:'verified-flash',path:'E:/models/actual.gguf',verification:'server-weight-path',baseUrl:'http://127.0.0.1:8198'};
const canonical='  Redraw content <image1> using the actual artistic rendering in <image2>.\nPreserve the original subject and setting.\n  ';
const clone=value=>JSON.parse(JSON.stringify(value));
function payload(){return {surface:'art',purpose:'art-director',visualSchema:'nf.art.direction.v1',currentPrompt:'参考图1用参考图2画风',negativePrompt:'  user negative only\n',images:[{dataUrl:PNG,name:'content.png'},{dataUrl:PNG,name:'style.png'}],artContext:{task:'style',width:1280,height:960,references:[{source:1,roles:['subject']},{source:2,roles:['style']}]}};}
function native(overrides={}){return {sourceContent:'Native evidence may be paraphrased in the prompt.',prompt:canonical,renderingClass:'other',...overrides};}
function flash(answer=native()){
  const calls=[];
  return {calls,identity,infer:async input=>{calls.push(input);return {text:JSON.stringify(answer),model:identity.id,requestId:'actual-native-id',usage:{completion_tokens:42},timing:{requestMs:123}};}};
}
function released(direction){const result=clone(direction);Object.assign(result.artDirection.editEnhancer,{analysisBackend:'strata',modelIdentity:identity,resourcesReleased:true,generationReady:true});return result;}

test('v12 system hash, one native call, complete images and unique canonical prompt are preserved',async()=>{
  assert.equal(createHash('sha256').update(FLASH_ART_SYSTEM).digest('hex'),FLASH_ART_SYSTEM_SHA256);
  assert.equal(FLASH_ART_SYSTEM_SHA256,'00974bf38e97e4e9168c63f9d448f64b6d5aacfe0499295c6c37a26bff684f64');
  const request=payload(),session=flash(),answer=await planFlashArtDirection({payload:request,flash:session});
  assert.equal(session.calls.length,1);assert.equal(session.calls[0].system,FLASH_ART_SYSTEM);
  assert.deepEqual(session.calls[0].images.map(image=>image.dataUrl),[PNG,PNG]);
  assert.equal(session.calls[0].maxTokens,4096);assert.equal(session.calls[0].temperature,.4);assert.equal(session.calls[0].responseFormat,undefined);
  assert.equal(answer.artDirection.prompt,canonical);assert.equal(answer.artDirection.editEnhancer.prompt,canonical);
  assert.equal(answer.artDirection.editEnhancer.kind,'qwen21-strata-native');assert.equal(answer.artDirection.editEnhancer.providerPolicy.cfg,3);
  assert.equal(answer.artDirection.editEnhancer.resourcesReleased,undefined);assert.equal(answer.artDirection.editEnhancer.modelIdentity,undefined);
  assert.equal(answer.resourcesReleased,undefined);assert.equal(answer.nativeAnalysis.sourceContent,native().sourceContent);
  assert.equal(answer.nativeAnalysis.images[0].sha256,createHash('sha256').update(Buffer.from(PNG.split(',')[1],'base64')).digest('hex'));
  assert.equal(JSON.stringify(answer.nativeAnalysis).includes('base64,'),false);
});

test('actual subject/style input order and sparse source labels are program-owned',async()=>{
  const request=payload();request.currentPrompt='图5用图2画风，<image5>主体';
  request.images=[{dataUrl:PNG,name:'style.png'},{dataUrl:PNG,name:'content.png'}];
  request.artContext.references=[{source:2,roles:['style']},{source:5,roles:['subject']}];
  const session=flash(),answer=await planFlashArtDirection({payload:request,flash:session});
  assert.deepEqual(session.calls[0].images.map(image=>image.name),['content.png','style.png']);
  assert.deepEqual(answer.artDirection.editEnhancer.sourceOrder,[5,2]);
  assert.deepEqual(answer.nativeAnalysis.images.map(image=>image.originalIndex),[1,0]);
  assert.equal(session.calls[0].user.includes('<<image'),false);
  assert.match(session.calls[0].user,/<image1>用<image2>画风/);
});

test('nonempty current negative reaches the same native call with remapped image roles and unknown origin',async()=>{
  const request=payload();request.currentPrompt='图5用图2画风';
  request.images=[{dataUrl:PNG,name:'style.png'},{dataUrl:PNG,name:'content.png'}];
  request.artContext.references=[{source:2,roles:['style']},{source:5,roles:['subject']}];
  request.negativePrompt='  PRIVATE_EXCLUSION 不要图2的道具，不要<image5>多余人物；image 2衣饰\n';
  request.negativePromptSource='user-explicit'; // Unverified caller claims are not provenance.
  const session=flash(),answer=await planFlashArtDirection({payload:request,flash:session});
  assert.equal(session.calls.length,1);assert.equal(session.calls[0].system,FLASH_ART_SYSTEM);
  const sent=JSON.parse(session.calls[0].user.split('\n').slice(1).join('\n'));
  const remapped='  PRIVATE_EXCLUSION 不要<image2>的道具，不要<image1>多余人物；<image2>衣饰\n';
  assert.equal(sent.currentNegativePrompt,remapped);assert.equal(sent.negativePromptSource,'unknown');
  assert.match(sent.negativePromptUsage,/current image-generation exclusions, not objects to draw/);
  assert.match(sent.negativePromptUsage,/origin is unknown; do not claim the user personally wrote/);
  assert.match(sent.negativePromptUsage,/Do not clear or rewrite/);
  assert.deepEqual(sent.actualInputRoles,[{image:'<image1>',originalSource:5,role:'subject'},{image:'<image2>',originalSource:2,role:'style'}]);
  assert.equal(request.negativePrompt,'  PRIVATE_EXCLUSION 不要图2的道具，不要<image5>多余人物；image 2衣饰\n');
  assert.equal(answer.artDirection.prompt,canonical);assert.equal(answer.artDirection.editEnhancer.prompt,canonical);
  assert.deepEqual(answer.nativeAnalysis.negativePromptContext,{provided:true,source:'unknown',
    inputSHA256:createHash('sha256').update(request.negativePrompt).digest('hex'),
    modelContextSHA256:createHash('sha256').update(remapped).digest('hex')});
  assert.equal(JSON.stringify(answer.nativeAnalysis).includes('PRIVATE_EXCLUSION'),false);
});

test('empty, missing and whitespace-only negatives retain the exact pre-context native user string',async()=>{
  const expected='Use the two complete images actually supplied in this order: <image1> is the original content source; <image2> is only the artistic rendering reference.\n'
    + JSON.stringify({userRequest:'<image1>用<image2>画风',requirements:'',canvas:{width:1280,height:960},
      actualInputRoles:[{image:'<image1>',originalSource:1,role:'subject'},{image:'<image2>',originalSource:2,role:'style'}]});
  for(const negative of ['',undefined,'  \n\t']){
    const request=payload();request.negativePrompt=negative;
    const session=flash(),answer=await planFlashArtDirection({payload:request,flash:session});
    assert.equal(session.calls.length,1);assert.equal(session.calls[0].user,expected);
    assert.equal(session.calls[0].system,FLASH_ART_SYSTEM);assert.equal(answer.nativeAnalysis.negativePromptContext,undefined);
  }
});

test('text-only, NSFW, extra roles and other tasks retain their existing Flash business planners',()=>{
  for(const mutate of [r=>r.images=[],r=>r.nsfw=true,r=>r.artContext.references[1].roles=['pose'],r=>r.artContext.references[1].roles=['style','color'],r=>r.artContext.task='preserve',r=>r.purpose='art-director-review']){
    const request=payload();mutate(request);assert.equal(isFlashArtDirectionRequest(request),false);
  }
});

test('invalid inputs/native output fail once without repair, short rewrite or model release claims',async()=>{
  for(const mutate of [r=>r.artContext.references[1].source=1,r=>r.images[0].dataUrl='https://example.com/image.png',r=>r.images[0].dataUrl='data:image/png;base64,YWJjZA==',r=>r.artContext.references[0].excludedRoles=['subject'],r=>r.negativePrompt={},r=>r.negativePrompt='data:image/png;base64,YWJjZA==']){
    const request=payload();mutate(request);const session=flash();await assert.rejects(planFlashArtDirection({payload:request,flash:session}));assert.equal(session.calls.length,0);
  }
  for(const answer of [native({prompt:'short without tags'}),native({prompt:'<image1> <image2> <image3>'}),native({renderingClass:'invented'}),native({prompt:'<image1><image2>'+'x'.repeat(12000)})]){
    const session=flash(answer);await assert.rejects(planFlashArtDirection({payload:payload(),flash:session}));assert.equal(session.calls.length,1);
  }
  const session=flash({...native(),resourcesReleased:true,generationReady:true,modelIdentity:{id:'model-assertion'}});
  const answer=await planFlashArtDirection({payload:payload(),flash:session});
  assert.equal(answer.artDirection.editEnhancer.resourcesReleased,undefined);assert.equal(answer.artDirection.editEnhancer.modelIdentity,undefined);
});

async function renderer(raw,strict=true){
  const calls=[];let pixels=0;
  class Image {set src(value){pixels++;if(strict)throw Error('Native branch must not inspect pixels');this.naturalWidth=800;this.naturalHeight=1000;queueMicrotask(()=>this.onload());}}
  const box={TextEncoder,crypto:webcrypto,AbortController,queueMicrotask,setTimeout,clearTimeout,Image,
    document:{createElement(){pixels++;if(strict)throw Error('Native branch must not use canvas');return {getContext:()=>({fillRect(){},drawImage(){},getImageData:()=>({data:[80,100,120,255]})}),toDataURL:()=>PNG};}},
    localStorage:{getItem(){return null;}},NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})},
    electronAPI:{promptAssistantGetStatus:async()=>({ok:true,analysisBackend:'strata',supportsOriginalImages:true}),promptAssistantReverseImagePrompt:async request=>{calls.push(request);return {ok:true,data:clone(raw)};}}};
  box.window=box;runInContext(await fs.readFile(join(RENDERER,'art-direction.workflow.js'),'utf8'),createContext(box));
  return {api:box.NovaFlowArtDirection,calls,get pixels(){return pixels;}};
}
const context=()=>({state:{provider:'local',mode:'img2img',prompt:'图1用图2画风',negativePrompt:'  user negative only\n',drawingAnalysisEngine:'local',drawingTask:'style',width:1280,height:960,localQwen21Variant:'turbo'},references:[{drawingRole:'subject',dataUrl:PNG},{drawingRole:'style',dataUrl:PNG}],referenceLimit:10,generationSurface:'drawing'});
async function produced(answer=native()){return released(await planFlashArtDirection({payload:payload(),flash:flash(answer)}));}

test('native renderer preserves exact canonical/negative, no pixel workers, and skips extra review',async()=>{
  const h=await renderer(await produced()),c=context(),prepared=await h.api.prepare(c);
  assert.equal(prepared.plan.prompt,canonical);assert.equal(prepared.plan.editEnhancer.prompt,canonical);
  assert.equal(prepared.promptSnapshot.prompt,canonical);assert.equal(prepared.promptSnapshot.negativePrompt,c.state.negativePrompt);
  assert.equal(prepared.references[0].dataUrl,PNG);assert.equal(prepared.references[1].dataUrl,PNG);
  assert.equal(prepared.renderingPolicy,undefined);assert.equal(prepared.turboGuidance,undefined);assert.equal(h.pixels,0);
  assert.equal((await h.api.review(prepared,PNG)).skipped,true);assert.equal(h.calls.length,1);
});

test('negative analysis context never rewrites the native answer or compiled generation exclusions',async()=>{
  const request=payload();request.negativePrompt='  禁止图2的服装，do not remove this exclusion\n';
  const session=flash(),answer=await planFlashArtDirection({payload:request,flash:session});
  const h=await renderer(released(answer)),c=context();c.state.negativePrompt=request.negativePrompt;
  const prepared=await h.api.prepare(c);
  assert.equal(session.calls.length,1);assert.equal(h.calls.length,1);
  assert.equal(prepared.promptSnapshot.prompt,canonical);assert.equal(prepared.promptSnapshot.negativePrompt,request.negativePrompt);
  prepared.applyPromptToState();
  assert.equal(c.state.negativePrompt,request.negativePrompt);assert.equal(prepared.state.negativePrompt,request.negativePrompt);
  assert.equal(prepared.renderingPolicy,undefined);assert.equal(prepared.turboGuidance,undefined);
});

test('native renderer rejects mismatched canonical copies, cropped references and unconfirmed handoff',async()=>{
  for(const mutate of [r=>r.artDirection.editEnhancer.prompt='short <image1> <image2>',r=>r.artDirection.editEnhancer.resourcesReleased=false,r=>r.artDirection.editEnhancer.modelIdentity.id='wrong',r=>r.artDirection.references[1].uses[0].box=[0,0,500,1000]]){
    const raw=await produced();mutate(raw);const h=await renderer(raw);await assert.rejects(h.api.prepare(context()));assert.equal(h.pixels,0);
  }
});

test('unchanged NoAI reuse retains exact native text/provenance; changing inputs invalidates its CFG policy',async()=>{
  const h=await renderer(await produced()),c=context(),first=await h.api.prepare(c);
  first.applyPromptToState();c.state.drawingAnalysisEngine='direct';
  const again=await h.api.prepare(c);
  assert.equal(again.promptSnapshot.prompt,canonical);assert.equal(again.promptSnapshot.negativePrompt,'  user negative only\n');
  assert.equal(h.calls.length,1);assert.equal(h.api.generationOptions(again).qwen21NativeGuidance.cfg,3);
  assert.deepEqual(clone(again.nativeExecution.modelIdentity),identity);
  c.state.negativePrompt+='modified';const changed=await h.api.prepare(c);
  assert.equal(h.api.generationOptions(changed).qwen21NativeGuidance,undefined);
  assert.throws(first.assertCurrent,/已变化/);
});

test('native marker remapping changes only image slots when execution order differs',async()=>{
  const raw=await produced();raw.artDirection.references.reverse();raw.artDirection.editEnhancer.sourceOrder=[2,1];
  raw.artDirection.prompt=raw.artDirection.editEnhancer.prompt='  Content <image2>; style <image1>.\n';
  const h=await renderer(raw),prepared=await h.api.prepare(context());
  assert.equal(prepared.promptSnapshot.prompt,'  Content <image1>; style <image2>.\n');
});

test('manual CFG changed during analysis wins at native writeback for normal and Turbo',async()=>{
  const models=await modelApi();
  for(const variant of ['standard','turbo']){
    const h=await renderer(await produced()),c=context();c.state.localQwen21Variant=variant;
    const prepared=await h.api.prepare(c),route=variant==='turbo'?'qwen-2.1-turbo':'qwen-2.1';
    c.state.samplingOverrides={[route+':img2img']:{cfg:1}};
    prepared.applyPromptToState();
    assert.equal(prepared.state.samplingOverrides[route+':img2img'].cfg,1);
    assert.equal(models.localSamplingFor(prepared.state,'img2img','',undefined,'drawing',h.api.generationOptions(prepared)).cfg,1);
  }
});

let runtime;
after(async()=>{if(runtime){assert.equal(dirname(runtime),resolve(tmpdir()));assert.ok(basename(runtime).startsWith('nf-native-art-cpu-'));await fs.rm(runtime,{recursive:true,force:true});}});
async function modelApi(){const box={};runInContext(await fs.readFile(join(RENDERER,'art-generate-model.resource.js'),'utf8'),createContext(box));return box.NovaFlowArtGenerateModels;}
test('panel and real CPU workflow builder keep CFG3/standard25/Turbo8 sigmas, user manual1/4 and raw negative',async()=>{
  runtime=await fs.mkdtemp(join(resolve(tmpdir()),'nf-native-art-cpu-'));
  for(const name of ['qwen21-turbo.workflow.js','comfyui-workflow-credit-cost.js','art-quality-profile.workflow.js','art-reference-compiler.workflow.js','art-generate-provider.workflow.js','art-generate-model.resource.js'])await fs.copyFile(join(RENDERER,name),join(runtime,name));
  const instrumented=instrumentModule(await fs.readFile(join(RENDERER,'novaflow-brand-runtime.js'),'utf8'),{moduleName:'novaflow-brand-runtime',forceNames:['buildArtGenerateRunWorkflow']});
  await fs.writeFile(join(runtime,'novaflow-brand-runtime.js'),instrumented.code);
  const info={NovaFlowGGUFBF16Loader:{input:{required:{unet_name:[['qwen-image-2.1-UC-BF16.gguf','Qwen-Image-2.1-Turbo-BF16.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_bf16_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},QwenImage21Cache:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
  const host=await createWorkflowHost({rendererDir:runtime,objectInfo:info}),models=await modelApi();
  for(const renderingClass of ['anime','animated-3d','painterly','other']){
    const expectedPrompt=renderingClass==='other'?canonical+'Complete native rendering instructions. '.repeat(180)+'\nEND':canonical;
    const h=await renderer(await produced(native({renderingClass,prompt:expectedPrompt}))),c=context();
    if(renderingClass==='other')c.state.negativePrompt='';
    const prepared=await h.api.prepare(c),policy=h.api.generationOptions(prepared);
    for(const variant of ['standard','turbo'])for(const manual of [undefined,1,4]){
      const route=variant==='turbo'?'qwen-2.1-turbo':'qwen-2.1';
      const state={...prepared.state,localDrawEngine:'qwen-2.1',localQwen21Variant:variant,seed:77,randomSeed:false,...(manual===undefined?{}:{samplingOverrides:{[route+':img2img']:{cfg:manual}}})};
      const panel=models.localSamplingFor(state,'img2img','',undefined,'drawing',policy);
      assert.equal(panel.cfg,manual??3);assert.equal(panel.steps,variant==='turbo'?8:25);assert.equal(panel.cfgManual,manual!==undefined);
      const graph=clone(await host.buildGraph({module:'novaflow-brand-runtime',method:'buildArtGenerateRunWorkflow',options:{__args:['local','img2img',['source.png','style.png'],'QA',prepared.promptSnapshot.prompt,prepared.promptSnapshot.negativePrompt,'cpu-test',[{width:1280,height:960},{width:768,height:1344}],state,10,policy]}}));
      assert.equal(graph['5'].inputs.prompt,expectedPrompt);assert.equal(graph['5'].inputs.negative_prompt,c.state.negativePrompt);assert.equal(graph['7'].inputs.cfg,manual??3);
      if(variant==='turbo')assert.equal(graph[graph['7'].inputs.sigmas[0]].inputs.sigmas,'1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0');
      else assert.equal(graph['7'].inputs.steps,25);
    }
  }
  const ordinary={provider:'local',localDrawEngine:'qwen-2.1',localQwen21Variant:'turbo'};
  assert.equal(models.localSamplingFor(ordinary,'img2img','').cfg,1);
  const policy={taskProfile:'art-direction',styleReferencePriority:true,referenceRoles:['subject','style'],qwen21NativeGuidance:{kind:'qwen21-strata-native',version:'flash-native-v1',cfg:3}};
  assert.equal(models.localSamplingFor(ordinary,'txt2img','',undefined,'drawing',policy).cfg,1);
  assert.equal(models.localSamplingFor(ordinary,'img2img','',undefined,'ui',policy).cfg,1);
});
