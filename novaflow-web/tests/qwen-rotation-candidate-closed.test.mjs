import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createControlPlane,validateTaskParameters} from '../packages/shared/src/control-plane.mjs';
import {issueWorkerToken} from '../packages/shared/src/tokens.mjs';
import {PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE as scope,PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY as capability} from '../packages/shared/src/protocol.mjs';
import {validateQwenRotationCandidateTask,validatePromptAssistantModelRoute} from '../worker/src/worker-core.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',node='cccccccc-cccc-4ccc-8ccc-cccccccccccc',taskId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const secret='fixture-session-secret',controlSecret='fixture-control-secret',model='qwen3.5-9b-heretic';
const refs=[{name:'request.json',kind:'json',bytes:42}];
const encoded=Buffer.from(JSON.stringify({sub:owner,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
const headers={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')};
function fixture(){
 const worker={id:node,owner_id:owner,worker_name:'fixture',enabled:true,owner_enabled:true,sharing_enabled:true,sharing_scope:'pool',status:'idle',tier:'standard'};
 let task=null;const created=[],updated=[];
 const store={getUserById:async()=>({id:owner,plan:'pro',status:'active'}),getWorkerById:async()=>({...worker}),countCapableWorkers:async()=>1,
  createTask:async value=>(created.push(value),value),getTask:async()=>task,claimTask:async()=>task,
  updateTaskStatus:async value=>(updated.push(value),{})};
 return {worker,created,updated,setTask:value=>{task=value},plane:createControlPlane({store,secrets:{sessionSecret:secret,controlSecret}})};
}
const variants=['scope','camel-scope','top-model','top-camel-model','parameter-model','parameter-camel-model','stage','snake-stage','conflicting-container'];
function taskVariant(variant){
 const parameters={action:'art-agent-chat',model_id:model,target_worker_id:node};
 const task={id:taskId,user_id:owner,status:'assigned',assigned_worker_id:node,model_id:model,input_manifest:{target_worker_id:node,parameters}};
 if(variant==='scope')parameters.assistant_tool_scope=scope;if(variant==='camel-scope')parameters.assistantToolScope=scope;
 if(variant==='top-model')task.model_id=capability;if(variant==='top-camel-model')task.modelId=capability;
 if(variant==='parameter-model')parameters.model_id=capability;if(variant==='parameter-camel-model')parameters.modelId=capability;
 if(variant==='stage')parameters.foartAnimationStage='rotation_candidate';if(variant==='snake-stage')parameters.foart_animation_stage='rotation_candidate';
 if(variant==='conflicting-container')task.parameters={assistant_tool_scope:scope};
 return task;
}

test('reserved rotation candidate scope is rejected before task creation, even for an asserted own node',async()=>{
 for(const variant of variants.filter(v=>!v.startsWith('top-')&&v!=='conflicting-container')){
  const f=fixture(),task=taskVariant(variant);
  const response=await f.plane.handle({method:'POST',path:'/api/web/tasks',headers,body:{task_type:'prompt_assistant',target_worker_id:node,owner_lease_bound:true,parameters:task.input_manifest.parameters,references:refs}});
  assert.equal(response.status,403,variant);assert.equal(f.created.length,0,variant);
 }
});

test('queued or forged candidate receives no claim, upload/download grant or completion',async()=>{
 for(const variant of variants){
  const f=fixture(),task=taskVariant(variant);f.setTask(task);const token=await issueWorkerToken(f.worker,controlSecret),workerHeaders={authorization:'Bearer '+token};
  const claim=await f.plane.handle({method:'POST',path:'/api/worker/claim',headers:workerHeaders});
  assert.equal(claim.status,403,variant);assert.equal(claim.body.task,undefined);assert.equal(claim.body.grantKey,undefined);assert.equal(f.updated.length,1);
  for(const op of ['upload','download']){
   task.status=op==='upload'?'assigned':'completed';const grant=await f.plane.handle({method:'POST',path:'/api/web/tasks/'+taskId+'/grant',headers,body:{op}});
   assert.equal(grant.status,403,variant+' '+op);assert.equal(grant.body.grant,undefined);
  }
  task.status='assigned';const complete=await f.plane.handle({method:'POST',path:'/api/worker/tasks/'+taskId+'/complete',headers:workerHeaders,body:{prompt_id:'fixture',outputs:[]}});
  assert.equal(complete.status,403,variant);assert.equal(f.updated.length,1,variant+' cannot settle');
 }
});

test('worker rejects candidate manifest before reading input and candidate request before model dispatch',()=>{
 for(const variant of variants){const task=taskVariant(variant);assert.throws(()=>validateQwenRotationCandidateTask({model_id:task.model_id,modelId:task.modelId,parameters:task.parameters || task.input_manifest.parameters,input_manifest:task.input_manifest}),/owner lease unavailable/,variant);}
 const base={model_id:model,parameters:{action:'art-agent-chat',model_id:model}};
 for(const request of [{modelId:model,mode:'foart',foartAnimationStage:'rotation_candidate'},
  {modelId:model,mode:'foart',foart_animation_stage:'rotation_candidate'},
  {modelId:model,mode:'foart',assistant_tool_scope:scope}, {modelId:capability,mode:'foart'}])
  assert.throws(()=>validatePromptAssistantModelRoute(base,request),/owner lease unavailable/);
 assert.doesNotThrow(()=>validatePromptAssistantModelRoute(base,{modelId:model,mode:'chat'}));
});

test('normal Qwen text path remains valid and reserved candidate is not advertised',async()=>{
 const normal=validateTaskParameters('prompt_assistant',{action:'art-agent-chat',model_id:model,references:refs});assert.equal(normal.model_id,model);
 const f=fixture(),response=await f.plane.handle({method:'GET',path:'/api/web/capabilities',query:{worker:node},headers});
 assert.equal(response.status,200);assert.notEqual(response.body.features.qwen35FoartRotationCandidate,true);
});


test('ownership change cannot make a queued candidate claimable or uploadable',async()=>{
 const f=fixture(),task=taskVariant('scope');f.setTask(task);
 f.worker.owner_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const token=await issueWorkerToken(f.worker,controlSecret);
 const claim=await f.plane.handle({method:'POST',path:'/api/worker/claim',headers:{authorization:'Bearer '+token}});
 assert.equal(claim.status,403);assert.equal(claim.body.task,undefined);assert.equal(claim.body.grantKey,undefined);
 const grant=await f.plane.handle({method:'POST',path:'/api/web/tasks/'+taskId+'/grant',headers,body:{op:'upload'}});
 assert.equal(grant.status,403);assert.equal(grant.body.grant,undefined);
});

test('reserved id cannot be disguised as a legacy model or hide behind uppercase spelling',async()=>{
 for (const id of ['fa047a0a-1111-8111-8111-111111111111','FA047A0A-1111-8111-8111-111111111111']) {
  const f=fixture(),task=taskVariant('scope');
  task.id=id;task.model_id=model;task.input_manifest.parameters={action:'art-agent-chat',model_id:model};f.setTask(task);
  const token=await issueWorkerToken(f.worker,controlSecret),wh={authorization:'Bearer '+token};
  assert.equal((await f.plane.handle({method:'POST',path:'/api/worker/claim',headers:wh})).status,403);
  assert.equal((await f.plane.handle({method:'POST',path:'/api/web/tasks/'+id+'/grant',headers,body:{op:'upload'}})).status,403);
  assert.equal((await f.plane.handle({method:'POST',path:'/api/worker/tasks/'+id+'/complete',headers:wh,body:{prompt_id:'fixture',outputs:[]}})).status,403);
 }
});
