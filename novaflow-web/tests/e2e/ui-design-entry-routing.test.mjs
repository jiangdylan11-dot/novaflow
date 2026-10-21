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

const shortRequest='参考 @参考图1 的布局，换一个中国风主题的老虎机';
const refs=[{id:'screen',role:'reference',dataUrl:'data:image/png;base64,original-screen'}];
const becomeDrawing=e=>{e.sandbox.document.body.classList.contains=label=>label==='novaflow-primary-target-art';e.sandbox.document.querySelector=()=>null;};
const themePlan={version:1,layoutMode:'preserve',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'layout'}],layoutChanges:[],preserve:['符号区5列3行，共15格','保留3个奖池的信息层级','底部操作控件功能不变']};
test('the real short layout/theme request in Drawing dispatches the existing UI compiler before upload',async()=>{
 const e=environment({ui:false,qwen:true,references:refs,optimize:async()=>({prompt:shortRequest,uiPlan:themePlan})});becomeDrawing(e);e.state.prompt=shortRequest;e.state.count=1;
 await e.run();assert.deepEqual(e.failures,[]);assert.equal(e.calls.filter(x=>x==='optimize').length,1);assert.equal(e.calls.includes('drawing-quality'),false);
 const args=e.builds[0];assert.equal(args[8].uiNativeEditPrompt,true);assert.equal(args[8].uiPreserveLayout,true);assert.equal(args[8].uiRunIntent,'redesign');assert.equal(args[10].taskProfile,'ui-design');
 assert.match(args[4],/中国风主题/);assert.match(args[4],/主题重设计只保留布局图的业务结构/);assert.match(args[4],/5列3行/);assert.equal(args[10].referenceRoles[0].role,'layout');assert.equal(e.uploads[0].dataUrl,refs[0].dataUrl);
});
test('plain character or scene Drawing keeps generic quality, sampling and its original dispatch',async()=>{
 for(const request of ['参考图1的布局，换一个中国风主题的角色海报','把人物衣服换成汉服，保留原构图','参考图1做一个中国山水场景']){
 const e=environment({ui:false,qwen:true,references:refs});becomeDrawing(e);e.state.prompt=request;e.state.count=1;await e.run();assert.deepEqual(e.failures,[]);assert.equal(e.calls.includes('optimize'),false);assert.equal(e.calls.includes('drawing-quality'),true);assert.equal(e.builds[0][10]?.taskProfile,undefined);
 }
});
test('Drawing style-only and negative theme requests do not expand to whole UI redesign',()=>{
 const e=environment({ui:false,qwen:true,references:refs});becomeDrawing(e);
 for(const prompt of ['老虎机布局不变，只改材质为毛毡','参考图1布局，不要换中国风主题，只调亮度','布局不变，换一个中国风主题的角色'])assert.equal(e.adapter.shouldPrepare({state:{prompt},references:refs}),false);
 assert.equal(e.adapter.shouldPrepare({state:{prompt:shortRequest},references:[]}),false);
});
test('the active UI tab continues to compile the same short input and binds its sole reference as layout',async()=>{
 const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:shortRequest,uiPlan:themePlan})});e.state.prompt=shortRequest;e.state.count=1;await e.run();assert.deepEqual(e.failures,[]);assert.equal(e.builds[0][10].taskProfile,'ui-design');assert.equal(e.builds[0][10].referenceRoles[0].role,'layout');
});
test('page switches during preparation reject the stale request before uploading or building',async()=>{
 for(const first of ['drawing','ui']){
 let release,entered;const started=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
 const e=environment({ui:first==='ui',qwen:true,references:refs,optimize:async()=>{entered();await pending;return{prompt:shortRequest,uiPlan:themePlan};}});if(first==='drawing')becomeDrawing(e);e.state.prompt=shortRequest;e.state.count=1;
 const run=e.run();await started;if(first==='ui')becomeDrawing(e);else e.sandbox.document.body.classList.contains=()=>false;release();await run;
 assert.match(e.failures.at(-1),/页面已切换/);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);assert.equal(e.calls.includes('/prompt'),false);
 }
});
test('UI local editing still requires a selected native region even when the prompt mentions a new theme',async()=>{
 const e=environment({qwen:true,references:refs});e.state.prompt='局部修改老虎机按钮，换成中国风主题，其他布局不变';await e.run();assert.match(e.failures.at(-1),/选中/);assert.equal(e.calls.includes('optimize'),false);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);
});
