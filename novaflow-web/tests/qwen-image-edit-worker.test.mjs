import test from 'node:test';
import assert from 'node:assert/strict';
import {createQwenFoartPlanOnlineVerifier,validateQwenImageEditTask,validateQwenImageEditPayload,qwenBusinessAdvertisable,isClaimedQwenTextBusinessTask} from '../worker/src/worker-core.mjs';
import {createPromptAssistant} from '../worker/src/prompt-assistant.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const taskId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const workerId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222',sessionId='33333333-3333-4333-8333-333333333333';
const scope='qwen21-local-image-edit-v1',digest='a'.repeat(64);
const metadata=()=>({id:taskId,task_type:'prompt_assistant',model_id:'qwen3.5-9b-heretic-qwen21-local-image-edit-v1',attempt_count:1,
  parameters:{action:'optimize-prompt',model_id:'qwen3.5-9b-heretic',assistant_tool_scope:scope,request_id:requestId,request_sha256:digest,request_bytes:72},
  references:[{name:'qwen21-local-image-edit-request.json',kind:'json',bytes:72}]});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==';
const payload=()=>({requestId,mode:'image-edit',images:[{role:'subject',dataUrl:png}],currentPrompt:'改成红色',requirements:'',negativePrompt:'模糊',promptContract:'qwen21-native-rewrite-v3'});
test('image-edit task binds one to three valid ordered references and rejects other scopes',()=>{
 assert.equal(validateQwenImageEditTask(metadata()),true);assert.equal(validateQwenImageEditPayload(payload(),requestId),true);
 for(const alter of [t=>t.model_id='qwen3.5-9b-heretic',t=>t.parameters.assistant_tool_scope='qwen-foart-plan-v1',t=>t.attempt_count=0,
   t=>t.parameters.request_sha256='bad',t=>t.parameters.request_bytes=16*1024*1024+1,t=>t.references[0].name='request.json',t=>t.references.push(t.references[0])]){
   const t=metadata();alter(t);assert.throws(()=>validateQwenImageEditTask(t));
 }
 for(const alter of [p=>p.images[0].role='unknown',p=>p.images[0].dataUrl='data:video/mp4;base64,YQ==',p=>p.images=[],p=>p.images.push(...p.images,...p.images,...p.images),p=>p.currentPrompt='__NOVAFLOW_RESOURCE_MENTION_1_0__',p=>p.requestId=taskId]){
   const p=payload();alter(p);assert.throws(()=>validateQwenImageEditPayload(p,requestId));
 }
 const multi=payload();multi.images=[{role:'style',dataUrl:png},{role:'style',dataUrl:png},{role:'reference',dataUrl:png}];assert.equal(validateQwenImageEditPayload(multi,requestId),true);
 const digestOf=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 assert.notEqual(digestOf(multi),digestOf({...multi,images:[multi.images[2],multi.images[1],multi.images[0]]}));
});
test('busy capability is retained only while the actual worker task owns the Qwen lease',()=>{
 const qwen={id:'qwen3.5-9b-heretic',enabled:false,configured:true,identityVerified:true,errorCode:'community-runtime-ownership-unconfirmed',trial:{backend:'cpu',chat:true,images:true,tools:false,business:true}};
 for(const [owned,current,expected] of [[undefined,taskId,false],[taskId,null,false],[taskId,workerId,false],[taskId,taskId,true]])
   assert.equal(qwenBusinessAdvertisable({localModels:[qwen],qwenOwnedTaskId:owned},current),expected);
 assert.equal(qwenBusinessAdvertisable({localModels:[{...qwen,identityVerified:false}],qwenOwnedTaskId:taskId},taskId),false);
});
test('only a server-claimed Qwen text business task may retain readiness before and after its lease',()=>{
 const task={id:taskId,status:'assigned',task_type:'prompt_assistant',model_id:'qwen3.5-9b-heretic-business-v1',
   parameters:{model_id:'qwen3.5-9b-heretic-business-v1',action:'optimize-prompt'},references:[{name:'request.json',kind:'json'}]};
 assert.equal(isClaimedQwenTextBusinessTask(task),true);
 assert.equal(isClaimedQwenTextBusinessTask({...task,parameters:{...task.parameters,action:'rewrite-audio-prompt'}}),true);
 for(const altered of [{status:'queued'},{task_type:'renderer_workflow'},{model_id:'different'},
   {parameters:{...task.parameters,action:'reverse-image-prompt'}},{parameters:{...task.parameters,assistant_tool_scope:scope}},
   {references:[{name:'request.json',kind:'image'}]},{references:[]}])
   assert.equal(isClaimedQwenTextBusinessTask({...task,...altered}),false);
});
test('single-image verifier requires exact task, node, user session, scope, attempt and input digest',async()=>{
 const base={authorized:true,taskId,workerId,userId,sessionId,scope,attempt:1,op:'upload',digestBound:true,sha256:digest,bytes:72};
 const make=result=>createQwenFoartPlanOnlineVerifier({getWorkerToken:()=> 'fixture',getWorkerId:()=>workerId,callControl:async()=>result});
 const request={taskId,workerId,scope,op:'upload',phase:'finish',attempt:1,sha256:digest,bytes:72};
 assert.deepEqual(await make(base)(request),base);
 for(const change of [{scope:'qwen-foart-plan-v1'},{workerId:userId},{sessionId:'bad'},{attempt:2},{digestBound:false},{sha256:'b'.repeat(64)},{bytes:71}])
   await assert.rejects(make({...base,...change})(request));
});

