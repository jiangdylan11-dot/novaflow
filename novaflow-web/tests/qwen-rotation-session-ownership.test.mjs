import test from 'node:test';
import assert from 'node:assert/strict';
import {createStrataPromptAssistant} from '../worker/src/strata-prompt-assistant.mjs';
import {FOART_TOOL_SCHEMA} from '../packages/shared/src/foart-tool-plan.mjs';

// The assistant's owner monitor and deadlines are unref'd so they never keep the worker alive; in this
// bare test process nothing else would, so hold the event loop open while the cases wait on them.
const keepAlive=setInterval(()=>{},1000);test.after(()=>clearInterval(keepAlive));
let serial=0;
const taskId='fixture-task',workerId='fixture-worker';
const actor=()=>({taskId,workerId,scope:'qwen-foart-rotation-candidate-v1',attempt:1});
const payload=()=>({requestId:'rotation_fixture_'+(++serial),provider:'local',modelId:'qwen3.5-9b-heretic',mode:'foart',foartAnimationStage:'rotation_candidate',message:'change the selected bone rotation',history:[],images:[],
 foartContext:{schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,revision:'r1',name:'fixture',fps:24,animation:'walk',animations:['walk'],selectedBones:['cape'],bones:[{name:'cape'}]}},
 rotationBaseline:{action:'animation',operation:'inspect_bones',phase:'observed',inspection:{name:'walk',revision:'r1',fps:24,bones:[{boneName:'cape',tracks:{rotate:[{time:1,angle:0}]},complete:true}],complete:true,truncated:false}}});
const candidate=()=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'preview',operations:[{action:'animation',operation:'key_bones',name:'walk',keys:[{boneName:'cape',frame:24,values:{rotation:12}}]}]});
const response=()=>({model:'qwen35-heretic',requestId:'model-fixture',finishReason:'stop',message:{content:JSON.stringify(candidate())}});
function fixture({enabled=false,infer,release=true,workerState}={}){
 const counts={loads:0,unloads:0,calls:0};const state=workerState||{workerId,currentTaskId:taskId,sharing:true,runtimeReady:true};
 const session={async withSession(callback,{signal}={}){counts.loads++;try{
  const flash={identity:{id:'qwen35-heretic'},supportsFoartJsonSchema:true,inferConversation:async input=>{counts.calls++;return infer?infer(input,signal):response()}};
  const value=await callback(flash);return {value,identity:flash.identity,timing:{callbackMs:0},resourcesReleased:release};
 }finally{counts.unloads++}}};
 const assistant=createStrataPromptAssistant({worker:{getState:()=>state},config:{},gemmaConfig:{},qwenSession:session,
  communityCpuTrialForDevelopment:true,qwenRotationCandidateEnabled:enabled,sessionFactory:()=>({})});
 return {assistant,counts,state,context:{rotationActor:actor(),rotationPhaseVerifier:async()=>true,isCancelled:()=>false}};
}
const run=(f,p=payload(),c=f.context)=>f.assistant.runForTask(taskId,'qwenRotationCandidate',p,c);

test('default off and forged JSON flags/actor cannot turn on candidate execution',async()=>{
 const f=fixture();try{
  const p=payload();p.qwenRotationCandidateEnabled=true;p.rotationActor=actor();p.rotationPhaseVerifier=true;
  assert.equal((await run(f,p)).ok,false);assert.equal(f.counts.loads,0);
 }finally{await f.assistant.stop()}
 const g=fixture({enabled:true});try{
  const p=payload();p.rotationActor=actor();assert.equal((await run(g,p)).ok,false);assert.equal(g.counts.loads,0);
  assert.equal((await run(g,payload(),{isCancelled:()=>false})).ok,false);assert.equal(g.counts.loads,0);
 }finally{await g.assistant.stop()}
});

test('valid internal actor is revalidated before inference and after model cleanup',async()=>{
 const f=fixture({enabled:true}),phases=[];try{
  f.context.rotationPhaseVerifier=async(a,phase)=>{phases.push({a,phase,unloads:f.counts.unloads});return true};
  const result=await run(f);assert.equal(result.ok,true);assert.equal(result.resourcesReleased,true);
  assert.deepEqual(result.data.rotationCandidate,{animation:'walk',boneName:'cape',frame:24,rotation:12});
  assert.equal(result.data.toolPlan,undefined);assert.equal(result.generationReady,false);
  assert.deepEqual(phases.map(x=>x.phase),['before','before','after','after']);assert.equal(phases.at(-1).unloads,1);
  assert.equal(f.counts.loads,1);assert.equal(f.counts.unloads,1);
 }finally{await f.assistant.stop()}
});

