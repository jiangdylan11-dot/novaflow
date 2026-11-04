import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createControlPlane,validateTaskParameters} from '../packages/shared/src/control-plane.mjs';
import {issueWorkerToken,deriveWorkerGrantKey,verifyGrantToken} from '../packages/shared/src/tokens.mjs';

const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otherId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const workerId='cccccccc-cccc-4ccc-8ccc-cccccccccccc', taskId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sid='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', otherSid='ffffffff-ffff-4fff-8fff-ffffffffffff';
const requestId='11111111-1111-4111-8111-111111111111', digest='a'.repeat(64), bytes=42;
const sessionSecret='fixture-session',controlSecret='fixture-control';
const scope='qwen-foart-plan-v1',capability='qwen3.5-9b-heretic-foart-plan-v1';
const refs=[{name:'qwen-foart-plan-request.json',kind:'json',bytes}];
const params={action:'art-agent-chat',model_id:'qwen3.5-9b-heretic',assistant_tool_scope:scope,
  request_id:requestId,request_sha256:digest,request_bytes:bytes};
function sessionToken(id=sid,exp=Math.floor(Date.now()/1000)+3600){
 const encoded=Buffer.from(JSON.stringify({sub:userId,sid:id,exp})).toString('base64url');
 return 'nfs_'+encoded+'.'+createHmac('sha256',sessionSecret).update(encoded).digest('base64url');
}
const userHeaders=(id=sid)=>({authorization:'Bearer '+sessionToken(id)});
function fixture(enabled=true){
 const user={id:userId,status:'active',plan:'pro'};
 const worker={id:workerId,owner_id:userId,worker_name:'fixture',enabled:true,owner_enabled:true,sharing_enabled:true,sharing_scope:'pool',status:'idle',tier:'standard',endpoint_url:'http://127.0.0.1:4899'};
 const sessions=new Map([[sid,{id:sid,user_id:userId,revoked_at:null}],[otherSid,{id:otherSid,user_id:userId,revoked_at:null}]]);
 let task=null,created=0,markCalls=[];
 const store={getUserById:async id=>id===userId?user:null,getUserSession:async id=>sessions.get(id)||null,
  getWorkerById:async id=>id===workerId?worker:null,countCapableWorkers:async model=>model===capability?1:0,
  createTask:async x=>{created++;task={id:taskId,user_id:x.userId,task_type:x.taskType,model_id:x.modelId,
    input_manifest:x.inputManifest,status:'queued',attempt_count:0,expires_at:x.expiresAt};return task;},
  getTask:async id=>id===taskId?task:null,updateTaskStatus:async x=>{task.status=x.toStatus;
    if(x.detail?.output_manifest)task.output_manifest=x.detail.output_manifest;return task;},
  markCharged:async (...x)=>{markCalls.push(x)},getCreditBalance:async()=>{throw Error('free plan must not read balance')},
 };
 const plane=createControlPlane({store,secrets:{sessionSecret,controlSecret},qwenPlanEnabled:enabled});
 const call=(method,path,headers=userHeaders(),body={})=>plane.handle({method,path,headers,body});
 const create=()=>call('POST','/api/web/tasks',userHeaders(),{task_type:'prompt_assistant',target_worker_id:workerId,parameters:params,references:refs});
 const assign=()=>{task.status='assigned';task.assigned_worker_id=workerId;task.attempt_count=1;};
 return {user,worker,sessions,store,plane,call,create,assign,get task(){return task},get created(){return created},markCalls};
}
const tokenFor=async f=>({authorization:'Bearer '+await issueWorkerToken(f.worker,controlSecret)});
const verify=(f,h,body)=>f.call('POST',`/api/worker/tasks/${taskId}/qwen-foart-plan-verify`,h,body);

test('scope disabled and malformed inputs fail closed without creating work',async()=>{
 const f=fixture(false),r=await f.create();assert.equal(r.status,503);assert.equal(f.created,0);
 assert.throws(()=>validateTaskParameters('prompt_assistant',{...params,request_sha256:'bad',references:refs}));
 assert.throws(()=>validateTaskParameters('prompt_assistant',{...params,assistantToolScope:scope,references:refs}));
 assert.throws(()=>validateTaskParameters('prompt_assistant',{...params,references:[{name:'request.json',kind:'json',bytes}]}));
});

test('creation requires an enabled owner node and binds only server-verified session',async()=>{
 const f=fixture();f.worker.owner_id=otherId;
 assert.equal((await f.create()).status,403);assert.equal(f.created,0);
 f.worker.owner_id=userId;f.worker.owner_enabled=false;
 assert.equal((await f.create()).status,403);assert.equal(f.created,0);
 f.worker.owner_enabled=true;const r=await f.create();assert.equal(r.status,200);assert.equal(f.created,1);
 assert.equal(f.task.model_id,capability);assert.equal(f.task.input_manifest.qwen_foart_plan.user_id,userId);
 assert.equal(f.task.input_manifest.qwen_foart_plan.session_id,sid);assert.equal(f.task.input_manifest.qwen_foart_plan.request_sha256,digest);
 assert.equal(JSON.stringify(r.body.task).includes(sid),false);
});

