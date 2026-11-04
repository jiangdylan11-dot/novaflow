import test from 'node:test';
import assert from 'node:assert/strict';
import {businessAssistantSelection} from '../worker/src/local-model-selection.mjs';
import {validatePromptAssistantModelRoute,qwenBusinessAdvertisable} from '../worker/src/worker-core.mjs';
import {validateTaskParameters} from '../packages/shared/src/control-plane.mjs';
import {createStrataPromptAssistant} from '../worker/src/strata-prompt-assistant.mjs';

const id='qwen3.5-9b-heretic',capability='qwen3.5-9b-heretic-business-v1',refs=[{name:'request.json',kind:'json',bytes:42}],pick={assistantProvider:'local',assistantModelId:id};
const actions=['optimize-prompt','reverse-image-prompt','describe-art-style','rewrite-audio-prompt'];

test('dedicated selected-brain field rejects online, missing capabilities and unsupported audio/video',()=>{
  assert.equal(businessAssistantSelection({modelId:'qwen-image-2511'},{qwenBridgeEnabled:true}).errorCode,'assistant-model-selection-required');
  assert.equal(businessAssistantSelection(pick,{qwenBridgeEnabled:true}).kind,'qwen');
  assert.equal(businessAssistantSelection(pick,{qwenBridgeEnabled:false}).errorCode,'qwen-business-unavailable');
  for(const value of [{assistantProvider:'api',assistantModelId:'xai/grok-4.7'},{assistantModelId:id},
    {...pick,uploads:[{kind:'video',name:'example.mp4'}]},{...pick,attachments:[{type:'audio/wav'}]},{...pick,audioDataUrl:'data:audio/wav;base64,AA=='},
    {...pick,input:'data:audio/wav;base64,AA=='},{...pick,images:[{dataUrl:'data:video/mp4;base64,AA=='}]},
    {...pick,experienceContext:{methods:['scoped example']}}])
    assert.equal(businessAssistantSelection(value,{qwenBridgeEnabled:true}).kind,'rejected');
});

test('control-plane and worker bind all four actions to the requested Qwen model, without confusing image modelId',()=>{
  for(const action of actions){
    const params=validateTaskParameters('prompt_assistant',{action,assistant_model_id:id,references:refs});
    assert.equal(params.model_id,capability);const task={parameters:params,model_id:capability};
    assert.equal(validateTaskParameters('prompt_assistant',{action,assistantModelId:id,references:refs}).model_id,capability);
    assert.doesNotThrow(()=>validatePromptAssistantModelRoute(task,{...pick,modelId:'qwen-image-2511'}));
    for(const request of [{},{...pick,assistantModelId:'xai/grok-4.7'},{...pick,assistantProvider:'api'}])
      assert.throws(()=>validatePromptAssistantModelRoute(task,request));
    assert.throws(()=>validatePromptAssistantModelRoute({...task,model_id:'prompt-assistant'},pick));
    assert.throws(()=>validateTaskParameters('prompt_assistant',{action,assistant_model_id:'xai/grok-4.7',references:refs}));
    assert.throws(()=>validateTaskParameters('prompt_assistant',{action,assistant_model_id:id,assistantModelId:'other',references:refs}));
  }
  assert.throws(()=>validateTaskParameters('prompt_assistant',{action:'optimize-prompt',modelId:'qwen-image-2511',references:refs}));
  const oldUi=validateTaskParameters('prompt_assistant',{action:'reverse-image-prompt',references:refs});
  assert.throws(()=>validatePromptAssistantModelRoute({parameters:oldUi,model_id:'prompt-assistant'},{surface:'ui-design',uiPlanner:'grok-vision-cpu-v1',action:'capabilities'}));
  const ui=validateTaskParameters('prompt_assistant',{action:'reverse-image-prompt',ui_scope:'cpu-v1',references:refs});
  const uiTask={parameters:ui,model_id:'foart-ui-cpu-compiler-v1'};
  assert.doesNotThrow(()=>validatePromptAssistantModelRoute(uiTask,{surface:'ui-design',uiPlanner:'grok-vision-cpu-v1',action:'capabilities'}));
  assert.throws(()=>validatePromptAssistantModelRoute(uiTask,{}));
  assert.throws(()=>validatePromptAssistantModelRoute(uiTask,{surface:'ui-design',uiPlanner:'grok-vision-cpu-v1',assistantProvider:'api'}));
  assert.throws(()=>validatePromptAssistantModelRoute({...uiTask,model_id:capability},{surface:'ui-design',uiPlanner:'grok-vision-cpu-v1'}));
  assert.throws(()=>validateTaskParameters('prompt_assistant',{action:'rewrite-audio-prompt',references:refs}));
});

