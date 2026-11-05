// Style redraw: the online brain writes the style words, the local generator runs them at CFG 3.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {buildQwen21NativeRewrite,compileQwen21NativeRewrite,isStyleRedrawRoles,QWEN21_NATIVE_REWRITE,QWEN21_STYLE_REDRAW_POLICY,STYLE_NEGATIVE} from '../../packages/shared/src/qwen21-native-rewrite.mjs';

let passed=0,failed=0;
async function test(name,fn){
  try{await fn();passed++;console.log('ok  '+name);}
  catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}
}
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const input={promptContract:QWEN21_NATIVE_REWRITE,qwenPromptMode:'img2img',currentPrompt:'把人物转成这个风格',requirements:'',negativePrompt:'',supportsNegativePrompt:true};
const system=prepared=>prepared.body.input[0].content[0].text;
const description='flat cel illustration, visible thin dark lines, hard two-tone shading, soft high-key warm light, clean palette, large simple eyes, smooth skin, chunky hair shapes, moderate detail';
const redraw=`Redraw <image1> entirely as an illustration in this style: ${description}. <image2> shows this style; match its rendering, not its content. Keep the person and scene of <image1>: identity and facial features, expression, hairstyle, clothing, held objects, pose, framing and background, all redrawn in that style. Keep the source's natural skin tone. Do not copy any character, clothing, objects, text or scenery from <image2>.`;
const answer=(text=redraw,style=description)=>({output_text:JSON.stringify({style_description:style,rewritten_prompt:text})});
const compile=(overrides={},response=answer(),roles=['subject','style'])=>compileQwen21NativeRewrite(response,buildQwen21NativeRewrite({...input,...overrides},'model',roles));

await test('style mode is chosen only for one subject first followed by style references',()=>{
  for(const roles of [['subject','style'],['subject','style','style']]){
    const prepared=buildQwen21NativeRewrite(input,'model',roles);
    assert.equal(prepared.styleRedraw,true,roles.join());assert.equal(prepared.referenceCount,roles.length);assert.equal(prepared.body.temperature,0);
    assert.deepEqual(prepared.body.text.format.schema.required,['style_description','rewritten_prompt']);
  }
  for(const roles of [['subject'],['style'],['style','subject'],['subject','pose'],['subject','style','pose'],['subject','subject','style'],[]])
    assert.equal(buildQwen21NativeRewrite(input,'model',roles).styleRedraw,undefined,roles.join());
  assert.equal(buildQwen21NativeRewrite({...input,qwenPromptMode:'txt2img'},'model',['subject','style']).styleRedraw,undefined);
  assert.equal(isStyleRedrawRoles(['subject','style']),true);
});

await test('the style system asks for concrete rendering words and drops the preserve-medium clause',()=>{
  const text=system(buildQwen21NativeRewrite(input,'model',['subject','style']));
  for(const needle of ['25-60 words','medium','line art','shading','colour temperature','palette','eye drawing style','skin treatment','hair rendering','detail level','never highly saturated','iris colours',"Keep the source's natural skin tone.",'Redraw <image1> entirely as an illustration in this style: {style_description}.','<image2> shows this style; match its rendering, not its content.','Do not copy any character, clothing, objects, text or scenery from <image2>.','<image3>'])
    assert.ok(text.includes(needle),needle);
  assert.doesNotMatch(text,/rendering medium/);
  assert.match(system(buildQwen21NativeRewrite(input,'model',['subject'])),/rendering medium/,'ordinary edits keep their own rule');
});

await test('the compiled result carries the policy, the one prompt and a program-owned negative',()=>{
  const result=compile();
  assert.equal(result.modelPromptPolicy,QWEN21_STYLE_REDRAW_POLICY);assert.equal(result.promptContract,QWEN21_NATIVE_REWRITE);
  assert.equal(result.displayPrompt,redraw);assert.equal(result.modelPrompt,redraw);assert.equal(result.styleDescription,description);
  assert.equal(result.translationValidation,'native-edit-and-literals');assert.equal(result.modelPromptLanguage,'en');
  assert.equal(result.hasNegativePrompt,true);assert.equal(result.negativePrompt,STYLE_NEGATIVE);
  assert.equal(compile({negativePrompt:'水印'}).negativePrompt,'水印, '+STYLE_NEGATIVE,'the user text comes first');
  const again='水印, '+STYLE_NEGATIVE;assert.equal(compile({negativePrompt:again}).negativePrompt,again,'a rerun does not grow the negative');
  assert.equal(compile({supportsNegativePrompt:false}).negativePrompt,undefined);
});

