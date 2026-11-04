import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createWorker} from '../worker/src/worker-core.mjs';
import {candidateTaskDirectory} from '../worker/src/gateway/candidate-task-path.mjs';
import {PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE as scope,PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY as capability} from '../packages/shared/src/protocol.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick=()=>new Promise(r=>setImmediate(r));
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
const policy={enabled:true,owner_enabled:true,sharing_enabled:false,sharing_scope:'pool',allowed_user_ids:[]};
const candidateId='fa047a0a-1111-8111-8111-111111111111';
const oldId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function fixture({candidateEnabled=true,verifyEnabled=true,completion='ok',phaseAllowed=true,delayedModel=false,enforceStartHash=false,assistantFlag=true,modelState='ready'}={}){
 const dir=await mkdtemp(join(tmpdir(),'foart-candidate-worker-')),previousFetch=globalThis.fetch;
 const calls=[],modelCalls=[],modelStarted=deferred(),modelFinish=deferred();let candidateTask=null,normalTask=null,normalHandler=null,candidateHandler=null,worker;
 const request={requestId:'synthetic_request_01',provider:'local',modelId:'qwen3.5-9b-heretic',mode:'foart',foartAnimationStage:'rotation_candidate',message:'synthetic',history:[],images:[]};
 const requestBytes=Buffer.from(JSON.stringify(request)),sha=createHash('sha256').update(requestBytes).digest('hex');
 const assistant={status:()=>({qwenRotationCandidateEnabled:assistantFlag,localModels:[{id:'qwen3.5-9b-heretic',configured:true,enabled:modelState!=='disabled',identityVerified:modelState!=='stale',trial:{backend:'cpu',chat:true,images:true,tools:false}}]}),async runForTask(id,method,request,ctx){
  modelCalls.push({id,method,request});modelStarted.resolve();
  if(method==='qwenRotationCandidate'){
   assert.equal(ctx.rotationActor.taskId,id);assert.equal(ctx.rotationActor.workerId,worker.identity.workerId);assert.equal(ctx.rotationActor.scope,scope);
   if(await ctx.rotationPhaseVerifier(ctx.rotationActor,'before')!==true)return {ok:false};
   if(delayedModel)await modelFinish.promise;
   if(ctx.isCancelled())return {ok:false};
   if(await ctx.rotationPhaseVerifier(ctx.rotationActor,'after')!==true)return {ok:false};
   return {ok:true,data:{rotationCandidateStatus:'candidate',rotationCandidate:{animation:'walk',boneName:'cape',frame:24,rotation:12}}};
  }
  return {ok:true,data:{reply:'old normal task'}};
 }};
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input)),body=init.body?JSON.parse(init.body):{};
  if(url.port==='19081'){
   if(url.pathname==='/system_stats')return response({system:{comfyui_version:'test'}});
   if(url.pathname==='/queue')return response({queue_running:[],queue_pending:[]});return response({});
  }
  if(url.port!=='19082')throw Error('unexpected test URL '+url.origin);
  calls.push({path:url.pathname,body});
  if(url.pathname==='/api/worker/register')return response({workerToken:'fixture',grantKey:'fixture',policy,worker:{}});
  if(url.pathname==='/api/worker/heartbeat')return response({policy,worker:{}});
  if(url.pathname==='/api/worker/claim'){
   if(normalHandler)return normalHandler();const task=normalTask;normalTask=null;return response({task});
  }
  if(url.pathname==='/api/worker/qwen-rotation/claim'){if(candidateHandler)return candidateHandler();const task=candidateTask;candidateTask=null;return response({task});}
  if(url.pathname.endsWith('/qwen-rotation-phase'))return response({authorized:phaseAllowed==='before-only' ? body.op!=='complete' : phaseAllowed,taskId:candidateId,workerId:worker.identity.workerId,attempt:1,op:body.op});
  if(url.pathname.endsWith('/qwen-rotation-start')){if(enforceStartHash && body.sha256!==sha)return new Response('{}',{status:409});return response({ok:true,taskId:candidateId,workerId:worker.identity.workerId,attempt:1,action:'start'});}
  if(url.pathname.endsWith('/qwen-rotation-complete')){
   if(completion==='unknown')throw Error('simulated lost response');
   if(completion==='aborted'||completion==='timeout-error')throw new DOMException('simulated interrupted request',completion==='aborted'?'AbortError':'TimeoutError');
   if(completion==='denied')return new Response(JSON.stringify({error:'denied'}),{status:403,headers:{'content-type':'application/json'}});
   if(completion==='timeout-408'||completion==='conflict-409'||completion==='server-503')return new Response('{}',{status:completion==='timeout-408'?408:completion==='conflict-409'?409:503});
   if(completion==='malformed')return response({ok:false});
   return response({ok:true,taskId:candidateId,workerId:worker.identity.workerId,attempt:1,action:'complete'});
  }
  return response({ok:true});
 };
 worker=createWorker({controlUrl:'http://127.0.0.1:19082',comfyImageUrl:'http://127.0.0.1:19081',
  dataDir:dir,configPath:join(dir,'identity.json'),workflowDir:dir,rendererDir:dir,gatewayPort:0,gatewayHost:'127.0.0.1',
  publicEndpoint:'http://127.0.0.1:19083',tunnel:false,registrationProfile:'compute-only',localTasks:null,
  pollIntervalMs:3600000,heartbeatIntervalMs:3600000,qwenRotationCandidateEnabled:candidateEnabled,qwenRotationVerificationEnabled:verifyEnabled,
  promptAssistant:()=>assistant,logger:()=>{}});
 await worker.startSharing();worker.setComputeReady(true);
 async function prepareCandidate({bytes=requestBytes.length}={}){
  const input=candidateTaskDirectory(dir,candidateId,'input');await mkdir(input,{recursive:true});await writeFile(join(input,'request.json'),requestBytes);
  candidateTask={id:candidateId,task_type:'prompt_assistant',model_id:capability,attempt_count:1,
   parameters:{action:'art-agent-chat',model_id:capability,assistant_tool_scope:scope,foartAnimationStage:'rotation_candidate'},references:[{name:'request.json',bytes}]};
  return candidateTask;
 }
 async function prepareOld(){
  const input=join(dir,'tasks',oldId,'input');await mkdir(input,{recursive:true});await writeFile(join(input,'request.json'),JSON.stringify({modelId:'qwen3.5-9b-heretic',mode:'chat'}));
  normalTask={id:oldId,task_type:'prompt_assistant',model_id:'qwen3.5-9b-heretic',parameters:{action:'art-agent-chat',model_id:'qwen3.5-9b-heretic'},references:[{name:'request.json'}]};
 }
 return {worker,dir,calls,modelCalls,modelStarted,modelFinish,requestBytes,sha,prepareCandidate,prepareOld,
  setNormalHandler(fn){normalHandler=fn},setCandidateHandler(fn){candidateHandler=fn},count(s){return calls.filter(x=>x.path.endsWith(s))},
  async cleanup(){modelFinish.resolve();await worker.stop().catch(()=>{});globalThis.fetch=previousFetch;await rm(dir,{recursive:true,force:true})}};
}

