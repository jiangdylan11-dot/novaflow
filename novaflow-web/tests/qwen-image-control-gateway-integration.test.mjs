import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from '../worker/src/gateway/gateway.mjs';
import {createQwenFoartPlanOnlineVerifier} from '../worker/src/worker-core.mjs';
import {createControlPlane,validateTaskParameters} from '../packages/shared/src/control-plane.mjs';
import {issueWorkerToken,deriveWorkerGrantKey,verifyGrantToken} from '../packages/shared/src/tokens.mjs';

const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otherId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const workerId='cccccccc-cccc-4ccc-8ccc-cccccccccccc', taskId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sid='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', otherSid='ffffffff-ffff-4fff-8fff-ffffffffffff';
const payload=Buffer.from(JSON.stringify({requestId:'11111111-1111-4111-8111-111111111111',test:'gateway'}));
const requestId='11111111-1111-4111-8111-111111111111', digest=createHash('sha256').update(payload).digest('hex'), bytes=payload.length;
const sessionSecret='fixture-session',controlSecret='fixture-control';
const scope='qwen21-local-image-edit-v1',capability='qwen3.5-9b-heretic-qwen21-local-image-edit-v1';
const refs=[{name:'qwen21-local-image-edit-request.json',kind:'json',bytes}];
const params={action:'optimize-prompt',model_id:'qwen3.5-9b-heretic',assistant_tool_scope:scope,
  request_id:requestId,request_sha256:digest,request_bytes:bytes};
function sessionToken(id=sid,exp=Math.floor(Date.now()/1000)+3600){
 const encoded=Buffer.from(JSON.stringify({sub:userId,sid:id,exp})).toString('base64url');
 return 'nfs_'+encoded+'.'+createHmac('sha256',sessionSecret).update(encoded).digest('base64url');
}
const userHeaders=(id=sid)=>({authorization:'Bearer '+sessionToken(id)});
function fixture(enabled=true){
 const user={id:userId,status:'active',plan:'pro'};
 const worker={id:workerId,owner_id:userId,ownership_generation:'22222222-2222-4222-8222-222222222222',worker_name:'fixture',enabled:true,owner_enabled:true,sharing_enabled:true,sharing_scope:'pool',status:'idle',tier:'standard',endpoint_url:'http://127.0.0.1:4899'};
 const sessions=new Map([[sid,{id:sid,user_id:userId,revoked_at:null}],[otherSid,{id:otherSid,user_id:userId,revoked_at:null}]]);
 let task=null,created=0,markCalls=[];
 const store={getUserById:async id=>id===userId?user:null,getUserSession:async id=>sessions.get(id)||null,
  getWorkerById:async id=>id===workerId?worker:null,countCapableWorkers:async model=>model===capability?1:0,
  verifyQwenImageEditLease:async()=>true,
  createTask:async x=>{created++;task={id:taskId,user_id:x.userId,task_type:x.taskType,model_id:x.modelId,
    input_manifest:x.inputManifest,status:'queued',attempt_count:0,expires_at:x.expiresAt};return task;},
  getTask:async id=>id===taskId?task:null,updateTaskStatus:async x=>{task.status=x.toStatus;
    if(x.detail?.output_manifest)task.output_manifest=x.detail.output_manifest;return task;},
  markCharged:async (...x)=>{markCalls.push(x)},getCreditBalance:async()=>{throw Error('free plan must not read balance')},
 };
 const plane=createControlPlane({store,secrets:{sessionSecret,controlSecret},qwen21LocalImageEditEnabled:enabled});
 const call=(method,path,headers=userHeaders(),body={})=>plane.handle({method,path,headers,body});
 const create=()=>call('POST','/api/web/tasks',userHeaders(),{task_type:'prompt_assistant',target_worker_id:workerId,parameters:params,references:refs});
 const assign=()=>{task.status='assigned';task.assigned_worker_id=workerId;task.attempt_count=1;};
 return {user,worker,sessions,store,plane,call,create,assign,get task(){return task},get created(){return created},markCalls};
}
const tokenFor=async f=>({authorization:'Bearer '+await issueWorkerToken(f.worker,controlSecret)});
const verify=(f,h,body)=>f.call('POST',`/api/worker/tasks/${taskId}/qwen-foart-plan-verify`,h,body);

test('gateway calls real worker verifier and control plane for scoped upload and download',async()=>{
 const f=fixture();assert.equal((await f.create()).status,200);f.assign();
 const workerToken=await issueWorkerToken(f.worker,controlSecret),key=await deriveWorkerGrantKey(workerId,controlSecret);
 const verifier=createQwenFoartPlanOnlineVerifier({getWorkerToken:()=>workerToken,getWorkerId:()=>workerId,callControl:async(method,path,options)=>{
   const r=await f.call(method,path,{authorization:'Bearer '+options.token},options.body);if(r.status!==200)throw Object.assign(Error('control denied'),{status:r.status});return r.body;}});
 const root=await mkdtemp(join(tmpdir(),'qwen-image-control-gateway-'));const gateway=createGateway({workerId,dataDir:root,getGrantKey:async()=>key,verifyQwenFoartPlanAccess:verifier});
 const port=await gateway.listen(0,'127.0.0.1'),path=(kind,name)=>`http://127.0.0.1:${port}/gw/tasks/${taskId}/${kind}/${name}`;
 try {
   const grant=(await f.call('POST',`/api/web/tasks/${taskId}/grant`,userHeaders(),{op:'upload',attempt:1}));assert.equal(grant.status,200);
   const upload=await fetch(path('input','qwen21-local-image-edit-request.json'),{method:'PUT',headers:{'x-novaflow-grant':grant.body.grant.token,'content-type':'application/json'},body:payload});assert.equal(upload.status,200,await upload.text());
   f.task.status='completed';f.task.result_expired=false;await mkdir(join(root,'tasks',taskId,'output'),{recursive:true});await writeFile(join(root,'tasks',taskId,'output','qwen21-local-image-edit-result-1.json'),'{}');
   const download=await f.call('POST',`/api/web/tasks/${taskId}/grant`,userHeaders(),{op:'download',attempt:1});assert.equal(download.status,200);
   let result=await fetch(path('output','qwen21-local-image-edit-result-1.json'),{headers:{'x-novaflow-grant':download.body.grant.token}});assert.equal(result.status,200);
   f.sessions.get(sid).revoked_at=new Date().toISOString();result=await fetch(path('output','qwen21-local-image-edit-result-1.json'),{headers:{'x-novaflow-grant':download.body.grant.token}});assert.equal(result.status,403);
 } finally {await gateway.close();await rm(root,{recursive:true,force:true});}
});
