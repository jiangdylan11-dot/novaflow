import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createControlPlane} from '../packages/shared/src/control-plane.mjs';
import {base64UrlJson,issueWorkerToken} from '../packages/shared/src/tokens.mjs';

const controlSecret='synthetic-control-secret',sessionSecret='synthetic-session-secret';
const workerId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const sessionId='33333333-3333-4333-8333-333333333333',taskId='fa047a0a-1111-8111-8111-111111111111';
async function fixture({enabled=true,decision=true}={}) {
 const worker={id:workerId,owner_id:userId}, exp=Math.floor(Date.now()/1000)+300;
 const task={id:taskId,user_id:userId,status:'queued',assigned_worker_id:null,attempt_count:0,
   task_type:'prompt_assistant',model_id:'qwen3.5-9b-heretic-foart-rotation-candidate-v1',
   input_manifest:{target_worker_id:workerId,parameters:{action:'art-agent-chat',assistant_tool_scope:'qwen-foart-rotation-candidate-v1'},
     candidate_lease:{actor_user_id:userId,owner_worker_id:workerId,session_id:sessionId,session_expires_epoch:String(exp)}}};
 const calls=[];const store={getWorkerById:async id=>id===workerId?worker:null,getTask:async id=>id===taskId?task:null,
   getUserById:async id=>id===userId?{id,status:'active'}:null,
   getUserSession:async id=>id===sessionId?{id,user_id:userId,revoked_at:null}:null,
   listQwenRotationCandidates:async arg=>(calls.push(['list',arg]),[{id:taskId}]),
   claimQwenRotationCandidate:async arg=>{calls.push(['claim',arg]);return decision?{...task,status:'assigned',assigned_worker_id:workerId,attempt_count:1}:null;},
   startQwenRotationCandidate:async arg=>(calls.push(['start',arg]),decision),
   completeQwenRotationCandidate:async arg=>(calls.push(['complete',arg]),decision),
   cancelQwenRotationCandidate:async arg=>(calls.push(['cancel',arg]),decision)};
 const plane=createControlPlane({store,secrets:{controlSecret,sessionSecret},qwenRotationVerifyEnabled:enabled});
 const token=await issueWorkerToken(worker,controlSecret), workerHeaders={authorization:'Bearer '+token};
 const encoded=base64UrlJson({sub:userId,sid:sessionId,exp});
 const userHeaders={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',sessionSecret).update(encoded).digest('base64url')};
 return {task,calls,plane,workerHeaders,userHeaders,request:(path,body,headers=workerHeaders)=>plane.handle({method:'POST',path,body,headers})};
}

test('candidate claim is opt-in and uses server task binding instead of worker actor fields',async()=>{
 const f=await fixture(),r=await f.request('/api/worker/qwen-rotation/claim',{});
 assert.equal(r.status,200);assert.equal(r.body.task.id,taskId);assert.equal(r.body.task.attempt_count,1);
 assert.equal(r.body.task.input_manifest,undefined);assert.equal(JSON.stringify(r.body.task).includes(sessionId),false);
 assert.equal(f.calls[1][1].userId,userId);assert.equal(f.calls[1][1].sessionId,sessionId);
 assert.equal((await f.request('/api/worker/qwen-rotation/claim',{userId})).status,400);
 const closed=await fixture({enabled:false});assert.equal((await closed.request('/api/worker/qwen-rotation/claim',{})).status,503);
 const denied=await fixture({decision:false});assert.equal((await denied.request('/api/worker/qwen-rotation/claim',{})).body.task,null);
});

test('candidate start, complete and cancel only use server-derived actor and expected attempt',async()=>{
 const f=await fixture();f.task.status='assigned';f.task.assigned_worker_id=workerId;f.task.attempt_count=1;
 const prefix='/api/worker/tasks/'+taskId+'/qwen-rotation-';
 assert.equal((await f.request(prefix+'start',{attempt:1,sha256:'a'.repeat(64),bytes:32})).status,200);
 assert.equal((await f.request(prefix+'complete',{attempt:1,bytes:24})).status,200);
 assert.equal(f.calls[0][1].userId,userId);assert.equal(f.calls[0][1].sessionId,sessionId);
 assert.equal((await f.request(prefix+'start',{attempt:2,sha256:'a'.repeat(64),bytes:32})).status,403);
 assert.equal((await f.request(prefix+'start',{attempt:1,sha256:'a'.repeat(64),bytes:32,userId})).status,400);
 assert.equal((await f.request('/api/web/tasks/'+taskId+'/cancel',{},f.userHeaders)).status,403);
 assert.equal((await f.request('/api/web/tasks/'+taskId+'/qwen-rotation-cancel',{attempt:1},f.userHeaders)).status,200);
 const cancel=f.calls.find(x=>x[0]==='cancel')[1];assert.equal(cancel.userId,userId);assert.equal(cancel.sessionId,sessionId);
});