test('candidate claim is closed unless both node flags are enabled',async()=>{
 for(const [candidateEnabled,verifyEnabled] of [[false,false],[true,false],[false,true]]){
  const f=await fixture({candidateEnabled,verifyEnabled});try{await f.prepareCandidate();await f.worker.claimAndRun();assert.equal(f.count('/qwen-rotation/claim').length,0);assert.equal(f.modelCalls.length,0)}finally{await f.cleanup()}
 }
});

test('dedicated claim uses actual input byte hash, verifies phase and completes exactly once',async()=>{
 const f=await fixture();try{
  await f.prepareCandidate();await f.worker.claimAndRun();
  assert.equal(f.count('/qwen-rotation/claim').length,1);const start=f.count('/qwen-rotation-start');assert.equal(start.length,1);
  assert.equal(start[0].body.sha256,f.sha);assert.equal(start[0].body.bytes,f.requestBytes.length);
  assert.deepEqual(f.count('/qwen-rotation-phase').map(x=>x.body.op),['infer','complete','complete']);
  assert.equal(f.modelCalls.length,1);assert.equal(f.modelCalls[0].method,'qwenRotationCandidate');
  assert.equal(f.count('/qwen-rotation-complete').length,1);assert.equal(f.count('/qwen-rotation-fail').length,0);
  const output=await readFile(join(candidateTaskDirectory(f.dir,candidateId,'output'),'result.json'));assert.equal(f.count('/qwen-rotation-complete')[0].body.bytes,output.length);
 }finally{await f.cleanup()}
});

