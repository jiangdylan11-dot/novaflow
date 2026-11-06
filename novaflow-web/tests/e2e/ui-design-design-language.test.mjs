import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8');
function environment({ ui = true, references = [{id:'default-layout',role:'layout',dataUrl:'data:image/png;base64,default-layout'}], optimize, qwen = false } = {}) {
  const calls = [], failures = [], builds = [], uploads = [];
  const state = { provider:'local',mode:'img2img',prompt:'设计一个角色装备界面',negativePrompt:'不要模糊',width:1280,height:720,count:2,randomSeed:false,seed:17,nsfw:false,loras:[{name:'example',strength:0.7}],samplingOverrides:{'qwen-2.1:img2img':{steps:32,cfg:3}},results:[] };
  const noop = () => {};
  const sandbox = { AbortController, console, URLSearchParams, setTimeout, clearTimeout, ART_GENERATE_STATE:state,
    document:{ body:{classList:{contains:()=>ui}},querySelector:()=>ui ? {} : null },
    NovaFlowArtGenerateModels:{normalizeProvider:p=>p,capabilityFor:()=>({engine:qwen ? 'qwen-2.1' : ''})},
    NovaFlowUiDesignAssistantWorkflow:{run:async input=>{ calls.push('optimize'); return optimize ? optimize(input) : {prompt:'按参考图设计完整 UI',negativePrompt:'自动负面', ...(qwen ? {uiPlan:planFor(input.references)} : {})}; }},
    NovaFlowArtQualityProfile:{compileFinal:input=>{calls.push('drawing-quality');return input;}},
    captureArtGeneratePromptSnapshot:()=>({prompt:state.prompt,negativePrompt:state.negativePrompt}),
    artGenerateReferences:()=>references,artGenerateReferenceLimit:()=>10,artGenerateProviderTitle:p=>p,
    resetArtGenerateProgress:noop,setArtGenerateProgress:noop,setArtGenerateStatus:(text,error)=>{if(error)failures.push(text);},
    compileArtGeneratePromptMentions:(_refs,text,snapshot)=>({text,invalidTokens:[],snapshot}),addArtGeneratePromptHistory:noop,
    beginArtGenerateRun:()=>1,isArtGenerateRunCurrent:()=>true,detectArtGenerateBaseUrl:async()=> 'http://test',
    artDataUrlMime:()=> 'image/png',artUploadDataUrl:async(_base,name,dataUrl)=>{calls.push('upload');uploads.push({name,dataUrl});return name;},
    loadNovaflowArtExportImage:async()=>({naturalWidth:1024,naturalHeight:1024}),
    normalizeArtGenerateCount:n=>n,buildArtGenerateWorkflowWithSeed:(_seed,build)=>build(),
    buildArtGenerateRunWorkflow:(...args)=>{builds.push(args);return {workflow:{},modelKey:'drawing'};},
    applyArtReferenceControlNet:()=>({applied:0}),validateArtWorkflowNodes:async()=>{},
    withArtGenerateTimeout:task=>task(),artRequestJson:async(_base,path)=>{calls.push(path);return {ok:true,data:path==='/prompt'?{prompt_id:'test'}:{test:{}}};},
    artHistoryErrorMessage:()=>'',extractArtGenerateFiles:()=>[{filename:'result.png'}],artFetchBlob:async()=>({}),
    artBlobToDataUrl:async()=> 'data:image/png;base64,result',artWorkflowKey:()=> 'drawing',
    placeArtGenerateResultIntoSource:async()=>true,renderArtGenerateSurfaces:noop,clearArtGenerateBatch:noop,clearArtGenerateRunIfCurrent:noop,
    artGenerateBatchProgress:label=>({label,pct:0}),addEventListener:noop,removeEventListener:noop,
    ART_GENERATE_WORKFLOW_TIMEOUT_MS:1,ART_GENERATE_PROMPT_TIMEOUT_MS:1,ART_GENERATE_HISTORY_TIMEOUT_MS:1,ART_GENERATE_DOWNLOAD_TIMEOUT_MS:1,
    pendingArtAgentPreparation:null, // module-level in the brand runtime; runArtGenerate takes a reviewed draft from it
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source('ui-design-prompt.pipeline.js'),sandbox);
  vm.runInContext(source('ui-design-style-reference.js'),sandbox);
  sandbox.Image = class { width=16; height=16; set src(value) { this.onload(); } };
  vm.runInContext(source('ui-design.drawing.js'),sandbox);
  const brand = source('novaflow-brand-runtime.js');
  vm.runInContext(brand.slice(brand.indexOf('  function resolveArtGenerateReferenceInputs('), brand.indexOf('  async function runArtGenerate(')),sandbox);
  vm.runInContext(brand.slice(brand.indexOf('  async function runArtGenerate('), brand.indexOf('  function createArtGenerateExecutionBridge()')),sandbox);
  return { sandbox,state,calls,failures,builds,uploads,run:()=>sandbox.runArtGenerate(),adapter:sandbox.NovaFlowUiDesignDrawing };
}