await test('an incomplete style answer is rejected before it can be applied',()=>{
  assert.throws(()=>compile({},answer(redraw,' ')),/style description missing/);
  assert.throws(()=>compile({},answer(redraw.replaceAll('<image2>','the reference'))),/lost an image role/);
  assert.throws(()=>compile({},answer(),['subject','style','style']),/lost an image role/);
  assert.throws(()=>compile({},{output_text:JSON.stringify({rewritten_prompt:redraw})}),/fields invalid/);
  assert.throws(()=>compile({},answer(redraw+' 人物微笑')),/not English/);
});

await test('the browser checks accept exactly the policy the server exports',()=>{
  for(const file of ['../../renderer/novaflow-smart-ai.js','../../renderer/novaflow-web-runtime.js'])assert.ok(read(file).includes(`'${QWEN21_STYLE_REDRAW_POLICY}'`),file);
});

const modelSandbox={module:{exports:{}}};
runInContext(read('../../renderer/art-generate-model.resource.js'),createContext(modelSandbox));
const models=modelSandbox.module.exports;
const styleRun={taskProfile:'art-direction',referenceRoles:['subject','style']};

await test('one role rule sets CFG 3 on both 2.1 routes unless the user typed a value',()=>{
  const turbo={provider:'local',localDrawEngine:'qwen-2.1',localQwen21Variant:'turbo'},full={provider:'local',localDrawEngine:'qwen-2.1'};
  assert.equal(models.localSamplingFor(turbo,'img2img','',undefined,'drawing',styleRun).cfg,3);
  assert.equal(models.localSamplingFor(full,'img2img','',undefined,'drawing',styleRun).cfg,3);
  assert.equal(models.localSamplingFor(turbo,'img2img','',undefined,'drawing',{...styleRun,referenceRoles:['subject','style','style']}).cfg,3);
  for(const policy of [undefined,{taskProfile:'art-direction',referenceRoles:['subject']},{...styleRun,referenceRoles:['style','subject']},{...styleRun,referenceRoles:['subject','pose']},{...styleRun,taskProfile:'ui-design'}])
    assert.equal(models.localSamplingFor(turbo,'img2img','',undefined,'drawing',policy).cfg,1);
  assert.equal(models.localSamplingFor(turbo,'txt2img','',undefined,'drawing',styleRun).cfg,1);
  assert.equal(models.localSamplingFor(turbo,'img2img','',undefined,'ui',styleRun).cfg,1);
  const manual={...turbo,samplingOverrides:{'qwen-2.1-turbo:img2img':{cfg:2}}};
  assert.equal(models.localSamplingFor(manual,'img2img','',undefined,'drawing',styleRun).cfg,2);
});

