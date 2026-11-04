import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

const src=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const begin=src.indexOf('  async function verifyQwenPlanResponse(');
const end=src.indexOf("  if (CONFIG.localAssistant)",begin);
assert.ok(begin>0&&end>begin,'verification function is present');
const taskId='11111111-1111-4111-8111-111111111111',nodeId='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333',digest='a'.repeat(64);
function fixture(){
  let alive=true,node={id:nodeId};
  const result={},bindings=new WeakMap();
  const task={id:taskId,model_id:'qwen3.5-9b-heretic-foart-plan-v1',status:'completed',result_expired:false,
    assigned_worker_id:nodeId,attempt_count:1,parameters:{assistant_tool_scope:'qwen-foart-plan-v1',request_id:requestId,request_sha256:digest,request_bytes:80},
    output_manifest:{files:[{name:'qwen-foart-plan-result-1.json',kind:'json',bytes:64}]}};
  const binding={taskId,nodeId,attempt:1,requestId,requestSha256:digest,requestBytes:80,resultBytes:64,session:()=>alive,check:()=>{if(!alive)throw Error('cancelled');}};
  bindings.set(result,binding);
  const ctx={qwenPlanBindings:bindings,computeNode:node,QWEN_PLAN_SCOPE:'qwen-foart-plan-v1',
    control:async()=>({task}),encodeURIComponent};
  createContext(ctx);runInContext(src.slice(begin,end)+'\nglobalThis.run=verifyQwenPlanResponse;',ctx);
  return {result,task,ctx,run:()=>ctx.run(result),stop:()=>{alive=false;},switchNode:()=>{ctx.computeNode={id:'other'};}};
}
test('accepts only a bound result for the same completed task, node, attempt and request',async()=>{
  const f=fixture();assert.equal(await f.run(),true);assert.equal(await f.ctx.run({}),false);
  for(const mutate of [t=>t.id='other',t=>t.status='cancelled',t=>t.result_expired=true,t=>t.assigned_worker_id='other',
    t=>t.attempt_count=2,t=>t.model_id='other',t=>t.parameters.request_id='other',t=>t.parameters.request_sha256='b'.repeat(64),
    t=>t.parameters.assistant_tool_scope='other',t=>t.parameters.request_bytes=81,t=>t.output_manifest.files[0].name='result.json',
    t=>t.output_manifest.files[0].name='qwen-foart-plan-result-2.json',t=>t.output_manifest.files[0].bytes=63,
    t=>t.output_manifest.files=[],t=>t.output_manifest.files.push({name:'qwen-foart-plan-result-1.json',kind:'json',bytes:64})]){
    const x=fixture();mutate(x.task);assert.equal(await x.run(),false);
  }
});
test('cancellation, node switch or session revocation while waiting reject the result',async()=>{
  let f=fixture();f.stop();assert.equal(await f.run(),false);
  f=fixture();f.switchNode();assert.equal(await f.run(),false);
  f=fixture();let resolve;f.ctx.control=()=>new Promise(r=>{resolve=r;});const pending=f.run();
  await Promise.resolve();f.stop();resolve({task:f.task});assert.equal(await pending,false);
});
test('plan capability is unavailable unless both server signals and a selected node are present',async()=>{
  const start=src.indexOf('  async function pooledPromptStatus('),stop=src.indexOf('  async function waitForTaskEnd(',start);
  assert.ok(start>0&&stop>start);
  for(const [node,features,want] of [[null,{qwen35FoartPlan:true,qwen35FoartPlanOwnerBound:true},false],
    [{id:nodeId},{qwen35FoartPlan:true},false],[{id:nodeId},{qwen35FoartPlan:false,qwen35FoartPlanOwnerBound:true},false],
    [{id:nodeId},{qwen35FoartPlan:true,qwen35FoartPlanOwnerBound:true},true]]){
    const ctx={computeNode:node,pooledPromptRequests:new Map(),tasks:new Map(),control:async()=>({taskTypes:[],features}),String,Date};
    createContext(ctx);runInContext(src.slice(start,stop)+'\nglobalThis.run=pooledPromptStatus;',ctx);
    assert.equal((await ctx.run()).result.features.qwen35FoartPlan,want);
  }
});
test('ordinary scoped plan obtains a fresh attempt-bound grant and refuses wrong node or reserved IDs',async()=>{
  const start=src.indexOf('  async function grantFor('),stop=src.indexOf('  // --------------------------------------------------- ComfyUI shape mapping',start);
  assert.ok(start>0&&stop>start);
  const calls=[],task={id:taskId,assigned_worker_id:nodeId,attempt_count:2};
  const options={qwenPlan:true,expectedNodeId:nodeId,assertCurrent(){},signal:new AbortController().signal};
  const ctx={NODE_ID:/^[0-9a-f-]{36}$/i,QWEN_ROTATION_CANDIDATE_ID:/^fa047a0a-/i,taskMode:()=> 'shared',
    AbortSignal,Date,Number,String,Error,encodeURIComponent,CONFIG:{controlUrl:'http://127.0.0.1:4890'},
    candidateSecureBase:x=>x,checkCandidateTransport:o=>o.assertCurrent(),authHeaders:()=>({'content-type':'application/json'}),
    fetch:async(url,request)=>{calls.push({url,body:JSON.parse(request.body),request});return {ok:true,json:async()=>({ok:true,grant:{token:'nfg_fixture',taskId,workerId:nodeId,op:'upload',endpoint:'http://127.0.0.1:3210',expiresAt:new Date(Date.now()+10000).toISOString()}})};},
    grants:new Map(),control:async()=>{throw Error('unscoped fallback forbidden');}};
  createContext(ctx);runInContext(src.slice(start,stop)+'\nglobalThis.run=grantFor;',ctx);
  const result=await ctx.run(task,'upload',options);assert.equal(result.workerId,nodeId);assert.deepEqual(calls[0].body,{op:'upload',attempt:2});
  assert.equal(calls[0].request.redirect,'error');assert.equal(calls[0].request.credentials,'omit');
  await assert.rejects(ctx.run({...task,assigned_worker_id:'other'},'upload',options));
  await assert.rejects(ctx.run({...task,id:'fa047a0a-1111-8111-8111-111111111111'},'upload',options));
  assert.equal(calls.length,1);
});
