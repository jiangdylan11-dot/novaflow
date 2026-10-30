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