test('wrong task, node, scope, attempt or preflight verifier cannot load a model',async()=>{
 for(const patch of [{taskId:'other'},{workerId:'other'},{scope:'other'},{attempt:0}]){
  const f=fixture({enabled:true});try{f.context.rotationActor={...actor(),...patch};const result=await run(f);assert.equal(result.ok,false);assert.equal(f.counts.loads,0)}finally{await f.assistant.stop()}
 }
 const f=fixture({enabled:true});try{f.context.rotationPhaseVerifier=async()=>false;assert.equal((await run(f)).ok,false);assert.equal(f.counts.loads,0)}finally{await f.assistant.stop()}
});

test('revocation after inference, cleanup uncertainty and cancellation return no applicable candidate',async()=>{
 for(const mode of ['revoked','release','cancel']){
  let checks=0,cancelled=false;const f=fixture({enabled:true,release:mode!=='release',infer:async()=>{if(mode==='cancel')cancelled=true;return response()}});
  try{
   f.context.isCancelled=()=>cancelled;f.context.rotationPhaseVerifier=async()=>mode==='revoked'?++checks<3:true;
   const result=await run(f);assert.equal(result.ok,false,mode);assert.equal(result.data,undefined,mode);assert.equal(f.counts.unloads,1,mode);
  }finally{await f.assistant.stop().catch(()=>{})}
 }
});

test('periodic owner revocation aborts a running candidate and does not return its result',async()=>{
 let checks=0,aborted=false;const f=fixture({enabled:true,infer:(_input,signal)=>new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'))},{once:true});setTimeout(()=>resolve(response()),5000).unref();
 })});
 try{
  f.context.rotationPhaseVerifier=async()=>++checks<3;
  const result=await run(f);assert.equal(result.ok,false);assert.equal(result.data,undefined);assert.equal(aborted,true);assert.equal(f.counts.unloads,1);
 }finally{await f.assistant.stop()}
});


test('cancellation while owner verification is awaiting cannot start the model',async()=>{
 let release,cancelled=false;const f=fixture({enabled:true});
 try{
  f.context.isCancelled=()=>cancelled;f.context.rotationPhaseVerifier=()=>new Promise(resolve=>{release=resolve});
  const pending=run(f);while(!release)await new Promise(resolve=>setImmediate(resolve));
  cancelled=true;release(true);const result=await pending;assert.equal(result.ok,false);assert.equal(f.counts.loads,0);
 }finally{await f.assistant.stop()}
});

test('a second candidate cannot enter while the first owns the model lease',async()=>{
 let release,entered;const started=new Promise(resolve=>{entered=resolve});
 const f=fixture({enabled:true,infer:()=>new Promise(resolve=>{release=()=>resolve(response());entered()})});
 try{
  const first=run(f);await started;const second=await run(f);
  assert.equal(second.ok,false);assert.equal(second.errorCode,'prompt-assistant-busy');assert.equal(f.counts.loads,1);
  release();assert.equal((await first).ok,true);assert.equal(f.counts.unloads,1);
 }finally{if(release)release();await f.assistant.stop()}
});


test('revocation after model cleanup cannot return a candidate',async()=>{
 let checks=0;const f=fixture({enabled:true});
 try{
  f.context.rotationPhaseVerifier=async()=>++checks<4;
  const result=await run(f);assert.equal(checks,4);assert.equal(f.counts.unloads,1);
  assert.equal(result.ok,false);assert.equal(result.data,undefined);
 }finally{await f.assistant.stop()}
});

test('a changed current worker task rejects an otherwise valid model response',async()=>{
 let f;f=fixture({enabled:true,infer:async()=>{f.state.currentTaskId='different-task';return response()}});
 try{const result=await run(f);assert.equal(result.ok,false);assert.equal(result.data,undefined);assert.equal(f.counts.unloads,1)}finally{await f.assistant.stop()}
});


test('status reports only the immutable constructor gate and payload cannot enable it',async()=>{
 const off=fixture();const on=fixture({enabled:true});
 try{
  assert.equal(off.assistant.status().qwenRotationCandidateEnabled,false);
  assert.equal(on.assistant.status().qwenRotationCandidateEnabled,true);
  const p=payload();p.qwenRotationCandidateEnabled=true;p.rotationActor=actor();
  assert.equal((await run(off,p)).ok,false);
  assert.equal(off.assistant.status().qwenRotationCandidateEnabled,false);
  const snapshot=off.assistant.status();snapshot.qwenRotationCandidateEnabled=true;
  assert.equal(off.assistant.status().qwenRotationCandidateEnabled,false);
 }finally{await off.assistant.stop();await on.assistant.stop()}
});
