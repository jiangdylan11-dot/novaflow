import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createContext,runInContext} from 'node:vm';import {createHash} from 'node:crypto';
const src=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');const begin=src.indexOf('  async function pooledPromptAssistant('),end=src.indexOf('  async function cancelQwenRotationTask(',begin);assert.ok(begin>0&&end>begin);
const taskId='11111111-1111-4111-8111-111111111111',nodeId='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333';
function fixture(){
 const calls=[];let digest='',requestBytes=0,ready=true,current=true,changeLatest=()=>{};const file='qwen21-local-image-edit-result-1.json';
 const result={ok:true,data:{analysisBackend:'qwen-cpu',resourcesReleased:true,generationReady:true,modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},promptContract:'qwen21-native-rewrite-v3',modelPromptPolicy:'qwen21-native-rewrite-v3',translationValidation:'native-edit-and-literals',modelPromptLanguage:'zh',displayPrompt:'在图中增加花朵。',modelPrompt:'在图中增加花朵。',negativePrompt:'水印'},imageEditBinding:{taskId,workerId:nodeId,attempt:1,requestId,requestSha256:''}};
 const bytes=()=>new TextEncoder().encode(JSON.stringify(result));
 const finished=()=>({id:taskId,status:'completed',model_id:'qwen3.5-9b-heretic-qwen21-local-image-edit-v1',parameters:{assistant_tool_scope:'qwen21-local-image-edit-v1',request_id:requestId,request_sha256:digest,request_bytes:requestBytes},assigned_worker_id:nodeId,attempt_count:1,result_expired:false,output_manifest:{files:[{name:file,kind:'json',bytes:bytes().length}]}});
 const ctx={taskMode:()=> 'shared',candidateSecureBase:x=>x,CONFIG:{controlUrl:'https://example.invalid'},computeNode:{id:nodeId},computeNodeEpoch:0,captureFoartSessionGuard:()=>()=>true,pooledPromptRequests:new Map(),pooledConversationNodes:new Map(),tasks:new Map(),taskModes:new Map(),
 QWEN_ROTATION_REQUEST_ID:/^[0-9a-f-]{36}$/i,QWEN_ROTATION_CANDIDATE_ID:/^fa047a0a-/i,NODE_ID:/^[0-9a-f-]{36}$/i,QWEN_IMAGE_EDIT_SCOPE:'qwen21-local-image-edit-v1',QWEN_IMAGE_EDIT_CAPABILITY:'qwen3.5-9b-heretic-qwen21-local-image-edit-v1',QWEN_IMAGE_EDIT_REQUEST_FILE:'qwen21-local-image-edit-request.json',PROMPT_ASSISTANT_TIMEOUT_MS:300000,
 AbortController,AbortSignal,TextEncoder,TextDecoder,Date,Number,Object,Array,JSON,String,Error,encodeURIComponent,qwen21LocalImageEditAvailable:()=>ready,
 qwenImageEditLanguage:()=> 'zh',qwenCandidatePayloadDigest:async value=>{digest=createHash('sha256').update(value).digest('hex');requestBytes=value.byteLength;result.imageEditBinding.requestSha256=digest;return digest;},
 api:async(_base,_method,path)=>{calls.push({path});return {features:{qwen21LocalImageEdit:ready,qwen21LocalImageEditOwnerLeaseBound:ready},taskTypes:[]};},
 control:async(method,path,body)=>{calls.push({method,path,body});if(method==='POST'&&path==='/api/web/tasks')return {ok:true,task:{id:taskId,status:'queued',assigned_worker_id:null,attempt_count:0}};if(method==='GET'){const task=finished();changeLatest(task);return {task};}throw Error('unexpected '+path);},
 putTaskInput:async(id,name,payload,_wait,options)=>{calls.push({upload:id,name,payload,options});return {id,assigned_worker_id:nodeId,attempt_count:1};},waitForTaskEnd:async()=>finished(),
 fetchTaskOutput:async(task,name,options)=>{calls.push({download:task.id,name,options});return bytes();}};
 createContext(ctx);runInContext(src.slice(begin,end)+'\nglobalThis.run=pooledPromptAssistant;',ctx);
 const payload={requestId,mode:'image-edit',images:[{role:'subject',dataUrl:'data:image/png;base64,aGVsbG8='}],currentPrompt:'增加花朵',requirements:'柔和一点',negativePrompt:'水印',promptContract:'qwen21-native-rewrite-v3'};
 return {ctx,calls,result,payload,run:()=>ctx.run('optimize-prompt',payload,{qwenImageEdit:true,isCurrent:()=>current}),disable:()=>{ready=false;},stale:()=>{current=false;},alterLatest:fn=>{changeLatest=fn;}};
}
test('single image request uses owner-bound scope, exact bytes and attempt-bound result',async()=>{const f=fixture(),result=await f.run();assert.equal(result.ok,true);const req=f.calls.find(x=>x.path==='/api/web/tasks').body,upload=f.calls.find(x=>x.upload);assert.equal(req.target_worker_id,nodeId);assert.equal(req.parameters.assistant_tool_scope,'qwen21-local-image-edit-v1');assert.equal(req.parameters.request_sha256,createHash('sha256').update(upload.payload).digest('hex'));assert.equal(req.parameters.request_bytes,upload.payload.length);assert.equal(upload.name,'qwen21-local-image-edit-request.json');assert.equal(f.calls.find(x=>x.download).name,'qwen21-local-image-edit-result-1.json');assert.equal(upload.options.qwenPlan,true);});
test('unavailable old node and stale inputs reject before task creation',async()=>{for(const method of ['disable','stale']){const f=fixture();f[method]();await assert.rejects(f.run());assert.equal(f.calls.some(x=>x.path==='/api/web/tasks'&&x.method==='POST'),false);}});
test('missing either server capability or selected node cannot fall back to ordinary task or grant',async()=>{
 for(const features of [{},{qwen21LocalImageEdit:true},{qwen21LocalImageEditOwnerLeaseBound:true}]){
  const f=fixture();f.ctx.api=async()=>({features,taskTypes:[{task_type:'prompt_assistant',available_workers:99}]});
  await assert.rejects(f.run());assert.equal(f.calls.some(x=>x.path==='/api/web/tasks'||x.upload||x.download),false);
 }
 const f=fixture();f.ctx.computeNode=null;await assert.rejects(f.run());assert.equal(f.calls.some(x=>x.path==='/api/web/tasks'||x.upload||x.download),false);
});
test('altered task binding or result identity cannot be applied',async()=>{for(const mutate of [r=>r.imageEditBinding.attempt=2,r=>r.imageEditBinding.workerId='other',r=>r.data.resourcesReleased=false,r=>r.data.negativePrompt='altered',r=>r.data.modelPromptPolicy='fake',r=>r.data.translationValidation='fake',r=>r.data.modelPrompt='different']){const f=fixture();mutate(f.result);await assert.rejects(f.run(),/不匹配/);}});

test('final authoritative task must still match scope, model, input digest and byte count',async()=>{for(const alter of [t=>t.model_id='other',t=>t.parameters.assistant_tool_scope='qwen-foart-plan-v1',t=>t.parameters.request_sha256='b'.repeat(64),t=>t.parameters.request_bytes++,t=>t.parameters.request_id='other']){const f=fixture();f.alterLatest(alter);await assert.rejects(f.run(),/已变化或结果已过期/);}});

test('oversized complete UTF-8 payload is refused before task creation',async()=>{const f=fixture();f.payload.images=[{role:'subject',dataUrl:'data:image/png;base64,'+'A'.repeat(16*1024*1024)}];await assert.rejects(f.run(),/超过 16 MiB/);assert.equal(f.calls.some(x=>x.path==='/api/web/tasks'&&x.method==='POST'),false);});
test('ordered multi-reference bytes and roles are exactly what the digest binds',async()=>{
 const f=fixture();f.payload.images=[{role:'style',dataUrl:'data:image/png;base64,YQ=='},{role:'subject',dataUrl:'data:image/png;base64,Yg=='},{role:'style',dataUrl:'data:image/png;base64,Yw=='}];
 await f.run();const upload=f.calls.find(x=>x.upload),body=JSON.parse(new TextDecoder().decode(upload.payload)),task=f.calls.find(x=>x.path==='/api/web/tasks').body;
 assert.deepEqual(body.images,f.payload.images);assert.equal(Object.hasOwn(body,'image'),false);assert.equal(task.parameters.request_sha256,createHash('sha256').update(upload.payload).digest('hex'));
});