test('business capability is not advertised merely because Qwen chat and images are ready',()=>{
  const qwen={id,enabled:true,configured:true,identityVerified:true,trial:{backend:'cpu',chat:true,images:true,tools:false}};
  assert.equal(qwenBusinessAdvertisable({localModels:[qwen]}),false);
  assert.equal(qwenBusinessAdvertisable({localModels:[{...qwen,trial:{...qwen.trial,business:true}}]}),true);
  assert.equal(qwenBusinessAdvertisable({localModels:[{...qwen,enabled:false,trial:{...qwen.trial,business:true}}]}),false);
});

test('explicit unsupported model or modality fails before both old and new model sessions',async()=>{
  let called=false;const assistant=createStrataPromptAssistant({config:{},qwenConfig:{},gemmaConfig:{},qwenBusinessBridge:true,qwenBusinessReady:()=>true,
    sessionFactory:()=>({}),lifecycle:{load:async()=>{called=true;},unload:async()=>({ok:true,released:true})}});
  for(const payload of [{assistantProvider:'api',assistantModelId:'xai/grok-4.7'},
    {...pick,uploads:[{kind:'audio',name:'voice.wav'}]},{...pick,attachments:[{kind:'video',name:'video.mp4'}]}]){
    const result=await assistant.optimizePrompt(payload);assert.equal(result.ok,false);assert.match(result.errorCode,/unavailable/);
  }
  assert.equal(called,false);await assistant.stop();
});

test('business readiness heartbeat tracks changes independently and never interprets an unconfirmed lease as ready',async()=>{
  const {qwenReportSignature,createQwenReportTracker}=await import('../worker/src/worker-core.mjs');
  const qwen={id,enabled:true,configured:true,identityVerified:true,trial:{backend:'cpu',chat:true,images:true,tools:false}};
  const off={localModels:[qwen]},on={localModels:[{...qwen,trial:{...qwen.trial,business:true}}]};
  assert.equal(qwenReportSignature(off),'1:0');assert.equal(qwenReportSignature(on),'1:1');
  const tracker=createQwenReportTracker();await tracker.publish(qwenReportSignature(off),async()=>{});assert.equal(tracker.needsReport(qwenReportSignature(on)),true);
  await assert.rejects(tracker.publish(qwenReportSignature(on),async()=>{throw Error('offline')}));assert.equal(tracker.needsReport(qwenReportSignature(on)),true);
  await tracker.publish(qwenReportSignature(on),async()=>{});assert.equal(tracker.needsReport(qwenReportSignature(on)),false);
  const busy={localModels:[{...qwen,enabled:false,errorCode:'community-runtime-ownership-unconfirmed',trial:{...qwen.trial,business:true}}]};
  assert.equal(qwenReportSignature(busy,'task-1'),'1:0');assert.equal(tracker.needsReport(qwenReportSignature(busy,'task-1')),true);
});

