import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8');
function environment({ ui = true, references = [], optimize, qwen = false } = {}) {
  const calls = [], failures = [], builds = [];
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

function planFor(refs, patch={}) {
  return {version:1,layoutMode:refs.length ? 'preserve' : 'create',layoutReference:refs.length ? 1 : 0,
    visualMode:'theme-redesign',references:refs.map((r,i)=>({index:i+1,role:r.role === 'style' ? 'style' : r.role === 'layout' ? 'layout' : 'combined'})),layoutChanges:[],preserve:[],...patch};
}

test('Qwen partial layout changes retain protected areas without a global position lock',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,ref',role:'layout'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'人物缩小20%，符号区上移，奖池和底部操作栏保持原位。',uiPlan:planFor(refs,{layoutMode:'partial',layoutChanges:['人物缩小20%','符号区上移'],preserve:['奖池和底部操作栏保持原位']})})});
  e.state.prompt='人物缩小20%，符号区上移，其他不变';await e.run();
  assert.deepEqual(e.failures,[]);assert.equal(e.builds[0][8].uiLayoutMode,'partial');
  assert.match(e.builds[0][4],/只调整这些布局项目：人物缩小20%；符号区上移/);
  assert.doesNotMatch(e.builds[0][4],/沿用布局参考图的全部区域|本次是局部修改，沿用全部/);
});

test('Qwen sends the second layout image as native source and keeps style reference in the planner',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,style',role:'style'},{dataUrl:'data:image/png;base64,layout',role:'layout'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'用@参考图1的卡通风格，沿用@参考图2的结构。',uiPlan:planFor(refs,{layoutReference:2})})});
  e.state.prompt='用@参考图1的卡通风格，沿用@参考图2的布局';
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});
  assert.equal(prepared.references.length,1);assert.equal(prepared.references[0].role,'layout');
  assert.match(prepared.promptSnapshot.prompt,/用指定风格的卡通风格，沿用图片的结构/);
  assert.doesNotMatch(prepared.promptSnapshot.prompt,/@参考图|用户设计需求|[\r\n]/);
  assert.equal(prepared.state.uiNativeEditPrompt,true);
  assert.equal(e.state.prompt,'用@参考图1的卡通风格，沿用@参考图2的布局');
});

test('Qwen style-only references generate their own layout and invalid plans never submit',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,style',role:'style'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'按卡通视觉设计新页面。',uiPlan:planFor(refs,{layoutMode:'create',layoutReference:0})})});
  await e.run();assert.deepEqual(e.failures,[]);assert.equal(e.builds[0][8].uiPreserveLayout,false);
  assert.match(e.builds[0][4],/风格图、人物和物品图不提供布局/);
  for(const patch of [{uiPlan:null},{uiPlan:planFor(refs)}, {uiPlan:planFor(refs,{layoutMode:'partial',layoutChanges:['按钮上移'],preserve:[]})}]) {
    const failed=environment({qwen:true,references:refs,optimize:async()=>({prompt:'设计',...patch})});
    await failed.run();assert.equal(failed.calls.includes('upload'),false);assert.equal(failed.builds.length,0);
    assert.match(failed.failures[0],/规划不完整/);
  }
});

test('Qwen planning cache separates generation engines and rejects missing references',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const input={references:[{role:'layout'}],prompt:'参考@参考图2'};
  assert.notEqual(p.key({...input,targetEngine:'qwen-2.1'}),p.key({...input,targetEngine:''}));
  assert.throws(()=>p.compileQwenPlan({prompt:'设计',uiPlan:planFor(input.references)},input),/不存在的参考图/);
});

