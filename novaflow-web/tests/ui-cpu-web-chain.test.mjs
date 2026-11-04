import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createControlPlane,validateTaskParameters} from '../packages/shared/src/control-plane.mjs';
import {validatePromptAssistantModelRoute,UI_CPU_CAPABILITY} from '../worker/src/worker-core.mjs';

const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const begin=source.indexOf('  async function pooledPromptAssistant('),end=source.indexOf('  async function pooledPromptStatus(',begin);
assert.ok(begin>0 && end>begin);
const code=source.slice(begin,end), nodeId='11111111-1111-4111-8111-111111111111', userId='22222222-2222-4222-8222-222222222222';
const secret='synthetic-session-secret',encoded=Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
const headers={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')};

function harness({capable=true}={}) {
  const events=[],created=[]; let upload;
  const node={id:nodeId,owner_id:userId,enabled:true,owner_enabled:true};
  const store={getUserById:async()=>({id:userId,status:'active',plan:'pro'}),getWorkerById:async id=>id===nodeId?node:null,
    countCapableWorkers:async(model,_vram,_heartbeat,target)=>{events.push(['count',model,target]);return model===UI_CPU_CAPABILITY && target===nodeId && capable?1:0;},
    createTask:async entry=>{created.push(entry);return {id:'test-task',user_id:userId,task_type:entry.taskType,model_id:entry.modelId,input_manifest:entry.inputManifest,status:'queued'};}};
  const plane=createControlPlane({store,secrets:{sessionSecret:secret}});
  const root={setTimeout,clearTimeout},ctx={root,TextEncoder,TextDecoder,Map,Set,Date,Error,JSON,String,AbortController,
    QWEN_ROTATION_CANDIDATE_RELEASE_ENABLED:false,computeNode:node,computeNodeEpoch:0,pooledPromptRequests:new Map(),pooledConversationNodes:new Map(),tasks:new Map(),
    PROMPT_ASSISTANT_TIMEOUT_MS:1000,PROMPT_ASSISTANT_REFUSAL:'unavailable',taskMode:()=> 'shared',
    control:async(method,path,body)=>{if(method==='GET')return {taskTypes:[],features:{}};const r=await plane.handle({method,path,headers,body:{...body,target_worker_id:nodeId}});events.push(['post',r.status]);if(r.status!==200)throw Error(r.body.error);return r.body;},
    putTaskInput:async(_id,_file,bytes)=>{upload=JSON.parse(new TextDecoder().decode(bytes));},waitForTaskEnd:async()=>({}),
    fetchTaskOutput:async()=>new TextEncoder().encode('{"ok":true}')};
  createContext(ctx);runInContext(code+'\nglobalThis.run=pooledPromptAssistant;',ctx);
  return {ctx,created,events,getUpload:()=>upload};
}

test('actual web request goes through selected-node CPU capability and worker contract',async()=>{
  for(const action of ['capabilities','grok-vision-job','compile-grok-vision','native-ui-cloud','native-ui-compile']) {
    const h=harness(),payload={surface:'ui-design',uiPlanner:'grok-vision-cpu-v1',action};
    const result=await h.ctx.run('reverse-image-prompt',payload);
    assert.equal(result.ok,true);assert.equal(h.created.length,1);
    const entry=h.created[0],params=entry.inputManifest.parameters;
    assert.equal(entry.modelId,UI_CPU_CAPABILITY);assert.equal(entry.inputManifest.target_worker_id,nodeId);
    assert.equal(params.ui_scope,'cpu-v1');assert.equal(params.model_id,UI_CPU_CAPABILITY);
    assert.deepEqual(h.events[0],['count',UI_CPU_CAPABILITY,nodeId]);
    assert.doesNotThrow(()=>validatePromptAssistantModelRoute({model_id:entry.modelId,parameters:params},h.getUpload()));
  }
});

test('unavailable selected node, forged identities and mismatched payloads fail closed',async()=>{
  const h=harness({capable:false}),payload={surface:'ui-design',uiPlanner:'grok-vision-cpu-v1',action:'capabilities'};
  await assert.rejects(h.ctx.run('reverse-image-prompt',payload));assert.equal(h.created.length,0);
  const refs=[{name:'request.json',kind:'json',bytes:10}];
  for(const extra of [{model_id:UI_CPU_CAPABILITY},{assistant_model_id:'qwen3.5-9b-heretic'},{uiScope:'cpu-v1'},{ui_scope:'pe-source-v1'}])
    assert.throws(()=>validateTaskParameters('prompt_assistant',{action:'reverse-image-prompt',ui_scope:'cpu-v1',references:refs,...extra}));
  assert.throws(()=>validateTaskParameters('prompt_assistant',{action:'art-agent-chat',ui_scope:'cpu-v1',references:refs}));
  const params=validateTaskParameters('prompt_assistant',{action:'reverse-image-prompt',ui_scope:'cpu-v1',references:refs});
  for(const request of [{...payload,action:'unknown'},{...payload,surface:'art'},{...payload,assistantModelId:'next'}])
    assert.throws(()=>validatePromptAssistantModelRoute({model_id:UI_CPU_CAPABILITY,parameters:params},request));
});
