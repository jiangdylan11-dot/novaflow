import test from 'node:test';import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createContext,runInContext} from 'node:vm';
import {createWorker} from '../worker/src/worker-core.mjs';import {createControlPlane} from '../packages/shared/src/control-plane.mjs';
import {createDomSandbox} from '../worker/src/comfy/dom-shim.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r)),response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',taskId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const cap='qwen3.5-9b-heretic-business-v1',policy={enabled:true,owner_enabled:true,sharing_enabled:false,sharing_scope:'pool',allowed_user_ids:[]};

for(const action of ['optimize-prompt','rewrite-audio-prompt'])test(`${action} maintains node capability before, during and after inference`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-text-busy-')),oldFetch=globalThis.fetch,uploading=deferred(),uploadContinue=deferred(),started=deferred(),finish=deferred(),completing=deferred(),finishCompletion=deferred();
 let worker,rows=[],status='idle',pendingTask=null;
 const assistant={status(){const busy=worker?.getState().currentTaskId===taskId,owned=worker?.verifiedQwenTaskId?.()===taskId;return {qwenBusinessBridgeEnabled:true,qwen21NativeRewriteV3Enabled:true,
   ...(owned?{qwenOwnedTaskId:taskId}:{}),localModels:[{id:'qwen3.5-9b-heretic',configured:true,identityVerified:true,enabled:!busy,
     ...(busy?{errorCode:'community-runtime-ownership-unconfirmed'}:{}),trial:{backend:'cpu',chat:true,images:true,tools:false,business:true}}]};},
   async runForTask(){started.resolve();await finish.promise;return {ok:true,prompt:'fixture',resourcesReleased:true};}};
 globalThis.fetch=async(input,init={})=>{const url=new URL(String(input)),body=init.body?JSON.parse(init.body):{};
   if(url.port==='19101')return response(url.pathname==='/queue'?{queue_running:[],queue_pending:[]}:{system:{comfyui_version:'fixture'}});
   if(url.port!=='19102')throw Error('unexpected URL');
   if(url.pathname==='/api/worker/register')return response({workerToken:'fixture',grantKey:'fixture',policy,worker:{}});
   if(url.pathname==='/api/worker/models'){rows=body.models;return response({ok:true});}
   if(url.pathname==='/api/worker/heartbeat'){status=body.status;return response({policy,worker:{}});}
   if(url.pathname==='/api/worker/claim'){const task=pendingTask;pendingTask=null;return response({task});}
   if(url.pathname.endsWith('/progress')&&body.status==='uploading'){uploading.resolve();await uploadContinue.promise;return response({ok:true});}
   if(url.pathname.endsWith('/complete')){completing.resolve();await finishCompletion.promise;return response({ok:true});}
   return response({ok:true});};
 worker=createWorker({controlUrl:'http://127.0.0.1:19102',comfyImageUrl:'http://127.0.0.1:19101',dataDir:root,configPath:join(root,'identity.json'),workflowDir:root,
   rendererDir:root,gatewayPort:0,gatewayHost:'127.0.0.1',publicEndpoint:'http://127.0.0.1:19103',tunnel:false,registrationProfile:'compute-only',localTasks:null,
   pollIntervalMs:3600000,heartbeatIntervalMs:3600000,promptAssistant:()=>assistant,logger:()=>{}});
 const secret='fixture-secret',encoded=Buffer.from(JSON.stringify({sub:uid,sid,exp:Math.floor(Date.now()/1000)+600})).toString('base64url');
 const token='nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url');
 const store={getUserById:async()=>({id:uid,status:'active',plan:'pro'}),getUserSession:async()=>({id:sid,user_id:uid,revoked_at:null}),
   getWorkerById:async id=>({id,owner_id:uid,...policy}),countCapableWorkers:async(model,_v,_h,target)=>
     target===worker.identity.workerId&&['idle','busy'].includes(status)&&rows.some(row=>row.model_id===model&&row.status==='ready')?1:0};
 const plane=createControlPlane({store,secrets:{sessionSecret:secret}});
 try{
   await worker.startSharing();worker.setComputeReady(true);await worker.reportModels();await worker.heartbeat();const nodeId=worker.identity.workerId;
   class CE{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
   const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
   const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,crypto:webcrypto,CustomEvent:CE,
     NOVAFLOW_WEB_CONFIG:{controlUrl:'https://control.test',xiaotaoQwenBusinessEnabled:true},fetch:async url=>{const u=new URL(String(url));
       const r=await plane.handle({method:'GET',path:u.pathname,query:Object.fromEntries(u.searchParams),headers:{authorization:'Bearer '+token}});return Response.json(r.body,{status:r.status});}});
   sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token}));sandbox.NovaFlowClientAuth={hasPersistedSessionIdentity:()=>true};
   runInContext(source,createContext(sandbox));await tick();sandbox.NovaFlowWebRuntime.setComputeNode({id:nodeId});await tick();
   const input=join(root,'tasks',taskId,'input');await mkdir(input,{recursive:true});
   const request={assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic',requestId:'fixture-request',...(action==='optimize-prompt'?{surface:'animation',purpose:'minimax-h3-prompt-enhance',h3Mode:'text_video',prompt:'角色向前走'}:{kind:'sfx',input:'风声',seconds:2})};
   const bytes=Buffer.from(JSON.stringify(request));pendingTask={id:taskId,status:'assigned',task_type:'prompt_assistant',model_id:cap,attempt_count:1,
     parameters:{action,model_id:cap},references:[{name:'request.json',kind:'json',bytes:bytes.length}]};
   const refresh=async(label)=>{await worker.reportModels();await worker.heartbeat();await sandbox.electronAPI.runtimeFeatures();
     assert.equal(rows.find(row=>row.model_id===cap).status,'ready',label);assert.equal(sandbox.electronAPI.qwenBusinessAvailableSync(),true,label);assert.equal(sandbox.electronAPI.qwen21NativeRewriteV3AvailableSync(),true,label);};
   const running=worker.claimAndRun();await uploading.promise;await refresh('before input');await writeFile(join(input,'request.json'),bytes);uploadContinue.resolve();
   await started.promise;await refresh('during inference');finish.resolve();await completing.promise;await refresh('after inference');finishCompletion.resolve();await running;
 }finally{uploadContinue.resolve();finish.resolve();finishCompletion.resolve();await worker.stop().catch(()=>{});globalThis.fetch=oldFetch;await rm(root,{recursive:true,force:true});}
});