test('missing business artifacts fail before a model lease or Python process is opened',async()=>{
 let called=false;const {createPromptAssistant}=await import('../worker/src/prompt-assistant.mjs');
 const assistant=createPromptAssistant({qwenBusinessBridge:true,pythonPath:'D:/missing/python.exe',serviceScript:'D:/missing/prompt-assistant-service.py',qwenSession:{withSession:async()=>{called=true;}}});
 const result=await assistant.optimizePrompt({...pick,prompt:'safe sample'});assert.equal(result.ok,false);assert.equal(result.errorCode,'qwen-business-unavailable');assert.equal(called,false);await assistant.stop();
});

test('real worker model reporting distinguishes chat-only and opted-in business nodes',async()=>{
  const {createWorker}=await import('../worker/src/worker-core.mjs');let enabled=true,business=false,verified=true;
  const worker=createWorker({controlUrl:'http://127.0.0.1:9',dataDir:'.',workflowDir:'.',configPath:'fixture',logger:()=>{},
    promptAssistant:{status:()=>({enabled:true,localModels:[{id,enabled,configured:true,identityVerified:verified,trial:{backend:'cpu',chat:true,images:true,tools:false,business}}]})}});
  let models=await worker.reportModels();assert.equal(models.find(m=>m.model_id===id).status,'ready');assert.equal(models.find(m=>m.model_id===capability).status,'missing');
  business=true;models=await worker.reportModels();assert.equal(models.find(m=>m.model_id===capability).status,'ready');
  verified=false;models=await worker.reportModels();assert.equal(models.find(m=>m.model_id===capability).status,'missing');
  verified=true;enabled=false;models=await worker.reportModels();assert.equal(models.find(m=>m.model_id===capability).status,'missing');
});

