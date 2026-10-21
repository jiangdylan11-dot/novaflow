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
    loadNovaflowArtExportImage:async()=>({naturalWidth:state.width,naturalHeight:state.height}),
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
  return { sandbox,state,calls,failures,builds,uploads,references,run:()=>sandbox.runArtGenerate(),adapter:sandbox.NovaFlowUiDesignDrawing };
}

function planFor(refs, patch={}) {
  return {version:1,layoutMode:refs.length ? 'preserve' : 'create',layoutReference:refs.length ? 1 : 0,
    visualMode:'theme-redesign',references:refs.map((r,i)=>({index:i+1,role:r.role === 'style' ? 'style' : r.role === 'layout' ? 'layout' : 'combined'})),layoutChanges:[],preserve:[],...patch};
}


const selected = () => ({kind:'block',node:{data:{canvasSize:{width:720,height:1280}}},block:{id:'sword-slot',x:90,y:320,width:180,height:256}});
function mountSelection(e,selection) {
  e.sandbox.__NovaFlowArtGenerate={state:e.state,references:()=>e.references,referenceLimit:()=>10};
  const node=()=>({style:{},appendChild(){},setAttribute(){},addEventListener(){},removeEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},getAttribute(){return '';},contains(){return false;},remove(){}});
  const doc=e.sandbox.document;doc.createElement=()=>node();doc.body.appendChild=()=>{};
  const leftHost=node();leftHost.ownerDocument=doc;
  e.sandbox.NovaFlowLeftPanelAccordion={chevronClass:()=>'',chevronStyle:()=>'',headerStyle:()=>'',titleStyle:()=>'',iconStyle:()=>'',labelStyle:()=>'',bodyStyle:()=>'',panelStyle:()=>'',syncExpanded(){}};
  e.sandbox.NovaFlowUiDesignWorkbench={mount:options=>(e.workbenchOptions=options,{getSelection:()=>selection,getLayout:()=>selection?.node,getActiveGeneratorId:()=>'',patchGeneratorOutput(){},destroy(){}})};
  e.sandbox.NovaFlowUiDesignInspectorTool={mount:()=>({update(){},destroy(){}})};
  e.sandbox.MutationObserver=class{observe(){}disconnect(){}};
  e.sandbox.requestAnimationFrame=()=>1;e.sandbox.cancelAnimationFrame=()=>{};
  return e.adapter.mount({leftHost,store:{getState:()=>({settings:{},project:{}}),subscribe:()=>()=>{},serializeProject:()=>({}),patchProject(){},addResult(){}},getSessionToken:()=>''});
}
test('selected block geometry is validated and normalized from the actual layout canvas',()=>{
 const e=environment({qwen:true});
 assert.deepEqual(JSON.parse(JSON.stringify(e.adapter.selectedEditRegion(selected()))),{x:.125,y:.25,width:.25,height:.2,source:'layout-selection',blockId:'sword-slot'});
 assert.equal(e.adapter.selectedEditRegion({kind:'node'}),null);
 assert.throws(()=>e.adapter.selectedEditRegion({...selected(),node:{data:{canvasSize:{width:Infinity,height:1280}}}}),/区域/);
 for(const block of [{x:-1,y:0,width:10,height:10},{x:0,y:0,width:721,height:10},{x:0,y:0,width:720,height:1280},{x:0,y:0,width:0,height:10}])assert.throws(()=>e.adapter.selectedEditRegion({...selected(),block}),/区域/);
});
test('explicit partial request with no selected block fails before optimizer, uploads or GPU dispatch',async()=>{
 const e=environment({qwen:true});e.state.prompt='只替换剑图标，其他不变';
 await e.run();assert.equal(e.failures.length,1);assert.match(e.failures[0],/选中/);
 assert.equal(e.calls.includes('optimize'),false);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);
});
test('drawing batch reads mounted selection, excludes guide bitmap and carries native region and stable base role',async()=>{
 const refs=[{id:'guide',uiLayoutId:'guide-id',role:'layout',dataUrl:'data:image/png;base64,guide'},{id:'actual-screen',role:'layout',dataUrl:'data:image/png;base64,screen'},{id:'art-language',role:'style',dataUrl:'data:image/png;base64,style'}];
 const e=environment({qwen:true,references:refs,optimize:async input=>({prompt:input.prompt,uiPlan:planFor(input.references,{visualMode:'partial'})})});
 e.state.prompt='只修改图2装备槽的光影，图3是风格，其他不变';e.state.width=720;e.state.height=1280;e.state.count=1;
 mountSelection(e,selected());await e.run();assert.deepEqual(e.failures,[]);
 assert.equal(e.uploads.length,2);assert.equal(e.uploads.some(x=>x.dataUrl===refs[0].dataUrl),false);
 const args=e.builds[0],options=args[10];assert.equal(args[8].uiLayoutMode,'partial');assert.equal(args[8].uiRunIntent,'iteration');
 assert.equal(options.uiNativeEdit.baseSourceId,'actual-screen');assert.equal(options.uiNativeEdit.neutralizeConditioning,false);
 assert.equal(options.referenceRoles[0].sourceId,'actual-screen');assert.equal(options.referenceRoles[1].sourceId,'art-language');
 assert.deepEqual(JSON.parse(JSON.stringify(options.uiNativeEdit.regions[0])),{x:.125,y:.25,width:.25,height:.2,source:'layout-selection',blockId:'sword-slot'});
 assert.match(args[4],/<image1>装备槽/);assert.match(args[4],/<image2>是风格/);
});
test('replacement clears only conditioning and bound selection changes the optimizer cache key',async()=>{
 const refs=[{id:'screen',role:'layout',dataUrl:'data:image/png;base64,screen'}];
 const e=environment({qwen:true,references:refs,optimize:async input=>({prompt:input.prompt,uiPlan:planFor(input.references,{visualMode:'partial'})})});
 e.sandbox.document.createElement=()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:[16,32,48,255]})})});
 e.state.prompt='只替换剑图标，其他不变';e.state.width=720;e.state.height=1280;
 const first=e.adapter.inputFor({state:e.state,references:refs,referenceLimit:10,selection:selected()});
 const second=e.adapter.inputFor({state:e.state,references:refs,referenceLimit:10,selection:{...selected(),block:{...selected().block,x:180}}});
 assert.notEqual(e.sandbox.NovaFlowUiDesignPromptPipeline.key(first),e.sandbox.NovaFlowUiDesignPromptPipeline.key(second));
 const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10,selection:selected()});
 assert.equal(prepared.nativeEdit.neutralizeConditioning,true);assert.equal(prepared.nativeEdit.fillColor,0x102030);
 const options=e.adapter.generationOptions(prepared);options.uiNativeEdit.regions[0].x=0;
 assert.equal(prepared.nativeEdit.regions[0].x,.125);
});


