import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStrataPromptAssistant} from '../../worker/src/strata-prompt-assistant.mjs';

const payload=(model,mode='chat')=>({modelId:model,requestId:'owner-test-123',mode,message:'hello',history:[]});
const stubSession=events=>({withSession:async callback=>{
  events.push('model-load');
  const value=await callback({identity:{id:'next'},inferConversation:async()=>({model:'next',requestId:'reply',finishReason:'stop',message:{role:'assistant',content:'ok'}})});
  events.push('model-unload');return {value,identity:{id:'next'},timing:{},resourcesReleased:true};
}});

test('production assistant wiring never enables the injected isolation fixture',()=>{
  const source=readFileSync(new URL('../../worker/src/prompt-assistant.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/isolatedCommunityRuntimeForTest/);
});

test('community models never probe or release a configured external Comfy runtime',async()=>{
  for(const modelId of ['gemma-4-12b-it','qwen3.5-9b-heretic']) {
    const events=[],session=stubSession(events),assistant=createStrataPromptAssistant({
      worker:{getState:()=>({currentTaskId:null})},comfyUrls:['http://127.0.0.1:8188'],isolatedCommunityRuntimeForTest:true,
      gemmaSession:session,qwenSession:session,fetchImpl:async url=>{events.push(String(url));throw Error('unexpected network request');}
    });
    for(const mode of ['chat','foart']) {
      const result=await assistant.artAgentChat(payload(modelId,mode));
      assert.equal(result.ok,false);assert.equal(result.errorCode,'community-runtime-ownership-unconfirmed');
      assert.match(result.error,/未释放其他模型/);
    }
    const taskResult=await assistant.runForTask('task-1','artAgentChat',payload(modelId));
    assert.equal(taskResult.errorCode,'community-runtime-ownership-unconfirmed');
    assert.deepEqual(events,[]);
  }
});

test('production defaults deny both community models even when the worker reports idle',async()=>{
  for(const modelId of ['gemma-4-12b-it','qwen3.5-9b-heretic']) {
    for(const worker of [undefined,{getState:()=>({currentTaskId:null})}]) {
      const events=[],session=stubSession(events),assistant=createStrataPromptAssistant({worker,comfyUrls:[],gemmaSession:session,qwenSession:session});
      for(const invoke of [()=>assistant.artAgentChat(payload(modelId)),()=>assistant.runForTask('task-1','artAgentChat',payload(modelId))]) {
        assert.equal((await invoke()).errorCode,'community-runtime-ownership-unconfirmed');
      }
      assert.deepEqual(events,[]);
    }
  }
});

test('status distinguishes configured files from permitted community execution',()=>{
  const session=stubSession([]),assistant=createStrataPromptAssistant({
    worker:{getState:()=>({currentTaskId:null})},comfyUrls:[],gemmaSession:session,qwenSession:session
  });
  const community=assistant.status().localModels.filter(item=>item.id!=='next');
  assert.equal(community.length,2);
  for(const item of community) {
    assert.equal(item.configured,true);assert.equal(item.enabled,false);
    assert.equal(item.errorCode,'community-runtime-ownership-unconfirmed');assert.match(item.error,/未释放其他模型/);
    assert.doesNotMatch(JSON.stringify(item),/path|secret|token|apiKey/i);
  }
  const unconfigured=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},comfyUrls:[]}).status().localModels.find(item=>item.id==='gemma-4-12b-it');
  assert.equal(unconfigured.configured,false);assert.equal(unconfigured.enabled,false);assert.equal(unconfigured.errorCode,'local-model-unavailable');
});

test('isolated tests reject active, missing, invalid or unknown worker state on both paths',async()=>{
  const states=[()=>({currentTaskId:'other-task'}),()=>({currentTaskId:'task-1'}),()=>null,()=>({}),()=>({currentTaskId:undefined}),
    ()=>({currentTaskId:false}),()=>({currentTaskId:0}),()=>[],()=>{throw Error('unknown state');}];
  for(const modelId of ['gemma-4-12b-it','qwen3.5-9b-heretic']) {
    for(const getState of states) {
      const events=[],session=stubSession(events),assistant=createStrataPromptAssistant({worker:{getState},comfyUrls:[],gemmaSession:session,qwenSession:session,isolatedCommunityRuntimeForTest:true});
      for(const invoke of [()=>assistant.artAgentChat(payload(modelId)),()=>assistant.runForTask('task-1','artAgentChat',payload(modelId))]) {
        assert.equal((await invoke()).errorCode,'community-runtime-ownership-unconfirmed');
      }
      assert.deepEqual(events,[]);
    }
  }
});

test('explicit isolated tests accept only a known idle worker or no worker',async()=>{
  for(const modelId of ['gemma-4-12b-it','qwen3.5-9b-heretic']) {
    for(const worker of [undefined,{getState:()=>({currentTaskId:null})},{getState:()=>({currentTaskId:''})}]) {
      const events=[],session=stubSession(events),assistant=createStrataPromptAssistant({worker,comfyUrls:[],gemmaSession:session,qwenSession:session,isolatedCommunityRuntimeForTest:true});
      assert.equal((await assistant.artAgentChat(payload(modelId))).ok,true);
      await assistant.stop();assert.ok(events.includes('model-load'));
    }
  }
});

test('community model rechecks worker state before opening its session',async()=>{
  const events=[];let checks=0;
  const worker={getState:()=>({currentTaskId:++checks===1?null:'new-task'})};
  const assistant=createStrataPromptAssistant({worker,comfyUrls:[],gemmaSession:stubSession(events),isolatedCommunityRuntimeForTest:true});
  const result=await assistant.artAgentChat(payload('gemma-4-12b-it'));
  assert.equal(result.ok,false);assert.equal(result.errorCode,'community-runtime-ownership-unconfirmed');
  assert.ok(checks>=2);assert.deepEqual(events,[]);
});

test('retired Next is rejected before model loading or runtime release',async()=>{
  const events=[],fetchImpl=async url=>{
    events.push(String(url));
    return {ok:true,status:200,json:async()=>({queue_running:[],queue_pending:[]})};
  };
  const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:''})},comfyUrls:['http://127.0.0.1:8188'],
    config:{expectedModel:{ids:['next']}},lifecycle:{load:async()=>{},unload:async()=>({released:true})},
    sessionFactory:()=>stubSession(events),fetchImpl});
  const result=await assistant.artAgentChat(payload('next'));
  assert.equal(result.ok,false);
  assert.equal(result.errorCode,'local-model-retired');
  assert.deepEqual(events,[]);
  await assistant.stop();
});
