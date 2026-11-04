import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

function setup(saved) {
  const values=new Map();if(saved)values.set('novaflow.xiaotao-art.chat.v1',JSON.stringify(saved));
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const sandbox={console,AbortController,setTimeout,clearTimeout,localStorage:storage};sandbox.window=sandbox;
  runInContext(readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8'),createContext(sandbox));
  const calls={requests:0,status:0};
  const bridge={clearPrepared(){},async captureChat(){return {artContext:{surface:'other'},images:[]}}};
  const api=()=>({promptAssistantGetStatus:async()=>{calls.status++;return {ok:true,result:{features:{qwen35CpuTrial:true}}}},artAgentChat:async()=>{calls.requests++;return {ok:true,data:{reply:'ok',history:[]}}}});
  return {storage,calls,create:()=>sandbox.NovaFlowXiaotaoArtAgent.createController({bridge,storage,api})};
}

test('fresh installation starts at the only local model without selecting a paid route',()=>{
  const e=setup(),c=e.create();assert.equal(c.state.modelId,'qwen3.5-9b-heretic');assert.equal(c.state.provider,'local');
  assert.equal(c.modelAvailable('next'),false);assert.equal(c.setModel('next'),false);assert.equal(e.calls.requests,0);
});

test('saved Next conversation is readable, cannot submit or clear, and survives choosing a new model and restart',async()=>{
  const old={provider:'local',modelId:'next',modelSessions:{next:{messages:[{role:'user',content:'原本的本地对话'}],history:[{role:'user',content:'旧历史'}],conversationId:'old'}}};
  const e=setup(old),c=e.create();assert.equal(c.state.modelId,'next');assert.equal(c.state.messages[0].content,'原本的本地对话');
  assert.match(c.state.status,/已移除.*仅供查看/);await c.calibrateLocalStatus();assert.equal(e.calls.status,0);
  assert.equal(await c.send('继续旧对话'),false);assert.equal(await c.send('新对话'),false);assert.equal(c.reset(),false);assert.equal(await c.stageUploads([]),false);assert.equal(await c.apply(),false);assert.equal(await c.confirmSampling('current'),false);assert.equal(e.calls.requests,0);
  assert.equal(c.setModel('qwen3.5-9b-heretic'),true);assert.equal(c.state.provider,'local');assert.equal(c.state.messages.length,0);
  assert.equal(c.viewLegacyArchive('retired-local').messages[0].content,'原本的本地对话');assert.equal(c.restoreLegacyArchive('retired-local'),false);
  const restarted=e.create();assert.equal(restarted.state.modelId,'qwen3.5-9b-heretic');assert.equal(restarted.viewLegacyArchive('retired-local').history[0].content,'旧历史');assert.equal(e.calls.requests,0);
});

test('older local-only stored conversations without a model ID stay in a retired read-only view',async()=>{
  const e=setup({provider:'local',messages:[{role:'user',content:'旧版历史'}],history:[{role:'user',content:'旧版历史'}]});const c=e.create();
  assert.equal(c.state.modelId,'next');assert.equal(c.state.messages[0].content,'旧版历史');assert.equal(await c.send('不要发送'),false);assert.equal(e.calls.requests,0);
  assert.equal(c.setModel('qwen3.5-9b-heretic'),true);assert.equal(c.viewLegacyArchive('retired-local').messages[0].content,'旧版历史');
});

test('generic old local archive remains read-only and is not silently moved to a paid model',async()=>{
  const e=setup({provider:'local',modelId:'next',sessions:{local:{messages:[{role:'user',content:'旧本地项目'}],history:[{role:'user',content:'旧本地项目'}]}}});
  const c=e.create();assert.equal(c.viewLegacyArchive('local').messages[0].content,'旧本地项目');
  assert.equal(c.restoreLegacyArchive('local'),false);assert.equal(c.setModel('qwen3.5-9b-heretic'),true);
  assert.equal(c.restoreLegacyArchive('local'),false);assert.equal(c.state.messages.length,0);assert.equal(c.state.provider,'local');assert.equal(e.calls.requests,0);
});

test('partially migrated stores retain selected old local messages when modelSessions lacks them',()=>{
  const e=setup({provider:'local',modelId:'next',modelSessions:{},sessions:{local:{messages:[{role:'user',content:'未迁移记录'}],history:[{role:'user',content:'未迁移记录'}]}}});
  const c=e.create();assert.equal(c.state.modelId,'next');assert.equal(c.state.messages[0].content,'未迁移记录');
  assert.equal(c.setModel('qwen3.5-9b-heretic'),true);assert.equal(c.viewLegacyArchive('retired-local').messages[0].content,'未迁移记录');assert.equal(e.calls.requests,0);
});

test('retired GLM remains read-only and preserves its billing notice across explicit selection and restart',async()=>{
  const id='glm/glm-5.3-flash';
  const e=setup({provider:'api',modelId:id,modelSessions:{[id]:{messages:[{role:'user',content:'GLM 原对话'}],history:[{role:'assistant',content:'GLM 旧历史'}]}},billingNotices:[{id:'bill1',modelId:id,unknown:false,confirmed:3}]});
  const c=e.create();assert.equal(c.state.modelId,id);assert.equal(c.state.messages[0].content,'GLM 原对话');assert.match(c.state.status,/已移除.*仅供查看/);
  assert.equal(c.modelAvailable(id),false);assert.equal(await c.send('不要发'),false);assert.equal(c.reset(),false);assert.equal(await c.stageUploads([]),false);assert.equal(c.state.billingNotices[0].confirmed,3);assert.equal(e.calls.requests,0);
  assert.equal(c.setModel('qwen3.5-9b-heretic'),true);assert.equal(c.state.provider,'local');assert.equal(c.viewLegacyArchive('retired-glm').messages[0].content,'GLM 原对话');assert.equal(c.restoreLegacyArchive('retired-glm'),false);assert.equal(c.setModel(id),false);
  const restarted=e.create();assert.equal(restarted.state.modelId,'qwen3.5-9b-heretic');assert.equal(restarted.viewLegacyArchive('retired-glm').history[0].content,'GLM 旧历史');assert.equal(restarted.state.billingNotices[0].confirmed,3);assert.equal(e.calls.requests,0);
});
test('older and partially migrated GLM provider sessions remain readable and cannot be restored into another model',()=>{
  for(const modelSessions of [undefined,{}]){
    const e=setup({provider:'api',modelId:'glm/glm-5.3-flash',...(modelSessions?{modelSessions}:{}),sessions:{api:{messages:[{role:'user',content:'旧 GLM'}],history:[{role:'user',content:'旧 GLM'}]}}});
    const c=e.create();assert.equal(c.state.messages[0].content,'旧 GLM');assert.equal(c.setModel('qwen3.5-9b-heretic'),true);assert.equal(c.viewLegacyArchive('retired-glm').messages[0].content,'旧 GLM');assert.equal(c.restoreLegacyArchive('retired-glm'),false);
    if(c.viewLegacyArchive('api'))assert.equal(c.restoreLegacyArchive('api'),false);
    const restarted=e.create();if(restarted.viewLegacyArchive('api'))assert.equal(restarted.restoreLegacyArchive('api'),false);
  }
});