function deferred() { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function tokens(e) {
 const b=source('novaflow-brand-runtime.js');e.sandbox.localStorage={getItem:()=>''};e.sandbox.ART_GENERATE_LAST_RUNTIME_KEY='test';
 vm.runInContext(b.slice(b.indexOf('  function beginArtGenerateRun('),b.indexOf('  function selectedArtGenerateResult(')),e.sandbox);
}
test('mounted selection is bound to image bytes and output canvas until explicitly reselected',async()=>{
 const refs=[{id:'screen',role:'layout',dataUrl:'data:image/png;base64,first'}];
 const e=environment({qwen:true,references:refs});e.state.prompt='只修改高光，其他不变';e.state.width=720;e.state.height=1280;
 mountSelection(e,selected());refs[0]={...refs[0],dataUrl:'data:image/png;base64,replaced-same-id'};
 await e.run();assert.match(e.failures.at(-1),/底图|重新选/);assert.equal(e.calls.length,0);assert.equal(e.uploads.length,0);
 e.workbenchOptions.onSelectionChange();await e.run();assert.equal(e.builds.length,2);
 e.state.width=1440;e.state.height=2560;assert.throws(()=>e.adapter.inputFor({state:e.state,references:refs,referenceLimit:10}),/尺寸|重新选/);
});
test('local wording and layout iterations without a selection cannot silently use a whole-image fallback',async()=>{
 for(const prompt of ['局部替换按钮','局部修改光影','edit selected button','人物缩小20%，其他不变']){
  const e=environment({qwen:true});e.state.prompt=prompt;await e.run();assert.match(e.failures.at(-1),/选中/);assert.equal(e.calls.includes('optimize'),false);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);
 }
 const e=environment({qwen:true});e.state.prompt='局部调整按钮';e.state.width=721;e.state.height=1280;assert.throws(()=>e.adapter.inputFor({state:e.state,references:e.references,referenceLimit:10,selection:selected()}),/尺寸/);
});
test('changed input while planner or style preprocessing is pending is rejected before uploads',async()=>{
 for(const stage of ['planner','style']){
  const gate=deferred(),entered=deferred(),refs=[{id:'screen',role:'layout',dataUrl:'data:image/png;base64,first'}];
  const e=environment({qwen:true,references:refs,optimize:async input=>{if(stage==='planner'){entered.resolve();await gate.promise;}return {prompt:input.prompt,uiPlan:planFor(input.references)};}});
  if(stage==='style')e.sandbox.NovaFlowUiDesignStyleReference={prepare:async values=>{entered.resolve();await gate.promise;return values;},show(){}};
  const run=e.run();await entered.promise;refs[0]={...refs[0],dataUrl:'data:image/png;base64,second'};gate.resolve();await run;
  assert.match(e.failures.at(-1),/变化|旧结果/);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);assert.equal(e.state.results.length,0);
 }
});
test('cancel during style processing ends preparation immediately and ignores its late response',async()=>{
 const e=environment({qwen:true}),gate=deferred(),entered=deferred();tokens(e);
 e.sandbox.NovaFlowUiDesignStyleReference={prepare:async values=>{entered.resolve();await gate.promise;return values;},show(){throw Error('late show must not run');}};
 const run=e.run();await entered.promise;await e.sandbox.cancelArtGenerateRun();await run;
 assert.equal(e.state.running,false);assert.equal(e.uploads.length,0);assert.equal(e.state.results.length,0);gate.resolve();await Promise.resolve();assert.equal(e.calls.includes('/prompt'),false);
});
test('cancel during decode or upload prevents the next upload and dispatch',async()=>{
 for(const stage of ['decode','upload']){
  const e=environment({qwen:true}),gate=deferred(),entered=deferred();tokens(e);e.state.count=1;
  if(stage==='decode')e.sandbox.loadNovaflowArtExportImage=async()=>{entered.resolve();await gate.promise;return {naturalWidth:1280,naturalHeight:720};};
  else e.sandbox.artUploadDataUrl=async()=>{entered.resolve();await gate.promise;return 'staged.png';};
  const run=e.run();await entered.promise;await e.sandbox.cancelArtGenerateRun();gate.resolve();await run;
  assert.equal(e.builds.length,0);assert.equal(e.calls.includes('/prompt'),false);assert.equal(e.calls.includes('/interrupt'),false);assert.equal(e.state.results.length,0);
 }
});
test('a late accepted submission is cancelled by its own prompt ID and cannot publish a result',async()=>{
 const e=environment({qwen:true}),gate=deferred(),entered=deferred(),interrupts=[];tokens(e);e.state.count=1;
 e.sandbox.artRequestJson=async(_base,path,options)=>{e.calls.push(path);if(path==='/prompt'){entered.resolve();await gate.promise;return {ok:true,data:{prompt_id:'only-this-request'}};}if(path==='/interrupt'){interrupts.push(JSON.parse(options.body));return {ok:true};}return {ok:true,data:{}};};
 const run=e.run();await entered.promise;await e.sandbox.cancelArtGenerateRun();assert.equal(interrupts.length,0);gate.resolve();await run;
 assert.deepEqual(interrupts,[{prompt_id:'only-this-request'}]);assert.equal(e.state.results.length,0);
});
test('input changes during node validation and late output conversion cannot dispatch or publish stale work',async()=>{
 for(const stage of ['validation','output']){
  const e=environment({qwen:true}),gate=deferred(),entered=deferred();e.state.count=1;
  if(stage==='validation')e.sandbox.validateArtWorkflowNodes=async()=>{entered.resolve();await gate.promise;};
  else e.sandbox.artBlobToDataUrl=async()=>{entered.resolve();await gate.promise;return 'data:image/png;base64,stale';};
  const run=e.run();await entered.promise;e.state.prompt='changed input';gate.resolve();await run;
  assert.match(e.failures.at(-1),/变化|旧结果/);assert.equal(e.state.results.length,0);if(stage==='validation')assert.equal(e.calls.includes('/prompt'),false);
 }
});
test('multiple explicit style inputs retain individual bytes and roles; duplicate source IDs fail early',async()=>{
 const refs=[{id:'layout',role:'layout',dataUrl:'data:image/png;base64,layout'},{id:'style-a',role:'style',dataUrl:'data:image/png;base64,a'},{id:'style-b',role:'style',dataUrl:'data:image/png;base64,b'},{id:'material',role:'material',dataUrl:'data:image/png;base64,m'}];
 const e=environment({qwen:true,references:refs});e.state.prompt='整屏重做为珊瑚贝壳世界，重新设计全部面板造型';
 const p=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});assert.deepEqual(Array.from(p.references,r=>r.dataUrl),refs.map(r=>r.dataUrl));assert.deepEqual(Array.from(e.adapter.generationOptions(p).referenceRoles,r=>r.sourceId),refs.map(r=>r.id));
 assert.deepEqual(Array.from(p.uiPlan.references,r=>r.role),['layout','style','style','style']);
 const other=environment({qwen:true,references:[refs[0],{...refs[1],id:refs[0].id}]});await other.run();assert.match(other.failures.at(-1),/标识重复/);assert.equal(other.calls.length,0);
});
test('cached plans are isolated from caller mutation and reference/region revisions select new keys',async()=>{
 const e=environment({qwen:true}),p=e.sandbox.NovaFlowUiDesignPromptPipeline,input=e.adapter.inputFor({state:e.state,references:e.references,referenceLimit:10});let calls=0;
 const options={id:'revision-test',input,assistant:{run:async value=>{calls++;return {prompt:'same',uiPlan:planFor(value.references)};}}};
 const first=await p.run(options);first.uiPlan.references[0].role='asset';const cached=await p.run(options);assert.equal(cached.uiPlan.references[0].role,'layout');assert.equal(calls,1);
 for(const patch of [{references:[{...input.references[0],dataUrl:'data:image/png;base64,new'}]},{references:[{...input.references[0],id:'new-id'}]},{editRegion:{x:.1,y:.1,width:.1,height:.1,blockId:'a'}},{size:{width:720,height:1280}}]){await p.run({...options,input:{...input,...patch}});}
 assert.equal(calls,5);
});
test('decoded partial base aspect mismatch is rejected before any upload',async()=>{
 const e=environment({qwen:true});e.state.prompt='只修改高光';e.state.width=720;e.state.height=1280;mountSelection(e,selected());e.sandbox.loadNovaflowArtExportImage=async()=>({naturalWidth:1024,naturalHeight:1024});await e.run();assert.match(e.failures.at(-1),/底图.*尺寸/);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);
});

