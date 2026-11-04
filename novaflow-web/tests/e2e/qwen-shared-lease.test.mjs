import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';
import { localModelSelectionFailure } from '../../worker/src/local-model-selection.mjs';

const payload=(model,id)=>({modelId:model,requestId:'qwen-lease-'+id,mode:'chat',message:'hello',history:[]});
function make() {
  const events=[];
  const session=name=>({withSession:async callback=>{
    events.push(name+'-load');
    const value=await callback({identity:{id:name},inferConversation:async()=>({model:name,requestId:name+'-reply',finishReason:'stop',message:{role:'assistant',content:name+' reply'}})});
    events.push(name+'-unload');return {value,identity:{id:name},timing:{},resourcesReleased:true};
  }});
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:['next']}},
    lifecycle:{load:async()=>{},unload:async()=>({released:true})},sessionFactory:()=>session('next'),
    gemmaSession:session('gemma'),qwenSession:session('qwen'),comfyUrls:[],isolatedCommunityRuntimeForTest:true});
  return {assistant,events};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('unavailable Qwen does not fall back to Next',()=>{
  assert.equal(localModelSelectionFailure({modelId:'qwen3.5-9b-heretic'}).errorCode,'local-model-unavailable');
  assert.equal(localModelSelectionFailure({modelId:'qwen3.5-9b-heretic'},{qwenAvailable:true}),null);
});
test('generation waits for Qwen loading and release before acquiring',async()=>{
  const gate=deferred(), events=[];
  const qwenSession={withSession:async callback=>{
    events.push('qwen-load');await gate.promise;
    const value=await callback({identity:{id:'qwen'},inferConversation:async()=>({model:'qwen',requestId:'q1',finishReason:'stop',message:{role:'assistant',content:'ok'}})});
    events.push('qwen-unload');return {value,identity:{id:'qwen'},timing:{},resourcesReleased:true};
  }};
  const assistant=createStrataPromptAssistant({qwenSession,comfyUrls:[],isolatedCommunityRuntimeForTest:true});
  const call=assistant.artAgentChat(payload('qwen3.5-9b-heretic','pending'));
  while(!events.includes('qwen-load'))await new Promise(r=>setTimeout(r,1));
  let acquired=false;const reservation=assistant.acquireGeneration('generation').then(release=>{acquired=true;return release;});
  await new Promise(r=>setTimeout(r,5));assert.equal(acquired,false);gate.resolve();
  assert.equal((await call).ok,true);const release=await reservation;
  assert.ok(events.includes('qwen-unload'));release();await assistant.stop();
});
