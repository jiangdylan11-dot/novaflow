import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source=readFileSync(new URL('../../renderer/art-direction.workflow.js',import.meta.url),'utf8');
const answer={schema:'nf.art.direction.v1',summary:'绘制需求',prompt:'一只蓝色的猫，水彩画风。',preserve:[],exclude:[],clarification:'',references:[]};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function environment(){
  const dispatched=deferred(),response=deferred(),cancelled=[],requests=[];
  const sandbox={console,TextEncoder,crypto:webcrypto,AbortController,setTimeout,clearTimeout,
    localStorage:{getItem:()=>null,setItem(){}},
    NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})},
    electronAPI:{promptAssistantReverseImagePrompt(payload){requests.push(payload);dispatched.resolve(payload);return response.promise;},
      promptAssistantCancelRequest(payload){cancelled.push(payload);return Promise.resolve({ok:true,released:true});}}};
  sandbox.window=sandbox;runInContext(source,createContext(sandbox));
  const create=(tag,props={})=>({tag,...props,children:[],appendChild(child){this.children.push(child);}});
  return {api:sandbox.NovaFlowArtDirection,sandbox,requests,dispatched,response,cancelled,create};
}

test('manual generation cancels the exact in-flight drawing analysis and ignores its late reply',async()=>{
  const e=environment(),state={prompt:'画一只猫',provider:'local',drawingAnalysisEngine:'local'};
  const context={state,references:[],generationSurface:'drawing'};
  const preparing=e.api.prepare(context),rejected=assert.rejects(preparing,error=>error.name==='AbortError');
  const submitted=await e.dispatched.promise;
  assert.match(submitted.requestId,/^art-direction-/);
  await e.api.selectManual(state);
  await rejected;
  assert.equal(state.drawingAnalysisEngine,'direct');
  assert.deepEqual(JSON.parse(JSON.stringify(e.cancelled)),[{requestId:submitted.requestId}]);
  e.response.resolve({ok:true,data:{artDirection:answer}});
  const direct=await e.api.prepare(context);
  assert.equal(direct.direct,true);
  assert.equal(direct.promptSnapshot.prompt,'画一只猫');
  assert.equal(state.prompt,'画一只猫');
  assert.equal(e.requests.length,1,'direct generation does not start another analyzer');
});

test('cancelling before a drawing model request is sent never cancels another local operation',async()=>{
  const e=environment(),state={prompt:'画一只猫',provider:'local',drawingAnalysisEngine:'local'};
  const preparing=e.api.prepare({state,references:[],generationSurface:'drawing'});
  const rejected=assert.rejects(preparing,error=>error.name==='AbortError');
  assert.equal(e.api.cancelPreparation(),true);
  await rejected;
  assert.equal(e.requests.length,0);
  assert.equal(e.cancelled.length,0);
});

test('switching away from cloud analysis does not stop an unrelated local model',async()=>{
  const e=environment(),state={prompt:'画一只猫',provider:'local',drawingAnalysisEngine:'grok'};
  e.sandbox.electronAPI.smartAiImageReverse=e.sandbox.electronAPI.promptAssistantReverseImagePrompt;
  const preparing=e.api.prepare({state,references:[],generationSurface:'drawing'});
  const rejected=assert.rejects(preparing,error=>error.name==='AbortError');
  await e.dispatched.promise;
  await e.api.selectManual(state);
  await rejected;
  assert.equal(e.cancelled.length,0);
  e.response.resolve({ok:true,data:{artDirection:answer}});
});

test('manual entry resets legacy saved local or cloud selection without changing the explicit analysis API',async()=>{
  for(const selected of ['local','grok']){
    const e=environment(),state={prompt:'画一只猫',provider:'local',drawingAnalysisEngine:selected};
    const saved=[];e.sandbox.localStorage.getItem=()=>selected;e.sandbox.localStorage.setItem=(key,value)=>saved.push([key,value]);
    await e.api.selectManual(state);
    const prepared=await e.api.prepare({state,references:[],generationSurface:'drawing'});
    assert.equal(prepared.direct,true);assert.equal(prepared.promptSnapshot.prompt,'画一只猫');assert.equal(e.requests.length,0);
    assert.deepEqual(saved,[['novaflow.drawing.analysis.v2','direct']]);
    assert.equal(e.api.input({state:{...state,drawingAnalysisEngine:'local'},references:[]}).engine,'local','explicit Agent context retains its analysis identity');
    assert.equal(e.api.controls(e.create,state,()=>{}).children.length,0,'three legacy AI buttons are removed');
  }
});