test('Qwen native editing carries supplied layout facts and maps all image identifier forms once',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const references=[{role:'style'},{role:'layout'}];
  const input={references,prompt:'参考图2是画布，用<image1>的风格'};
  const result={prompt:'将参考图2改成海盗主题，图1只提供材质。',uiPlan:planFor(references,{layoutReference:2,preserve:['符号区6列5行','四个奖池','五个底部按钮']})};
  const compiled=p.compileQwenPlan(result,input);
  assert.match(compiled.prompt,/将图片改成海盗主题，指定风格只提供材质/);
  assert.match(compiled.prompt,/符号区6列5行；四个奖池；五个底部按钮/);
  assert.doesNotMatch(compiled.prompt,/@参考图|参考图2|[\r\n]/);
  assert.equal((compiled.prompt.match(/符号区6列5行/g)||[]).length,1);
  assert.throws(()=>p.compileQwenPlan({...result,prompt:'参考图3'},input),/不存在的参考图/);
  const single=p.compileQwenPlan({prompt:'编辑<image1>的按钮颜色',uiPlan:planFor([{role:'layout'}])},{references:[{role:'layout'}],prompt:'图1按钮变蓝'});
  assert.match(single.prompt,/编辑图片的按钮颜色/);
  assert.doesNotMatch(single.prompt,/<image/);
});

test('vision grid estimates never become a template while explicit user changes survive',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const references=[{role:'layout'}];
  const result={prompt:'将符号区调整为4列3行，其他区域不变。',uiPlan:planFor(references,{layoutMode:'partial',layoutChanges:['符号区调整为4列3行'],preserve:['其余区域不变'],grids:[{description:'模型估计的符号区',columns:6,rows:7}]})};
  const compiled=p.compileQwenPlan(result,{references,prompt:'符号区改成4列3行'});
  assert.match(compiled.prompt,/4列3行/);
  assert.doesNotMatch(compiled.prompt,/6列7行|42个位置|网格保持/);
});

test('anchored Qwen edits analyze style separately and use the content image as the native layout source',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,style',role:'style'},{dataUrl:'data:image/png;base64,layout',role:'layout'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'将图1的水彩纸纹与柔和光影用于图2，保留图2每个角色物品。',uiPlan:planFor(refs,{layoutReference:2,visualMode:'style-transfer',grids:[{description:'物品格',columns:6,rows:5}]})})});
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});
  assert.equal(prepared.references.length,1);assert.equal(prepared.references[0].role,'layout');
  assert.match(prepared.promptSnapshot.prompt,/水彩纸纹与柔和光影/);
  assert.doesNotMatch(prepared.promptSnapshot.prompt,/<image2>|@参考图|布局来源，美术按需求重做/);
  assert.equal(prepared.uiPlan.references.length,1);assert.equal(prepared.analysisUiPlan.references.length,2);
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

test('full UI redesign keeps the original instruction even when optimization carries old scenery back',async()=>{
  let input;
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}],optimize:async value=>{
    input=value;return {prompt:'木乃伊法老站在黄昏海面与巨浪前'};
  }});
  e.state.prompt='参考@参考图1做一个埃及木乃伊主题的老虎机，不需要保留任何元素';
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.equal(input.generationIntent,'redesign');
  assert.equal(e.builds[0][8].uiRunIntent,'redesign');
  assert.equal(e.builds[0][8].uiPreserveLayout,true);
  assert.match(e.builds[0][4],/人物展示区.*图标区/);
  assert.match(e.builds[0][4],/用户原始需求（最高优先级）：参考@参考图1做一个埃及木乃伊主题的老虎机，不需要保留任何元素/);
  assert.match(e.builds[0][4],/全部视觉元素都要重新设计/);
});

test('explicit local editing retains iteration intent without making drawing a redesign',async()=>{
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}]});
  e.state.prompt='只修改旋转按钮颜色，其他保持不变';
  await e.run();
  assert.equal(e.builds[0][8].uiRunIntent,'iteration');
  assert.match(e.builds[0][4],/本次是局部修改/);
});
test('style changes preserve the layout and content instead of becoming a theme redesign',async()=>{
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}],optimize:async()=>({prompt:'[布局与功能]错误的3列4行\n[区域设计]不应引入的新人物\n[视觉规范]手绘水彩纸纹'})});
  e.state.prompt='参考图1，只把风格换成手绘水彩';
  await e.run();
  assert.equal(e.builds[0][8].uiRunIntent,'style-transfer');
  assert.equal(e.builds[0][8].uiPreserveLayout,true);
  assert.match(e.builds[0][4],/本次是风格迁移：保留内容参考图/);
  assert.doesNotMatch(e.builds[0][4],/本次是完整 UI 重新设计/);
  assert.doesNotMatch(e.builds[0][4],/错误的3列4行|不应引入的新人物/);
  assert.match(e.builds[0][4],/手绘水彩纸纹/);
});

