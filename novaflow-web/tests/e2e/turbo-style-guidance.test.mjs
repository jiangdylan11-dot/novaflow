import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createWorkflowHost} from '../../worker/src/comfy/workflow-host.mjs';
import {instrumentModule} from '../../tools/instrument-workflow-module.mjs';

const read=name=>readFileSync(new URL(`../../renderer/${name}`,import.meta.url),'utf8');
const brand=read('novaflow-brand-runtime.js');
const serial=value=>JSON.parse(JSON.stringify(value));
const modelContext=createContext({});runInContext(read('art-generate-model.resource.js'),modelContext);
const models=modelContext.NovaFlowArtGenerateModels;
const sigmas='1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0';
const styleOptions={taskProfile:'art-direction',referenceRoles:['subject','style'],styleReferencePriority:true,qwen21TurboGuidance:{renderingClass:'anime',cfg:3}};
const reference=(id,role)=>({dataUrl:`data:image/png;base64,${Buffer.from(id).toString('base64')}`,drawingRole:role,name:id+'.png'});
const refs=()=>[reference('subject','subject'),reference('style','style')];
const state=(extra={})=>({provider:'local',mode:'img2img',localDrawEngine:'qwen-2.1',localQwen21Variant:'turbo',prompt:'图1用图2画风',negativePrompt:'avoid watermark',drawingAnalysisEngine:'local',width:1280,height:960,seed:957282577,randomSeed:false,nsfw:false,...extra});
const use=role=>({role,detail:`observed ${role}`,target:'衣服',box:[0,0,1000,1000],samples:role==='style'?[[0,0,180,180],[210,0,390,180],[400,0,580,180],[600,0,780,180]]:[]});
function plan(renderingClass='anime'){
  return {schema:'nf.art.direction.v1',summary:'按图采用画风',prompt:'人物重绘',preserve:[],exclude:[],clarification:'',references:[{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}],editEnhancer:{kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'将<image1>按<image2>的实际画风整体重绘。',sourceOrder:[1,2],renderingClass}};
}
function env(answer=plan()){
  const calls=[];
  class Image {set src(value){this.url=value;this.naturalWidth=800;this.naturalHeight=1000;queueMicrotask(()=>this.onload());}}
  const document={createElement(tag){assert.equal(tag,'canvas');const c={width:0,height:0};c.getContext=()=>({fillRect(){},drawImage(){},getImageData:()=>({data:[80,100,120,255]})});c.toDataURL=()=>`data:image/png;base64,${Buffer.from(String(c.width)).toString('base64')}`;return c;}};
  const sandbox={console,Image,document,TextEncoder,crypto:webcrypto,AbortController,queueMicrotask,setTimeout,clearTimeout,
    NovaFlowArtGenerateModels:models,electronAPI:{promptAssistantReverseImagePrompt:async request=>{calls.push(request);return {ok:true,data:{artDirection:answer}};}}};
  sandbox.window=sandbox;runInContext(read('art-direction.workflow.js'),createContext(sandbox));
  return {api:sandbox.NovaFlowArtDirection,sandbox,calls};
}
const context=(s,r)=>({state:s,references:r,referenceLimit:10,generationSurface:'drawing'});
const sampling=(s,policy)=>models.localSamplingFor(s,s.mode,undefined,undefined,'drawing',policy);
const info={NovaFlowGGUFBF16Loader:{input:{required:{unet_name:[['qwen-image-2.1-UC-BF16.gguf','Qwen-Image-2.1-Turbo-BF16.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_bf16_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},QwenImage21Cache:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
let sourceHost;
let temporaryRenderer;
after(()=>{if(temporaryRenderer){assert.equal(dirname(resolve(temporaryRenderer)),resolve(tmpdir()));rmSync(temporaryRenderer,{recursive:true,force:true});}});
async function graph(s,policy,prompt='restyle',negative=s.negativePrompt){
  if(!sourceHost){
    // Exercise the real worker host against freshly instrumented sources while
    // leaving the shared worker-renderer / web-dist copies to the release owner.
    temporaryRenderer=mkdtempSync(join(tmpdir(),'nf-turbo-guidance-'));
    const sourceDir=fileURLToPath(new URL('../../renderer/',import.meta.url));
    const workerFiles=new Set(readdirSync(fileURLToPath(new URL('../../worker-renderer/',import.meta.url))));
    for(const file of readdirSync(sourceDir).filter(name=>name.endsWith('.js')&&workerFiles.has(name))){
      const source=readFileSync(join(sourceDir,file),'utf8');
      writeFileSync(join(temporaryRenderer,file),file==='novaflow-brand-runtime.js'?instrumentModule(source,{moduleName:'novaflow-brand-runtime',forceNames:['buildArtGenerateRunWorkflow']}).code:source);
    }
    sourceHost=await createWorkflowHost({rendererDir:temporaryRenderer,objectInfo:info});
  }
  const names=s.mode==='txt2img'?[]:['subject.png','style.png'];
  return serial(await sourceHost.buildGraph({module:'novaflow-brand-runtime',method:'buildArtGenerateRunWorkflow',options:{__args:['local',s.mode,names,'NF_turbo_guidance',prompt,negative,'cpu-test',[{width:1280,height:960},{width:832,height:1216}],s,10,policy]}}));
}

test('shared Turbo conversion keeps CFG 1 by default and explicit guidance retains the exact eight sigmas',()=>{
  const vm=createContext({});runInContext(read('qwen21-turbo.workflow.js'),vm);
  const fresh=()=>({7:{class_type:'KSampler',inputs:{model:['1',0],seed:7,cfg:9,steps:40,denoise:1,positive:['5',0],negative:['5',1],latent_image:['6',0]}}});
  for(const [options,cfg]of [[undefined,1],[{cfg:3},3],[{cfg:1},1]]){
    const g=vm.NovaFlowQwen21Turbo.apply(fresh(),options);
    assert.equal(g[7].inputs.cfg,cfg);assert.equal(g[7].class_type,'SamplerCustom');
    assert.equal(g[g[7].inputs.sigmas[0]].inputs.sigmas,sigmas);
    assert.equal(g[g[7].inputs.sampler[0]].inputs.sampler_name,'euler');
    assert.deepEqual(serial(g[7].inputs.negative),['5',1]);
  }
  for(const cfg of [NaN,Infinity,0,11])assert.throws(()=>vm.NovaFlowQwen21Turbo.apply(fresh(),{cfg}),/CFG/);
  const partial=fresh();partial[7].inputs.denoise=.8;assert.throws(()=>vm.NovaFlowQwen21Turbo.apply(partial,{cfg:3}),/八步/);
});

test('the sampling model scopes automatic CFG 3 to the confirmed two-reference drawing task',()=>{
  const s=state();assert.equal(sampling(s).cfg,1);assert.equal(sampling(s,styleOptions).cfg,3);assert.equal(sampling(s,styleOptions).steps,8);
  for(const policy of [{...styleOptions,taskProfile:'ui-design'},{...styleOptions,styleReferencePriority:false},{...styleOptions,referenceRoles:['subject','pose']},{...styleOptions,referenceRoles:['subject','style','pose']},{...styleOptions,qwen21TurboGuidance:{renderingClass:'animated-3d',cfg:3}}])assert.equal(sampling(s,policy).cfg,1);
  assert.equal(sampling(state({mode:'txt2img'}),styleOptions).cfg,1);
  assert.equal(sampling(state({negativePrompt:''}),styleOptions).cfg,1);
  assert.equal(models.localSamplingFor(s,'img2img',undefined,undefined,'ui',styleOptions).cfg,1);
  const ordinary=sampling(state({localQwen21Variant:'standard'}),styleOptions);assert.equal(ordinary.steps,25);assert.equal(ordinary.cfg,2.5);
});

test('explicit Turbo CFG 1 and other manual values win, stay on their own route and clear back to the task default',()=>{
  const s=state({samplingOverrides:{'qwen-2.1:img2img':{steps:40,cfg:4}}});
  assert.equal(sampling(s,styleOptions).cfg,3);assert.equal(sampling(s,styleOptions).steps,8);
  for(const cfg of [1,2.7,3]){
    const next=models.setLocalSamplingValue(s,'img2img','cfg',String(cfg),styleOptions);
    assert.equal(next.cfg,cfg);assert.equal(next.cfgManual,true);assert.equal(s.samplingOverrides['qwen-2.1-turbo:img2img'].cfg,cfg);
    assert.equal(sampling({...s,mode:'txt2img'},styleOptions).cfg,1);
  }
  models.setLocalSamplingValue(s,'img2img','steps','25',styleOptions);assert.equal(sampling(s,styleOptions).steps,8);
  const reset=models.setLocalSamplingValue(s,'img2img','cfg','',styleOptions);assert.equal(reset.cfg,3);assert.equal(reset.cfgManual,false);
  assert.equal(sampling(s).cfg,1);assert.equal(s.samplingOverrides['qwen-2.1:img2img'].cfg,4);
});

test('confirmed anime preparation sends its real negative, reuses guidance after AI writeback and never stores an automatic manual CFG',async()=>{
  const e=env(),s=state(),r=refs(),c=context(s,r),first=await e.api.prepare(c);
  assert.deepEqual(serial(e.api.generationOptions(first)),styleOptions);
  assert.match(first.state.negativePrompt,/photorealistic facial proportions/);
  assert.equal(first.state.negativePrompt,first.promptSnapshot.negativePrompt);
  assert.equal(s.negativePrompt,'avoid watermark');assert.equal(first.state.samplingOverrides,undefined);
  first.applyPromptToState();assert.equal(s.samplingOverrides,undefined);
  assert.deepEqual(serial(e.api.samplingOptions(c)),styleOptions);assert.equal(sampling(s,e.api.samplingOptions(c)).cfg,3);
  s.drawingAnalysisEngine='direct';const repeated=await e.api.prepare(c);
  assert.equal(repeated.direct,true);assert.deepEqual(serial(e.api.generationOptions(repeated)),styleOptions);assert.equal(e.calls.length,1);
  const fresh=await e.api.prepare(context({...s},r));assert.equal(e.api.generationOptions(fresh).qwen21TurboGuidance,undefined,'a fresh NoAI state has no confirmed rendering class');
  for(const change of [()=>s.prompt+='，换成白衣',()=>s.negativePrompt+=', grain',()=>r[1]=reference('new style','style')]){
    change();assert.equal(e.api.samplingOptions(c).qwen21TurboGuidance,undefined);
  }
  const changed=await e.api.prepare(c);assert.equal(e.api.generationOptions(changed).qwen21TurboGuidance,undefined);assert.equal(e.calls.length,1);
});

test('CG, painterly, animated 3D, locked photographic faces and unconfirmed NoAI keep the Turbo default',async()=>{
  for(const renderingClass of ['other','painterly','animated-3d']){
    const e=env(plan(renderingClass)),s=state(),p=await e.api.prepare(context(s,refs()));
    assert.equal(e.api.generationOptions(p).qwen21TurboGuidance,undefined,renderingClass);
    assert.equal((await graph(p.state,e.api.generationOptions(p)))['7'].inputs.cfg,1,renderingClass);
  }
  const e=env(),p=await e.api.prepare(context(state({prompt:'图1用图2画风，保留写实五官'}),refs()));
  assert.equal(e.api.generationOptions(p).qwen21TurboGuidance,undefined);
});

test('the actual panel displays the effective task CFG and only an explicit edit creates manual guidance',async()=>{
  const e=env(),s=state(),r=refs(),c=context(s,r),p=await e.api.prepare(c);p.applyPromptToState();
  class Input {constructor(props){Object.assign(this,props);}getAttribute(key){return this[key];}setAttribute(key,value){this[key]=value;}}
  const fields=[];
  const sandbox={window:e.sandbox,ART_GENERATE_STATE:s,ART_GENERATE_WORKSPACE_ID:'cpu',HTMLInputElement:Input,
    artGenerateReferences:()=>r,selectArtGenerateNumberInputValue(){},document:{activeElement:null,querySelectorAll:()=>fields},
    createArtEl:(tag,props,children)=>tag==='input'?new Input(props):{tag,props,children}};
  const vm=createContext(sandbox);
  runInContext(brand.slice(brand.indexOf('  function artGenerateModelState()'),brand.indexOf('  function artGenerateSurfaceRenderKey()')),vm);
  runInContext(brand.slice(brand.indexOf('  function formatArtGenerateSamplingValue('),brand.indexOf('  function renderArtGenerateToggleButton(')),vm);
  const field=vm.renderArtGenerateSamplingField('cfg','img2img').children[1];fields.push(field);
  assert.equal(field.value,'3');field.onblur({currentTarget:field});assert.equal(s.samplingOverrides,undefined,'focusing an automatic 3 must not lock it as manual');
  field.value='1';field.oninput({currentTarget:field});field.onchange({currentTarget:field});
  assert.equal(field.value,'1');assert.equal(s.samplingOverrides['qwen-2.1-turbo:img2img'].cfg,1);assert.equal(field['data-novaflow-art-generate-sampling-manual'],'1');
  field.value='';field.oninput({currentTarget:field});field.onblur({currentTarget:field});assert.equal(field.value,'3');
  s.prompt+='，换装';vm.syncArtGenerateSamplingFields();assert.equal(field.value,'1','changed input invalidates the automatic guidance in the panel too');
});

test('formal source worker graph receives guidance metadata, real negative and the unchanged eight-step schedule',async()=>{
  for(const manual of [undefined,1,2.7]){
    const e=env(),s=state(manual==null?{}:{samplingOverrides:{'qwen-2.1-turbo:img2img':{cfg:manual}}}),r=refs();
    const p=await e.api.prepare(context(s,r));p.applyPromptToState();s.drawingAnalysisEngine='direct';
    const repeated=await e.api.prepare(context(s,r));
    for(const prepared of [p,repeated]){
      const g=await graph(prepared.state,e.api.generationOptions(prepared),prepared.promptSnapshot.prompt,prepared.promptSnapshot.negativePrompt);
      assert.equal(g['1'].inputs.unet_name,'Qwen-Image-2.1-Turbo-BF16.gguf');assert.equal(g['7'].class_type,'SamplerCustom');assert.equal(g['7'].inputs.cfg,manual??3);
      assert.equal(g[g['7'].inputs.sigmas[0]].inputs.sigmas,sigmas);assert.deepEqual(g['7'].inputs.negative,['5',1]);
      assert.equal(g['5'].inputs.negative_prompt,prepared.promptSnapshot.negativePrompt);assert.equal(g['7'].inputs.noise_seed,957282577);
      assert.equal(g['6'].inputs.width,1280);assert.equal(g['6'].inputs.height,960);
    }
  }
});

test('formal drawing defaults for text, pose and ordinary edits remain CFG 1 and manual changes at writeback win',async()=>{
  for(const [mode,options]of [['txt2img',styleOptions],['img2img',{taskProfile:'art-direction',referenceRoles:['subject','pose']}],['img2img',{}]]){
    const g=await graph(state({mode}),options);assert.equal(g['7'].inputs.cfg,1);assert.equal(g[g['7'].inputs.sigmas[0]].inputs.sigmas,sigmas);
  }
  for(const manual of [1,2.7,undefined]){
    const e=env(),s=state({samplingOverrides:{'qwen-2.1-turbo:img2img':{cfg:4}}}),p=await e.api.prepare(context(s,refs()));
    if(manual==null)delete s.samplingOverrides['qwen-2.1-turbo:img2img'];else s.samplingOverrides['qwen-2.1-turbo:img2img'].cfg=manual;
    p.applyPromptToState();const g=await graph(p.state,e.api.generationOptions(p));assert.equal(g['7'].inputs.cfg,manual??3);
  }
});
