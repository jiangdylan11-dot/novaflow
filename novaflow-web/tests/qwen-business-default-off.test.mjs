import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlashBrainSession} from '../worker/src/flash-brain-session.mjs';
import {createWorker} from '../worker/src/worker-core.mjs';
import {createStrataPromptAssistant} from '../worker/src/strata-prompt-assistant.mjs';

// Fake transport/lifecycle: never starts a server or loads a model.
function sessionFixture(model) {
 const sent=[];const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
 const lifecycle={load:async()=>({ok:true}),unload:async()=>({ok:true,released:true})};
 const fetchImpl=async(url,init)=>{
  if(url.endsWith('/v1/models'))return response({data:[{id:model}]});
  if(url.endsWith('/props'))return response({});
  if(url.endsWith('/v1/chat/completions')){sent.push(JSON.parse(init.body));return response({id:'mock',model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'ok'}}]});}
  throw Error('unexpected mock call');
 };
 return {sent,session:createFlashBrainSession({expectedModel:{ids:[model]},fetchImpl,lifecycle})};
}
const messages=[{role:'system',content:'system'},{role:'user',content:'synthetic'}];
test('Next keeps configured sampling even if caller supplies overrides',async()=>{
 const f=sessionFixture('swift-fixture');
 await f.session.withSession(s=>s.inferConversation({messages,stage:'qwen-python-business',topP:.12,seed:7}));
 assert.equal(f.sent[0].top_p,.95);assert.equal(f.sent[0].seed,957282577);
});
test('Qwen chat retains old sampling; explicitly scoped business bridge forwards its validated values',async()=>{
 const f=sessionFixture('qwen35-heretic');
 await f.session.withSession(async s=>{
  await s.inferConversation({messages,topP:.12,seed:7});
  await s.inferConversation({messages,stage:'qwen-python-business',topP:.12,seed:7});
 });
 assert.equal(f.sent[0].top_p,.95);assert.equal(f.sent[0].seed,957282577);
 assert.equal(f.sent[1].top_p,.12);assert.equal(f.sent[1].seed,7);
});
test('default-off model report has no business model; explicit opt-in reports missing until verified',async()=>{
 let optIn=false,ready=false;
 const worker=createWorker({controlUrl:'http://127.0.0.1:9',dataDir:'.',workflowDir:'.',configPath:'fixture',logger:()=>{},
 promptAssistant:{status:()=>({enabled:true,...(optIn?{qwenBusinessBridgeEnabled:true}:{}),localModels:[{id:'qwen3.5-9b-heretic',enabled:true,configured:true,identityVerified:true,trial:{backend:'cpu',chat:true,images:true,tools:false,...(ready?{business:true}:{})}}]})}});
 let rows=await worker.reportModels();assert.equal(rows.find(r=>r.model_id==='qwen3.5-9b-heretic-business-v1'),undefined);
 optIn=true;rows=await worker.reportModels();assert.equal(rows.find(r=>r.model_id==='qwen3.5-9b-heretic-business-v1').status,'missing');
 ready=true;rows=await worker.reportModels();assert.equal(rows.find(r=>r.model_id==='qwen3.5-9b-heretic-business-v1').status,'ready');
});
test('assistant status exposes business opt-in only if explicitly enabled',async()=>{
 const build=qwenBusinessBridge=>createStrataPromptAssistant({config:{},gemmaConfig:{},qwenConfig:{},qwenBusinessBridge,sessionFactory:()=>({})});
 const off=build(false),on=build(true);
 try {assert.equal(off.status().qwenBusinessBridgeEnabled,undefined);assert.equal(on.status().qwenBusinessBridgeEnabled,true);}
 finally {await off.stop();await on.stop();}
});