test('mismatched actual byte length fails before start or inference',async()=>{
 const f=await fixture();try{await f.prepareCandidate({bytes:f.requestBytes.length+1});await f.worker.claimAndRun();
  assert.equal(f.count('/qwen-rotation-start').length,0);assert.equal(f.modelCalls.length,0);assert.equal(f.count('/qwen-rotation-fail').length,1);
 }finally{await f.cleanup()}
});

test('denied phase cannot produce a completed candidate',async()=>{
 const f=await fixture({phaseAllowed:false});try{await f.prepareCandidate();await f.worker.claimAndRun();
  assert.equal(f.count('/qwen-rotation-complete').length,0);assert.equal(f.count('/qwen-rotation-fail').length,1);
 }finally{await f.cleanup()}
});

test('unknown completion retains result and does not resend or mark failed',async()=>{
 const f=await fixture({completion:'unknown'});try{await f.prepareCandidate();await f.worker.claimAndRun();
  const output=await readFile(join(candidateTaskDirectory(f.dir,candidateId,'output'),'result.json'));assert.ok(output.length>0);
  assert.equal(f.count('/qwen-rotation-complete').length,1);assert.equal(f.count('/qwen-rotation-fail').length,0);assert.equal(f.modelCalls.length,1);
 }finally{await f.cleanup()}
});

test('older noncandidate task keeps its normal completion path',async()=>{
 const f=await fixture();try{await f.prepareOld();await f.worker.claimAndRun();
  assert.equal(f.count('/qwen-rotation/claim').length,0);assert.equal(f.modelCalls.length,1);assert.equal(f.modelCalls[0].method,'artAgentChat');
  assert.equal(f.count('/complete').length,1);assert.equal(f.count('/qwen-rotation-complete').length,0);
 }finally{await f.cleanup()}
});

test('pause during ordinary claim prevents a new candidate claim after empty reply',async()=>{
 const f=await fixture(),pending=deferred(),started=deferred();try{
  f.setNormalHandler(()=>{started.resolve();return pending.promise});const running=f.worker.claimAndRun();await started.promise;
  const pause=f.worker.pauseClaims({timeoutMs:3000});pending.resolve(response({task:null}));await running;
  assert.equal((await pause).ok,true);assert.equal(f.count('/qwen-rotation/claim').length,0);assert.equal(f.modelCalls.length,0);
 }finally{pending.resolve(response({task:null}));await f.cleanup()}
});

test('candidate already claimed before pause finishes naturally before pause is confirmed',async()=>{
 const f=await fixture({delayedModel:true});try{await f.prepareCandidate();const running=f.worker.claimAndRun();await f.modelStarted.promise;
  let settled=false;const pause=f.worker.pauseClaims({timeoutMs:3000}).then(x=>(settled=true,x));await tick();assert.equal(settled,false);
  f.modelFinish.resolve();await running;assert.equal((await pause).ok,true);assert.equal(f.count('/qwen-rotation-complete').length,1);assert.equal(f.count('/qwen-rotation-fail').length,0);
 }finally{await f.cleanup()}
});

test('cancelled candidate produces no output or completion',async()=>{
 const f=await fixture({delayedModel:true});try{await f.prepareCandidate();const running=f.worker.claimAndRun();await f.modelStarted.promise;
  await f.worker.stopSharing();f.modelFinish.resolve();await running;
  assert.equal(f.count('/qwen-rotation-complete').length,0);await assert.rejects(readFile(join(candidateTaskDirectory(f.dir,candidateId,'output'),'result.json')));
 }finally{await f.cleanup()}
});


test('same-size tampered request is rejected by the server hash binding',async()=>{
 const f=await fixture({enforceStartHash:true});try{
  await f.prepareCandidate();const input=join(candidateTaskDirectory(f.dir,candidateId,'input'),'request.json');
  const altered=Buffer.from(f.requestBytes.toString().replace('synthetic','malicious'));assert.equal(altered.length,f.requestBytes.length);await writeFile(input,altered);
  await f.worker.claimAndRun();assert.notEqual(f.count('/qwen-rotation-start')[0].body.sha256,f.sha);
  assert.equal(f.modelCalls.length,0);assert.equal(f.count('/qwen-rotation-complete').length,0);
 }finally{await f.cleanup()}
});

