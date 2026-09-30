import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8');
function environment({ ui = true, references = [], optimize } = {}) {
  const calls = [], failures = [], builds = [];
  const state = { provider:'local',mode:'img2img',prompt:'设计一个角色装备界面',negativePrompt:'不要模糊',width:1280,height:720,count:2,randomSeed:false,seed:17,nsfw:false,loras:[{name:'example',strength:0.7}],samplingOverrides:{'qwen-2.1:img2img':{steps:32,cfg:3}},results:[] };
  const noop = () => {};
  const sandbox = { AbortController, console, URLSearchParams, setTimeout, clearTimeout, ART_GENERATE_STATE:state,
    document:{ body:{classList:{contains:()=>ui}},querySelector:()=>ui ? {} : null },
    NovaFlowArtGenerateModels:{normalizeProvider:p=>p,capabilityFor:()=>({engine:'qwen-2.1'})},
    NovaFlowUiDesignAssistantWorkflow:{run:async input=>{ calls.push('optimize'); return optimize ? optimize(input) : {prompt:'按参考图设计完整 UI',negativePrompt:'自动负面'}; }},
    NovaFlowArtQualityProfile:{compileFinal:input=>{calls.push('drawing-quality');return input;}},
    captureArtGeneratePromptSnapshot:()=>({prompt:state.prompt,negativePrompt:state.negativePrompt}),
    artGenerateReferences:()=>references,artGenerateReferenceLimit:()=>10,artGenerateProviderTitle:p=>p,
    resetArtGenerateProgress:noop,setArtGenerateProgress:noop,setArtGenerateStatus:(text,error)=>{if(error)failures.push(text);},
    compileArtGeneratePromptMentions:(_refs,text,snapshot)=>({text,invalidTokens:[],snapshot}),addArtGeneratePromptHistory:noop,
    beginArtGenerateRun:()=>1,isArtGenerateRunCurrent:()=>true,detectArtGenerateBaseUrl:async()=> 'http://test',
    artDataUrlMime:()=> 'image/png',artUploadDataUrl:async(_base,name)=>{calls.push('upload');return name;},
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
  vm.runInContext(source('ui-design.drawing.js'),sandbox);
  const brand = source('novaflow-brand-runtime.js');
  vm.runInContext(brand.slice(brand.indexOf('  async function runArtGenerate('), brand.indexOf('  function createArtGenerateExecutionBridge()')),sandbox);
  return { sandbox,state,calls,failures,builds,run:()=>sandbox.runArtGenerate(),adapter:sandbox.NovaFlowUiDesignDrawing };
}

test('UI uses the real drawing batch path and preserves sampling, LoRA, size, negative prompt and seeds',async()=>{
  const refs = [{id:'layout',uiLayoutId:'L',dataUrl:'data:image/png;base64,layout',uiStructure:{width:1280,height:720,regions:[{name:'角色',purpose:'展示人物',x:20,y:10,width:400,height:600}]}},{id:'style',dataUrl:'data:image/png;base64,style'}];
  const e = environment({references:refs});
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.equal(e.calls.filter(x=>x==='optimize').length,1);
  assert.equal(e.calls.filter(x=>x==='/prompt').length,2);
  assert.equal(e.calls.includes('drawing-quality'),false);
  assert.equal(e.builds.length,2);
  for (const [index,args] of e.builds.entries()) {
    assert.equal(args[1],'img2img');assert.equal(args[2].length,2);
    assert.match(args[4],/展示人物/);assert.equal(args[5],'不要模糊');
    assert.equal(args[8].width,1280);assert.equal(args[8].height,720);assert.equal(args[8].seed,17+index);
    assert.equal(args[8].samplingOverrides['qwen-2.1:img2img'].steps,32);assert.equal(args[8].loras[0].strength,0.7);
  }
  assert.equal(e.state.results.length,2);assert.equal(e.state.prompt,'设计一个角色装备界面');
});
test('module names stay in the editor and never enter assistant or generation payloads',async()=>{
  const region = {name:'仅用户识别的内部标签',title:'旧标题',label:'旧标签',purpose:'辅助导航',requirements:'使用小号灰字',x:10,y:20,width:600,height:100,participates:false,locked:true};
  const refs = [{uiLayoutId:'L',dataUrl:'data:image/png;base64,layout',uiStructure:{width:1280,height:720,regions:[region]}}];
  let analysis;
  const e = environment({references:refs,optimize:async input=>{analysis=input;return {prompt:'生成 UI'};}});
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.doesNotMatch(JSON.stringify(analysis),/仅用户识别|旧标题|旧标签/);
  assert.equal(analysis.structure.regions[0].purpose,'辅助导航\n使用小号灰字');
  assert.equal(analysis.structure.regions[0].x,10);
  assert.doesNotMatch(e.builds[0][4],/仅用户识别|旧标题|旧标签/);
  assert.match(e.builds[0][4],/辅助导航/);
  assert.equal(region.name,'仅用户识别的内部标签','editor storage is untouched');
});

test('UI accepts no layout and no image; failed optimization never submits a generation',async()=>{
  const e = environment();await e.run();assert.deepEqual(e.failures,[]);assert.equal(e.builds[0][1],'txt2img');
  const failed = environment({optimize:async()=>{throw Error('service unavailable');}});await failed.run();
  assert.deepEqual(failed.failures,['service unavailable']);assert.equal(failed.builds.length,0);assert.equal(failed.state.running,false);
});
test('drawing retains its existing pipeline and never invokes UI optimization',async()=>{
  const e = environment({ui:false,references:[{dataUrl:'data:image/png;base64,ref'}]});await e.run();
  assert.deepEqual(e.failures,[]);assert.equal(e.calls.includes('optimize'),false);assert.equal(e.calls.includes('drawing-quality'),true);assert.equal(e.builds.length,2);
});

test('ordinary drawing refuses overflow before uploads instead of generating from a truncated set', async()=>{
  const e=environment({ui:false,references:Array.from({length:11},()=>({dataUrl:'data:image/png;base64,ref'}))});
  await e.run();
  assert.match(e.failures[0],/最多支持 10 张.*当前 11 张/);
  assert.equal(e.calls.includes('upload'),false);
  assert.equal(e.builds.length,0);
});

test('UI generation disables inherited NSFW without changing the drawing setting',async()=>{
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}]});
  e.state.nsfw=true;
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.equal(e.builds[0][8].nsfw,false);
  assert.equal(e.state.nsfw,true);
  assert.equal(e.calls.filter(x=>x==='optimize').length,1);
});
test('cancel during UI preparation stops before uploads and repeat click does not start a second run',async()=>{
  let resolve;
  const e = environment({optimize:()=>new Promise(r=>{resolve=r;})});
  const pending = e.run();await Promise.resolve();await Promise.resolve();await e.run();
  assert.equal(e.calls.filter(x=>x==='optimize').length,1);
  assert.equal(e.adapter.cancelPreparation(),true);await pending;
  resolve({prompt:'late'});assert.equal(e.builds.length,0);assert.equal(e.state.running,false);
});
test('reference gaps map to uploaded image order; overflow and missing mentions fail explicitly',()=>{
  const e = environment(), ref={dataUrl:'data:image/png;base64,a'};
  const input=e.adapter.inputFor({state:{prompt:'图3是风格图'},references:[ref,null,{...ref,id:'b'}],referenceLimit:10});
  assert.equal(input.prompt,'@参考图2是风格图');
  assert.throws(()=>e.adapter.inputFor({state:{prompt:'图2是风格'},references:[ref,null],referenceLimit:10}),/已移除/);
  assert.throws(()=>e.adapter.inputFor({state:{},references:[ref,ref],referenceLimit:1}),/最多支持/);
  const cloud=e.adapter.inputFor({state:{provider:'gpt',gptSize:'1536x1024'},references:[],referenceLimit:10});
  assert.equal(cloud.size.width,1536);assert.equal(cloud.size.height,1024);
});
test('edits made while optimization is pending cannot change its parameter or original-text snapshot',async()=>{
  let finish;
  const e=environment({optimize:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=e.adapter.prepare({state:e.state,references:[],referenceLimit:10});
  await Promise.resolve();await Promise.resolve();
  e.state.width=2048;e.state.prompt='下一张的需求';e.state.samplingOverrides['qwen-2.1:img2img'].steps=50;
  finish({prompt:'优化指令'});
  const prepared=await pending;
  assert.equal(prepared.state.width,1280);assert.equal(prepared.state.samplingOverrides['qwen-2.1:img2img'].steps,32);
  assert.equal(prepared.originalPrompt,'设计一个角色装备界面');
});
