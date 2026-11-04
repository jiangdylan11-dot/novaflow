import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createControlPlane, validateTaskParameters } from '../packages/shared/src/control-plane.mjs';
import { issueWorkerToken } from '../packages/shared/src/tokens.mjs';
import { validateQwenUiTask } from '../worker/src/worker-core.mjs';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const node = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const taskId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const secret = 'fixture-session-secret', controlSecret = 'fixture-control-secret';
const model = 'qwen3.5-9b-heretic', capability = 'qwen3.5-9b-heretic-ui-draft-v1';
const scope = 'qwen-ui-draft-v1', refs = [{name:'request.json',kind:'json',bytes:42}];
const encoded = Buffer.from(JSON.stringify({sub:owner, exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
const headers = {authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')};

function fixture() {
  const worker = {id:node,owner_id:owner,worker_name:'fixture',enabled:true,owner_enabled:true,
    sharing_enabled:true,sharing_scope:'pool',status:'idle',tier:'standard'};
  let task = null; const created = [], failed = [];
  const store = {
    getUserById:async()=>({id:owner,plan:'pro',status:'active'}),
    getWorkerById:async()=>({...worker}),
    countCapableWorkers:async()=>1,
    createTask:async value=>{created.push(value);return value;},
    getTask:async()=>task,
    claimTask:async()=>task,
    updateTaskStatus:async value=>{failed.push(value);return {};}
  };
  return {worker,created,failed,setTask:value=>{task=value;},
    plane:createControlPlane({store,secrets:{sessionSecret:secret,controlSecret}})};
}

test('Qwen UI scoped task is refused before a task or grant can be created',async()=>{
  const f=fixture();
  const response=await f.plane.handle({method:'POST',path:'/api/web/tasks',headers,body:{
    task_type:'prompt_assistant',target_worker_id:node,owner_lease_bound:true,
    parameters:{action:'reverse-image-prompt',ui_scope:scope,model_id:model},references:refs}});
  assert.equal(response.status,403); assert.equal(f.created.length,0);
});

test('already queued or forged tasks cannot be claimed or granted after a node owner changes',async()=>{
  for(const variant of ['scope','top-model','parameter-model','camel-scope']) {
    const f=fixture();
    const parameters={action:'reverse-image-prompt',target_worker_id:node};
    const task={id:taskId,user_id:owner,status:'assigned',assigned_worker_id:node,model_id:'legacy',
      input_manifest:{target_worker_id:node,parameters}};
    if(variant==='scope') parameters.ui_scope=scope;
    if(variant==='camel-scope') parameters.uiScope=scope;
    if(variant==='top-model') task.model_id=capability;
    if(variant==='parameter-model') parameters.model_id=capability;
    f.setTask(task); const token=await issueWorkerToken(f.worker,controlSecret);
    const claim=await f.plane.handle({method:'POST',path:'/api/worker/claim',headers:{authorization:'Bearer '+token}});
    assert.equal(claim.status,403,variant); assert.equal(claim.body.task,undefined); assert.equal(claim.body.grantKey,undefined);
    assert.equal(f.failed.length,1,variant);
    for(const op of ['upload','download']) {
      task.status=op==='upload'?'assigned':'completed';
      const response=await f.plane.handle({method:'POST',path:'/api/web/tasks/'+taskId+'/grant',headers,body:{op}});
      assert.equal(response.status,403,variant+' '+op); assert.equal(response.body.grant,undefined);
    }
  }
});

test('node refuses scoped tasks before input read and leaves regular CPU UI alone',()=>{
  for(const task of [{parameters:{ui_scope:scope}},{parameters:{uiScope:scope}},
    {parameters:{assistant_tool_scope:scope}},{parameters:{model_id:capability}},
    {parameters:{modelId:capability}},{model_id:capability,parameters:{}}])
    assert.throws(()=>validateQwenUiTask(task,node),/owner lease unavailable/);
  assert.equal(validateQwenUiTask({parameters:{ui_scope:'cpu-v1'}},node),false);
});

test('capabilities cannot claim Qwen UI draft or owner lease while unavailable',async()=>{
  const f=fixture();
  const response=await f.plane.handle({method:'GET',path:'/api/web/capabilities',query:{worker:node},headers});
  assert.equal(response.status,200); assert.equal(response.body.features.qwen35UiDraft,false);
  assert.equal(response.body.features.qwen35UiOwnerLeaseBound,false);
});

test('ordinary Qwen text and legacy CPU UI remain routable',()=>{
  const text=validateTaskParameters('prompt_assistant',{action:'optimize-prompt',assistant_selection_scope:'xiaotao',
    assistant_model_id:model,references:refs});
  assert.match(text.model_id,/business/);
  const ui=validateTaskParameters('prompt_assistant',{action:'reverse-image-prompt',ui_scope:'cpu-v1',references:refs});
  assert.equal(ui.action,'reverse-image-prompt');
  const chat=validateTaskParameters('prompt_assistant',{action:'art-agent-chat',model_id:model,references:refs});
  assert.equal(chat.model_id,model);
});
