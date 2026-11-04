import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createPromptAssistant,qwenBusinessPythonEnvironment} from '../worker/src/prompt-assistant.mjs';

test('Qwen whitelist keeps platform/GPU settings but strips arbitrary credentials and interpreter injection',()=>{
 const source={Path:'fixture-path',SystemRoot:'fixture-root',TEMP:'fixture-temp',CUDA_VISIBLE_DEVICES:'0',RUNNINGHUB_API_KEY:'fixture',AWS_SECRET_ACCESS_KEY:'fixture',PYTHONPATH:'fixture',CUSTOM_TOKEN:'fixture'};
 const result=qwenBusinessPythonEnvironment(source,{PATH:'fixture-override',CUDA_VISIBLE_DEVICES:'5',OPENAI_API_KEY:'fixture'});
 assert.equal(result.PATH,'fixture-override');assert.equal(result.SYSTEMROOT,'fixture-root');assert.equal(result.TEMP,'fixture-temp');assert.equal(result.CUDA_VISIBLE_DEVICES,'5');
 for(const key of ['RUNNINGHUB_API_KEY','AWS_SECRET_ACCESS_KEY','PYTHONPATH','CUSTOM_TOKEN','OPENAI_API_KEY'])assert.equal(Object.hasOwn(result,key),false);
});

test('real isolated fixture child receives only allowed environment under the Qwen session',async()=>{
 const serviceScript=fileURLToPath(new URL('./qwen-env-fixture.py',import.meta.url));
 const flash={identity:{id:'qwen35-heretic',path:serviceScript},infer:async()=>({text:'unused'})};
 const qwenSession={withSession:async fn=>({value:await fn(flash),identity:flash.identity,timing:{callbackMs:2}})};
 const assistant=createPromptAssistant({worker:{getState:()=>({currentTaskId:null})},pythonPath:'python',serviceScript,
  runtimeJsonPath:fileURLToPath(new URL('./not-a-runtime.json',import.meta.url)),qwenSession,communityCpuTrialForDevelopment:true,
  qwenBusinessBridge:true,qwenBusinessReady:()=>true,env:{RUNNINGHUB_API_KEY:'fixture',FOART_FAKE_SECRET:'fixture',PYTHONPATH:'fixture',CUSTOM_TOKEN:'fixture',CUDA_VISIBLE_DEVICES:'5'}});
 try {
  const result=await assistant.describeArtStyle({requestId:'fixture-env-1',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'});
  assert.equal(result.ok,true);assert.equal(result.style,'fixture-pass');assert.equal(result.resourcesReleased,true);
 } finally {await assistant.stop();}
});