test('changed input during queue acknowledgement cancels only the accepted old prompt',async()=>{
 const e=environment({qwen:true}),gate=deferred(),entered=deferred(),interrupts=[];e.state.count=1;
 e.sandbox.artRequestJson=async(_base,path,options)=>{if(path==='/prompt'){entered.resolve();await gate.promise;return {ok:true,data:{prompt_id:'stale-input-job'}};}if(path==='/interrupt'){interrupts.push(JSON.parse(options.body));return {ok:true};}return {ok:true,data:{}};};
 const run=e.run();await entered.promise;e.state.prompt='next request';gate.resolve();await run;assert.deepEqual(interrupts,[{prompt_id:'stale-input-job'}]);assert.equal(e.state.results.length,0);assert.match(e.failures.at(-1),/变化/);
});
test('late failure of an old targeted cancel cannot overwrite a newer run status',async()=>{
 const e=environment({qwen:true}),gate=deferred(),entered=deferred();tokens(e);e.state.running=true;e.state.activeBaseUrl='http://test';e.state.activePromptId='old-job';
 e.sandbox.artRequestJson=async(_base,_path,options)=>{assert.deepEqual(JSON.parse(options.body),{prompt_id:'old-job'});entered.resolve();await gate.promise;throw Error('late old cancel failure');};
 const cancelled=e.sandbox.cancelArtGenerateRun();await entered.promise;e.sandbox.beginArtGenerateRun();e.state.running=true;gate.resolve();await cancelled;assert.deepEqual(e.failures,[]);assert.equal(e.state.running,true);
});

