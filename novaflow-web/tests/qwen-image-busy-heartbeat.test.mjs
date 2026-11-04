import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID,webcrypto} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createContext,runInContext} from 'node:vm';
import {createWorker} from '../worker/src/worker-core.mjs';
import {createControlPlane} from '../packages/shared/src/control-plane.mjs';
import {createDomSandbox} from '../worker/src/comfy/dom-shim.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',taskId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',generation='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const scope='qwen21-local-image-edit-v1',capability='qwen3.5-9b-heretic-qwen21-local-image-edit-v1';

test('active owned model remains ready across real worker heartbeat, control capability and webpage refresh',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-image-busy-')),oldFetch=globalThis.fetch,started=deferred(),finish=deferred(),verifying=deferred(),finishVerification=deferred(),waitVerified=deferred(),completing=deferred(),finishCompletion=deferred();
 const request={requestId,mode:'image-edit',images:[{role:'subject',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg=='}],currentPrompt:'把外套改为红色',requirements:'',negativePrompt:'',promptContract:'qwen21-native-rewrite-v3'};
 const bytes=Buffer.from(JSON.stringify(request)),sha=createHash('sha256').update(bytes).digest('hex');let worker,modelRows=[],status='idle',pendingTask=null;
 const identity={id:'qwen35-heretic',verification:'server-weight-path'},policy={enabled:true,owner_enabled:true,sharing_enabled:false,sharing_scope:'pool',allowed_user_ids:[]};
 const assistant={status(){const busy=worker?.getState().currentTaskId===taskId,owned=worker?.verifiedQwenTaskId?.()===taskId;return {qwenBusinessBridgeEnabled:true,qwen21NativeRewriteV3Enabled:true,qwenImageEditEnabled:true,
   ...(owned?{qwenOwnedTaskId:taskId}:{}),localModels:[{id:'qwen3.5-9b-heretic',configured:true,identityVerified:true,enabled:!busy,
     ...(busy?{errorCode:'community-runtime-ownership-unconfirmed'}:{}),trial:{backend:'cpu',chat:true,images:true,tools:false,business:true}}]};},
   async runForTask(id,method,_request,ctx){assert.equal(method,'qwenImageEdit');assert.equal(await ctx.imageEditPhaseVerifier(ctx.imageEditActor,'before'),true);started.resolve();await finish.promise;
     assert.equal(await ctx.imageEditPhaseVerifier(ctx.imageEditActor,'after'),true);return {ok:true,data:{analysisBackend:'qwen-cpu',modelIdentity:identity,resourcesReleased:true,generationReady:true,
       displayPrompt:'把外套改成红色，保留其他内容。',modelPrompt:'把外套改成红色，保留其他内容。',negativePrompt:'',modelPromptLanguage:'zh',promptContract:'qwen21-native-rewrite-v3',modelPromptPolicy:'qwen21-native-rewrite-v3',translationValidation:'native-edit-and-literals'}};}};
 globalThis.fetch=async(input,init={})=>{const url=new URL(String(input)),body=init.body?JSON.parse(init.body):{};
   if(url.port==='19091')return response(url.pathname==='/queue'?{queue_running:[],queue_pending:[]}:{system:{comfyui_version:'fixture'}});
   if(url.port!=='19092')throw Error('unexpected URL');
   if(url.pathname==='/api/worker/register')return response({workerToken:'fixture',grantKey:'fixture',policy,worker:{}});
   if(url.pathname==='/api/worker/models'){modelRows=body.models;return response({ok:true});}
   if(url.pathname==='/api/worker/heartbeat'){status=body.status;return response({policy,worker:{}});}
   if(url.pathname==='/api/worker/claim'){const task=pendingTask;pendingTask=null;return response({task});}
   if(url.pathname.endsWith('/qwen-foart-plan-verify')){if(body.op==='wait'){verifying.resolve();await finishVerification.promise;waitVerified.resolve();}return response({authorized:true,taskId,workerId:worker.identity.workerId,userId,sessionId:sid,scope,attempt:1,op:body.op,
     ...(body.op==='upload'&&body.phase==='finish'?{digestBound:true,sha256:body.sha256,bytes:body.bytes}:{})});
   }
   if(url.pathname.endsWith('/progress'))return response({ok:true,task:{id:taskId,status:body.status,assigned_worker_id:worker.identity.workerId,attempt_count:1}});
   if(url.pathname.endsWith('/complete')){completing.resolve();await finishCompletion.promise;return response({ok:true,task:{id:taskId,status:'completed',assigned_worker_id:worker.identity.workerId,attempt_count:1}});}
   return response({ok:true});};
 worker=createWorker({controlUrl:'http://127.0.0.1:19092',comfyImageUrl:'http://127.0.0.1:19091',dataDir:root,configPath:join(root,'identity.json'),workflowDir:root,
   rendererDir:root,gatewayPort:0,gatewayHost:'127.0.0.1',publicEndpoint:'http://127.0.0.1:19093',tunnel:false,registrationProfile:'compute-only',localTasks:null,
   pollIntervalMs:3600000,heartbeatIntervalMs:3600000,qwenImageEditEnabled:true,promptAssistant:()=>assistant,logger:()=>{}});
 const secret='fixture-secret',encoded=Buffer.from(JSON.stringify({sub:userId,sid,exp:Math.floor(Date.now()/1000)+600})).toString('base64url');
 const token='nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url');
 const store={getUserById:async()=>({id:userId,status:'active',plan:'pro'}),getUserSession:async()=>({id:sid,user_id:userId,revoked_at:null}),
   getWorkerById:async id=>({id,owner_id:userId,ownership_generation:generation,...policy}),countCapableWorkers:async(model,_v,_h,target)=>
     target===worker.identity.workerId&&['idle','busy'].includes(status)&&modelRows.some(row=>row.model_id===model&&row.status==='ready')?1:0};
 const plane=createControlPlane({store,secrets:{sessionSecret:secret},qwen21LocalImageEditEnabled:true});
 try{
   await worker.startSharing();worker.setComputeReady(true);await worker.reportModels();await worker.heartbeat();
   const nodeId=worker.identity.workerId;
   class CE{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
   const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
   const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,crypto:webcrypto,CustomEvent:CE,
     NOVAFLOW_WEB_CONFIG:{controlUrl:'https://control.test',xiaotaoQwenBusinessEnabled:true},fetch:async url=>{
       const u=new URL(String(url));const r=await plane.handle({method:'GET',path:u.pathname,query:Object.fromEntries(u.searchParams),headers:{authorization:'Bearer '+token}});return Response.json(r.body,{status:r.status});}});
   sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token}));sandbox.NovaFlowClientAuth={hasPersistedSessionIdentity:()=>true};
   runInContext(source,createContext(sandbox));await tick();sandbox.NovaFlowWebRuntime.setComputeNode({id:nodeId});await tick();await sandbox.electronAPI.runtimeFeatures();
   const imageDir=join(root,'tasks',taskId,'input');await mkdir(imageDir,{recursive:true});
   pendingTask={id:taskId,task_type:'prompt_assistant',model_id:capability,attempt_count:1,parameters:{action:'optimize-prompt',model_id:'qwen3.5-9b-heretic',assistant_tool_scope:scope,
     request_id:requestId,request_sha256:sha,request_bytes:bytes.length},references:[{name:'qwen21-local-image-edit-request.json',kind:'json',bytes:bytes.length}]};
   const running=worker.claimAndRun();await verifying.promise;await worker.heartbeat();
   assert.equal(modelRows.find(m=>m.model_id===capability).status,'ready','while owner verification is pending');
   await worker.reportModels();assert.equal(modelRows.find(m=>m.model_id===capability).status,'ready','direct report during owner verification');
   await sandbox.electronAPI.runtimeFeatures();assert.equal(sandbox.electronAPI.qwen21LocalImageEditAvailableSync(),true);
   finishVerification.resolve();await waitVerified.promise;await tick();await worker.heartbeat();
   assert.equal(worker.verifiedQwenTaskId(),taskId);assert.equal(modelRows.find(m=>m.model_id===capability).status,'ready','waiting for upload');
   await writeFile(join(imageDir,'qwen21-local-image-edit-request.json'),bytes);await started.promise;await worker.reportModels();await worker.heartbeat();
   assert.equal(status,'busy');assert.equal(modelRows.find(m=>m.model_id===capability).status,'ready');
   const capabilityReply=await plane.handle({method:'GET',path:'/api/web/capabilities',query:{worker:nodeId},headers:{authorization:'Bearer '+token}});
   assert.equal(capabilityReply.body.features.qwen21LocalImageEdit,true);assert.equal(capabilityReply.body.features.qwen35BusinessTrial,true);
   await sandbox.electronAPI.runtimeFeatures();
   assert.equal(sandbox.electronAPI.qwen21LocalImageEditAvailableSync(),true);
   finish.resolve();await completing.promise;await worker.heartbeat();await sandbox.electronAPI.runtimeFeatures();
   assert.equal(modelRows.find(m=>m.model_id===capability).status,'ready','after model release but before completion');
   assert.equal(sandbox.electronAPI.qwen21LocalImageEditAvailableSync(),true);
   finishCompletion.resolve();await running;
 } finally {finishVerification.resolve();finish.resolve();finishCompletion.resolve();await worker.stop().catch(()=>{});globalThis.fetch=oldFetch;await rm(root,{recursive:true,force:true});}
});
