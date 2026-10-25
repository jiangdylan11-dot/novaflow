import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';
import { computeArtAgentFingerprint } from '../../worker/src/flash-art-agent.mjs';

// Exercise the actual session coordinator with mocked HTTP/lifecycle. No server
// or GPU is started, and no production resource configuration is changed.
const MODEL='progress-fixture';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function request(mode='drawing') {
  const value={requestId:randomUUID(),mode,message:'请核对这次绘图需求',history:[],
    artContext:{provider:'local',engine:'qwen-2.1',nsfw:false,mode:mode==='creation'?'txt2img':'img2img',prompt:'',negativePrompt:'keep negative',
      ...(mode==='creation'?{task:'creation'}:{referenceRoles:['subject','style']})},
    images:mode==='creation'?[]:[{role:'subject',dataUrl:PNG},{role:'style',dataUrl:PNG}]};
  value.contextFingerprint=computeArtAgentFingerprint(value);return value;
}
function fixture({onLoad=async()=>{},onInfer=async()=>{},onUnload=async()=>{}}={}) {
  const events=[];
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:[MODEL]}},comfyUrls:[],
    lifecycle:{load:async options=>{events.push(['load',options.ownerToken]);await onLoad(options);return {ok:true};},
      unload:async options=>{events.push(['unload',options.ownerToken]);await onUnload(options);return {ok:true,released:true};}},
    fetchImpl:async(url,init)=>{
      if(url.endsWith('/v1/models'))return Response.json({data:[{id:MODEL}]});
      if(url.endsWith('/props'))return new Response('',{status:404});
      assert.ok(url.endsWith('/v1/chat/completions'));
      events.push(['infer',JSON.parse(init.body)]);await onInfer(init.signal);
      return Response.json({model:MODEL,id:randomUUID(),choices:[{finish_reason:'stop',message:{role:'assistant',content:'已核对本次需求。'}}]});
    }});
  return {assistant,events};
}

for(const mode of ['drawing','creation'])test(`${mode} exposes request-bound loading, analysis and owned release without claiming warm chat`,async()=>{
  const loadEntered=deferred(),loadGate=deferred(),inferEntered=deferred(),inferGate=deferred(),releaseEntered=deferred(),releaseGate=deferred();
  const {assistant,events}=fixture({onLoad:async()=>{loadEntered.resolve();await loadGate.promise;},
    onInfer:async()=>{inferEntered.resolve();await inferGate.promise;},onUnload:async()=>{releaseEntered.resolve();await releaseGate.promise;}});
  assert.equal(assistant.status().operation,null);
  const payload=request(mode),running=assistant.artAgentChat(payload);await loadEntered.promise;
  const loading=assistant.status();
  assert.deepEqual(Object.keys(loading.operation).sort(),['mode','phase','phaseStartedAt','requestId','startedAt'].sort());
  assert.equal(loading.operation.requestId,payload.requestId);assert.equal(loading.operation.mode,mode);assert.equal(loading.operation.phase,'loading');
  assert.ok(loading.operation.startedAt<=loading.operation.phaseStartedAt);assert.equal(loading.runtimeStatus,'加载中');
  assert.equal(loading.chatSession.state,'cold');assert.equal(loading.modelLoaded,false);
  loading.operation.phase='tampered';assert.equal(assistant.status().operation.phase,'loading','Status snapshots cannot mutate live progress');
  const other=request(mode);assert.equal((await assistant.artAgentChat(other)).errorCode,'prompt-assistant-busy');
  assert.equal((await assistant.artAgentStop({requestId:other.requestId})).errorCode,'art-agent-not-current');
  assert.equal(assistant.status().operation.requestId,payload.requestId,'Unrelated requests cannot replace or cancel this progress');
  loadGate.resolve();await inferEntered.promise;const analyzing=assistant.status();
  assert.equal(analyzing.operation.phase,'analyzing');assert.equal(analyzing.operation.startedAt,loading.operation.startedAt);
  assert.ok(analyzing.operation.phaseStartedAt>=loading.operation.phaseStartedAt);assert.equal(analyzing.runtimeStatus,'分析中');
  inferGate.resolve();await releaseEntered.promise;const releasing=assistant.status();
  assert.equal(releasing.operation.phase,'releasing');assert.equal(releasing.operation.requestId,payload.requestId);assert.equal(releasing.runtimeStatus,'释放中');
  releaseGate.resolve();const result=await running;assert.equal(result.ok,true);assert.equal(result.resourcesReleased,true);assert.equal(assistant.status().operation,null);
  assert.deepEqual(events.map(item=>item[0]),['load','infer','unload'],'Progress adds no inference or lifecycle calls');
  assert.equal(events[0][1],events.at(-1)[1],'Release remains bound to the actual owned load');
  const next=request(mode),nextResult=await assistant.artAgentChat(next);assert.equal(nextResult.ok,true);assert.equal(assistant.status().operation,null);
});

