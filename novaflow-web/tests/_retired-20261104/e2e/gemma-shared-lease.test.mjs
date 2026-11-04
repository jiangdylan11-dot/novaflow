import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const payload=(model,id)=>({modelId:model,requestId:'request-'+id,mode:'chat',message:'hello',history:[]});
function make({nextUnload,gemmaLoad}={}) {
  const events=[];
  const factory=(name,loadGate,unloadGate)=>({withSession:async callback=>{
    events.push(name+'-load');if(loadGate)await loadGate.promise;
    const value=await callback({identity:{id:name},inferConversation:async()=>({model:name,requestId:name+'-inference',finishReason:'stop',message:{role:'assistant',content:name+' reply'}})});
    events.push(name+'-unload-start');if(unloadGate)await unloadGate.promise;events.push(name+'-unload-end');
    return {value,identity:{id:name},timing:{},resourcesReleased:true};
  }});
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:['next']}},lifecycle:{load:async()=>{},unload:async()=>({released:true})},
    sessionFactory:()=>factory('next',null,nextUnload),gemmaSession:factory('gemma',gemmaLoad),comfyUrls:[],isolatedCommunityRuntimeForTest:true});
  return {assistant,events};
}
test('switching model releases the previous warm session before loading the next',async()=>{
  const {assistant,events}=make();
  assert.equal((await assistant.artAgentChat(payload('next','n1'))).ok,true);
  assert.equal((await assistant.artAgentChat(payload('gemma-4-12b-it','g1'))).ok,true);
  assert.ok(events.indexOf('next-unload-end')<events.indexOf('gemma-load'));
  await assistant.stop();assert.ok(events.includes('gemma-unload-end'));
});
test('generation waits for a loading Gemma and its release, then excludes chat',async()=>{
  const load=deferred(),{assistant,events}=make({gemmaLoad:load});
  const call=assistant.artAgentChat(payload('gemma-4-12b-it','g2'));
  while(!events.includes('gemma-load'))await new Promise(r=>setTimeout(r,1));
  let acquired=false;const reservation=assistant.acquireGeneration('draw').then(r=>{acquired=true;return r;});
  await new Promise(r=>setTimeout(r,5));assert.equal(acquired,false);load.resolve();
  assert.equal((await call).ok,true);const release=await reservation;
  assert.ok(events.includes('gemma-unload-end'));assert.equal((await assistant.artAgentChat(payload('next','n2'))).errorCode,'prompt-assistant-busy');
  release();await assistant.stop();
});
test('cancel during model handoff does not start the selected model',async()=>{
  const unload=deferred(),{assistant,events}=make({nextUnload:unload});
  assert.equal((await assistant.artAgentChat(payload('next','n3'))).ok,true);
  const call=assistant.artAgentChat(payload('gemma-4-12b-it','g3'));
  while(!events.includes('next-unload-start'))await new Promise(r=>setTimeout(r,1));
  const stopped=assistant.artAgentStop({requestId:'request-g3'});unload.resolve();
  assert.equal((await call).ok,false);await stopped;assert.equal(events.includes('gemma-load'),false);await assistant.stop();
});