test('real control-plane handler does not schedule business on a chat-only worker',async()=>{
  const {createControlPlane}=await import('../packages/shared/src/control-plane.mjs');const {createHmac}=await import('node:crypto');
  const secret='fixture-session-secret',encoded=Buffer.from(JSON.stringify({sub:'u',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const headers={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')};let businessOnline=false;const created=[];
  const store={getUserById:async()=>({id:'u',plan:'pro',status:'active'}),countCapableWorkers:async(model)=>model===capability ? Number(businessOnline) : model===id || model==='prompt-assistant'?1:0,
    createTask:async task=>{created.push(task);return {id:'test-task',...task,input_manifest:task.inputManifest,model_id:task.modelId,task_type:task.taskType}}};
  const plane=createControlPlane({store,secrets:{sessionSecret:secret}}),body={task_type:'prompt_assistant',parameters:{action:'describe-art-style',assistant_model_id:id},references:refs};
  let res=await plane.handle({method:'POST',path:'/api/web/tasks',headers,body});assert.equal(res.status,409);assert.equal(created.length,0);
  businessOnline=true;res=await plane.handle({method:'POST',path:'/api/web/tasks',headers,body});assert.equal(res.status,200);assert.equal(created[0].modelId,capability);assert.equal(created[0].inputManifest.min_vram_mb,0);
});

test('business capability requires exact packaged Python bridge artifacts, not merely old files',async()=>{
 const {createPromptAssistant}=await import('../worker/src/prompt-assistant.mjs');const {mkdtemp,mkdir,copyFile,readFile,writeFile,appendFile,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const {fileURLToPath}=await import('node:url');
 const dir=await mkdtemp(join(tmpdir(),'foart-bridge-check-'));const service=join(dir,'prompt-assistant-service.py'),adapter=join(dir,'prompt_assistant','flash_adapter.py');await mkdir(join(dir,'prompt_assistant'));
 await copyFile(fileURLToPath(new URL('../../particle-editor-desktop/prompt-assistant-service.py',import.meta.url)),service);
 await copyFile(fileURLToPath(new URL('../../particle-editor-desktop/prompt_assistant/flash_adapter.py',import.meta.url)),adapter);
 const modules=['__init__.py','h3_prompt_enhance.py','art_prompt_contract.py','qwen3_vl_adapter.py','qwen21_prompt_policy.py','pe_adapter.py','visual_contract.py'];
 for(const name of modules)await copyFile(fileURLToPath(new URL('../../particle-editor-desktop/prompt_assistant/'+name,import.meta.url)),join(dir,'prompt_assistant',name));
 const make=()=>createPromptAssistant({qwenBusinessBridge:true,communityCpuTrialForDevelopment:true,worker:{getState:()=>({currentTaskId:null})},pythonPath:process.execPath,serviceScript:service,qwenSession:{withSession:async()=>{throw Error('must not start')}}});
 try {const assistant=make(),model=()=>assistant.status().localModels.find(row=>row.id===id);assert.equal(model().trial.business,true);
   for(const name of modules){const path=join(dir,'prompt_assistant',name);await rm(path);assert.equal(model().trial.business,undefined,`missing ${name}`);
     await copyFile(fileURLToPath(new URL('../../particle-editor-desktop/prompt_assistant/'+name,import.meta.url)),path);assert.equal(model().trial.business,true);}
   // Convert bytes through latin1 so every non-newline byte, including BOM, is preserved.
   const lf=bytes=>Buffer.from(bytes.toString('latin1').replace(/\r\n/g,'\n'),'latin1');
   const crlf=bytes=>Buffer.from(lf(bytes).toString('latin1').replace(/\n/g,'\r\n'),'latin1');
   const originalService=await readFile(service),originalAdapter=await readFile(adapter);
   for(const serviceForm of [lf,crlf])for(const adapterForm of [lf,crlf]){
     await writeFile(service,serviceForm(originalService));await writeFile(adapter,adapterForm(originalAdapter));
     assert.equal(model().trial.business,true,'LF and CRLF variants must have the same verified capability');
   }
   await appendFile(adapter,'\n# changed artifact\n');assert.equal(model().trial.business,undefined,'adapter content change must fail');
   await writeFile(adapter,originalAdapter);await appendFile(service,'\n# changed artifact\n');assert.equal(model().trial.business,undefined,'service content change must fail');
   await writeFile(service,originalService);
   const alteredBOM=originalService.subarray(3);await writeFile(service,alteredBOM);assert.equal(model().trial.business,undefined,'BOM change must fail');
   await writeFile(service,originalService);
   const loneCR=Buffer.from(lf(originalAdapter).toString('latin1').replace('\n','\r'),'latin1');await writeFile(adapter,loneCR);
   assert.equal(model().trial.business,undefined,'lone CR is not a permitted normalization');await assistant.stop();
 } finally {await rm(dir,{recursive:true,force:true});}
});


test('compute startup explicitly binds bridge switch and package includes bridge artifacts',async()=>{
  const {computePromptAssistantOptions}=await import('../worker/src/compute-assistant.mjs');
  const {readFile}=await import('node:fs/promises');
  const node={}, urls=[];
  assert.equal(computePromptAssistantOptions({promptAssistant:{qwenBusinessBridge:true}},node,urls).qwenBusinessBridge,false);
  assert.equal(computePromptAssistantOptions({enableQwenBusinessBridge:true},node,urls).qwenBusinessBridge,true);
  assert.equal(computePromptAssistantOptions({enableQwenBusinessBridge:'true'},node,urls).qwenBusinessBridge,false);
  const config=JSON.parse(await readFile(new URL('../worker/electron-builder-compute.json',import.meta.url),'utf8'));
  assert.ok(config.files.includes('src/**/*'));assert.ok(!config.files.includes('!src/qwen-private-inference-bridge.mjs'));
  const resource=config.extraResources.find(item=>item.from==='../../particle-editor-desktop');
  assert.ok(resource);assert.ok(resource.filter.includes('prompt-assistant-service.py'));assert.ok(resource.filter.includes('prompt_assistant/*.py'));
  const entry=await readFile(new URL('../worker/src/compute-assistant.mjs',import.meta.url),'utf8');
  assert.match(entry,/createPromptAssistant\(computePromptAssistantOptions\(options, worker, comfyUrls\)\)/);
});