function planFor(refs, patch={}) {
  return {version:1,layoutMode:refs.length ? 'preserve' : 'create',layoutReference:refs.length ? 1 : 0,
    visualMode:'theme-redesign',references:refs.map((r,i)=>({index:i+1,role:r.role === 'style' ? 'style' : r.role === 'layout' ? 'layout' : 'combined'})),layoutChanges:[],preserve:[],...patch};
}


test('whole UI form redesign retains the explicit full design-language image through normal drawing upload',async()=>{
 const refs=[{id:'base',role:'layout',dataUrl:'data:image/png;base64,base'},{id:'design-language',role:'style',dataUrl:'data:image/png;base64,full-page'}];
 const e=environment({qwen:true,references:refs});e.state.count=1;e.state.prompt='按图1功能位置重做为珊瑚贝壳主题，重新设计图1的面板与按钮造型和构造，图2仅作完整设计语言参考，保留业务数值和功能区域';
 const original=e.sandbox.NovaFlowUiDesignStyleReference,options=[];
 e.sandbox.NovaFlowUiDesignStyleReference={...original,prepare:(refs,plan,opts)=>{options.push(opts);return original.prepare(refs,plan,opts);}};
 await e.run();assert.deepEqual(e.failures,[]);assert.equal(options[0].preservePageDesignLanguage,true);assert.equal(e.builds[0][8].uiRunIntent,'redesign');
 assert.equal(e.uploads[1].dataUrl,refs[1].dataUrl);assert.equal(e.builds[0][10].referenceRoles[1].sourceId,'design-language');assert.equal(e.builds[0][10].uiNativeEdit,undefined);
});
test('partial changes and negated form redesign never authorize whole-page design-language override',async()=>{
 const refs=[{id:'base',role:'layout',dataUrl:'data:image/png;base64,base'},{id:'style',role:'style',dataUrl:'data:image/png;base64,style'}];
 for(const [prompt,selection] of [['只调整属性牌光影，其他不变',{kind:'block',node:{data:{canvasSize:{width:1280,height:720}}},block:{id:'stat',x:10,y:10,width:100,height:100}}],['不要重新设计造型，保留整体构造，只迁移材质',undefined]]){
  const e=environment({qwen:true,references:refs});e.state.prompt=prompt;const original=e.sandbox.NovaFlowUiDesignStyleReference,options=[];
  e.sandbox.NovaFlowUiDesignStyleReference={...original,prepare:(refs,plan,opts)=>{options.push(opts);return original.prepare(refs,plan,opts);}};
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10,selection});assert.equal(options[0].preservePageDesignLanguage,false);assert.equal(prepared.references[1].dataUrl,refs[1].dataUrl);
 }
});
test('full design-language route preserves explicit style bytes without even decoding or creating a sample canvas',async()=>{
 const e=environment(),refs=[{id:'base',role:'layout',dataUrl:'data:image/png;base64,base'},{id:'full-style',role:'style',dataUrl:'data:image/png;base64,style',width:720,height:1280}];
 const output=await e.sandbox.NovaFlowUiDesignStyleReference.prepare(refs,{visualMode:'theme-redesign',layoutMode:'preserve',layoutReference:1},{preservePageDesignLanguage:true,loadImage:()=>{throw Error('must not sample');},createCanvas:()=>{throw Error('must not sample');}});
 assert.equal(output[1],refs[1]);assert.equal(output[1].uiReferenceTreatment,undefined);
});