test('image capability stays off until explicit opt-in and the exact image module exists',async()=>{
 const {mkdtemp,mkdir,copyFile,appendFile,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'qwen-image-module-')),moduleDir=join(dir,'prompt_assistant');await mkdir(moduleDir);
 const source=rel=>fileURLToPath(new URL('../../particle-editor-desktop/'+rel,import.meta.url)),service=join(dir,'prompt-assistant-service.py');
 await copyFile(source('prompt-assistant-service.py'),service);
 for(const name of ['flash_adapter.py','qwen21_prompt_policy.py','qwen21_image_edit.py'])await copyFile(source('prompt_assistant/'+name),join(moduleDir,name));
 const make=enabled=>createPromptAssistant({qwenBusinessBridge:true,qwenBusinessReady:()=>true,qwenImageEditEnabled:enabled,pythonPath:process.execPath,serviceScript:service,
   qwenSession:{withSession:async()=>{throw Error('unexpected inference');}}});
 const off=make(false),on=make(true);
 try {assert.equal(off.status().qwenImageEditEnabled,false);assert.equal(on.status().qwenImageEditEnabled,true);
   await appendFile(join(moduleDir,'qwen21_image_edit.py'),'\n# changed\n');assert.equal(on.status().qwenImageEditEnabled,false);assert.equal(on.status().qwen21NativeRewriteV3Enabled,true);
 } finally {await off.stop();await on.stop();await rm(dir,{recursive:true,force:true});}
});