for(const provider of ['gpt','google']) test(`${provider} UI submits through the registered Web settlement bridge`,async()=>{
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}]});
  e.state.provider=provider;
  e.sandbox.electronAPI={runtimeProviderUsageSettlement:'web-control-plane-v1'};
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.equal(e.builds[0][0],provider);
  assert.equal(e.calls.filter(value=>value==='/prompt').length,2);
});

test('cloud UI still refuses an unknown settlement bridge before submitting a generation',async()=>{
  const e=environment();e.state.provider='gpt';
  await e.run();
  assert.deepEqual(e.failures,['当前网页生成接口未就绪，请刷新页面后重试']);
  assert.equal(e.builds.length,0);
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
  const partial=e.adapter.inputFor({state:{prompt:'只修改背景，不保留旧背景，其他部分保持不变'},references:[],referenceLimit:10});
  assert.equal(partial.generationIntent,'iteration');
  const reflow=e.adapter.inputFor({state:{prompt:'参考图1换新主题，并重新排版'},references:[ref],referenceLimit:10});
  assert.equal(reflow.preserveLayout,false);
  const keep=e.adapter.inputFor({state:{prompt:'只换风格，不改变布局，不要重新排版'},references:[ref],referenceLimit:10});
  assert.equal(keep.preserveLayout,true);
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

test('live layout becomes an image reference automatically, refreshes stale exports and preserves user image numbers',()=>{
 const e=environment({qwen:true}),structures=[];
 e.sandbox.NovaFlowUiDesignLayoutGuide={createCleanLayoutGuide:s=>{structures.push(s);return {dataUrl:'data:image/png;base64,current-layout'}}};
 const structure={width:1200,height:800,regions:[{x:70,y:90,width:400,height:600,purpose:'人物'}]};
 const refs=[{id:'style',role:'style',dataUrl:'data:image/png;base64,style'}];
 const created=e.adapter.snapshotLayoutReferences(refs,'L',structure,2);
 assert.equal(created.length,2);assert.equal(created[0].id,'style');assert.equal(created[1].role,'layout');
 assert.equal(created[1].uiStructure.regions[0].x,70);assert.equal(refs.length,1);
 const refreshed=e.adapter.snapshotLayoutReferences([{...created[1],dataUrl:'stale'},created[0]],'L',structure,2);
 assert.equal(refreshed.length,2);assert.equal(refreshed[0].dataUrl,'data:image/png;base64,current-layout');
 assert.throws(()=>e.adapter.snapshotLayoutReferences(refs,'L',structure,1),/包含自建布局图/);
 const input=e.adapter.inputFor({state:{...e.state,prompt:'图3是风格'},references:[null,null,refs[0]],referenceLimit:2});
 assert.equal(input.prompt,'@参考图1是风格');assert.equal(input.references.length,1);
 assert.equal(structures[0].blocks[0].purpose,'人物');
});

test('native Qwen treats a user layout as spatial guidance instead of preserving placeholder artwork',()=>{
 const e=environment({qwen:true}),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
 const refs=[{role:'style'},{role:'layout',uiLayoutId:'L',uiStructure:{regions:[{}]}}];
 const input={references:refs,prompt:'按图2布局，用图1风格',structure:{width:1000,height:1000,regions:[{x:50,y:50,width:400,height:800,purpose:'人物展示'}]}};
 const output=p.compileQwenPlan({prompt:'设计完整角色界面',uiPlan:planFor(refs,{layoutReference:2,visualMode:'style-transfer'})},input);
 assert.equal(output.references.length,1);assert.equal(output.references[0].uiLayoutId,'L');
 assert.match(output.prompt,/自建布局定位图/);assert.match(output.prompt,/不保留灰块和占位框/);
 assert.doesNotMatch(output.prompt,/拆.{0,3}素材|逐个生成/);
 assert.throws(()=>p.compileQwenPlan({prompt:'设计',uiPlan:planFor(refs,{layoutReference:1})},input),/规划不完整|当前自建布局/);
});