test('definite rejected completion removes the non-authorized output',async()=>{
 const f=await fixture({completion:'denied'});try{
  await f.prepareCandidate();await f.worker.claimAndRun();
  await assert.rejects(readFile(join(candidateTaskDirectory(f.dir,candidateId,'output'),'result.json')));
  assert.equal(f.count('/qwen-rotation-complete').length,1);assert.equal(f.count('/qwen-rotation-fail').length,1);
 }finally{await f.cleanup()}
});

test('capability is not reported unless node and assistant flags are all enabled',async()=>{
 for(const [candidateEnabled,verifyEnabled,assistantFlag] of [[false,false,true],[true,false,true],[false,true,true],[true,true,false]]){
  const f=await fixture({candidateEnabled,verifyEnabled,assistantFlag});try{
   const rows=await f.worker.reportModels();assert.equal(rows.some(x=>x.model_id===capability),false);
  }finally{await f.cleanup()}
 }
 const f=await fixture();try{const rows=await f.worker.reportModels();assert.equal(rows.find(x=>x.model_id===capability)?.status,'ready')}
 finally{await f.cleanup()}
});


test('assistant opt-out blocks candidate claim even when node flags are set',async()=>{
 const f=await fixture({assistantFlag:false});try{
  await f.prepareCandidate();await f.worker.claimAndRun();assert.equal(f.count('/qwen-rotation/claim').length,0);assert.equal(f.modelCalls.length,0);
 }finally{await f.cleanup()}
});


test('disabled or stale Qwen identity blocks candidate claim',async()=>{
 for(const modelState of ['disabled','stale']){
  const f=await fixture({modelState});try{
   await f.prepareCandidate();await f.worker.claimAndRun();assert.equal(f.count('/qwen-rotation/claim').length,0,modelState);assert.equal(f.modelCalls.length,0,modelState);
  }finally{await f.cleanup()}
 }
});


test('ambiguous timeout, conflict, server or malformed completion cannot prove no commit',async()=>{
 for(const completion of ['timeout-408','conflict-409','server-503','malformed']){
  const f=await fixture({completion});try{
   await f.prepareCandidate();await f.worker.claimAndRun();
   const output=await readFile(join(candidateTaskDirectory(f.dir,candidateId,'output'),'result.json'));assert.ok(output.length>0,completion);
   assert.equal(f.count('/qwen-rotation-complete').length,1,completion);assert.equal(f.count('/qwen-rotation-fail').length,0,completion);
  }finally{await f.cleanup()}
 }
});


test('aborted completion is unknown even when the original error has a read-only code',async()=>{
 for(const completion of ['aborted','timeout-error']){const f=await fixture({completion});try{
  await f.prepareCandidate();await f.worker.claimAndRun();
  const output=await readFile(join(candidateTaskDirectory(f.dir,candidateId,'output'),'result.json'));assert.ok(output.length>0);
  assert.equal(f.count('/qwen-rotation-complete').length,1);assert.equal(f.count('/qwen-rotation-fail').length,0);
 }finally{await f.cleanup()}}
});


test('pause waits for a candidate claim already in flight and its resulting task',async()=>{
 const f=await fixture({delayedModel:true}),claim=deferred(),started=deferred();try{
  const task=await f.prepareCandidate();f.setCandidateHandler(()=>{started.resolve();return claim.promise});
  const running=f.worker.claimAndRun();await started.promise;
  let settled=false;const pause=f.worker.pauseClaims({timeoutMs:3000}).then(x=>(settled=true,x));await tick();assert.equal(settled,false);
  claim.resolve(response({task}));await f.modelStarted.promise;await tick();assert.equal(settled,false);
  f.modelFinish.resolve();await running;assert.equal((await pause).ok,true);
  assert.equal(f.count('/qwen-rotation-complete').length,1);assert.equal(f.count('/qwen-rotation-fail').length,0);
 }finally{claim.resolve(response({task:null}));await f.cleanup()}
});


test('revocation after model start cannot write or complete a candidate',async()=>{
 const f=await fixture({phaseAllowed:'before-only'});try{
  await f.prepareCandidate();await f.worker.claimAndRun();
  assert.equal(f.count('/qwen-rotation-start').length,1);assert.equal(f.modelCalls.length,1);
  assert.equal(f.count('/qwen-rotation-complete').length,0);assert.equal(f.count('/qwen-rotation-fail').length,1);
  await assert.rejects(readFile(join(candidateTaskDirectory(f.dir,candidateId,'output'),'result.json')));
 }finally{await f.cleanup()}
});