test('owned single-image session sends actual pixels through the Python bridge and revalidates before and after',async()=>{
 const checks=[],inference=[],statuses=[],modelPath=execFileSync('python',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
 const flash={identity:{id:'qwen35-heretic',verification:'server-weight-path',path:modelPath},infer:async()=>{throw Error('must use private bridge');},inferConversation:async input=>{
   inference.push(input);statuses.push(assistant.status());const parts=input.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
   const count=parts.filter(x=>x.type==='image_url').length;
   const output=count===3?'将<image1>和<image2>风格用于<image3>，保留其他内容。':count===2?'将第一张风格用于第二张，保留其他内容。':'把外套改成红色，保留其他内容和原图构图。';
   return {model:'qwen35-heretic',requestId:'fixture-model',finishReason:'stop',message:{role:'assistant',content:JSON.stringify({rewritten_prompt:output})}};
 }};
 const session={withSession:async fn=>({value:await fn(flash),identity:flash.identity,resourcesReleased:true,timing:{callbackMs:1}})};
 const serviceScript=fileURLToPath(new URL('../../particle-editor-desktop/prompt-assistant-service.py',import.meta.url));
 const assistant=createPromptAssistant({worker:{getState:()=>({workerId,currentTaskId:taskId})},pythonPath:modelPath,serviceScript,qwenSession:session,
   communityCpuTrialForDevelopment:true,qwenBusinessBridge:true,qwenBusinessTextOnly:true,qwenImageEditEnabled:true});
 const actor={taskId,workerId,scope,attempt:1};
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==';
 try{
   const result=await assistant.runForTask(taskId,'qwenImageEdit',{...payload(),images:[{role:'subject',dataUrl:image}]},
     {imageEditActor:actor,isCancelled:()=>false,imageEditPhaseVerifier:async(a,phase)=>{checks.push(phase);return a.scope===scope;}});
   assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.resourcesReleased,true);assert.equal(result.data.modelPromptLanguage,'zh');
   assert.equal(result.data.displayPrompt,result.data.modelPrompt);assert.equal(result.data.negativePrompt,'模糊');
   assert.equal(inference.length,1);assert.ok(inference[0].messages.some(m=>Array.isArray(m.content)&&m.content.some(x=>x.type==='image_url' && x.image_url.url.startsWith('data:image/'))));
   assert.ok(checks.includes('before'));assert.ok(checks.includes('after'));
   assert.equal(statuses[0].qwenOwnedTaskId,taskId);assert.equal(statuses[0].localModels.find(m=>m.id==='qwen3.5-9b-heretic').errorCode,'community-runtime-ownership-unconfirmed');
   const blue='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNkYPjPwMDAxAAGAAsfAQMU4wsAAAAAAElFTkSuQmCC';
   const multi=await assistant.runForTask(taskId,'qwenImageEdit',{...payload(),images:[{role:'style',dataUrl:blue},{role:'subject',dataUrl:image}]},
     {imageEditActor:actor,isCancelled:()=>false,imageEditPhaseVerifier:async()=>true});
   assert.equal(multi.ok,true,JSON.stringify(multi));assert.match(multi.data.modelPrompt,/<image1>为风格参考.*<image2>为主体参考/);
   const multiParts=inference.at(-1).messages.flatMap(m=>Array.isArray(m.content)?m.content:[]),pictures=multiParts.filter(x=>x.type==='image_url');
   assert.equal(pictures.length,2);assert.notEqual(pictures[0].image_url.url,pictures[1].image_url.url);
   const triple=await assistant.runForTask(taskId,'qwenImageEdit',{...payload(),images:[{role:'style',dataUrl:blue},{role:'style',dataUrl:image},{role:'reference',dataUrl:blue}]},
     {imageEditActor:actor,isCancelled:()=>false,imageEditPhaseVerifier:async()=>true});
   assert.equal(triple.ok,true,JSON.stringify(triple));assert.match(triple.data.modelPrompt,/<image1>.*<image2>.*<image3>/);
   assert.equal(inference.at(-1).messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(x=>x.type==='image_url').length,3);
   const beforeCount=inference.length;
   const unbound=await assistant.runForTask(taskId,'qwenImageEdit',{...payload(),images:[{role:'subject',dataUrl:image}]},{isCancelled:()=>false});
   assert.equal(unbound.ok,false);assert.equal(inference.length,beforeCount);
   const revoked=await assistant.runForTask(taskId,'qwenImageEdit',{...payload(),images:[{role:'subject',dataUrl:image}]},
     {imageEditActor:actor,isCancelled:()=>false,imageEditPhaseVerifier:async(_a,phase)=>phase!=='after'});
   assert.equal(revoked.ok,false);assert.notEqual(revoked.generationReady,true);
 }finally{await assistant.stop();}
});
