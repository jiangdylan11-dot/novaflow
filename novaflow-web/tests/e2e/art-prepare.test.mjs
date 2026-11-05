// The drawing page's own preparation: roles, slot order and <imageN> compiling, plus the real
// Generate entry, which submits once with no analysis, review or correction.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

let passed=0,failed=0;
async function test(name,fn){
  try{await fn();passed++;console.log('ok  '+name);}
  catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}
}
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const modelSandbox={module:{exports:{}}};
runInContext(read('../../renderer/art-generate-model.resource.js'),createContext(modelSandbox));
const models=modelSandbox.module.exports;
function env(){
  const sandbox={console,TextEncoder,crypto:webcrypto,AbortController,queueMicrotask,setTimeout,clearTimeout,document:{},localStorage:{getItem:()=>null,setItem(){}},
    NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'}),isStyleRedraw:models.isStyleRedraw}};
  sandbox.window=sandbox;runInContext(read('../../renderer/art-prepare.workflow.js'),createContext(sandbox));
  return {api:sandbox.NovaFlowArtPrepare,sandbox};
}
const ref=(id,role)=>({dataUrl:`data:image/png;base64,${Buffer.from(id).toString('base64')}`,drawingRole:role,name:id+'.png'});
const ctx=(state,references)=>({state:{provider:'local',mode:'img2img',width:1280,height:960,...state},references,referenceLimit:10});
const plain=value=>JSON.parse(JSON.stringify(value));

await test('a reversed style request runs subject first and compiles to request slots',async()=>{
  for(const suffix of ['','，保留原配色','，保持原光感','，保持原构图']){
    const {api}=env();
    const r=await api.prepare(ctx({prompt:'图5按图2画风'+suffix},[null,ref('style'),null,null,ref('photo')]));
    assert.deepEqual(plain(r.references.map(x=>[x.sourceNumber,x.role])),[[5,'subject'],[2,'style']]);
    assert.equal(r.promptSnapshot.prompt,'<image1>按<image2>画风'+suffix);
    assert.equal(api.generationOptions(r).styleRedraw,true);assert.equal(r.state.uiPreserveLayout,false);
  }
});

await test('explicit page roles decide, and several style images stay one style redraw',async()=>{
  const {api}=env();
  const r=await api.prepare(ctx({prompt:'重绘'},[ref('a','style'),ref('b','subject'),ref('c','style')]));
  assert.deepEqual(plain(r.references.map(x=>x.sourceNumber)),[2,1,3]);
  assert.deepEqual(plain(api.generationOptions(r)),{taskProfile:'art-direction',referenceRoles:['subject','style','style'],styleRedraw:true});
});

await test('any other job for the second image is not a style redraw',async()=>{
  for(const prompt of ['图1用图2姿势','图1用图2画风和姿势','图1用图2姿势和画风','图1用图2画风和背景','图1的衣服款式用图2']){
    const {api}=env(),r=await api.prepare(ctx({prompt},[ref('photo'),ref('control')]));
    assert.equal(api.generationOptions(r).styleRedraw,false,prompt);
  }
});

await test('an edited online draft keeps its image tags instead of nesting them',async()=>{
  const {api}=env(),r=await api.prepare(ctx({prompt:'Redraw <image2> in the style of <image1>'},[ref('style','style'),ref('photo','subject')]));
  assert.equal(r.promptSnapshot.prompt,'Redraw <image1> in the style of <image2>');
});

await test('the panel reads the same roles the run uses',async()=>{
  const {api}=env(),state={prompt:'图5按图2画风'},refs=[null,ref('style'),null,null,ref('photo')];
  const options=api.samplingOptions(ctx(state,refs));assert.equal(options.styleRedraw,true);assert.deepEqual(plain(options.referenceRoles),['subject','style']);
  assert.equal(models.localSamplingFor({provider:'local',localDrawEngine:'qwen-2.1',localQwen21Variant:'turbo'},'img2img','',undefined,'drawing',options).cfg,3);
  assert.equal(api.samplingOptions(ctx({prompt:'换成白色衬衫'},[ref('photo')])).styleRedraw,false);
});

await test('a draft reports its plan roles, since page references carry no role of their own',()=>{
  const {api}=env();
  const options=api.generationOptions({references:[{dataUrl:'x'},{dataUrl:'y'}],referenceRolePlan:{roles:['subject','style']}});
  assert.equal(options.styleRedraw,true);
});

await test('text to image drops stale references, and bad input stops before a run',async()=>{
  const {api}=env(),r=await api.prepare(ctx({prompt:'画一只猫',mode:'txt2img'},[ref('old')]));
  assert.equal(r.references.length,0);assert.equal(r.state.mode,'txt2img');assert.equal(r.state.localDrawEngine,'qwen-2.1');
  await assert.rejects(api.prepare(ctx({prompt:''},[ref('a')])),/请写一句要求/);
  await assert.rejects(api.prepare(ctx({prompt:'图3换衣服'},[ref('a')])),/参考图3尚未添加/);
  await assert.rejects(api.prepare(ctx({prompt:'换衣服'},[{dataUrl:'data:image/gif;base64,R0lG',name:'a.gif'}])),/图片格式不受支持/);
  await assert.rejects(api.prepare({...ctx({prompt:'换衣服'},[ref('a'),ref('b')]),referenceLimit:1}),/支持 1 张参考图/);
});

await test('a changed owner stops the prepared run',async()=>{
  const {api}=env();let owner=true;
  const r=await api.prepare({...ctx({prompt:'画一只猫',mode:'txt2img'},[]),isOwnerCurrent:()=>owner});
  r.assertCurrent();owner=false;assert.throws(()=>r.assertCurrent(),/已变化/);
});

function drawingRun(){
  const e=env();
  const state={provider:'local',mode:'img2img',prompt:'',drawingTask:'anime',negativePrompt:'',width:768,height:1024,count:1,randomSeed:false,seed:17,loras:[],samplingOverrides:{},results:[]};
  const refs=[ref('base')],builds=[],uploads=[],statuses=[];const noop=()=>{};
  Object.assign(e.sandbox,{URLSearchParams,ART_GENERATE_STATE:state,cancelArtGeneratePromptAnalysis:async()=>({ok:true}),NovaFlowUiDesignDrawing:{shouldPrepare:()=>false,isActive:()=>false},NovaFlowWebRuntime:{},
    captureArtGeneratePromptSnapshot:()=>({prompt:state.prompt,negativePrompt:state.negativePrompt}),artGenerateReferences:()=>refs,artGenerateReferenceLimit:()=>10,artGenerateProviderTitle:p=>p,
    resetArtGenerateProgress:noop,setArtGenerateProgress:noop,setArtGenerateStatus:(s,error)=>statuses.push({s,error}),compileArtGeneratePromptMentions:(_refs,text)=>({text,invalidTokens:[]}),addArtGeneratePromptHistory:noop,
    beginArtGenerateRun:()=>1,isArtGenerateRunCurrent:()=>true,detectArtGenerateBaseUrl:async()=> 'http://test',artDataUrlMime:()=> 'image/png',artUploadDataUrl:async(_base,name,dataUrl)=>{uploads.push({name,dataUrl});return name;},
    loadNovaflowArtExportImage:async()=>({naturalWidth:768,naturalHeight:1024}),normalizeArtGenerateCount:n=>n,buildArtGenerateWorkflowWithSeed:(_seed,build)=>build(),
    buildArtGenerateRunWorkflow:(...args)=>{builds.push(args);return {workflow:{},modelKey:'drawing'};},applyArtReferenceControlNet:()=>({applied:0}),validateArtWorkflowNodes:async()=>{},withArtGenerateTimeout:task=>task(),
    artRequestJson:async(_base,path)=>({ok:true,data:path==='/prompt'?{prompt_id:'test'}:{test:{}}}),artHistoryErrorMessage:()=>'',extractArtGenerateFiles:()=>[{filename:'result.png'}],artFetchBlob:async()=>({}),artBlobToDataUrl:async()=>ref('result').dataUrl,artWorkflowKey:()=> 'drawing',
    artStyleToneReference:()=>'',placeArtGenerateResultIntoSource:async()=>true,renderArtGenerateSurfaces:noop,clearArtGenerateBatch:noop,clearArtGenerateRunIfCurrent:noop,artGenerateBatchProgress:label=>({label,pct:0}),addEventListener:noop,removeEventListener:noop,
    ART_GENERATE_WEB_PROMPT_TIMEOUT_MS:1,ART_GENERATE_WORKFLOW_TIMEOUT_MS:1,ART_GENERATE_PROMPT_TIMEOUT_MS:1,ART_GENERATE_HISTORY_TIMEOUT_MS:1,ART_GENERATE_DOWNLOAD_TIMEOUT_MS:1});
  e.sandbox.document.body={classList:{contains:name=>name==='novaflow-primary-target-art'}};
  const source=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
  runInContext('let pendingArtAgentPreparation=null;',e.sandbox);
  runInContext(source.slice(source.indexOf('  function resolveArtGenerateReferenceInputs('),source.indexOf('  async function runArtGenerate(')),e.sandbox);
  runInContext(source.slice(source.indexOf('  async function runArtGenerate('),source.indexOf('  function createArtGenerateExecutionBridge()')),e.sandbox);
  return {e,state,refs,builds,uploads,statuses,run:options=>e.sandbox.runArtGenerate(options)};
}
function uploadedReference(name = 'upload.png') {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const file = new File([bytes], name, { type: 'image/png' });
  return { name, dataUrl: 'blob:test/' + name, mimeType: 'image/png', file, drawingRole: 'subject', bytes };
}

await test('AI reverse prompt sends a data url for an uploaded blob reference', async () => {
  const source = readFileSync(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 4, 5, 6]);
  const file = new File([bytes], 'rev.png', { type: 'image/png' });
  const calls = [];
  const sandbox = {
    ART_GENERATE_STATE: { promptAssistantRunning: '', promptAssistantToken: 0, promptAssistantError: '', error: '', status: '', nsfw: false, prompt: '' },
    artGeneratePromptAssistantRequest: null,
    armArtGenerateRouteHold() {},
    renderArtGenerateSurfaces() {},
    setArtGeneratePromptAssistantError() {},
    appendPromptAssistantPositivePrompt() {},
    finishArtGeneratePromptAssistant() {},
    showTopbarExportAvailabilityNotice() {},
    beginArtGeneratePromptAssistantRequest: () => 'reverse-1',
    async resolveArtReferenceDataUrl(item) {
      if (/^data:[^;,]+;base64,/i.test(item?.dataUrl || '')) return item.dataUrl;
      const raw = new Uint8Array(await item.file.arrayBuffer());
      return `data:${item.file.type || 'image/png'};base64,${Buffer.from(raw).toString('base64')}`;
    },
    getPromptAssistantApi: () => ({
      promptAssistantReverseImagePrompt: async (payload) => {
        calls.push(JSON.parse(JSON.stringify(payload)));
        return { ok: false, error: 'stop after payload' };
      }
    })
  };
  sandbox.window = sandbox;
  const start = source.indexOf('  async function runArtGenerateReverseImagePrompt(');
  const end = source.indexOf('  function handleArtGenerateReverseButton(');
  runInContext(source.slice(start, end), createContext(sandbox));
  await sandbox.runArtGenerateReverseImagePrompt([{ index: 0, label: '图1', name: 'rev.png', dataUrl: 'blob:test/rev.png', file, mimeType: 'image/png' }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].images[0].dataUrl, /^data:image\/png;base64,/);
  assert.equal(calls[0].images[0].dataUrl.includes('blob:'), false);
  assert.deepEqual(Buffer.from(calls[0].images[0].dataUrl.slice(calls[0].images[0].dataUrl.indexOf(',') + 1), 'base64'), Buffer.from(bytes));
  assert.equal(JSON.stringify(calls[0]).includes('blob:'), false);
});


