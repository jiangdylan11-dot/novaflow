import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunningHubServerConfig} from '../../packages/shared/src/runninghub-server-config.mjs';

test('online services load a newly saved server Key on the next request and explicit clearing overrides stale environment',async()=>{
  let row=null;
  const config=createRunningHubServerConfig({env:name=>name==='NOVAFLOW_RUNNINGHUB_API_KEY'?'old-environment-key':'',rpc:async()=>({data:row?[row]:[]})});
  assert.equal((await config.refresh()).apiKey,'old-environment-key');
  row={api_key:'new-private-server-key',llm_base_url:'https://llm.runninghub.ai/v1',llm_model:'xai/grok-4.7',revision:1};
  assert.equal((await config.refresh()).apiKey,'new-private-server-key');
  assert.equal(config.status().revision,1);assert.doesNotMatch(JSON.stringify(config.status()),/private-server-key/);
  row={...row,api_key:'',revision:2};assert.equal((await config.refresh()).configured,false);
  assert.equal(config.read().apiKey,'');
});

test('configuration read failures do not silently run with an old Key',async()=>{
  const config=createRunningHubServerConfig({env:()=>'',rpc:async()=>({error:{message:'private upstream error'}})});
  await assert.rejects(config.refresh(),/未能读取 RunningHub 配置/);
});

test('refresh binds a validated non-secret revision to the same provider snapshot',async()=>{
 let row={api_key:'private-fixture',llm_base_url:'https://llm.runninghub.ai/v1',llm_model:'xai/grok-4.7',revision:7};
 const config=createRunningHubServerConfig({env:()=>'',rpc:async()=>({data:[row]})});
 const first=await config.refresh();assert.equal(first.configRevision,'7');
 row={...row,api_key:'new-private-fixture',revision:'8'};const second=await config.refresh();
 assert.equal(second.configRevision,'8');assert.equal(first.configRevision,'7');assert.equal(first.apiKey,'private-fixture');
 row={...row,revision:null};assert.equal((await config.refresh()).configRevision,null);
 row={...row,revision:Number.MAX_SAFE_INTEGER+1};assert.equal((await config.refresh()).configRevision,null);
});
