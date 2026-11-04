import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createControlPlane} from '../packages/shared/src/control-plane.mjs';
import {issueQwenRotationProof,issueWorkerToken,deriveWorkerGrantKey,base64UrlJson,hmacSha256} from '../packages/shared/src/tokens.mjs';
import {createQwenCandidateOnlineVerifier,createQwenCandidatePhaseVerifier} from '../worker/src/worker-core.mjs';

const controlSecret='synthetic-control-secret-only';
const sessionSecret='synthetic-session-secret-only';
const worker={id:'11111111-1111-4111-8111-111111111111',owner_id:'22222222-2222-4222-8222-222222222222'};
const actor={taskId:'fa047a0a-1111-8111-8111-111111111111',workerId:worker.id,userId:worker.owner_id,
  sessionId:'33333333-3333-4333-8333-333333333333',attempt:2,op:'upload'};
const path='/api/worker/tasks/'+actor.taskId+'/qwen-rotation-verify';
async function setup({enabled=true,createEnabled=true,decision=true,hasStore=true,endpoint='http://127.0.0.1:8790'}={}) {
  const calls=[],created=[];
  const node={...worker,endpoint_url:endpoint};
  const store={getWorkerById:async id=>id===worker.id?node:null,
    getUserById:async id=>id===actor.userId?{id,status:'active'}:null,
    getUserSession:async id=>id===actor.sessionId?{id,user_id:actor.userId,revoked_at:null}:null,
    getTask:async id=>id===actor.taskId?{id,user_id:actor.userId,assigned_worker_id:worker.id,
      attempt_count:actor.attempt,model_id:'qwen3.5-9b-heretic-foart-rotation-candidate-v1',input_manifest:{parameters:{},
        candidate_lease:{actor_user_id:actor.userId,session_id:actor.sessionId,session_expires_epoch:String(Math.floor(Date.now()/1000)+300)}}}:null};
  if(hasStore){store.authorizeQwenRotationLease=async input=>{calls.push(input);if(decision instanceof Error)throw decision;return typeof decision==='function'?decision(input):decision;};
    store.createQwenRotationCandidate=async input=>{created.push(input);return {task_id:actor.taskId,task_status:'queued',attempt:0,replayed:false};};}
  const plane=createControlPlane({store,secrets:{controlSecret,sessionSecret},qwenRotationVerifyEnabled:enabled,qwenRotationCreateEnabled:createEnabled});
  const token=await issueWorkerToken(worker,controlSecret);
  const headers={authorization:'Bearer '+token};
  const proof=await issueQwenRotationProof({...actor,sessionExpiresAt:Math.floor(Date.now()/1000)+300},controlSecret);
  const encoded=base64UrlJson({sub:actor.userId,sid:actor.sessionId,exp:Math.floor(Date.now()/1000)+300});
  const userHeaders={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',sessionSecret).update(encoded).digest('base64url')};
  return {calls,created,plane,headers,userHeaders,proof,call:(body={proof,op:actor.op,phase:'start'},p=path,h=headers)=>plane.handle({method:'POST',path:p,headers:h,body})};
}

test('verification route remains closed by default and without transactional store',async()=>{
  for(const opts of [{enabled:false},{hasStore:false}]){
    const f=await setup(opts),r=await f.call();assert.equal(r.status,503);assert.equal(f.calls.length,0);
  }
});

test('isolated verifier forwards only signed actor and requires literal true from store',async()=>{
  const f=await setup(),r=await f.call();assert.equal(r.status,200);assert.equal(r.body.authorized,true);
  assert.deepEqual({...r.body,ok:undefined,authorized:undefined,scope:undefined},
    {ok:undefined,authorized:undefined,scope:undefined,...actor});
  assert.equal(f.calls.length,1);const c=f.calls[0];
  assert.deepEqual({...c,proofExpiresAtMs:undefined},{...actor,proofExpiresAtMs:undefined,uploadSha256:null,uploadBytes:null});
  assert.ok(Number.isSafeInteger(c.proofExpiresAtMs) && c.proofExpiresAtMs>Date.now());
  for(const decision of [false,{},'true']){const g=await setup({decision});assert.equal((await g.call()).status,403);}
  const broken=await setup({decision:new Error('private test detail')});const failed=await broken.call();
  assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed),/private test detail/);
});