test('only original live session obtains a scoped current-attempt grant',async()=>{
 const f=fixture();await f.create();f.assign();
 const path=`/api/web/tasks/${taskId}/grant`,r=await f.call('POST',path,userHeaders(),{op:'upload',attempt:1});
 assert.equal(r.status,200);const key=await deriveWorkerGrantKey(workerId,controlSecret);
 const grant=await verifyGrantToken(r.body.grant.token,key,{taskId,workerId,op:'upload'});
 assert.equal(grant.scope,scope);assert.equal(grant.attempt,1);assert.ok(grant.exp-grant.iat<=60);
 assert.equal((await f.call('POST',path,userHeaders(otherSid),{op:'upload',attempt:1})).status,403);
 assert.equal((await f.call('POST',path,userHeaders(),{op:'upload',attempt:2})).status,400);
 f.sessions.get(sid).revoked_at=new Date().toISOString();
 assert.equal((await f.call('POST',path,userHeaders(),{op:'upload',attempt:1})).status,401);
});

test('online transfer and execution verification denies stale state, hash, session and node',async()=>{
 const f=fixture();await f.create();f.assign();const h=await tokenFor(f);
 const start=await verify(f,h,{op:'upload',phase:'start'});assert.equal(start.status,200);assert.equal(start.body.attempt,1);
 assert.equal(start.body.scope,scope);assert.equal(start.body.sessionId,sid);
 const finish={op:'upload',phase:'finish',attempt:1,sha256:digest,bytes};
 assert.equal((await verify(f,h,finish)).status,200);
 assert.equal((await verify(f,h,{...finish,sha256:'b'.repeat(64)})).status,403);
 assert.equal((await verify(f,h,{...finish,attempt:2})).status,403);
 f.task.status='cancelled';assert.equal((await verify(f,h,finish)).status,403);
 f.task.status='assigned';f.sessions.get(sid).revoked_at='2026-01-01';assert.equal((await verify(f,h,finish)).status,403);
 f.sessions.get(sid).revoked_at=null;f.worker.owner_id=otherId;assert.equal((await verify(f,h,finish)).status,403);
});

test('completed result and user fetch require the matching attempt and original session',async()=>{
 const f=fixture();await f.create();f.assign();f.task.status='processing';const h=await tokenFor(f);
 const p=`/api/worker/tasks/${taskId}/complete`,output={name:'qwen-foart-plan-result-1.json',kind:'json',bytes:30};
 assert.equal((await f.call('POST',p,h,{attempt:2,prompt_id:'p',outputs:[output]})).status,403);
 assert.equal((await f.call('POST',p,h,{attempt:1,prompt_id:'p',outputs:[{...output,name:'result.json'}]})).status,403);
 assert.equal((await f.call('POST',p,h,{attempt:1,prompt_id:'p',outputs:[output]})).status,200);
 assert.equal(f.markCalls.length,1);
 assert.equal((await f.call('GET',`/api/web/tasks/${taskId}`,userHeaders())).status,200);
 assert.equal((await f.call('GET',`/api/web/tasks/${taskId}`,userHeaders(otherSid))).status,403);
 assert.equal((await verify(f,h,{op:'download',phase:'start',attempt:1})).status,200);
 f.task.result_expired=true;assert.equal((await verify(f,h,{op:'download',phase:'start',attempt:1})).status,403);
});

test('expired or invalid plan deadline denies user and worker access before the sweeper runs',async()=>{
 for(const status of ['assigned','completed']) for(const expiry of [null,'not-a-date',new Date(Date.now()-1000).toISOString()]){
  const f=fixture();await f.create();f.assign();f.task.status=status;f.task.expires_at=expiry;const h=await tokenFor(f);
  const op=status==='assigned'?'upload':'download';
  assert.equal((await f.call('GET',`/api/web/tasks/${taskId}`,userHeaders())).status,403,`${status} ${expiry} GET`);
  assert.equal((await f.call('POST',`/api/web/tasks/${taskId}/grant`,userHeaders(),{op,attempt:1})).status,403,`${status} ${expiry} grant`);
  assert.equal((await verify(f,h,{op,phase:'start',attempt:1})).status,403,`${status} ${expiry} worker`);
  assert.equal(f.task.status,status);
 }
});

test('deadline is checked again after asynchronous authorization reads',async()=>{
 const f=fixture();await f.create();f.assign();const h=await tokenFor(f),old=f.store.getUserSession;
 f.store.getUserSession=async id=>{const session=await old(id);f.task.expires_at=new Date(Date.now()-1000).toISOString();return session;};
 assert.equal((await verify(f,h,{op:'upload',phase:'start',attempt:1})).status,403);
});
