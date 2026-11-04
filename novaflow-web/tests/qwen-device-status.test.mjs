import test from 'node:test';
import assert from 'node:assert/strict';
import {createStrataPromptAssistant} from '../worker/src/strata-prompt-assistant.mjs';

function fixture(device, options={}) {
  const qwenSession={async withSession(callback) {
    const flash={identity:{id:'qwen35-heretic'},...(device?{executionDevice:device}:{}),
      async inferConversation(){return {model:'qwen35-heretic',requestId:'test-1',finishReason:'stop',
        message:{role:'assistant',content:'你好'}};}};
    const value=await callback(flash);
    return {value,identity:flash.identity,executionDevice:device,timing:{},resourcesReleased:true};
  }};
  return createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},qwenSession,
    communityCpuTrialForDevelopment:true,...options});
}
const request={modelId:'qwen3.5-9b-heretic',mode:'chat',requestId:'device-status-123',message:'你好',history:[],images:[]};
const qwen=assistant=>assistant.status().localModels.find(item=>item.id==='qwen3.5-9b-heretic');

for (const device of ['cpu','gpu']) test(`execution device is reported only after a verified ${device} session`,async()=>{
  const assistant=fixture(device);
  assert.equal(qwen(assistant).executionDevice,null);
  const result=await assistant.artAgentChat(request);
  assert.equal(result.ok,true);
  assert.equal(result.executionDevice,device);
  assert.equal(result.analysisBackend,'qwen-cpu','legacy wire identifier remains compatible');
  assert.equal(qwen(assistant).executionDevice,device);
  assert.equal(qwen(assistant).chatSession.executionDevice,device);
  await assistant.stop();
  assert.equal(qwen(assistant).modelLoaded,false);
  assert.equal(qwen(assistant).executionDevice,device,'last verified result remains distinguishable from a loaded session');
});

test('unverified sessions never invent an execution device',async()=>{
  const assistant=fixture();
  const result=await assistant.artAgentChat(request);
  assert.equal(result.ok,true);
  assert.equal(result.executionDevice,undefined);
  assert.equal(qwen(assistant).executionDevice,null);
  await assistant.stop();
});

test('enabled confirmation-based planner is not described as lacking tools',async()=>{
  const assistant=fixture('cpu',{qwenPlanEnabled:true,qwenPlanVerificationEnabled:true});
  assert.match(qwen(assistant).trial.notice,/基础操作需要确认/);
  assert.doesNotMatch(qwen(assistant).trial.notice,/不执行工具/);
  await assistant.stop();
});
