import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
const src=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const begin=src.indexOf('  async function pooledPromptAssistant('),end=src.indexOf('  async function cancelQwenRotationTask(',begin);
assert.ok(begin>0&&end>begin);
const taskId='11111111-1111-4111-8111-111111111111',nodeId='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333',digest='a'.repeat(64);
function fixture(mutate=()=>{}){
  const file='qwen-foart-plan-result-1.json',calls=[];
  const finished={id:taskId,status:'completed',assigned_worker_id:nodeId,attempt_count:1,result_expired:false,output_manifest:{files:[{name:file,kind:'json',bytes:200}]}};
  mutate(finished);
  const reply={ok:true,data:{mode:'foart'},planBinding:{taskId,workerId:nodeId,attempt:1,requestId,requestSha256:digest}};
  const ctx={
    taskMode:()=> 'shared',candidateSecureBase:x=>x,CONFIG:{controlUrl:'http://127.0.0.1:4890'},computeNode:{id:nodeId},computeNodeEpoch:0,
    captureFoartSessionGuard:()=>()=>true,pooledPromptRequests:new Map(),pooledConversationNodes:new Map(),tasks:new Map(),taskModes:new Map(),qwenPlanBindings:new WeakMap(),
    QWEN_ROTATION_REQUEST_ID:/^[0-9a-f-]{36}$/i,QWEN_ROTATION_CANDIDATE_ID:/^fa047a0a-/i,NODE_ID:/^[0-9a-f-]{36}$/i,
    QWEN_PLAN_SCOPE:'qwen-foart-plan-v1',QWEN_PLAN_REQUEST_FILE:'qwen-foart-plan-request.json',PROMPT_ASSISTANT_TIMEOUT_MS:300000,
    AbortController,AbortSignal,TextEncoder,TextDecoder,Date,Number,Object,Array,JSON,String,Error,encodeURIComponent,
    qwenCandidatePayloadDigest:async()=>digest,verifyQwenPlanResponse:async()=>true,
    api:async(base,method,path)=>{calls.push({base,method,path});if(path.startsWith('/api/web/capabilities'))return {features:{qwen35FoartPlan:true,qwen35FoartPlanOwnerBound:true},taskTypes:[]};throw Error('unexpected api '+path);},
    control:async(method,path,body)=>{calls.push({method,path,body});if(path.startsWith('/api/web/capabilities'))return {features:{qwen35FoartPlan:true,qwen35FoartPlanOwnerBound:true},taskTypes:[]};
      if(method==='POST'&&path==='/api/web/tasks')return {ok:true,task:{id:taskId,status:'queued',assigned_worker_id:null,attempt_count:0}};
      throw Error('unexpected control '+method+' '+path);},
    putTaskInput:async(id,name,_bytes,_wait,options)=>{calls.push({upload:id,name,options});return {id,assigned_worker_id:nodeId,attempt_count:1};},
    waitForTaskEnd:async()=>finished,
    fetchTaskOutput:async(task,name,options)=>{calls.push({download:task.id,name,options});return new TextEncoder().encode(JSON.stringify(reply));},
  };
  createContext(ctx);runInContext(src.slice(begin,end)+'\nglobalThis.run=pooledPromptAssistant;',ctx);
  const payload={requestId,provider:'local',modelId:'qwen3.5-9b-heretic',mode:'foart',foartAnimationStage:'rotation_candidate',images:[],message:'fixture'};
  return {ctx,calls,run:()=>ctx.run('art-agent-chat',payload,{qwenPlan:true,isCurrent:()=>true})};
}
test('ordinary 9B plan uses scoped task and attempt-named result',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.ok,true);
  assert.equal(f.calls.find(x=>x.path?.startsWith('/api/web/capabilities'))?.path,'/api/web/capabilities?worker='+nodeId);
  const create=f.calls.find(x=>x.path==='/api/web/tasks');assert.equal(create.body.parameters.assistant_tool_scope,'qwen-foart-plan-v1');
  assert.equal(create.body.target_worker_id,nodeId);assert.equal(create.body.references[0].name,'qwen-foart-plan-request.json');
  assert.equal(f.calls.find(x=>x.upload)?.options?.qwenPlan,true);assert.equal(f.calls.find(x=>x.download)?.name,'qwen-foart-plan-result-1.json');
});
test('switching selected node while capability query is pending does not create a task',async()=>{
  const f=fixture();f.ctx.api=async(_base,_method,path)=>{assert.equal(path,'/api/web/capabilities?worker='+nodeId);f.ctx.computeNode={id:'other'};return {features:{qwen35FoartPlan:true,qwen35FoartPlanOwnerBound:true},taskTypes:[]};};
  await assert.rejects(f.run(),/算力节点已切换/);assert.equal(f.calls.some(x=>x.path==='/api/web/tasks'&&x.method==='POST'),false);
});
test('missing, duplicate or old-attempt output is rejected before any download grant',async()=>{
  for(const mutate of [t=>{t.output_manifest.files=[];},t=>{t.output_manifest.files.push({...t.output_manifest.files[0]});},
    t=>{t.output_manifest.files[0].name='qwen-foart-plan-result-2.json';},t=>{t.output_manifest.files[0].name='result.json';},
    t=>{t.output_manifest.files[0].bytes=0;},t=>{t.attempt_count=2;}]){
    const f=fixture(mutate);await assert.rejects(f.run(),/动画规划结果所属节点、尝试或文件已变化/);
    assert.equal(f.calls.some(x=>x.upload),true);assert.equal(f.calls.some(x=>x.download),false);
  }
});
