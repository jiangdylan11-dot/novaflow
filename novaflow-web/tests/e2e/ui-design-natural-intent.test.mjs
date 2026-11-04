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

function planFor(refs, patch={}) {
  return {version:1,layoutMode:refs.length ? 'preserve' : 'create',layoutReference:refs.length ? 1 : 0,
    visualMode:'theme-redesign',references:refs.map((r,i)=>({index:i+1,role:r.role === 'style' ? 'style' : r.role === 'layout' ? 'layout' : 'combined'})),layoutChanges:[],preserve:[],...patch};
}


const businessRefs=[{id:'layout',role:'layout',dataUrl:'data:image/png;base64,layout'},{id:'language',role:'style',dataUrl:'data:image/png;base64,style'},{id:'tiger',role:'asset',dataUrl:'data:image/png;base64,tiger'}];
async function prepareNatural(prompt,patch={}){const e=environment({qwen:true,references:businessRefs,optimize:async input=>({prompt:input.prompt,uiPlan:planFor(input.references,{visualMode:'style-transfer',...patch})})});e.state.prompt=prompt;const prepared=await e.adapter.prepare({state:e.state,references:businessRefs,referenceLimit:10});return {e,prepared};}
test('actual natural whole-screen request compiles to concise theme redesign despite a style-only planner',async()=>{
 const {e,prepared}=await prepareNatural("按图1的功能位置整屏重做为清爽珊瑚贝壳三消游戏，重新设计所有面板与按钮造型和构造。图1仅定位：顶部返回箭头和 LEVEL 12；上方左 MOVES 20、右 GOAL 3000、中间一只图3的 Tiger；棋盘上方 SCORE 150；一个8列8行、共64格棋盘；底部 HAMMER 3、SWAP 2、SHUFFLE 1 三个操作，各有锤子、双向箭头、交叉箭头图标。图2提供完整设计语言：柔和立体光影、精致透亮材质、奶油色承托、珊瑚粉和海沫绿、成体系的面板构造与清晰有层级字体；不复制图2的老虎机布局、文案或角色。统一为珊瑚与贝壳世界：棋子用海星、扇贝、珍珠、螺旋贝、珊瑚枝等五种明显不同轮廓，每格恰好一枚，不能只靠颜色区分。图3保留橙黑白毛色与金色胸饰，简化为同画风的光滑3D Tiger，不用照片或毛发写实。背景、Tiger、棋子、面板、按钮共享光照与材质，简约大气，留足外边距与文字空间；所有指定功能、数值和网格数量准确。");assert.equal(prepared.uiPlan.visualMode,'theme-redesign');assert.equal(prepared.state.uiRunIntent,'redesign');assert.ok(prepared.promptSnapshot.prompt.length<1500);assert.match(prepared.promptSnapshot.prompt,/8列8行、共64格/);assert.equal(prepared.references[1].dataUrl,businessRefs[1].dataUrl);assert.deepEqual(Array.from(prepared.uiPlan.references,r=>r.role),['layout','style','asset']);assert.equal(prepared.nativeEdit,null);
});
test('ordinary Chinese complete screen requests need no special theme token',async()=>{
 for(const prompt of ['把整个界面重做为珊瑚贝壳三消游戏，重新设计面板构造','整屏重新设计成海底三消游戏，保留原有功能位置与数值','重新设计整个界面，图2提供完整美术语言','整体重做，图2是风格来源，图3提供人物身份','整屏重设计，画面简约大气','完整主题重新设计，玩法位置保持']){const {prepared}=await prepareNatural(prompt);assert.equal(prepared.uiPlan.visualMode,'theme-redesign',prompt);assert.equal(prepared.state.uiRunIntent,'redesign',prompt);}
});
test('pure restyling, unchanged theme, negated and form-only requests do not broaden into theme replacement',async()=>{
 for(const prompt of ['整屏重做为水彩画风，保留原主题','整屏纯换肤，只改配色与材质','不要整屏重做，保留原主题与人物，只改材质','整屏重新设计所有面板与按钮造型和构造，主题人物不换','重新设计整个界面的按钮造型，沿用原主题','不要整屏重新设计成海底游戏，仅改变画风']){const {prepared}=await prepareNatural(prompt);assert.equal(prepared.uiPlan.visualMode,'style-transfer',prompt);assert.equal(prepared.state.uiRunIntent,'style-transfer',prompt);}
});
test('strict local theme/object replacement keeps one selected region and native mask',async()=>{
 for(const prompt of ['只替换主按钮为珊瑚贝壳主题，其他保持不变','只修改棋子为海星，其他保持不变']){const e=environment({qwen:true,references:businessRefs,optimize:async input=>({prompt:input.prompt,uiPlan:planFor(input.references,{visualMode:'theme-redesign'})})});e.state.prompt=prompt;e.sandbox.document.createElement=()=>({getContext:()=>({drawImage(){},getImageData(){return {data:[128,128,128,255]};}})});const selection={kind:'block',node:{data:{canvasSize:{width:1280,height:720}}},block:{id:'local-button',x:10,y:10,width:100,height:100}};const prepared=await e.adapter.prepare({state:e.state,references:businessRefs,referenceLimit:10,selection});assert.equal(prepared.state.uiRunIntent,'iteration');assert.equal(prepared.uiPlan.visualMode,'partial');assert.ok(prepared.nativeEdit);assert.equal(prepared.nativeEdit.regions.length,1);assert.match(prepared.promptSnapshot.prompt,/只替换|只修改/);assert.doesNotMatch(prepared.promptSnapshot.prompt,/本次是主题重设|主题重设计只保留布局图的业务结构/);}
});
test('layout style material and asset authority survives incorrect AI roles on whole rebuild',async()=>{
 const refs=[businessRefs[0],businessRefs[1],{id:'metal',role:'material',dataUrl:'data:image/png;base64,metal'},businessRefs[2]],e=environment({qwen:true,references:refs,optimize:async input=>({prompt:input.prompt,uiPlan:planFor(input.references,{visualMode:'style-transfer',references:input.references.map((r,i)=>({index:i+1,role:'content'}))})})});e.state.prompt='整屏重做为深海游戏，重新设计面板构造。图2提供完整设计语言，图3仅提供材质，图4仅提供Tiger身份。';const p=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10}),options=e.adapter.generationOptions(p);assert.equal(p.uiPlan.visualMode,'theme-redesign');assert.deepEqual(Array.from(options.referenceRoles,r=>[r.role,r.sourceId]),[['layout','layout'],['style','language'],['style','metal'],['asset','tiger']]);assert.match(p.promptSnapshot.prompt,/<image3>是质感来源/);assert.match(p.promptSnapshot.prompt,/<image4>是人物或元素素材来源/);assert.equal(p.references[1].dataUrl,refs[1].dataUrl);
});
