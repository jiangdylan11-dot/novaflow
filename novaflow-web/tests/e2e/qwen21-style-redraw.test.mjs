// Style redraw: the online brain writes three short texts, the program assembles the prompt, the local generator runs it at CFG 3.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {buildQwen21NativeRewrite,buildStyleRedrawPrompt,buildStyleRelight,compileQwen21NativeRewrite,isStyleRedrawRoles,QWEN21_NATIVE_REWRITE,QWEN21_STYLE_REDRAW_POLICY,STYLE_NEGATIVE,STYLE_POLISH} from '../../packages/shared/src/qwen21-native-rewrite.mjs';

let passed=0,failed=0;
async function test(name,fn){
  try{await fn();passed++;console.log('ok  '+name);}
  catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}
}
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const input={promptContract:QWEN21_NATIVE_REWRITE,qwenPromptMode:'img2img',currentPrompt:'把人物转成这个风格',requirements:'',negativePrompt:'',supportsNegativePrompt:true};
const system=prepared=>prepared.body.input[0].content[0].text;
const description='flat cel-shaded illustration, clean thin line art, hard two-tone shadows, warm-toned palette, flat smooth skin, hair in crisp grouped strands, moderate detail';
const content='a young woman with long wavy auburn hair, winking with a soft smile, a small beauty mark on her cheek, wearing a striped top, holding up a plastic cup, seated in an airport terminal at night';
const mood='warm lamp glow from the left, soft orange-pink palette, cosy atmosphere, soft but clear contrast';
const redraw=buildStyleRedrawPrompt(description,mood,content);
const answer=(style=description,text=content,light=mood)=>({output_text:JSON.stringify({style_description:style,mood_description:light,content_description:text})});
const compile=(overrides={},response=answer(),roles=['subject','style'])=>compileQwen21NativeRewrite(response,buildQwen21NativeRewrite({...input,...overrides},'model',roles));

await test('style mode is chosen only for one subject first followed by style references',()=>{
  for(const roles of [['subject','style'],['subject','style','style']]){
    const prepared=buildQwen21NativeRewrite(input,'model',roles);
    assert.equal(prepared.styleRedraw,true,roles.join());assert.equal(prepared.referenceCount,roles.length);assert.equal(prepared.body.temperature,0);
    assert.deepEqual(prepared.body.text.format.schema.required,['style_description','mood_description','content_description']);
  }
  for(const roles of [['subject'],['style'],['style','subject'],['subject','pose'],['subject','style','pose'],['subject','subject','style'],[]])
    assert.equal(buildQwen21NativeRewrite(input,'model',roles).styleRedraw,undefined,roles.join());
  assert.equal(buildQwen21NativeRewrite({...input,qwenPromptMode:'txt2img'},'model',['subject','style']).styleRedraw,undefined);
  assert.equal(isStyleRedrawRoles(['subject','style']),true);
});

await test('the style system asks only for the three texts and bans the wording that darkens the result',()=>{
  const text=system(buildQwen21NativeRewrite(input,'model',['subject','style']));
  for(const needle of ['25-60 words','40-80 words','line weight','shading method','highlight logic','colour temperature','hair and skin treatment','detail level','20-40 words','lighting design','colour temperature stated outright as cool, neutral or warm','key light direction','shadow colour','contrast level','sky or daylight','exact hair colour','dark, dim, low-key, moody, desaturated, muted, high-key, daylight, pale','half-lidded','any wink','facial marks','requested_changes','__NF...__'])
    assert.ok(text.includes(needle),needle);
  assert.doesNotMatch(text,/rendering medium|rewritten_prompt/);
  assert.match(system(buildQwen21NativeRewrite(input,'model',['subject'])),/rendering medium/,'ordinary edits keep their own rule');
});

await test('the program assembles the prompt from the three slots, then the fixed lighting and finish blocks',()=>{
  assert.ok(redraw.startsWith('Loosely based on <image1> (use it only for the person, pose and scene;'));
  assert.ok(redraw.includes(`An illustration in this style: ${description}. ${content}. High quality key visual`));
  assert.ok(redraw.includes(`take only the lighting design from <image2>: ${mood}. Express it`));
  assert.ok(redraw.includes('never yellow or orange skin'));assert.ok(redraw.includes('is taken from <image2>, never from <image1>'));assert.ok(redraw.includes('warm practical lights are repainted cool.'));assert.doesNotMatch(redraw,/cool lights are repainted warm/);assert.ok(redraw.includes('Never a uniform colour cast'));
  assert.ok(redraw.endsWith(`${buildStyleRelight(mood)} ${STYLE_POLISH}`));
  assert.doesNotMatch(redraw,/keep the real light sources/,'the photo\'s light is not kept');
  assert.doesNotMatch(STYLE_POLISH,/beauty mark|\bcup\b|terminal/,'the finish block fits any picture');
  assert.equal(buildStyleRedrawPrompt(description+'. ',mood+'.',content+'.'),redraw,'a closing full stop is not doubled');
  const several=buildStyleRedrawPrompt(description,mood,content,3);
  assert.ok(several.includes('lighting design from <image2> and <image3>:'));
  assert.equal(compile({},answer(),['subject','style','style']).modelPrompt,several);
});

