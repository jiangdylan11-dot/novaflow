import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker,validatePromptAssistantModelRoute,UI_CPU_CAPABILITY,UI_PE_SOURCE_CAPABILITY} from '../worker/src/worker-core.mjs';

const payload={surface:'ui-design',uiPlanner:'grok-vision-cpu-v1',action:'capabilities'};
const task={model_id:UI_CPU_CAPABILITY,parameters:{action:'reverse-image-prompt',ui_scope:'cpu-v1',model_id:UI_CPU_CAPABILITY}};
test('UI CPU scope must match control route and actual request content',()=>{
  assert.doesNotThrow(()=>validatePromptAssistantModelRoute(task,payload));
  for(const request of [{...payload,surface:'art'}, {...payload,uiPlanner:'native-catalog-v3'}, {...payload,action:'unknown'}, {...payload,assistantModelId:'next'}])assert.throws(()=>validatePromptAssistantModelRoute(task,request));
  assert.throws(()=>validatePromptAssistantModelRoute({...task,model_id:'prompt-assistant'},payload));
  assert.throws(()=>validatePromptAssistantModelRoute({model_id:'prompt-assistant',parameters:{action:'reverse-image-prompt'}},payload));
  assert.throws(()=>validatePromptAssistantModelRoute({...task,parameters:{...task.parameters,ui_scope:'pe-source-v1'}},payload));
});
test('UI CPU capability requires a successful runtime probe; PE remains separately unavailable',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'foart-ui-cpu-'));let probe=true;
  const worker=createWorker({controlUrl:'http://127.0.0.1:9',dataDir:dir,workflowDir:dir,configPath:join(dir,'identity.json'),modelsRoot:dir,tunnel:false,
    promptAssistant:{status:()=>({localModels:[]}),probeUiCpu:async()=>probe}});
  try {let m=await worker.reportModels();assert.equal(m.find(x=>x.model_id===UI_CPU_CAPABILITY)?.status,'ready');assert.equal(m.find(x=>x.model_id===UI_PE_SOURCE_CAPABILITY)?.status,'missing');
    probe=false;m=await worker.reportModels();assert.equal(m.find(x=>x.model_id===UI_CPU_CAPABILITY)?.status,'missing');
  } finally{await worker.stop().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