test('worker identity, task, op, body and proof cannot be supplied by node claims',async()=>{
  const f=await setup();
  assert.equal((await f.call({proof:f.proof,op:'download',phase:'start'})).status,403);
  assert.equal((await f.call({proof:f.proof,op:'upload',phase:'start',userId:actor.userId})).status,400);
  assert.equal((await f.call({proof:f.proof,op:'upload',phase:'start'},'/api/worker/tasks/fa047a0a-2222-8222-8222-222222222222/qwen-rotation-verify')).status,403);
  assert.equal((await f.call({proof:f.proof,op:'upload',phase:'start'},path,{})).status,401);
  const encoded=base64UrlJson({kind:'qwen-rotation-proof-v1',scope:'qwen-foart-rotation-candidate-v1',
    aud:'novaflow-web-candidate-verifier',task:actor.taskId,wid:actor.workerId,sub:actor.userId,sid:actor.sessionId,
    attempt:actor.attempt,op:actor.op,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60});
  const forged='nfr_'+encoded+'.'+await hmacSha256(encoded,await deriveWorkerGrantKey(actor.workerId,controlSecret));
  assert.equal((await f.call({proof:forged,op:'upload',phase:'start'})).status,403);assert.equal(f.calls.length,0);
});

test('node forwards only proof and op with its existing worker token and cancellation signal',async()=>{
  const calls=[],controller=new AbortController();
  const verify=createQwenCandidateOnlineVerifier({getWorkerToken:()=> 'fixture-worker-token',getWorkerId:()=>worker.id,
    callControl:async (...args)=>{calls.push(args);return {authorized:true};}});
  assert.deepEqual(await verify({taskId:actor.taskId,workerId:worker.id,op:'upload',proof:'fixture-proof',
    untrustedGrantUser:'forged-user',phase:'start',signal:controller.signal}),{authorized:true});
  assert.deepEqual(calls[0],['POST',path,{token:'fixture-worker-token',body:{proof:'fixture-proof',op:'upload',phase:'start'},signal:controller.signal}]);
  await assert.rejects(verify({taskId:actor.taskId,workerId:'another-node',op:'upload',proof:'fixture-proof'}));
  await assert.rejects(verify({taskId:'11111111-1111-4111-8111-111111111111',workerId:worker.id,op:'upload',proof:'fixture-proof'}));
  await assert.rejects(verify({taskId:actor.taskId,workerId:worker.id,op:'execute',proof:'fixture-proof'}));
  assert.equal(calls.length,1);
});

test('upload finish requires digest and byte count approved by the transactional store',async()=>{
  const digest='a'.repeat(64), f=await setup({decision:c=>c.uploadSha256===null || (c.uploadSha256===digest && c.uploadBytes===12)});
  const accepted=await f.call({proof:f.proof,op:'upload',phase:'finish',sha256:digest,bytes:12});
  assert.equal(accepted.status,200);assert.equal(accepted.body.digestBound,true);assert.equal(accepted.body.sha256,digest);assert.equal(accepted.body.bytes,12);
  assert.equal((await f.call({proof:f.proof,op:'upload',phase:'finish',sha256:'b'.repeat(64),bytes:12})).status,403);
  assert.equal((await f.call({proof:f.proof,op:'upload',phase:'finish',sha256:digest})).status,400);
  assert.equal((await f.call({proof:f.proof,op:'upload',phase:'start',sha256:digest,bytes:12})).status,400);
  const calls=[],verify=createQwenCandidateOnlineVerifier({getWorkerToken:()=> 'fixture-worker-token',getWorkerId:()=>worker.id,
    callControl:async (...args)=>{calls.push(args);return {authorized:true,digestBound:true,sha256:digest,bytes:12};}});
  await verify({taskId:actor.taskId,workerId:worker.id,op:'upload',phase:'finish',proof:'fixture-proof',sha256:digest,bytes:12});
  assert.deepEqual(calls[0][2].body,{proof:'fixture-proof',op:'upload',phase:'finish',sha256:digest,bytes:12});
});