test('affirmative whole-theme changes preserve functional layout without being misread as an unselected local edit',async()=>{
 for(const prompt of ['整屏重做为珊瑚贝壳世界，其他功能布局保持不变','将整个界面重新设计成海底游戏，其余位置和数值不变','换成珊瑚主题，其他功能保持不变']){
  const e=environment({qwen:true});e.state.prompt=prompt;const p=await e.adapter.prepare({state:e.state,references:e.references,referenceLimit:10});assert.equal(p.uiPlan.visualMode,'theme-redesign');assert.equal(p.nativeEdit,null);assert.equal(p.state.uiRunIntent,'redesign');
 }
 const e=environment({qwen:true});e.state.prompt='只替换按钮为珊瑚主题，其他不变';await e.run();assert.match(e.failures.at(-1),/选中/);assert.equal(e.builds.length,0);
});

test('all reference declaration aliases reject changing the selected base until the user reselects',async()=>{
 for(const prefix of ['图','参考图','@参考图']){
  const refs=[{id:'selected-base',role:'reference',dataUrl:'data:image/png;base64,selected-base'},{id:'different-base',role:'reference',dataUrl:'data:image/png;base64,different-base'}];
  const e=environment({qwen:true,references:refs});e.state.prompt='只修改高光，其他不变';e.state.width=720;e.state.height=1280;e.state.count=1;mountSelection(e,selected());
  e.state.prompt=prefix+'2为布局，'+prefix+'1为风格，只修改高光，其他不变';await e.run();
  assert.match(e.failures.at(-1)||'',/底图|重新选/);assert.equal(e.calls.includes('optimize'),false);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);
  e.workbenchOptions.onSelectionChange();await e.run();assert.equal(e.builds.length,1);assert.equal(e.builds[0][10].uiNativeEdit.baseSourceId,'different-base');assert.equal(e.builds[0][10].referenceRoles[0].sourceId,'different-base');
 }
});
test('sparse reference slots use the same base binding before and after number compaction',async()=>{
 const refs=[{id:'selected-base',role:'reference',dataUrl:'data:image/png;base64,a'},null,{id:'different-base',role:'reference',dataUrl:'data:image/png;base64,b'}];
 const e=environment({qwen:true,references:refs});e.state.prompt='只修改高光，其他不变';e.state.width=720;e.state.height=1280;e.state.count=1;mountSelection(e,selected());e.state.prompt='图3为布局，图1为风格，只修改高光，其他不变';
 await e.run();assert.match(e.failures.at(-1)||'',/底图|重新选/);assert.equal(e.uploads.length,0);e.workbenchOptions.onSelectionChange();await e.run();assert.equal(e.builds[0][10].uiNativeEdit.baseSourceId,'different-base');assert.equal(e.uploads.length,2);
});
test('compiled native base identity and bytes are checked again before conditioning or uploads',async()=>{
 for(const replacement of [{id:'different-id'},{dataUrl:'data:image/png;base64,different-pixels'}]){
  const refs=[{id:'selected-base',role:'layout',dataUrl:'data:image/png;base64,selected-base'}],e=environment({qwen:true,references:refs});e.state.prompt='只修改高光，其他不变';e.state.width=720;e.state.height=1280;e.state.count=1;mountSelection(e,selected());
  const pipeline=e.sandbox.NovaFlowUiDesignPromptPipeline;e.sandbox.NovaFlowUiDesignPromptPipeline={...pipeline,compileQwenPlan:(result,input)=>{const compiled=pipeline.compileQwenPlan(result,input);return {...compiled,references:[{...compiled.references[0],...replacement}]};}};
  await e.run();assert.match(e.failures.at(-1)||'',/编译.*底图.*绑定/);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);assert.equal(e.state.results.length,0);
 }
});
