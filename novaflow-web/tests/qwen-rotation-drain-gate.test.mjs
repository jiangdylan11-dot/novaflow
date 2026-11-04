import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createControlPlane } from '../packages/shared/src/control-plane.mjs';
import { base64UrlJson, issueWorkerToken } from '../packages/shared/src/tokens.mjs';

const controlSecret='test-control-secret', sessionSecret='test-session-secret';
const workerId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const sessionId='33333333-3333-4333-8333-333333333333',taskId='fa047a0a-1111-8111-8111-111111111111';
const requestId='44444444-4444-4444-8444-444444444444';

async function fixture() {
  const exp=Math.floor(Date.now()/1000)+300, worker={id:workerId,owner_id:userId,endpoint_url:'http://127.0.0.1:8790'};
  const task={id:taskId,user_id:userId,status:'queued',assigned_worker_id:null,attempt_count:0,
    task_type:'prompt_assistant',model_id:'qwen3.5-9b-heretic-foart-rotation-candidate-v1',
    input_manifest:{target_worker_id:workerId,parameters:{action:'art-agent-chat',assistant_tool_scope:'qwen-foart-rotation-candidate-v1'},
      candidate_lease:{actor_user_id:userId,owner_worker_id:workerId,session_id:sessionId,session_expires_epoch:String(exp)}}};
  let released=()=>{}; let started=()=>{};
  const entered=new Promise(r=>{started=r;}), continueCreate=new Promise(r=>{released=r;});
  let waitForCreate=false, createCount=0, revoked=false;
  const store={
    getWorkerById:async id=>id===workerId?worker:null,
    getUserById:async id=>id===userId?{id,status:'active'}:null,
    getUserSession:async id=>id===sessionId?{id,user_id:userId,revoked_at:revoked?'2026-01-01T00:00:00Z':null}:null,
    getTask:async id=>id===taskId?task:null,
    createQwenRotationCandidate:async()=>{createCount++;started();if(waitForCreate) await continueCreate;return {task_id:taskId,replayed:false};},
    listQwenRotationCandidates:async()=>[{id:taskId}],
    claimQwenRotationCandidate:async()=>{task.status='assigned';task.assigned_worker_id=workerId;task.attempt_count=1;return task;},
    authorizeQwenRotationLease:async()=>true,
    startQwenRotationCandidate:async()=>true,completeQwenRotationCandidate:async()=>true,
    cancelQwenRotationCandidate:async()=>true
  };
  const plane=(options={})=>createControlPlane({store,secrets:{controlSecret,sessionSecret},qwenRotationVerifyEnabled:true,...options});
  const token=await issueWorkerToken(worker,controlSecret);
  const encoded=base64UrlJson({sub:userId,sid:sessionId,exp});
  const userHeaders={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',sessionSecret).update(encoded).digest('base64url')};
  const workerHeaders={authorization:'Bearer '+token};
  const request=(p,path,body,headers=userHeaders)=>p.handle({method:'POST',path,body,headers});
  const body={requestId,workerId,sha256:'a'.repeat(64),bytes:32};
  return {plane,request,body,task,workerHeaders,userHeaders,entered,release:()=>released(),wait:()=>{waitForCreate=true;},
    revoke:()=>{revoked=true;},count:()=>createCount};
}

test('creation gate defaults closed and only trusted true enables it',async()=>{
  const f=await fixture(),path='/api/web/qwen-rotation/tasks';
  for(const option of [{},{qwenRotationCreateEnabled:'true'},{qwenRotationCreateEnabled:false}]) {
    assert.equal((await f.request(f.plane(option),path,{...f.body,qwenRotationCreateEnabled:true})).status,503);
  }
  assert.equal(f.count(),0);
  assert.equal((await f.request(f.plane({qwenRotationCreateEnabled:true}),path,f.body)).status,200);
  assert.equal(f.count(),1);
  f.revoke();
  assert.notEqual((await f.request(f.plane({qwenRotationCreateEnabled:true}),path,f.body)).status,200);
  assert.equal(f.count(),1);
});

test('closed creation keeps queued claim, trusted phase and user cancellation usable',async()=>{
  const f=await fixture(),p=f.plane(),prefix='/api/worker/tasks/'+taskId+'/qwen-rotation-';
  assert.equal((await f.request(p,'/api/web/qwen-rotation/tasks',f.body)).status,503);
  assert.equal((await f.request(p,'/api/worker/qwen-rotation/claim',{},f.workerHeaders)).status,200);
  assert.equal((await f.request(p,prefix+'start',{attempt:1,sha256:'a'.repeat(64),bytes:32},f.workerHeaders)).status,200);
  assert.equal((await f.request(p,prefix+'complete',{attempt:1,bytes:24},f.workerHeaders)).status,200);
  assert.equal((await f.request(p,'/api/web/tasks/'+taskId+'/qwen-rotation-cancel',{attempt:1})).status,200);
  const proof=await f.request(p,'/api/web/tasks/'+taskId+'/qwen-rotation-proof',{op:'download'});
  assert.equal(proof.status,200);
});

test('switching creation off does not retroactively cancel a request already in flight',async()=>{
  const f=await fixture(),path='/api/web/qwen-rotation/tasks'; f.wait();
  const old=f.request(f.plane({qwenRotationCreateEnabled:true}),path,f.body);
  await f.entered;
  assert.equal((await f.request(f.plane(),path,f.body)).status,503);
  f.release();
  assert.equal((await old).status,200);
  assert.equal(f.count(),1);
});
