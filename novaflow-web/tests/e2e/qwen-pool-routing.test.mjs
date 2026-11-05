import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createControlPlane, validateTaskParameters } from '../../packages/shared/src/control-plane.mjs';
import { PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID as QWEN } from '../../packages/shared/src/protocol.mjs';
import { createQwenReportTracker, createWorker, qwenCpuAdvertisable, validatePromptAssistantModelRoute } from '../../worker/src/worker-core.mjs';

const ref = {name:'request.json',kind:'json',bytes:10};
const secret = 'fixture-session-secret';
const encoded = Buffer.from(JSON.stringify({sub:'u',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
const token = 'nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url');
const headers = {authorization:'Bearer '+token};
const nodeId = '11111111-1111-4111-8111-111111111111';

test('only the explicit Qwen chat selector is admitted as a new scheduler model', () => {
  const base = {action:'art-agent-chat',references:[ref]};
  assert.equal(validateTaskParameters('prompt_assistant',{...base,model_id:QWEN}).model_id,QWEN);
  assert.throws(()=>validateTaskParameters('prompt_assistant',base));
  assert.throws(()=>validateTaskParameters('prompt_assistant',{...base,model_id:'unknown'}));
  assert.throws(()=>validateTaskParameters('prompt_assistant',{...base,action:'optimize-prompt',model_id:QWEN}));
  assert.throws(()=>validateTaskParameters('prompt_assistant',{...base,action:'optimize-prompt'}));
  assert.equal(validateTaskParameters('prompt_assistant',{...base,action:'optimize-prompt',assistant_model_id:QWEN}).model_id,'qwen3.5-9b-heretic-business-v1');
  for (const model_id of ['',null,false,[],[QWEN],{},'next']) {
    assert.throws(()=>validateTaskParameters('prompt_assistant',{...base,model_id}));
  }
  assert.throws(()=>validateTaskParameters('prompt_assistant',{...base,model_id:QWEN,modelId:'unknown'}));
});

test('other task types retain their model fields without selecting a retired brain', () => {
  const video={prompt:'fixture',width:512,height:512,modelId:'unrelated-video-model',references:[{name:'ref.png',bytes:1,kind:'image'}]};
  assert.deepEqual(validateTaskParameters('h3_i2v',video),validateTaskParameters('h3_i2v',{...video,modelId:undefined}));
  const task={model_id:'prompt-assistant',parameters:{action:'optimize-prompt',model_id:'unrelated-model'}};
  assert.throws(()=>validatePromptAssistantModelRoute(task,{modelId:'unrelated-model'}));
  assert.throws(()=>validatePromptAssistantModelRoute({...task,model_id:QWEN},{modelId:QWEN}));
});

test('worker rejects disagreement between scheduler, selector and uploaded request', () => {
  const q = {task_type:'prompt_assistant',model_id:QWEN,parameters:{action:'art-agent-chat',model_id:QWEN}};
  const old = {task_type:'prompt_assistant',model_id:'prompt-assistant',parameters:{action:'art-agent-chat'}};
  assert.doesNotThrow(()=>validatePromptAssistantModelRoute(q,{modelId:QWEN}));
  assert.throws(()=>validatePromptAssistantModelRoute(old,{}));
  assert.throws(()=>validatePromptAssistantModelRoute(old,{modelId:'next'}));
  for (const [task,request] of [[q,{}],[q,{modelId:'next'}],[old,{modelId:QWEN}],
    [{...q,model_id:'prompt-assistant'},{modelId:QWEN}],
    [{...q,parameters:{action:'optimize-prompt'}},{modelId:QWEN}],
    [old,{modelId:'unknown'}],[old,{modelId:false}],[old,{modelId:null}],[old,{modelId:''}]]) {
    assert.throws(()=>validatePromptAssistantModelRoute(task,request));
  }
});

test('a verified worker remains capable while temporarily busy, but fails closed on cleanup or identity failure', () => {
  const model={id:QWEN,configured:true,identityVerified:true,enabled:false,
    errorCode:'community-runtime-ownership-unconfirmed',trial:{backend:'cpu',chat:true,images:true,tools:false}};
  const status={localModels:[model]};
  assert.equal(qwenCpuAdvertisable(status,'owned-task'),true);
  assert.equal(qwenCpuAdvertisable(status,null),false);
  assert.equal(qwenCpuAdvertisable({localModels:[{...model,identityVerified:false}]},'owned-task'),false);
  assert.equal(qwenCpuAdvertisable({localModels:[{...model,errorCode:'cleanup-failed'}]},'owned-task'),false);
  assert.equal(qwenCpuAdvertisable(null,null),false);
});

test('a failed capability withdrawal remains pending until the server acknowledges it', async () => {
  const tracker=createQwenReportTracker();
  assert.equal(tracker.needsReport(true),true);
  await tracker.publish(true,async()=>{});
  assert.equal(tracker.needsReport(true),false);
  await assert.rejects(tracker.publish(false,async()=>{throw Error('disconnected');}));
  assert.equal(tracker.needsReport(false),true);
  await tracker.publish(false,async()=>{});
  assert.equal(tracker.needsReport(false),false);
  tracker.reset();
  assert.equal(tracker.needsReport(false),true);
});

test('pool and pinned capability counts route Qwen exactly and fail closed on absence', async () => {
  let online = false;
  const created = [];
  const worker = {id:nodeId,owner_id:'u',worker_name:'fixture',enabled:true,owner_enabled:true};
  const store = {
    getUserById:async()=>({id:'u',plan:'pro',status:'active'}),
    getWorkerById:async id=>id===nodeId?worker:null,
    countCapableWorkers:async (model,min,timeout,target)=>model===QWEN && online && (!target || target===nodeId) ? 1 : model==='prompt-assistant' ? 1 : 0,
    createTask:async task=>{created.push(task);return {id:'task-fixture',...task,input_manifest:task.inputManifest,model_id:task.modelId,task_type:task.taskType};}
  };
  const plane=createControlPlane({store,secrets:{sessionSecret:secret}});
  const call=(method,path,body={},query={})=>plane.handle({method,path,headers,body,query});
  const qwenBody={task_type:'prompt_assistant',parameters:{action:'art-agent-chat',model_id:QWEN},references:[ref]};
  for (const model_id of ['unknown','',null,[],[QWEN]]) {
    assert.equal((await call('POST','/api/web/tasks',{...qwenBody,parameters:{action:'art-agent-chat',model_id}})).status,400);
  }
  assert.equal(created.length,0,'malformed and unknown selectors must not create legacy tasks');
  assert.equal((await call('GET','/api/web/capabilities')).body.features.qwen35CpuTrial,false);
  assert.equal((await call('POST','/api/web/tasks',qwenBody)).status,409);
  assert.equal(created.length,0);
  const legacy=await call('POST','/api/web/tasks',{...qwenBody,parameters:{action:'art-agent-chat'}});
  assert.equal(legacy.status,400);
  assert.equal(created.length,0);
  online=true;
  assert.equal((await call('GET','/api/web/capabilities',{}, {worker:nodeId})).body.features.qwen35CpuTrial,true);
  const pinned=await call('POST','/api/web/tasks',{...qwenBody,target_worker_id:nodeId});
  assert.equal(pinned.status,200);
  assert.equal(created.at(-1).modelId,QWEN);
  assert.equal(created.at(-1).inputManifest.target_worker_id,nodeId);
  assert.equal(created.at(-1).inputManifest.min_vram_mb,0);
  online=false;
  const count=created.length;
  assert.equal((await call('POST','/api/web/tasks',{...qwenBody,target_worker_id:nodeId})).status,409);
  assert.equal(created.length,count,'a lost capability must not create a waiting or downgraded task');
});
