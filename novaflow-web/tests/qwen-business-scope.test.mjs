import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createControlPlane,validateTaskParameters} from '../packages/shared/src/control-plane.mjs';

const id='qwen3.5-9b-heretic';
const capability='qwen3.5-9b-heretic-business-v1';
const refs=[{name:'request.json',kind:'json',bytes:20}];
const base={action:'optimize-prompt',references:refs};
const validate=value=>validateTaskParameters('prompt_assistant',value);

test('scoped business requires a consistent explicit assistant identity',()=>{
  assert.equal(validate({...base,assistant_selection_scope:'xiaotao',assistant_model_id:id}).model_id,capability);
  for(const value of [
    {...base,assistant_selection_scope:'xiaotao'},
    {...base,assistant_selection_scope:'xiaotao',assistantModelId:id},
    {...base,assistant_selection_scope:'xiaotao',assistant_model_id:'next'},
    {...base,assistant_selection_scope:'xiaotao',assistant_model_id:id,assistantModelId:'next'},
    {...base,assistant_selection_scope:'xiaotao',assistant_model_id:id,model_id:'next'},
    {...base,assistant_selection_scope:'other',assistant_model_id:id},
    {...base,assistant_selection_scope:'xiaotao',assistantSelectionScope:'other',assistant_model_id:id},
    {...base,assistant_selection_scope:null,assistant_model_id:id},
    {...base,action:'art-agent-chat',assistant_selection_scope:'xiaotao',assistant_model_id:id},
  ]) assert.throws(()=>validate(value));
});

test('unselected business is rejected while UI CPU envelope and selected Qwen remain distinct',()=>{
  assert.throws(()=>validate(base));
  assert.deepEqual(validate({...base,action:'reverse-image-prompt'}),{action:'reverse-image-prompt',references:refs});
  assert.equal(validate({...base,assistantModelId:id}).model_id,capability);
  assert.throws(()=>validate({...base,action:'rewrite-audio-prompt'}));
  assert.equal(validate({...base,action:'rewrite-audio-prompt',assistant_selection_scope:'xiaotao',assistant_model_id:id}).model_id,capability);
});

test('scope without selection cannot create a task even if an old node is ready',async()=>{
  const secret='scope-fixture-secret';
  const encoded=Buffer.from(JSON.stringify({sub:'fixture-user',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const token='nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url');
  const created=[];
  const store={getUserById:async()=>({id:'fixture-user',status:'active',plan:'pro'}),
    countCapableWorkers:async model=>model==='prompt-assistant'?1:0,
    createTask:async task=>{created.push(task);return {id:'fixture-task',...task,input_manifest:task.inputManifest,model_id:task.modelId,task_type:task.taskType};}};
  const plane=createControlPlane({store,secrets:{sessionSecret:secret}});
  const send=parameters=>plane.handle({method:'POST',path:'/api/web/tasks',headers:{authorization:'Bearer '+token},body:{task_type:'prompt_assistant',parameters,references:refs}});
  assert.equal((await send({action:'optimize-prompt',assistant_selection_scope:'xiaotao'})).status,400);
  assert.equal(created.length,0);
  assert.equal((await send({action:'optimize-prompt'})).status,400);
  assert.equal((await send({action:'art-agent-chat'})).status,400);
  assert.equal(created.length,0);
});