const source=read('../../renderer/novaflow-brand-runtime.js');
const builderCode=source.slice(source.indexOf('  const ART_QWEN21_UNETS ='),source.indexOf('  // UI design on a Qwen-Image-2.1 node:'));
function build(options,{state={},sizes=[{width:2000,height:1500},{width:2000,height:3000}],names=['a.png','b.png']}={}){
  const info={NovaFlowGGUFBF16Loader:{input:{required:{unet_name:[['qwen-image-2.1-UC-BF16.gguf','Qwen-Image-2.1-Turbo-BF16.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_bf16_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
  const vm=createContext({});vm.window={electronAPI:{__objectInfoSync:()=>info},NovaFlowArtGenerateModels:models};
  runInContext(read('../../renderer/qwen21-turbo.workflow.js'),vm);vm.window.NovaFlowQwen21Turbo=vm.NovaFlowQwen21Turbo;
  runInContext(builderCode,vm);
  const run={width:1280,height:960,localQwen21Variant:'turbo',negativePrompt:STYLE_NEGATIVE,...state};
  vm.run=run;vm.names=names;vm.sizes=sizes;vm.options=options;vm.sampling=models.localSamplingFor({...run,provider:'local',localDrawEngine:'qwen-2.1'},'img2img',run.negativePrompt,undefined,'drawing',options);
  return runInContext("buildArtQwen21Workflow('img2img',names,'QA','prompt',run,sizes,options,run.negativePrompt,sampling)",vm).workflow;
}
const sampler=graph=>Object.values(graph).find(node=>node.class_type==='SamplerCustom');

await test('the style run keeps content at the working size, samples its latent and runs CFG 3',()=>{
  const graph=build(styleRun);
  assert.equal(sampler(graph).inputs.cfg,3);assert.equal(graph['5'].inputs.negative_prompt,STYLE_NEGATIVE);
  assert.equal(graph['200'].inputs.width,1280);assert.equal(graph['200'].inputs.height,960);
  assert.deepEqual(Array.from(sampler(graph).inputs.latent_image),['5',2]);assert.equal(graph['6'],undefined);
  assert.ok(graph['201'].inputs.width*graph['201'].inputs.height<=1048576);assert.ok(graph['201'].inputs.width*graph['201'].inputs.height>700000);
  assert.equal(graph['5'].inputs.prompt,'prompt');
});

await test('several style images share the 1.5 MP total and an ordinary edit stays as it was',()=>{
  const graph=build({...styleRun,referenceRoles:['subject','style','style']},{sizes:[{width:2000,height:1500},{width:2000,height:3000},{width:3000,height:2000}],names:['a.png','b.png','c.png']});
  const pixels=id=>graph[id].inputs.width*graph[id].inputs.height;
  assert.ok(pixels('201')+pixels('202')<=1500000);assert.equal(sampler(graph).inputs.cfg,3);
  const edit=build({taskProfile:'art-direction',referenceRoles:['subject','reference']});
  assert.equal(sampler(edit).inputs.cfg,1);assert.ok(edit['201'].inputs.width*edit['201'].inputs.height<=500000);
});

await test('a reviewed draft reports the roles it will run with, and the draft prompt owns the role text',()=>{
  const box={NovaFlowArtGenerateModels:models};box.window=box;
  runInContext(read('../../renderer/art-prepare.workflow.js'),createContext(box));
  const draft={references:[{dataUrl:'x'},{dataUrl:'y'}],referenceRolePlan:{roles:['subject','style']}};
  assert.deepEqual(JSON.parse(JSON.stringify(box.NovaFlowArtPrepare.generationOptions(draft))),{taskProfile:'art-direction',referenceRoles:['subject','style'],styleRedraw:true});
  assert.match(source,/prepared\?\.promptOwnsReferenceRoles===true \? qualityCompiled\.prompt/);
});

await test('a style image in slot 1 still runs subject first, while the page keeps its own slot numbers',async()=>{
  const png=c=>'data:image/png;base64,'+c,refs=[{drawingRole:'style',dataUrl:png('AA=='),name:'style.png'},{drawingRole:'subject',dataUrl:png('BB=='),name:'photo.png'}];
  let prepared=null,request=null;
  const rt={state:{active:true,provider:'local',mode:'img2img',prompt:'用<image1>的风格重绘<image2>',negativePrompt:'',width:512,height:512,count:1,running:false,localQwen21Variant:'turbo'},references:()=>refs,selectedResult:()=>null,
    captureContext(){return {state:this.state,generationSurface:'drawing',routeRevision:1,referenceRevision:1};},captureAgentPreparedSnapshot:()=>({}),replaceAgentPrepared(_handle,value){prepared=value;return {};},restoreAgentPrepared(){},isAgentPreparedReplacementCurrent:()=>true,render(){}};
  const root={crypto:globalThis.crypto,console,TextEncoder,setTimeout,clearTimeout,__NovaFlowArtGenerate:rt,document:{querySelectorAll:()=>[]},NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1-turbo'})},
    NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'api',modelId:'m',epoch:1})}}},electronAPI:{onlineVisionArtAvailableSync:()=>true,captureFoartSessionGuard:()=>()=>true},
    __NovaFlowSmartAI:{async optimizeForAgent(options){request=options;return {prompt:redraw,displayPrompt:redraw,negativePrompt:STYLE_NEGATIVE,analysisBackend:'runninghub',optimization:{reviewRequired:true,modelPromptPolicy:QWEN21_STYLE_REDRAW_POLICY}};}}};
  root.window=root;runInContext(read('../../renderer/xiaotao-foart-tools.js'),createContext(root));
  const tools=root.NovaFlowFoartTools,roles=Array.from(tools.captureDrawingReferenceRoles());
  const review=await tools.execute({action:'image_optimize',prompt:rt.state.prompt,generationMode:'img2img'},{provider:'api',modelId:'m',onlineBusiness:{},selectionStillCurrent:()=>true,projectStillCurrent:()=>true,currentDrawingVisionOnly:true,referenceSource:'page',referenceRoles:roles});
  assert.deepEqual(Array.from(request.images,image=>image.role),['subject','style']);assert.equal(request.prompt,'用<image2>的风格重绘<image1>');
  assert.equal(review.modelPrompt,redraw);assert.ok(review.prompt.startsWith('Redraw <image2> entirely'),'the page numbers the photo as slot 2');
  tools.confirmImageReview(review.reviewId);
  assert.deepEqual(Array.from(prepared.references,ref=>ref.name),['photo.png','style.png']);assert.deepEqual(Array.from(prepared.referenceRolePlan.roles),['subject','style']);
  assert.equal(prepared.promptSnapshot.prompt,redraw);assert.equal(prepared.promptOwnsReferenceRoles,true);assert.equal(rt.state.negativePrompt,STYLE_NEGATIVE);
});
console.log(`${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