test('browser proof issuance requires verified session and transactional authorization',async()=>{
  const proofPath='/api/web/tasks/'+actor.taskId+'/qwen-rotation-proof';
  const f=await setup(),r=await f.call({op:'upload'},proofPath,f.userHeaders);
  assert.equal(r.status,200);assert.ok(r.body.proof.startsWith('nfr_'));assert.ok(r.body.grant.token.startsWith('nfg_'));
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].userId,actor.userId);assert.equal(f.calls[0].sessionId,actor.sessionId);
  const verification=await f.call({proof:r.body.proof,op:'upload',phase:'start'});assert.equal(verification.status,200);
  assert.equal((await f.call({op:'upload'},proofPath,{})).status,401);
  assert.equal((await f.call({op:'upload',sessionId:actor.sessionId},proofPath,f.userHeaders)).status,400);
  const denied=await setup({decision:false});assert.equal((await denied.call({op:'upload'},proofPath,denied.userHeaders)).status,403);
  const closed=await setup({enabled:false});assert.equal((await closed.call({op:'upload'},proofPath,closed.userHeaders)).status,503);
  for(const endpoint of ['http://external.test:8790','https://user:password@node.test','https://node.test/?token=secret']) {
    const unsafe=await setup({endpoint});const result=await unsafe.call({op:'upload'},proofPath,unsafe.userHeaders);
    assert.equal(result.status,403);assert.equal(result.body.proof,undefined);
  }
});

test('worker phase checks derive actor only from server task and reject stale or supplied identities',async()=>{
  const f=await setup(),phasePath='/api/worker/tasks/'+actor.taskId+'/qwen-rotation-phase';
  const r=await f.call({op:'infer',attempt:actor.attempt},phasePath);
  assert.equal(r.status,200);assert.deepEqual(f.calls[0],{taskId:actor.taskId,workerId:worker.id,userId:actor.userId,
    sessionId:actor.sessionId,attempt:actor.attempt,op:'infer',proofExpiresAtMs:f.calls[0].proofExpiresAtMs,uploadSha256:null,uploadBytes:null});
  assert.ok(f.calls[0].proofExpiresAtMs>Date.now() && f.calls[0].proofExpiresAtMs<=Date.now()+8000);
  assert.equal((await f.call({op:'infer',attempt:actor.attempt,userId:'forged'},phasePath)).status,400);
  assert.equal((await f.call({op:'infer',attempt:actor.attempt+1},phasePath)).status,403);
  assert.equal((await f.call({op:'download',attempt:actor.attempt},phasePath)).status,400);
  const denied=await setup({decision:false});assert.equal((await denied.call({op:'complete',attempt:actor.attempt},phasePath)).status,403);
});

test('node phase verifier forwards no actor identity and checks authoritative response',async()=>{
  const calls=[], verify=createQwenCandidatePhaseVerifier({getWorkerToken:()=> 'fixture-worker-token',getWorkerId:()=>worker.id,
    callControl:async (...args)=>{calls.push(args);return {authorized:true,taskId:actor.taskId,workerId:worker.id,attempt:actor.attempt,op:'infer'};}});
  assert.equal(await verify({...actor,op:'infer'}),true);
  assert.deepEqual(calls[0][2].body,{attempt:actor.attempt,op:'infer'});
  assert.equal(await verify({...actor,op:'complete'}),false);
  await assert.rejects(verify({...actor,attempt:0,op:'infer'}));
});

test('candidate creation accepts only digest and binds the verified session, never user-supplied actor',async()=>{
 const f=await setup(),createPath='/api/web/qwen-rotation/tasks';
 const request={requestId:'44444444-4444-4444-8444-444444444444',workerId:worker.id,sha256:'a'.repeat(64),bytes:123};
 const r=await f.call(request,createPath,f.userHeaders);assert.equal(r.status,200);assert.equal(r.body.task.id,actor.taskId);
 assert.equal(f.created.length,1);assert.equal(f.created[0].userId,actor.userId);assert.equal(f.created[0].sessionId,actor.sessionId);
 assert.equal(f.created[0].sha256,request.sha256);assert.equal(f.created[0].bytes,request.bytes);
 assert.equal((await f.call({...request,actorUserId:actor.userId},createPath,f.userHeaders)).status,400);
 assert.equal((await f.call({...request,sha256:'not-a-digest'},createPath,f.userHeaders)).status,400);
 assert.equal((await f.call({...request,bytes:262145},createPath,f.userHeaders)).status,400);
 assert.equal((await f.call(request,createPath,{})).status,401);
 const closed=await setup({enabled:false});assert.equal((await closed.call(request,createPath,closed.userHeaders)).status,503);
 assert.equal(f.created.length,1);
});