await test('the Generate entry submits a typed edit once, with no review on the result',async()=>{
  const d=drawingRun();d.state.prompt='换成白色衬衫，保持背景';
  await d.run();
  assert.equal(d.builds.length,1);assert.equal(d.uploads.length,1);assert.equal(d.builds[0][4],d.state.prompt);assert.equal(d.uploads[0].dataUrl,d.refs[0].dataUrl);
  assert.equal(d.builds[0][10].taskProfile,'art-direction');assert.deepEqual(plain(d.builds[0][10].referenceRoles),['subject']);
  assert.equal(d.state.results.length,1);assert.equal(d.state.results[0].artDirection,undefined);assert.equal(d.state.running,false);assert.equal(d.statuses.some(s=>s.error),false);
});

await test('the Generate entry runs text to image twice the same way',async()=>{
  const d=drawingRun();d.refs.length=0;d.state.mode='txt2img';d.state.prompt='冰系女剑客';
  await d.run();await d.run();assert.equal(d.builds.length,2);assert.equal(d.builds[0][4],'冰系女剑客');
});

await test('the Generate entry turns an uploaded blob reference into base64 before upload',async()=>{
  const d=drawingRun(),reference=uploadedReference();d.refs[0]=reference;d.state.prompt='按这张参考图生成';
  await d.run();
  assert.equal(d.uploads.length,1);assert.match(d.uploads[0].dataUrl,/^data:image\/png;base64,/);
  assert.deepEqual(Buffer.from(d.uploads[0].dataUrl.slice(d.uploads[0].dataUrl.indexOf(',')+1),'base64'),Buffer.from(reference.bytes));
  assert.equal(d.refs[0].dataUrl,'blob:test/upload.png');
});

console.log(`${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