test('manual entry also stops this page legacy helper when no direction analysis is running',async()=>{
  const e=environment(),state={drawingAnalysisEngine:'direct'};
  let cancelled=0;
  e.sandbox.__NovaFlowArtGenerate={cancelPromptAnalysis(){cancelled++;return Promise.resolve({ok:true});}};
  await e.api.selectManual(state);
  assert.equal(cancelled,1);
  assert.equal(e.cancelled.length,0,'no unrelated model is cancelled without a captured direction request');
});

function legacyEnvironment(){
  const brand=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
  const helpers=brand.slice(brand.indexOf('  let artGeneratePromptAssistantRequest = null;'),brand.indexOf('  function finishArtGeneratePromptAssistant(token)'));
  const reverse=brand.slice(brand.indexOf('  async function runArtGenerateReverseImagePrompt(sources)'),brand.indexOf('  function handleArtGenerateReverseButton(event)'));
  const waiting=deferred(),reply=deferred(),release=deferred(),cancelled=[],writes=[];
  const state={prompt:'原提示词',promptAssistantToken:0,promptAssistantRunning:'',promptAssistantError:''};
  const sandbox={console,crypto:webcrypto,ART_GENERATE_STATE:state,
    armArtGenerateRouteHold(){},renderArtGenerateSurfaces(){},setArtGeneratePromptAssistantError(){},showTopbarExportAvailabilityNotice(){},
    appendPromptAssistantPositivePrompt(value){writes.push(value);},finishArtGeneratePromptAssistant(){},
    electronAPI:{promptAssistantReverseImagePrompt(payload){waiting.resolve(payload);return reply.promise;},
      promptAssistantCancelRequest(payload){cancelled.push(payload);return release.promise;}}};
  sandbox.window=sandbox;sandbox.getPromptAssistantApi=()=>sandbox.electronAPI;
  runInContext(helpers+reverse+'\n globalThis.legacy={beginArtGeneratePromptAssistantRequest,cancelArtGeneratePromptAnalysis,runArtGenerateReverseImagePrompt};',createContext(sandbox));
  return {api:sandbox.legacy,waiting,reply,release,cancelled,writes,state,sandbox};
}

test('legacy static reverse is cancelled by exact ID, release is shared, and no late prompt writeback occurs',async()=>{
  const e=legacyEnvironment();
  const running=e.api.runArtGenerateReverseImagePrompt([{dataUrl:'data:image/png;base64,eA=='}]);
  const submitted=await e.waiting.promise;
  assert.equal(submitted.purpose,'static-image-reverse');assert.match(submitted.requestId,/^art-helper-/);
  const cancelling=e.api.cancelArtGeneratePromptAnalysis(),second=e.api.cancelArtGeneratePromptAnalysis();
  assert.equal(e.cancelled.length,1,'a second caller awaits the same exact release');
  assert.equal(e.cancelled[0].requestId,submitted.requestId);
  assert.equal(e.state.promptAssistantToken,2,'only one invalidation of this request');
  e.reply.resolve({ok:true,data:{prompt:'不应写入的旧反推结果'}});await running;
  assert.equal(e.writes.length,0);
  e.release.resolve({ok:true,cancelled:true,released:true});await Promise.all([cancelling,second]);
  const after=await e.api.cancelArtGeneratePromptAnalysis();assert.equal(after.cancelled,false);
});

test('a failed exact cancellation retains ownership so a later no AI run can retry instead of assuming release',async()=>{
  const e=legacyEnvironment();
  e.api.beginArtGeneratePromptAssistantRequest(4);e.state.promptAssistantToken=4;
  let attempts=0;
  e.sandbox.electronAPI.promptAssistantCancelRequest=async()=>({ok:++attempts>1,error:'release not yet confirmed'});
  assert.equal((await e.api.cancelArtGeneratePromptAnalysis()).ok,false);
  assert.equal((await e.api.cancelArtGeneratePromptAnalysis()).ok,true);
  assert.equal(attempts,2);assert.equal(e.state.promptAssistantToken,5);
});