await test('the compiled result carries the policy, the one prompt and a program-owned negative',()=>{
  assert.match(STYLE_NEGATIVE,/skin pores.*3d render.*grainy, noise.*uniform color wash.*yellow skin, orange skin.*amber tint.*yellow tint$/);
  const result=compile();
  assert.equal(result.modelPromptPolicy,QWEN21_STYLE_REDRAW_POLICY);assert.equal(result.promptContract,QWEN21_NATIVE_REWRITE);
  assert.equal(result.displayPrompt,redraw);assert.equal(result.modelPrompt,redraw);assert.equal(result.styleDescription,description);assert.equal(result.contentDescription,content);assert.equal(result.moodDescription,mood);
  assert.equal(result.translationValidation,'native-edit-and-literals');assert.equal(result.modelPromptLanguage,'en');
  assert.equal(result.hasNegativePrompt,true);assert.equal(result.negativePrompt,STYLE_NEGATIVE);
  assert.equal(compile({negativePrompt:'水印'}).negativePrompt,'水印, '+STYLE_NEGATIVE,'the user text comes first');
  const again='水印, '+STYLE_NEGATIVE;assert.equal(compile({negativePrompt:again}).negativePrompt,again,'a rerun does not grow the negative');
  assert.equal(compile({supportsNegativePrompt:false}).negativePrompt,undefined);
});

await test('an incomplete style answer is rejected before it can be applied',()=>{
  assert.throws(()=>compile({},answer(' ')),/style description missing/);
  assert.throws(()=>compile({},answer(description,' ')),/content description missing/);
  assert.throws(()=>compile({},answer(description,content,' ')),/mood description missing/);
  assert.throws(()=>compile({},{output_text:JSON.stringify({style_description:description,rewritten_prompt:redraw})}),/fields invalid/);
  assert.throws(()=>compile({},{output_text:'not json'}),/complete JSON/);
  assert.throws(()=>compile({},answer(description,content+' 人物微笑')),/not English/);
});

await test('the browser checks accept exactly the policy the server exports',()=>{
  for(const file of ['../../renderer/novaflow-smart-ai.js','../../renderer/novaflow-web-runtime.js'])assert.ok(read(file).includes(`'${QWEN21_STYLE_REDRAW_POLICY}'`),file);
});

const modelSandbox={module:{exports:{}}};
runInContext(read('../../renderer/art-generate-model.resource.js'),createContext(modelSandbox));
const models=modelSandbox.module.exports;
const styleRun={taskProfile:'art-direction',referenceRoles:['subject','style']};

await test('one role rule sets CFG 3 on both 2.1 routes unless the user typed a value',()=>{
  assert.equal(models.STYLE_REDRAW_CONTENT_PIXELS,250000);assert.equal(models.STYLE_REDRAW_WORKING_PIXELS,1536*1152);
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

await test('the style run takes 0.25 MP content, a 1 MP style image, a 1536 x 1152 canvas delivered at W / H and CFG 3',()=>{
  const graph=build(styleRun);
  assert.equal(sampler(graph).inputs.cfg,3);assert.equal(graph['5'].inputs.negative_prompt,STYLE_NEGATIVE);
  assert.equal(graph['200'].inputs.width,576);assert.equal(graph['200'].inputs.height,416);
  assert.deepEqual(Array.from(sampler(graph).inputs.latent_image),['6',0]);assert.equal(graph['6'].inputs.width,1536);assert.equal(graph['6'].inputs.height,1152);
  assert.equal(graph['9'].inputs.width,1280);assert.equal(graph['9'].inputs.height,960);
  const tall=build(styleRun,{state:{width:960,height:1280}});assert.equal(tall['6'].inputs.width,1152);assert.equal(tall['6'].inputs.height,1536);
  const edit=build({taskProfile:'art-direction',referenceRoles:['subject','reference']});assert.equal(edit['9'],undefined,'an ordinary edit keeps its own working size');
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

await test('only a local style redraw gets the tone step, and it can be redone from the untouched picture',()=>{
  assert.match(source,/runProvider === "local" \? artStyleToneReference\(options\.drawingPrepared\) : ""/);
  assert.match(source,/toneSourceUrl: rawImageUrl, toneReferenceUrl: toneReference, toneStrength/);
  assert.match(source,/gradeArtStyleResult\(result\.toneSourceUrl, result\.toneReferenceUrl, strength\)/);
  assert.match(read('../../renderer/spine-split-runtime.js'),/replaceSourceResourceImage,/);
  assert.match(read('../../renderer/index.html'),/art-tone-match\.js/);
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
  assert.equal(review.modelPrompt,redraw);assert.ok(review.prompt.startsWith('Loosely based on <image2> (use it'),'the page numbers the photo as slot 2');
  tools.confirmImageReview(review.reviewId);
  assert.deepEqual(Array.from(prepared.references,ref=>ref.name),['photo.png','style.png']);assert.deepEqual(Array.from(prepared.referenceRolePlan.roles),['subject','style']);
  assert.equal(prepared.promptSnapshot.prompt,redraw);assert.equal(prepared.promptOwnsReferenceRoles,true);assert.equal(rt.state.negativePrompt,STYLE_NEGATIVE);
});
console.log(`${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