test('partial load reports its owned release and clears progress on failure',async()=>{
  const releaseEntered=deferred(),releaseGate=deferred();
  const {assistant,events}=fixture({onLoad:async()=>{throw Error('partial load');},onUnload:async()=>{releaseEntered.resolve();await releaseGate.promise;}});
  const payload=request(),running=assistant.artAgentChat(payload);await releaseEntered.promise;
  assert.equal(assistant.status().operation.requestId,payload.requestId);assert.equal(assistant.status().operation.phase,'releasing');
  releaseGate.resolve();const result=await running;assert.equal(result.ok,false);assert.equal(result.errorCode,'strata-load-failed');
  assert.equal(assistant.status().operation,null);assert.deepEqual(events.map(item=>item[0]),['load','unload']);
});

test('failed release clears request progress but preserves the resource fault and exact-owner recovery',async()=>{
  let failRelease=true;const seen=[];let assistant;
  ({assistant}=fixture({onInfer:async()=>{throw Error('inference failed');},onUnload:async()=>{
    seen.push(assistant.status().operation);if(failRelease)throw Error('release failed');}}));
  const payload=request('creation'),result=await assistant.artAgentChat(payload);
  assert.equal(result.errorCode,'strata-release-unconfirmed');assert.equal(seen[0].phase,'releasing');assert.equal(seen[0].requestId,payload.requestId);
  assert.equal(assistant.status().operation,null);assert.equal(assistant.status().runtimeStatus,'模型释放失败');
  assert.equal((await assistant.artAgentChat(request())).errorCode,'strata-release-unconfirmed');assert.equal(assistant.status().operation,null);
  failRelease=false;await assistant.stop();assert.equal(seen[1],null,'A delayed owner cleanup cannot revive stale request progress');
  assert.equal(assistant.status().operation,null);assert.notEqual(assistant.status().runtimeStatus,'模型释放失败');
});

test('matching cancellation keeps release visible until owned cleanup completes, then clears the request',async()=>{
  const inferEntered=deferred(),releaseEntered=deferred(),releaseGate=deferred();
  const {assistant}=fixture({onInfer:signal=>new Promise((resolve,reject)=>{
    inferEntered.resolve();signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});
  }),onUnload:async()=>{releaseEntered.resolve();await releaseGate.promise;}});
  const payload=request(),running=assistant.artAgentChat(payload);await inferEntered.promise;
  const stopping=assistant.artAgentStop({requestId:payload.requestId});await releaseEntered.promise;
  assert.equal(assistant.status().operation.requestId,payload.requestId);assert.equal(assistant.status().operation.phase,'releasing');
  releaseGate.resolve();assert.equal((await running).ok,false);assert.equal((await stopping).released,true);
  assert.equal(assistant.status().operation,null);assert.equal(assistant.status().chatSession.state,'cold');
});

test('ordinary warm chat keeps its existing residency status and never impersonates a drawing operation',async()=>{
  const {assistant}=fixture();const payload={requestId:randomUUID(),mode:'chat',message:'你好',history:[]};
  const result=await assistant.artAgentChat(payload);assert.equal(result.ok,true);assert.equal(assistant.status().operation,null);
  assert.equal(assistant.status().chatSession.state,'warm');assert.equal(assistant.status().modelLoaded,true);
  await assistant.stop();assert.equal(assistant.status().operation,null);assert.equal(assistant.status().chatSession.state,'cold');
});
