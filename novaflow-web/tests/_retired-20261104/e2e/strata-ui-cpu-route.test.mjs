import test from 'node:test';
import assert from 'node:assert/strict';
import {createStrataPromptAssistant} from '../../worker/src/strata-prompt-assistant.mjs';

const scope={surface:'ui-design',uiPlanner:'grok-vision-cpu-v1'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({configured=true,missingCpu=false,cpuError=false,hold,stages=false}={}) {
  const calls={load:0,unload:0,sessions:0,infer:[],cpu:[],comfy:0,workerState:0,legacy:0};
  const reply={ok:true,data:{protocol:'nf.ui.grok-cpu.v1',cpuOnly:true,localCompletePlanner:'native-catalog-v3'}};
  const assistant=createStrataPromptAssistant({config:configured?{expectedModel:{ids:['flash-fixture']}}:null,configPath:'Z:/missing/strata-prompt.json',
    lifecycle:{load:async()=>{calls.load++;},unload:async()=>{calls.unload++;return {released:true};}},
    worker:{getState:()=>{calls.workerState++;return {};}},comfyUrls:['http://127.0.0.1:9999'],
    fetchImpl:async url=>{calls.comfy++;return Response.json(url.endsWith('/queue')?{queue_running:[],queue_pending:[]}:{});},
    sessionFactory:()=>({withSession:async callback=>{calls.sessions++;calls.load++;
      const value=await callback({identity:{id:'flash-fixture'},infer:async input=>{calls.infer.push(input.stage);return {text:'native',model:'flash-fixture',requestId:input.stage};}});
      calls.unload++;return {value,identity:{id:'flash-fixture'},timing:{loadMs:1,callbackMs:1,unloadMs:1}};}}),
    legacyApi:{...(missingCpu?{}:{reverseImagePrompt:async payload=>{calls.cpu.push(payload);if(cpuError)throw Error('invalid CPU catalog');return reply;}}),
      runWithFlashSession:async(flash,method,payload)=>{calls.legacy++;if(hold){hold.entered.resolve();await hold.release.promise;}
        if(stages)for(const stage of ['source-natural','source-grid','source-controls','native-art'])await flash.infer({stage});
        return {ok:true,data:{prompt:'CPU compiled ordinary UI',method,payload}};},stop:async()=>{}}
  });
  return {assistant,calls,reply};
}

test('renderer UI capability and compile/job bridge stays CPU with Flash unconfigured',async()=>{
  const {assistant,calls,reply}=fixture({configured:false});assert.equal(assistant.status().enabled,false);
  for(const action of ['capabilities','grok-vision-job','compile-grok-vision','native-ui-cloud','native-ui-compile']){
    const payload={...scope,action,images:[{dataUrl:''}],opaque:{literal:'原始CPU输入'}};
    const result=await assistant.reverseImagePrompt(payload);assert.equal(result,reply);assert.equal(calls.cpu.at(-1),payload);
    assert.equal(result.modelIdentity,undefined);assert.equal(result.generationReady,undefined);
  }
  assert.equal(calls.cpu.length,5);assert.equal(calls.load,0);assert.equal(calls.unload,0);assert.equal(calls.sessions,0);
  assert.equal(calls.comfy,0);assert.equal(calls.workerState,0);assert.equal(calls.legacy,0);
});

test('direct and pool-task CPU routes bypass an already busy model without changing its lease',async()=>{
  const hold={entered:deferred(),release:deferred()}, {assistant,calls}=fixture({hold});
  const first=assistant.optimizePrompt({prompt:'normal inference'});await hold.entered.promise;
  assert.equal(assistant.busy,true);const before={load:calls.load,unload:calls.unload,sessions:calls.sessions,comfy:calls.comfy,workerState:calls.workerState};
  assert.equal((await assistant.reverseImagePrompt({...scope,action:'capabilities'})).ok,true);
  assert.equal((await assistant.runForTask('cpu-task','reverseImagePrompt',{...scope,action:'native-ui-compile'})).ok,true);
  assert.equal(assistant.busy,true);assert.deepEqual({load:calls.load,unload:calls.unload,sessions:calls.sessions,comfy:calls.comfy,workerState:calls.workerState},before);
  hold.release.resolve();assert.equal((await first).ok,true);assert.equal(calls.sessions,1);assert.equal(calls.unload,1);
});

test('CPU route works during a generation reservation while model tasks remain blocked',async()=>{
  const {assistant,calls}=fixture(),release=await assistant.acquireGeneration('draw');
  assert.equal((await assistant.reverseImagePrompt({...scope,action:'capabilities'})).ok,true);
  assert.equal((await assistant.reverseImagePrompt({surface:'ui-design',uiPlanner:'native-catalog-v3'})).errorCode,'prompt-assistant-busy');
  assert.equal(calls.load,0);assert.equal(calls.comfy,0);release();
});

test('ordinary UI four-stage work still enters one owned model session',async()=>{
  const {assistant,calls}=fixture({stages:true});
  const result=await assistant.runForTask('ui','reverseImagePrompt',{surface:'ui-design',uiPlanner:'native-catalog-v3'});
  assert.equal(result.ok,true);assert.equal(result.resourcesReleased,true);assert.equal(result.generationReady,true);
  assert.deepEqual(calls.infer,['source-natural','source-grid','source-controls','native-art']);
  assert.equal(calls.cpu.length,0);assert.equal(calls.sessions,1);assert.equal(calls.load,1);assert.equal(calls.unload,1);assert.equal(calls.comfy,3);
});

test('CPU dispatch requires the exact surface, planner and reverse method',async()=>{
  for(const [method,payload] of [
    ['reverseImagePrompt',{surface:'art',uiPlanner:'grok-vision-cpu-v1',action:'capabilities'}],
    ['reverseImagePrompt',{surface:'ui-design',uiPlanner:'native-catalog-v3',action:'capabilities'}],
    ['reverseImagePrompt',{surface:'ui-design',action:'capabilities'}],
    ['optimizePrompt',{...scope,action:'capabilities'}],
  ]){
    const {assistant,calls}=fixture();await assistant[method](payload);assert.equal(calls.cpu.length,0);assert.equal(calls.sessions,1);
  }
});

test('unknown CPU action and missing compiler fail clearly without a model fallback',async()=>{
  const unknown=fixture({configured:false});assert.equal((await unknown.assistant.reverseImagePrompt({...scope,action:'run-native-ai'})).errorCode,'invalid-request');assert.equal(unknown.calls.cpu.length,0);assert.equal(unknown.calls.sessions,0);assert.equal(unknown.calls.comfy,0);
  const missing=fixture({configured:false,missingCpu:true});assert.equal((await missing.assistant.reverseImagePrompt({...scope,action:'capabilities'})).errorCode,'ui-design-cpu-unavailable');assert.equal(missing.calls.sessions,0);assert.equal(missing.calls.comfy,0);
  const failed=fixture({cpuError:true});assert.equal((await failed.assistant.reverseImagePrompt({...scope,action:'native-ui-compile'})).errorCode,'ui-design-cpu-failed');assert.equal(failed.calls.sessions,0);assert.equal(failed.calls.comfy,0);
});

test('cancelled pool CPU request does not dispatch or touch model resources',async()=>{
  const {assistant,calls}=fixture();const result=await assistant.runForTask('cancelled','reverseImagePrompt',{...scope,action:'capabilities'},{isCancelled:()=>true});
  assert.equal(result.errorCode,'task-cancelled');assert.equal(calls.cpu.length,0);assert.equal(calls.sessions,0);assert.equal(calls.comfy,0);
});
