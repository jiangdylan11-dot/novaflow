import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStrataPromptAssistant} from '../../worker/src/strata-prompt-assistant.mjs';

const payload = (mode = 'chat') => ({modelId:'qwen3.5-9b-heretic',mode,
  requestId:'cpu-trial-request-123',message:'你好',history:[],images:[]});
function session(events) {
  return {async withSession(callback) {
    events.push('load');
    const flash = {identity:{id:'qwen35-heretic'},async inferConversation(request) {
      events.push({tools:request.tools});
      return {model:'qwen35-heretic',requestId:'response-1',finishReason:'stop',message:{role:'assistant',content:'你好'}};
    }};
    const value = await callback(flash,new AbortController().signal);
    events.push('unload');
    return {value,identity:flash.identity,timing:{},resourcesReleased:true};
  }};
}

test('normal compute launchers do not opt into the development CPU trial', () => {
  for (const path of ['../../worker/src/main-compute.mjs','../../worker/electron/compute-main.cjs']) {
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/communityCpuTrialForDevelopment/);
  }
});

test('development CPU trial is explicit, nonexclusive and never probes Comfy', async () => {
  const events=[]; const qwenSession=session(events);
  const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},
    comfyUrls:['http://127.0.0.1:8188'],qwenSession,communityCpuTrialForDevelopment:true,
    fetchImpl:async()=>{events.push('network');throw Error('must not probe Comfy');}});
  const qwen=assistant.status().localModels.find(item=>item.id==='qwen3.5-9b-heretic');
  assert.equal(qwen.enabled,true); assert.deepEqual({...qwen.trial,notice:undefined},
    {backend:'cpu',exclusive:false,chat:true,images:true,tools:false,audio:false,video:false,notice:undefined});
  assert.match(qwen.trial.notice,/不独占/);
  const response=await assistant.artAgentChat(payload());
  assert.equal(response.ok,true); assert.equal(response.data.reply,'你好');
  assert.ok(events.some(event=>event && typeof event==='object' && event.tools===undefined));
  assert.ok(!events.includes('network'));
  await assistant.stop();
});

test('pooled CPU trial permits only its own task and rejects other or unverified work', async () => {
  for (const currentTaskId of ['task-1','different-task',undefined]) {
    const events=[];const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId})},
      comfyUrls:['http://127.0.0.1:8188'],qwenSession:session(events),communityCpuTrialForDevelopment:true,
      fetchImpl:async()=>{events.push('network');throw Error('must not probe Comfy');}});
    const response=await assistant.runForTask('task-1','artAgentChat',payload());
    assert.equal(response.ok,currentTaskId==='task-1');
    if(currentTaskId!=='task-1') assert.equal(response.errorCode,'community-runtime-ownership-unconfirmed');
    assert.ok(!events.includes('network'));
    await assistant.stop();
  }
});

test('development opt-in never permits planners or unverified media', async () => {
  const events=[];const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},
    qwenSession:session(events),communityCpuTrialForDevelopment:true});
  for(const request of [payload('foart'),payload('drawing'),payload('media'),payload('creation'),
    {...payload(),uploads:[{kind:'video'}]}]) {
    const response=await assistant.artAgentChat(request);
    assert.equal(response.errorCode,'community-trial-capability-unavailable');
  }
  assert.deepEqual(events,[]);
});

test('an unexpected community chat tool call is rejected without execution', async () => {
  const events=[];
  const qwenSession={async withSession(callback) {
    events.push('load');
    try {
      return await callback({identity:{id:'qwen35-heretic'},async inferConversation() {
        return {model:'qwen35-heretic',requestId:'response-1',finishReason:'tool_calls',
          message:{role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'generate_art_image',arguments:'{}'}}]}};
      }},new AbortController().signal);
    } finally {events.push('unload');}
  }};
  const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:'task-1'})},
    qwenSession,communityCpuTrialForDevelopment:true,fetchImpl:async()=>{events.push('network');throw Error('unexpected');}});
  const response=await assistant.runForTask('task-1','artAgentChat',payload());
  assert.equal(response.ok,false);assert.equal(response.errorCode,'flash-agent-tool-not-allowed');
  assert.deepEqual(events,['load','unload']);
});
